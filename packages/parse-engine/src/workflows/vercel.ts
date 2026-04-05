/**
 * Vercel Workflow adapter.
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

export interface VercelWorkflowConfig {
  persistence: PersistenceProvider;
  pdfPath: string;
  useTextract?: boolean;
  concurrency?: number;
}

export async function parsePdfWorkflow(config: VercelWorkflowConfig): Promise<ParsedDocument> {
  'use workflow';

  const pdf = new PdfDocument(config.pdfPath);
  const ctx = new PipelineContext({
    persistence: config.persistence,
    models: getModelConfig(),
    documentHash: fileHash(config.pdfPath),
  });
  const baseName = config.pdfPath.split("/").pop()?.replace(".pdf", "") ?? "doc";

  try {
    const mistralResult = await (async () => { 'use step'; return mistralStep(config.pdfPath, pdf, ctx); })();
    const allMedia = mistralResult.pages.flatMap((p) => [...p.images, ...p.tables]);

    const [mediaResult, summary] = await Promise.all([
      (async () => { 'use step'; return mediaStep(pdf, mistralResult, allMedia, ctx, { concurrency: config.concurrency ?? 20, useTextract: config.useTextract ?? true, baseName }); })(),
      (async () => { 'use step'; return summaryStep(pdf, ctx); })(),
    ]);

    const mergedPages = placeMediaBlocks(mistralResult.pages, mediaResult.parsedBlocks);
    const clusterResult = await (async () => { 'use step'; return generatePageSummaries(mergedPages, ctx); })();

    const [outlineResult, metadata] = await Promise.all([
      (async () => { 'use step'; return outlineStep(clusterResult.pageSummaries, summary?.title ?? baseName, summary?.shortSummary ?? "", ctx, { pdfPath: config.pdfPath }); })(),
      (async () => { 'use step'; return metadataStep(clusterResult.pageSummaries, ctx); })(),
    ]);

    return assembleOutput(mistralResult.totalPages, mediaResult.mergedPages, mediaResult.parsedBlocks, summary, metadata, outlineResult.outline, outlineResult.chapters);
  } finally {
    pdf.destroy();
  }
}
