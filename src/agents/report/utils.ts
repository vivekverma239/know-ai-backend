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
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
        } as any;
    }

    const modelUsage = usageRecord[model] as any;
    const usageData = newUsage as any;

    // Handle different property name variations
    modelUsage.promptTokens =
        (modelUsage.promptTokens ?? 0) +
        ((usageData.inputTokens as number) ??
            (usageData.promptTokens as number) ??
            0);

    modelUsage.completionTokens =
        (modelUsage.completionTokens ?? 0) +
        ((usageData.outputTokens as number) ??
            (usageData.completionTokens as number) ??
            0);

    modelUsage.totalTokens =
        (modelUsage.totalTokens ?? 0) + ((usageData.totalTokens as number) ?? 0);

    if (usageData.reasoningTokens) {
        modelUsage.reasoningTokens = (modelUsage.reasoningTokens ?? 0) + usageData.reasoningTokens;
    }
};
