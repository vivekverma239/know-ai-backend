import type { Message as SQLMessage } from "@/@types";
import { MODELS } from "@/@types/llm";
import { type FinAgentUIMessage, finAgent } from "@/agents/finAgent";
import { getSession, syncMessages } from "@/db/queries/message";
import { logger } from "@/utils/logger";
import { getTracer, observe } from "@lmnr-ai/lmnr";
import { Type } from "@sinclair/typebox";
import { convertToModelMessages, createUIMessageStreamResponse } from "ai";
import type { FastifyInstance } from "fastify";

export interface FinAgentPostBody {
  messages: FinAgentUIMessage[];
  sessionId: string;
  webSearch?: boolean;
  fileAnswerModel?: string;
}

const finAgentRoutes = async (fastify: FastifyInstance) => {
  fastify.post<{ Body: FinAgentPostBody }>(
    "/",
    {
      preHandler: fastify.authenticate,
      schema: {
        description: "Fin Agent streaming chat endpoint",
        tags: ["Chat"],
        body: Type.Object({
          messages: Type.Array(Type.Any()),
          sessionId: Type.String(),
          webSearch: Type.Optional(Type.Boolean()),
          fileAnswerModel: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Any({
            description: "Streaming response from Fin Agent",
          }),
        },
      },
    },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const userId: string = user.id;
      const orgId: string = user.orgId;
      const { messages, sessionId, webSearch, fileAnswerModel } = request.body;

      // Check if sessionId is valid
      const session = await getSession(sessionId);
      if (!session || session.userId !== userId) {
        return reply.code(400).send({ error: "Invalid sessionId" });
      }

      const fileAnswerModelEnum = (fileAnswerModel as MODELS) || MODELS.GROK_CODE_FAST_1;

      const saveMessage = async (message: FinAgentUIMessage) => {
        const sqlMsg: SQLMessage = {
          id: message.id || "",
          role: message.role,
          parts: [],
          metadata: message.data,
          createdAt: new Date(),
          updatedAt: null,
          sessionId: sessionId,
          userId: userId,
        } as unknown as SQLMessage;

        const msgWithContent = message as FinAgentUIMessage;
        if (msgWithContent.parts.length > 0) {
          // simplified content extraction for syncMessages if needed
        }

        await syncMessages([sqlMsg]);
      };

      const result = await observe({ name: "finAgent" }, () =>
        finAgent({
          context: { userId, sessionId, orgId, teamIds: user.teamIds },
          messages,
          saveMessage,
          webSearch: webSearch ?? false,
          fileAnswerModel: fileAnswerModelEnum,
        }),
      );

      return reply.send(
        result.toUIMessageStreamResponse({
          originalMessages: messages as FinAgentUIMessage[],
          onFinish: async ({ messages, responseMessage }) => {
            // Final sync of messages handled in result.toUIMessageStreamResponse?
            // Usually we want to save the assistant response.
            // The result.toUIMessageStreamResponse handles it via onFinish callback messages.
            const lastMessage = messages[messages.length - 1];
            if (lastMessage) {
              await saveMessage(lastMessage);
            }
          },
        }),
      );
    },
  );
};

export default finAgentRoutes;
