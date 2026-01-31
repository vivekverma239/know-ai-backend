import { webAgent } from "@/agents/webAgent";
import { getDb } from "@/db";
import { webSearchTask } from "@/db/schema";
import { sendQstashMessage } from "@/service/qstash";
import { logger } from "@/utils/logger";
import { Type } from "@sinclair/typebox";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { AgentResultSchema, WebSearchTaskSchema } from "../schemas/webSearch.schema";

const webSearchRoutes = async (fastify: FastifyInstance) => {
  // Create task and enqueue background processing
  fastify.post<{ Body: { query: string; userId: string; orgId: string } }>("/tasks", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Create a web search task",
      tags: ["Web Search"],
      body: Type.Object({
        query: Type.String(),
        userId: Type.String(),
        orgId: Type.String(),
      }),
      response: { 201: WebSearchTaskSchema },
    },
    handler: async (request, reply) => {
      // added by auth plugin
      const _requestedUserId = request.user?.id;
      const _orgId = request.body.orgId;
      const { query } = request.body;
      if (!_requestedUserId) {
        return reply.code(400).send({ message: "User ID is required" });
      }
      if (!_orgId) {
        return reply.code(400).send({ message: "Org ID is required" });
      }

      const task = await getDb()
        .insert(webSearchTask)
        .values({ userId: _requestedUserId, query, status: "pending" })
        .returning();

      if (task[0]) {
        try {
          await sendQstashMessage("api/web-search-callback", {
            type: "web_search_processing",
            data: { taskId: task[0].id },
          });
          logger.info("Web search task queued", {
            taskId: task[0].id,
            userId: _requestedUserId,
          });
        } catch (error) {
          logger.error("Failed to queue web search task", { error });
          await getDb()
            .update(webSearchTask)
            .set({
              status: "failed",
              error: "Failed to queue task for execution",
              updatedAt: new Date(),
            })
            .where(eq(webSearchTask.id, task[0].id));
        }
      }

      return reply.code(201).send(task[0]);
    },
  });

  // Get task by id
  fastify.get<{
    Params: { id: string };
    Querystring: { userId: string; orgId: string };
  }>("/tasks/:id", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Get a web search task",
      tags: ["Web Search"],
      params: Type.Object({ id: Type.String() }),
      querystring: Type.Object({ userId: Type.String(), orgId: Type.String() }),
      response: { 200: WebSearchTaskSchema },
    },
    handler: async (request, reply) => {
      // added by auth plugin
      const { id } = request.params;
      const _requestedUserId = request.query.userId;
      const _orgId = request.query.orgId;
      const task = await getDb().query.webSearchTask.findFirst({
        where: eq(webSearchTask.id, id),
      });
      if (!task || task.userId !== _requestedUserId) {
        return reply.code(404).send({ message: "Task not found" });
      }
      return reply.send(task);
    },
  });

  // List current user's tasks
  fastify.get<{ Querystring: { userId: string; orgId: string } }>("/tasks", {
    preHandler: fastify.authenticate,
    schema: {
      description: "List web search tasks for current user",
      tags: ["Web Search"],
      querystring: Type.Object({ userId: Type.String(), orgId: Type.String() }),
      response: { 200: Type.Array(WebSearchTaskSchema) },
    },
    handler: async (request, reply) => {
      // added by auth plugin

      const _requestedUserId = request.query.userId;
      const _orgId = request.query.orgId;
      if (!_requestedUserId) {
        return reply.code(400).send({ message: "User ID is required" });
      }
      if (!_orgId) {
        return reply.code(400).send({ message: "Org ID is required" });
      }
      const tasks = await getDb().query.webSearchTask.findMany({
        where: eq(webSearchTask.userId, _requestedUserId),
        orderBy: (tasks, { desc }) => [desc(tasks.createdAt)],
      });
      return reply.send(tasks);
    },
  });

  // Retry a failed task
  fastify.post<{ Body: { taskId: string; userId: string; orgId: string } }>("/tasks/retry", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Retry a failed web search task",
      tags: ["Web Search"],
      body: Type.Object({
        taskId: Type.String(),
        userId: Type.String(),
        orgId: Type.String(),
      }),
      response: { 200: Type.Object({ success: Type.Boolean() }) },
    },
    handler: async (request, reply) => {
      // added by auth plugin
      const { taskId } = request.body;
      const _requestedUserId = request.body.userId;
      const _orgId = request.body.orgId;
      const task = await getDb().query.webSearchTask.findFirst({
        where: eq(webSearchTask.id, taskId),
      });
      if (!task || task.userId !== _requestedUserId || task.status !== "failed") {
        return reply.code(400).send({ message: "Task not eligible for retry" });
      }
      await getDb()
        .update(webSearchTask)
        .set({ status: "pending", error: null, updatedAt: new Date() })
        .where(eq(webSearchTask.id, taskId));
      await sendQstashMessage("api/web-search-callback", {
        type: "web_search_processing",
        data: { taskId },
      });
      return reply.send({ success: true });
    },
  });

  // Legacy: direct agent invocation without tasking
  fastify.post<{ Body: { query: string; userId: string; orgId: string } }>("/doc-agent-search", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Legacy: execute web agent directly",
      tags: ["Web Search"],
      body: Type.Object({
        query: Type.String(),
        userId: Type.String(),
        orgId: Type.String(),
      }),
      response: { 200: AgentResultSchema },
    },
    handler: async (request, reply) => {
      const { query } = request.body;
      const _requestedUserId = request.body.userId;
      const _orgId = request.body.orgId;
      const result = await webAgent(query, {
        userId: _requestedUserId,
        orgId: _orgId ?? "",
        sessionId: "direct-invocation",
      });
      return reply.send(result ?? { sources: [], helpfulText: "" });
    },
  });
};

export default webSearchRoutes;
