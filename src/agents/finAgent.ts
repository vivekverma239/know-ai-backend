import {
    // createUIMessageStream, // Removed: Not available in AI SDK 3.x core or managed differently
    streamText,
    type UIMessage,
    type LanguageModelUsage,
    type CoreMessage,
    convertToModelMessages,
    type StepResult,
    ToolSet,
    stepCountIs,
} from "ai";
import { v4 as uuidv4 } from "uuid";
import type { ToolContext } from "./tools/toolContext";
import { getChapterSearchTool, getChunkSearchTool } from "./tools/chunkSearch";
import { getFileAnswerTool } from "./tools/fileAnswerTableOfContent";
import { getWebSearchTool, getWebsiteContentTool } from "./tools/websearch";
import { MODELS } from "@/@types/llm";
import { getLLM } from "@/ai-backend/llm";
import { getFinAgentPrompt } from "./prompts";
import { getTodoListTools, type Todo } from "./tools/todoListTool";
import { parseCitations, type ParsedCitation } from "@/utils/citation";
import { fileSearchAgentAsTool } from "./fileSearchAgent";
import {
    getBulkFileIndexingTool,
    getFileStatusTool,
} from "./tools/bulkFileIndexing";
import { getWebDocSearchTool } from "./tools/webDocSearchTool";
import { createContextLogger } from "@/utils/logger";
import { getTracer } from "@lmnr-ai/lmnr";
import withSpan from "@/utils/asyncHook";

export type FinAgentContext = {
    userId: string;
    sessionId: string;
    orgId: string; // Added orgId
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

export const finAgent = async ({
    context,
    messages,
    saveMessage,
    model = MODELS.GROK_CODE_FAST_1,
    webSearch = false,
    fileAnswerModel = MODELS.GROK_CODE_FAST_1,
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
        addUsage: (addUsage: { usage: LanguageModelUsage; model: string }) => {
            // Implement usage tracking callback
            agentLogger.debug("Usage update", addUsage);
        },
    };

    const systemPrompt = getFinAgentPrompt({ webSearchEnabled: webSearch });

    const stream = streamText({
        model: getLLM(model),
        messages: convertToModelMessages(messages),
        system: systemPrompt,
        tools: {
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
            ...getTodoListTools({ context: toolContext }),
        },
        stopWhen: stepCountIs(15),
        experimental_telemetry: {
            isEnabled: true,
            tracer: getTracer(),
        }
    });

    return stream;
};
