import { describe, expect, it } from "vitest";
import { portalWarm } from "./warm.ts";

// The portal's start-up warm-up runs inside workerd (the start-up rules themselves are tested in packages/auth).
describe("portal start-up warm-up", () => {
  it("works in workerd: all 11 steps", async () => {
    expect(await portalWarm).toBe(11);
  });

  it("is imported by the Worker entry at module level, so it runs at isolate start-up", () => {
    const files = import.meta.glob("./index.ts", { query: "?raw", import: "default", eager: true });
    expect(files["./index.ts"]).toMatch(/^import "\.\/warm\.ts";/m);
  });
});
