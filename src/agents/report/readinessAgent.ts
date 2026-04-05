import { MODELS } from "@/@types/llm";
import { getLLM } from "@/ai-backend/llm";
import type { PreflightResult } from "@/db/schema";
import { similaritySearchDocuments } from "@/service/simSearch";
import { env } from "@/utils/env";
import { createContextLogger } from "@/utils/logger";
import { Output, generateText, stepCountIs, tool } from "ai";
import Exa from "exa-js";
import { z } from "zod";

const logger = createContextLogger({ agent: "readinessAgent" });

const preflightResultSchema = z.object({
  score: z.number().min(0).max(100),
  sufficient: z.boolean(),
  existingDocuments: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      relevanceScore: z.number(),
      coversTopic: z.string(),
    }),
  ),
  gaps: z.array(
    z.object({
      topic: z.string(),
      description: z.string(),
    }),
  ),
  recommendations: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      type: z.enum(["pdf", "web_article"]),
      fillsGap: z.string(),
    }),
  ),
});

export const assessReportReadiness = async ({
  topic,
  referencePeriod,
  taskDescription,
  initialResearchPrompt,
  userId,
  orgId,
}: {
  topic: string;
  referencePeriod: string;
  taskDescription: string;
  initialResearchPrompt: string;
  userId: string;
  orgId: string;
}): Promise<PreflightResult> => {
  logger.info("Starting readiness assessment", { topic, userId });

  const seenUrls = new Set<string>();

  const documentSearchTool = tool({
    description:
      "Search the user's uploaded documents by topic. Returns documents with titles, IDs, and summaries. Use this to check what documents are available for the report.",
    inputSchema: z.object({
      query: z.string().describe("Search query to find relevant documents"),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Max number of results"),
    }),
    execute: async ({ query, limit }: { query: string; limit: number }) => {
      const docs = await similaritySearchDocuments({
        query,
        limit,
        userId,
        orgId,
      });
      return docs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        summary: doc.summary ?? "No summary available",
      }));
    },
  });

  const webSearchTool = tool({
    description:
      "Search the web for documents (PDFs, articles, reports) that could fill data gaps. Use this after identifying what's missing from the user's documents. Returns titles and URLs of relevant sources.",
    inputSchema: z.object({
      query: z.string().describe("Search query for finding relevant sources"),
      category: z
        .enum(["pdf", "general"])
        .optional()
        .default("general")
        .describe("Search for PDFs specifically or general web results"),
    }),
    execute: async ({ query, category }: { query: string; category: string }) => {
      try {
        const exa = new Exa(env.get("EXA_API_KEY"));
        const results = await exa.search(query, {
          type: "neural",
          category: category === "pdf" ? "pdf" : undefined,
          numResults: 5,
        });
        return results.results
          .filter((r) => {
            if (seenUrls.has(r.url)) return false;
            seenUrls.add(r.url);
            return true;
          })
          .map((result) => ({
            title: result.title?.trim() || "",
            url: result.url,
            type: (category === "pdf" ? "pdf" : "web_article") as
              | "pdf"
              | "web_article",
          }));
      } catch (error) {
        logger.warn("Web search failed", {
          query,
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    },
  });

  const { experimental_output: assessment } = await generateText({
    model: getLLM(MODELS.GEMINI_3_FLASH),
    tools: { documentSearch: documentSearchTool, webSearch: webSearchTool },
    stopWhen: stepCountIs(10),
    prompt: `You are a report readiness analyst. Your job is to assess whether the user has sufficient documents to generate a high-quality report, and if not, find relevant sources on the web.

## Report Details
- **Topic:** ${topic}
- **Reference Period:** ${referencePeriod || "Not specified"}
- **Task Description:** ${taskDescription}
- **Report Instructions:** ${initialResearchPrompt}

## Your Process

Follow these steps carefully:

### Step 1: Search for existing documents
Use the documentSearch tool with multiple queries related to the topic to thoroughly check what the user already has. Try different search terms (company name, financial terms, report types, etc.).

### Step 2: Assess coverage
Based on the documents found, identify what coverage areas are satisfied and what's genuinely missing. Be thorough — a single annual report or 10-K likely covers financial statements, segment breakdowns, KPIs, and geographic data.

### Step 3: Search the web comprehensively
Use the webSearch tool extensively to find PDFs and articles that would strengthen the report. Be generous — the user can choose which ones to index, so recommend broadly. Search for:
- Annual reports, 10-K/10-Q filings
- Earnings presentations and press releases
- Industry reports and market analyses
- Relevant news articles and research papers
Search with both category "pdf" and "general". Use multiple specific queries.

### Step 4: Return your assessment
After using the tools, return your final structured assessment:
- **existingDocuments**: Documents from the user's collection that are relevant (with relevance scores and what they cover)
- **gaps**: Only topics where the user truly has NO documents AND no web sources were found
- **recommendations**: ALL web sources you found that would strengthen the report. Be comprehensive — include every useful source. The user will select which ones to index. Each recommendation needs a title, url, type, and a SHORT fillsGap label (max 5 words, e.g. "Q4 Earnings", "Revenue Segments", "Industry Analysis")
- **score**: 0-100 readiness score (percentage of coverage areas satisfied by existing docs)
- **sufficient**: true if score >= 60 and at least 2 relevant documents exist

IMPORTANT filtering rules for recommendations:
- Do NOT include empty-titled recommendations. Every recommendation must have a meaningful title.
- Keep fillsGap labels SHORT (max 5 words).
- Do NOT recommend generic hub/index pages (e.g. "Annual Reports Hub", "SEC EDGAR search page", "Investor Relations page"). Only recommend URLs that link DIRECTLY to a specific document or article.
- Each URL must point to an actual document (PDF, earnings release, specific article) — not a page that lists or aggregates multiple documents.
- Both PDFs and web articles (HTML pages with specific content) are supported for indexing.`,
    experimental_output: Output.object({ schema: preflightResultSchema }),
  });

  if (!assessment) {
    logger.error("Readiness assessment returned no output");
    return {
      score: 0,
      sufficient: false,
      existingDocuments: [],
      gaps: [
        {
          topic: "unknown",
          description: "Assessment failed to produce output",
        },
      ],
      recommendations: [],
      checkedAt: new Date().toISOString(),
    };
  }

  const result: PreflightResult = {
    ...assessment,
    checkedAt: new Date().toISOString(),
  };

  logger.info("Readiness assessment complete", {
    score: result.score,
    sufficient: result.sufficient,
    gapCount: result.gaps.length,
    recommendationCount: result.recommendations.length,
  });

  return result;
};
