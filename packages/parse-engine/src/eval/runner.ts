/**
 * Eval runner CLI.
 * Loads a task, runs all cases, judges outputs, prints summary, saves JSON.
 *
 * Usage:
 *   tsx src/eval/runner.ts --task table-parsing --model google/gemini-2.5-flash
 *   tsx src/eval/runner.ts --task chart-parsing --model google/gemini-3-flash --judge google/gemini-2.5-flash
 *   tsx src/eval/runner.ts --task table-parsing --list
 */
import { program } from "commander";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import pLimit from "p-limit";

import type {
  EvalTask,
  EvalRun,
  CaseResult,
  ImageCase,
  DetectionCase,
} from "./types.js";
import { judge } from "./judge.js";
import { EVAL_DATA_ROOT } from "./paths.js";

// Tasks registry
import { tableParsing } from "./tasks/table-parsing/index.js";
import { chartParsing } from "./tasks/chart-parsing/index.js";
import { detection } from "./tasks/detection/index.js";

// Load env
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });

const tasks: Record<string, EvalTask> = {
  "table-parsing": tableParsing,
  "chart-parsing": chartParsing,
  detection,
};

function loadReference(refPath: string): string {
  const full = path.join(EVAL_DATA_ROOT, refPath);
  if (!fs.existsSync(full)) {
    throw new Error(`Reference file not found: ${full}`);
  }
  return fs.readFileSync(full, "utf-8");
}

program
  .name("eval")
  .description("Run evaluation suites for document parsing components")
  .option("-t, --task <name>", "Task to run (table-parsing, chart-parsing, detection)")
  .option("-m, --model <id>", "Model to evaluate", "google/gemini-2.5-flash")
  .option("-j, --judge-model <id>", "Model for LLM judge", "google/gemini-2.5-flash")
  .option("-c, --concurrency <n>", "Max concurrent cases", parseInt, 3)
  .option("-f, --filter <id>", "Run only cases matching this ID substring")
  .option("-o, --output <dir>", "Output directory for results", "./eval-results")
  .option("--format <fmt>", "Output format: markdown or ascii", "markdown")
  .option("--list", "List available tasks and their cases")
  .action(async (opts) => {
    if (opts.list) {
      for (const [name, task] of Object.entries(tasks)) {
        const cases = await task.loadCases();
        console.log(`${name}: ${cases.length} cases`);
        for (const c of cases) {
          console.log(`  - ${c.id}${c.description ? `: ${c.description}` : ""}`);
        }
      }
      return;
    }

    if (!opts.task) {
      console.error("Error: --task is required. Use --list to see available tasks.");
      process.exit(1);
    }

    const task = tasks[opts.task];
    if (!task) {
      console.error(`Unknown task: ${opts.task}. Available: ${Object.keys(tasks).join(", ")}`);
      process.exit(1);
    }

    let cases = await task.loadCases() as (ImageCase | DetectionCase)[];
    if (cases.length === 0) {
      console.error(`No test cases found for ${opts.task}. Add cases to eval-data/ and create a manifest.json.`);
      process.exit(1);
    }

    if (opts.filter) {
      cases = cases.filter((c) => c.id.includes(opts.filter));
      if (cases.length === 0) {
        console.error(`No cases match filter "${opts.filter}".`);
        process.exit(1);
      }
    }

    console.log(`\n=== ${task.name} eval ===`);
    console.log(`Model: ${opts.model}`);
    console.log(`Judge: ${opts.judgeModel}`);
    console.log(`Format: ${opts.format}`);
    console.log(`Cases: ${cases.length}\n`);

    const limit = pLimit(Number(opts.concurrency) || 3);
    const results: CaseResult[] = [];

    const casePromises = cases.map((testCase) =>
      limit(async () => {
        const caseId = testCase.id;
        try {
          // Run the model (retry once if output is empty)
          let { output, latencyMs, usage } = await task.run(
            testCase,
            opts.model,
            { format: opts.format },
          );
          if (!output.trim()) {
            console.log(`  ~ ${caseId}: empty output, retrying...`);
            ({ output, latencyMs, usage } = await task.run(
              testCase,
              opts.model,
              { format: opts.format },
            ));
          }

          // Load reference and source image for the judge
          const reference = loadReference(testCase.reference);
          const imagePath = "image" in testCase
            ? (testCase as ImageCase).image
            : (testCase as DetectionCase).page;
          const imageBuffer = imagePath
            ? fs.readFileSync(path.join(EVAL_DATA_ROOT, imagePath))
            : undefined;

          // Judge — sees the source image + reference + actual output
          const score = await judge({
            taskDescription: `${task.name}: parse the given image and produce output`,
            actual: output,
            reference,
            criteria: task.judgeCriteria,
            dimensions: task.dimensions,
            model: opts.judgeModel,
            image: imageBuffer,
          });

          const status = score.pass ? "pass" : "fail";
          const icon = status === "pass" ? "\u2713" : "\u2717";
          console.log(
            `  ${icon} ${caseId}: ${score.score}/5 (${status}) — ${score.reasoning.slice(0, 80)}`,
          );

          const result: CaseResult = {
            caseId,
            description: (testCase as any).description,
            status,
            score,
            output,
            latencyMs,
            usage,
          };
          results.push(result);
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  ! ${caseId}: ERROR — ${msg.slice(0, 80)}`);
          const result: CaseResult = {
            caseId,
            description: (testCase as any).description,
            status: "error",
            score: null,
            output: "",
            latencyMs: 0,
            error: msg,
          };
          results.push(result);
          return result;
        }
      }),
    );

    await Promise.all(casePromises);

    // Build summary
    const scored = results.filter((r) => r.score);
    const dimTotals: Record<string, number[]> = {};
    for (const r of scored) {
      for (const [dim, val] of Object.entries(r.score!.dimensions) as [string, number][]) {
        (dimTotals[dim] ??= []).push(val);
      }
    }
    const dimAvgs: Record<string, number> = {};
    for (const [dim, vals] of Object.entries(dimTotals)) {
      dimAvgs[dim] = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
    }

    const run: EvalRun = {
      task: task.name,
      model: opts.model,
      judgeModel: opts.judgeModel,
      timestamp: new Date().toISOString(),
      results,
      summary: {
        total: results.length,
        passed: results.filter((r) => r.status === "pass").length,
        failed: results.filter((r) => r.status === "fail").length,
        errors: results.filter((r) => r.status === "error").length,
        avgScore: scored.length
          ? +(scored.reduce((a, r) => a + r.score!.score, 0) / scored.length).toFixed(2)
          : 0,
        avgLatencyMs: results.length
          ? Math.round(results.reduce((a, r) => a + r.latencyMs, 0) / results.length)
          : 0,
        dimensions: dimAvgs,
      },
    };

    // Print summary
    const totalCost = results.reduce((s, r) => s + (r.usage?.cost ?? 0), 0);
    const totalTokensIn = results.reduce((s, r) => s + (r.usage?.promptTokens ?? 0), 0);
    const totalTokensOut = results.reduce((s, r) => s + (r.usage?.completionTokens ?? 0), 0);

    console.log(`\n--- Summary ---`);
    console.log(`  Pass: ${run.summary.passed}/${run.summary.total}${run.summary.errors ? ` (${run.summary.errors} errors)` : ""}`);
    console.log(`  Avg Score: ${run.summary.avgScore}/5`);
    console.log(`  Avg Latency: ${run.summary.avgLatencyMs}ms`);
    console.log(`  Tokens: ${totalTokensIn.toLocaleString()} in / ${totalTokensOut.toLocaleString()} out`);
    if (totalCost > 0) console.log(`  Cost: $${totalCost.toFixed(4)}`);
    if (Object.keys(dimAvgs).length > 0) {
      console.log(`  Dimensions:`);
      for (const [dim, avg] of Object.entries(dimAvgs)) {
        console.log(`    ${dim}: ${avg}/5`);
      }
    }

    // Save results
    const outDir = path.resolve(opts.output);
    fs.mkdirSync(outDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outFile = path.join(outDir, `${task.name}_${opts.model.replace(/\//g, "_")}_${timestamp}.json`);
    fs.writeFileSync(outFile, JSON.stringify(run, null, 2));
    console.log(`\nResults saved to: ${outFile}`);
  });

program.parse();
