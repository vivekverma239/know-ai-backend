import fs from "node:fs";
import { serve } from "@upstash/workflow";
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
import { downloadPdfBuffer } from "@/service/file/storagePath";
import { getStorage } from "@/service/googleStorage";
import { fetchWebpageContent } from "@/service/ingestion/documentIngestion";
import { processWebpageContent } from "@/service/ingestion/webpageProcessing";
import { logError, logger } from "@/utils/logger";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

// Dynamic import — parse-engine is ESM-only (mupdf uses top-level await)
const loadWorkflowAdapter = () => import("parse-engine/workflows/upstash");
const loadParseEngine = () => import("parse-engine");

/** Ensure the PDF exists on local disk (downloads from GCS if missing). */
async function ensurePdfOnDisk(fileId: string, pdfPath: string, tempDir: string) {
  if (fs.existsSync(pdfPath)) return;

  const file = await getDb().query.userFile.findFirst({
    where: eq(userFile.id, fileId),
  });
  if (!file) throw new Error(`File not found: ${fileId}`);

  const storage = getStorage();
  const pdfBuffer = await downloadPdfBuffer(storage, {
    id: fileId,
    userId: file.userId,
    orgId: file.orgId,
    isAdminFile: file.isAdminFile,
    sourceDocumentUrl: file.sourceDocumentUrl,
  });

  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(pdfPath, pdfBuffer);

  logger.info("PDF downloaded to temp", {
    fileId,
    pdfPath,
    size: pdfBuffer.length,
  });
}

const documentParseWorkflowRoutes = async (fastify: FastifyInstance) => {
  const workflowUrl = `${process.env.APP_URL}/api/v1/document-parse-workflow`;

  const { handler: workflowHandler } = serve(
    async (context) => {
      const payload = context.requestPayload as {
        type: string;
        data: { fileId: string };
      };
      const fileId = payload.data.fileId;

      logger.info("Document parse workflow invoked", { fileId });

      // Mark file as in_progress (durable — only executes once)
      await context.run("set-in-progress", async () => {
        await getDb()
          .update(userFile)
          .set({ status: "in_progress" })
          .where(eq(userFile.id, fileId));
      });

      // Look up the file row so we can dispatch on its declared type.
      // Without this branch, every queued file is fed to MuPDF as a PDF — which
      // throws on web articles (HTML/CSS) and can poison GCS via the
      // downloadPdfBuffer fallback.
      const file = await getDb().query.userFile.findFirst({
        where: eq(userFile.id, fileId),
      });
      if (!file) throw new Error(`File not found: ${fileId}`);

      if (file.type === "web_article") {
        await context.run("process-web-article", async () => {
          const url = file.webArticleMetadata?.url ?? file.sourceDocumentUrl;
          if (!url) {
            throw new Error(`web_article file has no URL: ${fileId}`);
          }

          let title = file.webArticleMetadata?.title ?? file.name ?? url;
          let content = file.webArticleMetadata?.content;

          if (!content) {
            const fetched = await fetchWebpageContent(url);
            title = fetched.title;
            content = fetched.content;
            await getDb()
              .update(userFile)
              .set({
                name: title,
                webArticleMetadata: { url, title, content },
              })
              .where(eq(userFile.id, fileId));
          }

          await processWebpageContent(fileId, content, url, title);
          logger.info("Web article processed via workflow", { fileId, url });
        });

        await context.run("mark-completed", async () => {
          await getDb()
            .update(userFile)
            .set({ status: "completed" })
            .where(eq(userFile.id, fileId));
          logger.info("Web article parse completed via workflow", { fileId });
        });

        return;
      }

      if (file.type !== "pdf") {
        // structured_report (and any future types) shouldn't be parsed here.
        // Don't touch status — owner workflows manage these rows.
        logger.warn("document-parse-workflow received non-pdf, non-web_article type — skipping", {
          fileId,
          type: file.type,
        });
        return;
      }

      // PDF path: download from GCS to temp dir.
      // Runs outside context.run because parse-engine needs the file on disk
      // on every invocation (PdfDocument constructor reads it).
      const tempDir = `/tmp/parse-${fileId}`;
      const pdfPath = `${tempDir}/document.pdf`;
      await ensurePdfOnDisk(fileId, pdfPath, tempDir);

      // Load parse-engine Upstash adapter and run the pipeline steps
      const { parsePdfHandler } = await loadWorkflowAdapter();
      const { LocalPersistence } = await loadParseEngine();

      const parseHandler = parsePdfHandler({
        persistence: new LocalPersistence(`${tempDir}/.cache`),
        pdfPath,
        // Pipeline defaults: PaddleOCR for table detection + masking, mistral
        // for OCR + image detection, vision LLM (Claude Sonnet via gateway)
        // for chart/figure parsing, vision LLM (Gemini 3 Flash) for tables.
        // Textract is disabled so tables go through the vision LLM tier.
        paddle: true,
        mask: true,
        useTextract: false,
      });

      // Cast to parse-engine's WorkflowContext interface (compatible run() method)
      const result = await parseHandler(context as any);

      logger.info("Parse-engine steps completed", {
        fileId,
        totalPages: result.totalPages,
        chaptersCount: result.chapters?.length ?? 0,
      });

      // Save pages + chunks + embeddings
      await context.run("save-pages", async () => {
        const mappedPages = mapPages(result);
        await updateParsedPages(fileId, mappedPages);
        logger.info("Pages saved", { fileId, pageCount: mappedPages.pages.length });
      });

      // Save metadata (clusters + document metadata + embeddings)
      await context.run("save-metadata", async () => {
        const mappedMetadata = mapMetadata(result);
        await updateParsedMetadata(fileId, mappedMetadata as any);
        logger.info("Metadata saved", { fileId });
      });

      // Save outline (chapters + sections + embeddings)
      await context.run("save-outline", async () => {
        if (result.chapters && result.chapters.length > 0) {
          const mappedOutline = mapOutline(result);
          await updateOutline({ ...mappedOutline, fileId });
          logger.info("Outline saved", {
            fileId,
            chapterCount: mappedOutline.chapters.length,
          });
        }
      });

      // Save ToC meta
      await context.run("save-toc-meta", async () => {
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
      });

      // Mark completed
      await context.run("mark-completed", async () => {
        await getDb()
          .update(userFile)
          .set({ status: "completed" })
          .where(eq(userFile.id, fileId));
        logger.info("Document parse completed via workflow", { fileId });

        // Clean up temp files
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { /* ignore cleanup errors */ }
      });
    },
    {
      url: workflowUrl,
      failureFunction: async (failureData) => {
        try {
          const payload = failureData.context.requestPayload as {
            data: { fileId: string };
          };
          const fileId = payload?.data?.fileId;
          if (fileId) {
            logger.error("Document parse workflow failed", {
              fileId,
              failStatus: failureData.failStatus,
              failResponse: failureData.failResponse,
            });
            await getDb()
              .update(userFile)
              .set({ status: "failed" })
              .where(eq(userFile.id, fileId));
          }
        } catch (error) {
          logError(error, {
            operation: "documentParseWorkflow:failureFunction",
          });
        }
      },
    },
  );

  // Fastify → Web API adapter
  fastify.post(
    "/",
    {
      config: { rawBody: true },
      schema: {
        description: "Upstash Workflow endpoint for document parsing via parse-engine",
        tags: ["Callbacks"],
      },
    },
    async (request, reply) => {
      const url = `${request.protocol}://${request.hostname}${request.url}`;

      // Use raw body for accurate QStash signature verification
      const body =
        typeof request.rawBody === "string"
          ? request.rawBody
          : typeof request.body === "string"
            ? request.body
            : JSON.stringify(request.body ?? {});

      // Convert Fastify headers to Web API Headers
      const headerEntries: [string, string][] = [];
      for (const [key, value] of Object.entries(request.headers)) {
        if (value != null) {
          if (Array.isArray(value)) {
            for (const v of value) headerEntries.push([key, v]);
          } else {
            headerEntries.push([key, value]);
          }
        }
      }

      const webRequest = new Request(url, {
        method: "POST",
        headers: new Headers(headerEntries),
        body,
      });

      const response = await workflowHandler(webRequest);

      reply.code(response.status);
      for (const [key, value] of response.headers.entries()) {
        reply.header(key, value);
      }

      const responseText = await response.text();
      try {
        return reply.send(JSON.parse(responseText));
      } catch {
        return reply.send(responseText);
      }
    },
  );
};

export default documentParseWorkflowRoutes;
