import type { Message as SQLMessage } from "@/@types";
import type { StepMessage } from "@/@types/agents";
import { MODELS } from "@/@types/llm";
import { processDeepSearchQuery } from "@/agents/deepResearch";
import { summarizeChat } from "@/ai-backend/chatSummary";
import { getLLM } from "@/ai-backend/llm";
import { updateSession } from "@/db/mutation/session";
import { getLatestSessionId, getSession, syncMessages } from "@/db/queries/message";
import { similaritySearchChunksWithObserver } from "@/service/simSearch";
import { AuthenticationError, AuthorizationError, NotFoundError } from "@/utils/errorHandler";
import { createContextLogger, logger } from "@/utils/logger";
import { getTracer, observe } from "@lmnr-ai/lmnr";
import { Type } from "@sinclair/typebox";
import {
  type UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
} from "ai";
import type { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

const SYSTEM_PROMPT = `\nYou are a helpful assistant.\n\nYou  have an access to knowledge base tool which can provide you with \nadditional information about any topic. Feel free to use it to answer\nany of the user questions.\n\nWhen using the knowledge base tool, make sure you use appropriate inline \ncitations in the following format:\nApples net revenue was $100 million in 2022 [file_{documentId}/page={pageNumber}]\nwhere documentId is the id of the document and pageNumber is the page number of the document.\n\nCurrent date is ${new Date().toISOString()}.    \n`;

const DEEP_SEARCH_SYSTEM_PROMPT = `\nYou are a helpful assistant.\n\nYou  have an access to knowledge base tool and a deep research tool. By default \nuse the deep research tool for any financial query. If it's a very specific \nquestion, you can use the knowledge base tool to answer it.\n\n\nWhen using the knowledge base tool, make sure you use appropriate inline \ncitations in the following format:\nApples net revenue was $100 million in 2022 [file_{documentId}/page={pageNumber}]\nwhere documentId is the id of the document and pageNumber is the page number of the document. Call the tool one by \none only if you don't get the coorect information in previous call.\n\nCurrent date is ${new Date().toISOString()}.    \n`;

type CoreMessageExt = UIMessage & {
  id: string;
  metadata?: {
    agent: "deepResearch" | "knowledgeBase";
    steps?: StepMessage[];
  };
};

export interface ChatPostBody {
  messages: CoreMessageExt[];
  sessionId: string;
  deepSearch: string;
}

const chatStreamRoutes = async (fastify: FastifyInstance) => {
  fastify.post<{ Body: ChatPostBody }>(
    "/",
    {
      preHandler: fastify.authenticate,
      schema: {
        description: "AISDK streaming chat endpoint",
        tags: ["Chat"],
        body: Type.Object({
          messages: Type.Array(Type.Any(), {
            description:
              "AISDK UI Message schema https://ai-sdk.dev/docs/reference/ai-sdk-core/ui-message#uimessage-interface ",
          }),
          sessionId: Type.String(),
          deepSearch: Type.String(),
        }),
        response: {
          200: Type.Any({
            description: "Streaming response from AISDK",
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
      const { messages, sessionId, deepSearch } = request.body as ChatPostBody;
      const agentLogger = createContextLogger({
        agent: "chatStream",
        sessionId,
        userId,
        orgId,
      });

      // Check if sessionId is valid
      const session = await getSession(sessionId);
      if (!session) {
        throw new NotFoundError("Session not found");
      }

      if (session.userId !== userId) {
        throw new AuthorizationError("Session access denied");
      }

      // Handle invalid model

      const saveMessage = async (msgs: CoreMessageExt[]) => {
        const backendMessages: SQLMessage[] = msgs.map(
          (m: CoreMessageExt) =>
            ({
              id: m.id || uuidv4(),
              role: m.role,
              metadata: m.metadata,
              createdAt: new Date(),
              updatedAt: null,
              sessionId: sessionId,
              parts: m.parts,
              userId: userId,
            }) as SQLMessage,
        );
        await syncMessages(backendMessages);
        if (backendMessages.length === 2) {
          summarizeChat(
            sessionId,
            msgs.map((m: CoreMessageExt) => ({
              role: m.role as "user" | "assistant",
              content: m.parts
                .map((p: CoreMessageExt["parts"][number]) => (p.type === "text" ? p.text : ""))
                .join("\n"),
            })),
          )
            .then((title) => updateSession(sessionId, { title }))
            .catch((err) => logger.warn("Title summarization failed", { error: err instanceof Error ? err.message : String(err), sessionId }));
        }
      };

      // Persist user input before invoking the agent stream.
      const incomingUserMessages = messages.filter((m) => m.role === "user");
      if (incomingUserMessages.length > 0) {
        await saveMessage(incomingUserMessages);
      }

      const llm = getLLM(MODELS.GEMINI_3_FLASH);
      if (deepSearch === "agentSearch") {
        const steps: StepMessage[] = [];
        const stream = await observe({ name: "deepSearchAgent" }, () =>
          createUIMessageStream({
            execute: async ({ writer }) => {
              const result = streamText({
                model: llm,
                system: DEEP_SEARCH_SYSTEM_PROMPT,
                tools: {
                  deepSearchTool: {
                    description:
                      "Use this tool do a comprehensive deep search based on user query and return a final report",
                    inputSchema: z.object({
                      query: z
                        .string()
                        .describe(
                          "The query to research on, should be fully formulated question with all relevant context",
                        ),
                    }),
                    execute: async ({ query }: { query: string }) => {
                      try {
                        return await processDeepSearchQuery({
                          query,
                          userId,
                          orgId,
                          callback: (step) => {
                            const index = steps.findIndex((s) => s.id === step.id);
                            if (index !== -1) steps[index] = step;
                            else steps.push(step);
                            writer.write(
                              // @ts-expect-error - Ignore type error
                              step,
                            );
                          },
                        });
                      } catch (error) {
                        agentLogger.error("Tool call failed", {
                          toolName: "deepSearchTool",
                          toolInput: { query },
                          error: error instanceof Error ? error.message : String(error),
                          stack: error instanceof Error ? error.stack : undefined,
                        });
                        throw error;
                      }
                    },
                  },
                },
                messages: [
                  { role: "system", content: SYSTEM_PROMPT },
                  ...convertToModelMessages(messages),
                ],
                experimental_telemetry: {
                  isEnabled: true,
                  tracer: getTracer(),
                },
                stopWhen: stepCountIs(50),
              });
              writer.merge(
                result.toUIMessageStream({
                  onFinish: async ({ messages: finishedMessages }) => {
                    try {
                      await saveMessage(finishedMessages as CoreMessageExt[]);
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
            onError: (error) => {
              agentLogger.error("Chat stream execution failed", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
              });
              return String(error);
            },
          }),
        );
        // createDataStreamResponse returns a Response-like. We stream it as raw payload
        // Fastify: reply.send will handle stream. Here we return result directly.
        return reply.send(createUIMessageStreamResponse({ stream }));
      }

      const stream = await observe({ name: "knowledgeBaseAgent" }, () =>
        streamText({
          model: llm,
          system: SYSTEM_PROMPT,
          stopWhen: stepCountIs(50),
          tools: {
            knowledgeBaseTool: {
              description: "Use this tool to answer questions about the user's documents.",
              inputSchema: z.object({
                query: z
                  .string()
                  .describe(
                    "The query to search the knowledge base for, should be fully formulated question with all relevant context",
                  ),
              }),
              execute: async ({ query }: { query: string }) => {
                try {
                  return await similaritySearchChunksWithObserver({
                    query,
                    limit: 5,
                    includeChunkId: false,
                    page: 1,
                    userId,
                    orgId,
                  });
                } catch (error) {
                  agentLogger.error("Tool call failed", {
                    toolName: "knowledgeBaseTool",
                    toolInput: { query },
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                  });
                  throw error;
                }
              },
            },
          },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...convertToModelMessages(messages),
          ],
          experimental_telemetry: { isEnabled: true },
        }),
      );

      return reply.send(
        stream.toUIMessageStreamResponse({
          originalMessages: messages,
          onFinish: async ({ messages: finishedMessages }) => {
            try {
              await saveMessage(finishedMessages as CoreMessageExt[]);
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

export default chatStreamRoutes;
