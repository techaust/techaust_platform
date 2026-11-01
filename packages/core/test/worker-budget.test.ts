// The Worker budget guard (scripts/worker-budget.mjs, run by the admin and portal builds): a bundle fails on its byte ceiling,
// its startup budget (compile + top-level evaluation, a local proxy) or a forbidden module (classic zod, PDF code).
import { describe, expect, it } from "vitest";
import { BUDGETS, checkBundle, measureStartup } from "../../../scripts/worker-budget.mjs";

const admin = BUDGETS.admin;
const adminApi = BUDGETS.adminApi;
const ok = { size: 1000, text: "const a = 1;", startupMs: 5 };

describe("admin front and API budgets (M5.0)", () => {
  it("the front stays small and the API has room for M5 to M7", () => {
    expect(admin.maxBytes).toBe(150_000);
    expect(adminApi.maxBytes).toBe(800_000);
    expect(adminApi.maxStartupMs).toBe(200);
  });

  it.each(["auth_attempts", "totp_secret_enc", "pw_hmac"])(
    "fails sign-in code (%s) in the API bundle only",
    (name) => {
      const text = `db.prepare("${name}")`;
      expect(checkBundle({ ...ok, text }, adminApi)[0]).toMatch(/sign-in code/);
      expect(checkBundle({ ...ok, text }, admin)).toEqual([]);
    },
  );
});

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

  it("measures a bundle that imports WorkerEntrypoint from cloudflare:workers and subclasses it (the admin API since M5.4)", () => {
    const ms = measureStartup(
      'import{WorkerEntrypoint as e}from"cloudflare:workers";class t extends e{ping(){return 1}}var n=new Map;export{t as BillingJobs,n as default};',
      2,
    );
    expect(ms).toBeGreaterThanOrEqual(0);
    const spaced = measureStartup(
      'import { WorkerEntrypoint } from "cloudflare:workers";\nclass A extends WorkerEntrypoint {}\nexport { A };',
      2,
    );
    expect(spaced).toBeGreaterThanOrEqual(0);
  });

  it("refuses any other import from cloudflare:workers (the probe stands in for WorkerEntrypoint only)", () => {
    expect(() =>
      measureStartup(
        'import{env as e,WorkerEntrypoint as w}from"cloudflare:workers";class t extends w{}export{t};',
        1,
      ),
    ).toThrow(/only stands in for WorkerEntrypoint.*env/);
    expect(() => measureStartup('import { DurableObject } from "cloudflare:workers";export {};', 1)).toThrow(
      /DurableObject/,
    );
  });

  it("measures a bundle whose export list is followed by a license comment (the jobs bundle)", () => {
    const ms = measureStartup(
      "const t = 1;\nexport {\n  t as default\n};\n/*! Bundled license information:\n  (** @license MIT *)\n*/\n//# sourceMappingURL=index.js.map",
      2,
    );
    expect(ms).toBeGreaterThanOrEqual(0);
  });

  it.each([
    [
      "on its own line",
      "var t=1,n=2;export{t as GatewayEvents,n as default};\n//# sourceMappingURL=index.js.map\n",
    ],
    ["straight after the list", "var t=1;export{t as default};//# sourceMappingURL=index.js.map"],
  ])(
    "measures a minified bundle with a source-map comment %s after the export list (L9, the jobs Worker)",
    (_where, code) => {
      expect(measureStartup(code, 2)).toBeGreaterThanOrEqual(0);
    },
  );

  it("still fails a bundle whose export list is not at the end of a line (nothing is silently dropped)", () => {
    expect(() => measureStartup("var t=1;export{t as default};var after=1;", 1)).toThrow();
  });
});

describe("the GST core is SPA only (M5.5b, LD16)", () => {
  it.each(["gstr1-csv-v1", "GSTIN/UIN of Recipient", "sales-register-v1"])(
    "fails a bundle that contains %s, in every Worker",
    (marker) => {
      const text = `const x = { "${marker}": 1 };`;
      for (const budget of [BUDGETS.admin, BUDGETS.adminApi, BUDGETS.portal, BUDGETS.jobs]) {
        expect(checkBundle({ ...ok, text }, budget)[0], marker).toMatch(/@techaust\/core\/gst/);
      }
    },
  );

  it("does not fire on the Workers' own SQL and readers", () => {
    const text = "SELECT d.id FROM documents d; const reader = realisationParamsFromStoredTax;";
    for (const budget of [BUDGETS.admin, BUDGETS.adminApi, BUDGETS.portal, BUDGETS.jobs]) {
      expect(checkBundle({ ...ok, text }, budget)).toEqual([]);
    }
  });
});

describe("the jobs budget (M4.4)", () => {
  const jobs = BUDGETS.jobs;

  it("allows the PDF fonts, which admin and portal must never carry", () => {
    const text = 'const TECHAUST_PDF_FONT_DATA = "@font-face{}";';
    expect(checkBundle({ ...ok, text }, jobs)).toEqual([]);
    expect(checkBundle({ ...ok, text }, BUDGETS.admin)[0]).toMatch(/PDF font data/);
    expect(checkBundle({ ...ok, text }, BUDGETS.portal)[0]).toMatch(/PDF font data/);
  });

  it("checks the bundle's inputs from the metafile, which survive minification (L9)", () => {
    expect(
      checkBundle({ ...ok, text: "", inputs: ["src/index.ts", "../../packages/core/src/money.ts"] }, jobs),
    ).toEqual([]);
    for (const [input, name] of [
      ["../../node_modules/.pnpm/pdf-lib@1.17.1/node_modules/pdf-lib/es/index.js", /pdf-lib/],
      [
        "../../node_modules/.pnpm/@cloudflare+puppeteer@1.0.0/node_modules/@cloudflare/puppeteer/lib/esm/index.js",
        /puppeteer/,
      ],
      ["..\\..\\packages\\core\\src\\gst\\index.ts", /gst/],
    ] as const) {
      expect(checkBundle({ ...ok, text: "", inputs: [input] }, jobs)[0]).toMatch(name);
    }
  });

  it("still finds the PDF fonts in a minified bundle, where the constant's name is gone (L9)", () => {
    const text = 'const a="@font-face{src:url(data:font/woff2;base64,d09GMgAB)}";';
    expect(checkBundle({ ...ok, text }, jobs)).toEqual([]);
    expect(checkBundle({ ...ok, text }, BUDGETS.admin)[0]).toMatch(/PDF font data/);
    expect(checkBundle({ ...ok, text }, BUDGETS.adminFinance)[0]).toMatch(/PDF font data/);
    expect(checkBundle({ ...ok, text }, BUDGETS.portal)[0]).toMatch(/PDF font data/);
  });

  it("forbids pdf-lib and puppeteer, and has the same startup ceiling", () => {
    expect(checkBundle({ ...ok, text: "new PDFDocument()" }, jobs)[0]).toMatch(/pdf-lib/);
    expect(checkBundle({ ...ok, text: 'import "@cloudflare/puppeteer"' }, jobs)[0]).toMatch(/puppeteer/);
    expect(jobs.maxStartupMs).toBe(200);
  });

  it("fails over its byte ceiling and its startup budget", () => {
    expect(checkBundle({ ...ok, size: jobs.maxBytes + 1 }, jobs)).toHaveLength(1);
    expect(checkBundle({ ...ok, startupMs: 201 }, jobs)).toHaveLength(1);
  });
});
