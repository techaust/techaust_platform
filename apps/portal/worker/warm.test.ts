import { samplePath, warmRouter } from "@techaust/auth";
import { describe, expect, it } from "vitest";
import { ROUTES } from "./guard.ts";
import { createApp } from "./index.ts";
import { portalRowsWarm, portalWarm, warmPortalRows } from "./warm.ts";

// The portal's start-up warm-up runs inside workerd (the start-up rules themselves are tested in packages/auth).
describe("portal start-up warm-up", () => {
  it("works in workerd: all 11 steps", async () => {
    expect(await portalWarm).toBe(11);
  });

  it("is imported by the Worker entry at module level, so it runs at isolate start-up", () => {
    const files = import.meta.glob("./index.ts", { query: "?raw", import: "default", eager: true });
    expect(files["./index.ts"]).toMatch(/^import "\.\/warm\.ts";/m);
  });

  it("M7.1 J: the new schemas, rules and row mappers: all 16 steps, at module level", () => {
    expect(portalRowsWarm).toBe(16);
    expect(warmPortalRows()).toBe(16);
  });

  it("M7.1 J (L19): the router warm-up matches every ROUTES row through the real app, and the entry runs it at module level", () => {
    expect(warmRouter(createApp(), ROUTES)).toBe(ROUTES.length);
    for (const r of ROUTES) expect(samplePath(r.path)).not.toMatch(/:/);
    const files = import.meta.glob("./index.ts", { query: "?raw", import: "default", eager: true });
    expect(files["./index.ts"]).toMatch(/^warmRouter\(app, ROUTES\);$/m);
  });

  it("M7.1 J: no `import()` in the Worker's own files (it would move module work into the metered request)", () => {
    const files = import.meta.glob("./*.ts", { query: "?raw", import: "default", eager: true }) as Record<
      string,
      string
    >;
    for (const [name, text] of Object.entries(files)) {
      if (/\.test\.ts$|test-helpers|fixtures|test-setup|\.d\.ts$/.test(name)) continue;
      expect(text, name).not.toMatch(/\bimport\(\s*["'`]/);
      // M7.1 (run file C): no `@techaust/pdf` import in the new portal files (40 KB the portal does not carry).
      if (
        [
          "./home.ts",
          "./projects.ts",
          "./shared.ts",
          "./files.ts",
          "./receipts.ts",
          "./profile.ts",
          "./requests.ts",
          "./paid-notice.ts",
        ].includes(name)
      )
        expect(text, name).not.toMatch(/@techaust\/pdf/);
    }
  });
});
