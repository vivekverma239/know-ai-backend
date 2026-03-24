import { MODELS } from "@/@types/llm";
import { generateObjectWrapper } from "@/ai-backend/llm";
import withTokenTracking, { type TokenUsage } from "@/utils/asyncHook";
import { createContextLogger } from "@/utils/logger";
import type { ModelMessage, TextPart } from "ai";
import _ from "lodash";
import pLimit from "p-limit";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";

export type ChunkPageSummary = {
  pageNumber: number;
  summary: string;
  keyPoints: string[];
  // Optional additional metadata for the page (e.g. headings, tags, etc.)
  metadata?: Record<string, unknown>;
};

export type PageText = {
  pageNumber: number;
  text: string;
};

export const DocumentMetadataSchema = z.object({
  title: z
    .string()
    .describe(
      "Short 10-20 words title for the document, must contain relevant entities name and dates",
    ),
  shortSummary: z.string(),
  summary: z
    .string()
    .describe(
      "A general summary of the document in 100-150 words, should give an overview of the document and its main points, add relevant entities name and dates etc",
    ),
  publishedDate: z.string().optional(),
  entities: z
    .object({
      persons: z.array(z.string()).optional(),
      organizations: z.array(z.string()).optional(),
      locations: z.array(z.string()).optional(),
      dates: z.array(z.string()).optional(),
    })
    .optional(),
  docType: z.string().optional(),
});

export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;
export type Toc = {
  sections: TocSection[];
};

export type TocSection = {
  title: string;
  pageStart: number;
  pageEnd: number;
  summary: string;
  subsections: TocSubsection[];
};

export type TocSubsection = {
  title: string;
  pageStart: number;
  pageEnd: number;
  summary: string;
  subsections?: TocSubsection[]; // Added recursive support just in case, or match source
};

export type ParsedDocument = {
  pages: ChunkPageSummary[];
  metadata: DocumentMetadata;
  toc: Toc;
  parsingPagesTime: number;
  parsingMetadataTime: number;
  parsingTocTime: number;
};

export const parseTocFromPageSummaries = async (pageSummaries: ChunkPageSummary[]) => {
  const agentLogger = createContextLogger({
    agent: "documentParser",
    phase: "parseTocFromPageSummaries",
  });

  agentLogger.info("📚 Starting TOC extraction", {
    totalPages: pageSummaries.length,
    batches: Math.ceil(pageSummaries.length / 50),
  });

  const toc = [] as TocSection[];
  const systemPrompt = `
You are an expert document analyst specializing in table of contents extraction. Your task is to analyze page summaries and create a comprehensive, hierarchical table of contents.

## Analysis Guidelines:

1. **Content Identification**:
   - Identify main sections (chapters, major topics, primary themes)
   - Identify subsections (subtopics, detailed discussions within main sections)
   - Look for clear section headers, titles, and topic transitions
   - Pay attention to document structure indicators (numbered sections, bullet points, etc.)

2. **Page Range Assignment**:
   - Use ONLY the page numbers provided in the summaries
   - Assign accurate page ranges for each section and subsection
   - Ensure page ranges are logical and non-overlapping
   - If a section spans multiple pages, use the full range

3. **Hierarchical Structure**:
   - Create clear main sections with descriptive titles
   - Group related content into subsections under main sections
   - Maintain logical document flow and organization
   - Ensure subsections belong to the most appropriate main section

4. **Summary Creation**:
   - Write concise but informative summaries for each section/subsection
   - Capture the main themes and key topics covered
   - Include important details that help understand the section's purpose
   - Keep summaries between 1-3 sentences

5. **Quality Standards**:
   - Use clear, professional language for titles
   - Ensure titles accurately reflect the content
   - Avoid overly generic titles like "Introduction" unless clearly appropriate
   - Make titles specific enough to be useful for navigation

## Important Notes:
- Only extract content that is clearly identifiable as a distinct section
- If content doesn't fit into a clear section structure, create appropriate groupings
- Ensure all page ranges are accurate and logical
- Focus on creating a useful navigation structure for the document
  `;

  const limit = pLimit(5); // Lowered from 25 to be safer
  const tasks = [] as Promise<void>[];
  const schema = z.object({
    sections: z.array(
      z.object({
        title: z.string(),
        pageStart: z.number(),
        pageEnd: z.number(),
        summary: z.string(),
        subsections: z.array(
          z.object({
            title: z.string(),
            pageStart: z.number(),
            pageEnd: z.number(),
            summary: z.string(),
          }),
        ),
      }),
    ),
  });
  for (let i = 0; i < pageSummaries.length; i += 50) {
    tasks.push(
      limit(async () => {
        let retryCount = 0;
        while (retryCount < 3) {
          try {
            const batch: ChunkPageSummary[] = pageSummaries.slice(i, i + 50);

            const messages: ModelMessage[] = [
              {
                role: "system",
                content: systemPrompt,
              },
              {
                role: "user",
                content: `Here are the page summaries: ${batch.map((p) => `Page ${p.pageNumber}: ${p.summary}`).join("\n")}`,
              },
            ];

            const response = await generateObjectWrapper<Toc>({
              model: MODELS.GEMINI_2_5_FLASH,
              messages,
              schema,
              reasoningLevel: "default",
            });
            if (response.isErr()) {
              agentLogger.error("❌ Failed to extract TOC for batch", {
                batchStart: i,
                batchEnd: i + 50,
                error: response.error,
              });
              throw new Error("Failed to extract toc for batch");
            }

            agentLogger.debug("✅ TOC batch extracted", {
              batchStart: i,
              batchEnd: i + 50,
              sectionsFound: response.value.sections.length,
            });

            toc.push(...response.value.sections);
            break;
          } catch (error: unknown) {
            agentLogger.warn("⚠️  TOC batch extraction retry", {
              batchStart: i,
              retryCount: retryCount + 1,
              error: error instanceof Error ? error.message : String(error),
            });
            retryCount++;
            if (retryCount === 3) {
              agentLogger.error("❌ TOC batch extraction failed after retries", {
                batchStart: i,
                maxRetries: 3,
              });
              throw error;
            }
          }
        }
      }),
    );
  }
  await Promise.all(tasks);

  const sortedToc = toc.sort((a, b) => a.pageStart - b.pageStart);

  agentLogger.info("✅ TOC extraction completed", {
    totalSections: sortedToc.length,
    totalSubsections: sortedToc.reduce((sum, s) => sum + s.subsections.length, 0),
  });

  return sortedToc;
};

export const parsePageSummaries = async (pages: PageText[], start: number, end: number) => {
  const currentPages = pages.slice(start - 1, end);
  const previousPages = [] as PageText[];
  if (start - 10 > 0) {
    const pageTexts = pages.slice(start - 10, start - 1);
    previousPages.push(...pageTexts);
  }

  const systemPrompt = `
    You are an expert at parsing the text content and summarizing information within documents.
    
    Your task is to analyze a sequence of page text and extract comprehensive summaries for each page. Follow these guidelines:
    
    ## Summary Requirements:
    1. **Comprehensive Coverage**: Extract ALL meaningful content from each page, including:
       - Headers, titles, and section headings
       - Key data points, numbers, and statistics
       - Important names, dates, and locations
       - Bullet points and lists
    
    2. **Contextual Understanding**: Use previous pages as context to:
       - Understand document structure and flow
       - Maintain consistency in terminology
       - Connect related information across pages
       - Identify recurring themes or patterns
    
    3. **Summary Quality**:
       - Write clear, concise summaries (2-4 sentences)
       - Preserve important details and specific information
       - Use professional, objective language
       - Maintain the original meaning and intent
    
    4. **Key Points Extraction**:
       - Identify 3-7 most important points per page
       - Include specific data, names, or facts when relevant
       - Prioritize actionable or significant information
       - Ensure each key point is distinct and valuable
    
    ## Important Notes:
    - Process EVERY page, even if it appears empty or contains only images
    - Use the page numbers provided in the prompt, not those visible in images
    - Do NOT extract data from previous pages - only use them for context
    - If a page is blank or contains only decorative elements, note this in the summary
    - For pages with complex layouts, ensure you capture all sections and elements
    - Maintain accuracy and completeness - it's better to include too much than miss important details

    Follow the following format for the output:
    \`\`\`json
    {
      pages: [
        {
          pageNumber: number,
          summary: string,
          keyPoints: string[],
        }
        ...
      ]
    }
    \`\`\`

    Only output the json object, no other text or comments.
      `;
  const finalMessages = [
    {
      role: "system",
      content: systemPrompt,
    },
  ] as ModelMessage[];
  finalMessages.push({
    role: "user",
    content: [
      {
        type: "text",
        text: `Here are images for pages ${start} to ${end}`,
      },
      ...(currentPages ?? []).flatMap((page: PageText, index: number) => [
        {
          type: "text",
          text: `Page number: ${start + index}`,
        } as TextPart,
        {
          type: "text",
          text: `<page num="${start + index}">${page.text}</page>`,
        } as TextPart,
      ]),
      ...(previousPages ?? []).flatMap((page: PageText, index: number) => [
        {
          type: "text",
          text: `Page number: ${start - 10 + index}`,
        } as TextPart,
        {
          type: "text",
          text: `<page num="${start - 10 + index}">${page.text}</page>`,
        } as TextPart,
      ]),
    ],
  });

  // Call the model
  const response = await generateObjectWrapper<{ pages: ChunkPageSummary[] }>({
    model: MODELS.GEMINI_2_5_FLASH,
    messages: finalMessages,
    schema: z.object({
      pages: z.array(
        z.object({
          pageNumber: z.number(),
          summary: z.string(),
          keyPoints: z.array(z.string()),
        }),
      ),
    }),
    reasoningLevel: "default",
  });

  return response;
};

const parsePDFFromText = async (pdfBuffer: Buffer) => {
  const agentLogger = createContextLogger({
    agent: "documentParser",
    phase: "parsePDFFromText",
  });

  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
  const { totalPages, text } = await extractText(pdf);

  agentLogger.info("📖 Extracted text from PDF", {
    totalPages,
  });

  const pages = text.map((t: string, pageNumber: number) => ({
    pageNumber: pageNumber + 1,
    text: t,
  }));
  // Convert to images and parse in chunks

  const extractedPages: ChunkPageSummary[] = [];

  const limit = pLimit(5); // lower concurrency to reduce peak memory
  const tasks = [] as Promise<void>[];
  const batchSize = 20; // smaller batch to limit memory
  const totalBatches = Math.ceil(totalPages / batchSize);

  agentLogger.info("📄 Starting PDF page parsing", {
    totalPages,
    batchSize,
    totalBatches,
  });

  let completedBatches = 0;
  for (let i = 0; i < totalPages; i += batchSize) {
    tasks.push(
      limit(async () => {
        // Convert pages
        const start = i + 1;
        const end = Math.min(i + batchSize, totalPages);

        const response = await parsePageSummaries(pages, start, end);

        if (response.isErr()) {
          agentLogger.error("❌ Failed to parse page summaries batch", {
            batchStart: start,
            batchEnd: end,
            error: response.error,
          });
          return;
        }
        extractedPages.push(...response.value.pages);
        completedBatches++;
        agentLogger.info("📊 Batch progress", {
          completed: completedBatches,
          total: totalBatches,
          percentage: Math.round((completedBatches / totalBatches) * 100),
        });
      }),
    );
  }

  await Promise.all(tasks);
  const missingPages = _.range(1, totalPages + 1).filter(
    (page: number) => !extractedPages.some((p) => p.pageNumber === page),
  );
  if (missingPages.length > 0) {
    agentLogger.warn("⚠️  Some pages were not parsed", {
      missingPageCount: missingPages.length,
      missingPages,
    });
  }

  agentLogger.info("✅ PDF text parsing completed", {
    totalPages,
    parsedPages: extractedPages.length,
  });

  return extractedPages.sort((a, b) => a.pageNumber - b.pageNumber);
};

export const parseMetadataFromPages = async (pages: ChunkPageSummary[]) => {
  const agentLogger = createContextLogger({
    agent: "documentParser",
    phase: "parseMetadataFromPages",
  });

  agentLogger.info("📋 Starting metadata extraction", {
    totalPages: pages.length,
    batches: Math.ceil(pages.length / 200),
  });

  const systemPrompt = `
  You are an expert at extracting metadata from pages from a pdf document.

  Your task is to analyze the pages and extract the metadata.

  Follow these guidelines:

  - Extract the title of the document, must contain relevant entities name and dates
  - Extract the author of the document
  - Extract the publisher of the document
  - Extract the published date of the document
  - Extract the language of the document
  - Extract the keywords of the document
  - Extract the categories of the document
  `;

  // Extract metadata in batches of 200 pages
  const batchSize = 200;
  const batches = _.chunk(pages, batchSize);
  const responses = await Promise.all(
    batches.map(async (batch: ChunkPageSummary[]) => {
      return await generateObjectWrapper<DocumentMetadata>({
        model: MODELS.GEMINI_2_5_FLASH,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: batch.map((p) => `Page ${p.pageNumber}: ${p.summary}`).join("\n"),
          },
        ],
        schema: DocumentMetadataSchema,
        reasoningLevel: "default",
      });
    }),
  );

  if (responses.length === 1) {
    const response = responses[0];
    if (!response) {
      throw new Error("Failed to extract metadata from pages");
    }
    if (response.isErr()) {
      throw new Error("Failed to extract metadata from pages");
    }
    // No need to combine
    return response.value;
  }

  const allResponses = responses
    .map((r) => (r.isOk() ? r.value : null))
    .filter((r): r is DocumentMetadata => r !== null);

  // Combine the responses

  const response = await generateObjectWrapper<DocumentMetadata>({
    model: MODELS.GEMINI_2_5_FLASH,
    messages: [
      {
        role: "system",
        content: `
        You are an expert at extracting metadata from pages from a pdf document.You are given metadata which is extracted 
        from multiple chunks of a large PDF document, you need to combine them appropriately into a single metadata.

        Your task is to analyze the pages and extract the metadata.

        Follow these guidelines:

        `,
      },
      {
        role: "user",
        content: allResponses.map((r) => JSON.stringify(r)).join("\n"),
      },
    ],
    schema: DocumentMetadataSchema,
    reasoningLevel: "default",
  });

  if (response.isErr()) {
    agentLogger.error("❌ Failed to combine metadata", {
      error: response.error,
    });
    throw new Error("Failed to extract metadata from pages");
  }

  agentLogger.info("✅ Metadata extraction completed", {
    title: response.value.title,
  });

  return response.value;
};

export const parseToCMeta = async (
  pdfBuffer: Buffer,
): Promise<{ result: ParsedDocument; tokenUsage: TokenUsage | null }> => {
  const agentLogger = createContextLogger({
    agent: "documentParser",
    phase: "parseToCMeta",
  });

  agentLogger.info("🚀 Starting document parsing", {
    bufferSize: pdfBuffer.length,
  });

  return await withTokenTracking("parseToCMeta", async () => {
    agentLogger.info("📄 Parsing pages from document");
    const start = performance.now();
    const pages = await parsePDFFromText(pdfBuffer);
    const end = performance.now();
    const parsingPagesTime = end - start;

    agentLogger.info("✅ Pages parsed", {
      pageCount: pages.length,
      timeMs: parsingPagesTime,
      timeSec: (parsingPagesTime / 1000).toFixed(2),
    });

    agentLogger.info("📋 Parsing metadata from pages");
    const metadata = await parseMetadataFromPages(pages);
    const end2 = performance.now();
    const parsingMetadataTime = end2 - end;

    agentLogger.info("✅ Metadata parsed", {
      title: metadata.title,
      timeMs: parsingMetadataTime,
      timeSec: (parsingMetadataTime / 1000).toFixed(2),
    });

    agentLogger.info("📚 Parsing table of contents");
    const toc = await parseTocFromPageSummaries(pages);
    const end3 = performance.now();
    const parsingTocTime = end3 - end2;

    agentLogger.info("✅ TOC parsed", {
      sectionCount: toc.length,
      timeMs: parsingTocTime,
      timeSec: (parsingTocTime / 1000).toFixed(2),
    });

    agentLogger.info("🎉 Document parsing complete", {
      totalTimeMs: end3 - start,
      totalTimeSec: ((end3 - start) / 1000).toFixed(2),
      pageCount: pages.length,
      sectionCount: toc.length,
    });

    return {
      result: {
        // Wrapped in result as per return type definition
        pages,
        metadata,
        toc: { sections: toc },
        parsingPagesTime,
        parsingMetadataTime,
        parsingTocTime,
      },
      tokenUsage: null, // Placeholder or fetch if available from tracking
    };
  });
};
