import { MODELS } from "@/@types/llm";
import { calculateUsageCost, candidateSlugs } from "@/utils/tokenlens";
import { describe, expect, it } from "vitest";

const ONE_M = 1_000_000;

/**
 * Models that tokenlens (@ v2.0.0-alpha.3) does not have catalog entries for.
 * Calls using these will record cost=$0 with a warn-level log line.
 * Revisit periodically: bump tokenlens and shrink this set.
 */
const KNOWN_ZERO_COST: ReadonlySet<string> = new Set<string>([
  MODELS.GEMINI_1_5_FLASH,
  MODELS.GEMINI_2_0_PRO,
  MODELS.DEEPSEEK_LLAMA_8B,
  MODELS.DEEPSEEK_QWEN_2_5_SMALL,
  MODELS.DEEPSEEK_QWEN_2_5_MEDIUM,
  MODELS.DEEPSEEK_QWEN_2_5_LARGE,
  MODELS.LLAMA_3_2_11B_VISION_INSTRUCT,
  MODELS.LLAMA_3_2_90B_VISION_INSTRUCT,
  MODELS.MAGISTRAL_SMALL_2506,
  MODELS.MAGISTRAL_MEDIUM_2506,
  MODELS.MAGISTRAL_MEDIUM_2506_THINKING,
  MODELS.SONOMA_DUSK_ALPHA,
  MODELS.SONOMA_SKY_ALPHA,
]);

describe("modelPricing", () => {
  it("every priced MODELS enum value returns a non-zero cost via tokenlens", async () => {
    const unexpectedZero: { model: string; tried: string[] }[] = [];
    const surprisingNonZero: string[] = [];
    for (const value of Object.values(MODELS)) {
      const cost = await calculateUsageCost(value, ONE_M, ONE_M);
      if (cost <= 0 && !KNOWN_ZERO_COST.has(value)) {
        unexpectedZero.push({ model: value, tried: candidateSlugs(value) });
      }
      if (cost > 0 && KNOWN_ZERO_COST.has(value)) {
        surprisingNonZero.push(value);
      }
    }
    expect(
      unexpectedZero,
      `Models without pricing — add tokenlens slug fix or move to KNOWN_ZERO_COST: ${JSON.stringify(unexpectedZero, null, 2)}`,
    ).toEqual([]);
    expect(
      surprisingNonZero,
      `Models now have pricing — remove from KNOWN_ZERO_COST: ${surprisingNonZero.join(", ")}`,
    ).toEqual([]);
  }, 30_000);

  it("normalizes common in-the-wild slug variants", async () => {
    const variants = [
      "gemini-2-5-flash", // parse-engine dashed form
      "gemini-2.5-flash", // dotted
      "google/gemini-2.5-flash", // vendor-prefixed
      "gpt-4o-mini",
      "text-embedding-3-small",
      "gemini-embedding-001",
    ];
    for (const slug of variants) {
      const cost = await calculateUsageCost(slug, ONE_M, ONE_M);
      expect(cost, `expected non-zero cost for slug ${slug}`).toBeGreaterThan(0);
    }
  }, 30_000);
});
