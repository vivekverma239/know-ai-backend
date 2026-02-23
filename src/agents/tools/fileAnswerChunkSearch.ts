import { type StepMessage, StepType } from "@/@types/agents";
import { MODELS } from "@/@types/llm";
import { getLLM } from "@/ai-backend/llm";
import { getDb } from "@/db";
import { structuredReports, userFile } from "@/db/schema";
import { similaritySearchChunks, similaritySearchDocuments } from "@/service/simSearch";
import { createContextLogger } from "@/utils/logger";
import { parseJson } from "@/utils/parseJson";
import { getTracer, observe } from "@lmnr-ai/lmnr";
import { type LanguageModelUsage, generateText, stepCountIs, tool } from "ai";
import { eq, inArray } from "drizzle-orm";
import { type Result, err, ok } from "neverthrow";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { COMMON_CITATION_PROMPT } from "../common";
import { mergeTokenUsage } from "../report/utils";
import type { ToolContext } from "./toolContext";

// ============================================================================
// Types
// ============================================================================

type FileInfo = {
  id: string;
  name: string | null;
  type: string;
  userId: string;
  metadata?: {
    title?: string;
    shortSummary?: string;
  } | null;
};

type AgentResult = {
  answer: string;
  usage: Record<string, LanguageModelUsage>;
  chunksSearched: number;
  iterations: number;
};

// ============================================================================
// Constants
// ============================================================================

const DATA_EXTRACTION_SYSTEM_PROMPT = `
You are an expert financial research assistant. Your task is to help user with their financial research, by providing them with relevant information related to their query.

## Your Capabilities
- **documentAnalysisTool**: Given a search query, this tool will semantically search for relevant information in the documents and extract relevant information if available, you should use this tool as information extraction tool. 
   Ideally, you should ask it to extract simple facts/information that might be easily available in the documents provided to you.

  
## Research Process
1. **Analyze the query**: Understand what information is being requested and identify key entities, dates, and concepts
2. **Plan search strategy**: Based on the provided documents, form a research plan with multiple steps and at each step try to find relevant information using the documentAnalysisTool
3. **Synthesize information**: Combine information from multiple tool calls and answers if needed
4. **Review and iterate**: Review the returned information at each step and update the research plan and steps accordingly
5. **Final assessment**: If information cannot be found after 5 total searches, clearly state this and mention any supporting information found, you can also ask user to provide more information or context to help you find the information.

## Response Requirements
- **Accuracy**: Only use information found in the documents. If information is not available, clearly state this
- **Completeness**: Search thoroughly across multiple relevant sections and documents
- **Citations**: Use inline citations in this format: "The company reported $50B revenue [file_8320377c-f09e-4739-8d4e-9726fbae32de/page=1,2]"
- **Language**: Answer in the same language as the query (typically English)
- **Structure**: Organize your response with clear headings and logical flow
- **Comprehensive**: YOU MUST provide a comprehensive and detailed answer to the query, so you must try to extract as much information as possible from the documents, with multiple calls to make sure you have all the information.

${COMMON_CITATION_PROMPT}

Current date: ${new Date().toISOString()}
`;

const DOCUMENT_FILTER_SYSTEM_PROMPT = `
You are an expert financial research assistant. Given the user query, your job is to make queries using the document
search tool which would return the document information based on the query. Make sure to use the tool multiple times
and get all the relevant documents which could have relevant information to the user query.

Guidelines:
- Make sure to do an exhaustive search and get all the relevant documents.
- You must try multiple times with different queries to ensure that you have found all relevant documents.
- The goal here is to be exhaustive and find all relevant documents.
- Make sure to return all the documents which could be relevant to the user query.
- You should try at most 3 times and after that return the most relevant documents.
Current date: ${new Date().toISOString()}

User Query: {query}
When you are done, you should return a list of documents which could have relevant information to the user query.
you should respond finally with this format :
\`\`\`json
{
    "documents": [
        {
            "id": "123",
            "title": "document_name"
        }
        ...
    ]
}
\`\`\`
`;

// ============================================================================
// Helper Functions
// ============================================================================

const getFileInfo = async (fileIds: string[]): Promise<FileInfo[]> => {
  const files = await getDb().query.userFile.findMany({
    where: inArray(userFile.id, fileIds),
  });
  return files.map((f) => ({
    id: f.id,
    name: f.metadata?.title ?? f.name ?? "Untitled",
    type: f.type || "unknown",
    userId: f.userId,
    metadata: f.metadata as { title?: string; shortSummary?: string } | null,
  }));
};

const getStructuredReportContent = async (fileId: string): Promise<Result<string, string>> => {
  try {
    const file = await getDb().query.userFile.findFirst({
      where: eq(userFile.id, fileId),
    });
    if (!file || !file.structuredReportId) {
      return err("File not found or not a structured report");
    }
    const report = await getDb().query.structuredReports.findFirst({
      where: eq(structuredReports.id, file.structuredReportId),
    });
    if (!report) {
      return err("Report not found");
    }
    return ok(report.finalOutput ?? "");
  } catch (error) {
    return err(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
};

// ============================================================================
// Query Agent
// ============================================================================

const queryAgent = async (
  searchQuery: string,
  userQuery: string,
  chunks: {
    id: string | undefined;
    documentId: string;
    content: string;
    similarity: number;
  }[],
  addUsage?: (usage: { usage: LanguageModelUsage; model: string }) => void,
): Promise<{ response: string; usage: LanguageModelUsage }> => {
  const llm = getLLM(MODELS.GEMINI_2_5_FLASH);

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

Keep in mind current year is ${new Date().getFullYear()}

${COMMON_CITATION_PROMPT}
`,
      },
      {
        role: "user",
        content: `
        Search query: ${searchQuery}
        User query: ${userQuery}
        Chunks: ${chunks.map((chunk) => `<chunk documentId="${chunk.documentId}">${chunk.content}</chunk>`).join("\n\n")}
        `,
      },
    ],
    experimental_telemetry: {
      isEnabled: true,
      tracer: getTracer(),
    },
  });

  const queryAgentUsage = response.usage;
  if (addUsage) {
    addUsage({
      usage: queryAgentUsage,
      model: MODELS.GEMINI_2_5_FLASH,
    });
  }

  return {
    response: response.text,
    usage: queryAgentUsage,
  };
};

// ============================================================================
// Document Filter
// ============================================================================

const documentFilter = async (
  query: string,
  userId: string,
  orgId: string,
  addUsage?: (usage: { usage: LanguageModelUsage; model: string }) => void,
): Promise<{ documents: { id: string; title: string }[] }> => {
  const fn = async () =>
    observe(
      { name: "documentFilter" },
      async (query: string) => {
        const model = MODELS.GROK_CODE_FAST_1;
        const llm = getLLM(model);

        const allDocuments: {
          id: string;
          title: string;
        }[] = [];

        const response = await generateText({
          model: llm,
          messages: [
            {
              role: "system",
              content: DOCUMENT_FILTER_SYSTEM_PROMPT.replace("{query}", query),
            },
            { role: "user", content: `Query: ${query}` },
          ],
          tools: {
            documentSearch: tool({
              description: "Search for documents based on the query",
              inputSchema: z.object({
                query: z.string(),
                page: z.number().optional().default(1),
              }),
              execute: async ({
                query: searchQuery,
                page = 1,
              }: {
                query: string;
                page?: number;
              }) => {
                try {
                  const documents = await similaritySearchDocuments({
                    query: searchQuery,
                    limit: 25,
                    userId,
                    orgId,
                  });
                  allDocuments.push(
                    ...documents.map((d) => ({
                      id: d.id,
                      title: d.title ?? "Untitled",
                    })),
                  );
                  return {
                    documents: documents.map((d) => ({
                      id: d.id,
                      title: d.title ?? "Untitled",
                    })),
                    hasMore: documents.length === 25,
                  };
                } catch (error) {
                  return { documents: [], hasMore: false };
                }
              },
            }),
          },
          experimental_telemetry: {
            isEnabled: true,
            tracer: getTracer(),
          },
          stopWhen: stepCountIs(10),
        });

        const documentFilterUsage = response.usage;
        if (addUsage) {
          addUsage({
            usage: documentFilterUsage,
            model: MODELS.GROK_CODE_FAST_1,
          });
        }

        const result = parseJson(response.text) as {
          documents: { id: string; title: string }[];
        } | null;
        if (!result) {
          return {
            documents: allDocuments,
          };
        }

        const foundIds = new Set(result.documents.map((d) => d.id));
        const additionalDocs = allDocuments.filter((d) => !foundIds.has(d.id));

        return {
          documents: [...result.documents, ...additionalDocs],
        };
      },
      query,
    );
  return await fn();
};

// ============================================================================
// Main Agent
// ============================================================================

export const fileAnswerChunkSearchAgent = async ({
  query,
  fileIds,
  userId,
  orgId,
  model = MODELS.GROK_CODE_FAST_1,
  maxIterations = 15,
  addUsage,
  callback,
}: {
  query: string;
  fileIds?: string[];
  userId: string;
  orgId: string;
  model?: MODELS;
  maxIterations?: number;
  addUsage?: (usage: { usage: LanguageModelUsage; model: string }) => void;
  callback?: (step: StepMessage) => void;
}): Promise<Result<AgentResult, string>> => {
  const agentLogger = createContextLogger({
    agent: "fileAnswerChunkSearch",
    query: query.substring(0, 80),
  });

  try {
    const usageRecord: Record<string, LanguageModelUsage> = {};

    let expandedQuery = query;
    let cleanFileIds: string[] = [];

    if (!fileIds || fileIds.length === 0) {
      const queryExpansionStep: StepMessage = {
        id: uuidv4(),
        type: StepType.QUERY_EXPANSION,
        status: "processing",
        message: "Expanding query",
      };
      callback?.(queryExpansionStep);

      const expansionModel = MODELS.GROK_CODE_FAST_1;
      const expansionLlm = getLLM(expansionModel);
      const expansionResponse = await generateText({
        model: expansionLlm,
        messages: [
          {
            role: "system",
            content:
              "You are given a question by an expert financial analyst, your job is to rephrase the question and add additional context. Be concise.",
          },
          { role: "user", content: query },
        ],
        temperature: 1,
      });

      expandedQuery = expansionResponse.text;
      mergeTokenUsage(usageRecord, expansionModel, expansionResponse.usage);
      addUsage?.({ usage: expansionResponse.usage, model: expansionModel });

      queryExpansionStep.message = "Query expanded";
      queryExpansionStep.status = "done";
      callback?.(queryExpansionStep);

      const filteredDocuments = await documentFilter(expandedQuery, userId, orgId, (usage) => {
        mergeTokenUsage(usageRecord, usage.model, usage.usage);
        addUsage?.(usage);
      });

      cleanFileIds = filteredDocuments.documents.map((d) => d.id);
    } else {
      cleanFileIds = fileIds.map((id) => id.replace("file_", ""));
    }

    const filesInfo = await getFileInfo(cleanFileIds);
    if (filesInfo.length === 0) {
      return err("No valid files found");
    }

    const structuredReportContents: { fileId: string; content: string }[] = [];
    for (const file of filesInfo) {
      if (file.type === "structured_report") {
        const content = await getStructuredReportContent(file.id);
        if (content.isOk() && content.value) {
          structuredReportContents.push({
            fileId: file.id,
            content: content.value,
          });
        }
      }
    }

    const fileContext = filesInfo
      .map((f) => `- ${f.id}: ${f.metadata?.title ?? f.name ?? "Untitled"} (${f.type})`)
      .join("\n");

    const alreadyLookedAtChunks: string[] = [];
    let totalChunksSearched = 0;

    const documentAnalysisTool = tool({
      description: "Search documents and extract relevant information",
      inputSchema: z.object({
        searchQuery: z.string(),
        page: z.number().optional().default(1),
      }),
      execute: async ({ searchQuery, page = 1 }) => {
        const chunks = await similaritySearchChunks({
          query: searchQuery,
          documentIds: cleanFileIds,
          limit: 5,
          userId,
          orgId,
          includeChunkId: true,
          excludeChunkIds: alreadyLookedAtChunks,
        });

        const validChunks = chunks.filter(
          (c) => c !== undefined && c.id !== undefined && !alreadyLookedAtChunks.includes(c.id),
        );
        totalChunksSearched += validChunks.length;

        const queryAgentResult = await queryAgent(
          searchQuery,
          query,
          validChunks.map((c) => ({
            id: c.id,
            documentId: c.documentId,
            content: c.content,
            similarity: c.similarity,
          })),
          (usage) => {
            mergeTokenUsage(usageRecord, usage.model, usage.usage);
            addUsage?.(usage);
          },
        );

        const chunkIds = chunks.map((c) => c.id).filter((id): id is string => id !== undefined);
        alreadyLookedAtChunks.push(...chunkIds);

        return { queryAgentResponse: queryAgentResult.response };
      },
    });

    let userMessage = `## Query\n${query}\n\n## Available Documents\n${fileContext}\n`;
    if (structuredReportContents.length > 0) {
      userMessage += `\n## Structured Report Contents\n${structuredReportContents.map((sr) => `### Report: ${sr.fileId}\n${sr.content}`).join("\n")}\n`;
    }

    const llm = getLLM(model);
    const response = await generateText({
      model: llm,
      system: DATA_EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      tools: { documentAnalysisTool },
      experimental_telemetry: { isEnabled: true, tracer: getTracer() },
      stopWhen: stepCountIs(maxIterations),
    });

    mergeTokenUsage(usageRecord, model, response.usage);
    addUsage?.({ usage: response.usage, model });

    return ok({
      answer: response.text,
      usage: usageRecord,
      chunksSearched: totalChunksSearched,
      iterations: response.steps.length,
    });
  } catch (error) {
    return err(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
};
