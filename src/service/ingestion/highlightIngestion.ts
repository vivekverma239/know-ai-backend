import { MODELS } from "@/@types/llm";
import { getEmbeddings } from "@/ai-backend/embeddings";
import { getLLM } from "@/ai-backend/llm";
import { getDb } from "@/db";
import { highlights } from "@/db/external_schema";
import { recordUsageFromSdk } from "@/utils/costTracker";
import { logError, logger } from "@/utils/logger";
import { generateText } from "ai";
import { eq } from "drizzle-orm";

type HighlightIngestionData = {
  id?: number | string;
  imageUrl?: string | null;
};

const IMAGE_EXTRACTION_PROMPT = `
You are extracting information from an image for semantic retrieval.

Requirements:
- Return **plain text only**, no markdown, no bullet syntax, no labels.
- If the image contains **text**, perform OCR and return **all visible text exactly as it appears** (do not correct, rephrase, translate, summarize, or reorder it).

In addition, extract a concise factual summary of the **visual content** (separate from the raw text), covering where applicable:
- Key entities (people, companies, tickers, countries, sectors, instruments, exchanges)
- Financial data and metrics (prices, returns, P&L, volumes, market caps, EPS, PE, yields, interest rates, FX rates, spreads, ratios)
- Structured data shown in **tables** (headers and cell values)
- Information from **charts and graphs** (time ranges, axes labels/units, data series names, levels, trends, peaks/troughs, patterns)
- Information from other **visualizations** (heatmaps, maps, dashboards, scorecards, gauges) and what they indicate
- Key numbers, dates, and time periods

Output format:
1) First, the exact OCR text block, in the same order as it appears in the image.
2) Then, a short plain-text visual summary describing the main financial insights and relationships shown in the image.
`.trim();

const parseHighlightId = (value: number | string | undefined): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const cleanText = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const buildEmbeddingInput = (
  content: string | undefined,
  imageContent: string | undefined,
): string => {
  const sections: string[] = [];

  if (content) {
    sections.push(`Highlight content:\n${content}`);
  }

  if (imageContent) {
    sections.push(`Image content:\n${imageContent}`);
  }

  return sections.join("\n\n");
};

const parseImageContent = async (
  imageUrl: string,
  highlightId: number,
): Promise<string | undefined> => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    logger.warn("Highlight image parsing skipped: invalid image URL.", {
      highlightId,
      imageUrl,
    });
    return undefined;
  }

  try {
    const model = MODELS.GEMINI_3_FLASH;
    const response = await generateText({
      model: getLLM(model),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: IMAGE_EXTRACTION_PROMPT,
            },
            {
              type: "image",
              image: parsedUrl,
            },
          ],
        },
      ],
    });

    recordUsageFromSdk({
      operationName: "highlightIngestion:parseImage",
      source: "other",
      model,
      usage: response.usage,
      metadata: { highlightId: String(highlightId) },
    });

    return cleanText(response.text);
  } catch (error) {
    logError(error, {
      operation: "highlightIngestion:parseImage",
      highlightId,
      imageUrl,
    });
    return undefined;
  }
};

export const ensureHighlightEmbedding = async (
  data: HighlightIngestionData,
  action: "insert" | "update",
): Promise<void> => {
  const highlightId = parseHighlightId(data.id);
  if (!highlightId) {
    logger.warn("Highlight ingestion skipped: missing highlight id.");
    return;
  }

  try {
    const highlight = await getDb().query.highlights.findFirst({
      where: eq(highlights.id, highlightId),
    });

    if (!highlight) {
      logger.warn("Highlight ingestion skipped: highlight not found.", { highlightId });
      return;
    }

    const currentImageUrl = cleanText(highlight.imageUrl);
    const eventImageUrl = cleanText(data.imageUrl);

    let imageParsedContent = cleanText(highlight.imageParsedContent);
    const shouldParseImage = Boolean(
      currentImageUrl &&
        (!imageParsedContent || eventImageUrl !== undefined || action === "insert"),
    );

    if (shouldParseImage && currentImageUrl) {
      const parsedFromImage = await parseImageContent(currentImageUrl, highlightId);
      if (parsedFromImage) {
        imageParsedContent = parsedFromImage;
      }
    } else if (!currentImageUrl) {
      imageParsedContent = undefined;
    }

    const embeddingInput = buildEmbeddingInput(cleanText(highlight.content), imageParsedContent);
    if (!embeddingInput) {
      await getDb()
        .update(highlights)
        .set({
          contentEmbedding: null,
          imageParsedContent: imageParsedContent ?? null,
        })
        .where(eq(highlights.id, highlightId));
      return;
    }

    const [embedding] = await getEmbeddings([embeddingInput]);
    if (!embedding) {
      logger.warn("Highlight ingestion skipped: failed to generate embedding.", { highlightId });
      return;
    }

    await getDb()
      .update(highlights)
      .set({
        contentEmbedding: embedding,
        imageParsedContent: imageParsedContent ?? null,
      })
      .where(eq(highlights.id, highlightId));
  } catch (error) {
    logError(error, {
      operation: "highlightIngestion:ensureEmbedding",
      highlightId,
    });
  }
};
