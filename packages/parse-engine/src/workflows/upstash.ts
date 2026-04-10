/**
 * Upstash Workflow adapter.
 */
import { PipelineContext } from "../context.js";
import { PdfDocument } from "../pdf.js";
import { fileHash } from "../persistence.js";
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
import type { ParsedDocument } from "../types.js";
import type { PersistenceProvider } from "../persistence.js";

export interface UpstashWorkflowConfig {
  persistence: PersistenceProvider;
  pdfPath: string;
  useTextract?: boolean;
  concurrency?: number;
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

    try {
      const mistralResult = await context.run("mistral-ocr", () => mistralStep(config.pdfPath, pdf, ctx));
      const allMedia = mistralResult.pages.flatMap((p) => [...p.images, ...p.tables]);

      const mediaResult = await context.run("media-pipeline", () =>
        mediaStep(pdf, mistralResult, allMedia, ctx, { concurrency: config.concurrency ?? 20, useTextract: config.useTextract ?? false, baseName })
      );

      const summary = await context.run("summary", () => summaryStep(pdf, ctx));

      const mergedPages = placeMediaBlocks(mistralResult.pages, mediaResult.parsedBlocks);

      const clusterResult = await context.run("cluster-parsing", () => generatePageSummaries(mergedPages, ctx));

      const outlineResult = await context.run("outline", () =>
        outlineStep(clusterResult.pageSummaries, summary?.title ?? baseName, summary?.shortSummary ?? "", ctx, { pdfPath: config.pdfPath })
      );

      const metadata = await context.run("metadata", () => metadataStep(clusterResult.pageSummaries, ctx));

      return assembleOutput(mistralResult.totalPages, mediaResult.mergedPages, mediaResult.parsedBlocks, summary, metadata, outlineResult.outline, outlineResult.chapters);
    } finally {
      pdf.destroy();
    }
  };
}
