/**
 * Callable document parsing pipeline.
 *
 * Usage:
 *   import { parsePdf, LocalPersistence } from "parse-engine";
 *
 *   const result = await parsePdf("/path/to/doc.pdf", {
 *     persistence: new LocalPersistence(".cache"),
 *   });
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { env } from "./env.js";
import { uploadAndGetSignedUrl, deleteTempBlob } from "./storage.js";
import { runPaddleOCR, runPaddleOCRChunked } from "./paddle.js";
import { runMistralOCR, runMistralOCRChunked } from "./mistral.js";
import { maskPdf, mediasToMaskBlocks } from "./mask.js";
import { PdfDocument, cleanupChunks, type ChunkInfo } from "./pdf.js";
import { PipelineContext } from "./context.js";
import { LocalPersistence, fileHash } from "./persistence.js";
import type { PersistenceProvider } from "./persistence.js";
import { parseMediaBlocks } from "./services/media.js";
import { placeMediaBlocks } from "./services/placement.js";
import { getBasicSummary } from "./services/summary.js";
import { generatePageSummaries } from "./services/cluster.js";
import { generateOutlineWithChapters } from "./services/outline.js";
import { extractDocumentMetadata } from "./services/metadata.js";
import { getModelConfig, type ModelConfig } from "./models.js";
import type { DetectedMedia, MediaBlock, ParsedDocument } from "./types.js";

const CHUNK_SIZE = 100;

export interface PipelineOptions {
  /** Persistence provider for caching. Defaults to LocalPersistence in a temp dir. */
  persistence?: PersistenceProvider;
  /** Model tier configuration. Defaults to env vars or built-in defaults. */
  models?: ModelConfig;
  /** Enable PaddleOCR for media detection. */
  paddle?: boolean;
  /** GCS bucket name (required for paddle). */
  bucket?: string;
  /** Modal endpoint URL (required for paddle). */
  modalUrl?: string;
  /** Mask PDF after paddle detection. Default: true. */
  mask?: boolean;
  /** Use Textract for tables. Default: true. */
  textract?: boolean;
  /** Max concurrent media parsing tasks. Default: 20. */
  concurrency?: number;
  /** Max pages to process. */
  maxPages?: number;
  /** Skip media parsing (steps 4-6). */
  skipMediaParse?: boolean;
  /** Working directory for temp files. Default: OS temp dir. */
  workDir?: string;
  /** Log progress to console. Default: false. */
  verbose?: boolean;
}

function log(verbose: boolean, ...args: any[]) {
  if (verbose) console.log(...args);
}

/**
 * Parse a PDF document and return structured output.
 */
export async function parsePdf(
  pdfPath: string,
  options: PipelineOptions = {},
): Promise<ParsedDocument> {
  const resolvedPdf = path.resolve(pdfPath);
  if (!fs.existsSync(resolvedPdf)) {
    throw new Error(`File not found: ${resolvedPdf}`);
  }

  const {
    paddle = false,
    mask = true,
    textract = true,
    concurrency = 20,
    maxPages,
    skipMediaParse = false,
    verbose = false,
  } = options;

  const models = options.models ?? getModelConfig();
  const workDir = options.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "parse-engine-"));
  fs.mkdirSync(workDir, { recursive: true });

  const persistence = options.persistence ?? new LocalPersistence(path.join(workDir, ".cache"));
  const modalEndpoint = options.modalUrl ?? env.modalEndpointUrl;
  const bucketName = options.bucket ?? env.gcsBucket;

  const baseName = path.basename(resolvedPdf, ".pdf");
  const pdf = new PdfDocument(resolvedPdf);
  let chunks: ChunkInfo[] = [];
  const tempBlobPaths: string[] = [];

  try {
    let allMedia: DetectedMedia[] = [];
    let paddleTables: DetectedMedia[] = [];
    const ctx = new PipelineContext({
      persistence,
      models,
      documentHash: fileHash(resolvedPdf),
    });
    let pdfForMistral = resolvedPdf;
    const needsChunking = pdf.pageCount > CHUNK_SIZE;

    if (needsChunking) {
      log(verbose, `Large PDF (${pdf.pageCount} pages), chunking...`);
      chunks = pdf.chunk(CHUNK_SIZE, path.join(workDir, "chunks"));
    }

    // Step 1: PaddleOCR detection (tables only — images come from Mistral)
    if (paddle) {
      if (!modalEndpoint) throw new Error("PaddleOCR requires modalUrl or MODAL_ENDPOINT_URL env");
      if (!bucketName) throw new Error("PaddleOCR requires bucket or GOOGLE_STORAGE_BUCKET env");

      log(verbose, "PaddleOCR → detecting table blocks...");
      let paddlePages;
      if (needsChunking) {
        const chunkUrls = [];
        for (const chunk of chunks) {
          const upload = await uploadAndGetSignedUrl(chunk.path, bucketName);
          tempBlobPaths.push(upload.blobPath);
          chunkUrls.push({ signedUrl: upload.signedUrl, chunk });
        }
        paddlePages = await runPaddleOCRChunked(chunkUrls, modalEndpoint);
      } else {
        const upload = await uploadAndGetSignedUrl(resolvedPdf, bucketName);
        tempBlobPaths.push(upload.blobPath);
        paddlePages = await runPaddleOCR(upload.signedUrl, modalEndpoint, maxPages);
      }
      paddleTables = paddlePages.flatMap((p) => p.tables);
      log(verbose, `  Found ${paddleTables.length} tables (images will come from Mistral)`);

      // Step 2: Mask only tables so Mistral doesn't double-parse them
      if (mask && paddleTables.length > 0) {
        log(verbose, "Masking table blocks...");
        const maskBlocks = mediasToMaskBlocks([], paddleTables);
        pdfForMistral = path.join(workDir, `${baseName}_masked.pdf`);
        maskPdf(resolvedPdf, maskBlocks, pdfForMistral);
      }
    }

    // Step 3: Mistral OCR
    log(verbose, "Mistral OCR → parsing pages...");
    let mistralResult;
    if (needsChunking) {
      const mistralPdf = new PdfDocument(pdfForMistral);
      const mistralChunks = pdfForMistral === resolvedPdf
        ? chunks
        : mistralPdf.chunk(CHUNK_SIZE, path.join(workDir, "mistral_chunks"));
      mistralPdf.destroy();
      mistralResult = await runMistralOCRChunked(mistralChunks, env.mistralApiKey!);
      if (pdfForMistral !== resolvedPdf) cleanupChunks(mistralChunks);
    } else {
      mistralResult = await runMistralOCR(pdfForMistral, env.mistralApiKey!);
    }
    log(verbose, `  ${mistralResult.totalPages} pages parsed`);

    if (paddle) {
      // Tables from Paddle, images from Mistral
      const mistralImages = mistralResult.pages.flatMap((p) => p.images);
      allMedia = [...paddleTables, ...mistralImages];
      log(verbose, `  Combined: ${paddleTables.length} paddle tables + ${mistralImages.length} mistral images`);
    } else {
      // No paddle — everything from Mistral
      allMedia = mistralResult.pages.flatMap((p) => [...p.images, ...p.tables]);
    }

    const mediaWithBounds = allMedia.filter((m) => m.bounds != null);

    // Early return if skipping media parse
    if (skipMediaParse) {
      return {
        totalPages: mistralResult.totalPages,
        pages: mistralResult.pages.map((p) => ({
          pageNumber: p.pageIndex,
          content: p.markdown,
        })),
        mediaBlocks: [],
        usage: ctx.usage.getReport(),
      };
    }

    // Steps 4-5: Extract + parse media
    log(verbose, `Extracting ${mediaWithBounds.length} media regions...`);
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
          cacheKey: `${baseName}_${m.pageIndex}_${i}`,
        });
      } catch {
        // Skip blocks that fail to extract
      }
    }

    log(verbose, `Parsing media + extracting summary...`);
    const [parsedBlocks, summary] = await Promise.all([
      parseMediaBlocks(mediaBlocks, ctx, { concurrency, useTextract: textract }),
      getBasicSummary(pdf, ctx).catch(() => undefined),
    ]);

    // Step 6: Merge
    const mergedPages = placeMediaBlocks(mistralResult.pages, parsedBlocks);

    // Step 7.5: Cluster parsing
    log(verbose, `Generating page summaries...`);
    const clusterResult = await generatePageSummaries(mergedPages, ctx);

    // Steps 8+9: Outline + metadata in parallel
    log(verbose, `Detecting chapters + extracting metadata...`);
    let chapters: ParsedDocument["chapters"];
    let outline: ParsedDocument["outline"];
    let metadata: ParsedDocument["metadata"];

    const [outlineResult, metadataResult] = await Promise.allSettled([
      generateOutlineWithChapters(
        clusterResult.pageSummaries,
        summary?.title ?? baseName,
        summary?.shortSummary ?? "",
        ctx,
        { pdfPath: resolvedPdf },
      ),
      extractDocumentMetadata(clusterResult.pageSummaries, ctx),
    ]);

    if (outlineResult.status === "fulfilled") {
      chapters = outlineResult.value.chapters;
      outline = chapters.flatMap((ch) => ch.sections);
    }
    if (metadataResult.status === "fulfilled") {
      metadata = metadataResult.value;
    }

    if (verbose) ctx.usage.printSummary();

    return {
      totalPages: mistralResult.totalPages,
      pages: mergedPages,
      mediaBlocks: parsedBlocks,
      summary,
      metadata,
      outline,
      chapters,
      pageSummaries: clusterResult.pageSummaries,
      usage: ctx.usage.getReport(),
    };
  } finally {
    pdf.destroy();
    cleanupChunks(chunks);
    for (const blobPath of tempBlobPaths) {
      if (bucketName) await deleteTempBlob(blobPath, bucketName);
    }
  }
}

/**
 * Parse a PDF from an in-memory buffer.
 * Writes to a temp file, delegates to parsePdf, then cleans up.
 */
export async function parsePdfFromBuffer(
  buffer: Buffer,
  options: PipelineOptions = {},
): Promise<ParsedDocument> {
  const workDir = options.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "parse-engine-buf-"));
  const tempPath = path.join(workDir, "document.pdf");
  fs.writeFileSync(tempPath, buffer);

  try {
    return await parsePdf(tempPath, { ...options, workDir });
  } finally {
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
  }
}
