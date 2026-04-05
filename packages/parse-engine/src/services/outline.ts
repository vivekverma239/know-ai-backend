/**
 * Outline / TOC / Chapters generation.
 *
 * Accepts page summaries (from cluster parsing) for efficiency.
 * Cluster summaries are short text (~100 words/page) so LLM calls are fast and cheap.
 *
 * Optional: liteparse enrichment adds font size metadata for better chapter detection.
 */
import { generateText, generateObject } from "ai";
import { z } from "zod";
import pLimit from "p-limit";
import { withRetry } from "../retry.js";
import { getGatewayModel } from "../ai.js";
import type { PipelineContext } from "../context.js";
import type { Section } from "../types.js";
import { parsePdfStructure, formatPagesForLLM } from "./liteparse.js";
import type { PageSummary } from "./cluster.js";

// =============================================
// Chapter Detection (from page summaries + optional liteparse)
// =============================================

const PDF_SPLIT_PROMPT = `You are an expert document analyzer. You are given summaries of pages from a PDF document.
Your job is to identify ONLY truly distinct, separate documents bundled within this PDF.

## WHAT COUNTS AS A SEPARATE DOCUMENT
- A completely different report/filing (e.g., an Annual Report followed by a Bond Prospectus)
- A formal appendix, exhibit, or attachment that is a self-contained document with its own title page
- A letter of intent or memorandum that is a standalone submission

## WHAT DOES NOT COUNT — DO NOT SPLIT THESE
- Different sections, chapters, or parts of the SAME document
- Tables, figures, boxes, or annexes within a report
- Changes in topic within the same report (e.g., from fiscal policy to monetary policy)
- Table of contents, signature pages, or continuation pages
- Numbered tables (Table 1, Table 2, etc.) — these are part of the same document
- Supplementary information sections within the same filing

## CRITICAL RULES
1. Most PDFs contain only 1-5 distinct documents. If you find more than 10, you are likely over-splitting.
2. A 100-page report should typically be 1 document, not 100 documents.
3. Only split when there is an unmistakable boundary: different authorship, different document type, formal separation.
4. Sections like "Part I", "Part II", "Annex I" within the SAME document should NOT be separate chapters.
5. Every page must belong to exactly one subdocument — no gaps or overlaps.
6. Titles should include relevant context (organization, year, document type).`;

const ChapterListSchema = z.object({
  sub_documents: z.array(z.object({
    title: z.string(),
    start_page: z.number(),
    end_page: z.number(),
  })),
});

export interface Chapter {
  title: string;
  startPage: number;
  endPage: number;
}

export async function detectChapters(
  pageSummaries: PageSummary[],
  ctx: PipelineContext,
  opts: {
    pdfPath?: string;
    batchSize?: number;
  } = {}
): Promise<Chapter[]> {
  const { batchSize = 100 } = opts;
  const cacheKey = ctx.key("chapters");

  return ctx.cached(cacheKey, async () => {
    // Optional: enrich with liteparse font metadata
    let liteParseData: Map<number, string> | undefined;
    if (opts.pdfPath) {
      try {
        console.log("  Enriching with liteparse font metadata...");
        const structure = await parsePdfStructure(opts.pdfPath);
        liteParseData = new Map();
        for (const lp of structure.pages) {
          liteParseData.set(lp.page, `[${lp.numItems} items, maxFont=${lp.maxFontSize}pt]`);
        }
      } catch (err) {
        console.warn("  LiteParse failed, continuing without:", (err as Error).message);
      }
    }

    const limit = pLimit(10);
    const tasks: Promise<string>[] = [];

    for (let start = 0; start < pageSummaries.length; start += batchSize) {
      const end = Math.min(start + batchSize, pageSummaries.length);
      const batch = pageSummaries.slice(start, end);

      tasks.push(
        limit(() => withRetry(
          async (model) => {
            const llm = getGatewayModel(model);
            const pagesText = batch.map((p) => {
              const lpMeta = liteParseData?.get(p.pageNumber) ?? "";
              return `Page ${p.pageNumber} ${lpMeta}: ${p.summary}`;
            }).join("\n\n");

            const result = await generateText({
              model: llm,
              messages: [
                { role: "system", content: PDF_SPLIT_PROMPT },
                { role: "user", content: `Pages ${batch[0].pageNumber} to ${batch[batch.length - 1].pageNumber}:\n\n${pagesText}` },
              ],
            });
            ctx.trackUsage("chapter_detect", model, result);
            return result.text;
          },
          ctx.models.lite,
          { models: ctx.models, label: `Chapter detect ${start + 1}-${end}` }
        ))
      );
    }

    const batchResults = await Promise.all(tasks);

    const combined = await withRetry(
      async (model) => {
        const llm = getGatewayModel(model);
        const res = await generateObject({
          model: llm,
          schema: ChapterListSchema,
          messages: [
            { role: "system", content: `Combine these subdocument detection outputs into a unified list. Resolve overlaps, ensure pages 1-${pageSummaries.length} covered with no gaps.` },
            { role: "user", content: batchResults.join("\n\n") },
          ],
        });
        ctx.trackUsage("chapter_combine", model, res);
        return res;
      },
      ctx.models.medium,
      { models: ctx.models, label: "Chapter combine" }
    );

    return combined.object.sub_documents.map((ch) => ({
      title: ch.title,
      startPage: ch.start_page,
      endPage: ch.end_page,
    }));
  }, "Chapters");
}

// =============================================
// Section/Subsection Outline (from page summaries)
// =============================================

const OUTLINE_PROMPT = `You are given summaries of pages from a PDF document. Output a list of sections and subsections.

Sections should be based on content, creating a meaningful table of contents.
All titles should contain relevant entity names, data, dates, numbers.

For each subsection return:
- start_page, end_page, title, id ({section_id}-{subsection_id} format), subsection_summary

Context from previous sections is provided — only output added/updated sections.
- If there is no subsection, create one with name "DEFAULT"
- Make sure to not miss any pages
- Only add page numbers mentioned in the input

Steps:
1. Understand all page summaries
2. Check previous sections for continuity
3. Identify major sections, then subsections
4. Include ALL pages even if blank
5. DO NOT RETURN EMPTY SECTIONS
6. DO NOT IGNORE ANY SECTIONS`;

const OutlineSchema = z.object({
  explanation: z.string(),
  sections: z.array(z.object({
    id: z.string(),
    title: z.string(),
    start_page: z.number(),
    end_page: z.number(),
    subsections: z.array(z.object({
      id: z.string(),
      title: z.string(),
      start_page: z.number(),
      end_page: z.number(),
      subsection_summary: z.string(),
    })),
    section_summary: z.string(),
  })),
});

async function extractOutline(
  pageSummaries: PageSummary[],
  previousSections: Section[],
  ctx: PipelineContext
): Promise<Section[]> {
  const pagesText = pageSummaries.map((p) =>
    `Page ${p.pageNumber}: ${p.summary}`
  ).join("\n\n");

  let contextText = OUTLINE_PROMPT;
  if (previousSections.length > 0) {
    contextText += `\n\nPrevious sections for context:\n${JSON.stringify(previousSections.slice(-2), null, 2)}`;
  }

  const result = await withRetry(
    async (model) => {
      const llm = getGatewayModel(model);
      const res = await generateObject({
        model: llm,
        schema: OutlineSchema,
        messages: [
          { role: "system", content: contextText },
          { role: "user", content: pagesText + "\n\nYOU MUST COVER ALL PAGE NUMBERS mentioned above." },
        ],
      });
      ctx.trackUsage("outline", model, res);
      return res;
    },
    ctx.models.medium,
    { models: ctx.models, label: "Outline" }
  );

  return result.object.sections.map((s) => ({
    id: s.id,
    title: s.title,
    startPage: s.start_page,
    endPage: s.end_page,
    summary: s.section_summary,
    subsections: s.subsections.map((sub) => ({
      id: sub.id,
      title: sub.title,
      startPage: sub.start_page,
      endPage: sub.end_page,
      summary: sub.subsection_summary,
    })),
  }));
}

export async function generateOutline(
  pageSummaries: PageSummary[],
  ctx: PipelineContext,
  batchSize = 50,
  startPage?: number,
  endPage?: number
): Promise<Section[]> {
  let filtered = pageSummaries;
  if (startPage != null || endPage != null) {
    filtered = pageSummaries.filter(
      (p) => (startPage == null || p.pageNumber >= startPage) &&
             (endPage == null || p.pageNumber <= endPage)
    );
  }

  const allSections: Section[] = [];

  for (let i = 0; i < filtered.length; i += batchSize) {
    const batch = filtered.slice(i, i + batchSize);
    console.log(`  Outline: pages ${batch[0].pageNumber}-${batch[batch.length - 1].pageNumber}...`);

    try {
      const batchSections = await extractOutline(batch, allSections, ctx);

      for (const section of batchSections) {
        const existing = allSections.find((s) => s.id === section.id);
        if (existing) {
          existing.endPage = Math.max(existing.endPage, section.endPage);
          for (const sub of section.subsections) {
            const existingSub = existing.subsections.find((s) => s.id === sub.id);
            if (existingSub) {
              existingSub.endPage = sub.endPage;
              existingSub.summary = sub.summary;
            } else {
              existing.subsections.push(sub);
            }
          }
          existing.summary = section.summary || existing.summary;
        } else {
          allSections.push(section);
        }
      }
    } catch (err) {
      console.error(`  Outline batch failed:`, (err as Error).message);
    }
  }

  allSections.sort((a, b) => a.startPage - b.startPage);
  return allSections;
}

// =============================================
// Full: Chapters + Outline
// =============================================

export interface ChapterWithSections {
  title: string;
  summary: string;
  startPage: number;
  endPage: number;
  sections: Section[];
}

export interface ChapterParsingResult {
  chapters: ChapterWithSections[];
  title: string;
  summary: string;
}

export async function generateOutlineWithChapters(
  pageSummaries: PageSummary[],
  docTitle: string,
  docSummary: string,
  ctx: PipelineContext,
  opts: { pdfPath?: string } = {}
): Promise<ChapterParsingResult> {
  const cacheKey = ctx.key("outline_with_chapters");

  return ctx.cached(cacheKey, async () => {
    console.log("  Detecting chapters...");
    const chapters = await detectChapters(pageSummaries, ctx, { pdfPath: opts.pdfPath });
    console.log(`  Found ${chapters.length} chapter(s)`);

    const limit = pLimit(10);
    const tasks = chapters.map((chapter) =>
      limit(async (): Promise<ChapterWithSections> => {
        console.log(`  Chapter: "${chapter.title.slice(0, 80)}" (pp. ${chapter.startPage}-${chapter.endPage})`);
        const sections = await generateOutline(
          pageSummaries, ctx, 50,
          chapter.startPage, chapter.endPage
        );
        return {
          title: chapter.title,
          summary: "",
          startPage: chapter.startPage,
          endPage: chapter.endPage,
          sections,
        };
      })
    );

    const chaptersWithSections = await Promise.all(tasks);
    chaptersWithSections.sort((a, b) => a.startPage - b.startPage);

    return { chapters: chaptersWithSections, title: docTitle, summary: docSummary };
  }, "Outline with chapters");
}
