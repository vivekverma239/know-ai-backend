/**
 * Model tier configuration.
 *
 * Defines three tiers of models based on task complexity:
 *   LITE   — fast & cheap, for bulk/simple tasks (summaries, page extraction)
 *   MEDIUM — balanced, for structured reasoning (outlines, metadata, chapters)
 *   SMART  — highest quality, for complex vision tasks (charts, tables, media)
 *
 * Override via env vars or pass custom config to the pipeline.
 */

export interface ModelConfig {
  /** Fast & cheap — summaries, cluster parsing, page summaries */
  lite: string;
  /** Balanced — outlines, metadata, chapter detection */
  medium: string;
  /** Highest quality — chart parsing, table parsing, media analysis */
  smart: string;
}

const defaults: ModelConfig = {
  lite: "google/gemini-2.5-flash-lite",
  medium: "google/gemini-2.5-flash",
  smart: "google/gemini-3-flash",
};

/**
 * Resolve model config from env vars with defaults.
 *
 * Env vars:
 *   MODEL_LITE=google/gemini-2.5-flash-lite
 *   MODEL_MEDIUM=google/gemini-2.5-flash
 *   MODEL_SMART=google/gemini-3-flash
 */
export function getModelConfig(): ModelConfig {
  return {
    lite: process.env.MODEL_LITE ?? defaults.lite,
    medium: process.env.MODEL_MEDIUM ?? defaults.medium,
    smart: process.env.MODEL_SMART ?? defaults.smart,
  };
}
