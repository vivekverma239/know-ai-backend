import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { chatSession, messages } from "../db/schema";
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { ChatSessionSchema, MessagesResponse } from "../schemas/chat.schema";

const chatSessionRoutes = async (fastify: FastifyInstance) => {
  // List chat sessions (paged)
  fastify.get<{
    Querystring: {
      page?: number;
      limit?: number;
      userId: string;
      orgId: string;
    };
  }>("/", {
    preHandler: fastify.authenticate,
    schema: {
      description: "List chat sessions",
      querystring: Type.Object({
        page: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number()),
        userId: Type.String(),
        orgId: Type.String(),
      }),
      response: { 200: { type: "array", items: ChatSessionSchema } },
    },
    handler: async (request, reply) => {
      // @ts-expect-error
      const userId: string = request.user.id;
      const _requestedUserId = request.query.userId;
      const _orgId = request.query.orgId;
      const page = request.query.page ?? 1;
      const limit = request.query.limit ?? 10;
      const offset = (page - 1) * limit;
      const sessions = await db.query.chatSession.findMany({
        where: eq(chatSession.userId, userId),
        limit,
        offset,
      });
      return reply.send(sessions);
    },
  });

  // Create chat session
  fastify.post<{ Body: { userId: string; orgId: string } }>("/", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Create chat session",
      body: Type.Object({ userId: Type.String(), orgId: Type.String() }),
      response: { 201: ChatSessionSchema },
    },
    handler: async (request, reply) => {
      // @ts-expect-error
      const userId: string = request.user.id;
      const _requestedUserId = request.body.userId;
      const _orgId = request.body.orgId;
      const session = await db
        .insert(chatSession)
        .values({ title: "New Session", userId });
      return reply.code(201).send(session);
    },
  });

  // Get messages for session
  fastify.get<{
    Params: { id: string };
    Querystring: { userId: string; orgId: string };
  }>("/:id/messages", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Get messages for chat session",
      params: Type.Object({ id: Type.String() }),
      querystring: Type.Object({ userId: Type.String(), orgId: Type.String() }),
      response: { 200: MessagesResponse },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const _requestedUserId = request.query.userId;
      const _orgId = request.query.orgId;
      const sessionMessages = await db.query.messages.findMany({
        where: eq(messages.sessionId, id),
        orderBy: asc(messages.createdAt),
      });
      return reply.send(sessionMessages);
    },
  });
};

export default chatSessionRoutes;
