"use server";
import { getLLM } from "@/ai/llm";
import { userFileChapter, userFilePage, userFileSection } from "@/db/schema";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { logger } from "@/utils/logger";
import { MODELS } from "@/@types/llm";
import { StepType, type StepMessage } from "@/@types/agents";
import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { getSimilarChapters, getSimilarChunks } from "@/db/queries/simChunks";
import { getEmbeddings } from "@/ai/embeddings";
import { similaritySearchChunks } from "@/service/simSearch";
import { v4 as uuidv4 } from "uuid";
import { recordTokenUsage } from "@/utils/asyncHook";
import type { UserFileChapter } from "@/@types";
import { chapterFilter } from "./chapterFilter";
import { observe, getTracer } from "@lmnr-ai/lmnr";
import { queryExpansion } from "../queryExpansion";

const queryAgent = async (
  searchQuery: string,
  userQuery: string,
  chunks: {
    id: string | undefined;
    documentId: string;
    content: string;
    similarity: number;
  }[]
) => {
  // const llm = getLLM(MODELS.O4_MINI);
  // const llm = getLLM(MODELS.GEMINI_2_5_FLASH);
  const llm = getLLM(MODELS.GEMINI_2_0_FLASH);

  const response = await generateText({
    model: llm,
    messages: [
      {
        role: "system",
        content: `You are an expert financial research assistant. Your task is to do a complete analysis of provided context and extract any relevant information that could be helpful to answer the user query.
You are given search query and user query, search query is the query done to fetch relevant context, where as the user query is query made by user.

Only use what is provided to you, do not make up any information.

You will be provided with a list of chunks that are relevant to the user query.

You will need to use the chunks to answer the user query.

Keep in mind curent year is ${new Date().getFullYear()}

- **Citations**: Use inline citations in this format: "The company reported $50B revenue [1](/doc/{documentId}/page/{pageNumber})"
- If the exact requested information is not found, extract any information that can be relevant to the user query
`,
      },
      {
        role: "user",
        content: `
        Search query: ${searchQuery}
        User query: ${userQuery}
        Chunks: ${chunks
          .map(
            (chunk) =>
              `<chunk documentId="${chunk.documentId}">${chunk.content}</chunk>`
          )
          .join("\n\n")}
        `,
      },
    ],
    experimental_telemetry: {
      isEnabled: true,
      tracer: getTracer(),
    },
    // providerOptions: {
    //   google: {
    //     thinkingConfig: {
    //       thinkingBudget: 2048,
    //     },
    //   } satisfies GoogleGenerativeAIProviderOptions,
    // },
  });
  return response.text;
};

// ### Document Analysis Tool Examples:
// - After finding chapters about Apple, search for specific details:
//   - Tool call: documentAnalysisTool({
//     searchQuery: "Apple's quarterly revenue breakdown and earnings performance throughout 2023",
//     page: 1
//   })
//   - This will find relevant chunks AND provide an answer about Apple's 2023 financial performance

// - For Tesla revenue analysis:
//   - Tool call: chunkAnalysisTool({
//     searchQuery: "Tesla's revenue growth patterns and year-over-year performance from 2020 to 2022",
//     page: 1
//   })
//   - This will find relevant chunks AND provide an answer about Tesla's revenue growth

// - For risk analysis: (page 2, if more results are needed, change page number)
//   - Tool call: chunkAnalysisTool({
//     searchQuery: "Microsoft's business risks, competitive challenges, and potential threats to their market position",
//     page: 2
//   })
//   - This will find relevant chunks AND provide an answer about Microsoft's business risks

const DATA_EXTRACTION_SYSTEM_PROMPT = `
You are an expert financial research assistant. Your task is to help user with their financial research, by providing them with relevant information related to their query.

## Your Capabilities
- **Document Analysis Tool**: Given a search query, this tool will semantically search for relevant information in the documents and extract relevant information if available, you should use this tool as information extraction tool.
   Ideally, you should ask it to extract simple facts/information that might be easily available in the documents provided to you.

## Research Process
1. **Analyze the query**: Understand what information is being requested and identify key entities, dates, and concepts
2. **Plan search strategy**: Based on the provided documents, form a research plan with multiple steps and at each step try to find relevant information using the documentAnalysisTool
3. **Synthesize information**: Combine information from multiple tool calls and answers if needed
4. **Review and iterate**: Review the returned information at each step and update the research plan and steps accordingly
5. **Final assessment**: If information cannot be found after 5 total searches, clearly state this and mention any supporting information found, you can also ask user to provide more information or context to help you find the information.

## Tool Usage Examples
- After finding chapters about Apple, search for specific details:
  - Tool call: documentAnalysisTool({
    searchQuery: "Apple's quarterly revenue breakdown and earnings performance throughout 2023",
    page: 1
  })
  - This will find relevant chunks AND provide an answer about Apple's 2023 financial performance

- For Tesla revenue analysis:
  - Tool call: chunkAnalysisTool({
    searchQuery: "Tesla's revenue growth patterns and year-over-year performance from 2020 to 2022",
    page: 1
  })
  - This will find relevant chunks AND provide an answer about Tesla's revenue growth

- For risk analysis: (page 2, if more results are needed, change page number)
  - Tool call: chunkAnalysisTool({
    searchQuery: "Microsoft's business risks, competitive challenges, and potential threats to their market position",
    page: 2
  })
  - This will find relevant chunks AND provide an answer about Microsoft's business risks

## Response Requirements
- **Accuracy**: Only use information found in the documents. If information is not available, clearly state this
- **Completeness**: Search thoroughly across multiple relevant sections and chapters
- **Citations**: Use inline citations in this format: "The company reported $50B revenue [1](/doc/{documentId}/page/{pageNumber})"
- **Language**: Answer in the same language as the query (typically English)
- **Structure**: Organize your response with clear headings and logical flow
- **Comprehensive**: YOU MUST provide a comprehensive and detailed answer to the query, so you must try to extract as much information as possible from the documents, with multiple calls to make sure you have all the information.

## Important Guidelines
- **DO NOT** make assumptions or include information not present in the documents
- **MUST** output correct citations for all referenced information
- If the query cannot be answered, say so explicitly
- Structure your response logically with clear sections for complex answers
- When citing multiple sources, use sequential numbering [1], [2], [3], etc.
- For financial data, always include the specific year/period being referenced
- If data is unavailable or incomplete, clearly state this limitation
- YOU MUST NOT CALL TOOL AFTER REMAINING TRIES IS 0
- Keep in mind current year is ${new Date().getFullYear()}
- Make sure to prioritize LATEST information available

## Example Response Format

**Query**: "What were Apple's financial results in 2023?"

**Response**:
Apple reported strong financial performance in 2023 with total revenue reaching $383.3 billion [1](/doc/apple-2023/page/15). The company's iPhone segment continued to be the primary revenue driver, contributing $200.6 billion [2](/doc/apple-2023/page/18). Services revenue grew significantly to $85.2 billion, representing a 9% year-over-year increase [3](/doc/apple-2023/page/22).

The company's net income for 2023 was $97 billion, with a gross margin of 44.5% [4](/doc/apple-2023/page/25). International sales accounted for 58% of total revenue, with particularly strong growth in emerging markets [5](/doc/apple-2023/page/28).

Current date: ${new Date().toISOString()}
`;

export const chapterAgentV3 = async (
  query: string,
  callback?: (step: StepMessage) => void
) => {
  // const model = MODELS.O4_MINI;
  // const model = MODELS.GEMINI_2_0_FLASH;
  const model = MODELS.CLAUDE_4_SONNET;

  // const model = MODELS.GEMINI_2_5_FLASH;
  // const model = MODELS.MAGISTRAL_SMALL_2506;
  // const model = MODELS.GROK_4;
  // const model = MODELS.GROK_3_MINI;
  // const model = MODELS.KIMI_K2;

  const llm = getLLM(model);

  // Query expansion
  const queryExpansionStep: StepMessage = {
    id: uuidv4(),
    type: StepType.QUERY_EXPANSION,
    status: "processing",
    message: "Expanding query",
  };
  const expandedQuery = await queryExpansion(query);
  queryExpansionStep.message = "Query expanded";
  queryExpansionStep.status = "done";
  queryExpansionStep.metadata = {
    query: query,
    expandedQuery: expandedQuery,
  };
  callback?.(queryExpansionStep);

  const documentSearchStep: StepMessage = {
    id: uuidv4(),
    type: StepType.CHAPTER_SEARCH,
    status: "processing",
    message: "Searching for relevant documents",
  };
  const filteredChapters = await chapterFilter(query);
  documentSearchStep.message = "Chapters found";
  documentSearchStep.status = "done";
  documentSearchStep.metadata = {
    query: query,
    chapters: filteredChapters.chapters,
  };
  callback?.(documentSearchStep);

  console.log(JSON.stringify(filteredChapters.chapters, null, 2));

  const chapters = filteredChapters.chapters;

  const alreadyLookedAtChunks: string[] = [];

  const fn = async () =>
    observe(
      { name: "documentAnalysisTool" },
      async (query: string, chapters: { id: string }[]) => {
        const response = await generateText({
          model: llm,
          messages: [
            { role: "system", content: DATA_EXTRACTION_SYSTEM_PROMPT },
            {
              role: "user",
              content: `
        Relevant chapters: ${JSON.stringify(chapters)}
        Query: ${query}`,
            },
          ],
          tools: {
            documentAnalysisTool: tool({
              description:
                "This tool given the search query, will first find the documnet pages which are semantically relevant to the search query, and then it will return information which could be relevant to the search query",
              inputSchema: z.object({
                searchQuery: z
                  .string()
                  .describe(
                    "Describe the information you are looking for in the documents"
                  ),
                page: z
                  .number()
                  .describe("Page number of paginate results, start from 1"),
              }),
              execute: async ({ searchQuery, page = 1 }) => {
                const chunkSearchStep: StepMessage = {
                  id: uuidv4(),
                  type: StepType.CHUNK_ANALYSIS_STEP,
                  status: "processing",
                  message: "Analyzing chunks",
                };
                callback?.(chunkSearchStep);

                const chunks = await similaritySearchChunks({
                  query: searchQuery,
                  documentIds: [],
                  chapterIds: chapters.map((chapter) => chapter.id),
                  limit: 25,
                  page,
                  includeChunkId: true,
                  excludeChunkIds: alreadyLookedAtChunks,
                });

                const validChunks = chunks.filter(
                  (chunk) => !alreadyLookedAtChunks.includes(chunk.id!)
                );

                console.log(
                  `Chunks found: ${validChunks.length} Page: ${page} Search Query: ${searchQuery}`
                );

                for (const chunk of validChunks) {
                  console.log(chunk.content.slice(0, 100));
                }

                const queryAgentResponse = await queryAgent(
                  searchQuery,
                  query,
                  validChunks
                );

                console.log("🧠 Query Agent Response:", queryAgentResponse);
                chunkSearchStep.message = "Chunks analyzed";
                chunkSearchStep.status = "done";
                chunkSearchStep.metadata = {
                  searchQuery,
                  queryAgentResponse,
                  validChunks,
                };
                callback?.(chunkSearchStep);

                alreadyLookedAtChunks.push(
                  ...chunks
                    .map((chunk) => chunk.id)
                    .filter((id) => id !== undefined)
                );

                return {
                  queryAgentResponse,
                };
              },
            }),
          },
          experimental_telemetry: {
            isEnabled: true,
            tracer: getTracer(),
          },
          stopWhen: stepCountIs(25),
          onStepFinish: (step) => {
            const reasoning = step.reasoning;
            if (reasoning) {
              console.log("🧠 Reasoning:", reasoning);
            }
            if (step.finishReason === "tool-calls") {
              console.log(step.toolCalls);
            }
          },
          providerOptions: {
            providerOptions: {
              google: {
                thinkingConfig: {
                  thinkingBudget: 2048,
                },
              } satisfies GoogleGenerativeAIProviderOptions,
            },
            // openrouter: {
            //   provider: {
            //     only: ["baseten"],
            //   },
            // },
          },
        });

        return response.text;
      },
      query,
      chapters
    );
  return await fn();
};
