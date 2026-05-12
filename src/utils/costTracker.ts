import { getDb } from "@/db";
import { tokenUsageLog } from "@/db/schema";
import { logger } from "@/utils/logger";
import { getRequestContext, getRequestId } from "@/utils/requestContext";
import { calculateCostWithFallback } from "@/utils/tokenlens";

/**
 * Where a recorded LLM call came from. Drives admin analytics filters and
 * per-feature quotas.
 *
 *   - "chat": agent/chat-stream code paths invoked from a user-facing API.
 *   - "parse": parse-engine token usage fanned out from /parsing-callback.
 *   - "report": structured-report generation.
 *   - "tool": LLM call inside a tool's `execute` (e.g. fileAnswerAgent).
 *   - "other": anything that doesn't fit the above; should be rare.
 */
export type CostSource = "chat" | "parse" | "report" | "tool" | "other";

/**
 * A single LLM call's usage record. `inputTokens`/`outputTokens`/`totalTokens`
 * mirror the `LanguageModelUsage` shape used by the Vercel AI SDK.
 *
 * Identity fields default to the current request context when omitted:
 *   - `subjectUserId / subjectOrgId / sessionId` ← `ctx.userId / orgId / sessionId`
 *   - `actorUserId`                              ← `ctx.actorUserId ?? ctx.userId`
 *   - `requestId`                                ← `ctx.requestId`
 *
 * Pass them explicitly only when no request context is available (e.g. the
 * parsing callback which fans out one row per step well after the request
 * lifecycle has ended).
 */
export type LlmCallRecord = {
  operationName: string;
  operationId: string;
  parentOperationId?: string;
  messageId?: string;
  subjectUserId?: string;
  subjectOrgId?: string;
  sessionId?: string;
  actorUserId?: string;
  requestId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  source: CostSource;
  metadata?: Record<string, unknown>;
};

/**
 * Single writer for `token_usage_log`. Never throws — failures are logged at
 * error level so an agent loop or tool execution is never broken by a
 * persistence issue.
 *
 * `await` is supported for callers that need back-pressure (e.g. the parse
 * callback handler which fans out N rows and wants to surface DB errors as a
 * 500 to parse-engine). Hot agent loops should call without `await`:
 *
 *     void recordLlmUsage({ ... });
 */
export async function recordLlmUsage(record: LlmCallRecord): Promise<void> {
  try {
    const ctx = getRequestContext();
    const subjectUserId = record.subjectUserId ?? ctx?.userId;
    const subjectOrgId = record.subjectOrgId ?? ctx?.orgId;
    const sessionId = record.sessionId ?? ctx?.sessionId;
    const actorUserId = record.actorUserId ?? ctx?.actorUserId ?? subjectUserId;
    const requestId = record.requestId ?? getRequestId() ?? "unknown";

    const inputTokens = record.inputTokens ?? 0;
    const outputTokens = record.outputTokens ?? 0;
    const totalTokens = record.totalTokens ?? inputTokens + outputTokens;

    let costEstimate = 0;
    try {
      costEstimate = await calculateCostWithFallback(record.model, inputTokens, outputTokens);
    } catch (error) {
      logger.debug("costTracker: cost calc failed, recording row with cost=0", {
        model: record.model,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await getDb()
      .insert(tokenUsageLog)
      .values({
        requestId,
        operationId: record.operationId,
        operationName: record.operationName,
        parentOperationId: record.parentOperationId,
        messageId: record.messageId,
        userId: subjectUserId,
        sessionId,
        orgId: subjectOrgId,
        actorUserId,
        source: record.source,
        model: record.model,
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens,
        cachedInputTokens: record.cachedInputTokens ?? 0,
        reasoningTokens: record.reasoningTokens ?? 0,
        costEstimate: costEstimate.toFixed(6),
        metadata: record.metadata,
      });
  } catch (error) {
    logger.error("costTracker: failed to persist LLM usage", {
      operationName: record.operationName,
      operationId: record.operationId,
      model: record.model,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
