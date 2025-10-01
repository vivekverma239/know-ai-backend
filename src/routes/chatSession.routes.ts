import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import {
  getSessionWithMessages,
  createSession,
  listSessions,
} from "../db/queries/message";
import {
  SessionWithMessagesResponse,
  ListSessionsResponse,
} from "../schemas/chat.schema";

const chatRoutes = async (fastify: FastifyInstance) => {
  // Get a chat session with its messages
  fastify.get<{
    Params: { id: string };
  }>("/:id", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Get a chat session with messages",
      tags: ["Chat"],
      params: Type.Object({ id: Type.String() }),
      response: { 200: SessionWithMessagesResponse },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const userId: string = user.id;
      const orgId: string = user.orgId;
      const { id } = request.params as any;
      const session = await getSessionWithMessages(id, userId);
      return reply.send(session);
    },
  });

  // Create a new chat session
  fastify.post<{
    Body: { id: string; title: string };
  }>("/", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Create a new chat session",
      tags: ["Chat"],
      body: Type.Object({
        id: Type.String(),
        title: Type.String(),
      }),
      response: {
        201: Type.Object({
          id: Type.String(),
          title: Type.String(),
          userId: Type.String(),
          createdAt: Type.String(),
          updatedAt: Type.Optional(Type.String()),
        }),
      },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const userId: string = user.id;
      const orgId: string = user.orgId;
      const { id, title } = request.body as any;
      const session = await createSession(userId, id, title);
      return reply.code(201).send(session);
    },
  });

  // List sessions for the authenticated user with cursor pagination
  fastify.get<{
    Querystring: {
      cursor?: string;
      limit?: number;
    };
  }>("/", {
    preHandler: fastify.authenticate,
    schema: {
      description: "List chat sessions for current user",
      tags: ["Chat"],
      querystring: Type.Object({
        cursor: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
      }),
      response: { 200: ListSessionsResponse },
    },
    handler: async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const userId: string = user.id;
      const orgId: string = user.orgId;
      const { cursor, limit = 10 } = (request.query as any) ?? {};
      const sessions = await listSessions(userId, limit, cursor);
      return reply.send({
        sessions,
        nextCursor:
          sessions.length === limit
            ? sessions[sessions.length - 1]?.id
            : undefined,
      });
    },
  });
};

export default chatRoutes;
