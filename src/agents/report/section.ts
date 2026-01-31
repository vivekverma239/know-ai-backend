import { z } from "zod";
import { tool, type LanguageModelUsage } from "ai";
import { MODELS } from "@/@types/llm";
import { err, ok } from "neverthrow";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { userFile, userFileToCMeta } from "@/db/schema";
import {
    getAnswerFromDocUsingParsedPDF,
} from "../document/docAnswer";
import { getPageContentFn } from "../utils";
import {
    similaritySearchChunks,
    similaritySearchDocuments,
} from "@/service/simSearch";
import { logger, createContextLogger } from "@/utils/logger";
import { generateTextWrapper } from "@/ai-backend/llm";

const getFileToc = (fileId: string) => {
    return getDb().query.userFileToCMeta.findFirst({
        where: eq(userFileToCMeta.fileId, fileId),
    });
};

export const getFileAnswerTool = (
    addUsage?: (addUsage: { usage: LanguageModelUsage; model: string }) => void,
    model = MODELS.GROK_CODE_FAST_1,
) => {
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
            const toolLogger = createContextLogger({
                agent: "reportSection",
                phase: "fileAnswerTool",
            });

            try {
                toolLogger.info("📖 File answer query", {
                    fileId,
                    query: query.substring(0, 100),
                });

                const fileIdWithoutFile = fileId.replace("file_", "");
                const toc = await getFileToc(fileIdWithoutFile);
                const file = await getDb().query.userFile.findFirst({
                    where: eq(userFile.id, fileIdWithoutFile),
                });
                if (!toc) {
                    toolLogger.warn("⚠️  Table of Contents not found", { fileId });
                    return "Error: Table of Contents not found";
                }
                if (!file) {
                    logger.error(`File not found: ${fileId}`);
                    return "Error: File not found";
                }
                const getPageContent = getPageContentFn(
                    fileIdWithoutFile,
                    file.userId,
                );
                const similaritySearchChunksFn = async (query: string) => {
                    const chunks = await similaritySearchChunks({
                        query,
                        documentIds: [fileIdWithoutFile],
                        limit: 5,
                        userId: file.userId,
                        orgId: "", // OrgId might be needed
                    });
                    return chunks.map((chunk) => ({
                        pageNumber: chunk.pageNumber ?? 0,
                        content: chunk.content,
                    }));
                };
                const answer = await getAnswerFromDocUsingParsedPDF({
                    query,
                    documentTitle: toc?.metadata?.title ?? "",
                    documentSummary: toc?.metadata?.summary ?? "",
                    toc: (toc?.toc)?.sections ?? [],
                    getPageContentFn: getPageContent,
                    similaritySearchChunksFn: similaritySearchChunksFn,
                    addUsage: addUsage,
                    model: model,
                });

                if (answer.isErr()) {
                    return `Error: ${answer.error.message}`;
                }
                addUsage?.({
                    usage: answer.value.totalUsage,
                    model: model,
                });

                return answer.value.text;
            } catch (error) {
                toolLogger.error("❌ Error in file answer", {
                    error: error instanceof Error ? error.message : String(error),
                    fileId,
                    query: query.substring(0, 100),
                });
                return "Error in file answer";
            }
        },
    });
};

export const getFileSearchTool = (userId: string, orgId: string) => {
    return tool({
        description:
            "Search through available documents to find files that might contain information relevant to your research topic. Use this first to identify potentially useful documents.",
        inputSchema: z.object({
            query: z
                .string()
                .describe(
                    "Search terms related to the section topic or specific information you're looking for",
                ),
        }),
        execute: async ({ query }) => {
            const toolLogger = createContextLogger({
                agent: "reportSection",
                phase: "fileSearchTool",
            });

            try {
                toolLogger.info("🔍 File search query", { query });
                const files = await similaritySearchDocuments({ query, userId, orgId });
                toolLogger.debug("📄 Files found", {
                    count: files.length,
                    fileIds: files.map((f) => `file_${f.id}`),
                });
                return files.map((file) => ({
                    id: `file_${file.id}`,
                    title: file.title,
                    summary: file.summary,
                }));
            } catch (error) {
                toolLogger.error("❌ Error in file search", {
                    error: error instanceof Error ? error.message : String(error),
                    query,
                });
                return "Error in file search";
            }
        },
    });
};

export const prepareSectionSummary = async (
    section: {
        title: string;
        sectionOutline: string;
    },
    report: {
        title: string;
        sections: {
            title: string;
        }[];
    },
    userId: string,
    orgId: string
) => {
    const agentLogger = createContextLogger({
        agent: "reportSection",
        phase: "prepareSectionSummary",
    });

    agentLogger.info("📝 Preparing section summary", {
        sectionTitle: section.title,
        reportTitle: report.title,
        sectionCount: report.sections.length,
    });

    const prompt = `
You are an expert research assistant tasked with preparing a report section. Your role is to analyze the provided section outline and generate detailed content by researching relevant documents.
You should only incorporate information that makes sense and is relevant to the section topic, not overall report

## Available Tools:
- **fileSearch**: Search for relevant documents/files that might contain information related to the section topic
- **fileAnswer**: Extract specific answers from a particular file using targeted queries



## Complete Report Context:
Report Title: ${report.title}
Report Sections: ${report.sections.map((section) => `- ${section.title}`).join("\n")}


## Section to Research:
**Title:** ${section.title}
**Content Outline:** ${section.sectionOutline}


## Your Task:
1. **Research Phase**: Use fileSearch to identify relevant documents that contain information about "${section.title}"
2. **Information Extraction**: Use fileAnswer to extract specific details from the most relevant documents
3. **Report Generation**: Create a comprehensive, well-structured report section

## Critical Requirements:
- **ONLY use information from the tools** - Do not rely on your own knowledge
- **Always cite your sources** - Reference the specific files and documents you used
- **Be thorough** - Search multiple documents to ensure comprehensive coverage
- **Be accurate** - Only include information that you can verify through the tools
- DO NOT INCLUDE MORE THAN 1 CITATION in one square bracket, if you have multiple files add like this [fileID/page=pageNumber] [fileID/page=pageNumber]
## Output Format Guidelines:
- **Structure**: Use clear headings and subheadings
- **Format**: Write in markdown with proper formatting
- **Citations**: Include inline ciations for all the extracted information and claims, you can use [fileID/page=pageNumber] format for citations, 
if you are using multiple pages, you can use [fileID/page=pageNumber,pageNumber] format for citations, where fileID is the id of the file and 
pageNumber is the page number of the page being referenced. Make sure to reference pages as much as possible. There should only be one citation in 
a square bracket. and either page range or a singel page number as showin in example below.
Here is an example: 
This segment reported €3.4 billion in sales and a 17.3% operating margin in FY2022, with most brands surpassing pre-pandemic levels [file_8320377c-f09e-4739-8d4e-9726fbae32de/page=1,2] [file_8320377c-f09e-4739-8d4e-9726fbae32de/page=5]..
- **Data Presentation**:
  - Use tables for numerical data, financial figures, and comparisons
  - Use bullet points for lists and key findings
  - Use code blocks only for technical specifications or code examples
- **Writing Style**:
  - Use short, clear paragraphs
  - Write in a professional, analytical tone
  - State assumptions explicitly when making inferences
  - If information is incomplete, clearly indicate what additional research is needed
  - Make sure to use tables/nested bullets to show numerical data or breakdowns, you should not use large paragraphs to show numbers
  - MUst use tables wherever applicable

## Process:
1. Start by searching for documents related to the section topic
2. Review search results and select the most relevant files
3. Extract detailed information from selected files using targeted queries
4. Synthesize the information into a coherent report section
5. Ensure all claims are properly cited and supported by source material

Remember: Your goal is to create a comprehensive, well-researched report section that provides valuable insights based solely on the available documents.
    `;
    const fileSearchTool = getFileSearchTool(userId, orgId);
    const fileAnswerTool = getFileAnswerTool();
    const answer = await generateTextWrapper({
        model: MODELS.GROK_CODE_FAST_1,
        messages: [
            { role: "system", content: prompt },
            {
                role: "user",
                content: `Section Title: ${section.title} Section Content: ${section.sectionOutline}`,
            },
        ],
        reasoningLevel: "none",
        tools: { fileSearch: fileSearchTool, fileAnswer: fileAnswerTool },
        systemPrompt: prompt,
    });

    if (answer.isErr()) {
        agentLogger.error("❌ Error preparing section summary", {
            error: answer.error,
            sectionTitle: section.title,
        });
        return err(answer.error);
    }

    agentLogger.info("✅ Section summary prepared", {
        answerLength: answer.value.text.length,
        answerPreview: answer.value.text.substring(0, 200),
        steps: answer.value.steps.length,
    });

    return ok({
        answer: answer.value.text,
        steps: answer.value.steps.map((step) => ({
            toolCalls: step.toolCalls,
            toolResults: step.toolResults,
            content: step.text,
            reasoning: step.reasoning,
            finishReason: step.finishReason,
            usage: step.usage,
            text: step.text,
        })),
    });
};
