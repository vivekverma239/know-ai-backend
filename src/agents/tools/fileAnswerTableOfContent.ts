import { z } from "zod";
import {
    generateText,
    tool,
    type LanguageModelUsage,
    stepCountIs,
    type ToolSet,
} from "ai";
import { MODELS } from "@/@types/llm";
import { eq, inArray } from "drizzle-orm";
// import { db } from "@/server/db"; // Use getDb
import { getDb } from "@/db";
import {
    structuredReports,
    userFile,
    userFileToCMeta,
} from "@/db/schema";
import {
    getAnswerFromDocUsingParsedPDF,
    quickAnswerUsingParsedPDF,
} from "@/agents/document/docAnswer";
import { getPageContentFn } from "@/agents/utils";
import { logger, createContextLogger } from "@/utils/logger";
import type { ToolContext } from "./toolContext";
import { err, ok, type Result } from "neverthrow";
import { getLLM } from "@/ai-backend/llm";
import { similaritySearchChunks } from "@/service/simSearch";
import { mergeTokenUsage } from "@/agents/report/utils";
import { getTracer } from "@lmnr-ai/lmnr";
import { COMMON_CITATION_PROMPT } from "@/agents/common";

const db = getDb();

// ============================================================================
// Types
// ============================================================================

type FileInfo = {
    id: string;
    name: string | null;
    type: string;
    metadata?: {
        title?: string;
        shortSummary?: string;
    } | null;
};

type FileTocInfo = {
    fileId: string;
    fileName: string;
    documentTitle: string;
    documentSummary: string;
    toc: Array<{
        title: string;
        pageStart: number;
        pageEnd: number;
        subsections?: Array<{
            title: string;
            pageStart: number;
            pageEnd: number;
        }>;
    }>;
    isStructuredReport: boolean;
    structuredReportContent?: string;
};

type AgentResult = {
    answer: string;
    usage: Record<string, LanguageModelUsage>;
    filesProcessed: number;
};

// ============================================================================
// Helper Functions
// ============================================================================

const getFileToc = (fileId: string) => {
    return db.query.userFileToCMeta.findFirst({
        where: eq(userFileToCMeta.fileId, fileId),
    });
};

const getAllFilesTocInfo = async (
    fileIds: string[],
): Promise<FileTocInfo[]> => {
    const files = await db.query.userFile.findMany({
        where: inArray(userFile.id, fileIds),
    });

    const filesTocInfo: FileTocInfo[] = [];

    for (const file of files) {
        if (file.type === "structured_report") {
            const report = await db.query.structuredReports.findFirst({
                where: eq(structuredReports.id, file.structuredReportId!),
            });
            if (report) {
                filesTocInfo.push({
                    fileId: file.id,
                    fileName: file.metadata?.title ?? file.name ?? "Untitled",
                    documentTitle: file.metadata?.title ?? file.name ?? "Untitled",
                    documentSummary: file.metadata?.summary ?? "",
                    toc: [],
                    isStructuredReport: true,
                    structuredReportContent: report.finalOutput ?? "",
                });
            }
        } else {
            const toc = await getFileToc(file.id);
            if (toc) {
                filesTocInfo.push({
                    fileId: file.id,
                    fileName: file.metadata?.title ?? file.name ?? "Untitled",
                    documentTitle:
                        toc.metadata?.title ??
                        file.metadata?.title ??
                        file.name ??
                        "Untitled",
                    documentSummary:
                        toc.metadata?.summary ?? file.metadata?.summary ?? "",
                    toc: toc.toc?.sections ?? [],
                    isStructuredReport: false,
                });
            }
        }
    }

    return filesTocInfo;
};

// ============================================================================
// Final Answer Agent
// ============================================================================

const FINAL_ANSWER_SYSTEM_PROMPT = `
You are an expert financial research assistant. Your task is to answer questions by navigating through multiple documents using their Table of Contents (ToC).

## Your Capabilities
- **fetchPagesFromFile**: Fetch specific pages from a PDF document to read their content. Use this when you know which pages to read based on the table of contents.
- **similaritySearchChunks**: Search for similar chunks in a PDF document using semantic search. Use this if you are looking for specific information that might not be clearly covered in the table of contents.
- **getStructuredReportContent**: Get the full content of a structured report

## Research Process
1. **Analyze the query**: Understand what information is being requested
2. **Review Table of Contents**: Examine the ToC of all available documents to identify relevant sections
3. **Plan your search**: Determine which files and pages are most likely to contain the answer
4. **Fetch pages**: Use the tools with parallel calling to fetch relevant pages from the appropriate documents
5. **Synthesize information**: Combine information from multiple documents and pages
6. **Provide comprehensive answer**: Give a complete answer with proper citations

## Citation Format
- Use inline citations in this format: "The company reported $50B revenue [file_{fileId}/page=1,2]"
- Always cite the file ID and page numbers for any information you reference
- For structured reports, use: "According to the report [file_{fileId}]"

## Important Guidelines
- **DO NOT** make assumptions or include information not present in the documents
- **MUST** output correct citations for all referenced information
- If the query cannot be answered, say so explicitly
- Structure your response logically with clear sections for complex answers
- When citing multiple sources, use sequential numbering [1], [2], [3], etc.
- For financial data, always include the specific year/period being referenced
- If data is unavailable or incomplete, clearly state this limitation
- Keep in mind current year is ${new Date().getFullYear()}
- Make sure to prioritize LATEST information available

${COMMON_CITATION_PROMPT}

Current date: ${new Date().toISOString()}
`;

/**
 * File Answer Agent that works across multiple files using TOC-based approach
 * The agent receives all files' TOC in the prompt and uses tools to fetch specific pages
 */
export const fileAnswerAgent = async ({
    query,
    fileIds,
    userId,
    orgId,
    model = MODELS.GROK_CODE_FAST_1,
    maxIterations = 15,
    addUsage,
}: {
    query: string;
    fileIds: string[];
    userId: string;
    orgId: string;
    model?: MODELS;
    maxIterations?: number;
    addUsage?: (usage: { usage: LanguageModelUsage; model: string }) => void;
}): Promise<Result<AgentResult, string>> => {
    const agentLogger = createContextLogger({
        agent: "fileAnswerAgent",
        phase: "exec",
    });

    try {
        // Aggregate usage across all stages
        const usageRecord: Record<string, LanguageModelUsage> = {};

        // Clean file IDs (remove 'file_' prefix if present)
        const cleanFileIds = fileIds.map((id) => id.replace("file_", ""));

        agentLogger.info("🚀 Starting file answer agent", {
            queryLength: query.length,
            fileIds: cleanFileIds,
            fileCount: cleanFileIds.length,
            maxIterations,
        });

        // Get all files' TOC information
        const filesTocInfo = await getAllFilesTocInfo(cleanFileIds);
        if (filesTocInfo.length === 0) {
            return err("No valid files found or files missing TOC");
        }

        // Build file context map for quick lookup
        const fileContextMap = new Map<string, FileTocInfo>();
        filesTocInfo.forEach((info) => {
            fileContextMap.set(info.fileId, info);
        });

        // Build TOC section for system prompt
        const tocSections = filesTocInfo
            .map((fileInfo) => {
                if (fileInfo.isStructuredReport) {
                    return `
### File: ${fileInfo.fileName} (ID: ${fileInfo.fileId})
Type: Structured Report
Summary: ${fileInfo.documentSummary}

This is a structured report. Use getStructuredReportContent tool to retrieve its full content.
`;
                }
                    const tocString = fileInfo.toc
                        .map((section, idx) => {
                            const subsections =
                                section.subsections && section.subsections.length > 0
                                    ? section.subsections
                                        .map(
                                            (sub) =>
                                                `    - ${sub.title} (pages ${sub.pageStart} - ${sub.pageEnd})`,
                                        )
                                        .join("\n")
                                    : "    - No subsections";
                            return `  ${idx + 1}. ${section.title} (pages ${section.pageStart} - ${section.pageEnd})\n${subsections}`;
                        })
                        .join("\n");

                    return `
### File: ${fileInfo.fileName} (ID: ${fileInfo.fileId})
Title: ${fileInfo.documentTitle}
Summary: ${fileInfo.documentSummary}

Table of Contents:
${tocString || "  - No table of contents available"}
`;
            })
            .join("\n");

        // Helper function to get page content function for a file (loads from DB on demand)
        const getPageContentForFile = async (
            fileId: string,
        ): Promise<
            | ((
                pages: number[],
            ) => Promise<{ pageNumber: number; content: string }[]>)
            | null
        > => {
            const file = await db.query.userFile.findFirst({
                where: eq(userFile.id, fileId),
            });
            if (!file) {
                return null;
            }
            return getPageContentFn(fileId, file.userId); // Fix: use userId not createdById
        };

        // Create tools for fetching pages from files
        const tools: ToolSet = {};

        // Check if there are any PDF files
        const pdfFiles = filesTocInfo.filter((f) => !f.isStructuredReport);
        if (pdfFiles.length > 0) {
            tools.fetchPagesFromFile = tool({
                description: `Fetch specific pages from a PDF document. Available files: ${pdfFiles
                    .map((f) => `${f.fileName} (ID: ${f.fileId})`)
                    .join(
                        ", ",
                    )}. Use this to read content from specific pages based on the table of contents.`,
                inputSchema: z.object({
                    fileId: z.string().describe("ID of the file to fetch pages from"),
                    query: z
                        .string()
                        .describe("What information you are looking for in these pages"),
                    pages: z
                        .array(z.number())
                        .describe("Array of page numbers to fetch from this document"),
                }),
                execute: async ({
                    fileId,
                    query: pageQuery,
                    pages,
                }: {
                    fileId: string;
                    query: string;
                    pages: number[];
                }) => {
                    const fileInfo = fileContextMap.get(fileId);
                    if (!fileInfo || fileInfo.isStructuredReport) {
                        return `Error: File ${fileId} is not a PDF file or not found. Use getStructuredReportContent for structured reports.`;
                    }

                    const getPageContent = await getPageContentForFile(fileId);
                    if (!getPageContent) {
                        return `Error: Cannot fetch pages from file ${fileId}`;
                    }

                    agentLogger.info("📄 Fetching pages from file", {
                        fileId,
                        fileName: fileInfo.fileName,
                        pages,
                    });

                    const pagesContent = await getPageContent(pages);
                    const response = await quickAnswerUsingParsedPDF({
                        query: pageQuery,
                        documentTitle: fileInfo.documentTitle,
                        documentSummary: fileInfo.documentSummary,
                        pageNumbers: pages,
                        pagesContent: pagesContent,
                    });

                    if (response.isErr()) {
                        return `Error fetching pages: ${response.error.message}`;
                    }

                    const pageContent = response.value?.text ?? "";
                    const pageUsage = response.value?.totalUsage ?? response.value?.usage;
                    if (pageUsage) {
                        mergeTokenUsage(
                            usageRecord,
                            MODELS.GEMINI_2_5_FLASH_LITE,
                            pageUsage,
                        );
                        if (addUsage) {
                            addUsage({
                                usage: pageUsage,
                                model: MODELS.GEMINI_2_5_FLASH_LITE,
                            });
                        }
                    }

                    return pageContent;
                },
            });
        }

        // Add similarity search tool for PDF files
        if (pdfFiles.length > 0) {
            tools.similaritySearchChunks = tool({
                description: `Search for similar chunks in a PDF document using semantic search. Available files: ${filesTocInfo
                    .filter((f) => !f.isStructuredReport)
                    .map((f) => `${f.fileName} (ID: ${f.fileId})`)
                    .join(
                        ", ",
                    )}. Use this if you are looking for specific information that might not be clearly covered in the table of contents.`,
                inputSchema: z.object({
                    fileId: z.string().describe("ID of the file to search within"),
                    query: z.string().describe("Search query to find relevant chunks"),
                }),
                execute: async ({
                    fileId,
                    query: searchQuery,
                }: {
                    fileId: string;
                    query: string;
                }) => {
                    const fileInfo = fileContextMap.get(fileId);
                    if (!fileInfo || fileInfo.isStructuredReport) {
                        return `Error: File ${fileId} is not a PDF file or not found`;
                    }

                    agentLogger.info("🔍 Similarity search in file", {
                        fileId,
                        fileName: fileInfo.fileName,
                        query: searchQuery,
                    });

                    const file = await db.query.userFile.findFirst({
                        where: eq(userFile.id, fileId),
                    });

                    // Need userId and orgId for sim search
                    if (!file) {
                        return "Error: File not found";
                    }

                    const chunks = await similaritySearchChunks({
                        query: searchQuery,
                        documentIds: [fileId],
                        limit: 5,
                        userId: file.userId,
                        orgId: file.orgId,
                    });

                    return chunks
                        .map(
                            (chunk) =>
                                `Page ${chunk.pageNumber ?? "unknown"}: ${chunk.content}`,
                        )
                        .join("\n\n");
                },
            });
        }

        // Add getStructuredReportContent tool for structured reports
        const structuredReportFiles = filesTocInfo.filter(
            (f) => f.isStructuredReport,
        );
        if (structuredReportFiles.length > 0) {
            tools.getStructuredReportContent = tool({
                description: `Get the full content of a structured report. Available reports: ${structuredReportFiles.map((f) => `${f.fileName} (ID: ${f.fileId})`).join(", ")}`,
                inputSchema: z.object({
                    fileId: z
                        .string()
                        .describe("ID of the structured report file to retrieve"),
                }),
                execute: async ({ fileId }: { fileId: string }) => {
                    const fileInfo = fileContextMap.get(fileId);
                    if (!fileInfo || !fileInfo.isStructuredReport) {
                        return `Error: File ${fileId} is not a structured report or not found`;
                    }

                    agentLogger.info("📋 Getting structured report content", {
                        fileId,
                        fileName: fileInfo.fileName,
                    });

                    return `Content from ${fileInfo.fileName} (ID: ${fileId}):\n\n${fileInfo.structuredReportContent ?? "No content available"}`;
                },
            });
        }

        // Build system prompt with all TOCs
        const systemPrompt = `${FINAL_ANSWER_SYSTEM_PROMPT}

## Available Documents

${tocSections}

## Instructions
1. Review the table of contents of all documents to identify relevant sections
2. Use the appropriate tools to fetch pages from documents
3. For structured reports, use getStructuredReportContent tool
4. Synthesize information from multiple sources
5. Provide a comprehensive answer with proper citations
`;

        const llm = getLLM(model);
        const response = await generateText({
            model: llm,
            system: systemPrompt,
            messages: [{ role: "user", content: query }],
            tools,
            experimental_telemetry: {
                isEnabled: true,
                tracer: getTracer(),
            },
            stopWhen: stepCountIs(maxIterations),
            onStepFinish: (step) => {
                if (step.toolCalls) {
                    agentLogger.debug("🔧 Tool calls", {
                        toolCallCount: step.toolCalls.length,
                        toolNames: step.toolCalls.map((tc) => tc.toolName),
                    });
                }
            },
        });

        // Track main agent usage
        const mainAgentUsage = response.totalUsage ?? response.usage;
        mergeTokenUsage(usageRecord, model, mainAgentUsage);
        if (addUsage) {
            addUsage({
                usage: mainAgentUsage,
                model,
            });
        }

        agentLogger.info("✅ Agent completed", {
            steps: response.steps.length,
            answerLength: response.text.length,
            filesProcessed: filesTocInfo.length,
        });

        return ok({
            answer: response.text,
            usage: usageRecord,
            filesProcessed: filesTocInfo.length,
        });
    } catch (error) {
        agentLogger.error("❌ Agent error", {
            error: error instanceof Error ? error.message : String(error),
        });
        return err(
            `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
    }
};

// ============================================================================
// Tool Export
// ============================================================================

/**
 * Get the File Answer Agent as a tool for use in other agents
 */
export const getFileAnswerAgentTool = ({
    context,
    model = MODELS.GROK_CODE_FAST_1,
}: {
    context: ToolContext;
    model?: MODELS;
}) => {
    return tool({
        description:
            "An intelligent agent that works across multiple files to find comprehensive answers using table of contents navigation. It receives all files' TOC in the prompt and uses tools to fetch specific pages from documents as needed. The agent can navigate across multiple files and synthesize information from different sources.",
        inputSchema: z.object({
            query: z
                .string()
                .describe(
                    "The question or information need to research across the documents",
                ),
            fileIds: z
                .array(z.string())
                .describe(
                    "Array of file IDs to search within. Can include 'file_' prefix.",
                ),
        }),
        execute: async ({
            query,
            fileIds,
        }: {
            query: string;
            fileIds: string[];
        }) => {
            // const toolLogger = createContextLogger({ tool: "finalAnswerAgent" });

            const result = await fileAnswerAgent({
                query,
                fileIds,
                userId: context.userId,
                orgId: context.orgId,
                model,
                addUsage: context.addUsage,
            });

            if (result.isErr()) {
                return `Error: ${result.error}`;
            }

            // Add usage for all models used
            Object.entries(result.value.usage).forEach(([modelName, usage]) => {
                context.addUsage?.({
                    usage,
                    model: modelName,
                });
            });

            return {
                answer: result.value.answer,
                metadata: {
                    filesProcessed: result.value.filesProcessed,
                },
            };
        },
    });
};

// ============================================================================
// Legacy Tool (for backward compatibility)
// ============================================================================

export const getFileAnswerTool = ({
    context,
    model = MODELS.GROK_CODE_FAST_1,
}: {
    context: ToolContext;
    model?: MODELS;
}) => {
    return tool({
        description:
            "Extract specific information from a particular file by asking targeted questions about its content. Use this after fileSearch to get detailed answers from the most relevant documents.",
        inputSchema: z.object({
            query: z
                .string()
                .describe("Specific question or query about the file content"),
            fileId: z.string().describe("ID of the file to search within"),
        }),
        execute: async ({ query, fileId }) => {
            try {
                logger.info(`File answer query: FileId: ${fileId} Query: ${query}`);
                const fileIdWithoutFile = fileId.replace("file_", "");

                // Use the new fileAnswerAgent for single file
                const result = await fileAnswerAgent({
                    query,
                    fileIds: [fileIdWithoutFile],
                    userId: context.userId,
                    orgId: context.orgId,
                    model,
                    addUsage: context.addUsage,
                });

                if (result.isOk()) {
                    // Add usage for all models used
                    Object.entries(result.value.usage).forEach(([modelName, usage]) => {
                        context.addUsage?.({
                            usage,
                            model: modelName,
                        });
                    });
                    return result.value.answer;
                }
                return `Error: ${result.error}`;
            } catch (error) {
                logger.error("Error in file answer", {
                    error: error instanceof Error ? error.message : String(error),
                    query: query.substring(0, 100),
                    fileId,
                });
                return `Error in file answer: ${error instanceof Error ? error.message : "Unknown error"}`;
            }
        },
    });
};
