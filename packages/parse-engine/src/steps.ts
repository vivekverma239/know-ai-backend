/**
 * Pipeline steps — discrete, cacheable, resumable units of work.
 *
 * Each step is independently callable, idempotent (via ctx.cached),
 * and can be orchestrated by any runtime (CLI, Vercel Workflow, Upstash).
 */
import type { PipelineContext } from "./context.js";
import type { PdfDocument } from "./pdf.js";
import type { DetectedMedia, MediaBlock, ParsedMediaBlock, ParsedPage, ParsedDocument, DocumentSummary, DocumentMetadata, Section, ChapterWithSections } from "./types.js";
import type { EvalResult } from "./types.js";

import { runMistralOCR, runMistralOCRChunked } from "./mistral.js";
import { runPaddleOCR, runPaddleOCRChunked } from "./paddle.js";
import { maskPdf, mediasToMaskBlocks } from "./mask.js";
import { parseMediaBlocks } from "./services/media.js";
import { placeMediaBlocks } from "./services/placement.js";
import { getBasicSummary } from "./services/summary.js";
import { generateOutlineWithChapters } from "./services/outline.js";
import { extractDocumentMetadata } from "./services/metadata.js";
import { env } from "./env.js";

const CHUNK_SIZE = 100;

// ---- Step results ----

export interface MediaStepResult {
  parsedBlocks: ParsedMediaBlock[];
  mergedPages: ParsedPage[];
}

export interface OutlineStepResult {
  chapters: ChapterWithSections[];
  outline: Section[];
}

// ---- Steps ----

/** Step 1+2: PaddleOCR detection + optional masking */
export async function paddleMaskStep(
  pdf: PdfDocument,
  ctx: PipelineContext,
  opts: {
    modalEndpoint: string;
    bucketName: string;
    mask: boolean;
    maskedPdfPath: string;
    uploadFn: (chunkPath: string, bucket: string) => Promise<{ signedUrl: string; blobPath: string }>;
  }
): Promise<{ allMedia: DetectedMedia[]; pdfForMistral: string; tempBlobPaths: string[] }> {
  const tempBlobPaths: string[] = [];
  const needsChunking = pdf.pageCount > CHUNK_SIZE;
  let paddlePages;

  if (needsChunking) {
    const chunks = pdf.chunk(CHUNK_SIZE);
    const chunkUrls = [];
    for (const chunk of chunks) {
      const upload = await opts.uploadFn(chunk.path, opts.bucketName);
      tempBlobPaths.push(upload.blobPath);
      chunkUrls.push({ signedUrl: upload.signedUrl, chunk });
    }
    paddlePages = await runPaddleOCRChunked(chunkUrls, opts.modalEndpoint);
  } else {
    const upload = await opts.uploadFn(pdf.filePath, opts.bucketName);
    tempBlobPaths.push(upload.blobPath);
    paddlePages = await runPaddleOCR(upload.signedUrl, opts.modalEndpoint);
  }

  const allMedia = paddlePages.flatMap((p) => [...p.images, ...p.tables]);
  let pdfForMistral = pdf.filePath;

  if (opts.mask && allMedia.length > 0) {
    const maskBlocks = mediasToMaskBlocks(
      allMedia.filter((m) => m.type === "image"),
      allMedia.filter((m) => m.type === "table")
    );
    maskPdf(pdf.filePath, maskBlocks, opts.maskedPdfPath);
    pdfForMistral = opts.maskedPdfPath;
  }

  return { allMedia, pdfForMistral, tempBlobPaths };
}

/** Step 3: Mistral OCR (auto-chunks for large PDFs, cached) */
export async function mistralStep(
  pdfPath: string,
  pdf: PdfDocument,
  ctx: PipelineContext
): Promise<EvalResult> {
  const cacheKey = ctx.key("mistral_ocr");

  return ctx.cached(cacheKey, async () => {
    if (pdf.pageCount > CHUNK_SIZE) {
      const chunks = pdf.chunk(CHUNK_SIZE);
      return runMistralOCRChunked(chunks, env.mistralApiKey!);
    }
    return runMistralOCR(pdfPath, env.mistralApiKey!);
  }, "Mistral OCR");
}

/** Steps 4-6: Extract media → parse → merge */
export async function mediaStep(
  pdf: PdfDocument,
  mistralResult: EvalResult,
  allMedia: DetectedMedia[],
  ctx: PipelineContext,
  opts: { concurrency: number; useTextract: boolean; baseName: string }
): Promise<MediaStepResult> {
  const cacheKey = ctx.key("media_step");
  const cached = await ctx.persistence.get(cacheKey);
  if (cached) {
    console.log("  Media step: cache hit");
    return JSON.parse(cached);
  }

  const mediaWithBounds = allMedia.filter((m) => m.bounds != null);
  const mediaBlocks: MediaBlock[] = [];
  const pageRenderCache = new Map<number, Buffer>();

  for (let i = 0; i < mediaWithBounds.length; i++) {
    const m = mediaWithBounds[i];
    try {
      const blockBytes = pdf.extractRegion(m.pageIndex, m.bounds!);
      let pageBytes = pageRenderCache.get(m.pageIndex);
      if (!pageBytes) {
        pageBytes = pdf.renderPage(m.pageIndex);
        pageRenderCache.set(m.pageIndex, pageBytes);
      }
      mediaBlocks.push({
        idx: i, page: m.pageIndex, type: m.type,
        originalLabel: m.annotation ?? m.type,
        bounds: m.bounds!, blockBytes, pageBytes,
        cacheKey: `${opts.baseName}_${m.pageIndex}_${i}`,
        sourceId: m.id,
      });
    } catch (err) {
      console.warn(`  Failed to extract block ${i}: ${err}`);
    }
  }

  const parsedBlocks = await parseMediaBlocks(mediaBlocks, ctx, {
    concurrency: opts.concurrency,
    useTextract: opts.useTextract,
  });

  const mergedPages = placeMediaBlocks(mistralResult.pages, parsedBlocks);
  const result = { parsedBlocks, mergedPages };

  await ctx.persistence.set(cacheKey, JSON.stringify(result), ctx.cacheTtl);
  return result;
}

/** Step 7: Basic summary */
export async function summaryStep(
  pdf: PdfDocument,
  ctx: PipelineContext
): Promise<DocumentSummary | undefined> {
  try {
    return await getBasicSummary(pdf, ctx);
  } catch (err) {
    console.error("  Summary failed:", (err as Error).message);
    return undefined;
  }
}

/** Step 8: Chapters + outline (from page summaries) */
export async function outlineStep(
  pageSummaries: import("./services/cluster.js").PageSummary[],
  title: string,
  summary: string,
  ctx: PipelineContext,
  opts: { pdfPath?: string } = {}
): Promise<OutlineStepResult> {
  const result = await generateOutlineWithChapters(
    pageSummaries, title, summary, ctx, opts
  );
  return {
    chapters: result.chapters,
    outline: result.chapters.flatMap((ch) => ch.sections),
  };
}

/** Step 9: Metadata (from page summaries) */
export async function metadataStep(
  pageSummaries: import("./services/cluster.js").PageSummary[],
  ctx: PipelineContext
): Promise<DocumentMetadata | undefined> {
  try {
    return await extractDocumentMetadata(pageSummaries, ctx);
  } catch (err) {
    console.error("  Metadata failed:", (err as Error).message);
    return undefined;
  }
}

/** Final: Assemble output */
export function assembleOutput(
  totalPages: number,
  mergedPages: ParsedPage[],
  parsedBlocks: ParsedMediaBlock[],
  summary?: DocumentSummary,
  metadata?: DocumentMetadata,
  outline?: Section[],
  chapters?: ChapterWithSections[]
): ParsedDocument {
  return { totalPages, pages: mergedPages, mediaBlocks: parsedBlocks, summary, metadata, outline, chapters };
}
