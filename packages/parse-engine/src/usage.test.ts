import { describe, it, expect, beforeEach } from "vitest";
import { UsageTracker } from "./usage.js";

describe("UsageTracker", () => {
  let tracker: UsageTracker;

  beforeEach(() => {
    tracker = new UsageTracker();
  });

  it("starts with empty report", () => {
    const report = tracker.getReport();
    expect(report.steps).toHaveLength(0);
    expect(report.totals.promptTokens).toBe(0);
    expect(report.totals.completionTokens).toBe(0);
    expect(report.totals.totalTokens).toBe(0);
    expect(report.totals.estimatedCost).toBe(0);
    expect(report.totals.totalCalls).toBe(0);
  });

  it("records a single call", () => {
    tracker.record("summary", "google/gemini-2.5-flash", {
      promptTokens: 1000,
      completionTokens: 200,
    });

    const report = tracker.getReport();
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0].step).toBe("summary");
    expect(report.steps[0].model).toBe("google/gemini-2.5-flash");
    expect(report.steps[0].usage.promptTokens).toBe(1000);
    expect(report.steps[0].usage.completionTokens).toBe(200);
    expect(report.steps[0].usage.totalTokens).toBe(1200);
    expect(report.steps[0].calls).toBe(1);
  });

  it("aggregates multiple calls to the same step", () => {
    tracker.record("cluster_parsing", "google/gemini-2.5-flash-lite", {
      promptTokens: 500,
      completionTokens: 100,
    });
    tracker.record("cluster_parsing", "google/gemini-2.5-flash-lite", {
      promptTokens: 600,
      completionTokens: 150,
    });

    const report = tracker.getReport();
    expect(report.steps).toHaveLength(1);
    const step = report.steps[0];
    expect(step.usage.promptTokens).toBe(1100);
    expect(step.usage.completionTokens).toBe(250);
    expect(step.usage.totalTokens).toBe(1350);
    expect(step.calls).toBe(2);
  });

  it("tracks multiple steps separately", () => {
    tracker.record("summary", "google/gemini-2.5-flash-lite", { promptTokens: 1000, completionTokens: 200 });
    tracker.record("metadata_base", "google/gemini-2.5-flash", { promptTokens: 2000, completionTokens: 500 });
    tracker.record("chart_parse", "openai/gpt-4o", { promptTokens: 3000, completionTokens: 800 });

    const report = tracker.getReport();
    expect(report.steps).toHaveLength(3);
    expect(report.totals.promptTokens).toBe(6000);
    expect(report.totals.completionTokens).toBe(1500);
    expect(report.totals.totalTokens).toBe(7500);
    expect(report.totals.totalCalls).toBe(3);
  });

  it("calculates estimated cost for known models", () => {
    // google/gemini-2.5-flash: input $0.15/M, output $0.60/M
    tracker.record("summary", "google/gemini-2.5-flash", {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    });

    const report = tracker.getReport();
    expect(report.steps[0].estimatedCost).toBeCloseTo(0.75, 4);
  });

  it("calculates estimated cost for openai/gpt-4o", () => {
    // openai/gpt-4o: input $2.50/M, output $10.00/M
    tracker.record("chart_parse", "openai/gpt-4o", {
      promptTokens: 10_000,
      completionTokens: 2_000,
    });

    const report = tracker.getReport();
    // (10000 * 2.50 + 2000 * 10.00) / 1_000_000 = 0.045
    expect(report.steps[0].estimatedCost).toBeCloseTo(0.045, 6);
  });

  it("uses default pricing for unknown models", () => {
    tracker.record("test", "unknown/model-xyz", {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    });

    const report = tracker.getReport();
    // Default: $0.50 + $2.00 = $2.50
    expect(report.steps[0].estimatedCost).toBeCloseTo(2.50, 4);
  });

  it("handles missing token counts gracefully", () => {
    tracker.record("test", "google/gemini-2.5-flash", {});
    tracker.record("test", "google/gemini-2.5-flash", { promptTokens: 100 });
    tracker.record("test", "google/gemini-2.5-flash", { completionTokens: 50 });

    const report = tracker.getReport();
    expect(report.steps[0].usage.promptTokens).toBe(100);
    expect(report.steps[0].usage.completionTokens).toBe(50);
    expect(report.steps[0].usage.totalTokens).toBe(150);
    expect(report.steps[0].calls).toBe(3);
  });

  it("accumulates estimated cost across steps in totals", () => {
    tracker.record("summary", "google/gemini-2.5-flash", { promptTokens: 100_000, completionTokens: 10_000 });
    tracker.record("chart_parse", "openai/gpt-4o", { promptTokens: 5_000, completionTokens: 1_000 });

    const report = tracker.getReport();
    const summaryExpected = (100_000 * 0.15 + 10_000 * 0.60) / 1_000_000;
    const chartExpected = (5_000 * 2.50 + 1_000 * 10.00) / 1_000_000;
    expect(report.totals.estimatedCost).toBeCloseTo(summaryExpected + chartExpected, 6);
  });

  it("printSummary runs without error", () => {
    tracker.record("summary", "google/gemini-2.5-flash-lite", { promptTokens: 1000, completionTokens: 200 });
    tracker.record("metadata_base", "google/gemini-2.5-flash", { promptTokens: 2000, completionTokens: 500 });
    expect(() => tracker.printSummary()).not.toThrow();
  });

  // --- Actual cost (from gateway providerMetadata) ---

  it("records actual cost per call", () => {
    tracker.record("summary", "google/gemini-2.5-flash", { promptTokens: 1000, completionTokens: 200 }, 0.0012);

    const report = tracker.getReport();
    expect(report.steps[0].actualCost).toBeCloseTo(0.0012, 6);
  });

  it("accumulates actual cost across multiple calls to same step", () => {
    tracker.record("cluster_parsing", "google/gemini-2.5-flash-lite", { promptTokens: 500 }, 0.001);
    tracker.record("cluster_parsing", "google/gemini-2.5-flash-lite", { promptTokens: 600 }, 0.002);
    tracker.record("cluster_parsing", "google/gemini-2.5-flash-lite", { promptTokens: 400 }, 0.0015);

    const report = tracker.getReport();
    expect(report.steps[0].actualCost).toBeCloseTo(0.0045, 6);
  });

  it("sums actual cost in totals across steps", () => {
    tracker.record("summary", "google/gemini-2.5-flash", { promptTokens: 1000 }, 0.003);
    tracker.record("metadata_base", "google/gemini-2.5-flash", { promptTokens: 2000 }, 0.005);
    tracker.record("chart_parse", "openai/gpt-4o", { promptTokens: 5000 }, 0.012);

    const report = tracker.getReport();
    expect(report.totals.actualCost).toBeCloseTo(0.020, 6);
  });

  it("reports no actualCost when gateway cost not available", () => {
    tracker.record("summary", "google/gemini-2.5-flash", { promptTokens: 1000 });

    const report = tracker.getReport();
    expect(report.steps[0].actualCost).toBeUndefined();
    expect(report.totals.actualCost).toBeUndefined();
  });

  it("handles mix of calls with and without actual cost", () => {
    tracker.record("summary", "google/gemini-2.5-flash", { promptTokens: 1000 }, 0.003);
    tracker.record("summary", "google/gemini-2.5-flash", { promptTokens: 500 }); // no gateway cost

    const report = tracker.getReport();
    // actualCost only includes the call that had it
    expect(report.steps[0].actualCost).toBeCloseTo(0.003, 6);
    expect(report.steps[0].calls).toBe(2);
  });

  it("printSummary shows actual cost when available", () => {
    tracker.record("summary", "google/gemini-2.5-flash", { promptTokens: 1000 }, 0.0042);
    expect(() => tracker.printSummary()).not.toThrow();
  });
});
