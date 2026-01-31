import { z } from "zod";
import { PDFDocument } from "pdf-lib";
import {
  generateObject,
  generateText,
  type FilePart,
  type ImagePart,
  type ModelMessage,
  type TextPart,
} from "ai";
import { getLLM } from "@/ai-backend/llm";
import { MODELS } from "@/@types/llm";
import fs from "node:fs";
import plimit from "p-limit";

interface SplitPDFOptions {
  pagesPerSplit?: number;
  maxSplits?: number;
}

interface SplitResult {
  subPDFs: Buffer[];
  totalPages: number;
  splitCount: number;
}

/**
 * Splits a PDF into multiple smaller sub-PDFs
 * @param doc - The PDF document as a Buffer
 * @param options - Configuration options for splitting
 * @returns Promise containing the split PDFs and metadata
 */
export const splitPDF = async (
  doc: Buffer,
  options: SplitPDFOptions = {}
): Promise<SplitResult> => {
  const { pagesPerSplit = 10 } = options;

  try {
    // Load the source PDF
    const sourcePDF = await PDFDocument.load(doc);
    const totalPages = sourcePDF.getPageCount();

    // Calculate number of splits needed
    const splitCount = Math.ceil(totalPages / pagesPerSplit);

    const subPDFs: Buffer[] = [];

    // Split the PDF
    for (let i = 0; i < splitCount; i++) {
      const startPage = i * pagesPerSplit;
      const endPage = Math.min(startPage + pagesPerSplit, totalPages);

      // Create a new PDF document for this split
      const newPDF = await PDFDocument.create();

      // Copy pages from source to new PDF
      const pages = await newPDF.copyPages(
        sourcePDF,
        Array.from({ length: endPage - startPage }, (_, idx) => startPage + idx)
      );

      pages.forEach((page) => newPDF.addPage(page));

      // Save the new PDF as Buffer
      const pdfBytes = await newPDF.save();
      subPDFs.push(Buffer.from(pdfBytes));
    }

    return {
      subPDFs,
      totalPages,
      splitCount,
    };
  } catch (error) {
    throw new Error(
      `Failed to split PDF: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
};

const systemPrompt = `
You are an expert document analyst specializing in creating comprehensive table of contents from document sections.

Your task is to analyze the provided document segment and extract a structured table of contents with the following requirements:

1. **Section Identification**: Identify major sections based on:
   - Clear headings, titles, or chapter markers
   - Topic shifts and thematic breaks
   - Document structure indicators (numbered sections, etc.)

2. **Subsection Extraction**: For each section, identify relevant subsections that:
   - Represent distinct topics or concepts within the section
   - Have clear boundaries and scope
   - Are logically organized and hierarchical

3. **Page Range Accuracy**:
   - Provide precise start and end page numbers for each section/subsection
   - Ensure complete coverage of all pages in the document segment
   - Account for page numbering continuity

4. **Summary Quality**: For each subsection, provide a concise summary that:
   - Captures the main concepts and key points
   - Highlights important details, findings, or conclusions
   - Uses clear, professional language
   - Is 2-4 sentences in length

5. **Output Structure**: Return a well-organized JSON structure with:
   - Clear section titles that reflect the actual content
   - Logical subsection hierarchy
   - Accurate page ranges
   - Meaningful summaries

VERY IMPORTANT: DO NOT CREATE SUBSECTIONS WHICH ARE NOT NEEDED OR RELEVANT, THE GOAL iS TO KEEP IT CONCISE AND TO THE POINT.
DO NOT INCLUDE PAGES FROM PREVIOUS CONTEXT PROVIDED THAT IS ONLY FOR ADDITIONAL CONTEXT, THE TABLE OF CONTENTS SHOULD BE FOR THE CURRENT FILE ONLY.
Focus on accuracy, completeness, and clarity in your analysis. Ensure that every page of the document segment is accounted for in your table of contents structure.
`;

const combineTOCPrompt = `
You are an expert document analyst. You are given multiple table of content created from different chunks of a document,
you job is to combine them appropriately into a single Table of content, also making
sure to combine relevant sections and sections wherever seems appropriate.
`;

const schema = z.object({
  sections: z.array(
    z.object({
      title: z.string(),
      startPage: z.number(),
      endPage: z.number(),
      subsections: z.array(
        z.object({
          title: z.string(),
          summary: z.string(),
          startPage: z.number(),
          endPage: z.number(),
        })
      ),
    })
  ),
});

export const parseTOC = async (doc: Buffer) => {
  const start = performance.now();
  const { subPDFs, totalPages, splitCount } = await splitPDF(doc);

  const allSections: z.infer<typeof schema>["sections"] = [];

  const limit = plimit(10);
  const allTasks = [];

  for (let i = 0; i < subPDFs.length; i++) {
    const subPDF = subPDFs[i];
    const prevSubPDF = subPDFs[i - 1];
    // Save the subPDF to a file
    fs.writeFileSync(`subPDF-${i}.pdf`, subPDF!);

    const userContent: (TextPart | ImagePart | FilePart)[] = [
      {
        type: "text",
        text: `Page range: ${i * 10 + 1} - ${Math.min(
          (i + 1) * 10,
          totalPages
        )}. Extract the table of contents from this file:`,
      },
      {
        type: "file",
        data: subPDF!,
        mediaType: "application/pdf",
      },
      {
        type: "text",
        text: "Here are previous 10 pages of the document for additional context",
      },
    ] as (TextPart | ImagePart | FilePart)[];

    if (prevSubPDF) {
      userContent.push({
        type: "file",
        data: prevSubPDF,
        mediaType: "application/pdf",
      } as FilePart);
    }

    const messages: ModelMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ];
    const task = limit(async () => {
      const response = await generateObject({
        model: getLLM(MODELS.GEMINI_2_0_FLASH),
        schema: schema,
        messages: messages,
      });

      allSections.push(...response.object.sections);
    });
    allTasks.push(task);
  }

  await Promise.all(allTasks);

  const sortedSections = allSections.sort((a, b) => a.startPage - b.startPage);

  const combinedTOC = await generateObject({
    model: getLLM(MODELS.GEMINI_2_5_FLASH_LITE),
    schema: schema,
    messages: [
      { role: "system", content: combineTOCPrompt },
      {
        role: "user",
        content: `Sections: ${JSON.stringify(sortedSections, null, 2)}`,
      },
    ] as ModelMessage[],
  });

  const end = performance.now();


  // Save combinedTOC to a file
  fs.writeFileSync(
    "combinedTOC.json",
    JSON.stringify(combinedTOC.object, null, 2)
  );
  return { toc: { sections: combinedTOC.object.sections } };
};

const systemPromptForResponse = `
You are a strict, document-grounded QA assistant.

Rules:
- Only use information found in the attached PDF. Do not use outside knowledge or assumptions.
- If the document does not clearly support an answer, reply exactly: "I couldn't find this in the document."
- When answering, include page references like [p. X] and, when helpful, quote the most relevant short snippet.
- Be concise: 1–3 sentences unless the question asks for more. Use bullet points for lists.
- Preserve numbers, units, and terminology exactly as written in the PDF.
- If multiple plausible answers exist, state the possibilities with their page references.
`;

export const responseFromPDF = async (doc: Buffer, question: string) => {
  const response = await generateText({
    model: getLLM(MODELS.GEMINI_2_5_FLASH),
    messages: [
      { role: "system", content: systemPromptForResponse },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: ` Question: ${question}`,
          },
          {
            type: "file",
            data: doc,
            mediaType: "application/pdf",
          },
        ],
      },
    ],
  });
  return response.text;
};
