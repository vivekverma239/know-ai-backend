import { recordLlmUsage } from "@/utils/costTracker";
import { logger } from "@/utils/logger";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { embedMany } from "ai";
import { randomUUID } from "node:crypto";

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");
}
const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

type EmbeddingProvider = "google" | "gemini" | "openai";

/**
 * Build the vendor-prefixed slug we send to the cost tracker. Tokenlens's
 * catalog uses `vendor/slug` keys; the normalization in `tokenlens.ts` can
 * also resolve bare slugs but vendor-prefixed is the canonical form.
 */
function embeddingModelSlug(provider: EmbeddingProvider): string {
  switch (provider) {
    case "openai":
      return "openai/text-embedding-3-small";
    case "gemini":
      return "google/gemini-embedding-001";
    case "google":
      return "google/text-embedding-004";
  }
}

/**
 * Embeds a list of text values into a vector space.
 * @param values - The list of text values to embed.
 * @returns The embeddings of the input values.
 */
export const getEmbeddings = async (
  values: string[],
  model: EmbeddingProvider = "gemini",
) => {
  const slug = embeddingModelSlug(model);
  const embeddingModel =
    model === "openai"
      ? openai.embedding("text-embedding-3-small")
      : model === "gemini"
        ? google.textEmbedding("gemini-embedding-001")
        : google.textEmbedding("text-embedding-004");
  // Replace empty/whitespace-only strings to avoid "empty Part" errors from Google
  const sanitizedValues = values.map((v) => (v.trim() === "" ? "NO TEXT" : v));

  const embeddings: number[][] = [];
  for (let i = 0; i < sanitizedValues.length; i += 100) {
    const batch = sanitizedValues.slice(i, i + 100);
    let retries = 0;
    while (true) {
      try {
        const { embeddings: embeddingsBatch, usage } = await embedMany({
          model: embeddingModel,
          values: batch,
          providerOptions: {
            openai: { dimensions: 768 },
            google: { outputDimensionality: 768 },
          },
        });
        embeddings.push(...embeddingsBatch);

        // Google's embedding endpoint returns `usage.tokens === null`; fall
        // back to a ~4-chars-per-token estimate so the cost row isn't lost.
        const reportedTokens = usage?.tokens ?? null;
        const estimatedTokens =
          reportedTokens ??
          Math.ceil(batch.reduce((sum, s) => sum + s.length, 0) / 4);

        void recordLlmUsage({
          operationName: "embedMany",
          operationId: randomUUID(),
          source: "embedding",
          model: slug,
          inputTokens: estimatedTokens,
          outputTokens: 0,
          metadata: {
            provider: model,
            batchSize: batch.length,
            tokenSource: reportedTokens === null ? "char-estimate" : "sdk",
          },
        });
        break;
      } catch (error) {
        retries++;
        logger.error(`Embedding batch ${Math.floor(i / 100) + 1} failed (attempt ${retries}/3)`, {
          error: (error as Error).message,
          batchStart: i,
          batchSize: batch.length,
        });
        if (retries >= 3) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * retries));
      }
    }
  }
  return embeddings;
};
