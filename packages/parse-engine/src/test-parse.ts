import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("Usage: tsx src/test-parse.ts <pdf-path>");
  process.exit(1);
}

const { parsePdf } = await import("./parse.js");

console.log(`Parsing: ${pdfPath}\n`);

const result = await parsePdf(path.resolve(pdfPath), {
  paddle: !!process.env.MODAL_ENDPOINT_URL,
  textract: false,
  verbose: true,
});

console.log(`\n=== Result ===`);
console.log(`Pages: ${result.totalPages}`);
console.log(`Media blocks: ${result.mediaBlocks.length}`);
console.log(`Title: ${result.summary?.title}`);

for (const block of result.mediaBlocks) {
  console.log(`  Block ${block.idx} (page ${block.page}): ${block.parsedData ? block.parsedData.slice(0, 80) + '...' : 'NO DATA'}`);
}

// Check for leftover markers
for (const page of result.pages) {
  const markers = page.content.match(/\[tbl-\d+\.md\]|\[Insert table\/media \d+ here\]|\!\[img-/g);
  if (markers) {
    console.log(`  Page ${page.pageNumber}: UNRESOLVED markers: ${markers.join(', ')}`);
  }
}

console.log(`\n=== Page 0 (first 500 chars) ===`);
console.log(result.pages[0]?.content.slice(0, 500));

console.log(`\n=== Page 3 (first 500 chars) ===`);
console.log(result.pages[3]?.content.slice(0, 500));
