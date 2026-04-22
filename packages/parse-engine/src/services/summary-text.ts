/**
 * Text-based document summary. Produces the same DocumentSummary shape as
 * services/summary.ts (the PDF/vision version) but from text input — either
 * cluster-parsed page summaries or raw page markdown — so HTML, DOCX, XLSX,
 * and image parsers can populate `summary` without a PDF on hand.
 */

import { generateObject } from "ai";
import { z } from "zod";
import { getGatewayModel } from "../ai.js";
import { withRetry } from "../retry.js";
import type { PipelineContext } from "../context.js";
import type { ParsedPage, DocumentSummary } from "../types.js";
import type { PageSummary } from "./cluster.js";

const SUMMARY_PROMPT = `You are given the text content of a document (either per-page summaries or raw page content). Extract a structured document summary.`;

const DocumentSummarySchema = z.object({
  title: z.string().describe("Document title with year if present, e.g. 'Adobe Annual Report 2024'. Include company name when applicable."),
  shortSummary: z.string().describe("Short summary (~50-60 words) condensing the main points."),
  year: z.number().nullable().describe("Fiscal/publication year if present."),
  date: z.string().nullable().describe("Document date in 'MM/DD/YYYY' format if present."),
  companies: z.array(z.string()).describe("Company names the document is primarily about."),
  documentType: z.enum([
    "ANNUAL_REPORT", "QUARTERLY_REPORT", "SEC_FILING", "BOND_PROSPECTUS",
    "INVESTOR_PRESENTATION", "IMF_REPORT", "INTERNAL_REPORT", "AUDIT_REPORT", "OTHER",
  ]).nullable(),
  sectors: z.array(z.string()).describe("Sectors like 'Technology', 'Energy', 'Finance', etc."),
});

export interface SummaryTextOptions {
  /** Cap characters of input content sent to the LLM. */
  maxInputChars?: number;
  /** Limit number of pages to sample when falling back to raw page content. */
  maxPagesForRawFallback?: number;
  /** Document title to bias the LLM when it can't derive one from content. */
  fallbackTitle?: string;
}

const DEFAULT_MAX_INPUT_CHARS = 40_000;
const DEFAULT_MAX_RAW_PAGES = 10;

/**
 * Format `pageSummaries` (preferred) or `pages` into a compact prompt-friendly
 * string. Returns null when both are empty — callers should skip the LLM call
 * rather than submit an empty prompt.
 */
function formatInput(
  pageSummaries: PageSummary[] | undefined,
  pages: ParsedPage[] | undefined,
  maxChars: number,
  maxRawPages: number,
): string | null {
  if (pageSummaries && pageSummaries.length > 0) {
    const text = pageSummaries
      .map((p) => `Page ${p.pageNumber}: ${p.summary}`)
      .join("\n\n");
    return truncate(text, maxChars);
  }

  if (pages && pages.length > 0) {
    const text = pages
      .slice(0, maxRawPages)
      .map((p) => `Page ${p.pageNumber}:\n${p.content}`)
      .join("\n\n");
    return truncate(text, maxChars);
  }

  return null;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[... truncated ...]`;
}

/**
 * Generate a DocumentSummary from text input. Prefers cluster `pageSummaries`
 * when available (much cheaper), falls back to a sample of raw `pages`.
 * Uses the LITE tier to match the PDF vision-based summary's cost profile.
 */
export async function getBasicSummaryFromText(
  input: { pageSummaries?: PageSummary[]; pages?: ParsedPage[] },
  ctx: PipelineContext,
  options: SummaryTextOptions = {},
): Promise<DocumentSummary | undefined> {
  const maxChars = options.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
  const maxRawPages = options.maxPagesForRawFallback ?? DEFAULT_MAX_RAW_PAGES;

  const contentText = formatInput(input.pageSummaries, input.pages, maxChars, maxRawPages);
  if (!contentText) return undefined;

  const cacheKey = ctx.key("summary_text");

  return ctx.cached(cacheKey, async () => {
    const userMessage = options.fallbackTitle
      ? `Document title hint: ${options.fallbackTitle}\n\n${contentText}`
      : contentText;

    const result = await withRetry(
      async (model) => {
        const llm = getGatewayModel(model);
        const res = await generateObject({
          model: llm,
          schema: DocumentSummarySchema,
          messages: [
            { role: "system", content: SUMMARY_PROMPT },
            { role: "user", content: userMessage },
          ],
        });
        ctx.trackUsage("summary_text", model, res);
        return res;
      },
      ctx.models.lite,
      { models: ctx.models, label: "Summary (text)" },
    );

    return {
      title: result.object.title,
      shortSummary: result.object.shortSummary,
      year: result.object.year ?? undefined,
      date: result.object.date ?? undefined,
      companies: result.object.companies,
      documentType: result.object.documentType ?? undefined,
      sectors: result.object.sectors,
    };
  }, "Summary (text)");
}
