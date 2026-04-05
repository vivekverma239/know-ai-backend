/**
 * Media detection eval task.
 * Input: full page image + detection result JSON → judge against reference
 * Tests whether PaddleOCR / Mistral correctly found all media blocks.
 */
import fs from "node:fs";
import path from "node:path";
import type { EvalTask, DetectionCase } from "../../types.js";
import { EVAL_DATA_ROOT } from "../../paths.js";

const MANIFEST = path.join(EVAL_DATA_ROOT, "detection", "manifest.json");

export const detection: EvalTask = {
  name: "detection",

  dimensions: [
    "recall",
    "precision",
    "type_accuracy",
    "boundary_quality",
  ],

  judgeCriteria: `Evaluate how well the detected media blocks match the reference.
- recall: Were all expected media blocks found? No misses?
- precision: Were there any false positives (blocks detected where none exist)?
- type_accuracy: Were tables correctly classified as tables and images/charts as images?
- boundary_quality: Are the detected regions reasonably covering the actual media content?

The actual output is a JSON list of detected blocks with type and bounds.
The reference is the ground truth list of blocks that should have been detected.
Compare them and score each dimension.`,

  async loadCases(): Promise<DetectionCase[]> {
    if (!fs.existsSync(MANIFEST)) return [];
    return JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
  },

  /**
   * For detection, the "model" param represents the detection source
   * (e.g. "paddle", "mistral"). The actual output comes from pre-computed results.
   */
  async run(testCase: DetectionCase, model: string) {
    const start = Date.now();
    const resultPath = path.join(
      EVAL_DATA_ROOT,
      testCase.page.replace(/\.[^.]+$/, `_${model}.json`),
    );

    if (!fs.existsSync(resultPath)) {
      throw new Error(
        `Detection results not found: ${resultPath}. Run the detector first and save results.`,
      );
    }

    const output = fs.readFileSync(resultPath, "utf-8");
    return {
      output,
      latencyMs: Date.now() - start,
    };
  },
};
