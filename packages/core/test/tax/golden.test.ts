// The golden table [ADM-INV-05]: hand-computed cases, run one by one. The table itself is golden-cases.ts.
import { describe, expect, it } from "vitest";
import { GOLDEN } from "./golden-cases.ts";

describe("tax engine: golden cases (hand-computed)", () => {
  it("has at least 70 cases with unique names", () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(70);
    expect(new Set(GOLDEN.map((c) => c.name)).size).toBe(GOLDEN.length);
  });

  it.each(GOLDEN.map((c) => [c.name, c.check] as const))("%s", (_name, check) => {
    check();
  });
});
