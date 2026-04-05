/**
 * Retry utility with model fallback chain.
 *
 * Tries the primary model first. On failure, falls back through the
 * model tier chain: LITE → MEDIUM → SMART.
 */
import type { ModelConfig } from "./models.js";

export interface RetryOptions {
  /** Max retries per model */
  maxRetries?: number;
  /** Initial delay in ms */
  initialDelay?: number;
  /** Whether to try fallback models on final failure */
  modelFallback?: boolean;
  /** Model config for fallback chain */
  models?: ModelConfig;
  /** Label for logging */
  label?: string;
}

/**
 * Execute an async function with retries and exponential backoff.
 *
 * @param fn - Function that takes a model string and returns a result
 * @param primaryModel - The first model to try
 * @param opts - Retry options
 */
export async function withRetry<T>(
  fn: (model: string) => Promise<T>,
  primaryModel: string,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    modelFallback = true,
    models,
    label = "Operation",
  } = opts;

  // Build model chain: primary → fallback models (deduplicated)
  const modelChain = [primaryModel];
  if (modelFallback && models) {
    for (const fallback of [models.lite, models.medium, models.smart]) {
      if (!modelChain.includes(fallback)) {
        modelChain.push(fallback);
      }
    }
  }

  let lastError: Error | undefined;

  for (const model of modelChain) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn(model);
      } catch (err) {
        lastError = err as Error;
        const isRateLimit = lastError.message?.includes("429") ||
          lastError.message?.includes("rate") ||
          lastError.message?.includes("quota");

        const delay = isRateLimit
          ? initialDelay * Math.pow(3, attempt)  // aggressive backoff for rate limits
          : initialDelay * Math.pow(2, attempt);

        if (attempt < maxRetries - 1) {
          console.warn(`  ${label} attempt ${attempt + 1} failed (${model}), retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    if (model !== modelChain[modelChain.length - 1]) {
      console.warn(`  ${label} failed with ${model}, falling back to next model...`);
    }
  }

  throw lastError ?? new Error(`${label} failed after all retries and fallbacks`);
}
