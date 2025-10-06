import { getLLM } from "@/ai-backend/llm";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { logger } from "@/utils/logger";
import { MODELS } from "@/@types/llm";
import type { StepMessage } from "@/@types/agents";
import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { getSimilarChapters } from "@/db/queries/simChunks";
import { getEmbeddings } from "@/ai-backend/embeddings";
import { parseJson } from "@/utils/parseJson";
import { similaritySearchChunks } from "@/service/simSearch";
import { v4 as uuidv4 } from "uuid";
import { StepType } from "@/@types/agents";
import { observe, getTracer } from "@lmnr-ai/lmnr";

const CHAPTER_FILTER_SYSTEM_PROMPT = `
You are an expert financial research assistant. Your task is to figure out relevant chapters for the user query from repository of chapters.

## Your capabilities
- You are given a user query and a chapterSearch tool
- You can retrieve chapters using the chapterSearch tool, which semantically searches for relevant chapters given the query
- You can also fetch the next page of the results by specifying the next page number and the same query
- If you are searching for a new query YOU MUST start again from the first page

## Your task
- Your goal given the user query and the tool is to filter out all the obvious irrelevant chapters
- Irrelevant chapters are chapters that are not completely relevant to the user query, like they are not about the entity in query or something else
- *Important*: You should not filter out chapters that may have even a little bit of relevance to the user query
- Your goal is to be exhaustive in your search, to do that you must query multiple times and look at different pages till there are no more relevant chapters to find
- You must select all the documents irrespecive of the year of document to have higher chance of finding relevant information, so for example if the question is revenue of a company for 2021, it is possible that the information is actually available in 2022/2023/2024/2025 documents as well

### Query structure
- Keep in mind the tool does semantic search, so keep your queries fully formed and with all relevant details so that semantic search can find the most relevant chapters

## The output
- You should return a list of chapter ids that are even remotely relevant to the user query
- You should return the list of chapter ids in the following format:
\`\`\`json
[
    "chapter1",
    "chapter2",
    "chapter3"
]
\`\`\`

Current date: ${new Date().toISOString()}
`;

const DATA_EXTRACTION_SYSTEM_PROMPT = `
You are an expert financial research assistant. Your task is to provide
comprehensive, accurate answers based on searching through financial documents using the tools provided to you.

## Your Capabilities
- **Chunk Search Tool**: Perform semantic search for relevant chunks within the provided chapters. This tool searches through the content of specific chapters to find detailed information that matches your query.
- **Important**: You should fetch the next page of results if you feel there can be more relevant chunks

## Research Process
1. **Analyze the query**: Understand what information is being requested and identify key entities, dates, and concepts
2. **Plan search strategy**: Based on the provided chapters, determine what specific queries would fetch the most relevant chunks,
if fully formed queries don't bring relevant chunks, try with the keyword only queries like "EBIDTA 2024 breakdown Apple"
3. **Search within chapters**: Use chunkSearchTool to find relevant chunks in ALL provided chapters, not just the top chapter
4. **Synthesize information**: Combine information from multiple chapters and chunks if needed
5. **Review and iterate**: If you haven't found sufficient information, repeat steps 2-4 up to 3 additional searches
6. **Final assessment**: If information cannot be found after 4 total searches, clearly state this and mention any supporting information found

## Tool Usage Examples

### Chunk Search Tool Examples:
- After finding chapters about Apple, search for specific details:
  - Tool call: chunkSearchTool({
    query: "Apple's quarterly revenue breakdown and earnings performance throughout 2023",
    page: 1
  })

- For Tesla revenue analysis:
  - Tool call: chunkSearchTool({
    query: "Tesla's revenue growth patterns and year-over-year performance from 2020 to 2022",
    page: 1
  })

- For risk analysis: (page 2, if more results are needed, change page number)
  - Tool call: chunkSearchTool({
    query: "Microsoft's business risks, competitive challenges, and potential threats to their market position",
    page: 2
  })

## Response Requirements
- **Accuracy**: Only use information found in the documents. If information is not available, clearly state this
- **Completeness**: Search thoroughly across multiple relevant sections and chapters
- **Citations**: Use inline citations in this format: "The company reported $50B revenue [1](/doc/{documentId}/page/{pageNumber})"
- **Page list**: At the end of your response, include a "Pages referenced: [list of page numbers]"
- **Language**: Answer in the same language as the query (typically English)
- **Structure**: Organize your response with clear headings and logical flow

## Important Guidelines
- **DO NOT** make assumptions or include information not present in the documents
- **MUST** use fully formed, descriptive queries for chunk search (semantic search, not keyword search)
- **MUST** output correct citations for all referenced information
- If the query cannot be answered from the documents, say so explicitly
- Structure your response logically with clear sections for complex answers
- Prioritize retrieving complete subsections for comprehensive information
- **YOU MUST CURATE RESPONSE BASED ON THE CHAPTERS AND CHUNKS YOU FOUND, DO NOT ADD ANY INFORMATION THAT IS NOT PRESENT IN THE DOCUMENTS**
- When citing multiple sources, use sequential numbering [1], [2], [3], etc.
- For financial data, always include the specific year/period being referenced
- If data is unavailable or incomplete, clearly state this limitation
- YOU MUST NOT CALL TOOL AFTER REMAINING TRIES IS 0

## Example Response Format

**Query**: "What were Apple's financial results in 2023?"

**Response**:
Apple reported strong financial performance in 2023 with total revenue reaching $383.3 billion [1](/doc/apple-2023/page/15). The company's iPhone segment continued to be the primary revenue driver, contributing $200.6 billion [2](/doc/apple-2023/page/18). Services revenue grew significantly to $85.2 billion, representing a 9% year-over-year increase [3](/doc/apple-2023/page/22).

The company's net income for 2023 was $97 billion, with a gross margin of 44.5% [4](/doc/apple-2023/page/25). International sales accounted for 58% of total revenue, with particularly strong growth in emerging markets [5](/doc/apple-2023/page/28).

**Pages referenced:** [15, 18, 22, 25, 28]

Current date: ${new Date().toISOString()}
`;

export const chapterFilter = async (query: string) => {
  const fn = async () =>
    observe(
      { name: "chapterFilter" },
      async (query: string) => {
        const model = MODELS.O4_MINI;
        const llm = getLLM(model);

        const allChapters: {
          id: string;
          documentId: string;
          title: string;
          summary: string;
          similarity: number;
        }[] = [];

        let remainingTries = 8;

        const response = await generateText({
          model: llm,
          messages: [
            { role: "system", content: CHAPTER_FILTER_SYSTEM_PROMPT },
            { role: "user", content: `Query: ${query}` },
          ],
          tools: {
            chapterSearch: tool({
              description: "Search for chapters",
              inputSchema: z.object({
                query: z.string(),
                page: z.number(),
              }),
              execute: async ({ query, page = 1 }) => {
                const embeddings = await getEmbeddings([query]);
                const embedding = embeddings[0];
                if (!embedding) {
                  return [];
                }
                const chapters = await getSimilarChapters({
                  embedding,
                  limit: 25,
                  page,
                });
                allChapters.push(...chapters);
                remainingTries--;
                return {
                  chapters,
                  remainingTries,
                };
              },
            }),
          },
          experimental_telemetry: {
            isEnabled: true,
            tracer: getTracer(),
          },
          stopWhen: stepCountIs(20),
        });

        logger.info(`Chapter filter response: ${response.text}`);

        const result = parseJson(response.text) as string[];
        if (!result) {
          return {
            chapters: [],
          };
        }
        const chapterIds = result;
        const items = chapterIds.map((chapterId) => {
          const chapter = allChapters.find((c) => c.id === chapterId);
          return chapter ?? null;
        });

        return {
          chapters: items.filter((chapter) => chapter !== null),
        };
      },
      query
    );
  return await fn();
};

export const chapterAgentV2 = async (
  query: string,
  callback?: (step: StepMessage) => void
) => {
  const model = MODELS.O4_MINI;
  // const model = MODELS.CLAUDE_3_5_SONNET;

  // const model = MODELS.GEMINI_2_5_PRO;

  const llm = getLLM(model);

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
      { name: "chunkSearch" },
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
            chunkSearchTool: tool({
              description: "Search for chunks",
              inputSchema: z.object({
                query: z.string(),
                page: z
                  .number()
                  .describe("Page number of paginate results, start from 1"),
              }),
              execute: async ({ query, page = 1 }) => {
                const chunkSearchStep: StepMessage = {
                  id: uuidv4(),
                  type: StepType.CHUNK_SEARCH,
                  status: "processing",
                  message: "Searching for relevant chunks",
                };
                callback?.(chunkSearchStep);
                logger.info(`Chunk search query: ${query} Page: ${page}`);

                const chunks = await similaritySearchChunks({
                  query,
                  documentIds: [],
                  chapterIds: chapters.map((chapter) => chapter.id),
                  limit: 5,
                  page,
                  includeChunkId: true,
                  excludeChunkIds: alreadyLookedAtChunks,
                });
                alreadyLookedAtChunks.push(
                  ...chunks
                    .map((chunk) => chunk.id)
                    .filter((id) => id !== undefined)
                );
                // logger.info(`Chunks: ${JSON.stringify(chunks, null, 2)}`);
                chunkSearchStep.message = "Chunks found";
                chunkSearchStep.status = "done";
                chunkSearchStep.metadata = {
                  query: query,
                  chunks: chunks,
                };
                callback?.(chunkSearchStep);

                return chunks
                  .map(
                    (chunk) => `<doc id="${chunk.documentId}" >
          ${chunk.content}
          </doc>`
                  )
                  .join("\n\n");
              },
            }),
          },
          experimental_telemetry: {
            isEnabled: true,
            tracer: getTracer(),
          },
          stopWhen: stepCountIs(20),
        });

        return response.text;
      },
      query,
      chapters
    );
  return await fn();
};
