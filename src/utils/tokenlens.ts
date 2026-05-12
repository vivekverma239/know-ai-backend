import { MODELS } from "@/@types/llm";
import { logError, logger } from "@/utils/logger";
import type { LanguageModelUsage } from "ai";
import { type TokenCosts, computeCostUSD } from "tokenlens";

/**
 * Model mapping for tokenlens
 * Maps our internal model identifiers to tokenlens model identifiers.
 *
 * Every MODELS enum value MUST have an entry — `test/modelPricing.test.ts`
 * enforces this. When you add a new model to `MODELS`, add the matching
 * mapping here too.
 */
export const TOKENLENS_MODEL_MAPPING: Record<string, string> = {
  // Google Gemini
  [MODELS.GEMINI_1_5_FLASH]: "google/gemini-1.5-flash",
  [MODELS.GEMINI_2_0_FLASH]: "google/gemini-2.0-flash",
  [MODELS.GEMINI_2_0_FLASH_LITE]: "google/gemini-2.0-flash-lite",
  [MODELS.GEMINI_2_0_PRO]: "google/gemini-2.0-pro",
  [MODELS.GEMINI_2_5_FLASH]: "google/gemini-2.5-flash",
  [MODELS.GEMINI_2_5_FLASH_LITE]: "google/gemini-2.5-flash-lite",
  [MODELS.GEMINI_2_5_PRO]: "google/gemini-2.5-pro",
  [MODELS.GEMINI_3_FLASH]: "google/gemini-3-flash",

  // OpenAI
  [MODELS.GPT_4o]: "openai/gpt-4o",
  [MODELS.GPT_4_1]: "openai/gpt-4.1",
  [MODELS.GPT_4_1_MINI]: "openai/gpt-4.1-mini",
  [MODELS.GPT_5]: "openai/gpt-5",
  [MODELS.GPT_5_5]: "openai/gpt-5.5",
  [MODELS.GPT_5_MINI]: "openai/gpt-5-mini",
  [MODELS.GPT_5_NANO]: "openai/gpt-5-nano",
  [MODELS.O3_MINI]: "openai/o3-mini",
  [MODELS.O4_MINI]: "openai/o4-mini",
  [MODELS.OPENAI_GPT_OSS_20B]: "openai/gpt-oss-20b",
  [MODELS.OPENAI_GPT_OSS_120B]: "openai/gpt-oss-120b",

  // Anthropic
  [MODELS.CLAUDE_3_5_SONNET]: "anthropic/claude-3.5-sonnet",
  [MODELS.CLAUDE_4_SONNET]: "anthropic/claude-sonnet-4",

  // xAI
  [MODELS.GROK_3_MINI]: "x-ai/grok-3-mini",
  [MODELS.GROK_4]: "x-ai/grok-4",
  [MODELS.GROK_4_1_FAST]: "x-ai/grok-4.1-fast",
  [MODELS.GROK_CODE_FAST_1]: "x-ai/grok-code-fast-1",

  // DeepSeek
  [MODELS.DEEPSEEK_LLAMA_8B]: "deepseek/deepseek-r1-distill-llama-8b",
  [MODELS.DEEPSEEK_QWEN_2_5_SMALL]: "deepseek/deepseek-r1-distill-qwen-1.5b",
  [MODELS.DEEPSEEK_QWEN_2_5_MEDIUM]: "deepseek/deepseek-r1-distill-qwen-14b",
  [MODELS.DEEPSEEK_QWEN_2_5_LARGE]: "deepseek/deepseek-r1-distill-qwen-32b",
  [MODELS.DEEPSEEK_R1_0528]: "deepseek/deepseek-r1-0528",
  [MODELS.DEEPSEEK_V3]: "deepseek/deepseek-chat-v3",

  // Meta / Llama
  [MODELS.LLAMA_3_2_11B_VISION_INSTRUCT]: "meta-llama/llama-3.2-11b-vision-instruct",
  [MODELS.LLAMA_3_2_90B_VISION_INSTRUCT]: "meta-llama/llama-3.2-90b-vision-instruct",

  // Mistral
  [MODELS.MAGISTRAL_SMALL_2506]: "mistralai/magistral-small",
  [MODELS.MAGISTRAL_MEDIUM_2506]: "mistralai/magistral-medium",
  [MODELS.MAGISTRAL_MEDIUM_2506_THINKING]: "mistralai/magistral-medium",

  // Moonshot
  [MODELS.KIMI_K2]: "moonshotai/kimi-k2",

  // Z AI / GLM
  [MODELS.GLM_4_5]: "z-ai/glm-4.5",

  // Perplexity
  [MODELS.PERPLEXITY_SONAR]: "perplexity/sonar",

  // OpenRouter aliases / Qwen
  [MODELS.SONOMA_DUSK_ALPHA]: "openrouter/sonoma-dusk-alpha",
  [MODELS.SONOMA_SKY_ALPHA]: "openrouter/sonoma-sky-alpha",
  [MODELS.QWEN_3_NEXT_80B_A3B_THINKING]: "qwen/qwen3-next-80b-a3b-thinking",
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
  // Approximate pricing per million tokens (in USD). Used only when tokenlens
  // cannot resolve the model with any of the priority providers.
  const FALLBACK_PRICING: Record<string, { input: number; output: number }> = {
    // Google
    "gemini-1-5-flash": { input: 0.075, output: 0.3 },
    "gemini-2-0-flash": { input: 0.1, output: 0.4 },
    "gemini-2-0-flash-lite": { input: 0.075, output: 0.3 },
    "gemini-2-5-flash": { input: 0.15, output: 0.6 },
    "gemini-2-5-flash-lite-preview-06-17": { input: 0.075, output: 0.3 },
    "gemini-2-5-pro": { input: 1.25, output: 5.0 },
    "gemini-3-flash-preview": { input: 0.15, output: 0.6 },
    // OpenAI
    "gpt-4o": { input: 2.5, output: 10.0 },
    "gpt-4-1": { input: 2.0, output: 8.0 },
    "gpt-4-1-mini": { input: 0.4, output: 1.6 },
    "gpt-5": { input: 5.0, output: 15.0 },
    "gpt-5-5-2026-04-23": { input: 5.0, output: 15.0 },
    "gpt-5-mini": { input: 0.25, output: 2.0 },
    "gpt-5-nano": { input: 0.05, output: 0.4 },
    "o3-mini": { input: 1.1, output: 4.4 },
    "o4-mini": { input: 1.1, output: 4.4 },
    // Anthropic
    "anthropic-claude-3-5-sonnet": { input: 3.0, output: 15.0 },
    "anthropic-claude-sonnet-4": { input: 3.0, output: 15.0 },
    // xAI
    "x-ai-grok-3-mini": { input: 0.3, output: 0.6 },
    "x-ai-grok-4": { input: 5.0, output: 15.0 },
    "x-ai-grok-4-1-fast": { input: 0.3, output: 0.6 },
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
