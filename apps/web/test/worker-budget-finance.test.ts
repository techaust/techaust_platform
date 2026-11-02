// The admin finance and invoices Workers' budgets (M6.1 stage A, ADM-PAY-01; the fourth admin Worker, 2026-11-03, ADM-G-02, L3, L4; scripts/worker-budget.mjs):
// their own ceilings, plan lines and startup limits, and the markers that keep each Worker's code where it belongs: INVOICE_CODE (the invoice chain) out of
// the API and finance Workers, ADVANCE_CODE (the automatic advance) out of finance, GATEWAY_CODE (the gateway clients) out of the front, API and invoices
// Workers. An import cut undone fails the admin build. The other budgets are tested in packages/core/test/worker-budget.test.ts. Runs in Node; the marker
// tests read the built finance bundle when one is there (a fresh checkout has none, and CI builds before it tests).
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADVANCE_CODE,
  BUDGETS,
  checkBundle,
  GATEWAY_CODE,
  INVOICE_CODE,
  planNote,
} from "../../../scripts/worker-budget.mjs";

const ok = { size: 1000, text: "const a = 1;", startupMs: 5 };
const finance = BUDGETS.adminFinance;
const invoices = BUDGETS.adminInvoices;
const api = BUDGETS.adminApi;
const front = BUDGETS.admin;
const names = (b: { forbidden: { name: string }[] }) => b.forbidden.map((f) => f.name);

describe("the admin finance Worker budget (M6.1 stage A; the payments side since the fourth admin Worker)", () => {
  it("reads the finance bundle, with an 800,000 ceiling, a 500,000 plan line (L4) and 200 ms startup", () => {
    expect(finance.file).toBe("apps/admin/dist/techaust_platform_admin_finance/index.js");
    expect(finance.maxBytes).toBe(800_000);
    expect(finance.planBytes).toBe(500_000);
    expect(finance.maxStartupMs).toBe(200);
  });

  it("forbids what the API Worker forbids except the gateway clients it exists for, and the automatic advance too", () => {
    expect(names(finance)).toEqual([
      ...api.forbidden.filter((f) => f !== GATEWAY_CODE).map((f) => f.name),
      ADVANCE_CODE.name,
    ]);
    expect(finance.forbidden).toContain(INVOICE_CODE);
    expect(finance.forbidden).toContain(ADVANCE_CODE);
    expect(finance.forbidden).not.toContain(GATEWAY_CODE);
  });

  it.each(["This kind of invoice can't be issued yet", "The owner issues an invoice directly"])(
    "fails the API and finance bundles that hold the invoice code (%s), and passes the invoices bundle",
    (line) => {
      const text = `const e={code:"x",message:"${line}"};`;
      for (const b of [api, finance])
        expect(checkBundle({ ...ok, text }, b)).toEqual([
          `the invoice code (the admin invoices Worker only, M6.1; the fourth admin Worker) is in the Worker bundle (${line})`,
        ]);
      expect(checkBundle({ ...ok, text }, invoices)).toEqual([]);
    },
  );

  it("fails the finance bundle that holds the automatic advance; the invoices bundle carries it", () => {
    const text = 'action:"invoice.advance_issue_auto"';
    expect(checkBundle({ ...ok, text }, finance)[0]).toMatch(/the automatic advance/);
    expect(checkBundle({ ...ok, text }, invoices)).toEqual([]);
  });

  it("the markers are the modules' own strings (a renamed line would silently disarm the guard)", () => {
    const model = readFileSync(new URL("../../admin/worker/invoice-model.ts", import.meta.url), "utf8");
    expect(model).toContain('"This kind of invoice can\'t be issued yet"');
    expect(model).toContain('"The owner issues an invoice directly"');
    const advance = readFileSync(new URL("../../admin/worker/gateway/advance.ts", import.meta.url), "utf8");
    expect(advance).toContain('"invoice.advance_issue_auto"');
    // Only advance.ts holds the advance's audit action among the admin Worker sources.
    for (const f of [
      "invoice-advance.ts",
      "gateway/settle.ts",
      "gateway/routes.ts",
      "gateway/advance-rpc.ts",
    ]) {
      const text = readFileSync(new URL(`../../admin/worker/${f}`, import.meta.url), "utf8");
      expect(ADVANCE_CODE.re.test(text), f).toBe(false);
    }
  });

  it("fails sign-in code in the finance bundle", () => {
    expect(checkBundle({ ...ok, text: 'db.prepare("auth_attempts")' }, finance)[0]).toMatch(/sign-in code/);
  });

  it("notes a bundle past its plan line without failing it; budgets without a plan line never note", () => {
    expect(planNote(500_000, finance)).toBeNull();
    expect(planNote(500_001, finance)).toMatch(/500001 bytes, past its plan line of 500000/);
    expect(checkBundle({ ...ok, size: 500_001 }, finance)).toEqual([]);
    expect(checkBundle({ ...ok, size: 800_001 }, finance)[0]).toMatch(/limit is 800000/);
    expect(planNote(799_999, api)).toBeNull();
  });
});

describe("the admin invoices Worker budget (the fourth admin Worker, L4)", () => {
  it("reads the invoices bundle, with an 800,000 ceiling, a 650,000 plan line and 200 ms startup", () => {
    expect(invoices.file).toBe("apps/admin/dist/techaust_platform_admin_invoices/index.js");
    expect(invoices.maxBytes).toBe(800_000);
    expect(invoices.planBytes).toBe(650_000);
    expect(invoices.maxStartupMs).toBe(200);
    expect(planNote(650_001, invoices)).toMatch(/650001 bytes, past its plan line of 650000/);
  });

  it("forbids what the API Worker forbids, except the invoice code it exists for", () => {
    expect(names(invoices)).toEqual(api.forbidden.filter((f) => f !== INVOICE_CODE).map((f) => f.name));
    expect(invoices.forbidden).toContain(GATEWAY_CODE);
    expect(invoices.forbidden).not.toContain(INVOICE_CODE);
  });
});

describe("the gateway client marker (the fourth admin Worker, L3)", () => {
  it.each([
    "https://api.razorpay.com",
    "https://api.stripe.com",
    "https://api-m.paypal.com",
    "https://api-m.sandbox.paypal.com",
    'call("POST","/v1/payment_links",b)',
    'call("POST","/v2/checkout/orders",b)',
  ])("fails the front, API and invoices bundles that hold %s, and passes the finance bundle", (s) => {
    const text = `var x=\`${s}\`;`;
    for (const b of [front, api, invoices])
      expect(checkBundle({ ...ok, text }, b)[0]).toMatch(/gateway client code/);
    expect(checkBundle({ ...ok, text }, finance)).toEqual([]);
  });

  it("never matches the gateway wording the invoices Worker carries with the advance (messages.ts, reasons.ts, consts.ts)", () => {
    for (const f of ["messages.ts", "reasons.ts", "consts.ts"]) {
      const text = readFileSync(new URL(`../../admin/worker/gateway/${f}`, import.meta.url), "utf8");
      expect(GATEWAY_CODE.re.test(text), f).toBe(false);
    }
  });

  const built = new URL("../../admin/dist/techaust_platform_admin_finance/index.js", import.meta.url);
  it.skipIf(!existsSync(built))(
    "matches the built finance bundle (the markers come from the bundle, brief D.1)",
    () => {
      const text = readFileSync(built, "utf8");
      expect(GATEWAY_CODE.re.test(text)).toBe(true);
    },
  );
});

describe("the admin build checks the four admin Workers", () => {
  it("runs the budget on admin, adminApi, adminFinance and adminInvoices after vite build", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../admin/package.json", import.meta.url), "utf8"));
    const build: string = pkg.scripts.build;
    expect(build.startsWith("vite build")).toBe(true);
    for (const b of ["admin", "adminApi", "adminFinance", "adminInvoices"])
      expect(build).toContain(`node ../../scripts/worker-budget.mjs ${b}`);
  });
});
