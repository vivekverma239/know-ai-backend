import { MODELS } from "@/@types/llm";
import { getLLM } from "@/ai-backend/llm";
import { getDb } from "@/db";
import { userFile } from "@/db/schema";
import { logger } from "@/utils/logger";
import { generateObject } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { enqueueDocumentParse } from "./file/enqueueDocumentParse";
import { getStorage } from "./googleStorage";

const db = getDb();

// parse-engine ESM-only — load lazily so we don't pull Playwright at startup.
const loadParseEngineUrlFetch = () => import("parse-engine/url-fetch");

const generateSummaryAndMetadata = async (content: string) => {
  const llm = getLLM(MODELS.GEMINI_2_5_FLASH_LITE);
  const prompt = `
  You are a helpful assistant. Given a web article content, generate a summary and metadata about the article.
  
  Output a JSON object with the following structure:
  {
    "title": string, // The title of the article
    "shortSummary": string, // A brief summary (1-2 sentences)
    "summary": string, // A detailed summary of the article
    "year": number, // The year the document/article was published or refers to
    "documentType": string, // Type of document (e.g., "article", "report", "blog post", "research paper", etc.)
    "referencePeriod": string (optional), // The time period the document refers to (e.g., "Q1 2024", "2023", "January-March 2024")
    "referencePeriodEnd": string (optional), // End date of the reference period if applicable
    "documentPublishedDate": string (optional), // The publication date in ISO format (YYYY-MM-DD)
    "industry": string (optional), // The primary industry or sector discussed
    "companies": [ // Array of companies mentioned (optional)
      {
        "name": string,
        "countries": string[], // Countries where the company operates
        "industry": string[], // Industries the company operates in
        "productsOrServices": string[], // Products or services mentioned
        "customers": string[], // Types of customers or specific customers mentioned
        "suppliers": string[] // Suppliers mentioned
      }
    ]
  }
  
  Extract all relevant information from the content. If information is not available, omit optional fields or use reasonable defaults for required fields.
  Output only valid JSON, no additional text.
  
  Content: ${content}
  `;
  const result = await generateObject({
    model: llm,
    schema: z.object({
      title: z.string(),
      shortSummary: z.string(),
      summary: z.string(),
      year: z.number(),
      documentType: z.string(),
      referencePeriod: z.string().optional(),
      referencePeriodEnd: z.string().optional(),
    }),
    prompt: prompt,
  });

  // Parse the JSON response
  const metadata = result.object;

  return { metadata };
};

/**
 * Add a batch of documents to the knowledge base by URL.
 *
 * Format detection is server-side via parse-engine's `downloadFromUrl` —
 * the agent's `pdfs` vs `webArticles` split is treated as a hint, not
 * authoritative. URLs that resolve to PDFs go through the async parse
 * pipeline; URLs that resolve to HTML are summarised inline as web
 * articles. This means an agent that misclassifies a `.htm` SEC viewer
 * as a PDF still produces a useful indexed row.
 */
export const bulkAddFiles = async ({
  pdfs,
  webArticles,
  userId,
  orgId,
}: {
  pdfs: { url: string; title: string }[];
  webArticles: { url: string; title: string }[];
  userId: string;
  orgId: string;
}) => {
  const allUrls = [...pdfs, ...webArticles];
  if (allUrls.length === 0) {
    return { pdfs: [], webArticles: [] };
  }

  const { downloadFromUrl, parseHtmlToMarkdown } = await loadParseEngineUrlFetch();
  const storage = getStorage();

  // Probe every URL once; parse-engine handles the stealth-bypass + format
  // detection (PDF vs HTML) and returns the bytes/markup ready to use.
  type Probe =
    | { kind: "pdf"; title: string; url: string; buffer: Buffer }
    | { kind: "html"; title: string; url: string; html: string; htmlTitle: string }
    | { kind: "failed"; title: string; url: string; error: string };

  const probes: Probe[] = await Promise.all(
    allUrls.map(async (entry): Promise<Probe> => {
      try {
        const result = await downloadFromUrl(entry.url);
        if (result.type === "pdf") {
          return { kind: "pdf", title: entry.title, url: entry.url, buffer: result.buffer };
        }
        return {
          kind: "html",
          title: entry.title,
          url: entry.url,
          html: result.html,
          htmlTitle: result.title,
        };
      } catch (error) {
        return {
          kind: "failed",
          title: entry.title,
          url: entry.url,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  // ── PDFs: upload buffer to GCS at canonical path, insert, enqueue parse ──
  const pdfProbes = probes.filter((p): p is Extract<Probe, { kind: "pdf" }> => p.kind === "pdf");
  const pdfInserts = pdfProbes.map((p) => ({
    id: uuidv4(),
    name: p.title,
    userId,
    orgId,
    type: "pdf" as const,
    sourceDocumentUrl: p.url,
  }));

  const pdfRows = pdfInserts.length > 0
    ? await db.insert(userFile).values(pdfInserts).returning()
    : [];

  // Pre-cache the buffer in GCS so the parse worker doesn't refetch.
  await Promise.all(
    pdfRows.map(async (file, i) => {
      const buf = pdfProbes[i]?.buffer;
      if (!buf) return;
      const path = `files/${userId}/${file.id}/document.pdf`;
      await storage.uploadFile({ data: buf, contentType: "application/pdf", path });
    }),
  );

  await Promise.all(pdfRows.map((file) => enqueueDocumentParse(file.id)));

  // ── Web articles: parse HTML + summarise inline, insert with status=completed ──
  const htmlProbes = probes.filter(
    (p): p is Extract<Probe, { kind: "html" }> => p.kind === "html",
  );
  const webArticleRecords = await Promise.all(
    htmlProbes.map(async (p) => {
      try {
        const parsed = parseHtmlToMarkdown(p.html);
        const markdown = parsed.pages.map((page) => page.content).join("\n\n");
        const docTitle = parsed.title || p.htmlTitle || p.title;
        const { metadata } = await generateSummaryAndMetadata(markdown);
        return {
          id: uuidv4(),
          name: metadata.title || p.title || docTitle,
          userId,
          orgId,
          type: "web_article" as const,
          status: "completed" as const,
          sourceDocumentUrl: p.url,
          webArticleMetadata: {
            url: p.url,
            title: metadata.title || p.title || docTitle,
            content: markdown,
          },
          metadata,
        };
      } catch (error) {
        logger.error("Failed to summarise web article", {
          url: p.url,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          id: uuidv4(),
          name: p.title,
          userId,
          orgId,
          type: "web_article" as const,
          status: "failed" as const,
          sourceDocumentUrl: p.url,
          webArticleMetadata: { url: p.url, title: p.title, content: "" },
        };
      }
    }),
  );

  // Capture failed-probe URLs as failed rows so the user sees what didn't index.
  const failedProbes = probes.filter(
    (p): p is Extract<Probe, { kind: "failed" }> => p.kind === "failed",
  );
  for (const f of failedProbes) {
    logger.error("Failed to fetch URL via parse-engine downloadFromUrl", {
      url: f.url,
      error: f.error,
    });
    webArticleRecords.push({
      id: uuidv4(),
      name: f.title,
      userId,
      orgId,
      type: "web_article" as const,
      status: "failed" as const,
      sourceDocumentUrl: f.url,
      webArticleMetadata: { url: f.url, title: f.title, content: "" },
    });
  }

  const webArticleRows = webArticleRecords.length > 0
    ? await db.insert(userFile).values(webArticleRecords).returning()
    : [];

  return {
    pdfs: pdfRows.map((file) => ({
      id: file.id,
      name: file.name,
      url: file.sourceDocumentUrl,
    })),
    webArticles: webArticleRows.map((file) => ({
      id: file.id,
      name: file.name,
      status: file.status,
      url: file.webArticleMetadata?.url,
    })),
  };
};

export const getFileStatuses = async (fileIds: string[], userId: string) => {
  const files = await db.query.userFile.findMany({
    where: and(inArray(userFile.id, fileIds), eq(userFile.userId, userId)),
  });
  return files.map((file) => ({
    id: file.id,
    status: file.status,
  }));
};
