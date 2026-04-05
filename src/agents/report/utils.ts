import type { LanguageModelUsage } from "ai";

/**
 * Helper function to merge token usage data into a usage record.
 * Handles different property name variations (inputTokens vs promptTokens, etc.)
 * and initializes the model entry if it doesn't exist.
 */
export const mergeTokenUsage = (
  usageRecord: Record<string, LanguageModelUsage>,
  model: string,
  newUsage: LanguageModelUsage | Record<string, unknown>,
): void => {
  // Initialize model entry if it doesn't exist
  if (!usageRecord[model]) {
    usageRecord[model] = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    };
  }

  const modelUsage = usageRecord[model];
  if (!modelUsage) return; // Type guard for TypeScript
  const usageData = newUsage as Record<string, unknown>;

  // Handle different property name variations
  modelUsage.inputTokens =
    (modelUsage.inputTokens ?? 0) +
    ((usageData.inputTokens as number) ?? (usageData.promptTokens as number) ?? 0);
  modelUsage.outputTokens =
    (modelUsage.outputTokens ?? 0) +
    ((usageData.outputTokens as number) ?? (usageData.completionTokens as number) ?? 0);
  modelUsage.totalTokens = (modelUsage.totalTokens ?? 0) + ((usageData.totalTokens as number) ?? 0);
  modelUsage.reasoningTokens =
    (modelUsage.reasoningTokens ?? 0) + ((usageData.reasoningTokens as number) ?? 0);
  modelUsage.cachedInputTokens =
    (modelUsage.cachedInputTokens ?? 0) + ((usageData.cachedInputTokens as number) ?? 0);
};
