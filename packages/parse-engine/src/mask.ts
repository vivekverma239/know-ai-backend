import mupdf from "mupdf";
import fs from "node:fs";
import type { DetectedMedia } from "./types.js";

interface MaskBlock {
  pageIndex: number;
  /** Normalized bounds [0-1]: [x1, y1, x2, y2] (top-left origin) */
  bounds: [number, number, number, number];
  label: string;
}

/**
 * Mask media blocks in a PDF. For pages with blocks, we rasterize the page
 * to a high-res image, paint white rectangles + placeholder text on a new
 * PDF page using that image as background. This guarantees masking works
 * regardless of the source PDF's transparency groups or blend modes.
 *
 * Mirrors the Python `mask_blocks()` from src/utils/pdf.py.
 */
export function maskPdf(
  inputPath: string,
  blocks: MaskBlock[],
  outputPath: string,
  dpi = 150
): void {
  const buf = fs.readFileSync(inputPath);
  const srcDoc = mupdf.Document.openDocument(buf, "application/pdf");

  try {
    const outDoc = new mupdf.PDFDocument();
    const font = outDoc.addSimpleFont(new mupdf.Font("Helvetica"));

    // Group blocks by page
    const blocksByPage = new Map<number, MaskBlock[]>();
    for (const block of blocks) {
      const list = blocksByPage.get(block.pageIndex) ?? [];
      list.push(block);
      blocksByPage.set(block.pageIndex, list);
    }

    const pageCount = srcDoc.countPages();
    const scale = dpi / 72;

    for (let i = 0; i < pageCount; i++) {
      const srcPage = srcDoc.loadPage(i);
      const [px0, py0, px1, py1] = srcPage.getBounds();
      const pageW = px1 - px0;
      const pageH = py1 - py0;

      if (!blocksByPage.has(i)) {
        // No blocks on this page — graft original page as-is
        const pdfSrc = new mupdf.PDFDocument(buf);
        try {
          outDoc.graftPage(-1, pdfSrc, i);
        } finally {
          pdfSrc.destroy();
        }
        continue;
      }

      // Rasterize the source page to a pixmap
      const matrix = mupdf.Matrix.scale(scale, scale);
      const pixmap = srcPage.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, false);

      try {
        const pw = pixmap.getWidth();
        const ph = pixmap.getHeight();
        const pixels = pixmap.getPixels();
        const stride = pixmap.getStride();
        const nComp = pixmap.getNumberOfComponents();

        const pageBlocks = blocksByPage.get(i)!;
        for (const block of pageBlocks) {
          const [nx0, ny0, nx1, ny1] = block.bounds;

          // Convert normalized bounds to pixel coords
          const bx0 = Math.max(0, Math.floor(nx0 * pw));
          const by0 = Math.max(0, Math.floor(ny0 * ph));
          const bx1 = Math.min(pw, Math.ceil(nx1 * pw));
          const by1 = Math.min(ph, Math.ceil(ny1 * ph));

          // Fill with white
          for (let row = by0; row < by1; row++) {
            for (let col = bx0; col < bx1; col++) {
              const offset = row * stride + col * nComp;
              for (let c = 0; c < nComp; c++) {
                pixels[offset + c] = 255;
              }
            }
          }

          // Draw black border (1px)
          for (let col = bx0; col < bx1; col++) {
            for (const row of [by0, by1 - 1]) {
              if (row >= 0 && row < ph) {
                const offset = row * stride + col * nComp;
                for (let c = 0; c < nComp; c++) pixels[offset + c] = 0;
              }
            }
          }
          for (let row = by0; row < by1; row++) {
            for (const col of [bx0, bx1 - 1]) {
              if (col >= 0 && col < pw) {
                const offset = row * stride + col * nComp;
                for (let c = 0; c < nComp; c++) pixels[offset + c] = 0;
              }
            }
          }
        }

        // Create the masked page image
        const maskedImage = outDoc.addImage(new mupdf.Image(pixmap));

        const imgName = "Im_masked";
        const fontName = "F_mask";

        const resDict = outDoc.newDictionary();
        const xObjDict = outDoc.newDictionary();
        xObjDict.put(imgName, maskedImage);
        resDict.put("XObject", xObjDict);
        const fDict = outDoc.newDictionary();
        fDict.put(fontName, font);
        resDict.put("Font", fDict);

        // Content stream: draw full-page image then text labels
        let content = `q ${pageW} 0 0 ${pageH} ${px0} ${py0} cm /${imgName} Do Q\n`;

        for (const block of pageBlocks) {
          const [nx0, ny0, nx1, ny1] = block.bounds;
          const textX = nx0 * pageW + px0 + 5;
          const textY = (1 - (ny0 + ny1) / 2) * pageH + py0 - 3;
          const escaped = block.label.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
          content += `BT /${fontName} 7 Tf 0 0 0 rg ${textX} ${textY} Td (${escaped}) Tj ET\n`;
        }

        const pageObj = outDoc.addPage([px0, py0, px1, py1], 0, resDict, content);
        outDoc.insertPage(-1, pageObj);
      } finally {
        pixmap.destroy();
      }
    }

    const outBuf = outDoc.saveToBuffer("compress");
    fs.writeFileSync(outputPath, outBuf.asUint8Array());
    console.log(`Masked PDF saved to: ${outputPath}`);
    outDoc.destroy();
  } finally {
    srcDoc.destroy();
  }
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
