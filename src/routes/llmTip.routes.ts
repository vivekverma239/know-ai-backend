import { Type } from "@sinclair/typebox";
import {
  LlmTipSchema,
  LlmTipCreateBody,
  LlmTipUpdateBody,
  SuccessResponse,
} from "../schemas/llmTip.schema";
import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { llmTip } from "../db/schema";
import { v4 as uuidv4 } from "uuid";
import { eq, and } from "drizzle-orm";
import { getEmbeddings } from "../ai/embeddings";

const llmTipRoutes = async (fastify: FastifyInstance) => {
  const TipBody = LlmTipCreateBody;

  // Create
  fastify.post<{
    Body: {
      title: string;
      content: string;
      category?: string;
      userId: string;
      orgId: string;
    };
  }>("/", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Create LLM tip",
      body: TipBody,
      response: { 201: LlmTipSchema },
    },
    handler: async (request, reply) => {
      // @ts-expect-error
      const userId: string = request.user.id;
      const _requestedUserId = request.body.userId;
      const _orgId = request.body.orgId;
      const embedding = (await getEmbeddings([request.body.content]))[0];
      const newTip = await db
        .insert(llmTip)
        .values({
          id: uuidv4(),
          ...request.body,
          embedding,
          createdById: userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      return reply.code(201).send(newTip[0]);
    },
  });

  // Get all
  fastify.get<{ Querystring: { userId: string; orgId: string } }>("/", {
    preHandler: fastify.authenticate,
    schema: {
      description: "List LLM tips",
      querystring: Type.Object({ userId: Type.String(), orgId: Type.String() }),
      response: { 200: Type.Array(LlmTipSchema) },
    },
    handler: async (request, reply) => {
      const _requestedUserId = request.query.userId;
      const _orgId = request.query.orgId;
      const tips = await db.select().from(llmTip).orderBy(llmTip.createdAt);
      return reply.send(tips);
    },
  });

  // Get by id
  fastify.get<{
    Params: { id: string };
    Querystring: { userId: string; orgId: string };
  }>("/:id", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Get LLM tip by id",
      params: Type.Object({ id: Type.String() }),
      querystring: Type.Object({ userId: Type.String(), orgId: Type.String() }),
      response: { 200: LlmTipSchema },
    },
    handler: async (request, reply) => {
      // @ts-expect-error
      const userId: string = request.user.id;
      const { id } = request.params;
      const _requestedUserId = request.query.userId;
      const _orgId = request.query.orgId;
      const tip = await db
        .select()
        .from(llmTip)
        .where(and(eq(llmTip.id, id), eq(llmTip.createdById, userId)));
      return reply.send(tip[0]);
    },
  });

  // Update
  fastify.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      content?: string;
      category?: string;
      userId: string;
      orgId: string;
    };
  }>("/:id", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Update LLM tip",
      params: Type.Object({ id: Type.String() }),
      body: LlmTipUpdateBody,
      response: { 200: LlmTipSchema },
    },
    handler: async (request, reply) => {
      // @ts-expect-error
      const userId: string = request.user.id;
      const { id } = request.params;
      const { content, ...data } = request.body;
      const _requestedUserId = request.body.userId;
      const _orgId = request.body.orgId;
      let embedding: number[] | undefined = undefined;
      if (content) {
        embedding = (await getEmbeddings([content]))[0];
      }
      const updated = await db
        .update(llmTip)
        .set({ ...data, content, embedding, updatedAt: new Date() })
        .where(and(eq(llmTip.id, id), eq(llmTip.createdById, userId)))
        .returning();
      return reply.send(updated[0]);
    },
  });

  // Delete
  fastify.delete<{
    Params: { id: string };
    Querystring: { userId: string; orgId: string };
  }>("/:id", {
    preHandler: fastify.authenticate,
    schema: {
      description: "Delete LLM tip",
      params: Type.Object({ id: Type.String() }),
      querystring: Type.Object({ userId: Type.String(), orgId: Type.String() }),
      response: { 200: SuccessResponse },
    },
    handler: async (request, reply) => {
      // @ts-expect-error
      const userId: string = request.user.id;
      const { id } = request.params;
      const _requestedUserId = request.query.userId;
      const _orgId = request.query.orgId;
      await db
        .delete(llmTip)
        .where(and(eq(llmTip.id, id), eq(llmTip.createdById, userId)));
      return reply.send({ success: true });
    },
  });
};

export default llmTipRoutes;
