import { MODELS } from "@/@types/llm";
import { getLLM } from "@/ai-backend/llm";
import withSpan from "@/utils/asyncHook";
import { type ParsedCitation, parseCitations } from "@/utils/citation";
import { createContextLogger } from "@/utils/logger";
import { getTracer } from "@lmnr-ai/lmnr";
import {
  type CoreMessage,
  type LanguageModelUsage,
  type StepResult,
  type ToolSet,
  type UIMessage,
  convertToModelMessages,
  stepCountIs,
  // createUIMessageStream, // Removed: Not available in AI SDK 3.x core or managed differently
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
  model = MODELS.GEMINI_2_5_FLASH,
  webSearch = false,
  fileAnswerModel = MODELS.GEMINI_2_5_FLASH,
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
    messages: convertToModelMessages(messages),
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
