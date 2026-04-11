import { Mistral } from "@mistralai/mistralai";
import fs from "node:fs";
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

const OCR_OPTIONS = {
  model: "mistral-ocr-latest" as const,
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

  const signed = await client.files.getSignedUrl({ fileId: uploaded.id });

  const ocrResponse = await client.ocr.process({
    ...OCR_OPTIONS,
    document: { type: "document_url", documentUrl: signed.url },
  });

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
