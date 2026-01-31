import { MODELS } from "@/@types/llm";
import { getLLM } from "@/ai-backend/llm";
import { getFileSearchTool } from "./tools/fileSearch";
import { generateText, stepCountIs } from "ai";
import type { ToolContext } from "./tools/toolContext";
import { getFileSearchAgentPrompt } from "./prompts";
import { tool } from "ai";
import { z } from "zod";
import { parseJson } from "@/utils/parseJson";
import { createContextLogger } from "@/utils/logger";

/**
 * Agent that searches for files based on the query and returns the most relevant
 * files which would be helpful for answering the query.
 * @param query - The query to search for
 * @returns The search results
 */
export const fileSearchAgent = async (query: string, context: ToolContext) => {
    const agentLogger = createContextLogger({
        agent: "fileSearchAgent",
        userId: context.userId,
    });

    agentLogger.info("🔍 Starting file search agent", {
        query: query.substring(0, 100),
        queryLength: query.length,
    });

    const tools = {
        fileSearchTool: getFileSearchTool({
            context: context,
        }),
    };

    const prompt = getFileSearchAgentPrompt();

    const llm = getLLM(MODELS.GEMINI_2_5_FLASH_LITE);
    const response = await generateText({
        tools: tools,
        model: llm,
        messages: [
            { role: "system", content: prompt },
            { role: "user", content: query },
        ],
        // providerOptions: {
        //   openrouter: {
        //     reasoning: {
        //       enabled: true,
        //       max_tokens: 2048,
        //     },
        //   },
        // },
        stopWhen: stepCountIs(10),
    });

    agentLogger.debug("📄 Response received", {
        responseLength: response.text.length,
        responsePreview: response.text.substring(0, 200),
    });

    // Parse JSON
    const parsedResponse = parseJson(response.text) as {
        reasoning: string;
        documents: {
            id: string;
            title: string;
            confidence: "high" | "medium" | "low";
        }[];
    };

    agentLogger.info("✅ File search agent completed", {
        documentsFound: parsedResponse?.documents?.length ?? 0,
        usage: {
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            totalTokens: response.usage.totalTokens,
        },
    });

    return {
        response: parsedResponse,
        // steps: response.steps,
        usage: response.usage,
    };
};

export const fileSearchAgentAsTool = ({
    context,
}: {
    context: ToolContext;
}) => {
    return tool({
        description: "Perform agentic file search for documents based on the query",
        inputSchema: z.object({
            query: z.string(),
        }),
        execute: async ({ query }) => {
            const result = await fileSearchAgent(query, context);
            // Update the usage
            context.addUsage?.({
                usage: result.usage,
                model: MODELS.GROK_CODE_FAST_1,
            });
            return result.response;
        },
    });
};
