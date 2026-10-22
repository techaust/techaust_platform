// /favicon.ico is a byte-for-byte copy of the generated brand file (never hand-made, CLAUDE.md "Brand"). After
// `pnpm --filter @techaust/ui build:brand`, copy packages/ui/brand/favicon.ico to apps/web/public/ again.
// Runs in Node (it reads files); keep it out of a workerd test pool.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("favicon.ico", () => {
  it("matches the generated brand file", () => {
    const brand = readFileSync(new URL("../../../packages/ui/brand/favicon.ico", import.meta.url));
    const site = readFileSync(new URL("../public/favicon.ico", import.meta.url));
    expect(site.equals(brand)).toBe(true);
  });
});
