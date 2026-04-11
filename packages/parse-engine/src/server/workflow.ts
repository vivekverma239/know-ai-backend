import { serve } from "@upstash/workflow/hono";
import { PipelineContext } from "../context.js";
import { PdfDocument } from "../pdf.js";
import { fileHash, LocalPersistence } from "../persistence.js";
import { getModelConfig } from "../models.js";
import { generatePageSummaries } from "../services/cluster.js";
import { placeMediaBlocks } from "../services/placement.js";
import { uploadAndGetSignedUrl, deleteTempBlob } from "../storage.js";
import { runPaddleOCR } from "../paddle.js";
import { maskPdf, mediasToMaskBlocks } from "../mask.js";
import { runMistralOCR } from "../mistral.js";
import { env } from "../env.js";
import {
  mediaStep,
  summaryStep,
  outlineStep,
  metadataStep,
  assembleOutput,
} from "../steps.js";
import type { DetectedMedia, EvalResult } from "../types.js";
import {
  downloadJobPdf,
  writeJobResult,
  writeJobError,
} from "./job-storage.js";
import fs from "node:fs";
import path from "node:path";

interface WorkflowPayload {
  jobId: string;
  useTextract: boolean;
  usePaddle: boolean;
}

const workflowUrl = `${process.env.APP_URL}/workflow`;

export const workflowHandler = serve<WorkflowPayload>(
  async (context) => {
    const { jobId, useTextract, usePaddle } = context.requestPayload;

    // Use deterministic path — Upstash replays the function on each step,
    // so mkdtemp would create a different dir each time.
    const tempDir = `/tmp/parse-job-${jobId}`;
    const pdfPath = path.join(tempDir, "document.pdf");

    // Download PDF OUTSIDE context.run — it must be on disk for every
    // replay since PdfDocument reads it on construction.
    if (!fs.existsSync(pdfPath)) {
      fs.mkdirSync(tempDir, { recursive: true });
      const buffer = await downloadJobPdf(jobId);
      fs.writeFileSync(pdfPath, buffer);
    }

    const pdf = new PdfDocument(pdfPath);
    const ctx = new PipelineContext({
      persistence: new LocalPersistence(path.join(tempDir, ".cache")),
      models: getModelConfig(),
      documentHash: fileHash(pdfPath),
    });
    const baseName = `job-${jobId}`;
    const tempBlobPaths: string[] = [];

    let allMedia: DetectedMedia[] = [];
    let mistralResult: EvalResult;

    if (usePaddle && env.modalEndpointUrl && env.gcsBucket) {
      // Step 1: PaddleOCR — detect tables with precise bounding boxes
      const paddleTables = await context.run("paddle-ocr", async () => {
        const upload = await uploadAndGetSignedUrl(pdfPath, env.gcsBucket!);
        tempBlobPaths.push(upload.blobPath);
        const paddlePages = await runPaddleOCR(upload.signedUrl, env.modalEndpointUrl!);
        return paddlePages.flatMap((p) => p.tables);
      });

      // Step 2: Mask only tables so Mistral doesn't double-parse them
      let pdfForMistral = pdfPath;
      if (paddleTables.length > 0) {
        const maskedPath = path.join(tempDir, "masked.pdf");
        // Mask runs outside context.run — needs file on disk every replay
        if (!fs.existsSync(maskedPath)) {
          const maskBlocks = mediasToMaskBlocks([], paddleTables);
          await maskPdf(pdfPath, maskBlocks, maskedPath);
        }
        pdfForMistral = maskedPath;
      }

      // Step 3: Mistral OCR on masked PDF
      mistralResult = await context.run("mistral-ocr", () =>
        runMistralOCR(pdfForMistral, env.mistralApiKey!)
      );

      // Combine: tables from Paddle, images from Mistral
      const mistralImages = mistralResult.pages.flatMap((p) => p.images);
      allMedia = [...paddleTables, ...mistralImages];
    } else {
      // No Paddle — everything from Mistral
      mistralResult = await context.run("mistral-ocr", () =>
        runMistralOCR(pdfPath, env.mistralApiKey!)
      );
      allMedia = mistralResult.pages.flatMap((p) => [...p.images, ...p.tables]);
    }

    const mediaResult = await context.run("media-pipeline", () =>
      mediaStep(pdf, mistralResult, allMedia, ctx, {
        concurrency: 20,
        useTextract,
        baseName,
      })
    );

    const summary = await context.run("summary", () =>
      summaryStep(pdf, ctx)
    );

    const mergedPages = placeMediaBlocks(
      mistralResult.pages,
      mediaResult.parsedBlocks
    );

    const clusterResult = await context.run("cluster-parsing", () =>
      generatePageSummaries(mergedPages, ctx)
    );

    const outlineResult = await context.run("outline", () =>
      outlineStep(
        clusterResult.pageSummaries,
        summary?.title ?? baseName,
        summary?.shortSummary ?? "",
        ctx,
        { pdfPath }
      )
    );

    const metadata = await context.run("metadata", () =>
      metadataStep(clusterResult.pageSummaries, ctx)
    );

    const result = assembleOutput(
      mistralResult.totalPages,
      mediaResult.mergedPages,
      mediaResult.parsedBlocks,
      summary,
      metadata,
      outlineResult.outline,
      outlineResult.chapters
    );

    const fullResult = {
      ...result,
      pageSummaries: clusterResult.pageSummaries,
      usage: ctx.usage.getReport(),
    };

    await context.run("save-result", () =>
      writeJobResult(jobId, fullResult)
    );

    // Cleanup
    pdf.destroy();
    for (const blobPath of tempBlobPaths) {
      if (env.gcsBucket) await deleteTempBlob(blobPath, env.gcsBucket);
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  },
  {
    url: workflowUrl,
    failureFunction: async ({ context, failStatus, failResponse }) => {
      const { jobId } = context.requestPayload as WorkflowPayload;
      await writeJobError(
        jobId,
        `Workflow failed: ${failStatus} — ${failResponse}`
      );
    },
  }
);
