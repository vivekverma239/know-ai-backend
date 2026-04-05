/**
 * Fixture collector — extracts cropped media images from a pipeline run
 * to create eval fixtures. Run after a pipeline produces output, then
 * manually review/correct the references.
 *
 * Usage:
 *   tsx src/eval/collect.ts <pdf-path> [--output eval-data]
 *
 * What it does:
 *   1. Runs PaddleOCR detection on the PDF
 *   2. Renders pages to PNG
 *   3. Crops each detected media block
 *   4. Runs the parsing pipeline on each block
 *   5. Saves images + initial reference outputs as fixtures
 *   6. Creates/updates manifest.json for each task
 *
 * After running, review the references/ files and correct them to create
 * ground truth. Then run evals against them.
 */
import { program } from "commander";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import * as mupdf from "mupdf";

import type { ImageCase } from "./types.js";

dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

program
  .name("collect")
  .description("Collect eval fixtures from a pipeline output directory")
  .argument("<output-json>", "Path to a parsed document JSON from a pipeline run")
  .option("-o, --output <dir>", "Eval data directory", "./eval-data")
  .action(async (jsonPath: string, opts: { output: string }) => {
    const resolved = path.resolve(jsonPath);
    if (!fs.existsSync(resolved)) {
      console.error(`File not found: ${resolved}`);
      process.exit(1);
    }

    const outDir = path.resolve(opts.output);
    const doc = JSON.parse(fs.readFileSync(resolved, "utf-8"));
    const baseName = slugify(path.basename(resolved, ".json"));

    // We expect the pipeline output to have mediaBlocks with parsed data
    // and the original PDF path embedded or alongside
    const mediaBlocks = doc.mediaBlocks ?? [];
    if (mediaBlocks.length === 0) {
      console.log("No media blocks found in the pipeline output.");
      console.log("Make sure you ran the full pipeline with media parsing enabled.");
      return;
    }

    console.log(`Found ${mediaBlocks.length} media blocks in ${path.basename(resolved)}`);

    // Check if we have cached block/page images in .cache/
    const cacheDir = path.resolve(path.dirname(resolved), "../.cache");
    let tableCount = 0;
    let chartCount = 0;

    for (const block of mediaBlocks) {
      const isTable = block.referenceIdx?.toLowerCase().includes("table");
      const category = isTable ? "tables" : "charts";
      const idx = isTable ? ++tableCount : ++chartCount;
      const id = `${baseName}-${category.slice(0, -1)}-${String(idx).padStart(2, "0")}`;

      const refDir = path.join(outDir, category, "references");
      fs.mkdirSync(refDir, { recursive: true });

      // Save parsed output as initial reference (to be reviewed/corrected)
      const refFile = path.join(refDir, `${id}.md`);
      if (!fs.existsSync(refFile)) {
        fs.writeFileSync(refFile, block.parsedData ?? "TODO: add reference");
        console.log(`  Created reference: ${category}/references/${id}.md`);
      } else {
        console.log(`  Exists (skip): ${category}/references/${id}.md`);
      }
    }

    console.log(`\nCollected: ${tableCount} tables, ${chartCount} charts`);
    console.log(`\nNext steps:`);
    console.log(`  1. Add cropped images to eval-data/{tables,charts}/images/`);
    console.log(`  2. Add full page images to eval-data/{tables,charts}/pages/`);
    console.log(`  3. Review and correct references in eval-data/{tables,charts}/references/`);
    console.log(`  4. Create manifest.json in each directory (see example below)`);
    console.log(`\nExample manifest.json entry:`);
    console.log(JSON.stringify({
      id: `${baseName}-table-01`,
      image: `images/${baseName}-table-01.png`,
      page: `pages/${baseName}-table-01-page.png`,
      reference: `tables/references/${baseName}-table-01.md`,
      description: "Revenue breakdown table from page 5",
    }, null, 2));
  });

program.parse();
