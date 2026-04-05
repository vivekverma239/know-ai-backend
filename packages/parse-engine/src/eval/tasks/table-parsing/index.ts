/**
 * Table parsing eval task.
 * Input: cropped table image + page context → vision LLM → table output
 * Supports markdown and ASCII output formats.
 */
import fs from "node:fs";
import path from "node:path";
import { generateText } from "ai";
import { getGatewayModel } from "../../../ai.js";
import type { EvalTask, ImageCase } from "../../types.js";
import { EVAL_DATA_ROOT } from "../../paths.js";

const MANIFEST = path.join(EVAL_DATA_ROOT, "tables", "manifest.json");

const BASE_INSTRUCTIONS = `copy paste the document attahed here, maintaining its layout, and following the following instructions:
- do not complete sentences that are incomplete, only return exactly what is in the document, no additional content
- do not summarize the content of the document, report exactly what is in the document
- do not add content to the output, only return what you see in the document, do not infer anything, just copy paste
- make sure to include all references, even those in smaller font at the end of the page
- if there are charts/figures, add a good summary of them which explains the meaning of the chart as well, if possible extract any numeric values mentioned or inferrable form the charts, in a way that makes sense in text form
- If there are numeric values in any chart like bar chart make sure to extract those along with appropriate text which should include legends and axis title`;

const MARKDOWN_SUFFIX = `- make sure to extract all tables correctly taking into account merged cells, indicate merged cells with [rowspan=X] and [colspan=X] markers in the initial cell the merged range, while leaving all other cells of the range empty, for example look at the following table with 4 columns and 2 rows:
|text in the merged cells [colspan=3] | | | text in cell after merged range|
| a | b | c | d |`;

const ASCII_SUFFIX = `- make sure to extract all tables correctly as ASCII tables using +, -, and | characters to draw borders
- Align columns properly and preserve all data exactly
- Use proper box-drawing to show the table structure including merged cells`;

export const tableParsing: EvalTask = {
  name: "table-parsing",

  dimensions: [
    "structural_accuracy",
    "data_accuracy",
    "header_detection",
    "completeness",
  ],

  judgeCriteria: `Evaluate how well the parsed output matches the source image.
- structural_accuracy: Are the correct number of rows and columns present? Is the data organized into a parseable table format?
- data_accuracy: Do all numbers, percentages, and text values match the source image exactly? This is the MOST IMPORTANT dimension.
- header_detection: Are column headers and row labels present and associated with the correct data?
- completeness: Is all content from the image captured, including footnotes, references, and small print?

IMPORTANT scoring rules:
- Ignore [rowspan=X] and [colspan=X] markers — these are formatting hints, not errors.
- The output may be in markdown table format OR ASCII box-drawn table format — both are valid. Do NOT penalize for format choice.
- For multi-level/hierarchical headers: as long as the header text is present and associated with the right columns, the exact visual nesting does not matter. Do NOT heavily penalize if hierarchy is flattened but data mapping is still correct.
- Data accuracy and completeness should weigh MORE than structural formatting in the overall score.`,

  async loadCases(): Promise<ImageCase[]> {
    if (!fs.existsSync(MANIFEST)) return [];
    return JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
  },

  async run(testCase: ImageCase, model: string, opts?: { format?: string }) {
    const start = Date.now();
    const format = opts?.format ?? "markdown";
    const prompt = `${BASE_INSTRUCTIONS}\n${format === "ascii" ? ASCII_SUFFIX : MARKDOWN_SUFFIX}`;

    const imageBytes = fs.readFileSync(path.join(EVAL_DATA_ROOT, testCase.image));
    const pageBytes = testCase.page
      ? fs.readFileSync(path.join(EVAL_DATA_ROOT, testCase.page))
      : undefined;

    const content: any[] = [
      { type: "text", text: prompt },
      { type: "image", image: imageBytes, mediaType: "image/png" },
    ];
    if (pageBytes) {
      content.push(
        { type: "text", text: "Here is the full page for context:" },
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
