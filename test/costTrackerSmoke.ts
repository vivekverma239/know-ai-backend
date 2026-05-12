/**
 * Manual smoke test for cost/token tracking.
 *
 *   pnpm test:cost-tracker
 *
 * Drives the same code paths an in-flight request would, except the LLM call
 * is replaced with direct calls to `recordLlmUsage` / `recordParseUsage` so
 * the script does not consume real model quota. The resulting rows are read
 * back from `token_usage_log` and printed for a human to eyeball.
 *
 * Cleans up its own rows on exit. Run against a dev DB only.
 */
import { getDb } from "@/db";
import { tokenUsageLog } from "@/db/schema";
import { recordLlmUsage } from "@/utils/costTracker";
import { withRequestContext } from "@/utils/requestContext";
import { recordParseUsage } from "@/service/file/usage";
import { and, eq } from "drizzle-orm";

const REQUEST_ID = `smoke-${Date.now()}`;
const SUBJECT_USER_ID = `smoke-subject-${Date.now()}`;
const ACTOR_USER_ID = `smoke-actor-${Date.now()}`;
const ORG_ID = `smoke-org-${Date.now()}`;
const SESSION_ID = `smoke-session-${Date.now()}`;
const FILE_ID = `smoke-file-${Date.now()}`;
const PARENT_OP_ID = `smoke-finAgent-${Date.now()}`;
const CHILD_OP_ID = `${PARENT_OP_ID}-child`;
const PARSE_OP_ID = `parse-${FILE_ID}-parse_pdf`;

function fail(reason: string): never {
  console.error(`✗ ${reason}`);
  process.exit(1);
}

function ok(label: string) {
  console.log(`✓ ${label}`);
}

async function main() {
  console.log(`smoke run id=${REQUEST_ID}`);

  // 1. Simulate an admin-impersonated chat turn (subject != actor).
  await withRequestContext(
    {
      requestId: REQUEST_ID,
      userId: SUBJECT_USER_ID,
      actorUserId: ACTOR_USER_ID,
      sessionId: SESSION_ID,
      orgId: ORG_ID,
      path: "/smoke",
      method: "POST",
      timestamp: new Date(),
      metadata: {},
    },
    async () => {
      await recordLlmUsage({
        operationName: "smoke:finAgent",
        operationId: PARENT_OP_ID,
        messageId: `msg-${REQUEST_ID}`,
        model: "gpt-5.5-2026-04-23",
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        reasoningTokens: 50,
        source: "chat",
        metadata: { agent: "finAgent", smoke: true },
      });
      await recordLlmUsage({
        operationName: "smoke:fileAnswerTool",
        operationId: CHILD_OP_ID,
        parentOperationId: PARENT_OP_ID,
        model: "gemini-3-flash-preview",
        inputTokens: 8000,
        outputTokens: 400,
        totalTokens: 8400,
        cachedInputTokens: 6000,
        source: "tool",
        metadata: { tool: "fileAnswer", smoke: true },
      });
    },
  );

  // 2. Simulate a parse-engine callback (no request context, subject = file owner).
  // NOTE: parse-engine occasionally emits dash-form slugs ("gemini-2-5-flash")
  // which do not match our MODELS enum keys ("gemini-2.5-flash") and therefore
  // get priced at $0. That normalization is tracked as a follow-up. The smoke
  // here uses canonical (dotted) slugs so the cost path is exercised.
  await recordParseUsage({
    fileId: FILE_ID,
    userId: SUBJECT_USER_ID,
    orgId: ORG_ID,
    taskType: "parse_pdf",
    usage: {
      "outline:gemini-2.5-flash-lite-preview-06-17": {
        input_tokens: 200,
        output_tokens: 50,
        total_tokens: 250,
        input_token_details: { cache_read: 80 },
        output_token_details: { reasoning: 10 },
      },
      "extract:gemini-2.5-flash": {
        input_tokens: 5000,
        output_tokens: 1200,
        total_tokens: 6200,
        input_token_details: {},
        output_token_details: {},
      },
    },
  });

  // 3. Verify chat rows.
  const chatRows = await getDb()
    .select()
    .from(tokenUsageLog)
    .where(eq(tokenUsageLog.requestId, REQUEST_ID));

  console.log("\nchat rows:");
  for (const r of chatRows) {
    console.log(
      `  op=${r.operationName.padEnd(28)} model=${r.model.padEnd(28)} ` +
        `tokens=${String(r.totalTokens).padStart(5)} cost=$${r.costEstimate} ` +
        `subject=${r.userId} actor=${r.actorUserId} source=${r.source}`,
    );
  }

  if (chatRows.length !== 2) fail(`expected 2 chat rows, got ${chatRows.length}`);
  ok("inserted 2 chat rows");

  const finRow = chatRows.find((r) => r.operationId === PARENT_OP_ID);
  if (!finRow) fail("finAgent row missing");
  if (finRow.userId !== SUBJECT_USER_ID || finRow.actorUserId !== ACTOR_USER_ID) {
    fail(
      `subject/actor mismatch on finAgent row: subject=${finRow.userId} actor=${finRow.actorUserId}`,
    );
  }
  if (finRow.source !== "chat") fail(`source mismatch on finAgent row: ${finRow.source}`);
  if (Number(finRow.costEstimate) <= 0) fail("cost not computed on finAgent row");
  ok("finAgent row: subject != actor preserved, source=chat, cost > 0");

  const toolRow = chatRows.find((r) => r.operationId === CHILD_OP_ID);
  if (!toolRow) fail("fileAnswerTool row missing");
  if (toolRow.parentOperationId !== PARENT_OP_ID) {
    fail(`parentOperationId not set on tool row: ${toolRow.parentOperationId}`);
  }
  if (toolRow.cachedInputTokens !== 6000) {
    fail(`cachedInputTokens wrong on tool row: ${toolRow.cachedInputTokens}`);
  }
  ok("tool row: parent linkage + cachedInputTokens recorded");

  // 4. Verify parse rows.
  const parseRows = await getDb()
    .select()
    .from(tokenUsageLog)
    .where(
      and(eq(tokenUsageLog.operationId, PARSE_OP_ID), eq(tokenUsageLog.source, "parse")),
    );

  console.log("\nparse rows:");
  for (const r of parseRows) {
    console.log(
      `  op=${r.operationName.padEnd(40)} model=${r.model.padEnd(28)} ` +
        `tokens=${String(r.totalTokens).padStart(5)} cost=$${r.costEstimate} ` +
        `subject=${r.userId}`,
    );
  }

  if (parseRows.length !== 2) fail(`expected 2 parse rows, got ${parseRows.length}`);
  ok("inserted 2 parse rows (one per step:model)");

  for (const r of parseRows) {
    if (r.source !== "parse") fail(`parse row has wrong source: ${r.source}`);
    if (r.userId !== SUBJECT_USER_ID) fail(`parse row subject != file owner: ${r.userId}`);
    if (r.actorUserId !== SUBJECT_USER_ID) {
      fail(`parse row actor != subject (callbacks should mirror): ${r.actorUserId}`);
    }
    if (r.sessionId !== FILE_ID) fail(`parse row sessionId != fileId: ${r.sessionId}`);
    if (Number(r.costEstimate) <= 0) {
      fail(
        `parse row cost not computed for model=${r.model}: tokenlens mapping likely stale`,
      );
    }
  }
  ok("parse rows: subject = actor = file owner, sessionId = fileId, cost > 0");

  // 5. Cleanup.
  const deleted = await getDb()
    .delete(tokenUsageLog)
    .where(
      and(
        eq(tokenUsageLog.userId, SUBJECT_USER_ID),
        eq(tokenUsageLog.orgId, ORG_ID),
      ),
    )
    .returning({ id: tokenUsageLog.id });
  ok(`cleaned up ${deleted.length} smoke rows`);

  console.log("\nsmoke OK");
  process.exit(0);
}

main().catch((err) => {
  console.error("smoke FAIL:", err);
  process.exit(1);
});
