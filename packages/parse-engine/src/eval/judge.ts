/**
 * LLM-as-judge using generateObject for structured scoring.
 * Multimodal — sees the source image to verify against ground truth,
 * not just against a potentially flawed text reference.
 */
import { generateObject } from "ai";
import { getGatewayModel } from "../ai.js";
import { JudgeScoreSchema, type JudgeScore } from "./types.js";

export interface JudgeInput {
  /** What the model was asked to do */
  taskDescription: string;
  /** The model's actual output */
  actual: string;
  /** The reference/expected output (guide, not sole source of truth) */
  reference: string;
  /** Evaluation criteria with rubric */
  criteria: string;
  /** Dimension names to score */
  dimensions: string[];
  /** Model to use for judging */
  model: string;
  /** Source image the model was parsing — judge verifies output against this */
  image?: Buffer;
}

export async function judge(input: JudgeInput): Promise<JudgeScore> {
  const dimensionList = input.dimensions
    .map((d) => `  - ${d} (1-5)`)
    .join("\n");

  const system = `You are an expert evaluator for document parsing quality.

You will be given:
1. The SOURCE IMAGE that the model was asked to parse
2. A REFERENCE output showing what a good extraction looks like
3. The ACTUAL OUTPUT produced by the model being evaluated

Your job: Score the actual output by comparing it against BOTH the source image AND the reference.
- The reference is the primary guide for expected structure, content, and completeness
- The source image provides visual context but small numbers may be hard to read — do NOT claim specific numbers are wrong unless you are very confident
- If the actual output captures information correctly but differs from the reference in formatting or layout, that is still good

IMPORTANT: Do NOT hallucinate data errors. If a number in the actual output looks plausible and you cannot clearly read the source image value, assume the output is correct. Only flag data errors when you are highly confident the value is wrong.

Score on each dimension (1-5 scale), then give an overall score and pass/fail (pass = overall >= 3).

Scoring guide:
  5 = Perfect or near-perfect — all data captured correctly
  4 = Minor issues, all key information present
  3 = Acceptable, some information missing or slightly wrong
  2 = Significant issues, major information missing or wrong
  1 = Poor quality, largely incorrect or missing

Dimensions to score:
${dimensionList}`;

  const content: any[] = [];

  // Add source image first if available
  if (input.image) {
    content.push(
      { type: "text", text: "## Source Image (ground truth — verify the actual output against this)" },
      { type: "image", image: input.image },
    );
  }

  content.push({
    type: "text",
    text: `## Task
${input.taskDescription}

## Evaluation Criteria
${input.criteria}

## Reference (expected output — use as a guide for structure and completeness)
${input.reference}

## Actual Output (to evaluate against the source image and reference)
${input.actual}

Score each dimension and provide your overall assessment.`,
  });

  const llm = getGatewayModel(input.model);
  const { object } = await generateObject({
    model: llm,
    schema: JudgeScoreSchema,
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
  });

  return object;
}
