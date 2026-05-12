import { MODELS } from "@/@types/llm";
import { TOKENLENS_MODEL_MAPPING } from "@/utils/tokenlens";
import { describe, expect, it } from "vitest";

describe("modelPricing", () => {
  it("every MODELS enum value has a tokenlens mapping", () => {
    const missing: string[] = [];
    for (const value of Object.values(MODELS)) {
      if (!TOKENLENS_MODEL_MAPPING[value]) {
        missing.push(value);
      }
    }
    expect(missing).toEqual([]);
  });
});
