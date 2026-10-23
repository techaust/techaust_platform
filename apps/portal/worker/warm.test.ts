import { warmPortalAuth } from "@techaust/auth";
import { describe, expect, it } from "vitest";

// The portal's start-up warm-up runs inside workerd (the start-up rules themselves are tested in packages/auth).
describe("portal start-up warm-up", () => {
  it("works in workerd: all 9 steps", async () => {
    expect(await warmPortalAuth()).toBe(9);
  });
});
