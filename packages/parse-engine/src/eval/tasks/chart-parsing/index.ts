/**
 * Chart/figure parsing eval task.
 * Input: cropped chart image + page context → vision LLM → description
 * Judge: compare against reference description
 */
import fs from "node:fs";
import path from "node:path";
import { generateText } from "ai";
import { getGatewayModel } from "../../../ai.js";
import type { EvalTask, ImageCase } from "../../types.js";
import { EVAL_DATA_ROOT } from "../../paths.js";

const MANIFEST = path.join(EVAL_DATA_ROOT, "charts", "manifest.json");

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

const CONTEXT_PROMPT = `The following page image is provided ONLY for context to help you understand what the chart is about. Do NOT extract text or content from this page — only use it to understand the chart in the first image.`;

export const chartParsing: EvalTask = {
  name: "chart-parsing",

  dimensions: [
    "completeness",
    "accuracy",
    "data_extraction",
    "structure",
  ],

  judgeCriteria: `Evaluate how well the chart extraction captures the information from the source image.
- completeness: Are all key data points, trends, labels, legends, and axes mentioned?
- accuracy: Are the reported numbers and figures correct? No hallucinated data?
- data_extraction: Are specific numbers, percentages, and values correctly extracted from charts/bars/lines?
- structure: Is the output well-organized and does it faithfully represent the layout of the source?

IMPORTANT: Do NOT hallucinate data errors. If a number looks plausible and you cannot clearly read the source image value, assume the output is correct. Only flag errors when highly confident.
Data accuracy and completeness should weigh MORE than formatting in the overall score.`,

  async loadCases(): Promise<ImageCase[]> {
    if (!fs.existsSync(MANIFEST)) return [];
    return JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
  },

  async run(testCase: ImageCase, model: string) {
    const start = Date.now();
    const imageBytes = fs.readFileSync(path.join(EVAL_DATA_ROOT, testCase.image));
    const pageBytes = testCase.page
      ? fs.readFileSync(path.join(EVAL_DATA_ROOT, testCase.page))
      : undefined;

    const content: any[] = [
      { type: "text", text: CHART_PROMPT },
      { type: "image", image: imageBytes, mediaType: "image/png" },
    ];
    if (pageBytes) {
      content.push(
        { type: "text", text: CONTEXT_PROMPT },
        { type: "image", image: pageBytes, mediaType: "image/png" },
      );
    }

    const llm = getGatewayModel(model);
    const result = await generateText({
      model: llm,
      messages: [{ role: "user", content }],
    });

    const u = result.totalUsage ?? result.usage;
    const cost = result.providerMetadata?.gateway?.cost
      ? parseFloat(result.providerMetadata.gateway.cost as string)
      : undefined;

    return {
      output: result.text,
      latencyMs: Date.now() - start,
      usage: {
        model,
        promptTokens: u?.inputTokens ?? 0,
        completionTokens: u?.outputTokens ?? 0,
        cost,
      },
    };
  },
};
