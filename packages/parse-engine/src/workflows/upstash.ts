/**
 * Upstash Workflow adapter.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PipelineContext } from "../context.js";
import { env } from "../env.js";
import { maskPdf, mediasToMaskBlocks } from "../mask.js";
import { getModelConfig } from "../models.js";
import { runPaddleOCR, runPaddleOCRChunked } from "../paddle.js";
import { PdfDocument } from "../pdf.js";
import { fileHash } from "../persistence.js";
import { generatePageSummaries } from "../services/cluster.js";
import { placeMediaBlocks } from "../services/placement.js";
import {
  mistralStep,
  mediaStep,
  summaryStep,
  outlineStep,
  metadataStep,
  assembleOutput,
} from "../steps.js";
import { deleteTempBlob, uploadAndGetSignedUrl } from "../storage.js";
import type { DetectedMedia, ParsedDocument } from "../types.js";
import type { PersistenceProvider } from "../persistence.js";

const CHUNK_SIZE = 100;

export interface UpstashWorkflowConfig {
  persistence: PersistenceProvider;
  pdfPath: string;
  /**
   * Use AWS Textract for table-block parsing. Default: false (use the vision LLM
   * via `ctx.models.smart`).
   */
  useTextract?: boolean;
  concurrency?: number;
  /**
   * Run PaddleOCR table detection + masking before Mistral. Default: true.
   * Requires `bucket` (or GOOGLE_STORAGE_BUCKET env) and `modalUrl`
   * (or MODAL_ENDPOINT_URL env). Tables come from Paddle, images from Mistral.
   */
  paddle?: boolean;
  /** GCS bucket name for paddle uploads. Falls back to GOOGLE_STORAGE_BUCKET env. */
  bucket?: string;
  /** Modal endpoint for PaddleOCR. Falls back to MODAL_ENDPOINT_URL env. */
  modalUrl?: string;
  /**
   * After paddle table detection, mask the table regions in the PDF so Mistral
   * doesn't double-parse them. Default: true.
   */
  mask?: boolean;
  /** Working directory for masked-PDF temp files. Default: OS tempdir. */
  workDir?: string;
}

interface WorkflowContext {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

export function parsePdfHandler(config: UpstashWorkflowConfig) {
  return async (context: WorkflowContext): Promise<ParsedDocument> => {
    const pdf = new PdfDocument(config.pdfPath);
    const ctx = new PipelineContext({
      persistence: config.persistence,
      models: getModelConfig(),
      documentHash: fileHash(config.pdfPath),
    });
    const baseName = config.pdfPath.split("/").pop()?.replace(".pdf", "") ?? "doc";

    const usePaddle = config.paddle ?? true;
    const mask = config.mask ?? true;
    const useTextract = config.useTextract ?? false;
    const concurrency = config.concurrency ?? 20;
    const modalEndpoint = config.modalUrl ?? env.modalEndpointUrl;
    const bucketName = config.bucket ?? env.gcsBucket;

    const workDir =
      config.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "parse-engine-upstash-"));
    const tempBlobPaths: string[] = [];
    let pdfForMistralPath = config.pdfPath;
    let paddleTables: DetectedMedia[] = [];

    try {
      if (usePaddle) {
        if (!modalEndpoint) {
          throw new Error("PaddleOCR enabled but modalUrl / MODAL_ENDPOINT_URL is not set");
        }
        if (!bucketName) {
          throw new Error("PaddleOCR enabled but bucket / GOOGLE_STORAGE_BUCKET is not set");
        }

        const paddleOutcome = await context.run("paddle-detect-and-mask", async () => {
          const needsChunking = pdf.pageCount > CHUNK_SIZE;
          let paddlePages;

          if (needsChunking) {
            const paddleChunks = pdf.chunk(
              CHUNK_SIZE,
              path.join(workDir, "paddle_chunks"),
            );
            const chunkUrls = [];
            for (const chunk of paddleChunks) {
              const upload = await uploadAndGetSignedUrl(chunk.path, bucketName);
              tempBlobPaths.push(upload.blobPath);
              chunkUrls.push({ signedUrl: upload.signedUrl, chunk });
            }
            paddlePages = await runPaddleOCRChunked(chunkUrls, modalEndpoint);
          } else {
            const upload = await uploadAndGetSignedUrl(config.pdfPath, bucketName);
            tempBlobPaths.push(upload.blobPath);
            paddlePages = await runPaddleOCR(upload.signedUrl, modalEndpoint);
          }

          const tables = paddlePages.flatMap((p) => p.tables);

          let maskedPath: string | undefined;
          if (mask && tables.length > 0) {
            const maskBlocks = mediasToMaskBlocks([], tables);
            maskedPath = path.join(workDir, `${baseName}_masked.pdf`);
            await maskPdf(config.pdfPath, maskBlocks, maskedPath);
          }

          return { tables, maskedPath, tempBlobPaths };
        });

        paddleTables = paddleOutcome.tables;
        if (paddleOutcome.maskedPath) {
          pdfForMistralPath = paddleOutcome.maskedPath;
        }
      }

      const mistralResult = await context.run("mistral-ocr", () =>
        mistralStep(pdfForMistralPath, pdf, ctx),
      );

      // Tables from Paddle (when enabled), images from Mistral. Fall back to
      // Mistral for both when paddle is disabled.
      const mistralImages = mistralResult.pages.flatMap((p) => p.images);
      const allMedia: DetectedMedia[] = usePaddle
        ? [...paddleTables, ...mistralImages]
        : mistralResult.pages.flatMap((p) => [...p.images, ...p.tables]);

      const mediaResult = await context.run("media-pipeline", () =>
        mediaStep(pdf, mistralResult, allMedia, ctx, {
          concurrency,
          useTextract,
          baseName,
        }),
      );

      const summary = await context.run("summary", () => summaryStep(pdf, ctx));

      const mergedPages = placeMediaBlocks(mistralResult.pages, mediaResult.parsedBlocks);

      const clusterResult = await context.run("cluster-parsing", () =>
        generatePageSummaries(mergedPages, ctx),
      );

      const outlineResult = await context.run("outline", () =>
        outlineStep(
          clusterResult.pageSummaries,
          summary?.title ?? baseName,
          summary?.shortSummary ?? "",
          ctx,
          { pdfPath: config.pdfPath },
        ),
      );

      const metadata = await context.run("metadata", () =>
        metadataStep(clusterResult.pageSummaries, ctx),
      );

      return assembleOutput(
        mistralResult.totalPages,
        mediaResult.mergedPages,
        mediaResult.parsedBlocks,
        summary,
        metadata,
        outlineResult.outline,
        outlineResult.chapters,
      );
    } finally {
      pdf.destroy();
      if (bucketName) {
        for (const blobPath of tempBlobPaths) {
          await deleteTempBlob(blobPath, bucketName).catch(() => {});
        }
      }
    }
  };
}
