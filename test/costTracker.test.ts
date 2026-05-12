import { getDb } from "@/db";
import { tokenUsageLog } from "@/db/schema";
import { recordLlmUsage } from "@/utils/costTracker";
import { withRequestContext } from "@/utils/requestContext";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

describe("recordLlmUsage", () => {
  const operationId = `test-op-${Date.now()}`;
  const childOperationId = `${operationId}-child`;

  afterAll(async () => {
    await getDb().delete(tokenUsageLog).where(eq(tokenUsageLog.operationId, operationId));
    await getDb().delete(tokenUsageLog).where(eq(tokenUsageLog.operationId, childOperationId));
  });

  it("inserts a row with subject, actor, source, and computed cost", async () => {
    await withRequestContext(
      {
        requestId: `req-${operationId}`,
        userId: "subject-user",
        actorUserId: "actor-admin",
        sessionId: "sess-1",
        orgId: "org-1",
        path: "/test",
        method: "POST",
        timestamp: new Date(),
        metadata: {},
      },
      async () => {
        await recordLlmUsage({
          operationName: "test:finAgent",
          operationId,
          model: "gpt-5.5-2026-04-23",
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          source: "chat",
        });
      },
    );

    const rows = await getDb()
      .select()
      .from(tokenUsageLog)
      .where(eq(tokenUsageLog.operationId, operationId));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operationName: "test:finAgent",
      operationId,
      userId: "subject-user",
      actorUserId: "actor-admin",
      sessionId: "sess-1",
      orgId: "org-1",
      source: "chat",
      model: "gpt-5.5-2026-04-23",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    });
    // Cost is > 0 with either tokenlens or fallback pricing for gpt-5.5.
    expect(Number(rows[0].costEstimate)).toBeGreaterThan(0);
  });

  it("records explicit subject/actor without a request context (parse-callback pattern)", async () => {
    await recordLlmUsage({
      operationName: "test:parseStep",
      operationId: childOperationId,
      parentOperationId: operationId,
      subjectUserId: "explicit-subject",
      subjectOrgId: "explicit-org",
      actorUserId: "explicit-subject",
      model: "gemini-3-flash-preview",
      inputTokens: 500,
      outputTokens: 50,
      totalTokens: 550,
      source: "parse",
      metadata: { fileId: "file-1", taskType: "parse_pdf" },
    });

    const rows = await getDb()
      .select()
      .from(tokenUsageLog)
      .where(eq(tokenUsageLog.operationId, childOperationId));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operationName: "test:parseStep",
      parentOperationId: operationId,
      userId: "explicit-subject",
      actorUserId: "explicit-subject",
      orgId: "explicit-org",
      source: "parse",
    });
  });
});
