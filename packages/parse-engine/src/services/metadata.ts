/**
 * Document metadata extraction.
 * Uses page summaries from cluster parsing for efficiency.
 * Two-stage: base category detection → subcategory-specific metadata.
 */
import { generateObject } from "ai";
import { z } from "zod";
import { getGatewayModel } from "../ai.js";
import { withRetry } from "../retry.js";
import type { PipelineContext } from "../context.js";
import type { DocumentMetadata } from "../types.js";
import type { PageSummary } from "./cluster.js";

const BASE_PROMPT = `You are an expert document analyst. You are given page summaries from a document.
Your job is to accurately extract the document metadata.

Document categories:
- financial-investment-docs: Financial statements, reports, earnings calls, annual reports
- macroeconomic-industry-reports: Market analysis, credit ratings, M&A, equity research, investment presentations
- legal-corporate-regulatory: Corporate governance, shareholder agreements, legal structure
- other: Documents that don't fit the above categories`;

const CATEGORY_PROMPT = `You are an expert document analyst. You are given page summaries from a document.
Your job is to accurately extract category-specific metadata.`;

const BaseMetadataSchema = z.object({
  title: z.string(),
  publication_date: z.string().nullable().describe("Publication date in YYYY-MM-DD format"),
  year: z.string().nullable(),
  summary: z.string().nullable().describe("Multi-paragraph summary of the document"),
  category: z.enum(["financial-investment-docs", "macroeconomic-industry-reports", "legal-corporate-regulatory", "other"]),
  subcategory: z.enum(["financial-statements-reports", "market-investment-analysis", "capital-markets-debt", "country-economic-research", "corporate-governance-legal-structure", "other"]),
});

const CategoryMetadataSchema = z.object({
  document_type: z.string(),
  company: z.string().nullable().optional(),
  companies_mentioned: z.array(z.string()).optional(),
  country: z.string().nullable().optional(),
  industry: z.enum(["technology", "finance", "energy", "healthcare", "consumer_goods", "manufacturing", "automotive", "real_estate", "consumer_services", "materials", "retail", "other"]).nullable().optional(),
  publisher: z.string().nullable().optional(),
  reference_period: z.string().nullable().optional(),
  sentiment: z.enum(["positive", "neutral", "negative"]).nullable().optional(),
});

/**
 * Extract metadata from page summaries (first 20 pages).
 */
export async function extractDocumentMetadata(
  pageSummaries: PageSummary[],
  ctx: PipelineContext,
  maxPages = 20
): Promise<DocumentMetadata> {
  const cacheKey = ctx.key("metadata");

  return ctx.cached(cacheKey, async () => {
    const pagesText = pageSummaries.slice(0, maxPages)
      .map((p) => `Page ${p.pageNumber}: ${p.summary}`)
      .join("\n\n");

    // Stage 1: Base metadata
    const baseResult = await withRetry(
      async (model) => {
        const llm = getGatewayModel(model);
        const res = await generateObject({
          model: llm,
          schema: BaseMetadataSchema,
          messages: [
            { role: "system", content: BASE_PROMPT },
            { role: "user", content: `Here are page summaries:\n\n${pagesText}` },
          ],
        });
        ctx.trackUsage("metadata_base", model, res);
        return res;
      },
      ctx.models.medium,
      { models: ctx.models, label: "Base metadata" }
    );
    const base = baseResult.object;

    // Stage 2: Category-specific metadata
    let categoryMeta: z.infer<typeof CategoryMetadataSchema> | null = null;
    try {
      const catResult = await withRetry(
        async (model) => {
          const llm = getGatewayModel(model);
          const res = await generateObject({
            model: llm,
            schema: CategoryMetadataSchema,
            messages: [
              { role: "system", content: `${CATEGORY_PROMPT}\nClassified as: ${base.category} / ${base.subcategory}. Extract specific metadata.` },
              { role: "user", content: `Here are page summaries:\n\n${pagesText}` },
            ],
          });
          ctx.trackUsage("metadata_category", model, res);
          return res;
        },
        ctx.models.medium,
        { models: ctx.models, label: "Category metadata" }
      );
      categoryMeta = catResult.object;
    } catch (err) {
      console.warn("  Category metadata failed, using base only:", (err as Error).message);
    }

    return {
      title: base.title,
      publicationDate: base.publication_date ?? undefined,
      year: base.year ?? undefined,
      summary: base.summary ?? undefined,
      category: base.category,
      subcategory: base.subcategory,
      industry: categoryMeta?.industry ?? undefined,
      companies: categoryMeta?.companies_mentioned ?? (categoryMeta?.company ? [categoryMeta.company] : undefined),
      country: categoryMeta?.country ?? undefined,
      publisher: categoryMeta?.publisher ?? undefined,
      documentSubtype: categoryMeta?.document_type ?? undefined,
      categoryMetadata: categoryMeta ? { ...categoryMeta } : undefined,
    };
  }, "Metadata");
}
