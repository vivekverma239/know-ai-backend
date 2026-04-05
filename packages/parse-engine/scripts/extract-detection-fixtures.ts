/**
 * Extract detection eval fixtures from the IMF pipeline run.
 * Renders pages as images, saves Mistral detection results as ground truth references.
 *
 * Usage: tsx scripts/extract-detection-fixtures.ts
 */
import * as mupdf from "mupdf";
import fs from "node:fs";
import path from "node:path";

const PDF_PATH = path.resolve("../test/files/imf.pdf");
const MISTRAL_JSON = path.resolve("output/imf-test/imf_mistral.json");
const EVAL_DATA = path.resolve("eval-data");

// Selected pages with diverse detection scenarios
const DETECTION_PAGES = [
  { pageIndex: 9, desc: "2 charts, no tables" },
  { pageIndex: 11, desc: "1 chart + 1 table (mixed)" },
  { pageIndex: 13, desc: "3 charts, no tables" },
  { pageIndex: 15, desc: "4 charts, dense page" },
  { pageIndex: 16, desc: "2 tables only, no charts" },
  { pageIndex: 36, desc: "6 charts, very dense" },
  { pageIndex: 37, desc: "2 tables only" },
  { pageIndex: 38, desc: "1 chart + 1 table (mixed)" },
  { pageIndex: 40, desc: "6 charts, very dense" },
  { pageIndex: 45, desc: "1 full-page table" },
];

async function main() {
  const doc = mupdf.Document.openDocument(
    fs.readFileSync(PDF_PATH),
    "application/pdf",
  ) as mupdf.PDFDocument;

  const mistralData = JSON.parse(fs.readFileSync(MISTRAL_JSON, "utf-8"));

  const pagesDir = path.join(EVAL_DATA, "detection", "pages");
  const refsDir = path.join(EVAL_DATA, "detection", "references");
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.mkdirSync(refsDir, { recursive: true });

  const DPI = 200; // lower DPI for detection — we care about block positions, not text
  const scale = DPI / 72;
  const cases: any[] = [];

  for (const dp of DETECTION_PAGES) {
    const page = doc.loadPage(dp.pageIndex);
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true,
    );
    const pngBytes = pixmap.asPNG();

    const pageFile = `imf-page-${dp.pageIndex}.png`;
    fs.writeFileSync(path.join(pagesDir, pageFile), pngBytes);

    // Build reference from Mistral detection
    const pageData = mistralData.pages.find((p: any) => p.pageIndex === dp.pageIndex);
    const blocks: any[] = [];
    for (const img of pageData?.images ?? []) {
      blocks.push({
        type: "image",
        id: img.id,
        bounds: img.bounds,
      });
    }
    for (const tbl of pageData?.tables ?? []) {
      blocks.push({
        type: "table",
        id: tbl.id,
        bounds: tbl.bounds,
      });
    }

    const reference = {
      pageIndex: dp.pageIndex,
      totalBlocks: blocks.length,
      images: blocks.filter((b) => b.type === "image").length,
      tables: blocks.filter((b) => b.type === "table").length,
      blocks,
    };

    const refFile = `imf-page-${dp.pageIndex}.json`;
    fs.writeFileSync(path.join(refsDir, refFile), JSON.stringify(reference, null, 2));

    cases.push({
      id: `imf-page-${dp.pageIndex}`,
      page: `detection/pages/${pageFile}`,
      reference: `detection/references/${refFile}`,
      description: `IMF page ${dp.pageIndex + 1}: ${dp.desc}`,
    });

    console.log(`  OK page ${dp.pageIndex} — ${blocks.length} blocks (${dp.desc})`);
  }

  // Save manifest
  fs.writeFileSync(
    path.join(EVAL_DATA, "detection", "manifest.json"),
    JSON.stringify(cases, null, 2),
  );
  console.log(`\nSaved ${cases.length} detection fixtures`);
}

main().catch(console.error);
