import pLimit from "p-limit";
import type { DetectedMedia, PageResult } from "./types.js";
import type { ChunkInfo } from "./pdf.js";

interface PaddleBox {
  label: string;
  coordinates: [number, number, number, number];
}

interface PaddlePage {
  page_number: number;
  boxes: PaddleBox[];
}

interface PaddleResult {
  success: boolean;
  pages: PaddlePage[];
  total_pages: number;
  message: string;
  metadata: Record<string, unknown>;
  label_mapping: Record<string, string>;
}

const MEDIA_LABELS = new Set(["table", "image", "figure", "picture", "formula"]);

function labelToMediaType(label: string): "image" | "table" {
  return label === "table" ? "table" : "image";
}

function parsePaddleResult(result: PaddleResult, pageOffset: number): PageResult[] {
  return result.pages.map((page) => {
    const allMedia: DetectedMedia[] = page.boxes
      .filter((box) => MEDIA_LABELS.has(box.label))
      .map((box, idx) => ({
        pageIndex: page.page_number + pageOffset,
        type: labelToMediaType(box.label),
        bounds: box.coordinates,
        id: `paddle_${page.page_number + pageOffset}_${idx}`,
        annotation: box.label,
      }));

    return {
      pageIndex: page.page_number + pageOffset,
      markdown: "",
      images: allMedia.filter((m) => m.type === "image"),
      tables: allMedia.filter((m) => m.type === "table"),
      dimensions: null,
    };
  });
}

/** Process a single PDF URL through PaddleOCR */
async function processOnePdf(
  pdfUrl: string,
  endpointUrl: string,
  pageOffset: number
): Promise<PageResult[]> {
  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdf_url: pdfUrl, batch_size: 2, max_pages: null }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Modal endpoint returned ${response.status}: ${text}`);
  }

  const result: PaddleResult = await response.json();
  if (!result.success) throw new Error(`PaddleOCR failed: ${result.message}`);

  return parsePaddleResult(result, pageOffset);
}

/**
 * Run PaddleOCR on a single PDF URL.
 */
export async function runPaddleOCR(
  pdfUrl: string,
  endpointUrl: string,
  maxPages?: number
): Promise<PageResult[]> {
  console.log("Running PaddleOCR via Modal web endpoint...");
  const pages = await processOnePdf(pdfUrl, endpointUrl, 0);
  console.log(`PaddleOCR processed ${pages.length} pages.`);
  return maxPages ? pages.slice(0, maxPages) : pages;
}

/**
 * Run PaddleOCR with chunking for large PDFs.
 * Each chunk is uploaded to GCS separately, processed in parallel.
 *
 * @param chunkUrls - Array of { signedUrl, chunk } for each chunk
 * @param endpointUrl - Modal web endpoint URL
 * @param concurrency - Max parallel chunk processing
 */
export async function runPaddleOCRChunked(
  chunkUrls: Array<{ signedUrl: string; chunk: ChunkInfo }>,
  endpointUrl: string,
  concurrency = 3
): Promise<PageResult[]> {
  const limit = pLimit(concurrency);

  console.log(`Running PaddleOCR on ${chunkUrls.length} chunk(s) (concurrency=${concurrency})...`);

  const tasks = chunkUrls.map(({ signedUrl, chunk }) =>
    limit(async () => {
      console.log(`  PaddleOCR chunk: pages ${chunk.startPage + 1}-${chunk.endPage + 1}...`);
      return processOnePdf(signedUrl, endpointUrl, chunk.startPage);
    })
  );

  const chunkResults = await Promise.all(tasks);
  const allPages = chunkResults.flat();
  allPages.sort((a, b) => a.pageIndex - b.pageIndex);

  console.log(`PaddleOCR processed ${allPages.length} pages total.`);
  return allPages;
}
