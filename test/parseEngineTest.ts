/**
 * Quick smoke test for parse-engine integration.
 * Run: npx dotenvx run -- tsx test/parseEngineTest.ts
 */
import fs from "node:fs";
import path from "node:path";

const PDF_PATH = path.resolve(__dirname, "files/test-file-meta.pdf");

async function main() {
  console.log("=== Parse Engine Smoke Test ===\n");

  if (!fs.existsSync(PDF_PATH)) {
    console.error(`PDF not found: ${PDF_PATH}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(PDF_PATH);
  console.log(`PDF loaded: ${(buffer.length / 1024).toFixed(1)} KB\n`);

  // Dynamic import — parse-engine is ESM-only
  const { parsePdfFromBuffer } = await import("parse-engine");

  console.log("Starting parse-engine...\n");
  const start = Date.now();

  const result = await parsePdfFromBuffer(buffer, {
    textract: false,    // skip textract for quick test
    paddle: false,      // skip paddle
    verbose: true,
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n=== Results (${elapsed}s) ===\n`);

  console.log(`Total pages: ${result.totalPages}`);
  console.log(`Pages parsed: ${result.pages.length}`);
  console.log(`Media blocks: ${result.mediaBlocks.length}`);
  console.log(`Chapters: ${result.chapters?.length ?? 0}`);
  console.log(`Page summaries: ${result.pageSummaries?.length ?? 0}`);
  console.log(`Has summary: ${!!result.summary}`);
  console.log(`Has metadata: ${!!result.metadata}`);

  if (result.summary) {
    console.log(`\nTitle: ${result.summary.title}`);
    console.log(`Short summary: ${result.summary.shortSummary?.slice(0, 200)}`);
    console.log(`Companies: ${result.summary.companies?.join(", ") || "none"}`);
    console.log(`Document type: ${result.summary.documentType ?? "unknown"}`);
  }

  if (result.metadata) {
    console.log(`\nCategory: ${result.metadata.category}`);
    console.log(`Subcategory: ${result.metadata.subcategory}`);
    console.log(`Industry: ${result.metadata.industry ?? "unknown"}`);
  }

  if (result.chapters && result.chapters.length > 0) {
    console.log("\nChapters:");
    for (const ch of result.chapters) {
      console.log(`  - ${ch.title} (pp. ${ch.startPage}-${ch.endPage}, ${ch.sections.length} sections)`);
    }
  }

  if (result.pageSummaries && result.pageSummaries.length > 0) {
    console.log(`\nFirst page summary: ${result.pageSummaries[0].summary.slice(0, 200)}`);
  }

  if (result.usage) {
    console.log(`\nUsage: ${JSON.stringify(result.usage.totals, null, 2)}`);
  }

  console.log("\n=== PASS ===");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
