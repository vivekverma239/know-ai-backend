/**
 * Shared PDF utilities — open once, reuse everywhere.
 *
 * Handles:
 * - Single document instance for the session
 * - Chunking large PDFs into sub-PDFs
 * - Page rendering with shared doc handle
 * - Region extraction with shared doc handle
 */
import mupdf from "mupdf";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Manages a single PDF document, providing efficient page access.
 * Open once, render/chunk as many times as needed, destroy when done.
 */
export class PdfDocument {
  private doc: InstanceType<typeof mupdf.Document>;
  private pdfDoc: InstanceType<typeof mupdf.PDFDocument>;
  private buf: Buffer;
  readonly pageCount: number;
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.buf = fs.readFileSync(filePath);
    this.doc = mupdf.Document.openDocument(this.buf, "application/pdf");
    this.pdfDoc = new mupdf.PDFDocument(this.buf);
    this.pageCount = this.doc.countPages();
  }

  /** Render a page as PNG */
  renderPage(pageIndex: number, zoom = 1): Buffer {
    const page = this.doc.loadPage(pageIndex);
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
  }

  /** Extract a region of a page as PNG */
  extractRegion(
    pageIndex: number,
    bounds: [number, number, number, number],
    zoom = 2,
    padding = 5
  ): Buffer {
    const page = this.doc.loadPage(pageIndex);
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
  }

  /** Get page bounds */
  getPageBounds(pageIndex: number): [number, number, number, number] {
    const page = this.doc.loadPage(pageIndex);
    return page.getBounds() as [number, number, number, number];
  }

  /** Get page transform */
  getPageTransform(pageIndex: number): number[] {
    const page = this.pdfDoc.loadPage(pageIndex);
    return page.getTransform();
  }

  /**
   * Split PDF into chunks of N pages each.
   * Returns paths to temporary chunk PDFs.
   * Caller is responsible for cleaning up temp files.
   */
  chunk(chunkSize: number, outDir?: string): ChunkInfo[] {
    const dir = outDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "pdf-chunks-"));
    fs.mkdirSync(dir, { recursive: true });
    const chunks: ChunkInfo[] = [];

    for (let start = 0; start < this.pageCount; start += chunkSize) {
      const end = Math.min(start + chunkSize, this.pageCount);
      const chunkDoc = new mupdf.PDFDocument();

      for (let i = start; i < end; i++) {
        const srcPdf = new mupdf.PDFDocument(this.buf);
        try {
          chunkDoc.graftPage(-1, srcPdf, i);
        } finally {
          srcPdf.destroy();
        }
      }

      const chunkPath = path.join(dir, `chunk_${start}_${end - 1}.pdf`);
      const outBuf = chunkDoc.saveToBuffer("compress");
      fs.writeFileSync(chunkPath, outBuf.asUint8Array());
      chunkDoc.destroy();

      chunks.push({
        path: chunkPath,
        startPage: start,
        endPage: end - 1,
        pageCount: end - start,
      });
    }

    return chunks;
  }

  /** Clean up resources */
  destroy(): void {
    this.doc.destroy();
    this.pdfDoc.destroy();
  }
}

export interface ChunkInfo {
  path: string;
  startPage: number;
  endPage: number;
  pageCount: number;
}

/** Remove temporary chunk files */
export function cleanupChunks(chunks: ChunkInfo[]): void {
  for (const chunk of chunks) {
    try { fs.unlinkSync(chunk.path); } catch { /* best effort */ }
  }
  // Try to remove the parent dir if empty
  if (chunks.length > 0) {
    const dir = path.dirname(chunks[0].path);
    try { fs.rmdirSync(dir); } catch { /* not empty or already gone */ }
  }
}
