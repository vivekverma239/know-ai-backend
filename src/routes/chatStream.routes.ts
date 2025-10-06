import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { observe, getTracer } from "@lmnr-ai/lmnr";
import {
  createUIMessageStreamResponse,
  createUIMessageStream,
  streamText,
  type UIMessage,
  convertToModelMessages,
} from "ai";
import { z } from "zod";
import type { MODELS } from "@/@types/llm";
import type { StepMessage } from "@/@types/agents";
import type { Message as SQLMessage } from "@/@types";
import { processDeepSearchQuery } from "@/agents/deepResearch";
import { summarizeChat } from "@/ai/chatSummary";
import { getLLM } from "@/ai/llm";
import { updateSession } from "@/db/mutation/session";
import { syncMessages } from "@/db/queries/message";
import { similaritySearchChunksWithObserver } from "@/service/simSearch";

const SYSTEM_PROMPT = `\nYou are a helpful assistant.\n\nYou  have an access to knowledge base tool which can provide you with \nadditional information about any topic. Feel free to use it to answer\nany of the user questions.\n\nWhen using the knowledge base tool, make sure you use appropriate inline \ncitations in the following format:\nApples net revenue was $100 million in 2022 [1](/doc/{documentId}/page/{pageNumber})\nwhere documentId is the id of the document and pageNumber is the page number of the document.\n\nCurrent date is ${new Date().toISOString()}.    \n`;

const DEEP_SEARCH_SYSTEM_PROMPT = `\nYou are a helpful assistant.\n\nYou  have an access to knowledge base tool and a deep research tool. By default \nuse the deep research tool for any financial query. If it's a very specific \nquestion, you can use the knowledge base tool to answer it.\n\n\nWhen using the knowledge base tool, make sure you use appropriate inline \ncitations in the following format:\nApples net revenue was $100 million in 2022 [1](/doc/{documentId}/page/{pageNumber})\nwhere documentId is the id of the document and pageNumber is the page number of the document. Call the tool one by \none only if you don't get the coorect information in previous call.\n\nCurrent date is ${new Date().toISOString()}.    \n`;

type CoreMessageExt = UIMessage & {
  id: string;
  metadata?: {
    agent: "deepResearch" | "knowledgeBase";
    model: MODELS;
    steps?: StepMessage[];
  };
};

export interface ChatPostBody {
  messages: CoreMessageExt[];
  sessionId: string;
  deepSearch: string;
  model: MODELS;
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
          model: Type.String(),
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
        return reply.code(401).send({ error: "Unauthorized" });
      }
      const userId: string = user.id;
      const orgId: string = user.orgId;
      const { messages, sessionId, deepSearch, model } =
        request.body as ChatPostBody;

      const saveMessage = async (msgs: CoreMessageExt[]) => {
        const backendMessages: SQLMessage[] = msgs.map(
          (m: CoreMessageExt) =>
            ({
              id: m.id,
              role: m.role,
              metadata: m.metadata,
              createdAt: new Date(),
              updatedAt: null,
              sessionId: sessionId,
              parts: [],
              userId: userId,
            } as SQLMessage)
        );
        await syncMessages(backendMessages);
        if (backendMessages.length === 2) {
          const title = await summarizeChat(
            sessionId,
            messages.map((m: CoreMessageExt) => ({
              role: m.role as "user" | "assistant",
              content: m.parts
                .map((p: CoreMessageExt["parts"][number]) =>
                  p.type === "text" ? p.text : ""
                )
                .join("\n"),
            }))
          );
          await updateSession(sessionId, { title });
        }
      };

      const llm = getLLM(model);
      if (
        deepSearch === "deepSearchV1" ||
        deepSearch === "deepSearchV2" ||
        deepSearch === "deepSearchV3" ||
        deepSearch === "deepSearchV4" ||
        deepSearch === "indexSearch" ||
        deepSearch === "agentSearch"
      ) {
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
                          "The query to research on, should be fully formulated question with all relevant context"
                        ),
                    }),
                    execute: async ({ query }: { query: string }) => {
                      return await processDeepSearchQuery(query, (step) => {
                        const index = steps.findIndex((s) => s.id === step.id);
                        if (index !== -1) steps[index] = step;
                        else steps.push(step);
                        writer.write(
                          // @ts-expect-error - Ignore type error
                          step
                        );
                      });
                    },
                  },
                },
                // onFinish: async (result) => {
                //   const updated = appendResponseMessages({
                //     messages,
                //     responseMessages: result.response.messages,
                //   });
                //   const last = updated[updated.length - 1];
                //   if (last)
                //     last.metadata = {
                //       agent: "deepResearch",
                //       model,
                //       steps,
                //     } as any;
                //   await saveMessage(updated as CoreMessageExt[]);
                // },
                messages: [
                  { role: "system", content: SYSTEM_PROMPT },
                  ...convertToModelMessages(messages),
                ],
                experimental_telemetry: {
                  isEnabled: true,
                  tracer: getTracer(),
                },
              });
              writer.merge(
                result.toUIMessageStream({
                  onFinish: async ({ messages, responseMessage }) => {
                    await saveMessage(messages as CoreMessageExt[]);
                  },
                })
              );
            },
            onError: (error) => String(error),
          })
        );
        // createDataStreamResponse returns a Response-like. We stream it as raw payload
        // Fastify: reply.send will handle stream. Here we return result directly.
        return reply.send(createUIMessageStreamResponse({ stream }));
      }

      const stream = await observe({ name: "knowledgeBaseAgent" }, () =>
        streamText({
          model: llm,
          system: SYSTEM_PROMPT,
          tools: {
            knowledgeBaseTool: {
              description:
                "Use this tool to answer questions about the user's documents.",
              inputSchema: z.object({
                query: z
                  .string()
                  .describe(
                    "The query to search the knowledge base for, should be fully formulated question with all relevant context"
                  ),
              }),
              execute: async ({ query }: { query: string }) =>
                await similaritySearchChunksWithObserver(
                  query,
                  undefined,
                  undefined,
                  5
                ),
            },
          },
          //   onFinish: async (res) => {
          //     const updated = appendResponseMessages({
          //       messages,
          //       responseMessages: res.response.messages,
          //     });
          //     const last = updated[updated.length - 1];
          //     if (last) last.metadata = { agent: "knowledgeBase", model } as any;
          //     await saveMessage(updated as CoreMessageExt[]);
          //   },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...convertToModelMessages(messages),
          ],
          experimental_telemetry: { isEnabled: true },
        })
      );

      return reply.send(
        stream.toUIMessageStreamResponse({
          originalMessages: messages,
          onFinish: async ({ messages, responseMessage }) => {
            await saveMessage(messages as CoreMessageExt[]);
          },
        })
      );
    }
  );
};

export default chatStreamRoutes;
