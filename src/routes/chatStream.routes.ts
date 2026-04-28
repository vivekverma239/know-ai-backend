import type { Message as SQLMessage } from "@/@types";
import { MODELS } from "@/@types/llm";
import {
  buildDeepResearchStream,
  persistAssistantSnapshot,
} from "@/agents/deepResearchStream";
import { summarizeChat } from "@/ai-backend/chatSummary";
import { getLLM } from "@/ai-backend/llm";
import { parseCitations } from "@/utils/citation";
import { updateSession } from "@/db/mutation/session";
import { getSession, syncMessages } from "@/db/queries/message";
import { similaritySearchChunksWithObserver } from "@/service/simSearch";
import { AuthenticationError, AuthorizationError, NotFoundError } from "@/utils/errorHandler";
import type { KnowsisUIMessage } from "@/utils/uiMessageBuilder";
import { createContextLogger, logger } from "@/utils/logger";
import { observe } from "@lmnr-ai/lmnr";
import { Type } from "@sinclair/typebox";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
} from "ai";
import type { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

const SYSTEM_PROMPT = `\nYou are a helpful assistant.\n\nYou  have an access to knowledge base tool which can provide you with \nadditional information about any topic. Feel free to use it to answer\nany of the user questions.\n\nWhen using the knowledge base tool, make sure you use appropriate inline \ncitations in the following format:\nApples net revenue was $100 million in 2022 [file_{documentId}/page={pageNumber}]\nwhere documentId is the id of the document and pageNumber is the page number of the document.\n\nCurrent date is ${new Date().toISOString()}.    \n`;

const DEEP_SEARCH_SYSTEM_PROMPT = `\nYou are a helpful assistant.\n\nYou  have an access to knowledge base tool and a deep research tool. By default \nuse the deep research tool for any financial query. If it's a very specific \nquestion, you can use the knowledge base tool to answer it.\n\n\nWhen using the knowledge base tool, make sure you use appropriate inline \ncitations in the following format:\nApples net revenue was $100 million in 2022 [file_{documentId}/page={pageNumber}]\nwhere documentId is the id of the document and pageNumber is the page number of the document. Call the tool one by \none only if you don't get the coorect information in previous call.\n\nCurrent date is ${new Date().toISOString()}.    \n`;

/**
 * Extract text from a UIMessage's parts, parse citations, and attach
 * them as `metadata.sources` on assistant messages.
 */
const enrichAssistantCitations = async (msgs: KnowsisUIMessage[]) => {
  for (const msg of msgs) {
    if (msg.role !== "assistant") continue;
    const text = msg.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("\n");
    if (!text) continue;
    const citations = await parseCitations(text);
    if (citations.length > 0) {
      msg.metadata = { ...msg.metadata, sources: citations };
    }
  }
};

export interface ChatPostBody {
  messages: KnowsisUIMessage[];
  sessionId: string;
  deepSearch: string;
}

interface RunChatStreamOpts {
  userId: string;
  orgId: string;
  sessionId: string;
  messages: KnowsisUIMessage[];
  deepSearch: string;
}

/**
 * Core chat-stream pipeline shared by the user-auth route and the admin
 * playground route. Persists incoming user messages, dispatches to either the
 * deep-research agent (deepSearch === "agentSearch") or the knowledge-base
 * agent, and returns a Web `Response` ready for `reply.send`.
 *
 * Caller is responsible for auth and session lifecycle (create / 404 /
 * authorize) — this helper assumes the session is already valid.
 */
export const runChatStream = async (
  opts: RunChatStreamOpts,
): Promise<Response> => {
  const { userId, orgId, sessionId, messages, deepSearch } = opts;
  const agentLogger = createContextLogger({
    agent: "chatStream",
    sessionId,
    userId,
    orgId,
  });

  const saveMessage = async (msgs: KnowsisUIMessage[]) => {
    const backendMessages: SQLMessage[] = msgs.map(
      (m: KnowsisUIMessage) =>
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
        msgs.map((m: KnowsisUIMessage) => ({
          role: m.role as "user" | "assistant",
          content: m.parts
            .map((p: KnowsisUIMessage["parts"][number]) => (p.type === "text" ? p.text : ""))
            .join("\n"),
        })),
      )
        .then((title) => updateSession(sessionId, { title }))
        .catch((err) =>
          logger.warn("Title summarization failed", {
            error: err instanceof Error ? err.message : String(err),
            sessionId,
          }),
        );
    }
  };

  // Persist user input before invoking the agent stream.
  const incomingUserMessages = messages.filter((m) => m.role === "user");
  if (incomingUserMessages.length > 0) {
    await saveMessage(incomingUserMessages);
  }

  const llm = getLLM(MODELS.GEMINI_3_FLASH);
  if (deepSearch === "agentSearch") {
    const stream = await buildDeepResearchStream({
      messages,
      sessionId,
      userId,
      orgId,
      systemPrompt: DEEP_SEARCH_SYSTEM_PROMPT,
      llm,
      logger: agentLogger,
      persistAssistant: persistAssistantSnapshot({ sessionId, userId }),
    });
    return createUIMessageStreamResponse({ stream });
  }

  const knowledgeBaseModelMessages = await convertToModelMessages(messages);
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
        ...knowledgeBaseModelMessages,
      ],
      experimental_telemetry: { isEnabled: true },
    }),
  );

  return stream.toUIMessageStreamResponse<KnowsisUIMessage>({
    originalMessages: messages,
    onFinish: async ({ messages: finishedMessages }) => {
      try {
        const msgs = finishedMessages;
        await enrichAssistantCitations(msgs);
        await saveMessage(msgs);
      } catch (error) {
        logger.error("Failed to persist messages on stream finish", {
          error: error instanceof Error ? error.message : String(error),
          sessionId,
        });
      }
    },
  });
};

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

      const session = await getSession(sessionId);
      if (!session) {
        throw new NotFoundError("Session not found");
      }
      if (session.userId !== userId) {
        throw new AuthorizationError("Session access denied");
      }

      const response = await runChatStream({ userId, orgId, sessionId, messages, deepSearch });
      return reply.send(response);
    },
  );
};

export default chatStreamRoutes;
