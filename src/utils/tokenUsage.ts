import { type CallbackTokenUsage, type TokenUsage } from "@/@types/tokenUsage";

export const mergeTokenUsage = (
  usage1: TokenUsage,
  usage2: TokenUsage
): TokenUsage => {
  const mergedUsage: TokenUsage = { ...usage1 };

  // Merge each key from usage2 into the result
  for (const [key, usage2Single] of Object.entries(usage2)) {
    if (mergedUsage[key]) {
      // If key exists in both, merge the _TokenUsageSingle objects
      const usage1Single = mergedUsage[key];

      // Merge input token details
      const mergedInputTokenDetails: Record<string, number> = {
        ...usage1Single.inputTokenDetails,
      };
      for (const [detailKey, value] of Object.entries(
        usage2Single.inputTokenDetails
      )) {
        mergedInputTokenDetails[detailKey] =
          (mergedInputTokenDetails[detailKey] ?? 0) + value;
      }

      // Merge output token details
      const mergedOutputTokenDetails: Record<string, number> = {
        ...usage1Single.outputTokenDetails,
      };
      for (const [detailKey, value] of Object.entries(
        usage2Single.outputTokenDetails
      )) {
        mergedOutputTokenDetails[detailKey] =
          (mergedOutputTokenDetails[detailKey] ?? 0) + value;
      }

      mergedUsage[key] = {
        inputTokens: usage1Single.inputTokens + usage2Single.inputTokens,
        outputTokens: usage1Single.outputTokens + usage2Single.outputTokens,
        totalTokens: usage1Single.totalTokens + usage2Single.totalTokens,
        inputTokenDetails: mergedInputTokenDetails,
        outputTokenDetails: mergedOutputTokenDetails,
      };
    } else {
      // If key doesn't exist in usage1, just add it
      mergedUsage[key] = usage2Single;
    }
  }

  return mergedUsage;
};

export const mapCallbackTokenUsage = (
  usage: CallbackTokenUsage
): TokenUsage => {
  return Object.fromEntries(
    Object.entries(usage).map(([key, value]) => [
      key,
      {
        inputTokens: value.input_tokens,
        outputTokens: value.output_tokens,
        totalTokens: value.total_tokens,
        inputTokenDetails: value.input_token_details,
        outputTokenDetails: value.output_token_details,
      },
    ])
  );
};
