/**
 * Probe whether tokenlens returns a non-zero cost for every model we have
 * configured. Prints a coverage table:
 *
 *   MODEL  →  tokenlens slug  →  cost($)  →  source (tokenlens|fallback|ZERO)
 *
 * Also exercises a handful of "in-the-wild" slug variants the writer might see
 * (e.g. parse-engine sending `gemini-2-5-flash` instead of `gemini-2.5-flash`).
 *
 * Run: pnpm tsx scripts/probe-tokenlens-coverage.ts
 */

import { MODELS } from "@/@types/llm";
import {
  TOKENLENS_MODEL_MAPPING,
  calculateCostWithFallback,
  calculateModelCost,
} from "@/utils/tokenlens";

const INPUT_TOKENS = 1_000_000; // 1M in / 1M out → cost reads in $/M tokens
const OUTPUT_TOKENS = 1_000_000;

type Row = {
  model: string;
  tokenlensSlug: string;
  tokenlensCost: number;
  fallbackCost: number;
  finalCost: number;
  hit: "tokenlens" | "fallback" | "ZERO";
};

async function probe(model: string): Promise<Row> {
  const tokenlensSlug = TOKENLENS_MODEL_MAPPING[model] ?? "(no mapping)";

  // What tokenlens alone returns (no fallback)
  const tokenlensCost = await calculateModelCost(model, {
    inputTokens: INPUT_TOKENS,
    outputTokens: OUTPUT_TOKENS,
    totalTokens: INPUT_TOKENS + OUTPUT_TOKENS,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
  });

  // The full path the writer uses (tokenlens → fallback)
  const finalCost = await calculateCostWithFallback(model, INPUT_TOKENS, OUTPUT_TOKENS);
  const fallbackCost = finalCost === tokenlensCost ? 0 : finalCost;

  const hit: Row["hit"] =
    tokenlensCost > 0 ? "tokenlens" : finalCost > 0 ? "fallback" : "ZERO";

  return { model, tokenlensSlug, tokenlensCost, fallbackCost, finalCost, hit };
}

function fmt(n: number): string {
  if (n === 0) return "0".padStart(8);
  if (n < 0.01) return `$${n.toFixed(6)}`.padStart(8);
  return `$${n.toFixed(2)}`.padStart(8);
}

function table(title: string, rows: Row[]) {
  console.log(`\n\n========== ${title} ==========\n`);
  console.log(
    "MODEL".padEnd(50) +
      "TOKENLENS SLUG".padEnd(45) +
      "  T-LENS".padEnd(11) +
      " FALLBK".padEnd(11) +
      " FINAL".padEnd(11) +
      " HIT",
  );
  console.log("-".repeat(140));
  for (const r of rows) {
    const marker = r.hit === "ZERO" ? " ❌" : r.hit === "fallback" ? " ⚠ " : "  ✓";
    console.log(
      r.model.padEnd(50) +
        r.tokenlensSlug.padEnd(45) +
        fmt(r.tokenlensCost) +
        " " +
        fmt(r.fallbackCost) +
        " " +
        fmt(r.finalCost) +
        marker +
        " " +
        r.hit,
    );
  }

  const zero = rows.filter((r) => r.hit === "ZERO");
  const fallback = rows.filter((r) => r.hit === "fallback");
  console.log(
    `\nSummary: ${rows.length} models · ${rows.length - zero.length - fallback.length} tokenlens · ${fallback.length} fallback · ${zero.length} ZERO`,
  );
  if (zero.length > 0) {
    console.log(`\n❌ ZERO cost for: ${zero.map((r) => r.model).join(", ")}`);
  }
}

async function main() {
  // 1. Every MODELS enum value (the keys our code emits today).
  const enumRows: Row[] = [];
  for (const value of Object.values(MODELS)) {
    enumRows.push(await probe(value));
  }
  table("Coverage: MODELS enum (slugs our code emits)", enumRows);

  // 2. In-the-wild slug variants the writer might see from external callers.
  //    These mimic what parse-engine, raw provider calls, or AI SDK modelId
  //    fields can produce (dotted vs dashed, vendor-prefixed vs not).
  const wildSlugs = [
    "gemini-2-5-flash", // parse-engine dashed form
    "gemini-2-5-pro",
    "gemini-2.5-flash", // dotted (matches enum)
    "google/gemini-2.5-flash",
    "openai/gpt-4o-mini",
    "gpt-4o-mini",
    "claude-sonnet-4-5",
    "anthropic/claude-sonnet-4-5",
    "text-embedding-3-small",
    "openai/text-embedding-3-small",
    "gemini-embedding-001",
    "google/gemini-embedding-001",
  ];
  const wildRows: Row[] = [];
  for (const slug of wildSlugs) {
    wildRows.push(await probe(slug));
  }
  table("Coverage: in-the-wild slug variants (writer might see these)", wildRows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
