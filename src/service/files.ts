import { MODELS } from "@/@types/llm";
import { getLLM } from "@/ai-backend/llm";
import { getDb } from "@/db";
import { userFile } from "@/db/schema";
import { generateObject } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { parsePDF } from "./file/triggerParsing";
import { getStorage } from "./googleStorage";

const db = getDb();

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

export const bulkAddFiles = async ({
  pdfs,
  webArticles,
  userId,
  orgId,
}: {
  pdfs: { id: string; title: string; storagePath: string }[];
  webArticles: {
    id: string;
    url: string;
    storagePath: string;
    title: string;
  }[];
  userId: string;
  orgId: string;
}) => {
  // Create files
  const files = await db
    .insert(userFile)
    .values(
      pdfs.map((pdf) => ({
        id: pdf.id,
        name: pdf.title,
        userId: userId,
        orgId: orgId,
      })),
    )
    .returning();

  // Copy over the PDFs to the files
  let index = 0;
  for (const pdf of pdfs) {
    const storageService = getStorage();
    const pdfBuffer = await storageService.downloadFile(pdf.storagePath);
    await storageService.uploadFile({
      data: pdfBuffer,
      path: `files/${userId}/${files[index]?.id}/${files[index]?.id}.pdf`,
    });
    index++;
  }

  // Parse files
  await Promise.all(
    files.map(async (file) => {
      await parsePDF(file.id);
    }),
  );

  // Generate metadata for web articles parallelly
  const metadataPromises = webArticles.map(async (webArticle) => {
    // Assuming storagePath logic for web articles is correct or adapted
    const buffer = await getStorage().downloadFile(webArticle.storagePath);
    const markdown = buffer.toString("utf-8");
    const { metadata } = await generateSummaryAndMetadata(markdown);
    return {
      id: webArticle.id,
      name: metadata.title,
      userId: userId,
      orgId: orgId,
      type: "web_article" as const,
      webArticleMetadata: {
        url: webArticle.url,
        title: metadata.title,
        content: markdown,
      },
      metadata: metadata,
      status: "completed" as const,
    };
  });
  const metadataResults = await Promise.all(metadataPromises);
  const webArticlesFiles = await db
    .insert(userFile)
    .values(
      metadataResults.map((result) => ({
        id: result.id,
        name: result.name,
        userId: userId,
        orgId: orgId,
        type: "web_article" as const,
        webArticleMetadata: result.webArticleMetadata,
        metadata: result.metadata,
      })),
    )
    .returning();

  return {
    pdfs: files.map((file) => ({
      id: file.id,
      name: file.name,
    })),
    webArticles: webArticlesFiles.map((file) => ({
      id: file.id,
      name: file.name,
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
