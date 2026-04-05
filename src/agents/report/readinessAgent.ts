import { MODELS } from "@/@types/llm";
import { getLLM } from "@/ai-backend/llm";
import type { PreflightResult } from "@/db/schema";
import { similaritySearchDocuments } from "@/service/simSearch";
import { env } from "@/utils/env";
import { createContextLogger } from "@/utils/logger";
import { Output, generateText } from "ai";
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

const searchWebForSources = async (
  gaps: { topic: string; description: string }[],
  reportTopic: string,
): Promise<{ title: string; url: string; type: "pdf" | "web_article"; fillsGap: string }[]> => {
  const exa = new Exa(env.get("EXA_API_KEY"));
  const recommendations: {
    title: string;
    url: string;
    type: "pdf" | "web_article";
    fillsGap: string;
  }[] = [];

  for (const gap of gaps) {
    try {
      // Search for PDFs
      const pdfResults = await exa.search(`${reportTopic} ${gap.topic}`, {
        type: "neural",
        category: "pdf",
        numResults: 3,
      });

      for (const result of pdfResults.results) {
        recommendations.push({
          title: result.title?.trim() || `PDF: ${gap.topic}`,
          url: result.url,
          type: "pdf",
          fillsGap: gap.topic,
        });
      }

      // Search for web articles
      const webResults = await exa.search(`${reportTopic} ${gap.topic}`, {
        type: "neural",
        numResults: 3,
      });

      for (const result of webResults.results) {
        // Skip if already added as PDF
        if (recommendations.some((r) => r.url === result.url)) continue;
        recommendations.push({
          title: result.title?.trim() || `Article: ${gap.topic}`,
          url: result.url,
          type: "web_article",
          fillsGap: gap.topic,
        });
      }
    } catch (error) {
      logger.warn("Web search failed for gap", {
        gap: gap.topic,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return recommendations;
};

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

  // Step 1: Find relevant documents via similarity search
  const relevantDocs = await similaritySearchDocuments({
    query: topic,
    limit: 10,
    userId,
    orgId,
  });

  logger.info("Found relevant documents", {
    count: relevantDocs.length,
    docIds: relevantDocs.map((d) => d.id),
  });

  // Step 2: LLM analyzes coverage gaps
  const docSummaries = relevantDocs
    .map(
      (doc) =>
        `- Document "${doc.title}" (ID: ${doc.id}): ${doc.summary ?? "No summary available"}`,
    )
    .join("\n");

  const { experimental_output: assessment } = await generateText({
    model: getLLM(MODELS.GEMINI_3_FLASH),
    prompt: `You are a report readiness analyst. Assess whether the available documents are sufficient to generate a high-quality report.

## Report Details
- **Topic:** ${topic}
- **Reference Period:** ${referencePeriod || "Not specified"}
- **Task Description:** ${taskDescription}
- **Report Instructions:** ${initialResearchPrompt}

## Available Documents
${docSummaries || "No documents found."}

## Your Task
1. Identify the key coverage areas required by the task description and report instructions.
2. Map each available document to the coverage areas it addresses. Assign a relevance score (0-1) for each document.
3. Identify gaps — coverage areas with no or weak document support.
4. Assign an overall readiness score (0-100) based on the percentage of coverage areas satisfied.
5. Set "sufficient" to true if the score is 60 or above and at least 2 relevant documents exist.

Return your assessment as JSON. Leave the "recommendations" array empty — it will be filled separately.`,
    experimental_output: Output.object({ schema: preflightResultSchema }),
  });

  if (!assessment) {
    logger.error("Readiness assessment returned no output");
    return {
      score: 0,
      sufficient: false,
      existingDocuments: [],
      gaps: [{ topic: "unknown", description: "Assessment failed to produce output" }],
      recommendations: [],
      checkedAt: new Date().toISOString(),
    };
  }

  // Step 3: If there are gaps, search the web for sources to fill them
  let recommendations: PreflightResult["recommendations"] = [];
  if (assessment.gaps.length > 0) {
    recommendations = await searchWebForSources(assessment.gaps, topic);
  }

  const result: PreflightResult = {
    ...assessment,
    recommendations,
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
