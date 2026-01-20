import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { Receiver } from "@upstash/qstash";
import { getDb } from "@/db";
import { eq } from "drizzle-orm";
import { webSearchTask } from "@/db/schema";
import { webAgent } from "@/agents/webAgent";
import { logger } from "@/utils/logger";

const webSearchCallbackRoutes = async (fastify: FastifyInstance) => {
  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY ?? "",
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY ?? "",
  });

  fastify.post(
    "/",
    {
      schema: {
        description: "Upstash QStash callback for web search tasks",
        tags: ["Callbacks"],
        headers: Type.Object({
          "upstash-signature": Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Object({
            success: Type.Boolean(),
            taskId: Type.Optional(Type.String()),
          }),
          400: Type.Object({
            success: Type.Boolean(),
            error: Type.Optional(Type.String()),
          }),
          404: Type.Object({
            success: Type.Boolean(),
            error: Type.Optional(Type.String()),
          }),
          500: Type.Object({
            success: Type.Boolean(),
            error: Type.Optional(Type.String()),
          }),
        },
      },
    },
    async (request, reply) => {
      try {
        const signature = (request.headers["upstash-signature"] ??
          request.headers["Upstash-Signature"]) as string | undefined;
        if (!signature) {
          logger.warn("Web search callback: No signature provided");
          return reply.code(400).send({ success: false });
        }

        // Best-effort raw body reconstruction
        const bodyText =
          typeof request.body === "string"
            ? (request.body as string)
            : JSON.stringify(request.body ?? {});

        try {
          const isValid = await receiver.verify({ body: bodyText, signature });
          if (!isValid) {
            logger.warn("Web search callback: Invalid signature");
            return reply.code(400).send({ success: false });
          }
        } catch (err) {
          logger.error("Web search callback: Error verifying signature", {
            error: err instanceof Error ? err.message : String(err),
          });
          return reply.code(400).send({ success: false });
        }

        const { type, data } = JSON.parse(bodyText) as {
          type: string;
          data: { taskId?: string };
        };

        if (type !== "web_search_processing") {
          logger.warn("Web search callback: Invalid message type", { type });
          return reply.code(400).send({ success: false });
        }

        const taskId = data?.taskId;
        if (!taskId || typeof taskId !== "string") {
          logger.warn("Web search callback: Invalid or missing taskId", {
            taskId,
          });
          return reply.code(400).send({ success: false });
        }

        const task = await getDb().query.webSearchTask.findFirst({
          where: eq(webSearchTask.id, taskId),
        });
        if (!task) {
          logger.error("Web search task not found", { taskId });
          return reply.code(404).send({ success: false });
        }
        if (task.status !== "pending") {
          logger.warn("Web search task is not pending", {
            taskId,
            status: task.status,
          });
          return reply.code(400).send({ success: false });
        }

        await getDb()
          .update(webSearchTask)
          .set({ status: "in_progress", updatedAt: new Date() })
          .where(eq(webSearchTask.id, taskId));

        try {
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error("Web agent execution timeout")),
              5 * 60 * 1000
            );
          });
          const result = (await Promise.race([
            webAgent(task.query, {
              userId: task.userId,
              orgId: "", // OrgId unused in web search tools currently or unavailable in task
              sessionId: taskId,
            }),
            timeoutPromise,
          ])) as Awaited<ReturnType<typeof webAgent>>;

          await getDb()
            .update(webSearchTask)
            .set({
              status: "completed",
              sources: result?.sources,
              helpfulText: result?.helpfulText,
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(webSearchTask.id, taskId));

          return reply.send({ success: true, taskId });
        } catch (error) {
          logger.error("Web search task failed", {
            taskId,
            error: error instanceof Error ? error.message : String(error),
          });
          await getDb()
            .update(webSearchTask)
            .set({
              status: "failed",
              error: error instanceof Error ? error.message : String(error),
              updatedAt: new Date(),
            })
            .where(eq(webSearchTask.id, taskId));
          return reply.code(500).send({ success: false, taskId });
        }
      } catch (error) {
        logger.error("Web search callback handler error", {
          error: error instanceof Error ? error.message : String(error),
        });
        return reply.code(500).send({ success: false });
      }
    }
  );
};

export default webSearchCallbackRoutes;
