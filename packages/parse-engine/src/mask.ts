import mupdf from "mupdf";
import fs from "node:fs";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { DetectedMedia } from "./types.js";

interface MaskBlock {
  pageIndex: number;
  /** Normalized bounds [0-1]: [x1, y1, x2, y2] (top-left origin) */
  bounds: [number, number, number, number];
  label: string;
}

/**
 * Mask media blocks in a PDF by drawing white rectangles with placeholder
 * text over the detected regions. Uses pdf-lib to modify the original PDF
 * directly, preserving structure and producing Mistral-compatible output.
 */
export async function maskPdf(
  inputPath: string,
  blocks: MaskBlock[],
  outputPath: string,
): Promise<void> {
  const buf = fs.readFileSync(inputPath);
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  // Group blocks by page
  const blocksByPage = new Map<number, MaskBlock[]>();
  for (const block of blocks) {
    const list = blocksByPage.get(block.pageIndex) ?? [];
    list.push(block);
    blocksByPage.set(block.pageIndex, list);
  }

  for (const [pageIdx, pageBlocks] of blocksByPage) {
    const page = pages[pageIdx];
    if (!page) continue;

    const { width, height } = page.getSize();

    for (const block of pageBlocks) {
      const [nx0, ny0, nx1, ny1] = block.bounds;

      // Convert normalized coords to PDF coords (PDF origin is bottom-left)
      const x = nx0 * width;
      const y = (1 - ny1) * height;
      const w = (nx1 - nx0) * width;
      const h = (ny1 - ny0) * height;

      // White filled rectangle
      page.drawRectangle({
        x, y, width: w, height: h,
        color: rgb(1, 1, 1),
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });

      // Placeholder text
      const fontSize = 7;
      page.drawText(block.label, {
        x: x + 5,
        y: y + h / 2 - 3,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }

  const outBytes = await doc.save();
  fs.writeFileSync(outputPath, outBytes);
  console.log(`Masked PDF saved to: ${outputPath}`);
}

/**
 * Extract a region of a PDF page as a PNG image.
 * Mirrors the Python `extract_image_from_pdf()` function.
 */
export function extractRegionAsPng(
  inputPath: string,
  pageIndex: number,
  bounds: [number, number, number, number],
  zoom = 2,
  padding = 5
): Buffer {
  const buf = fs.readFileSync(inputPath);
  const doc = mupdf.Document.openDocument(buf, "application/pdf");

  try {
    const page = doc.loadPage(pageIndex);
    const [px0, py0, px1, py1] = page.getBounds();
    const pageW = px1 - px0;
    const pageH = py1 - py0;

    const [nx0, ny0, nx1, ny1] = bounds;
    const clipRect: [number, number, number, number] = [
      Math.max(px0, nx0 * pageW + px0 - padding),
      Math.max(py0, ny0 * pageH + py0 - padding),
      Math.min(px1, nx1 * pageW + px0 + padding),
      Math.min(py1, ny1 * pageH + py0 + padding),
    ];

    const matrix = mupdf.Matrix.scale(zoom, zoom);
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [
      Math.floor(clipRect[0] * zoom),
      Math.floor(clipRect[1] * zoom),
      Math.ceil(clipRect[2] * zoom),
      Math.ceil(clipRect[3] * zoom),
    ], false);

    try {
      pixmap.clear(255);
      const device = new mupdf.DrawDevice(matrix, pixmap);
      try {
        page.run(device, mupdf.Matrix.identity);
      } finally {
        device.close();
      }
      return Buffer.from(pixmap.asPNG());
    } finally {
      pixmap.destroy();
    }
  } finally {
    doc.destroy();
  }
}

/**
 * Render a full PDF page as a PNG image.
 */
export function renderPageAsPng(
  inputPath: string,
  pageIndex: number,
  zoom = 2
): Buffer {
  const buf = fs.readFileSync(inputPath);
  const doc = mupdf.Document.openDocument(buf, "application/pdf");

  try {
    const page = doc.loadPage(pageIndex);
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(zoom, zoom),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true
    );
    try {
      return Buffer.from(pixmap.asPNG());
    } finally {
      pixmap.destroy();
    }
  } finally {
    doc.destroy();
  }
}

/**
 * Convert DetectedMedia arrays into MaskBlocks for masking.
 */
export function mediasToMaskBlocks(
  images: DetectedMedia[],
  tables: DetectedMedia[]
): MaskBlock[] {
  // Combine and sort by page order (matching Python's page-sequential numbering)
  const all = [...images, ...tables]
    .filter((m) => m.bounds != null)
    .sort((a, b) => a.pageIndex - b.pageIndex);

  return all.map((media, idx) => ({
    pageIndex: media.pageIndex,
    bounds: media.bounds!,
    label: `[Insert table/media ${idx} here]`,
  }));
}
