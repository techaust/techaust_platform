// The Worker budget guard (scripts/worker-budget.mjs, run by the admin and portal builds): a bundle fails on its byte ceiling,
// its startup budget (compile + top-level evaluation, a local proxy) or a forbidden module (classic zod, PDF code).
import { describe, expect, it } from "vitest";
import { BUDGETS, checkBundle, measureStartup } from "../../../scripts/worker-budget.mjs";

const admin = BUDGETS.admin;
const ok = { size: 1000, text: "const a = 1;", startupMs: 5 };

describe("worker budget", () => {
  it("passes a small, clean bundle", () => {
    expect(checkBundle(ok, admin)).toEqual([]);
  });

  it("fails over the byte ceiling", () => {
    expect(checkBundle({ ...ok, size: admin.maxBytes + 1 }, admin)).toHaveLength(1);
  });

  it("fails over the startup budget", () => {
    expect(checkBundle({ ...ok, startupMs: 250 }, admin)[0]).toMatch(/startup is 250\.0 ms/);
  });

  it("fails on classic zod but not on zod/mini's $-prefixed names", () => {
    expect(checkBundle({ ...ok, text: 'x("ZodNumber")' }, admin)[0]).toMatch(/classic zod/);
    expect(checkBundle({ ...ok, text: 'x("$ZodNumber")' }, admin)).toEqual([]);
  });

  it("fails on PDF code in the admin and portal Workers", () => {
    expect(checkBundle({ ...ok, text: "new PDFDocument()" }, admin)[0]).toMatch(/pdf-lib/);
    expect(checkBundle({ ...ok, text: 'import "@cloudflare/puppeteer"' }, BUDGETS.portal)[0]).toMatch(
      /puppeteer/,
    );
  });

  it("measures a tiny module well under 10 ms", () => {
    const ms = measureStartup(
      "const t = new Map(); for (let i = 0; i < 100; i++) t.set(i, String(i)); export { t };",
      3,
    );
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(10);
  });
});
