import { Mistral } from "@mistralai/mistralai";
import mupdf from "mupdf";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pLimit from "p-limit";
import type { DetectedMedia, PageResult, EvalResult } from "./types.js";
import type { ChunkInfo } from "./pdf.js";

interface BboxAnnotation {
  type?: string;
  label?: string;
  description?: string;
  [key: string]: unknown;
}

function parseBboxAnnotation(raw: string | null | undefined): BboxAnnotation | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// TODO: Re-enable "mistral-ocr-latest" (currently mistral-ocr-2505) when stable.
// It has reliability issues: intermittent 500s, invalid PDF rejections, and timeouts.
// To enable: ["mistral-ocr-latest", "mistral-ocr-2503"] — latest tried first, 2503 as fallback.
const OCR_MODELS = ["mistral-ocr-2503"] as const;

const OCR_OPTIONS = {
  model: OCR_MODELS[0],
  includeImageBase64: false,
  tableFormat: "markdown" as const,
  extractHeader: true,
  extractFooter: true,
  bboxAnnotationFormat: {
    type: "json_schema" as const,
    jsonSchema: {
      name: "bbox_annotation",
      schemaDefinition: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description: "Type of the detected element",
            enum: ["image", "table", "figure", "chart", "formula", "diagram", "logo", "photo"],
          },
          description: {
            type: "string",
            description: "Brief description of the content",
          },
        },
        required: ["type", "description"],
        additionalProperties: false,
      },
    },
  },
};

/**
 * Flatten a PDF by rasterizing all pages to images.
 * Fixes PDFs with broken structure trees that Mistral rejects.
 */
function flattenPdf(inputPath: string): string {
  const buf = fs.readFileSync(inputPath);
  const srcDoc = mupdf.Document.openDocument(buf, "application/pdf");
  const outDoc = new mupdf.PDFDocument();

  try {
    for (let i = 0; i < srcDoc.countPages(); i++) {
      const page = srcDoc.loadPage(i);
      const [px0, py0, px1, py1] = page.getBounds();
      const pageW = px1 - px0;
      const pageH = py1 - py0;

      const pixmap = page.toPixmap(
        mupdf.Matrix.identity,
        mupdf.ColorSpace.DeviceRGB,
        false,
        false
      );
      const image = outDoc.addImage(new mupdf.Image(pixmap));

      const resDict = outDoc.newDictionary();
      const xObjDict = outDoc.newDictionary();
      xObjDict.put("Im0", image);
      resDict.put("XObject", xObjDict);

      const content = `q ${pageW} 0 0 ${pageH} ${px0} ${py0} cm /Im0 Do Q`;
      outDoc.insertPage(
        -1,
        outDoc.addPage([px0, py0, px1, py1], 0, resDict, content)
      );
      pixmap.destroy();
    }

    const outPath = path.join(
      os.tmpdir(),
      `flattened-${path.basename(inputPath)}`
    );
    const outBuf = outDoc.saveToBuffer("compress");
    fs.writeFileSync(outPath, outBuf.asUint8Array());
    console.log(`Flattened PDF: ${(outBuf.asUint8Array().length / 1024).toFixed(0)} KB → ${outPath}`);
    return outPath;
  } finally {
    outDoc.destroy();
    srcDoc.destroy();
  }
}

/**
 * Run OCR with model fallback and PDF flatten retry.
 * Tries each model in OCR_MODELS. If all models fail with an invalid PDF
 * error, flattens the PDF via rasterization and retries all models.
 */
async function runOcrWithFallbacks(
  client: Mistral,
  pdfPath: string,
  signedUrl: string,
): Promise<Awaited<ReturnType<typeof client.ocr.process>>> {
  const isInvalidPdfError = (err: unknown) => {
    const msg = (err as Error).message ?? "";
    return msg.includes("document_parser_invalid_file") || msg.includes("not a valid PDF");
  };

  // Try each model on the original PDF
  for (const model of OCR_MODELS) {
    try {
      return await client.ocr.process({
        ...OCR_OPTIONS,
        model,
        document: { type: "document_url", documentUrl: signedUrl },
      });
    } catch (err) {
      if (isInvalidPdfError(err)) {
        console.warn(`  Mistral OCR (${model}) rejected PDF as invalid, trying next model...`);
        continue;
      }
      // For non-invalid-PDF errors (500s, timeouts), try fallback model
      console.warn(`  Mistral OCR (${model}) failed: ${(err as Error).message?.slice(0, 100)}`);
      if (model !== OCR_MODELS[OCR_MODELS.length - 1]) continue;
      throw err;
    }
  }

  // All models failed on original PDF — flatten and retry
  console.warn("  All OCR models failed, flattening PDF and retrying...");
  const flatPath = flattenPdf(pdfPath);
  try {
    const flatContent = fs.readFileSync(flatPath);
    const flatBlob = new Blob([flatContent], { type: "application/pdf" });
    const flatUploaded = await client.files.upload({
      file: { fileName: "document.pdf", content: flatBlob },
      purpose: "ocr",
    });
    const flatSigned = await client.files.getSignedUrl({ fileId: flatUploaded.id });

    for (const model of OCR_MODELS) {
      try {
        return await client.ocr.process({
          ...OCR_OPTIONS,
          model,
          document: { type: "document_url", documentUrl: flatSigned.url },
        });
      } catch (err) {
        console.warn(`  Flattened OCR (${model}) failed: ${(err as Error).message?.slice(0, 100)}`);
        if (model === OCR_MODELS[OCR_MODELS.length - 1]) throw err;
      }
    }
  } finally {
    try { fs.unlinkSync(flatPath); } catch { /* ignore */ }
  }

  throw new Error("All Mistral OCR attempts exhausted");
}

/** Process a single PDF file through Mistral OCR and return page results. */
async function processOnePdf(
  client: Mistral,
  pdfPath: string,
  pageOffset: number
): Promise<PageResult[]> {
  const fileContent = fs.readFileSync(pdfPath);
  const blob = new Blob([fileContent], { type: "application/pdf" });

  const uploaded = await client.files.upload({
    file: { fileName: "document.pdf", content: blob },
    purpose: "ocr",
  });

  // Retry signed URL — Mistral can return 500 if the file isn't ready yet
  let signed!: Awaited<ReturnType<typeof client.files.getSignedUrl>>;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      signed = await client.files.getSignedUrl({ fileId: uploaded.id });
      break;
    } catch (err) {
      if (attempt < 2) {
        const delay = 2000 * (attempt + 1);
        console.warn(`  getSignedUrl failed (attempt ${attempt + 1}), retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }

  const ocrResponse = await runOcrWithFallbacks(client, pdfPath, signed.url);

  const pages: PageResult[] = [];

  for (const page of ocrResponse.pages) {
    const dims = page.dimensions;
    const images: DetectedMedia[] = [];
    const tables: DetectedMedia[] = [];

    for (const img of page.images) {
      let bounds: [number, number, number, number] | null = null;
      if (dims && img.topLeftX != null && img.topLeftY != null &&
          img.bottomRightX != null && img.bottomRightY != null) {
        bounds = [
          img.topLeftX / dims.width,
          img.topLeftY / dims.height,
          img.bottomRightX / dims.width,
          img.bottomRightY / dims.height,
        ];
      }

      const annotation = parseBboxAnnotation(img.imageAnnotation);
      const annotationType = (annotation?.type ?? "").toLowerCase();
      const isTable = annotationType === "table" || annotationType.includes("table");

      const media: DetectedMedia = {
        pageIndex: page.index + pageOffset,
        type: isTable ? "table" : "image",
        bounds,
        id: img.id,
        annotation: img.imageAnnotation ?? undefined,
      };

      if (isTable) tables.push(media);
      else images.push(media);
    }

    for (const tbl of page.tables ?? []) {
      if (!tables.some((t) => t.id === tbl.id)) {
        tables.push({
          pageIndex: page.index + pageOffset,
          type: "table",
          bounds: null,
          id: tbl.id,
          content: tbl.content,
        });
      }
    }

    pages.push({
      pageIndex: page.index + pageOffset,
      markdown: page.markdown,
      images,
      tables,
      dimensions: dims ? { width: dims.width, height: dims.height, dpi: dims.dpi } : null,
    });
  }

  return pages;
}

/**
 * Run Mistral OCR on a single PDF (no chunking).
 */
export async function runMistralOCR(
  pdfPath: string,
  apiKey: string
): Promise<EvalResult> {
  const client = new Mistral({ apiKey, timeoutMs: 600_000 });

  console.log("Uploading PDF to Mistral...");
  console.log("Running Mistral OCR...");
  const pages = await processOnePdf(client, pdfPath, 0);

  return buildEvalResult(pages);
}

/**
 * Run Mistral OCR with chunking for large PDFs.
 * Splits into chunks, processes in parallel, merges results.
 * Mirrors Python's mistral_parse_chunked().
 */
export async function runMistralOCRChunked(
  chunks: ChunkInfo[],
  apiKey: string,
  concurrency = 3
): Promise<EvalResult> {
  const client = new Mistral({ apiKey, timeoutMs: 600_000 });
  const limit = pLimit(concurrency);

  console.log(`Running Mistral OCR on ${chunks.length} chunk(s) (concurrency=${concurrency})...`);

  const tasks = chunks.map((chunk) =>
    limit(async () => {
      // Retry per chunk with exponential backoff
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          console.log(`  Mistral chunk: pages ${chunk.startPage + 1}-${chunk.endPage + 1}...`);
          return await processOnePdf(client, chunk.path, chunk.startPage);
        } catch (err) {
          if (attempt < 2) {
            const is503 = (err as Error).message?.includes("503");
            const delay = is503 ? 15000 * (attempt + 1) : Math.pow(2, attempt) * 5000;
            console.warn(`  Mistral chunk ${chunk.startPage + 1}-${chunk.endPage + 1} failed (attempt ${attempt + 1}), retrying in ${delay / 1000}s...`);
            await new Promise((r) => setTimeout(r, delay));
          } else {
            throw err;
          }
        }
      }
      return []; // unreachable
    })
  );

  const chunkResults = await Promise.all(tasks);
  const allPages = chunkResults.flat();
  allPages.sort((a, b) => a.pageIndex - b.pageIndex);

  return buildEvalResult(allPages);
}

function buildEvalResult(pages: PageResult[]): EvalResult {
  const totalImages = pages.reduce((sum, p) => sum + p.images.length, 0);
  const totalTables = pages.reduce((sum, p) => sum + p.tables.length, 0);

  return {
    totalPages: pages.length,
    pages,
    summary: {
      totalImages,
      totalTables,
      pagesWithMedia: pages.filter((p) => p.images.length > 0 || p.tables.length > 0).length,
      pagesWithTables: pages.filter((p) => p.tables.length > 0).length,
      pagesWithImages: pages.filter((p) => p.images.length > 0).length,
    },
  };
}
