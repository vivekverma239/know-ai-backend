import { MODELS } from "@/@types/llm";
import { logError, logger } from "@/utils/logger";
import type { LanguageModelUsage } from "ai";
import { type TokenCosts, computeCostUSD } from "tokenlens";

/**
 * Model mapping for tokenlens
 * Maps our internal model identifiers to tokenlens model identifiers
 */
export const TOKENLENS_MODEL_MAPPING: Record<string, string> = {
  // Google Gemini models
  [MODELS.GEMINI_2_5_FLASH]: "google/gemini-2.5-flash",
  [MODELS.GEMINI_2_5_FLASH_LITE]: "google/gemini-2.5-flash-lite",
  [MODELS.GEMINI_2_5_PRO]: "google/gemini-2.5-pro",
  [MODELS.GEMINI_2_0_FLASH]: "google/gemini-2.0-flash",
  [MODELS.GEMINI_2_0_FLASH_LITE]: "google/gemini-2.0-flash-lite",
  [MODELS.GEMINI_1_5_FLASH]: "google/gemini-1.5-flash",

  // OpenAI models
  [MODELS.GPT_4o]: "openai/gpt-4o",
  [MODELS.GPT_4_1]: "openai/gpt-4.1",
  [MODELS.GPT_4_1_MINI]: "openai/gpt-4.1-mini",
  [MODELS.GPT_5]: "openai/gpt-5",
  [MODELS.GPT_5_MINI]: "openai/gpt-5-mini",
  [MODELS.GPT_5_NANO]: "openai/gpt-5-nano",
  [MODELS.O3_MINI]: "openai/o3-mini",
  [MODELS.O4_MINI]: "openai/o4-mini",

  // Anthropic Claude models
  [MODELS.CLAUDE_3_5_SONNET]: "anthropic/claude-3.5-sonnet",
  [MODELS.CLAUDE_4_SONNET]: "anthropic/claude-4.5-sonnet",
};

/**
 * Provider priority list for cost calculation
 * Will try providers in order until one succeeds
 */
const PROVIDER_PRIORITY = ["vercel", "openrouter", "anthropic", "openai", "google"] as const;

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
 * Calculate cost for a single model usage using tokenlens
 * Tries multiple providers in order of priority
 */
export async function calculateModelCost(
  model: string,
  usage: LanguageModelUsage,
): Promise<number> {
  // Map model to tokenlens identifier
  const tokenlensModel = TOKENLENS_MODEL_MAPPING[model] || model;

  // Try each provider in priority order
  for (const provider of PROVIDER_PRIORITY) {
    try {
      const tokenCosts: TokenCosts = await computeCostUSD({
        modelId: tokenlensModel,
        usage: usage,
        provider: provider,
      });

      logger.debug("Cost calculated successfully", {
        model,
        tokenlensModel,
        provider,
        cost: tokenCosts.totalTokenCostUSD,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });

      return tokenCosts.totalTokenCostUSD ?? 0;
    } catch (error) {
      // Try next provider
      logger.debug("Cost calculation failed for provider, trying next", {
        model,
        tokenlensModel,
        provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // All providers failed
  logger.warn("Failed to calculate cost for model with all providers", {
    model,
    tokenlensModel,
    providers: PROVIDER_PRIORITY,
  });

  return 0;
}

/**
 * Calculate total usage details from multiple step usages
 * This is the main function to use for calculating costs
 */
export async function getUsageDetails(allStepUsage: StepUsage[]): Promise<UsageDetails> {
  let totalCost = 0;
  const totalTokens = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  const costBreakdown: UsageDetails["costBreakdown"] = [];

  for (const stepUsage of allStepUsage) {
    // Aggregate tokens
    totalTokens.inputTokens += stepUsage.inputTokens ?? 0;
    totalTokens.outputTokens += stepUsage.outputTokens ?? 0;
    totalTokens.totalTokens += stepUsage.totalTokens ?? 0;

    // Calculate cost for this step
    const stepCost = await calculateModelCost(stepUsage.model, stepUsage);
    totalCost += stepCost;

    // Add to breakdown
    if (costBreakdown) {
      costBreakdown.push({
        model: stepUsage.model,
        cost: stepCost,
        inputTokens: stepUsage.inputTokens ?? 0,
        outputTokens: stepUsage.outputTokens ?? 0,
      });
    }
  }

  return {
    totalCost,
    totalTokens,
    costBreakdown,
  };
}

/**
 * Calculate cost for a single usage (convenience function)
 */
export async function calculateUsageCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): Promise<number> {
  const usage: LanguageModelUsage = {
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    totalTokens: promptTokens + completionTokens,
    inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
  };

  return calculateModelCost(model, usage);
}

/**
 * Calculate cost estimate with fallback to manual calculation
 * Use this when tokenlens might not have pricing data
 */
export async function calculateCostWithFallback(
  model: string,
  promptTokens: number,
  completionTokens: number,
): Promise<number> {
  try {
    return await calculateUsageCost(model, promptTokens, completionTokens);
  } catch (error) {
    logError(error, {
      operation: "calculateCostWithFallback",
      model,
      promptTokens,
      completionTokens,
    });

    // Fallback to manual calculation with approximate pricing
    return calculateFallbackCost(model, promptTokens, completionTokens);
  }
}

/**
 * Fallback cost calculation using approximate pricing
 * Only used when tokenlens fails
 */
function calculateFallbackCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  // Approximate pricing per million tokens (in USD)
  const FALLBACK_PRICING: Record<string, { input: number; output: number }> = {
    // Google Gemini
    "gemini-2.5-flash": { input: 0.15, output: 0.6 },
    "gemini-2.5-pro": { input: 1.25, output: 5.0 },
    "gemini-2.0-flash": { input: 0.15, output: 0.6 },
    "gemini-1.5-flash": { input: 0.075, output: 0.3 },
    // OpenAI
    "gpt-4o": { input: 2.5, output: 10.0 },
    "gpt-5": { input: 5.0, output: 15.0 },
    "o3-mini": { input: 1.1, output: 4.4 },
    "o4-mini": { input: 1.1, output: 4.4 },
    // Default
    default: { input: 1.0, output: 2.0 },
  };

  const modelKey = model.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const pricing = FALLBACK_PRICING[modelKey] || FALLBACK_PRICING.default;

  const inputCost = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;

  logger.debug("Using fallback cost calculation", {
    model,
    modelKey,
    pricing,
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  });

  return inputCost + outputCost;
}

/**
 * Format cost for display (rounds to 4 decimal places)
 */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(6)}`;
}

/**
 * Get cost summary for logging
 */
export function getCostSummary(details: UsageDetails): string {
  return `${formatCost(details.totalCost)} (${details.totalTokens.totalTokens} tokens)`;
}
