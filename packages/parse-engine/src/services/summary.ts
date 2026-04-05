/**
 * Basic document summary extraction.
 * Sends first N pages as images to vision LLM and extracts structured summary.
 */
import { generateObject } from "ai";
import { z } from "zod";
import { getGatewayModel } from "../ai.js";
import { withRetry } from "../retry.js";
import type { PipelineContext } from "../context.js";
import type { PdfDocument } from "../pdf.js";
import type { DocumentSummary } from "../types.js";

const SUMMARY_PROMPT = `Based on the following pages from document, extract the data in a structured format as mentioned.`;

const DocumentSummarySchema = z.object({
  title: z.string().describe("Document title with year, e.g. 'Adobe Annual Report 2024'. Include company name if applicable."),
  shortSummary: z.string().describe("A short summary of the document (~50-60 words) condensing the main points."),
  year: z.number().nullable().describe("The fiscal year of the document if present."),
  date: z.string().nullable().describe("The date of the document in 'MM/DD/YYYY' format if present."),
  companies: z.array(z.string()).describe("Company names the document is about."),
  documentType: z.enum([
    "ANNUAL_REPORT", "QUARTERLY_REPORT", "SEC_FILING", "BOND_PROSPECTUS",
    "INVESTOR_PRESENTATION", "IMF_REPORT", "INTERNAL_REPORT", "AUDIT_REPORT", "OTHER"
  ]).nullable().describe("The type of document."),
  sectors: z.array(z.string()).describe("Sectors like 'Energy', 'Technology', 'Healthcare', 'Finance', etc."),
});

export async function getBasicSummary(
  pdf: PdfDocument,
  ctx: PipelineContext,
  maxPages = 10
): Promise<DocumentSummary> {
  const cacheKey = ctx.key("summary");

  return ctx.cached(cacheKey, async () => {
    const pageImages: Buffer[] = [];
    for (let i = 0; i < Math.min(maxPages, pdf.pageCount); i++) {
      try { pageImages.push(pdf.renderPage(i, 1)); } catch { break; }
    }

    const result = await withRetry(
      async (model) => {
        const llm = getGatewayModel(model);
        const res = await generateObject({
          model: llm,
          schema: DocumentSummarySchema,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: SUMMARY_PROMPT },
              ...pageImages.map((img) => ({
                type: "image" as const,
                image: img,
                mediaType: "image/png" as const,
              })),
            ],
          }],
        });
        ctx.trackUsage("summary", model, res);
        return res;
      },
      ctx.models.lite,
      { models: ctx.models, label: "Summary" }
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
  }, "Summary");
}
