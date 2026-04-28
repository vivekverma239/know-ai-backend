import type { ChatMessageMetadata } from "@/utils/uiMessageBuilder";
import type { TextStreamPart, ToolSet } from "ai";

/**
 * Extract `KnowsisUIMessage.metadata` from a `streamText` `fullStream` part.
 *
 * Used in two places that MUST stay in sync:
 *   1. `toUIMessageStream({ messageMetadata })` (the SDK reference path)
 *   2. The builder mirror loop, called on every `fullStream` chunk
 *
 * Returning `undefined` means "no metadata change for this part" — the SDK
 * skips emitting a `message-metadata` chunk in that case, and our builder
 * mirror also skips calling `mergeMetadata`.
 */
export const extractMessageMetadata = <TOOLS extends ToolSet>(part: TextStreamPart<TOOLS>):
  | Partial<ChatMessageMetadata>
  | undefined => {
  switch (part.type) {
    case "finish":
      return {
        finishReason: part.finishReason,
        usage: {
          inputTokens: part.totalUsage.inputTokens,
          outputTokens: part.totalUsage.outputTokens,
          totalTokens: part.totalUsage.totalTokens,
          reasoningTokens: part.totalUsage.reasoningTokens,
          cachedInputTokens: part.totalUsage.cachedInputTokens,
        },
      };
    case "finish-step":
      // Per-step usage is rolled into the message totals via `finish`. Return
      // undefined here to avoid double-counting / spurious metadata churn on
      // every step. If you need step-level usage in the persisted message,
      // attach it to `metadata.steps` instead.
      return undefined;
    default:
      return undefined;
  }
};
