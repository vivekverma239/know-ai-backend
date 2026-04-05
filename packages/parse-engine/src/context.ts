/**
 * Pipeline context — carries configuration, persistence, usage tracking,
 * and document info through every pipeline step.
 */
import type { PersistenceProvider } from "./persistence.js";
import type { ModelConfig } from "./models.js";
import { UsageTracker } from "./usage.js";

export interface PipelineConfig {
  persistence: PersistenceProvider;
  models: ModelConfig;
  documentHash: string;
  /** Cache TTL in seconds (default: 24 hours) */
  cacheTtl?: number;
  /** Max retries per LLM call */
  maxRetries?: number;
}

/** Shape of the AI SDK result that we extract usage from */
interface AiSdkResult {
  totalUsage?: { inputTokens?: number; outputTokens?: number };
  usage?: { inputTokens?: number; outputTokens?: number };
  providerMetadata?: {
    gateway?: { cost?: string; generationId?: string };
    [key: string]: unknown;
  };
}

export class PipelineContext {
  readonly persistence: PersistenceProvider;
  readonly models: ModelConfig;
  readonly documentHash: string;
  readonly cacheTtl: number;
  readonly maxRetries: number;
  readonly usage: UsageTracker;

  constructor(config: PipelineConfig) {
    this.persistence = config.persistence;
    this.models = config.models;
    this.documentHash = config.documentHash;
    this.cacheTtl = config.cacheTtl ?? 24 * 60 * 60;
    this.maxRetries = config.maxRetries ?? 3;
    this.usage = new UsageTracker();
  }

  /** Build a cache key scoped to this document. */
  key(step: string, ...parts: (string | number)[]): string {
    const suffix = parts.length > 0 ? `_${parts.join("_")}` : "";
    return `${step}_${this.documentHash}${suffix}`;
  }

  /**
   * Cache-or-compute pattern.
   * If cached result exists, return it. Otherwise run fn, cache, and return.
   */
  async cached<T>(
    cacheKey: string,
    fn: () => Promise<T>,
    label?: string
  ): Promise<T> {
    const existing = await this.persistence.get(cacheKey);
    if (existing != null) {
      if (label) console.log(`  ${label}: cache hit`);
      return JSON.parse(existing) as T;
    }

    const result = await fn();
    await this.persistence.set(cacheKey, JSON.stringify(result), this.cacheTtl);
    return result;
  }

  /**
   * Record LLM usage from a raw AI SDK result.
   * Extracts token counts from totalUsage (or usage), and actual cost
   * from providerMetadata.gateway.cost returned by the Vercel AI Gateway.
   */
  trackUsage(step: string, model: string, result: AiSdkResult) {
    const u = result.totalUsage ?? result.usage;
    const gatewayCost = result.providerMetadata?.gateway?.cost
      ? parseFloat(result.providerMetadata.gateway.cost)
      : undefined;

    this.usage.record(step, model, {
      promptTokens: u?.inputTokens ?? 0,
      completionTokens: u?.outputTokens ?? 0,
    }, gatewayCost);
  }
}
