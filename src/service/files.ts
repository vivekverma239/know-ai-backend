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
 * - **PDFs** → insert userFile with `sourceDocumentUrl` set, status pending,
 *   then `enqueueDocumentParse(file.id)`. The parse worker downloads via
 *   parse-engine and updates status to in_progress / completed.
 * - **Web articles** → fetch HTML in-process via parse-engine's
 *   `downloadHtmlFromUrl` (Playwright + stealth bypass), convert to markdown
 *   via `parseHtmlToMarkdown`, generate summary metadata, insert with
 *   status=completed.
 *
 * The agent (and the dashboard's Documents view) sees a consistent userFile
 * row for every input, regardless of source type.
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
  // ── PDFs: insert + enqueue async parse ──
  const pdfRows =
    pdfs.length > 0
      ? await db
          .insert(userFile)
          .values(
            pdfs.map((pdf) => ({
              id: uuidv4(),
              name: pdf.title,
              userId,
              orgId,
              type: "pdf" as const,
              sourceDocumentUrl: pdf.url,
            })),
          )
          .returning()
      : [];

  await Promise.all(pdfRows.map((file) => enqueueDocumentParse(file.id)));

  // ── Web articles: fetch + summarise synchronously ──
  // Lazy-load parse-engine's url-fetch subpath so Playwright isn't pulled
  // into module load when no web articles are being added.
  const webArticleRows =
    webArticles.length > 0
      ? await indexWebArticles({ webArticles, userId, orgId })
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
      url: file.webArticleMetadata?.url,
    })),
  };
};

const indexWebArticles = async ({
  webArticles,
  userId,
  orgId,
}: {
  webArticles: { url: string; title: string }[];
  userId: string;
  orgId: string;
}) => {
  const { downloadHtmlFromUrl, parseHtmlToMarkdown } =
    await loadParseEngineUrlFetch();

  const ingestPromises = webArticles.map(async (article) => {
    try {
      const { html, title: pageTitle } = await downloadHtmlFromUrl(article.url);
      const parsed = parseHtmlToMarkdown(html);
      const markdown = parsed.pages.map((p) => p.content).join("\n\n");
      const docTitle = parsed.title || pageTitle;
      const { metadata } = await generateSummaryAndMetadata(markdown);

      return {
        id: uuidv4(),
        name: metadata.title || article.title || docTitle,
        userId,
        orgId,
        type: "web_article" as const,
        status: "completed" as const,
        sourceDocumentUrl: article.url,
        webArticleMetadata: {
          url: article.url,
          title: metadata.title || article.title || docTitle,
          content: markdown,
        },
        metadata,
      };
    } catch (error) {
      logger.error("Failed to index web article", {
        url: article.url,
        error: error instanceof Error ? error.message : String(error),
      });
      // Surface a row with status=failed so the user sees the failed entry
      // in the dashboard rather than a silent drop.
      return {
        id: uuidv4(),
        name: article.title,
        userId,
        orgId,
        type: "web_article" as const,
        status: "failed" as const,
        sourceDocumentUrl: article.url,
        webArticleMetadata: {
          url: article.url,
          title: article.title,
          content: "",
        },
      };
    }
  });

  const records = await Promise.all(ingestPromises);
  return await db.insert(userFile).values(records).returning();
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
