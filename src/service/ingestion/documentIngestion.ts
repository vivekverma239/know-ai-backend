import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import { userFile } from "@/db/schema";
import { logError, logger } from "@/utils/logger";
import { and, eq } from "drizzle-orm";
import { parsePDF } from "../file/triggerParsing";
import { getStorage } from "../googleStorage";
import { processWebpageContent } from "./webpageProcessing";

type DocumentIngestionData = {
  id?: number | string;
  type?: "webpage" | "pdf" | null;
  title?: string | null;
  teamId?: string | null;
  authorId?: string | null;
  assetUrl?: string | null;
};

const parseDocumentId = (value: number | string | undefined): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const downloadDocument = async (url: string): Promise<Buffer> => {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.DOCUMENT_DOWNLOAD_TIMEOUT_MS ?? "120000");
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Document download failed: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeoutId);
  }
};

const extractTitle = (content: string, fallback: string) => {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(content);
  if (!match) return fallback;
  const title = match[1]?.trim();
  return title && title.length > 0 ? title : fallback;
};

const fetchWebpageContent = async (url: string): Promise<{ title: string; content: string }> => {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.DOCUMENT_DOWNLOAD_TIMEOUT_MS ?? "120000");
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Webpage fetch failed: ${response.status} ${response.statusText}`);
    }
    const content = await response.text();
    const title = extractTitle(content, url);
    return { title, content };
  } finally {
    clearTimeout(timeoutId);
  }
};

export const ensureUserFileForDocument = async (
  data: DocumentIngestionData,
  action: "insert" | "update",
): Promise<void> => {
  const documentId = parseDocumentId(data.id);
  if (!documentId) {
    logger.warn("Document ingestion skipped: missing document id.");
    return;
  }

  const userId = data.authorId ?? undefined;
  const orgId = data.teamId ?? undefined;
  if (!userId || !orgId) {
    logger.warn("Document ingestion skipped: missing user/org id.", { documentId });
    return;
  }

  const sourceUrl = data.assetUrl ?? undefined;
  if (!sourceUrl) {
    logger.warn("Document ingestion skipped: missing asset URL.", { documentId });
    return;
  }
  const documentType = data.type === "webpage" ? "webpage" : "pdf";

  const existing = await getDb().query.userFile.findFirst({
    where: and(
      eq(userFile.sourceDocumentId, documentId),
      eq(userFile.userId, userId),
      eq(userFile.orgId, orgId),
    ),
  });

  if (existing && existing.status === "completed" && existing.sourceDocumentUrl === sourceUrl) {
    return;
  }

  const name = data.title?.trim() || `document-${documentId}`;
  const fileId = existing?.id ?? randomUUID();

  if (!existing) {
    await getDb()
      .insert(userFile)
      .values({
        id: fileId,
        name,
        userId,
        orgId,
        type: documentType === "webpage" ? "web_article" : "pdf",
        status: "pending",
        sourceDocumentId: documentId,
        sourceDocumentUrl: sourceUrl,
      });
  } else if (action === "update") {
    const updates: Partial<typeof userFile.$inferInsert> = {};
    if (existing.name !== name) {
      updates.name = name;
    }
    if (existing.sourceDocumentUrl !== sourceUrl) {
      updates.sourceDocumentUrl = sourceUrl;
    }
    if (Object.keys(updates).length > 0) {
      await getDb().update(userFile).set(updates).where(eq(userFile.id, existing.id));
    }
  }

  try {
    if (documentType === "webpage") {
      const { title, content } = await fetchWebpageContent(sourceUrl);
      // Store raw HTML in webArticleMetadata
      await getDb()
        .update(userFile)
        .set({
          name: title,
          type: "web_article",
          webArticleMetadata: {
            url: sourceUrl,
            title,
            content,
          },
        })
        .where(eq(userFile.id, fileId));

      // Convert HTML to markdown, split into pages, generate embeddings
      await processWebpageContent(fileId, content, sourceUrl, title);

      await getDb()
        .update(userFile)
        .set({ status: "completed" })
        .where(eq(userFile.id, fileId));
    } else {
      const buffer = await downloadDocument(sourceUrl);
      await getStorage().uploadFile({
        data: buffer,
        contentType: "application/pdf",
        path: `files/${userId}/${fileId}/document.pdf`,
      });
      await getDb().update(userFile).set({ status: "pending" }).where(eq(userFile.id, fileId));
      await parsePDF(fileId);
    }
  } catch (error) {
    logError(error, { operation: "documentIngestion:parse", documentId, fileId });
    await getDb().update(userFile).set({ status: "failed" }).where(eq(userFile.id, fileId));
  }
};

export const deleteUserFileForDocument = async (data: DocumentIngestionData): Promise<void> => {
  const documentId = parseDocumentId(data.id);
  if (!documentId) return;

  await getDb().delete(userFile).where(eq(userFile.sourceDocumentId, documentId));
};
