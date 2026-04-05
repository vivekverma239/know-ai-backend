/**
 * Extract eval fixtures from the IMF pipeline run.
 * Renders PDF pages, crops detected chart regions, saves references.
 *
 * Usage: tsx scripts/extract-imf-fixtures.ts
 */
import * as mupdf from "mupdf";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const PDF_PATH = path.resolve("../test/files/imf.pdf");
const MISTRAL_JSON = path.resolve("output/imf-test/imf_mistral.json");
const PARSED_JSON = path.resolve("output/imf-test/imf_parsed.json");
const EVAL_DATA = path.resolve("eval-data");

// Selected chart pages with clear bounding boxes
const CHART_SELECTIONS = [
  { pageIndex: 9, imageId: "img-0.jpeg", label: "private-official-debt-maturity" },
  { pageIndex: 9, imageId: "img-1.jpeg", label: "external-debt-composition" },
  { pageIndex: 12, imageId: "img-3.jpeg", label: "fiscal-chart" },
  { pageIndex: 19, imageId: "img-12.jpeg", label: "embig-sovereign-spread" },
  { pageIndex: 19, imageId: "img-13.jpeg", label: "reserve-assets" },
  { pageIndex: 33, imageId: "img-17.jpeg", label: "domestic-credit" },
  { pageIndex: 36, imageId: "img-20.jpeg", label: "growth-comparison" },
  { pageIndex: 36, imageId: "img-21.jpeg", label: "inflation-comparison" },
];

async function main() {
  const doc = mupdf.Document.openDocument(
    fs.readFileSync(PDF_PATH),
    "application/pdf",
  ) as mupdf.PDFDocument;

  const mistralData = JSON.parse(fs.readFileSync(MISTRAL_JSON, "utf-8"));
  const parsedData = JSON.parse(fs.readFileSync(PARSED_JSON, "utf-8"));
  const mediaBlocks = parsedData.mediaBlocks ?? [];

  const chartImagesDir = path.join(EVAL_DATA, "charts", "images");
  const chartPagesDir = path.join(EVAL_DATA, "charts", "pages");
  const chartRefsDir = path.join(EVAL_DATA, "charts", "references");
  fs.mkdirSync(chartImagesDir, { recursive: true });
  fs.mkdirSync(chartPagesDir, { recursive: true });
  fs.mkdirSync(chartRefsDir, { recursive: true });

  const DPI = 300;
  const scale = DPI / 72;
  const chartCases: any[] = [];

  // Cache rendered pages so we don't re-render for same page
  const pageCache = new Map<number, Uint8Array>();

  for (const sel of CHART_SELECTIONS) {
    const page = doc.loadPage(sel.pageIndex);
    const bounds = page.getBounds();
    const pageW = bounds[2] - bounds[0];
    const pageH = bounds[3] - bounds[1];

    const pageData = mistralData.pages.find((p: any) => p.pageIndex === sel.pageIndex);
    if (!pageData) { console.log(`  Skip ${sel.label}: no page data`); continue; }

    const imgEntry = pageData.images.find((i: any) => i.id === sel.imageId);
    if (!imgEntry?.bounds) { console.log(`  Skip ${sel.label}: no bounds`); continue; }

    const [x1, y1, x2, y2] = imgEntry.bounds;

    // Render full page (cached)
    const pageFile = `imf-${sel.label}-page.png`;
    if (!pageCache.has(sel.pageIndex)) {
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        false,
        true,
      );
      pageCache.set(sel.pageIndex, pixmap.asPNG());
    }
    fs.writeFileSync(path.join(chartPagesDir, pageFile), pageCache.get(sel.pageIndex)!);

    // Crop using sharp from the full-page PNG
    const fullPagePng = pageCache.get(sel.pageIndex)!;
    const metadata = await sharp(fullPagePng).metadata();
    const pxW = metadata.width!;
    const pxH = metadata.height!;

    const cropLeft = Math.floor(x1 * pxW);
    const cropTop = Math.floor(y1 * pxH);
    const cropWidth = Math.floor((x2 - x1) * pxW);
    const cropHeight = Math.floor((y2 - y1) * pxH);

    const croppedBytes = await sharp(fullPagePng)
      .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
      .png()
      .toBuffer();

    const imageFile = `imf-${sel.label}.png`;
    fs.writeFileSync(path.join(chartImagesDir, imageFile), croppedBytes);

    // Find matching parsed block for reference
    const matchingBlock = mediaBlocks.find(
      (b: any) =>
        b.page === sel.pageIndex &&
        b.bounds &&
        Math.abs(b.bounds[0] - x1) < 0.05 &&
        Math.abs(b.bounds[1] - y1) < 0.05,
    );
    const reference = matchingBlock?.parsedData ?? "TODO: add reference output";

    const refFile = `imf-${sel.label}.md`;
    fs.writeFileSync(path.join(chartRefsDir, refFile), reference);

    chartCases.push({
      id: `imf-${sel.label}`,
      image: `charts/images/${imageFile}`,
      page: `charts/pages/${pageFile}`,
      reference: `charts/references/${refFile}`,
      description: `IMF report chart: ${sel.label.replace(/-/g, " ")}`,
    });

    console.log(`  OK ${sel.label} (page ${sel.pageIndex + 1}) — ref ${reference.length} chars`);
  }

  // Save chart manifest
  fs.writeFileSync(
    path.join(EVAL_DATA, "charts", "manifest.json"),
    JSON.stringify(chartCases, null, 2),
  );
  console.log(`\nSaved ${chartCases.length} chart fixtures`);
}

main().catch(console.error);
