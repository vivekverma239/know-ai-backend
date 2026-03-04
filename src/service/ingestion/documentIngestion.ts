import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import {
  chunks,
  userFile,
  userFileChapter,
  userFileCluster,
  userFileHeirarchialIndex,
  userFilePage,
  userFileSection,
  userFileToCMeta,
} from "@/db/schema";
import { logError, logger } from "@/utils/logger";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
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

const pickCanonicalUserFile = (
  files: Array<typeof userFile.$inferSelect>,
  preferredUserId: string,
  sourceUrl: string,
) => {
  const statusRank: Record<string, number> = {
    completed: 4,
    in_progress: 3,
    pending: 2,
    failed: 1,
  };

  return [...files].sort((a, b) => {
    const aStatus = statusRank[(a.status ?? "") as string] ?? 0;
    const bStatus = statusRank[(b.status ?? "") as string] ?? 0;
    if (aStatus !== bStatus) return bStatus - aStatus;

    const aSourceMatch = a.sourceDocumentUrl === sourceUrl ? 1 : 0;
    const bSourceMatch = b.sourceDocumentUrl === sourceUrl ? 1 : 0;
    if (aSourceMatch !== bSourceMatch) return bSourceMatch - aSourceMatch;

    const aUserMatch = a.userId === preferredUserId ? 1 : 0;
    const bUserMatch = b.userId === preferredUserId ? 1 : 0;
    if (aUserMatch !== bUserMatch) return bUserMatch - aUserMatch;

    const aCreated = new Date(a.createdAt).getTime();
    const bCreated = new Date(b.createdAt).getTime();
    return aCreated - bCreated;
  })[0];
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
  const name = data.title?.trim() || `document-${documentId}`;
  let fileId = randomUUID() as typeof userFile.$inferSelect.id;
  let shouldProcess = false;

  await getDb().transaction(async (tx) => {
    // Serialize ingestion per (org, source document) to avoid duplicate user_file rows
    // when insert/update webhooks arrive concurrently.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('document_ingestion'), hashtext(${`${orgId}:${documentId}`}))`,
    );

    const existingFiles = await tx
      .select()
      .from(userFile)
      .where(and(eq(userFile.sourceDocumentId, documentId), eq(userFile.orgId, orgId)))
      .orderBy(asc(userFile.createdAt));

    const existing = pickCanonicalUserFile(existingFiles, userId, sourceUrl);

    if (existingFiles.length > 1) {
      logger.warn("Duplicate user_file rows detected for source document", {
        documentId,
        orgId,
        canonicalFileId: existing?.id ?? null,
        duplicateFileIds: existingFiles.map((f) => f.id),
      });
    }

    const duplicateIds = existing
      ? existingFiles.filter((file) => file.id !== existing.id).map((file) => file.id)
      : [];

    if (duplicateIds.length > 0) {
      await tx.delete(userFileSection).where(inArray(userFileSection.fileId, duplicateIds));
      await tx.delete(userFilePage).where(inArray(userFilePage.fileId, duplicateIds));
      await tx.delete(chunks).where(inArray(chunks.documentId, duplicateIds));
      await tx.delete(userFileCluster).where(inArray(userFileCluster.fileId, duplicateIds));
      await tx.delete(userFileChapter).where(inArray(userFileChapter.fileId, duplicateIds));
      await tx
        .delete(userFileHeirarchialIndex)
        .where(inArray(userFileHeirarchialIndex.fileId, duplicateIds));
      await tx.delete(userFileToCMeta).where(inArray(userFileToCMeta.fileId, duplicateIds));
      await tx.delete(userFile).where(inArray(userFile.id, duplicateIds));

      logger.info("Removed duplicate user_file rows for source document", {
        documentId,
        orgId,
        canonicalFileId: existing?.id ?? null,
        removedFileIds: duplicateIds,
      });
    }

    if (!existing) {
      fileId = randomUUID() as typeof userFile.$inferSelect.id;
      await tx.insert(userFile).values({
        id: fileId,
        name,
        userId,
        orgId,
        type: documentType === "webpage" ? "web_article" : "pdf",
        status: "pending",
        sourceDocumentId: documentId,
        sourceDocumentUrl: sourceUrl,
      });
      shouldProcess = true;
      return;
    }

    fileId = existing.id;
    const updates: Partial<typeof userFile.$inferInsert> = {};

    if (existing.name !== name) {
      updates.name = name;
    }
    if (existing.userId !== userId) {
      updates.userId = userId;
    }
    if (existing.type !== (documentType === "webpage" ? "web_article" : "pdf")) {
      updates.type = documentType === "webpage" ? "web_article" : "pdf";
    }
    if (existing.sourceDocumentUrl !== sourceUrl) {
      updates.sourceDocumentUrl = sourceUrl;
    }

    if (Object.keys(updates).length > 0) {
      await tx.update(userFile).set(updates).where(eq(userFile.id, existing.id));
    }

    const sourceChanged = existing.sourceDocumentUrl !== sourceUrl;
    const status = existing.status;
    const alreadyProcessing = status === "pending" || status === "in_progress";
    const retryFailed = status === "failed";

    shouldProcess = sourceChanged || retryFailed || !alreadyProcessing;

    if (alreadyProcessing && !sourceChanged) {
      shouldProcess = false;
    }
    if (status === "completed" && !sourceChanged) {
      shouldProcess = false;
    }

    logger.info("Document ingestion existing row resolution", {
      action,
      documentId,
      fileId,
      orgId,
      userId,
      status,
      sourceChanged,
      shouldProcess,
    });
  });

  if (!shouldProcess) {
    return;
  }

  await getDb().update(userFile).set({ status: "pending" }).where(eq(userFile.id, fileId));

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

      await getDb().update(userFile).set({ status: "completed" }).where(eq(userFile.id, fileId));
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

  const orgId = data.teamId?.trim();
  await getDb()
    .delete(userFile)
    .where(
      orgId
        ? and(eq(userFile.sourceDocumentId, documentId), eq(userFile.orgId, orgId))
        : eq(userFile.sourceDocumentId, documentId),
    );
};
