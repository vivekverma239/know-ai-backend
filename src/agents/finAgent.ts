import { MODELS } from "@/@types/llm";
import { getLLM } from "@/ai-backend/llm";
import withSpan from "@/utils/asyncHook";
import { type ParsedCitation, parseCitations } from "@/utils/citation";
import { createContextLogger } from "@/utils/logger";
import {
  type KnowsisUIMessage,
  UIMessageBuilder,
} from "@/utils/uiMessageBuilder";
import { extractMessageMetadata } from "@/utils/uiMessageMetadata";
import { getTracer, observe } from "@lmnr-ai/lmnr";
import {
  type ModelMessage,
  type LanguageModelUsage,
  type StepResult,
  type ToolSet,
  type UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  stepCountIs,
  streamText,
} from "ai";
import { v4 as uuidv4 } from "uuid";
import { fileSearchAgentAsTool } from "./fileSearchAgent";
import { getFinAgentPrompt } from "./prompts";
import { getBulkFileIndexingTool, getFileStatusTool } from "./tools/bulkFileIndexing";
import { getChapterSearchTool, getChunkSearchTool } from "./tools/chunkSearch";
import { getFileAnswerTool } from "./tools/fileAnswerTableOfContent";
import { getTeamContextTool } from "./tools/teamContext";
import { type Todo, getTodoListTools } from "./tools/todoListTool";
import type { ToolContext } from "./tools/toolContext";
import { getWebDocSearchTool } from "./tools/webDocSearchTool";
import { getWebSearchTool, getWebsiteContentTool } from "./tools/websearch";

export type FinAgentContext = {
  userId: string;
  sessionId: string;
  orgId: string;
  teamIds: string[];
};

// Define your custom message type with data part schemas
export type FinAgentUIMessage = UIMessage & {
  data?: {
    model?: string;
    tokenUsage?: {
      inputTokens: number;
      outputTokens: number;
    };
    todos?: {
      id: string;
      todos: Todo[];
    };
    bulkFileIndexData?: {
      pdfs: {
        id: string;
        name: string;
      }[];
      webArticles: {
        id: string;
        name: string;
        url: string;
      }[];
    };
    citations?: ParsedCitation[];
  };
  threadId?: string;
  userId?: string;
  timestamp?: number;
};

type ExecutableTool = {
  execute?: (...args: unknown[]) => unknown;
};

const wrapToolsWithFailureLogging = ({
  tools,
  agentLogger,
  context,
}: {
  tools: ToolSet;
  agentLogger: ReturnType<typeof createContextLogger>;
  context: FinAgentContext;
}): ToolSet => {
  for (const [toolName, toolDefinition] of Object.entries(tools)) {
    const executableTool = toolDefinition as unknown as ExecutableTool;
    if (typeof executableTool.execute !== "function") {
      continue;
    }

    const originalExecute = executableTool.execute;
    executableTool.execute = async (...args: unknown[]) => {
      try {
        return await originalExecute(...args);
      } catch (error) {
        agentLogger.error("Tool call failed", {
          toolName,
          toolInput: args[0],
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          sessionId: context.sessionId,
          userId: context.userId,
          orgId: context.orgId,
        });
        throw error;
      }
    };
  }

  return tools;
};

export const finAgent = async ({
  context,
  messages,
  saveMessage,
  model = MODELS.GEMINI_3_FLASH,
  webSearch = false,
  fileAnswerModel = MODELS.GROK_4_1_FAST,
}: {
  context: FinAgentContext;
  messages: FinAgentUIMessage[];
  saveMessage: (message: FinAgentUIMessage) => Promise<void>;
  model?: MODELS;
  webSearch?: boolean;
  fileAnswerModel?: MODELS;
}) => {
  // Use a wrapper or direct call if withSpan is actually 'withTokenTracking' or similar
  // Assuming withSpan matches signature or I adapt it.
  // Using a simple execution block if withSpan is not compatible

  // Add span attributes logic (omitted if trace not fully set up)

  // Create agent-specific logger
  const agentLogger = createContextLogger({
    agent: "finAgent",
    sessionId: context.sessionId,
    userId: context.userId,
  });

  const toolContext: ToolContext = {
    userId: context.userId,
    sessionId: context.sessionId,
    orgId: context.orgId,
    teamIds: context.teamIds,
    addUsage: (addUsage: { usage: LanguageModelUsage; model: string }) => {
      // Implement usage tracking callback
      agentLogger.debug("Usage update", addUsage);
    },
  };

  const systemPrompt = getFinAgentPrompt({ webSearchEnabled: webSearch });
  const tools: ToolSet = {
    fileSearchAgent: fileSearchAgentAsTool({ context: toolContext }),
    fileAnswerTool: getFileAnswerTool({ context: toolContext, model: fileAnswerModel }),
    chunkSearchTool: getChunkSearchTool({ context: toolContext }),
    chapterSearchTool: getChapterSearchTool({ context: toolContext }),
    ...(webSearch
      ? {
          webDocSearchTool: getWebDocSearchTool({ context: toolContext }),
          bulkFileIndexingTool: getBulkFileIndexingTool({ context: toolContext }),
          webSearchTool: getWebSearchTool({ context: toolContext }),
          webPageScrapeTool: getWebsiteContentTool({ context: toolContext }),
        }
      : {}),
    fileStatusTool: getFileStatusTool({ context: toolContext }),
    teamContextTool: getTeamContextTool({ context: toolContext }),
    ...getTodoListTools({ context: toolContext }),
  };

  const stream = streamText({
    model: getLLM(model),
    messages: await convertToModelMessages(messages),
    system: systemPrompt,
    tools: wrapToolsWithFailureLogging({ tools, agentLogger, context }),
    stopWhen: stepCountIs(15),
    experimental_telemetry: {
      isEnabled: true,
      tracer: getTracer(),
    },
  });

  return stream;
};

/**
 * Build a UIMessage stream for the FinAgent that mirrors `streamText`'s
 * `fullStream` chunks into a `UIMessageBuilder`. After each step finishes,
 * citations are reparsed from the assistant text and emitted as a
 * `message-metadata` chunk so the dashboard can resolve `[file_<uuid>]`
 * references inline without a separate lookup round-trip.
 *
 * Mirrors `buildDeepResearchStream` (see `src/agents/deepResearchStream.ts`)
 * but uses FinAgent's tools and prompt.
 */
export type BuildFinAgentStreamArgs = {
  messages: KnowsisUIMessage[];
  context: FinAgentContext;
  webSearch?: boolean;
  model?: MODELS;
  fileAnswerModel?: MODELS;
  logger: { error: (message: string, meta?: Record<string, unknown>) => void };
  /** Persists the assistant snapshot. Called from `UIMessageBuilder.onChange`. */
  persistAssistant: (snapshot: KnowsisUIMessage) => Promise<void>;
};

export const buildFinAgentStream = (args: BuildFinAgentStreamArgs) => {
  const {
    messages,
    context,
    webSearch = false,
    model = MODELS.GEMINI_3_FLASH,
    fileAnswerModel = MODELS.GROK_4_1_FAST,
    logger: argsLogger,
    persistAssistant,
  } = args;

  const agentLogger = createContextLogger({
    agent: "finAgent",
    sessionId: context.sessionId,
    userId: context.userId,
  });

  return observe({ name: "finAgent" }, () =>
    createUIMessageStream<KnowsisUIMessage>({
      originalMessages: messages,
      execute: async ({ writer }) => {
        const builder = new UIMessageBuilder({
          writer,
          initialMetadata: { agent: "finAgent" },
          flushIntervalMs: 250,
          onChange: async (snapshot) => {
            try {
              await persistAssistant(snapshot);
            } catch (error) {
              argsLogger.error("Failed to persist assistant snapshot", {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          },
        });

        builder.start();

        const toolContext: ToolContext = {
          userId: context.userId,
          sessionId: context.sessionId,
          orgId: context.orgId,
          teamIds: context.teamIds,
          writer: writer as unknown as ToolContext["writer"],
          addUsage: (addUsage: { usage: LanguageModelUsage; model: string }) => {
            agentLogger.debug("Usage update", addUsage);
          },
        };

        const systemPrompt = getFinAgentPrompt({ webSearchEnabled: webSearch });
        const tools: ToolSet = {
          fileSearchAgent: fileSearchAgentAsTool({ context: toolContext }),
          fileAnswerTool: getFileAnswerTool({
            context: toolContext,
            model: fileAnswerModel,
          }),
          chunkSearchTool: getChunkSearchTool({ context: toolContext }),
          chapterSearchTool: getChapterSearchTool({ context: toolContext }),
          ...(webSearch
            ? {
                webDocSearchTool: getWebDocSearchTool({ context: toolContext }),
                bulkFileIndexingTool: getBulkFileIndexingTool({ context: toolContext }),
                webSearchTool: getWebSearchTool({ context: toolContext }),
                webPageScrapeTool: getWebsiteContentTool({ context: toolContext }),
              }
            : {}),
          fileStatusTool: getFileStatusTool({ context: toolContext }),
          teamContextTool: getTeamContextTool({ context: toolContext }),
          ...getTodoListTools({ context: toolContext }),
        };

        const result = streamText({
          model: getLLM(model),
          system: systemPrompt,
          messages: [
            { role: "system", content: systemPrompt },
            ...(await convertToModelMessages(messages)),
          ],
          tools: wrapToolsWithFailureLogging({ tools, agentLogger, context }),
          stopWhen: stepCountIs(15),
          experimental_telemetry: {
            isEnabled: true,
            tracer: getTracer(),
          },
        });

        // streamText's fullStream can emit `error` chunks that don't throw —
        // without surfacing them, a model/provider failure (e.g. an image part
        // Gemini can't decode) shows up as an empty stream with start→finish
        // and no diagnostic. Surface these to logs and to the UI as visible
        // text so the user can see what went wrong.
        const surfaceStreamError = (label: string, errorText: string) => {
          argsLogger.error(`FinAgent ${label}`, {
            error: errorText,
            sessionId: context.sessionId,
            userId: context.userId,
          });
          try {
            const id = `${label}-${Date.now()}`;
            builder.startStep();
            builder.startText(id);
            builder.appendText(id, `⚠️ ${label}: ${errorText}`);
            builder.endText(id);
            builder.finishStep();
          } catch (emitError) {
            argsLogger.error("Failed to surface FinAgent error to UI", {
              label,
              cause: emitError instanceof Error ? emitError.message : String(emitError),
            });
          }
        };

        let finishReason: string | undefined;
        try {
          for await (const chunk of result.fullStream) {
            const metadataPatch = extractMessageMetadata(chunk);
            if (metadataPatch) builder.mergeMetadata(metadataPatch);
            if (chunk.type === "finish") finishReason = chunk.finishReason;
            switch (chunk.type) {
              case "start-step":
                builder.startStep();
                break;
              case "finish-step":
                builder.finishStep();
                // Re-parse citations so partial sources show up after each step.
                await builder.refreshCitations();
                break;
              case "text-start":
                builder.startText(chunk.id);
                break;
              case "text-delta":
                builder.appendText(chunk.id, chunk.text);
                break;
              case "text-end":
                builder.endText(chunk.id);
                break;
              case "reasoning-start":
                builder.startReasoning(chunk.id);
                break;
              case "reasoning-delta":
                builder.appendReasoning(chunk.id, chunk.text);
                break;
              case "reasoning-end":
                builder.endReasoning(chunk.id);
                break;
              case "tool-input-start":
                builder.startToolCall({ toolCallId: chunk.id, toolName: chunk.toolName });
                break;
              case "tool-call":
                builder.setToolInput({
                  toolCallId: chunk.toolCallId,
                  toolName: chunk.toolName,
                  input: chunk.input,
                });
                break;
              case "tool-result":
                builder.setToolOutput({
                  toolCallId: chunk.toolCallId,
                  output: chunk.output,
                });
                break;
              case "tool-error":
                builder.setToolError({
                  toolCallId: chunk.toolCallId,
                  errorText:
                    chunk.error instanceof Error ? chunk.error.message : String(chunk.error),
                });
                break;
              case "error":
                surfaceStreamError(
                  "stream-error",
                  chunk.error instanceof Error
                    ? `${chunk.error.message}${chunk.error.stack ? `\n${chunk.error.stack}` : ""}`
                    : typeof chunk.error === "object"
                      ? JSON.stringify(chunk.error)
                      : String(chunk.error),
                );
                if (!finishReason) finishReason = "error";
                break;
              case "finish":
                break;
            }
          }
        } catch (iterationError) {
          surfaceStreamError(
            "stream-exception",
            iterationError instanceof Error
              ? `${iterationError.message}${iterationError.stack ? `\n${iterationError.stack}` : ""}`
              : String(iterationError),
          );
          if (!finishReason) finishReason = "error";
        }

        await builder.refreshCitations();

        // If the model produced no visible output (no text, no reasoning,
        // no tool call, no surfaced error), emit a fallback message so the
        // UI doesn't render an empty assistant bubble. Observed once with
        // image attachments where Gemini returned zero chunks silently.
        const snapshotParts = builder.snapshot().parts ?? [];
        const hasVisibleOutput = snapshotParts.some(
          (p) =>
            p.type === "text" ||
            p.type === "reasoning" ||
            (typeof p.type === "string" && p.type.startsWith("tool-")),
        );
        if (!hasVisibleOutput) {
          surfaceStreamError(
            "empty-response",
            "The model returned no content. This often happens with image attachments — try a different prompt or model.",
          );
          if (!finishReason) finishReason = "empty";
        }

        await builder.flush();
        builder.finish({ finishReason: finishReason ?? "stop" });
      },
      onError: (error) => {
        argsLogger.error("FinAgent stream execution failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return String(error);
      },
    }),
  );
};
