import { webAgent } from "@/agents/webAgent";
import { getDb } from "@/db";
import { webSearchTask } from "@/db/schema";
import { sendQstashMessage } from "@/service/qstash";
import { logger } from "@/utils/logger";
import { Type } from "@sinclair/typebox";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { AgentResultSchema, WebSearchTaskSchema } from "../schemas/webSearch.schema";
import { AuthenticationError, NotFoundError, ValidationError } from "../utils/errorHandler";

const webSearchRoutes = async (fastify: FastifyInstance) => {
  // Create task and enqueue background processing
  fastify.post<{ Body: { query: string } }>("/tasks", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Create a web search task",
      tags: ["Web Search"],
      body: Type.Object({
        query: Type.String(),
      }),
      response: { 201: WebSearchTaskSchema },
    },
    handler: async (request, reply) => {
      const { query } = request.body;
      const requestedUserId = request.user?.id;
      if (!requestedUserId) {
        throw new AuthenticationError("Unauthorized");
      }

      const task = await getDb()
        .insert(webSearchTask)
        .values({ userId: requestedUserId, query, status: "pending" })
        .returning();

      if (task[0]) {
        try {
          await sendQstashMessage("api/web-search-callback", {
            type: "web_search_processing",
            data: { taskId: task[0].id },
          });
          logger.info("Web search task queued", {
            taskId: task[0].id,
            userId: requestedUserId,
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
  }>("/tasks/:id", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Get a web search task",
      tags: ["Web Search"],
      params: Type.Object({ id: Type.String() }),
      response: { 200: WebSearchTaskSchema },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const requestedUserId = request.user?.id;
      if (!requestedUserId) {
        throw new AuthenticationError("Unauthorized");
      }
      const task = await getDb().query.webSearchTask.findFirst({
        where: eq(webSearchTask.id, id),
      });
      if (!task || task.userId !== requestedUserId) {
        throw new NotFoundError("Task not found");
      }
      return reply.send(task);
    },
  });

  // List current user's tasks
  fastify.get("/tasks", {
    preHandler: fastify.authenticate,
    schema: {
      description: "List web search tasks for current user",
      tags: ["Web Search"],
      response: {
        200: Type.Array(WebSearchTaskSchema),
      },
    },
    handler: async (request, reply) => {
      const requestedUserId = request.user?.id;
      if (!requestedUserId) {
        throw new AuthenticationError("Unauthorized");
      }
      const tasks = await getDb().query.webSearchTask.findMany({
        where: eq(webSearchTask.userId, requestedUserId),
        orderBy: (tasks, { desc }) => [desc(tasks.createdAt)],
      });
      return reply.send(tasks);
    },
  });

  // Retry a failed task
  fastify.post<{ Body: { taskId: string } }>("/tasks/retry", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Retry a failed web search task",
      tags: ["Web Search"],
      body: Type.Object({
        taskId: Type.String(),
      }),
      response: { 200: Type.Object({ success: Type.Boolean() }) },
    },
    handler: async (request, reply) => {
      const { taskId } = request.body;
      const requestedUserId = request.user?.id;
      if (!requestedUserId) {
        throw new AuthenticationError("Unauthorized");
      }
      const task = await getDb().query.webSearchTask.findFirst({
        where: eq(webSearchTask.id, taskId),
      });
      if (!task || task.userId !== requestedUserId || task.status !== "failed") {
        throw new ValidationError("Task not eligible for retry");
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
  fastify.post<{ Body: { query: string } }>("/doc-agent-search", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Legacy: execute web agent directly",
      tags: ["Web Search"],
      body: Type.Object({
        query: Type.String(),
      }),
      response: { 200: AgentResultSchema },
    },
    handler: async (request, reply) => {
      const { query } = request.body;
      const requestedUserId = request.user?.id;
      const requestedOrgId = request.user?.orgId;
      if (!requestedUserId || !requestedOrgId) {
        throw new AuthenticationError("Unauthorized");
      }
      const result = await webAgent(query, {
        userId: requestedUserId,
        orgId: requestedOrgId,
        teamIds: request.user?.teamIds ?? [],
        sessionId: "direct-invocation",
      });
      return reply.send(result ?? { sources: [], helpfulText: "" });
    },
  });
};

export default webSearchRoutes;
