import { getStorage } from "../googleStorage";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { userFile, userFileToCMeta } from "../../db/schema";
import { logger, logError } from "../../utils/logger";
import { traceManager } from "../../utils/tracing";
import { httpClient } from "../../utils/httpClient";
import { StorageService } from "../storage";
import { parseToCMeta } from "@/agents/document/parseToCMeta";

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
        const path = `files/${file.userId}/${fileId}/document.pdf`;
        const signedUrl = await storage.getSignedUrl(path);

        const backendUrl = `${process.env.BACKEND_URL}/parse/document/async`;
        logger.info("Calling parsing backend", {
          backendUrl,
          fileId,
          elements: ["pdf_parse", "metadata", "outline", "heirarchial_index"]
        });

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
              "X-APP-TOKEN": process.env.BACKEND_TOKEN!,
            },
          }
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
          spanId: span.id
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
    { fileId, operation: "parsePDF" }
  );
};

export const parsePDFMetadata = async (fileId: string): Promise<void> => {
  return traceManager.withSpan(
    "file:parsePDFMetadata",
    async (span) => {
      try {
        logger.info("Starting PDF metadata parsing", { fileId, operation: "parsePDFMetadata" });

        const file = await getDb().query.userFile.findFirst({
          where: eq(userFile.id, fileId),
        });

        if (!file) {
          throw new Error("File not found");
        }

        const storage = getStorage();
        const path = `files/${file.userId}/${fileId}/document.pdf`;
        const signedUrl = await storage.getSignedUrl(path);

        const backendUrl = `${process.env.BACKEND_URL}/parse-metadata/background`;
        logger.info("Calling metadata parsing backend", {
          backendUrl,
          fileId
        });

        const response = await httpClient.post(
          backendUrl,
          {
            pdf_url: signedUrl,
            doc_id: fileId,
            callback_url: `${process.env.APP_URL}/api/v1/callbacks/parsing/${fileId}`,
          },
          {
            headers: {
              "Content-Type": "application/json",
              "X-APP-TOKEN": process.env.BACKEND_TOKEN!,
            },
          }
        );

        if (!response.ok) {
          const errorBody = await response.json();
          logger.error("PDF metadata parsing request failed", {
            fileId,
            status: response.status,
            error: errorBody,
            spanId: span.id,
          });
          throw new Error("Failed to parse PDF metadata");
        }

        logger.info("PDF metadata parsing triggered successfully", {
          fileId,
          spanId: span.id
        });
      } catch (error) {
        logError(error, {
          fileId,
          operation: "parsePDFMetadata",
          spanId: span.id,
        });
        throw error;
      }
    },
    { fileId, operation: "parsePDFMetadata" }
  );
};

export const parsePDFChapters = async (fileId: string): Promise<void> => {
  return traceManager.withSpan(
    "file:parsePDFChapters",
    async (span) => {
      try {
        logger.info("Starting PDF chapters parsing", { fileId, operation: "parsePDFChapters" });

        const file = await getDb().query.userFile.findFirst({
          where: eq(userFile.id, fileId),
        });

        if (!file) {
          throw new Error("File not found");
        }

        const storage = getStorage();
        const path = `files/${file.userId}/${fileId}/document.pdf`;
        const signedUrl = await storage.getSignedUrl(path);

        const backendUrl = `${process.env.BACKEND_URL}/parse-outline/background`;
        logger.info("Calling outline parsing backend", {
          backendUrl,
          fileId
        });

        const response = await httpClient.post(
          backendUrl,
          {
            pdf_url: signedUrl,
            doc_id: fileId,
            callback_url: `${process.env.APP_URL}/api/v1/callbacks/parsing/${fileId}`,
          },
          {
            headers: {
              "Content-Type": "application/json",
              "X-APP-TOKEN": process.env.BACKEND_TOKEN!,
            },
          }
        );

        if (!response.ok) {
          const errorBody = await response.json();
          logger.error("PDF chapters parsing request failed", {
            fileId,
            status: response.status,
            error: errorBody,
            spanId: span.id,
          });
          throw new Error("Failed to parse PDF chapters");
        }

        logger.info("PDF chapters parsing triggered successfully", {
          fileId,
          spanId: span.id
        });
      } catch (error) {
        logError(error, {
          fileId,
          operation: "parsePDFChapters",
          spanId: span.id,
        });
        throw error;
      }
    },
    { fileId, operation: "parsePDFChapters" }
  );
};

export const parsePDFHeirarchialIndex = async (fileId: string): Promise<void> => {
  return traceManager.withSpan(
    "file:parsePDFHeirarchialIndex",
    async (span) => {
      try {
        logger.info("Starting PDF hierarchical index parsing", { fileId, operation: "parsePDFHeirarchialIndex" });

        const file = await getDb().query.userFile.findFirst({
          where: eq(userFile.id, fileId),
        });

        if (!file) {
          throw new Error("File not found");
        }

        const storage = getStorage();
        const path = `files/${file.userId}/${fileId}/document.pdf`;
        const signedUrl = await storage.getSignedUrl(path);

        const backendUrl = `${process.env.BACKEND_URL}/parse-heirarchial-index/background`;
        logger.info("Calling hierarchical index parsing backend", {
          backendUrl,
          fileId
        });

        const response = await httpClient.post(
          backendUrl,
          {
            pdf_url: signedUrl,
            doc_id: fileId,
            callback_url: `${process.env.APP_URL}/api/v1/callbacks/parsing/${fileId}`,
          },
          {
            headers: {
              "Content-Type": "application/json",
              "X-APP-TOKEN": process.env.BACKEND_TOKEN!,
            },
          }
        );

        if (!response.ok) {
          const errorBody = await response.json();
          logger.error("PDF hierarchical index parsing request failed", {
            fileId,
            status: response.status,
            error: errorBody,
            spanId: span.id,
          });
          throw new Error("Failed to parse PDF hierarchical index");
        }

        logger.info("PDF hierarchical index parsing triggered successfully", {
          fileId,
          spanId: span.id
        });
      } catch (error) {
        logError(error, {
          fileId,
          operation: "parsePDFHeirarchialIndex",
          spanId: span.id,
        });
        throw error;
      }
    },
    { fileId, operation: "parsePDFHeirarchialIndex" }
  );
};


export const parseToCMetaService = async (fileId: string): Promise<void> => {
  const file = await getDb().query.userFile.findFirst({
    where: eq(userFile.id, fileId),
  });
  if (!file) {
    throw new Error("File not found");
  }
  const storage = new StorageService();
  const path = `files/${file.userId}/${fileId}/${fileId}.pdf`;
  const pdfBuffer = await storage.downloadFile(path);
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
