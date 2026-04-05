/**
 * Usage and cost tracking across the pipeline.
 *
 * Tracks token usage per step. When the Vercel AI Gateway is used,
 * actual cost per call is available via providerMetadata.gateway.cost
 * and accumulated automatically. Falls back to estimated cost from
 * a static pricing table for unknown models.
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StepUsage {
  step: string;
  model: string;
  usage: TokenUsage;
  estimatedCost: number;
  /** Actual cost from AI Gateway (sum of per-call costs) */
  actualCost?: number;
  calls: number;
}

export interface PipelineUsage {
  steps: StepUsage[];
  totals: TokenUsage & {
    estimatedCost: number;
    actualCost?: number;
    totalCalls: number;
  };
}

// Approximate pricing per 1M tokens (input/output) — used as fallback
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "google/gemini-2.5-flash-lite": { input: 0.075, output: 0.30 },
  "google/gemini-2.5-flash": { input: 0.15, output: 0.60 },
  "google/gemini-2.0-flash": { input: 0.10, output: 0.40 },
  "google/gemini-3-flash": { input: 0.15, output: 0.60 },
  "openai/gpt-4o": { input: 2.50, output: 10.00 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.60 },
  "openai/gpt-4.1": { input: 2.00, output: 8.00 },
  "anthropic/claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
  "anthropic/claude-haiku-4-5-20251001": { input: 0.80, output: 4.00 },
};

const DEFAULT_PRICING = { input: 0.50, output: 2.00 };

function getPricing(model: string): { input: number; output: number } {
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

function estimateCost(model: string, usage: TokenUsage): number {
  const pricing = getPricing(model);
  return (usage.promptTokens * pricing.input + usage.completionTokens * pricing.output) / 1_000_000;
}

/**
 * Tracks token usage and cost across the pipeline.
 * Actual cost is accumulated per-call when available from the AI Gateway.
 */
export class UsageTracker {
  private steps = new Map<string, StepUsage>();

  /**
   * Record a single LLM call's usage.
   * @param actualCost - Actual cost in USD from providerMetadata.gateway.cost
   */
  record(
    step: string,
    model: string,
    usage: { promptTokens?: number; completionTokens?: number },
    actualCost?: number,
  ) {
    const prompt = usage.promptTokens ?? 0;
    const completion = usage.completionTokens ?? 0;
    const total = prompt + completion;
    const tokenUsage: TokenUsage = { promptTokens: prompt, completionTokens: completion, totalTokens: total };

    const existing = this.steps.get(step);
    if (existing) {
      existing.usage.promptTokens += prompt;
      existing.usage.completionTokens += completion;
      existing.usage.totalTokens += total;
      existing.estimatedCost += estimateCost(model, tokenUsage);
      existing.calls += 1;
      if (actualCost != null) {
        existing.actualCost = (existing.actualCost ?? 0) + actualCost;
      }
    } else {
      this.steps.set(step, {
        step,
        model,
        usage: tokenUsage,
        estimatedCost: estimateCost(model, tokenUsage),
        actualCost: actualCost ?? undefined,
        calls: 1,
      });
    }
  }

  /** Get full usage report */
  getReport(): PipelineUsage {
    const steps = [...this.steps.values()];
    const hasActualCost = steps.some((s) => s.actualCost != null);
    const totals = {
      promptTokens: steps.reduce((s, x) => s + x.usage.promptTokens, 0),
      completionTokens: steps.reduce((s, x) => s + x.usage.completionTokens, 0),
      totalTokens: steps.reduce((s, x) => s + x.usage.totalTokens, 0),
      estimatedCost: steps.reduce((s, x) => s + x.estimatedCost, 0),
      ...(hasActualCost ? {
        actualCost: steps.reduce((s, x) => s + (x.actualCost ?? 0), 0),
      } : {}),
      totalCalls: steps.reduce((s, x) => s + x.calls, 0),
    };
    return { steps, totals };
  }

  /** Print usage summary to console */
  printSummary() {
    const report = this.getReport();
    const hasActualCost = report.totals.actualCost != null;

    console.log("\n=== Usage & Cost ===");
    for (const step of report.steps) {
      const costStr = hasActualCost && step.actualCost != null
        ? `$${step.actualCost.toFixed(4)} (est: $${step.estimatedCost.toFixed(4)})`
        : `~$${step.estimatedCost.toFixed(4)}`;
      console.log(`  ${step.step.padEnd(25)} ${step.calls} calls  ${(step.usage.totalTokens / 1000).toFixed(1)}k tokens  ${costStr}`);
    }
    console.log(`  ${"─".repeat(80)}`);
    const totalCostStr = hasActualCost
      ? `$${report.totals.actualCost!.toFixed(4)} (est: $${report.totals.estimatedCost.toFixed(4)})`
      : `~$${report.totals.estimatedCost.toFixed(4)}`;
    console.log(`  ${"TOTAL".padEnd(25)} ${report.totals.totalCalls} calls  ${(report.totals.totalTokens / 1000).toFixed(1)}k tokens  ${totalCostStr}`);
  }
}
