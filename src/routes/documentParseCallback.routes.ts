import { getDb } from "@/db";
import { userFile, userFileToCMeta } from "@/db/schema";
import {
  mapMetadata,
  mapOutline,
  mapPages,
  mapToCMeta,
} from "@/service/file/parseEngineMapper";
import {
  updateOutline,
  updateParsedMetadata,
  updateParsedPages,
} from "@/service/file/parsing";
import { resolveExistingPdfStoragePath } from "@/service/file/storagePath";
import { getStorage } from "@/service/googleStorage";
import { logError, logger } from "@/utils/logger";
import { Type } from "@sinclair/typebox";
import { Receiver } from "@upstash/qstash";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
// Dynamic import — parse-engine is ESM-only (mupdf uses top-level await)
const loadParseEngine = () => import("parse-engine");

const documentParseCallbackRoutes = async (fastify: FastifyInstance) => {
  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY ?? "",
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY ?? "",
  });

  fastify.post(
    "/",
    {
      config: {
        rawBody: true,
      },
      schema: {
        description: "QStash callback for document parsing via parse-engine",
        tags: ["Callbacks"],
        headers: Type.Object({
          "upstash-signature": Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({ success: Type.Boolean() }),
          400: Type.Object({
            success: Type.Boolean(),
            error: Type.Optional(Type.String()),
          }),
          500: Type.Object({
            success: Type.Boolean(),
            error: Type.Optional(Type.String()),
          }),
        },
      },
    },
    async (request, reply) => {
      let fileId: string | undefined;
      try {
        // Verify QStash signature
        const signature = (request.headers["upstash-signature"] ??
          request.headers["Upstash-Signature"]) as string | undefined;
        if (!signature) {
          logger.warn("Document parse callback: No signature provided");
          return reply.code(400).send({ success: false });
        }

        const bodyText =
          typeof request.rawBody === "string"
            ? request.rawBody
            : typeof request.body === "string"
              ? request.body
              : JSON.stringify(request.body ?? {});

        try {
          const isValid = await receiver.verify({
            body: bodyText,
            signature,
          });
          if (!isValid) {
            logger.warn("Document parse callback: Invalid signature");
            return reply.code(400).send({ success: false });
          }
        } catch (err) {
          logger.error("Document parse callback: Error verifying signature", {
            error: err instanceof Error ? err.message : String(err),
          });
          return reply.code(400).send({ success: false });
        }

        const { type, data } = JSON.parse(bodyText) as {
          type: string;
          data: { fileId?: string };
        };

        if (type !== "document_parse") {
          logger.warn("Document parse callback: Invalid message type", {
            type,
          });
          return reply.code(400).send({ success: false });
        }

        fileId = data?.fileId;
        if (!fileId || typeof fileId !== "string") {
          logger.warn(
            "Document parse callback: Invalid or missing fileId",
            { fileId },
          );
          return reply.code(400).send({ success: false });
        }

        logger.info("Starting document parse via parse-engine", { fileId });

        // Update status to in_progress
        await getDb()
          .update(userFile)
          .set({ status: "in_progress" })
          .where(eq(userFile.id, fileId));

        // Fetch file record
        const file = await getDb().query.userFile.findFirst({
          where: eq(userFile.id, fileId),
        });
        if (!file) {
          throw new Error(`File not found: ${fileId}`);
        }

        // Download PDF from GCS
        const storage = getStorage();
        const gcsPath = await resolveExistingPdfStoragePath(storage, {
          id: fileId,
          userId: file.userId,
          orgId: file.orgId,
          isAdminFile: file.isAdminFile,
        });
        if (!gcsPath) {
          throw new Error(
            `PDF file not found in storage for file ${fileId}`,
          );
        }
        const pdfBuffer = await storage.downloadFile(gcsPath);

        logger.info("PDF downloaded, starting parse-engine", {
          fileId,
          bufferSize: pdfBuffer.length,
        });

        // Run parse-engine
        const { parsePdfFromBuffer } = await loadParseEngine();
        const result = await parsePdfFromBuffer(pdfBuffer, {
          paddle: !!process.env.MODAL_ENDPOINT_URL,
          textract: true,
          verbose: true,
        });

        logger.info("parse-engine completed", {
          fileId,
          totalPages: result.totalPages,
          chaptersCount: result.chapters?.length ?? 0,
          hasMetadata: !!result.metadata,
          hasSummary: !!result.summary,
        });

        // Map and save pages
        const mappedPages = mapPages(result);
        await updateParsedPages(fileId, mappedPages);
        logger.info("Pages saved", {
          fileId,
          pageCount: mappedPages.pages.length,
        });

        // Map and save metadata (clusters + document metadata)
        const mappedMetadata = mapMetadata(result);
        await updateParsedMetadata(
          fileId,
          mappedMetadata as any,
        );
        logger.info("Metadata saved", { fileId });

        // Map and save outline (chapters + sections)
        if (result.chapters && result.chapters.length > 0) {
          const mappedOutline = mapOutline(result);
          await updateOutline({
            chapters: mappedOutline.chapters,
            title: mappedOutline.title,
            summary: mappedOutline.summary,
            fileId,
          });
          logger.info("Outline saved", {
            fileId,
            chapterCount: mappedOutline.chapters.length,
          });
        }

        // Map and save ToC meta (replaces separate parseToCMeta agent)
        const mappedToCMeta = mapToCMeta(result);
        await getDb()
          .insert(userFileToCMeta)
          .values({
            fileId,
            toc: mappedToCMeta.toc,
            metadata: mappedToCMeta.metadata,
            pages: mappedToCMeta.pages,
            tokenUsage: null,
          })
          .onConflictDoUpdate({
            target: userFileToCMeta.fileId,
            set: {
              toc: mappedToCMeta.toc,
              metadata: mappedToCMeta.metadata,
              pages: mappedToCMeta.pages,
              tokenUsage: null,
            },
          });
        logger.info("ToC meta saved", { fileId });

        // Mark completed
        await getDb()
          .update(userFile)
          .set({ status: "completed" })
          .where(eq(userFile.id, fileId));
        logger.info("Document parse completed successfully", { fileId });

        return reply.send({ success: true });
      } catch (error) {
        logError(error, {
          operation: "documentParseCallback",
          fileId,
        });
        if (fileId) {
          try {
            await getDb()
              .update(userFile)
              .set({ status: "failed" })
              .where(eq(userFile.id, fileId));
          } catch {
            /* ignore status update failure */
          }
        }
        return reply.code(500).send({ success: false });
      }
    },
  );
};

export default documentParseCallbackRoutes;
