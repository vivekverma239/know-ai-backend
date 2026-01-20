import {
    similaritySearchChapters,
    similaritySearchChunks,
} from "@/service/simSearch";
import { generateObject, tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./toolContext";
import { getLLM } from "@/ai-backend/llm";
import { MODELS } from "@/@types/llm";
import { logger } from "@/utils/logger";


export const snippetSearch = async ({ query, limit = 25, userId, orgId }: { query: string, limit?: number, userId: string, orgId: string }) => {
    const chunks = await similaritySearchChunks({
        query,
        limit,
        includeChunkId: true,
        userId,
        orgId,
    });

    // Send to LLM to filter and get possible response 
    const response = await generateObject({
        model: getLLM(MODELS.OPENAI_GPT_OSS_20B), // Use generic or specific model
        schema: z.array(z.object({
            chunkId: z.string(),
            classification: z.enum(["relevant", "irrelevant"]),
            snippet: z.string().describe("The snippet of the chunk that is relevant to the query"),
            answer: z.string(),
            reasoning: z.string(),
        })),
        prompt: `
    You are a helpful assistant you need to review the following chunks for given query and classify if those
    are relevant to provide answer to query or not, also give an answer if there is one in the chunks.
    Query: ${query}
    Chunks: ${chunks.map((chunk) => `<chunk id="${chunk.id}">${chunk.content}</chunk>`).join("\n\n")}
    Output:
    - Relevant: Whether the chunks are relevant to provide answer to query or not
    - Answer: If there is an answer in the chunks, provide it in the answer field
    - Reasoning: Provide a reasoning for your answer
    - Snippet: Provide a snippet of the chunk that is relevant to the query
    - MUST RETURN CLASSIFICATION FOR EACH CHUNK, EVEN IF IT IS IRRELEVANT
    `,
        temperature: 0.0,
    });

    // Make sure chunk map to input 
    const chunkWithClassification: {
        chunkId: string;
        documentId: string;
        pageNumber: number | null;
        content: string;
        snippet: string;
    }[] = [];
    for (const chunk of chunks) {
        const classification = response.object.find((c) => c.chunkId === chunk.id);
        if (classification && classification.classification === "relevant") {
            chunkWithClassification.push(
                {
                    chunkId: chunk.id!,
                    documentId: chunk.documentId,
                    pageNumber: chunk.pageNumber ?? null,
                    content: chunk.content,
                    snippet: classification.snippet,
                }
            );
        } else if (!classification) {
            logger.debug(`Chunk ${chunk.id} not classified`, {
                chunkId: chunk.id,
            });
        }
    }
    return chunkWithClassification;
};

export const getChunkSearchTool = ({ context }: { context: ToolContext }) => {
    return tool({
        description: "Perform semantic search for file chunks based on the query",
        inputSchema: z.object({
            query: z.string(),
            documentIds: z
                .array(z.string())
                .optional()
                .describe("The document ids to search within"),
        }),
        execute: async ({
            query,
            documentIds,
        }: {
            query: string;
            documentIds?: string[];
        }) => {
            return await similaritySearchChunks({
                query,
                documentIds,
                userId: context.userId,
                orgId: context.orgId,
            });
        },
    });
};

export const getChapterSearchTool = ({ context }: { context: ToolContext }) => {
    return tool({
        description: "Perform semantic search for file chapters based on the query",
        inputSchema: z.object({
            query: z.string(),
        }),
        execute: async ({ query }: { query: string }) => {
            return await similaritySearchChapters({ query, limit: 3, userId: context.userId, orgId: context.orgId });
        },
    });
};
