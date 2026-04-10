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

const TABLE_PROMPT = `Extract the table from the first image below into a markdown table. Follow these rules strictly:

1. Return ONLY the table content as a markdown table — no surrounding text, headers, or commentary
2. Reproduce the data exactly as shown — do not infer, complete, or modify any values
3. Include all footnote references (e.g. superscript numbers) inline
4. For merged cells, use [rowspan=X] or [colspan=X] in the first cell of the range and leave spanned cells empty. Example:
   |text [colspan=3] | | | other|
   | a | b | c | d |
5. Preserve alignment: use :--- for left, ---: for right, :---: for center where apparent`;

const TABLE_CONTEXT_PROMPT = `The second image shows the full page for context only. Do NOT extract from it — use it only to understand column headers or footnotes that may help interpret the table in the first image.`;

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
 * If the response is empty (e.g. content filter), retries without the
 * context page image.
 */
export async function parseTableWithLLM(
  imageBytes: Buffer,
  pageBytes: Buffer,
  ctx: PipelineContext,
  cacheKey?: string
): Promise<string> {
  const key = cacheKey ? ctx.key("table_llm", cacheKey) : undefined;

  const fn = async () => {
    // Try with full context (table crop + page image)
    const messagesWithContext = [
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

    const result = await withRetry(
      (model) => callVisionLLM(model, messagesWithContext, ctx, "table_llm_parse"),
      ctx.models.smart,
      { maxRetries: ctx.maxRetries, models: ctx.models, label: "Table LLM parse" }
    );

    if (result) return result;

    // Retry without context page image (content filter workaround)
    console.warn("  Table LLM returned empty, retrying without page context...");
    const messagesNoContext = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: TABLE_PROMPT },
          { type: "image" as const, image: imageBytes, mediaType: "image/png" as const },
        ],
      },
    ];

    return withRetry(
      (model) => callVisionLLM(model, messagesNoContext, ctx, "table_llm_parse_no_ctx"),
      ctx.models.smart,
      { maxRetries: ctx.maxRetries, models: ctx.models, label: "Table LLM parse (no context)" }
    );
  };

  if (key) {
    return ctx.cached(key, fn);
  }
  return fn();
}
