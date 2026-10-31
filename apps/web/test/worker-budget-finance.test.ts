// The admin finance Worker's budget (M6.1 stage A, ADM-PAY-01; scripts/worker-budget.mjs): its own ceiling, plan line and startup limit, the
// same forbidden modules as the API Worker, and the INVOICE_CODE marker that keeps the invoice chain out of the API Worker (an import cut undone
// fails the admin build). The other budgets are tested in packages/core/test/worker-budget.test.ts. Runs in Node (no bundle is read here).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUDGETS, checkBundle, INVOICE_CODE, planNote } from "../../../scripts/worker-budget.mjs";

const ok = { size: 1000, text: "const a = 1;", startupMs: 5 };
const finance = BUDGETS.adminFinance;
const api = BUDGETS.adminApi;

describe("the admin finance Worker budget (M6.1 stage A)", () => {
  it("reads the finance bundle, with an 800,000 ceiling, a 650,000 plan line and 200 ms startup", () => {
    expect(finance.file).toBe("apps/admin/dist/techaust_platform_admin_finance/index.js");
    expect(finance.maxBytes).toBe(800_000);
    expect(finance.planBytes).toBe(650_000);
    expect(finance.maxStartupMs).toBe(200);
  });

  it("forbids what the API Worker forbids, except the invoice code it exists for", () => {
    expect(finance.forbidden.map((f) => f.name)).toEqual(
      api.forbidden.filter((f) => f !== INVOICE_CODE).map((f) => f.name),
    );
    expect(finance.forbidden).not.toContain(INVOICE_CODE);
    expect(api.forbidden).toContain(INVOICE_CODE);
  });

  it.each(["This kind of invoice can't be issued yet", "The owner issues an invoice directly"])(
    "fails the API bundle that holds the invoice code (%s), and passes the finance bundle",
    (line) => {
      const text = `const e={code:"x",message:"${line}"};`;
      expect(checkBundle({ ...ok, text }, api)).toEqual([
        `the invoice code (the admin finance Worker only, M6.1) is in the Worker bundle (${line})`,
      ]);
      expect(checkBundle({ ...ok, text }, finance)).toEqual([]);
    },
  );

  it("the markers are the invoice model's own error lines (a renamed line would silently disarm the guard)", () => {
    const model = readFileSync(new URL("../../admin/worker/invoice-model.ts", import.meta.url), "utf8");
    expect(model).toContain('"This kind of invoice can\'t be issued yet"');
    expect(model).toContain('"The owner issues an invoice directly"');
  });

  it("fails sign-in code in the finance bundle", () => {
    expect(checkBundle({ ...ok, text: 'db.prepare("auth_attempts")' }, finance)[0]).toMatch(/sign-in code/);
  });

  it("notes a bundle past its plan line without failing it; budgets without a plan line never note", () => {
    expect(planNote(650_000, finance)).toBeNull();
    expect(planNote(650_001, finance)).toMatch(/650001 bytes, past its plan line of 650000/);
    expect(checkBundle({ ...ok, size: 650_001 }, finance)).toEqual([]);
    expect(checkBundle({ ...ok, size: 800_001 }, finance)[0]).toMatch(/limit is 800000/);
    expect(planNote(799_999, api)).toBeNull();
  });
});

describe("the admin build checks the three admin Workers", () => {
  it("runs the budget on admin, adminApi and adminFinance after vite build", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../admin/package.json", import.meta.url), "utf8"));
    const build: string = pkg.scripts.build;
    expect(build.startsWith("vite build")).toBe(true);
    for (const b of ["admin", "adminApi", "adminFinance"])
      expect(build).toContain(`node ../../scripts/worker-budget.mjs ${b}`);
  });
});
