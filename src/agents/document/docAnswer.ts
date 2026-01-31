import {
    type FilePart,
    type ImagePart,
    type LanguageModelUsage,
    type TextPart,
    type ToolSet,
    tool,
} from "ai";
import z from "zod";
import type { TocSection } from "@/agents/document/parseToCMeta";
import { generateTextWrapper } from "@/ai-backend/llm";
import { MODELS } from "@/@types/llm";
import { logger, createContextLogger } from "@/utils/logger";

const SYSTEM_PROMPT = `
You are an helpful assistant, your job is to look at the provided pages from a pdf document and answer the given query. 

Follow these guidelines:
- Be accurate and descriptive while answering the query.
- DO NOT USE YOUR OWN KNOWLEDGE, ONLY USE THE INFORMATION FROM THE PROVIDED PAGES.
- Use appropirate inline citations to denote which pages are being used to support the answer.

Citation format:
 - Use following format for inline citations:
  [page_{number}] where {number} is the page number of the page being referenced.
  For Example:
   Apple revenue of Q3 2024 was $100 billion [page_23].
 - Note: This simplified format is used for single-document contexts. For multi-document scenarios, use [fileID/page=pageNumber].
`;

type PageUrl = {
    pageNumber: number;
    url: string | Buffer;
};

export const quickAnswer = async ({
    query,
    documentTitle,
    documentSummary,
    pages,
}: {
    query: string;
    documentTitle: string;
    documentSummary: string;
    pages: PageUrl[];
}) => {
    const agentLogger = createContextLogger({
        agent: "docAnswer",
        phase: "quickAnswer",
    });

    agentLogger.info("📖 Starting quick answer", {
        query: query.substring(0, 100),
        documentTitle,
        pageCount: pages.length,
        pageNumbers: pages.map((p) => p.pageNumber),
    });

    const start = performance.now();
    const parts: (TextPart | ImagePart)[] = [
        {
            type: "text",
            text: `Query: ${query}
The following pages are from the pdf document:
Document Title: ${documentTitle}
Document Summary: ${documentSummary}

`,
        },
    ];

    for (const p of pages) {
        parts.push({
            type: "text",
            text: `Page number: ${p.pageNumber}`,
        } as TextPart);
        parts.push({
            type: "image",
            image: p.url,
            mediaType: "image/png",
        } as ImagePart);
    }

    const response = await generateTextWrapper({
        model: MODELS.GEMINI_2_5_FLASH_LITE,
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
                role: "user",
                content: parts,
            },
        ],
        reasoningLevel: "default",
        systemPrompt: SYSTEM_PROMPT,
    });

    const end = performance.now();

    agentLogger.info("✅ Quick answer completed", {
        timeMs: end - start,
        timeSec: ((end - start) / 1000).toFixed(2),
        responseLength: response.isOk() ? response.value.text.length : 0,
    });

    return response;
};

export const quickAnswerUsingSubPDF = async ({
    query,
    documentTitle,
    documentSummary,
    pageNumbers,
    subPDF,
}: {
    query: string;
    documentTitle: string;
    documentSummary: string;
    pageNumbers: number[];
    subPDF: Buffer;
}) => {
    const parts: (TextPart | FilePart)[] = [
        {
            type: "text",
            text: `Query: ${query}
The following pages are from the pdf document:
Page Numbers: ${JSON.stringify(pageNumbers)}
Document Title: ${documentTitle}
Document Summary: ${documentSummary}

`,
        },
        {
            type: "file",
            data: subPDF,
            mediaType: "application/pdf",
        } as FilePart,
    ];

    const response = await generateTextWrapper({
        model: MODELS.GEMINI_2_5_FLASH_LITE,
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
                role: "user",
                content: parts,
            },
        ],
        reasoningLevel: "default",
        systemPrompt: SYSTEM_PROMPT,
    });

    return response;
};

export const quickAnswerUsingParsedPDF = async ({
    query,
    documentTitle,
    documentSummary,
    pageNumbers,
    pagesContent,
}: {
    query: string;
    documentTitle: string;
    documentSummary: string;
    pageNumbers: number[];
    pagesContent: { pageNumber: number; content: string }[];
}) => {
    const parts: (TextPart | FilePart)[] = [
        {
            type: "text",
            text: `Query: ${query}
The following pages are from the pdf document:
Page Numbers: ${JSON.stringify(pageNumbers)}
Document Title: ${documentTitle}
Document Summary: ${documentSummary}

${pagesContent.map((p) => `Page number: ${p.pageNumber}\nContent: ${p.content}`).join("\n")}

`,
        },
    ];

    const response = await generateTextWrapper({
        model: MODELS.GEMINI_2_5_FLASH_LITE,
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
                role: "user",
                content: parts,
            },
        ],
        reasoningLevel: "default",
        systemPrompt: SYSTEM_PROMPT,
    });

    return response;
};

const subPDFAnswerTool = (
    documentTitle: string,
    documentSummary: string,
    getPagesFn: (pages: number[]) => Promise<PageUrl[]>,
) => {
    return tool({
        description: "Answer a question about a sub-section of a pdf document",
        inputSchema: z.object({
            query: z.string(),
            pages: z.array(z.number()),
        }),
        execute: async ({ query, pages }) => {
            const toolLogger = createContextLogger({
                agent: "docAnswer",
                phase: "subPDFAnswerTool",
            });

            const pagesUrl = await getPagesFn(pages);
            const response = await quickAnswer({
                query,
                documentTitle,
                documentSummary,
                pages: pagesUrl,
            });
            if (response.isErr()) {
                toolLogger.error("❌ Quick answer V2 failed", {
                    query: query.substring(0, 100),
                    pages,
                });
                return "Error";
            }

            toolLogger.debug("✅ Quick answer V2 response", {
                responseLength: response.value?.text.length ?? 0,
                responsePreview: response.value?.text.substring(0, 200) ?? "",
            });

            return response.value?.text;
        },
    });
};

const subPDFAnswerToolUsingSubPDF = (
    documentTitle: string,
    documentSummary: string,
    getSubPDFFn: (pages: number[]) => Promise<Buffer>,
    addUsage?: (addUsage: { usage: LanguageModelUsage; model: string }) => void,
) => {
    return tool({
        description: "Answer a question about a sub-section of a pdf document",
        inputSchema: z.object({
            query: z.string(),
            pages: z.array(z.number()),
        }),
        execute: async ({ query, pages }) => {
            logger.info(
                `Sub PDF answer tool called: ${query}, ${JSON.stringify(pages)}`,
            );
            const pagesUrl = await getSubPDFFn(pages);
            const response = await quickAnswerUsingSubPDF({
                query,
                documentTitle,
                documentSummary,
                subPDF: pagesUrl,
                pageNumbers: pages,
            });
            if (response.isErr()) {
                return "Error";
            }
            addUsage?.({
                usage: response.value?.totalUsage as LanguageModelUsage,
                model: MODELS.GEMINI_2_5_FLASH_LITE,
            });
            logger.info("Sub PDF answer tool response");
            return response.value?.text;
        },
    });
};

const parsedPDFAnswerTool = (
    documentTitle: string,
    documentSummary: string,
    getPageContentFn: (
        pages: number[],
    ) => Promise<{ pageNumber: number; content: string }[]>,
    addUsage?: (addUsage: { usage: LanguageModelUsage; model: string }) => void,
) => {
    return tool({
        description: "Answer a question about a sub-section of a pdf document",
        inputSchema: z.object({
            query: z.string(),
            pages: z.array(z.number()),
        }),
        execute: async ({ query, pages }) => {
            logger.info(
                `Sub PDF answer tool called: ${query}, ${JSON.stringify(pages)}`,
            );
            const pagesContent = await getPageContentFn(pages);
            const response = await quickAnswerUsingParsedPDF({
                query,
                documentTitle,
                documentSummary,
                pagesContent: pagesContent,
                pageNumbers: pages,
            });
            if (response.isErr()) {
                return "Error";
            }
            addUsage?.({
                usage: response.value?.totalUsage as LanguageModelUsage,
                model: MODELS.GEMINI_2_5_FLASH_LITE,
            });
            return response.value?.text;
        },
    });
};

const DocumentAnswerPrompt = `
You are a helpful document QA assistant. Use the provided Table of Contents (ToC)
to locate the most relevant sections and answer the user's query strictly using
information from the source document.

TOOL USAGE:
- Always use the 'subPDFAnswer' tool to read and extract information from the
  exact pages you deem relevant based on the ToC. You may call the tool
  multiple times if needed to cover all relevant pages.
- Prefer the narrowest precise page ranges that fully answer the question.

STRICT CITATION RULES:
- The tool will return inline citations in the format [page_{number}].
- You MUST preserve these citations exactly in your final answer.
- Do not alter, remove, or renumber page citations.
- Explicitly mention the specific page numbers used in your answer.

ANSWERING POLICY:
- Do NOT use outside knowledge. If the document does not contain the answer,
  say so and explain which pages you checked.
- Be concise, factual, and refrain from speculation.
- If multiple parts of the document conflict, note the discrepancy and cite
  each location.

OUTPUT FORMAT:
1) Direct Answer: Provide the answer with inline page citations.
2) Pages Consulted: List page numbers used (e.g., 12-14, 27).
3) Rationale (brief): One sentence on how the ToC guided selection.
`;

/**
 * Process a query to answer a question from a document, this agent looks at the
 * table of content and decides on which pages to look at and then asnwer the questions
 */
export const getAnswerFromDocUsingPageImages = async ({
    query,
    documentTitle,
    documentSummary,
    toc,
    getPagesFn,
    model = MODELS.GROK_CODE_FAST_1,
}: {
    query: string;
    documentTitle: string;
    documentSummary: string;
    toc: TocSection[];
    getPagesFn: (pages: number[]) => Promise<PageUrl[]>;
    model?: MODELS;
}) => {
    const tools: ToolSet = {
        subPDFAnswer: subPDFAnswerTool(documentTitle, documentSummary, getPagesFn),
    };

    const response = await generateTextWrapper({
        model: model,
        messages: [
            { role: "system", content: DocumentAnswerPrompt },
            {
                role: "user",
                content: `
                User Query: ${query}
                Document Title: ${documentTitle}
                Document Summary: ${documentSummary}
                Table of Content: ${JSON.stringify(toc)}
                `,
            },
        ],
        systemPrompt: DocumentAnswerPrompt,
        reasoningLevel: "default",
        tools,
    });
    return response;
};

export const getAnswerFromDocUsingSubPDF = async ({
    query,
    documentTitle,
    documentSummary,
    toc,
    getSubPDFFn,
    addUsage,
    model = MODELS.GROK_CODE_FAST_1,
}: {
    query: string;
    documentTitle: string;
    documentSummary: string;
    toc: TocSection[];
    getSubPDFFn: (pages: number[]) => Promise<Buffer>;
    addUsage?: (addUsage: { usage: LanguageModelUsage; model: string }) => void;
    model?: MODELS;
}) => {
    const agentLogger = createContextLogger({
        agent: "docAnswer",
        phase: "getAnswerFromDocUsingSubPDF",
    });

    agentLogger.info("📚 Getting answer from doc using sub-PDF", {
        query: query.substring(0, 100),
        documentTitle,
        tocSections: toc.length,
        model,
    });

    const tools: ToolSet = {
        subPDFAnswer: subPDFAnswerToolUsingSubPDF(
            documentTitle,
            documentSummary,
            getSubPDFFn,
            addUsage,
        ),
    };

    const systemPrompt = `
  ${DocumentAnswerPrompt}

  Document Title: ${documentTitle}
  Document Summary: ${documentSummary}

  Table of Contents:
  ${toc
            .map((t, i) => {
                const subsections =
                    t.subsections && t.subsections.length > 0
                        ? t.subsections
                            .map(
                                (s) => `    - ${s.title} (pages ${s.pageStart} - ${s.pageEnd})`,
                            )
                            .join("\n")
                        : "    - No subsections";
                return `  ${i + 1}. ${t.title} (pages ${t.pageStart} - ${t.pageEnd})\n${subsections}`;
            })
            .join("\n")}
  `;
    const response = await generateTextWrapper({
        model: model,
        messages: [
            { role: "system", content: systemPrompt },
            {
                role: "user",
                content: `
                User Query: ${query}
                Today's Date: ${new Date().toISOString().split("T")[0]}
                `,
            },
        ],
        systemPrompt: systemPrompt,
        reasoningLevel: "high",
        tools,
        onStepFinishCallback(stepResult) { },
    });

    if (!response.isErr()) {
        agentLogger.info("✅ Answer from sub-PDF completed", {
            responseLength: response.value?.text.length ?? 0,
            totalUsage: response.value?.totalUsage,
        });
    } else {
        agentLogger.error("❌ Answer from sub-PDF failed", {
            error: response.error,
        });
    }

    return response;
};

export const getAnswerFromDocUsingParsedPDF = async ({
    query,
    documentTitle,
    documentSummary,
    toc,
    getPageContentFn,
    similaritySearchChunksFn,
    addUsage,
    model = MODELS.GROK_CODE_FAST_1,
}: {
    query: string;
    documentTitle: string;
    documentSummary: string;
    toc: TocSection[];
    getPageContentFn: (
        pages: number[],
    ) => Promise<{ pageNumber: number; content: string }[]>;
    similaritySearchChunksFn: (
        query: string,
    ) => Promise<{ pageNumber: number; content: string }[]>;
    addUsage?: (addUsage: { usage: LanguageModelUsage; model: string }) => void;
    model?: MODELS;
}) => {
    const agentLogger = createContextLogger({
        agent: "docAnswer",
        phase: "getAnswerFromDocUsingParsedPDF",
    });

    agentLogger.info("📚 Getting answer from doc using parsed PDF", {
        query: query.substring(0, 100),
        documentTitle,
        tocSections: toc.length,
        model,
    });

    const tools: ToolSet = {
        subPDFAnswer: parsedPDFAnswerTool(
            documentTitle,
            documentSummary,
            getPageContentFn,
            addUsage,
        ),
        similaritySearchChunks: tool({
            description: "Search for similar chunks in the document",
            inputSchema: z.object({
                query: z.string(),
            }),
            execute: async ({ query }) => {
                logger.info(`Similarity search chunks query: ${query}`);
                return await similaritySearchChunksFn(query);
            },
        }),
    };

    const systemPrompt = `
  ${DocumentAnswerPrompt}


  You also have access to perform semantic search on the document using the 'similaritySearchChunks' tool. This will 
  search for similar chunks within documents and return the most relevant chunks. Use this if you are looking for specific
  information or context that is not covered in the table of contents.

  Document Title: ${documentTitle}
  Document Summary: ${documentSummary}

  Table of Contents:
  ${toc
            .map((t, i) => {
                const subsections =
                    t.subsections && t.subsections.length > 0
                        ? t.subsections
                            .map(
                                (s) => `    - ${s.title} (pages ${s.pageStart} - ${s.pageEnd})`,
                            )
                            .join("\n")
                        : "    - No subsections";
                return `  ${i + 1}. ${t.title} (pages ${t.pageStart} - ${t.pageEnd})\n${subsections}`;
            })
            .join("\n")}
  `;
    const response = await generateTextWrapper({
        model: model,
        messages: [
            { role: "system", content: systemPrompt },
            {
                role: "user",
                content: `
                User Query: ${query}
                Today's Date: ${new Date().toISOString().split("T")[0]}
                `,
            },
        ],
        systemPrompt: systemPrompt,
        reasoningLevel: "high",
        tools,
        onStepFinishCallback(stepResult) { },
    });

    if (!response.isErr()) {
        agentLogger.info("✅ Answer from parsed PDF completed", {
            responseLength: response.value?.text.length ?? 0,
            totalUsage: response.value?.totalUsage,
        });
    } else {
        agentLogger.error("❌ Answer from parsed PDF failed", {
            error: response.error,
        });
    }

    return response;
};
