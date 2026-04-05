/**
 * Extract table eval fixtures from the IMF PDF.
 * Renders full-page table images and uses Mistral OCR tables as references.
 *
 * Usage: tsx scripts/extract-imf-tables.ts
 */
import * as mupdf from "mupdf";
import fs from "node:fs";
import path from "node:path";

const PDF_PATH = path.resolve("../test/files/imf.pdf");
const MISTRAL_JSON = path.resolve("output/imf-test/imf_mistral.json");
const EVAL_DATA = path.resolve("eval-data");

// Pages with clear data tables + descriptive labels
const TABLE_PAGES = [
  { pageIndex: 10, label: "fiscal-outlook", desc: "Fiscal outlook comparison table (Dec-Apr 2022/23 vs 2023/24)" },
  { pageIndex: 24, label: "balance-of-payments", desc: "Balance of payments projection table" },
  { pageIndex: 38, label: "financial-indicators", desc: "Financial soundness indicators table (2015-2023)" },
  { pageIndex: 39, label: "external-financing", desc: "External financing requirements table (2024-2027)" },
  { pageIndex: 45, label: "selected-economic-indicators", desc: "Selected economic indicators comprehensive table" },
  { pageIndex: 47, label: "fiscal-operations", desc: "Federal government fiscal operations table" },
  { pageIndex: 55, label: "financial-soundness", desc: "Financial soundness indicators multi-year table" },
  { pageIndex: 56, label: "bop-detailed", desc: "Detailed balance of payments table" },
  { pageIndex: 58, label: "external-financing-detailed", desc: "Detailed external financing requirements" },
  { pageIndex: 59, label: "reviews-purchases", desc: "Schedule of reviews and purchases table" },
];

async function main() {
  const doc = mupdf.Document.openDocument(
    fs.readFileSync(PDF_PATH),
    "application/pdf",
  ) as mupdf.PDFDocument;

  const mistralData = JSON.parse(fs.readFileSync(MISTRAL_JSON, "utf-8"));

  const imagesDir = path.join(EVAL_DATA, "tables", "images");
  const refsDir = path.join(EVAL_DATA, "tables", "references");
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(refsDir, { recursive: true });

  const DPI = 300;
  const scale = DPI / 72;
  const cases: any[] = [];

  for (const tp of TABLE_PAGES) {
    const page = doc.loadPage(tp.pageIndex);
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true,
    );
    const pngBytes = pixmap.asPNG();

    const imageFile = `imf-${tp.label}.png`;
    fs.writeFileSync(path.join(imagesDir, imageFile), pngBytes);

    // Get Mistral OCR tables for this page as reference
    const pageData = mistralData.pages.find((p: any) => p.pageIndex === tp.pageIndex);
    const tables = pageData?.tables ?? [];

    let reference = "";
    if (tables.length > 0) {
      reference = tables.map((t: any) => t.content ?? "").join("\n\n");
    } else {
      // Use page markdown if no separate tables detected
      reference = pageData?.markdown?.slice(0, 3000) ?? "TODO: add reference";
    }

    const refFile = `imf-${tp.label}.md`;
    fs.writeFileSync(path.join(refsDir, refFile), reference);

    cases.push({
      id: `imf-${tp.label}`,
      image: `tables/images/${imageFile}`,
      reference: `tables/references/${refFile}`,
      description: `IMF: ${tp.desc}`,
    });

    console.log(`  OK ${tp.label} (page ${tp.pageIndex + 1}) — ${tables.length} tables, ref ${reference.length} chars`);
  }

  // Load existing manifest and merge
  const manifestPath = path.join(EVAL_DATA, "tables", "manifest.json");
  let existing: any[] = [];
  if (fs.existsSync(manifestPath)) {
    existing = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    // Remove old IMF entries
    existing = existing.filter((c: any) => !c.id.startsWith("imf-"));
  }

  const merged = [...existing, ...cases];
  fs.writeFileSync(manifestPath, JSON.stringify(merged, null, 2));
  console.log(`\nSaved ${cases.length} IMF table fixtures (${merged.length} total in manifest)`);
}

main().catch(console.error);
