import type { CallbackTokenUsage, TokenUsage } from "@/@types/tokenUsage";
import { getDb } from "@/db";
import { userFile } from "@/db/schema";
import { recordLlmUsage } from "@/utils/costTracker";
import { mergeTokenUsage } from "@/utils/tokenUsage";
import { eq } from "drizzle-orm";

export const updateUsage = async (fileId: string, usage: TokenUsage) => {
  await getDb().transaction(async (tx) => {
    const files = await tx
      .select({ tokenUsage: userFile.tokenUsage })
      .from(userFile)
      .where(eq(userFile.id, fileId))
      .for("update");
    const file = files[0];
    if (!file) return;
    const existingUsage = file.tokenUsage ?? {};
    const finalUsage = mergeTokenUsage(existingUsage, usage);
    await tx.update(userFile).set({ tokenUsage: finalUsage }).where(eq(userFile.id, fileId));
  });
};

/**
 * Fan a parse-engine `usage_metadata` payload into `token_usage_log`. One row
 * per (step, model). Subject is the file owner (since parse work is billable
 * against whoever uploaded the file), actor mirrors the subject because the
 * trigger was a system-internal callback rather than a human action.
 *
 * `operationId` is stable per-file-per-taskType so analytics roll-ups
 * naturally aggregate retries / re-deliveries from the parse-engine
 * (idempotency on row level is a follow-up — for now duplicates are OK).
 *
 * Awaited because the caller wants to surface DB errors back to the
 * parse-engine as a 500.
 */
export async function recordParseUsage(args: {
  fileId: string;
  userId: string;
  orgId: string;
  taskType: string;
  usage: CallbackTokenUsage;
}): Promise<void> {
  const { fileId, userId, orgId, taskType, usage } = args;
  if (!usage || typeof usage !== "object") return;
  const operationId = `parse-${fileId}-${taskType}`;

  for (const [stepKey, stepUsage] of Object.entries(usage)) {
    if (!stepUsage) continue;
    // Parse-engine step keys take the shape "<step>:<model>" or just
    // "<model>". Split on the LAST colon so model ids that contain ":"
    // themselves (e.g. provider-prefixed) survive.
    const lastColon = stepKey.lastIndexOf(":");
    const operationName =
      lastColon >= 0
        ? `parse:${taskType}:${stepKey.slice(0, lastColon)}`
        : `parse:${taskType}`;
    const model = lastColon >= 0 ? stepKey.slice(lastColon + 1) : stepKey;

    await recordLlmUsage({
      operationName,
      operationId,
      subjectUserId: userId,
      subjectOrgId: orgId,
      actorUserId: userId,
      sessionId: fileId,
      model,
      inputTokens: stepUsage.input_tokens ?? 0,
      outputTokens: stepUsage.output_tokens ?? 0,
      totalTokens: stepUsage.total_tokens,
      reasoningTokens: stepUsage.output_token_details?.reasoning,
      cachedInputTokens: stepUsage.input_token_details?.cache_read,
      source: "parse",
      metadata: { fileId, taskType, stepKey },
    });
  }
}
