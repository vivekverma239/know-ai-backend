"use server";
import { getLLM } from "@/ai/llm";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { logger } from "@/utils/logger";
import { MODELS } from "@/@types/llm";
import { StepType, type StepMessage } from "@/@types/agents";
import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { similaritySearchChunks } from "@/service/simSearch";
import { v4 as uuidv4 } from "uuid";
import { recordTokenUsage } from "@/utils/asyncHook";

const SYSTEM_PROMPT = `
You are an expert financial research assistant. Your task is to provide
comprehensive, accurate answers based on searching through financial documents using the tools provided to you.

## Your Capabilities
- **Chapter Search Tool**: Search for relevant chapters across different documents. Always include entity names and dates if mentioned in the query.
- **Chunk Search Tool**: Perform semantic search for relevant chunks within specific chapters. Use this to find detailed information within chapters.

## Research Process
1. **Analyze the query**: Understand what information is being requested and identify key entities, dates, and concepts
2. **Find relevant chapters**: Use chapterSearchTool to identify ALL relevant chapters that could contain information related to the query
3. **Search within chapters**: Use chunkSearchTool to find relevant chunks in ALL relevant chapters you found, not just the top chapter
4. **Synthesize information**: Combine information from multiple chapters and chunks if needed
5. **Review and iterate**: If you haven't found sufficient information, repeat steps 2-4 up to 3 times total
6. **Final assessment**: If information cannot be found after 3 iterations, clearly state this and mention any supporting information found

## Tool Usage Examples

### Chapter Search Tool Examples:
- Query: "What are the financial results for Apple in 2023?"
  - Tool call: chapterSearchTool({ query: "Apple's financial performance and results for the year 2023" })

- Query: "Show me Tesla's revenue growth between 2020 and 2022"
  - Tool call: chapterSearchTool({ query: "Tesla's revenue growth and financial performance from 2020 to 2022" })

- Query: "What are the risks mentioned for Microsoft?"
  - Tool call: chapterSearchTool({ query: "Microsoft's business risks and potential challenges" })

### Chunk Search Tool Examples:
- After finding chapters about Apple, search for specific details:
  - Tool call: chunkSearchTool({
    chapterIds: ["chapter1", "chapter2"],
    query: "Apple's quarterly revenue breakdown and earnings performance throughout 2023"
  })

- For Tesla revenue analysis:
  - Tool call: chunkSearchTool({
    chapterIds: ["chapter3", "chapter5"],
    query: "Tesla's revenue growth patterns and year-over-year performance from 2020 to 2022"
  })

- For risk analysis:
  - Tool call: chunkSearchTool({
    chapterIds: ["chapter4", "chapter6"],
    query: "Microsoft's business risks, competitive challenges, and potential threats to their market position"
  })

## Response Requirements
- **Accuracy**: Only use information found in the documents. If information is not available, clearly state this
- **Completeness**: Search thoroughly across multiple relevant sections and chapters
- **Citations**: Use inline citations in this format: "The company reported $50B revenue [1](/doc/{documentId}/page/{pageNumber})"
- **Page list**: At the end of your response, include a "Pages referenced: [list of page numbers]"
- **Language**: Answer in the same language as the query (typically English)

## Important Guidelines
- **DO NOT** make assumptions or include information not present in the documents
- **DO NOT** limit yourself to just the top chapter - search across ALL relevant chapters
- **ALWAYS** include entity names and dates in your search queries when mentioned
- **MUST** use fully formed, descriptive queries for chunk search (semantic search, not keyword search)
- **MUST** try across different chapters if initial searches don't yield sufficient information
- **MUST** output correct citations for all referenced information
- If the query cannot be answered from the documents, say so explicitly
- Structure your response logically with clear sections for complex answers
- Prioritize retrieving complete subsections for comprehensive information
- If the relevant information is likely to be found is the most recent released documents, to look for most recent docuemnt you could first generate a query indicating the year or years you want the document to refer to, so more relevant document come up first, then continue generating further query if that strategy doesn't yield results.
- YOU MUST CURATE RESPONSE BASED ON THE CHAPTERS AND CHUNKS YOU FOUND, DO NOT ADD
  ANY INFORMATION THAT IS NOT PRESENT IN THE DOCUMENTS.

## Example Response Format

**Query**: "What were Apple's financial results in 2023?"

**Response**:
Apple reported strong financial performance in 2023 with total revenue reaching $383.3 billion [1](/doc/apple-2023/page/15). The company's iPhone segment continued to be the primary revenue driver, contributing $200.6 billion [2](/doc/apple-2023/page/18). Services revenue grew significantly to $85.2 billion, representing a 9% year-over-year increase [3](/doc/apple-2023/page/22).

The company's net income for 2023 was $97 billion, with a gross margin of 44.5% [4](/doc/apple-2023/page/25). International sales accounted for 58% of total revenue, with particularly strong growth in emerging markets [5](/doc/apple-2023/page/28).

**Pages referenced:** [15, 18, 22, 25, 28]
`;

export const chapterAgent = async (
  query: string,
  fileId?: string,
  callback?: (step: StepMessage) => void
) => {
  // const model = MODELS.GEMINI_2_5_PRO;
  // const model = MODELS.GEMINI_2_5_FLASH;
  const model = MODELS.O4_MINI;
  // const model = MODELS.CLAUDE_3_5_SONNET;

  const llm = getLLM(model);

  // const llm = getLLM(DEFAULT_SMALL_MODEL);
  // const llm = getLLM(MODELS.O4_MINI);
  // const llm = getLLM(MODELS.CLAUDE_3_5_SONNET);
  // const llm = getLLM(model);

  //   const llm = getLLM(MODELS.GEMINI_2_5_PRO);

  const allChapters: {
    id: string;
    documentId: string;
    title: string;
    summary: string;
    similarity: number;
  }[] = [];
  const response = await generateText({
    model: llm,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: query,
      },
    ],
    tools: {
      chunkSearchTool: tool({
        description: "Search for the relevant chunks in a document",
        inputSchema: z.object({
          chapterIds: z
            .array(z.string())
            .describe(
              "The chapter ids to search within, provide all relevant chapter ids"
            ),
          query: z.string(),
        }),
        execute: async ({ chapterIds, query }) => {
          const chunkSearchStep: StepMessage = {
            id: uuidv4(),
            type: StepType.CHUNK_SEARCH,
            status: "processing",
            message: "Searching for relevant chunks",
          };
          callback?.(chunkSearchStep);
          logger.info(`Chunk search query: ${query}`);
          logger.info(`Chapter IDs: ${chapterIds.join(", ")}`);
          const chunks = await similaritySearchChunks({
            query,
            documentIds: [],
            chapterIds,
            limit: 5,
            page: 1,
          });
          // logger.info(`Chunks: ${JSON.stringify(chunks, null, 2)}`);
          chunkSearchStep.message = "Chunks found";
          chunkSearchStep.status = "done";
          chunkSearchStep.metadata = {
            query: query,
            chapters: chapterIds.map((id) =>
              allChapters.find((chapter) => chapter.id === id)
            ),
            chunks: chunks,
          };
          callback?.(chunkSearchStep);
          return chunks.map((chunk) => chunk.content).join("\n\n");
        },
      }),
    },
    stopWhen: stepCountIs(20),
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingBudget: 4096,
        },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
  });

  console.log(response.usage);
  recordTokenUsage({
    promptTokens: response.usage.inputTokens ?? 0,
    completionTokens: response.usage.outputTokens ?? 0,
    totalTokens: response.usage.totalTokens ?? 0,
    model: model,
  });

  return {
    response: response.text,
  };
};
