/**
 * Cluster parsing — compresses full page text into short summaries.
 * Uses LITE model for cost efficiency.
 *
 * Page numbering: 0-indexed internally (matching Python), output as 0-indexed.
 */
import { z } from "zod";
import pLimit from "p-limit";
import { withRetry } from "../retry.js";
import { generateObject } from "ai";
import { getGatewayModel } from "../ai.js";
import type { PipelineContext } from "../context.js";
import type { ParsedPage } from "../types.js";

const PAGE_SUMMARY_PROMPT = `You are given text content from pages of a PDF document. For each page, provide a concise summary (50-100 words) covering:
- Main topics and themes
- Key data points, figures, metrics
- Important entities (companies, people, locations)
- Whether page continues previous section or starts new one
- MUST INCLUDE EVERY PAGE even if blank — just note "Blank page"

Use the EXACT page numbers provided in the input. Do not skip any pages.`;

const PageSummarySchema = z.object({
  page_number: z.number(),
  summary: z.string(),
});

const ClusterOutputSchema = z.object({
  pages: z.array(PageSummarySchema),
});

export interface PageSummary {
  pageNumber: number;
  summary: string;
}

export interface ClusterResult {
  pageSummaries: PageSummary[];
  totalPages: number;
}

/**
 * Summarize a batch of pages. Re-indexes output to ensure sequential coverage
 * (matching Python's check_if_all_pages_covered behavior).
 */
async function summarizeBatch(
  pages: ParsedPage[],
  startPage: number,
  endPage: number,
  model: string,
  ctx: PipelineContext
): Promise<PageSummary[]> {
  const cacheKey = ctx.key("cluster", startPage, endPage);

  return ctx.cached(cacheKey, async () => {
    // Format pages with 0-indexed page numbers (matching Python: `Page {page}:`)
    const pagesText = pages.map((p) => {
      const text = p.content.trim().slice(0, 1500);
      return `Page ${p.pageNumber}:\n${text}`;
    }).join("\n\n");

    const result = await withRetry(
      async (m) => {
        const llm = getGatewayModel(m);
        const res = await generateObject({
          model: llm,
          schema: ClusterOutputSchema,
          messages: [
            { role: "system", content: PAGE_SUMMARY_PROMPT },
            { role: "user", content: pagesText },
          ],
        });
        ctx.trackUsage("cluster_parsing", m, res);
        return res;
      },
      model,
      { models: ctx.models, label: `Cluster ${startPage}-${endPage}` }
    );

    // Re-index pages sequentially from startPage (matching Python behavior)
    const summaries: PageSummary[] = result.object.pages.map((p, idx) => ({
      pageNumber: idx + startPage,
      summary: p.summary,
    }));

    // Fill any gaps
    const expectedCount = endPage - startPage;
    if (summaries.length < expectedCount) {
      const covered = new Set(summaries.map((s) => s.pageNumber));
      for (let p = startPage; p < endPage; p++) {
        if (!covered.has(p)) {
          summaries.push({ pageNumber: p, summary: "[Summary not extracted]" });
        }
      }
    }

    // Trim to exactly the expected range (no extras)
    const filtered = summaries
      .filter((s) => s.pageNumber >= startPage && s.pageNumber < endPage)
      .sort((a, b) => a.pageNumber - b.pageNumber);

    return filtered;
  }, `Cluster ${startPage}-${endPage}`);
}

/**
 * Generate page summaries from merged page content.
 * Batches of 20 pages, concurrency 10, LITE model.
 */
export async function generatePageSummaries(
  pages: ParsedPage[],
  ctx: PipelineContext,
  batchSize = 20,
  concurrency = 10
): Promise<ClusterResult> {
  const limit = pLimit(concurrency);
  const tasks: Promise<PageSummary[]>[] = [];
  const totalPages = pages.length;

  for (let start = 0; start < totalPages; start += batchSize) {
    const end = Math.min(start + batchSize, totalPages);
    const batch = pages.slice(start, end);

    tasks.push(
      limit(async () => {
        console.log(`  Cluster: pages ${start + 1}-${end}...`);
        return summarizeBatch(batch, start, end, ctx.models.lite, ctx);
      })
    );
  }

  const batchResults = await Promise.all(tasks);
  const pageSummaries = batchResults.flat();
  pageSummaries.sort((a, b) => a.pageNumber - b.pageNumber);

  // Verify exact count
  if (pageSummaries.length !== totalPages) {
    console.warn(`  Warning: Expected ${totalPages} summaries, got ${pageSummaries.length}`);
  }

  return { pageSummaries, totalPages };
}
