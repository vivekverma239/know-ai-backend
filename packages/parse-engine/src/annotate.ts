import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fs from "node:fs";
import type { DetectedMedia, EvalResult, PageResult } from "./types.js";

interface ColorSet {
  border: RGB;
  label: RGB;
}

// Mistral: red/blue tones
const MISTRAL_COLORS = {
  image: { border: rgb(1, 0, 0), label: rgb(1, 0, 0) },         // Red
  table: { border: rgb(0, 0.4, 1), label: rgb(0, 0.4, 1) },     // Blue
} as const;

// PaddleOCR: green/orange tones
const PADDLE_COLORS = {
  image: { border: rgb(0, 0.7, 0), label: rgb(0, 0.6, 0) },     // Green
  table: { border: rgb(1, 0.6, 0), label: rgb(0.9, 0.5, 0) },   // Orange
} as const;

const BORDER_WIDTH = 2;
const LABEL_FONT_SIZE = 9;
const LABEL_PADDING = 3;

interface MediaAnchor {
  type: "image" | "table";
  line: number;
  /** Image ID from markdown reference, e.g. "img-1" */
  refId?: string;
  /** Table index within page tables array */
  tableIdx?: number;
}

/**
 * Estimate table bounding boxes by anchoring against images with known bounds.
 *
 * Strategy: parse the markdown for img/tbl references in order, then use
 * the known image bounds to interpolate where tables fall spatially on the page.
 */
function estimateTableBoundsFromAnchors(
  markdown: string,
  tableIndex: number,
  images: DetectedMedia[]
): [number, number, number, number] | null {
  const lines = markdown.split("\n");

  // Build ordered list of media references found in markdown
  const anchors: MediaAnchor[] = [];
  let tblCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Image references: ![img-36.jpeg](img-36.jpeg) or ![img-1.jpeg](img-1.jpeg)
    const imgMatch = line.match(/!\[(img-\d+)\.\w+\]/);
    if (imgMatch) {
      anchors.push({ type: "image", line: i, refId: imgMatch[1] });
    }

    // Table references: [tbl-1.md](tbl-1.md)
    if (/\[tbl-\d+\.md\]/.test(line)) {
      anchors.push({ type: "table", line: i, tableIdx: tblCount });
      tblCount++;
    }

    // Inline table blocks (|...|)
    if (line.startsWith("|") && (i === 0 || !lines[i - 1].trim().startsWith("|"))) {
      anchors.push({ type: "table", line: i, tableIdx: tblCount });
      tblCount++;
    }
  }

  // Build a map of image ref IDs to their known bounds
  const imgBoundsMap = new Map<string, [number, number, number, number]>();
  for (const img of images) {
    if (img.bounds) {
      // img.id from Mistral is like "img-36.jpeg", normalize to "img-36"
      const normalized = img.id.replace(/\.\w+$/, "");
      imgBoundsMap.set(normalized, img.bounds);
    }
  }

  // Find the target table anchor
  const targetAnchor = anchors.find(
    (a) => a.type === "table" && a.tableIdx === tableIndex
  );
  if (!targetAnchor) return null;

  // Find nearest image anchors above and below with known bounds
  let aboveBounds: [number, number, number, number] | null = null;
  let belowBounds: [number, number, number, number] | null = null;

  for (let i = anchors.indexOf(targetAnchor) - 1; i >= 0; i--) {
    if (anchors[i].type === "image" && anchors[i].refId) {
      aboveBounds = imgBoundsMap.get(anchors[i].refId!) ?? null;
      if (aboveBounds) break;
    }
  }
  for (let i = anchors.indexOf(targetAnchor) + 1; i < anchors.length; i++) {
    if (anchors[i].type === "image" && anchors[i].refId) {
      belowBounds = imgBoundsMap.get(anchors[i].refId!) ?? null;
      if (belowBounds) break;
    }
  }

  // Estimate Y position from anchors
  let y1: number, y2: number;

  if (aboveBounds && belowBounds) {
    // Table is between two known images — place it in the gap
    y1 = aboveBounds[3]; // bottom of image above
    y2 = belowBounds[1]; // top of image below
  } else if (aboveBounds) {
    // Only an image above — table is below it
    y1 = aboveBounds[3];
    y2 = Math.min(1, y1 + 0.2);
  } else if (belowBounds) {
    // Only an image below — table is above it
    y2 = belowBounds[1];
    y1 = Math.max(0, y2 - 0.2);
  } else {
    // No image anchors on page — fallback to line ratio
    const totalLines = lines.length || 1;
    const yCenter = targetAnchor.line / totalLines;
    y1 = Math.max(0, yCenter - 0.1);
    y2 = Math.min(1, yCenter + 0.1);
  }

  return [0.05, y1, 0.95, y2];
}

function drawBox(
  pdfPage: PDFPage,
  font: PDFFont,
  bounds: [number, number, number, number],
  pageW: number,
  pageH: number,
  color: ColorSet,
  label: string
) {
  const [x1, y1, x2, y2] = bounds;

  // Convert from normalized top-left origin to PDF bottom-left origin
  const x = x1 * pageW;
  const y = pageH - y2 * pageH;
  const w = (x2 - x1) * pageW;
  const h = (y2 - y1) * pageH;

  // Border rectangle
  pdfPage.drawRectangle({
    x, y, width: w, height: h,
    borderColor: color.border,
    borderWidth: BORDER_WIDTH,
    opacity: 0,
    borderOpacity: 0.8,
  });

  // Label background + text
  const labelW = font.widthOfTextAtSize(label, LABEL_FONT_SIZE) + LABEL_PADDING * 2;
  const labelH = LABEL_FONT_SIZE + LABEL_PADDING * 2;

  pdfPage.drawRectangle({
    x,
    y: y + h - labelH,
    width: labelW,
    height: labelH,
    color: rgb(1, 1, 1),
    opacity: 0.85,
  });

  pdfPage.drawText(label, {
    x: x + LABEL_PADDING,
    y: y + h - labelH + LABEL_PADDING,
    size: LABEL_FONT_SIZE,
    font,
    color: color.label,
  });
}

function drawSourceOnPage(
  pdfPage: PDFPage,
  font: PDFFont,
  pageResult: PageResult,
  pageW: number,
  pageH: number,
  colors: typeof MISTRAL_COLORS,
  prefix: string
) {
  // Draw image boxes
  for (let i = 0; i < pageResult.images.length; i++) {
    const media = pageResult.images[i];
    if (!media.bounds) continue;
    const label = `${prefix}IMG-${i + 1}`;
    drawBox(pdfPage, font, media.bounds, pageW, pageH, colors.image, label);
  }

  // Draw table boxes
  for (let i = 0; i < pageResult.tables.length; i++) {
    const media = pageResult.tables[i];
    // Use actual bounds if available (PaddleOCR), otherwise estimate from image anchors (Mistral)
    const bounds = media.bounds
      ?? estimateTableBoundsFromAnchors(pageResult.markdown, i, pageResult.images);
    if (!bounds) continue;
    const label = `${prefix}TBL-${i + 1}`;
    drawBox(pdfPage, font, bounds, pageW, pageH, colors.table, label);
  }
}

export async function annotateAndSave(
  inputPdfPath: string,
  mistralResult: EvalResult,
  outputPath: string,
  paddleResult?: EvalResult | null
): Promise<void> {
  const pdfBytes = fs.readFileSync(inputPdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  // Build a lookup for paddle pages by index
  const paddlePageMap = new Map<number, PageResult>();
  if (paddleResult) {
    for (const p of paddleResult.pages) {
      paddlePageMap.set(p.pageIndex, p);
    }
  }

  for (const mistralPage of mistralResult.pages) {
    const pdfPage = pages[mistralPage.pageIndex];
    if (!pdfPage) continue;

    const { width: pageW, height: pageH } = pdfPage.getSize();

    // Draw Mistral detections (red/blue)
    const mPrefix = paddleResult ? "M:" : "";
    drawSourceOnPage(pdfPage, font, mistralPage, pageW, pageH, MISTRAL_COLORS, mPrefix);

    // Draw PaddleOCR detections (green/orange) if available
    const paddlePage = paddlePageMap.get(mistralPage.pageIndex);
    if (paddlePage) {
      drawSourceOnPage(pdfPage, font, paddlePage, pageW, pageH, PADDLE_COLORS, "P:");
    }
  }

  // Draw legend on first page
  if (pages.length > 0 && paddleResult) {
    const firstPage = pages[0];
    const legendY = 12;
    const legendItems = [
      { text: "RED=Mistral Images", color: MISTRAL_COLORS.image.label },
      { text: "BLUE=Mistral Tables", color: MISTRAL_COLORS.table.label },
      { text: "GREEN=Paddle Images", color: PADDLE_COLORS.image.label },
      { text: "ORANGE=Paddle Tables", color: PADDLE_COLORS.table.label },
    ];

    let xOffset = 10;
    for (const item of legendItems) {
      firstPage.drawText(item.text, {
        x: xOffset,
        y: legendY,
        size: 7,
        font,
        color: item.color,
      });
      xOffset += font.widthOfTextAtSize(item.text, 7) + 12;
    }
  }

  const annotatedBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, annotatedBytes);
  console.log(`Annotated PDF saved to: ${outputPath}`);
}
