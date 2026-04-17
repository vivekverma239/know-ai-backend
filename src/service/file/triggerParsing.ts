import { parseToCMeta } from "@/agents/document/parseToCMeta";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { userFile, userFileToCMeta } from "../../db/schema";
import { httpClient } from "../../utils/httpClient";
import { logError, logger } from "../../utils/logger";
import { traceManager } from "../../utils/tracing";
import { downloadPdfBuffer, resolveExistingPdfStoragePath } from "./storagePath";
import { getStorage } from "../googleStorage";

export const parsePDF = async (fileId: string): Promise<void> => {
  return traceManager.withSpan(
    "file:parsePDF",
    async (span) => {
      try {
        logger.info("Starting PDF parsing", { fileId, operation: "parsePDF" });

        const file = await getDb().query.userFile.findFirst({
          where: eq(userFile.id, fileId),
        });

        if (!file) {
          throw new Error("File not found");
        }

        const storage = getStorage();
        const path = await resolveExistingPdfStoragePath(storage, {
          id: fileId,
          userId: file.userId,
          orgId: file.orgId,
          isAdminFile: file.isAdminFile,
        });
        if (!path) {
          throw new Error(`PDF file not found in storage for file ${fileId}`);
        }
        const signedUrl = await storage.getSignedUrl(path);

        const backendUrl = `${process.env.BACKEND_URL}/parse/document/async`;
        logger.info("Calling parsing backend", {
          backendUrl,
          fileId,
          elements: ["pdf_parse", "metadata", "outline", "heirarchial_index"],
        });
        if (!process.env.BACKEND_TOKEN) {
          throw new Error("BACKEND_TOKEN is not set");
        }

        const parsingTimeoutMs = Number(process.env.PARSING_TIMEOUT_MS ?? "120000");
        const response = await httpClient.post(
          backendUrl,
          {
            document_url: signedUrl,
            document_id: fileId,
            elements: ["pdf_parse", "metadata", "outline", "heirarchial_index"],
            callback_url: `${process.env.APP_URL}/api/v1/callbacks/parsing/${fileId}`,
            ignore_cache: false,
          },
          {
            headers: {
              "Content-Type": "application/json",
              "X-APP-TOKEN": process.env.BACKEND_TOKEN,
            },
            timeout: Number.isFinite(parsingTimeoutMs) ? parsingTimeoutMs : 120000,
          },
        );

        if (!response.ok) {
          const errorBody = await response.json();
          logger.error("PDF parsing request failed", {
            fileId,
            status: response.status,
            error: errorBody,
            spanId: span.id,
          });
          throw new Error("Failed to parse PDF");
        }

        logger.info("PDF parsing triggered successfully", {
          fileId,
          spanId: span.id,
        });
      } catch (error) {
        logError(error, {
          fileId,
          operation: "parsePDF",
          spanId: span.id,
        });
        throw error;
      }
    },
    { fileId, operation: "parsePDF" },
  );
};

export const parseToCMetaService = async (fileId: string): Promise<void> => {
  const file = await getDb().query.userFile.findFirst({
    where: eq(userFile.id, fileId),
  });
  if (!file) {
    throw new Error("File not found");
  }
  const storage = getStorage();
  const pdfBuffer = await downloadPdfBuffer(storage, {
    id: fileId,
    userId: file.userId,
    orgId: file.orgId,
    isAdminFile: file.isAdminFile,
    sourceDocumentUrl: file.sourceDocumentUrl,
  });
  const { result, tokenUsage } = await parseToCMeta(pdfBuffer);

  // Save to db
  await getDb()
    .insert(userFileToCMeta)
    .values({
      fileId: file.id,
      toc: result.toc,
      metadata: result.metadata,
      pages: result.pages,
      tokenUsage: tokenUsage ?? null,
    })
    .onConflictDoUpdate({
      target: userFileToCMeta.fileId,
      set: {
        toc: result.toc,
        metadata: result.metadata,
        pages: result.pages,
        tokenUsage: tokenUsage ?? null,
      },
    });
};
