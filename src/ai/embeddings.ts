import { openai } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { embedMany } from "ai";
import { logger } from "@/utils/logger";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
});

/**
 * Embeds a list of text values into a vector space.
 * @param values - The list of text values to embed.
 * @returns The embeddings of the input values.
 */
export const getEmbeddings = async (
  values: string[],
  model: "google" | "gemini" | "openai" = "gemini"
) => {
  // Embed in batches of 100

  const embeddingModel =
    model === "openai"
      ? openai.embedding("text-embedding-3-small")
      : model === "gemini"
      ? google.textEmbedding("gemini-embedding-001")
      : google.textEmbedding("text-embedding-004");
  const embeddings: number[][] = [];
  for (let i = 0; i < values.length; i += 100) {
    while (true) {
      let retries = 0;
      try {
        const { embeddings: embeddingsBatch } = await embedMany({
          // model: openai.embedding('text-embedding-3-small'),
          model: embeddingModel,
          values: values.slice(i, i + 100),
          providerOptions: {
            openai: {
              dimensions: 512, // Reduce embedding dimensions
            },
            google: {
              outputDimensionality: 512,
            },
          },
        });
        embeddings.push(...embeddingsBatch);
        break;
      } catch (error) {
        logger.error(`Error embedding values: ${(error as Error).message}`);
        retries++;
        if (retries > 3) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
  return embeddings;
};
