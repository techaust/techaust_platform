import { describe, expect, it } from "vitest";
import { warmConsumers } from "../src/warm.ts";

// The consumers' start-up warm-up (CPU tuning) runs inside workerd: every sample parses and both templates render.
describe("jobs start-up warm-up", () => {
  it("parses 3 samples and renders 2 emails", () => {
    expect(warmConsumers()).toBe(5);
  });
});
