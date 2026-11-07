// M7.5 B2: parity of the route inventory's parser (scripts/route-inventory-lib.mjs) with the portal Worker's real ROUTES table.
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import { portalRows } from "../../../scripts/route-inventory-lib.mjs";
import { ROUTES } from "./guard.ts";
import guardText from "./guard.ts?raw";

describe("route inventory parity: portal (M7.5 B2)", () => {
  it("the parser reads exactly the ROUTES table", () => {
    const parsed = (portalRows(guardText) as { method: string; path: string; permission: string }[])
      .map((r) => `${r.method} ${r.path} ${r.permission}`)
      .sort();
    const real = ROUTES.map((r) => `${r.method} ${r.path} ${String(r.access)}`).sort();
    expect(parsed).toEqual(real);
    expect(parsed.length).toBeGreaterThan(30);
  });
});
