import type { Message as SQLMessage } from "@/@types";
import { MODELS } from "@/@types/llm";
import { type FinAgentUIMessage, finAgent } from "@/agents/finAgent";
import { getSession, syncMessages } from "@/db/queries/message";
import { AuthenticationError, NotFoundError, ValidationError } from "@/utils/errorHandler";
import { logger } from "@/utils/logger";
import { setSubjectIdentity } from "@/utils/requestContext";
import { getTracer, observe } from "@lmnr-ai/lmnr";
import { Type } from "@sinclair/typebox";
import { convertToModelMessages, createUIMessageStreamResponse } from "ai";
import type { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";

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
        throw new AuthenticationError("Unauthorized");
      }
      const userId: string = user.id;
      const orgId: string = user.orgId;
      const { messages, sessionId, webSearch, fileAnswerModel } = request.body;

      // Lock in subject + actor identity for token usage attribution. The
      // user-facing route has no impersonation, so subject == actor == JWT
      // user. This also fixes the upstream bug where requestContext.userId
      // was read from x-user-id header only (and was missing for JWT-auth'd
      // requests), causing token_usage_log rows to have userId=null.
      setSubjectIdentity({
        userId,
        orgId,
        sessionId,
        actorUserId: userId,
      });

      // Check if sessionId is valid
      const session = await getSession(sessionId);
      if (!session) {
        throw new NotFoundError("Invalid sessionId");
      }
      if (session.userId !== userId) {
        throw new ValidationError("Invalid sessionId");
      }

      const fileAnswerModelEnum = (fileAnswerModel as MODELS) || MODELS.GROK_4_1_FAST;

      const saveMessages = async (messagesToSave: FinAgentUIMessage[]) => {
        const sqlMessages: SQLMessage[] = messagesToSave.map((message) => {
          return {
            id: message.id || uuidv4(),
            role: message.role,
            parts: message.parts,
            metadata: message.data,
            createdAt: new Date(),
            updatedAt: null,
            sessionId,
            userId,
          } as unknown as SQLMessage;
        });

        if (sqlMessages.length > 0) {
          await syncMessages(sqlMessages);
        }
      };

      // Persist user input before invoking the agent stream.
      const incomingUserMessages = messages.filter((message) => message.role === "user");
      await saveMessages(incomingUserMessages);

      const result = await observe({ name: "finAgent" }, () =>
        finAgent({
          context: { userId, sessionId, orgId, teamIds: user.teamIds },
          messages,
          saveMessage: async (message: FinAgentUIMessage) => {
            await saveMessages([message]);
          },
          // Default web search + bulk indexing on so the FinAgent has access
          // to webDocSearchTool / bulkFileIndexingTool / webSearchTool /
          // webPageScrapeTool out of the box.
          webSearch: webSearch ?? true,
          fileAnswerModel: fileAnswerModelEnum,
        }),
      );

      return reply.send(
        result.toUIMessageStreamResponse({
          originalMessages: messages as FinAgentUIMessage[],
          onFinish: async ({ messages: finishedMessages }) => {
            try {
              await saveMessages(finishedMessages as FinAgentUIMessage[]);
            } catch (error) {
              logger.error("Failed to persist messages on stream finish", {
                error: error instanceof Error ? error.message : String(error),
                sessionId,
              });
            }
          },
        }),
      );
    },
  );
};

export default finAgentRoutes;
