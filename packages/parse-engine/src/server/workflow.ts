import { serve } from "@upstash/workflow/hono";
import { PipelineContext } from "../context.js";
import { PdfDocument } from "../pdf.js";
import { fileHash, LocalPersistence } from "../persistence.js";
import { getModelConfig } from "../models.js";
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
import {
  downloadJobPdf,
  writeJobResult,
  writeJobError,
} from "./job-storage.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface WorkflowPayload {
  jobId: string;
  useTextract: boolean;
  usePaddle: boolean;
}

export const workflowHandler = serve<WorkflowPayload>(
  async (context) => {
    const { jobId, useTextract, usePaddle } = context.requestPayload;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `parse-job-${jobId}-`));
    const pdfPath = path.join(tempDir, "document.pdf");

    try {
      // Download PDF from GCS to local disk
      await context.run("download-pdf", async () => {
        const buffer = await downloadJobPdf(jobId);
        fs.writeFileSync(pdfPath, buffer);
      });

      const pdf = new PdfDocument(pdfPath);
      const ctx = new PipelineContext({
        persistence: new LocalPersistence(path.join(tempDir, ".cache")),
        models: getModelConfig(),
        documentHash: fileHash(pdfPath),
      });
      const baseName = `job-${jobId}`;

      try {
        const mistralResult = await context.run("mistral-ocr", () =>
          mistralStep(pdfPath, pdf, ctx)
        );

        const allMedia = mistralResult.pages.flatMap((p) => [
          ...p.images,
          ...p.tables,
        ]);

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

        // Add usage and page summaries
        const fullResult = {
          ...result,
          pageSummaries: clusterResult.pageSummaries,
          usage: ctx.usage.getReport(),
        };

        await context.run("save-result", () =>
          writeJobResult(jobId, fullResult)
        );
      } finally {
        pdf.destroy();
      }
    } catch (err) {
      await context.run("save-error", () =>
        writeJobError(jobId, err instanceof Error ? err.message : String(err))
      );
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  },
  {
    failureFunction: async ({ context, failStatus, failResponse }) => {
      try {
        const { jobId } = context.requestPayload as WorkflowPayload;
        await writeJobError(
          jobId,
          `Workflow failed: ${failStatus} — ${failResponse}`
        );
      } catch { /* best effort */ }
    },
  }
);
