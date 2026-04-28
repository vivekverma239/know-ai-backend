/**
 * Model tier configuration.
 *
 * Defines four tiers of models based on task type and quality target:
 *   LITE   — fast & cheap, for bulk/simple tasks (summaries, page extraction)
 *   MEDIUM — balanced, for structured reasoning (outlines, metadata, chapters)
 *   SMART  — high quality structured-text + table-LLM extraction
 *   VISION — best-in-class image/chart understanding (used for chart and figure
 *            parsing inside PDFs, and for the standalone image parser)
 *
 * Override via env vars or pass custom config to the pipeline.
 */

export interface ModelConfig {
  /** Fast & cheap — summaries, cluster parsing, page summaries */
  lite: string;
  /** Balanced — outlines, metadata, chapter detection */
  medium: string;
  /** High quality structured-text + table-LLM extraction */
  smart: string;
  /** Vision-first — chart / figure / standalone-image parsing */
  vision: string;
}

const defaults: ModelConfig = {
  lite: "google/gemini-2.5-flash-lite",
  medium: "google/gemini-2.5-flash",
  smart: "google/gemini-3-flash",
  vision: "anthropic/claude-sonnet-4.6",
};

/**
 * Resolve model config from env vars with defaults.
 *
 * Env vars:
 *   MODEL_LITE=google/gemini-2.5-flash-lite
 *   MODEL_MEDIUM=google/gemini-2.5-flash
 *   MODEL_SMART=google/gemini-3-flash
 *   MODEL_VISION=anthropic/claude-sonnet-4.6
 */
export function getModelConfig(): ModelConfig {
  return {
    lite: process.env.MODEL_LITE ?? defaults.lite,
    medium: process.env.MODEL_MEDIUM ?? defaults.medium,
    smart: process.env.MODEL_SMART ?? defaults.smart,
    vision: process.env.MODEL_VISION ?? defaults.vision,
  };
}
