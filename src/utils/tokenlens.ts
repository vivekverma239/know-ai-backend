import { MODELS } from "@/@types/llm";
import { logger } from "@/utils/logger";
import type { LanguageModelUsage } from "ai";
import { type TokenCosts, computeCostUSD } from "tokenlens";

/**
 * Explicit mapping from our internal model identifier to the tokenlens slug.
 *
 * Most modern slugs (`gemini-2.5-flash`, `gpt-5-mini`, `claude-sonnet-4`) are
 * recognized by tokenlens once we auto-prepend the vendor prefix (see
 * `candidateSlugs`), so the mapping below is only required when:
 *
 *  - our internal slug has a typo or vendor mismatch (e.g. `glz-ai/glm-4.5`
 *    needs to resolve as `z-ai/glm-4.5`), or
 *  - the canonical tokenlens slug is meaningfully different (e.g.
 *    `gemini-2.5-flash-lite-preview-06-17` → `google/gemini-2.5-flash-lite`).
 *
 * Coverage is enforced by `test/modelPricing.test.ts`, which asserts every
 * `MODELS` enum value produces a non-zero cost.
 */
export const TOKENLENS_MODEL_MAPPING: Record<string, string> = {
  [MODELS.GEMINI_2_5_FLASH_LITE]: "google/gemini-2.5-flash-lite",
  [MODELS.GEMINI_3_FLASH]: "google/gemini-3-flash",
  [MODELS.GPT_5_5]: "openai/gpt-5.5",
  [MODELS.GLM_4_5]: "z-ai/glm-4.5",
  [MODELS.DEEPSEEK_V3]: "deepseek/deepseek-v3",
  [MODELS.DEEPSEEK_R1_0528]: "deepseek/deepseek-r1",
  [MODELS.PERPLEXITY_SONAR]: "perplexity/sonar",
};

const PROVIDER_PRIORITY = ["vercel", "openrouter", "anthropic", "openai", "google"] as const;

/**
 * Fixed per-call USD price for non-LLM services that don't bill by token —
 * web search APIs, scrape APIs, etc. These slugs are used with `inputTokens=0`
 * and `outputTokens=0` so the cost is read directly from this table.
 *
 * TODO(pricing): verify Exa/Firecrawl rates against current vendor pricing.
 */
const NON_TOKEN_PRICING: Record<string, number> = {
  "exa:search": 0.005, // $5 / 1k neural or keyword searches
  "exa:contents": 0.001, // $1 / 1k URL content extractions
  "firecrawl:scrape": 0.001, // $1 / 1k scrapes (placeholder)
};

export interface UsageDetails {
  totalCost: number;
  totalTokens: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costBreakdown?: {
    model: string;
    cost: number;
    inputTokens: number;
    outputTokens: number;
  }[];
}

export interface StepUsage extends LanguageModelUsage {
  model: string;
}

/**
 * Best-guess vendor prefix for a bare slug. Tokenlens's catalog uses
 * `vendor/slug` keys (`google/gemini-2.5-flash`, `openai/gpt-4o-mini`), so when
 * the caller passes only the slug we try prepending the likely vendor.
 */
function vendorPrefixFor(slug: string): string | null {
  if (slug.startsWith("gemini-")) return "google";
  if (slug.startsWith("text-embedding-")) return "openai";
  if (slug.startsWith("gpt-") || slug.startsWith("o3-") || slug.startsWith("o4-")) return "openai";
  if (slug.startsWith("claude-")) return "anthropic";
  if (slug.startsWith("grok-")) return "x-ai";
  return null;
}

/**
 * Generate the ordered list of slugs to try against tokenlens for a given
 * model identifier. Order matters — first non-zero cost wins.
 *
 *   1. Explicit override from `TOKENLENS_MODEL_MAPPING`.
 *   2. The slug as passed.
 *   3. Vendor-prefixed (e.g. `gemini-2.5-flash` → `google/gemini-2.5-flash`).
 *   4. Dash↔dot version variants — parse-engine and some loggers emit
 *      `gemini-2-5-flash` where tokenlens wants `gemini-2.5-flash`.
 */
export function candidateSlugs(model: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string | null | undefined) => {
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  const withVendor = (slug: string) => {
    if (slug.includes("/")) return slug;
    const vendor = vendorPrefixFor(slug);
    return vendor ? `${vendor}/${slug}` : null;
  };

  const dashToDotVersion = (slug: string) => slug.replace(/-(\d+)-(\d+)(?=-|$)/g, "-$1.$2");
  const dotToDashVersion = (slug: string) => slug.replace(/\.(\d+)/g, "-$1");

  push(TOKENLENS_MODEL_MAPPING[model]);

  for (const variant of [model, dashToDotVersion(model), dotToDashVersion(model)]) {
    push(variant);
    push(withVendor(variant));
  }

  return out;
}

async function priceForSlug(slug: string, usage: LanguageModelUsage): Promise<number | null> {
  for (const provider of PROVIDER_PRIORITY) {
    try {
      const tokenCosts: TokenCosts = await computeCostUSD({
        modelId: slug,
        usage,
        provider,
      });
      const cost = tokenCosts.totalTokenCostUSD ?? 0;
      if (cost > 0) return cost;
    } catch (error) {
      // The expected case is "model not in provider catalog" which throws.
      // Log at debug so a real exception (network, library upgrade bug) still
      // shows up in verbose logs while not spamming the typical fallthrough.
      logger.debug("tokenlens: provider lookup failed", {
        provider,
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return null;
}

/**
 * Compute the USD cost of a single call. For non-token services (`exa:*`,
 * `firecrawl:*`, ...) returns the fixed per-call rate from `NON_TOKEN_PRICING`.
 * Otherwise tries each candidate slug against tokenlens and returns the first
 * non-zero price; returns 0 if no provider has pricing for any candidate.
 * Never throws.
 */
export async function calculateModelCost(
  model: string,
  usage: LanguageModelUsage,
): Promise<number> {
  const fixed = NON_TOKEN_PRICING[model];
  if (fixed !== undefined) return fixed;

  const candidates = candidateSlugs(model);
  for (const slug of candidates) {
    const cost = await priceForSlug(slug, usage);
    if (cost !== null) {
      logger.debug("Cost calculated", {
        model,
        resolvedSlug: slug,
        cost,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
      return cost;
    }
  }

  logger.warn("No pricing found for model — recording cost=0", {
    model,
    candidates,
  });
  return 0;
}

export async function getUsageDetails(allStepUsage: StepUsage[]): Promise<UsageDetails> {
  let totalCost = 0;
  const totalTokens = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const costBreakdown: UsageDetails["costBreakdown"] = [];

  for (const stepUsage of allStepUsage) {
    totalTokens.inputTokens += stepUsage.inputTokens ?? 0;
    totalTokens.outputTokens += stepUsage.outputTokens ?? 0;
    totalTokens.totalTokens += stepUsage.totalTokens ?? 0;

    const stepCost = await calculateModelCost(stepUsage.model, stepUsage);
    totalCost += stepCost;

    costBreakdown.push({
      model: stepUsage.model,
      cost: stepCost,
      inputTokens: stepUsage.inputTokens ?? 0,
      outputTokens: stepUsage.outputTokens ?? 0,
    });
  }

  return { totalCost, totalTokens, costBreakdown };
}

function usageFromTokens(promptTokens: number, completionTokens: number): LanguageModelUsage {
  return {
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    totalTokens: promptTokens + completionTokens,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
  };
}

export async function calculateUsageCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): Promise<number> {
  return calculateModelCost(model, usageFromTokens(promptTokens, completionTokens));
}

/**
 * @deprecated Use {@link calculateUsageCost}. Kept as an alias so external
 * callers (notably {@link "@/utils/costTracker"}) compile without changes.
 * The fallback table this name once implied is gone — tokenlens is the only
 * source of pricing.
 */
export const calculateCostWithFallback = calculateUsageCost;

export function formatCost(cost: number): string {
  return `$${cost.toFixed(6)}`;
}

export function getCostSummary(details: UsageDetails): string {
  return `${formatCost(details.totalCost)} (${details.totalTokens.totalTokens} tokens)`;
}
