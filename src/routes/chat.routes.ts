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
    Querystring: { userId: string; orgId: string };
  }>("/:id", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Get a chat session with messages",
      params: Type.Object({ id: Type.String() }),
      querystring: Type.Object({
        userId: Type.String(),
        orgId: Type.String(),
      }),
      response: { 200: SessionWithMessagesResponse },
    },
    handler: async (request, reply) => {
      // @ts-expect-error added by auth plugin
      const userId: string | undefined = request.user?.id;
      if (!userId) {
        return reply.code(401).send({ message: "Unauthorized" });
      }
      const { id } = request.params;
      // Required params now
      const _requestedUserId = request.query.userId;
      const _orgId = request.query.orgId;
      const session = await getSessionWithMessages(id, userId);
      return reply.send(session);
    },
  });

  // Create a new chat session
  fastify.post<{
    Body: { id: string; title: string; userId: string; orgId: string };
  }>("/session", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Create a new chat session",
      body: Type.Object({
        id: Type.String(),
        title: Type.String(),
        userId: Type.String(),
        orgId: Type.String(),
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
      // @ts-expect-error added by auth plugin
      const userId: string | undefined = request.user?.id;
      if (!userId) {
        return reply.code(401).send({ message: "Unauthorized" });
      }
      const { id, title } = request.body;
      const _requestedUserId = request.body.userId;
      const _orgId = request.body.orgId;
      const session = await createSession(userId, id, title);
      return reply.code(201).send(session);
    },
  });

  // List sessions for the authenticated user with cursor pagination
  fastify.get<{
    Querystring: {
      cursor?: string;
      limit?: number;
      userId: string;
      orgId: string;
    };
  }>("/sessions", {
    preHandler: fastify.authenticate,
    schema: {
      description: "List chat sessions for current user",
      querystring: Type.Object({
        cursor: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        userId: Type.String(),
        orgId: Type.String(),
      }),
      response: { 200: ListSessionsResponse },
    },
    handler: async (request, reply) => {
      // @ts-expect-error added by auth plugin
      const userId: string | undefined = request.user?.id;
      if (!userId) {
        return reply.code(401).send({ message: "Unauthorized" });
      }
      const { cursor, limit = 10 } = request.query ?? {};
      const _requestedUserId = request.query.userId;
      const _orgId = request.query.orgId;
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
