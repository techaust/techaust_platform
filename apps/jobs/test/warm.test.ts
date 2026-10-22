import { describe, expect, it, vi } from "vitest";
import { warmConsumers, warmSes } from "../src/warm.ts";

// The consumers' start-up warm-up (CPU tuning) runs inside workerd: every sample parses and both templates render.
describe("jobs start-up warm-up", () => {
  it("parses 3 samples and renders 2 emails", () => {
    expect(warmConsumers()).toBe(5);
  });

  it("signs a made-up SES request in workerd and sends nothing", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    try {
      expect(await warmSes()).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
