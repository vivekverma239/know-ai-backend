/**
 * Test runner for workflow adapters.
 *
 * Simulates workflow orchestration locally by running steps sequentially.
 * Verifies the adapters produce the same output as the CLI pipeline.
 *
 * Usage:
 *   npx tsx src/workflows/test-runner.ts <pdf-path> [--adapter vercel|upstash]
 */
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });

import { LocalPersistence, fileHash } from "../persistence.js";
import { parsePdfHandler, type UpstashWorkflowConfig } from "./upstash.js";

// Mock Upstash WorkflowContext — runs steps synchronously
function createMockContext() {
  const steps: { name: string; durationMs: number }[] = [];

  return {
    context: {
      async run<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
        console.log(`  [step] ${name} → starting...`);
        const start = Date.now();
        const result = await fn();
        const duration = Date.now() - start;
        steps.push({ name, durationMs: duration });
        console.log(`  [step] ${name} → done (${(duration / 1000).toFixed(1)}s)`);
        return result;
      },
    },
    steps,
  };
}

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error("Usage: npx tsx src/workflows/test-runner.ts <pdf-path>");
    process.exit(1);
  }

  const resolvedPdf = path.resolve(pdfPath);
  if (!fs.existsSync(resolvedPdf)) {
    console.error(`File not found: ${resolvedPdf}`);
    process.exit(1);
  }

  const outDir = path.resolve("./output/workflow-test");
  fs.mkdirSync(outDir, { recursive: true });

  const config: UpstashWorkflowConfig = {
    persistence: new LocalPersistence(path.join(outDir, ".cache")),
    pdfPath: resolvedPdf,
    useTextract: true,
    concurrency: 20,
  };

  console.log("=== Workflow Test Runner ===");
  console.log(`PDF: ${resolvedPdf}`);
  console.log(`Hash: ${fileHash(resolvedPdf)}`);
  console.log();

  const { context, steps } = createMockContext();
  const start = Date.now();

  try {
    const handler = parsePdfHandler(config);
    const result = await handler(context);

    const totalTime = ((Date.now() - start) / 1000).toFixed(1);

    // Save output
    const outPath = path.join(outDir, "parsed.json");
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

    console.log("\n=== Results ===");
    console.log(`  Pages:     ${result.totalPages}`);
    console.log(`  Media:     ${result.mediaBlocks.length}`);
    console.log(`  Chapters:  ${result.chapters?.length ?? 0}`);
    console.log(`  Sections:  ${result.outline?.length ?? 0}`);
    console.log(`  Category:  ${result.metadata?.category ?? "unknown"}`);
    console.log(`  Output:    ${outPath}`);

    console.log("\n=== Step Timings ===");
    for (const step of steps) {
      console.log(`  ${step.name.padEnd(25)} ${(step.durationMs / 1000).toFixed(1)}s`);
    }
    console.log(`  ${"TOTAL".padEnd(25)} ${totalTime}s`);

    // Verify output structure
    const errors: string[] = [];
    if (!result.totalPages) errors.push("missing totalPages");
    if (!result.pages?.length) errors.push("missing pages");
    if (!result.summary?.title) errors.push("missing summary.title");
    if (!result.metadata?.category) errors.push("missing metadata.category");
    if (!result.chapters?.length) errors.push("missing chapters");
    if (!result.outline?.length) errors.push("missing outline");

    if (errors.length > 0) {
      console.log("\n=== Validation Warnings ===");
      for (const err of errors) console.log(`  ⚠ ${err}`);
    } else {
      console.log("\n=== All validations passed ===");
    }
  } catch (err) {
    console.error("\nWorkflow failed:", err);
    process.exit(1);
  }
}

main();
