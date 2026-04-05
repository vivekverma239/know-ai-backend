/**
 * Eval framework types.
 */
import { z } from "zod";

// ── Test case definitions ──────────────────────────────────────────

export interface ImageCase {
  id: string;
  /** Path to the cropped media image (relative to eval-data/) */
  image: string;
  /** Path to the full-page context image (relative to eval-data/) */
  page?: string;
  /** Path to the reference output (relative to eval-data/) */
  reference: string;
  /** Optional description of the case */
  description?: string;
}

export interface DetectionCase {
  id: string;
  /** Path to the full page image (relative to eval-data/) */
  page: string;
  /** Path to reference JSON with expected detected blocks */
  reference: string;
  description?: string;
}

// ── Judge output ───────────────────────────────────────────────────

export const JudgeScoreSchema = z.object({
  score: z.number().min(1).max(5).describe("Overall quality score 1-5"),
  pass: z.boolean().describe("Whether the output meets minimum quality bar"),
  dimensions: z.record(z.string(), z.number().min(1).max(5)).describe("Per-dimension scores"),
  reasoning: z.string().describe("Brief explanation of scoring"),
});

export type JudgeScore = z.infer<typeof JudgeScoreSchema>;

// ── Eval results ───────────────────────────────────────────────────

export interface CaseResult {
  caseId: string;
  description?: string;
  status: "pass" | "fail" | "error";
  score: JudgeScore | null;
  output: string;
  latencyMs: number;
  error?: string;
  usage?: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    cost?: number;
  };
}

export interface EvalRun {
  task: string;
  model: string;
  judgeModel: string;
  timestamp: string;
  results: CaseResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    avgScore: number;
    avgLatencyMs: number;
    dimensions: Record<string, number>;
  };
}

// ── Task interface ─────────────────────────────────────────────────

export interface EvalTask {
  name: string;
  /** Load test cases from data files */
  loadCases(): Promise<ImageCase[] | DetectionCase[]>;
  /** Run a single test case and return the raw model output */
  run(testCase: ImageCase | DetectionCase, model: string, opts?: { format?: string }): Promise<{
    output: string;
    latencyMs: number;
    usage?: CaseResult["usage"];
  }>;
  /** Judge criteria for the LLM judge */
  judgeCriteria: string;
  /** Dimension names the judge should score on */
  dimensions: string[];
}
