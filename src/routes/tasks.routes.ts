import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { runTask, type TaskName } from "../service/tasks";

const tasksRoutes = async (fastify: FastifyInstance) => {
  // Endpoint for Cloud Tasks to POST to
  fastify.post<{
    Body: { type: TaskName; data: Record<string, unknown> };
    Headers: { "x-task-token"?: string; authorization?: string };
  }>("/execute", {
    schema: {
      description: "Execute a background task",
      tags: ["Tasks"],
      headers: Type.Object({
        "x-task-token": Type.Optional(Type.String()),
        authorization: Type.Optional(Type.String()),
      }),
      body: Type.Object({
        type: Type.Union([
          Type.Literal("web_search_processing"),
          Type.Literal("parse_pdf"),
          Type.Literal("recompute_embeddings"),
        ]),
        data: Type.Record(Type.String(), Type.Unknown()),
      }),
      response: { 200: Type.Object({ ok: Type.Boolean() }) },
    },
    preHandler: async (request, reply) => {
      const configuredToken = process.env.TASK_EXECUTOR_TOKEN;
      if (!configuredToken) return;
      const headerToken =
        request.headers["x-task-token"] ||
        request.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (headerToken !== configuredToken) {
        return reply.code(401).send({ ok: false });
      }
    },
    handler: async (request, reply) => {
      const { type, data } = request.body;
      await runTask(type, data);
      return reply.send({ ok: true });
    },
  });
};

export default tasksRoutes;
