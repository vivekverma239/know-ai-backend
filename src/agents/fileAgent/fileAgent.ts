"use server";
import { getLLM } from "@/ai-backend/llm";
import { and, asc, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { eq } from "drizzle-orm";
import { userFileChapter, userFilePage, userFileSection } from "@/db/schema";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { logger } from "@/utils/logger";
import { MODELS } from "@/@types/llm";
import type { StepMessage } from "@/@types/agents";
import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { getSimilarChapters } from "@/db/queries/simChunks";
import { getEmbeddings } from "@/ai-backend/embeddings";

const SYSTEM_PROMPT = `
You are an expert financial research assistant. Your task is to provide comprehensive, accurate answers based on the document content provided to you.

## Your Capabilities
- You have access to a document outline showing sections and subsections
- You can retrieve specific page content using the pageTool function
- You can search across multiple pages to find relevant information

## Research Process
1. **Analyze the query**: Understand what information is being requested
2. **Review the outline**: Identify relevant sections and subsections that might contain the answer
3. **Retrieve content**: Use pageTool to get the actual page content for relevant sections
4. **Synthesize information**: Combine information from multiple pages if needed
5. **Provide comprehensive answer**: Give a complete response with proper citations

## Response Requirements
- **Accuracy**: Only use information found in the document. If information is not available, clearly state this
- **Completeness**: Search thoroughly across multiple relevant sections
- **Citations**: Use inline citations in this format: lorem ipsum [1](/doc/{documentId}/page/{pageNumber})
- **Page list**: At the end of your response, include a "Pages referenced: [list of page numbers]"

## Important Guidelines
- DO NOT make assumptions or include information not present in the document
- If the query cannot be answered from the document, say so explicitly
- Prioritize retrieving complete subsections to get comprehensive information
- Use pageTool multiple times if needed to gather all relevant information
- Structure your response logically with clear sections if the answer is complex

## Example Response Format
[Your comprehensive answer with inline citations]

**Pages referenced:** [1, 3, 5-7, 12]
`;

const pageTool = async (pages: number[], fileId: string) => {
  logger.info(`Getting page content for ${pages.join(", ")}`);
  const pageContent = await getDb().query.userFilePage.findMany({
    where: and(
      eq(userFilePage.fileId, fileId),
      inArray(userFilePage.pageNumber, pages)
    ),
  });
  return pageContent
    ?.map((page) => `Page ${page.pageNumber}: ${page.content}`)
    .join("\n");
};

export const fileAgent = async ({
  query,
  fileId,
  chapterId,
  userId,
  orgId,
  callback,
}: {
  query: string;
  fileId: string;
  chapterId?: string;
  userId: string;
  orgId: string;
  callback?: (step: StepMessage) => void;
}) => {
  // const llm = getLLM(DEFAULT_SMALL_MODEL);
  const llm = getLLM(MODELS.GEMINI_2_5_FLASH_LITE);
  // const llm = getLLM(MODELS.GPT_4_1_MINI);
  // const llm = getLLM(MODELS.KIMI_K2);

  // const llm = getLLM(MODELS.GEMINI_2_5_PRO);

  const conditions = [eq(userFileSection.fileId, fileId)];
  if (chapterId) {
    conditions.push(eq(userFileSection.chapterId, chapterId));
  }

  const sections = await getDb().query.userFileSection.findMany({
    where: and(...conditions),
    orderBy: (userFileSection, { asc }) => [asc(userFileSection.startPage)],
  });

  let outline = "";
  for (const section of sections) {
    outline += `
    Title: ${section.title}
    Summary: ${section.summary}
    Page Range: ${section.startPage} - ${section.endPage}
    Subsections: ${section.subsections
      ?.map(
        (subsection) => `
      Subsection Title: ${subsection.title}
      Page Range: ${subsection.startPage} - ${subsection.endPage}
      Summary: ${subsection.summary}
      `
      )
      .join("\n")}
    `;
  }

  const response = await generateText({
    model: llm,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: `
        Document ID: ${fileId}
        Outline: ${outline}
        Query: ${query}
        `,
      },
    ],
    tools: {
      pageTool: tool({
        description: "Get the page content of the given page numbers",
        inputSchema: z.object({
          pages: z.array(z.number()),
        }),
        execute: async ({ pages }) => {
          console.log("🔍 Getting page content for", pages);
          const pageContent = await pageTool(
            pages.map((page) => page - 1),
            fileId
          );
          return pageContent;
        },
      }),
    },
    stopWhen: stepCountIs(20),
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingBudget: 2048,
        },
      } satisfies GoogleGenerativeAIProviderOptions,
    },
  });

  return {
    response: response.text,
    pages: response.toolCalls
      ?.map((call) => call.input as { pages: number[] } | undefined)
      ?.flatMap((call) => call?.pages),
  };
};

export const fileAgentWithChapters = async ({
  query,
  fileId,
  userId,
  orgId,
  callback,
}: {
  query: string;
  fileId: string;
  userId: string;
  orgId: string;
  callback?: (step: StepMessage) => void;
}) => {
  // First identify relevant chapters which could be relevant to the query
  // Then call fileAgent for each chapter
  // Then combine the responses
  // Then return the combined response

  const embedding = await getEmbeddings([query]);
  if (!embedding[0]) {
    throw new Error("No embedding found");
  }
  const similarChapters = await getSimilarChapters({
    embedding: embedding[0],
    limit: 3,
    documentIds: [fileId],
  });
  console.log(JSON.stringify(similarChapters, null, 2));
  const responses = await Promise.all(
    similarChapters.map((chapter) =>
      fileAgent({
        query,
        fileId,
        chapterId: chapter.id,
        userId,
        orgId,
        callback,
      })
    )
  );
  return responses;
};

export const indexSearch = async ({
  query,
  documents,
  userId,
  orgId,
  callback,
}: {
  query: string;
  documents: {
    id: string;
    title: string;
  }[];
  userId: string;
  orgId: string;
  callback?: (step: StepMessage) => void;
}) => {
  // Sequentially run file agent for each document
  const responses = await Promise.all(
    documents.map((document) =>
      fileAgent({ query, fileId: document.id, userId, orgId, callback })
    )
  );

  const fileResponses = documents.map((document, index) => ({
    documentId: document.id,
    content: responses[index]?.response ?? "",
    similarity: 1,
  }));

  return fileResponses;
};
