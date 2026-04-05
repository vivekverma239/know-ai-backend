/**
 * Chart/figure and table parsing via vision LLM using Vercel AI Gateway.
 */
import { generateText } from "ai";
import { getGatewayModel } from "../ai.js";
import { withRetry } from "../retry.js";
import type { PipelineContext } from "../context.js";

const CHART_PROMPT = `Extract ONLY the chart/figure shown in the first image below. Do not extract any surrounding text, paragraphs, or other content from the page — focus exclusively on the chart itself.

For the chart, provide:
- The chart title and subtitle if visible
- Chart type (bar, line, pie, stacked bar, scatter, etc.)
- Axis labels and units
- Legend entries
- All data points, numbers, and values you can read from the chart
- If there are numeric values in bars/lines/segments, extract them with their labels
- Use markdown tables where appropriate to present the data clearly
- Keep it concise while extracting all information from the chart`;

const CHART_CONTEXT_PROMPT = `The following page image is provided ONLY for context to help you understand what the chart is about. Do NOT extract text or content from this page — only use it to understand the chart in the first image.`;

const TABLE_PROMPT = `copy paste the document attahed here, maintaining its layout, and following the following instructions:
- do not complete sentences that are incomplete, only return exactly what is in the document, no additional content
- do not summarize the content of the document, report exactly what is in the document
- do not add content to the output, only return what you see in the document, do not infer anything, just copy paste
- make sure to include all references, even those in smaller font at the end of the page
- if there are charts/figures, add a good summary of them which explains the meaning of the chart as well, if possible extract any numeric values mentioned or inferrable form the charts, in a way that makes sense in text form
- If there are numeric values in any chart like bar chart make sure to extract those along with appropriate text which should include legends and axis title
- make sure to extract all tables correctly taking into account merged cells, indicate merged cells with [rowspan=X] and [colspan=X] markers in the initial cell the merged range, while leaving all other cells of the range empty, for example look at the following table with 4 columns and 2 rows:
|text in the merged cells [colspan=3] | | | text in cell after merged range|
| a | b | c | d |`;

const TABLE_CONTEXT_PROMPT = `To help you understand the context, this is the full document page from which the content was extracted. Use it only for reference.`;

async function callVisionLLM(
  model: string,
  messages: any[],
  ctx: PipelineContext,
  stepLabel?: string,
): Promise<string> {
  const llm = getGatewayModel(model);
  const result = await generateText({
    model: llm,
    messages,
  });
  ctx.trackUsage(stepLabel ?? "vision_llm", model, result);
  return result.text;
}

/**
 * Parse a chart/figure image. Uses retry with model fallback.
 */
export async function parseChart(
  imageBytes: Buffer,
  pageBytes: Buffer,
  ctx: PipelineContext,
  cacheKey?: string
): Promise<string> {
  const key = cacheKey ? ctx.key("chart", cacheKey) : undefined;

  const fn = async () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: CHART_PROMPT },
          { type: "image" as const, image: imageBytes, mediaType: "image/png" as const },
          { type: "text" as const, text: CHART_CONTEXT_PROMPT },
          { type: "image" as const, image: pageBytes, mediaType: "image/png" as const },
        ],
      },
    ];

    return withRetry(
      (model) => callVisionLLM(model, messages, ctx, "chart_parse"),
      ctx.models.smart,
      { maxRetries: ctx.maxRetries, models: ctx.models, label: "Chart parse" }
    );
  };

  if (key) {
    return ctx.cached(key, fn);
  }
  return fn();
}

/**
 * Parse a table image using a vision LLM. Uses retry with model fallback.
 */
export async function parseTableWithLLM(
  imageBytes: Buffer,
  pageBytes: Buffer,
  ctx: PipelineContext,
  cacheKey?: string
): Promise<string> {
  const key = cacheKey ? ctx.key("table_llm", cacheKey) : undefined;

  const fn = async () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: TABLE_PROMPT },
          { type: "image" as const, image: imageBytes, mediaType: "image/png" as const },
          { type: "text" as const, text: TABLE_CONTEXT_PROMPT },
          { type: "image" as const, image: pageBytes, mediaType: "image/png" as const },
        ],
      },
    ];

    return withRetry(
      (model) => callVisionLLM(model, messages, ctx, "table_llm_parse"),
      ctx.models.smart,
      { maxRetries: ctx.maxRetries, models: ctx.models, label: "Table LLM parse" }
    );
  };

  if (key) {
    return ctx.cached(key, fn);
  }
  return fn();
}
