// The Worker budget guard (scripts/worker-budget.mjs, run by the admin and portal builds): a bundle fails on its byte ceiling,
// its startup budget (compile + top-level evaluation, a local proxy) or a forbidden module (classic zod, PDF code).
import { describe, expect, it } from "vitest";
import { NO_NETWORK, refuseNetwork, underGlobalScopeRules } from "../../../scripts/cpu-probe-runtime.mjs";
import {
  BUDGETS,
  checkBundle,
  measureStartup,
  SETTLE_LIMIT_MS,
  STARTUP_PROBE,
  startupDate,
} from "../../../scripts/worker-budget.mjs";

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

  it("measures a tiny module well under 10 ms", async () => {
    const ms = await measureStartup(
      "const t = new Map(); for (let i = 0; i < 100; i++) t.set(i, String(i)); export { t };",
      3,
    );
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(10);
  });

  it("measures a bundle that imports WorkerEntrypoint from cloudflare:workers and subclasses it (the admin API since M5.4)", async () => {
    const ms = await measureStartup(
      'import{WorkerEntrypoint as e}from"cloudflare:workers";class t extends e{ping(){return 1}}var n=new Map;export{t as BillingJobs,n as default};',
      2,
    );
    expect(ms).toBeGreaterThanOrEqual(0);
    const spaced = await measureStartup(
      'import { WorkerEntrypoint } from "cloudflare:workers";\nclass A extends WorkerEntrypoint {}\nexport { A };',
      2,
    );
    expect(spaced).toBeGreaterThanOrEqual(0);
  });

  it("refuses any other import from cloudflare:workers (the probe stands in for WorkerEntrypoint only)", async () => {
    await expect(
      measureStartup(
        'import{env as e,WorkerEntrypoint as w}from"cloudflare:workers";class t extends w{}export{t};',
        1,
      ),
    ).rejects.toThrow(/only stands in for WorkerEntrypoint.*env/);
    await expect(
      measureStartup('import { DurableObject } from "cloudflare:workers";export {};', 1),
    ).rejects.toThrow(/DurableObject/);
  });

  it("measures a bundle whose export list is followed by a license comment (the jobs bundle)", async () => {
    const ms = await measureStartup(
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
    async (_where, code) => {
      expect(await measureStartup(code, 2)).toBeGreaterThanOrEqual(0);
    },
  );

  it("still fails a bundle whose export list is not at the end of a line (nothing is silently dropped)", async () => {
    await expect(measureStartup("var t=1;export{t as default};var after=1;", 1)).rejects.toThrow();
  });
});

// CPU warm-up fix round (early check 1a, 2026-11-02): the admin Workers' start-up dry runs go on as microtasks after the module has evaluated, still inside
// workerd's start-up; the probe now waits for the work an entry hands it (`STARTUP_PROBE`), under workerd's global-scope rules.
describe("the start-up probe times the start-up work too", () => {
  /** A bundle whose start-up work spins for `ms` milliseconds after `hops` microtask hops, handed to the probe when `hand` is true. */
  const spinning = (ms: number, hand: boolean, hops = 50) =>
    `const work = (async () => { for (let i = 0; i < ${hops}; i++) await null; const end = performance.now() + ${ms}; while (performance.now() < end) {} return 1; })();
${hand ? `globalThis.${STARTUP_PROBE}?.(work);` : ""}
export { work as default };`;

  it("counts the microtasks of work handed to it", async () => {
    expect(await measureStartup(spinning(40, true), 2)).toBeGreaterThanOrEqual(40);
  });

  it("does not wait for work nobody hands it (the old, synchronous reading)", async () => {
    expect(await measureStartup(spinning(40, false), 2)).toBeLessThan(40);
  });

  it("counts work that ends in a rejection as settled (an entry swallows its own errors)", async () => {
    const code = `const w = (async () => { await null; throw new Error("x"); })(); w.catch(() => {}); globalThis.${STARTUP_PROBE}?.(w); export {};`;
    expect(await measureStartup(code, 1)).toBeGreaterThanOrEqual(0);
  });

  it(
    "fails work that never settles",
    async () => {
      const code = `globalThis.${STARTUP_PROBE}?.(new Promise(() => {})); export {};`;
      await expect(measureStartup(code, 1)).rejects.toThrow(
        new RegExp(`did not settle within ${SETTLE_LIMIT_MS} ms`),
      );
    },
    SETTLE_LIMIT_MS + 5_000,
  );

  it.each([
    ["random values", "crypto.getRandomValues(new Uint8Array(4));"],
    ["a random UUID", "crypto.randomUUID();"],
    ["a timer", "setTimeout(() => {}, 1);"],
    ["fetch", "fetch('https://example.test');"],
    ["a Response with a body", "new Response('x');"],
    ["Response.json", "Response.json({});"],
    ["a Request with a body", "new Request('https://example.test', { method: 'POST', body: 'x' });"],
  ])("applies workerd's global-scope rules: %s at top level fails the bundle", async (_what, line) => {
    await expect(measureStartup(`${line}\nexport {};`, 1)).rejects.toThrow(/Disallowed operation/);
  });

  it("allows what workerd allows at global scope, and its clock reads 0", async () => {
    const code = `new Response(null, { status: 204 }); new Request('https://example.test'); new Headers({ a: '1' });
if (Date.now() !== 0 || new Date().getTime() !== 0) throw new Error("clock");
export {};`;
    expect(await measureStartup(code, 1)).toBeGreaterThanOrEqual(0);
  });

  it("its Date reads like workerd's: Date() without new is a string, new Date(x) unchanged, instanceof and statics kept (review finding 5)", async () => {
    const code = `const s = Date();
if (typeof s !== "string" || s !== new Date(0).toString()) throw new Error("Date() " + s);
if (new Date(86400000).getTime() !== 86400000 || new Date(2026, 0, 1).getFullYear() !== 2026) throw new Error("args");
if (!(new Date() instanceof Date) || Date.UTC(1970, 0, 2) !== 86400000 || Date.parse("1970-01-02T00:00:00Z") !== 86400000) throw new Error("statics");
class Later extends Date {}
if (!(new Later() instanceof Later) || new Later().getTime() !== 0) throw new Error("subclass");
export {};`;
    expect(await measureStartup(code, 1)).toBeGreaterThanOrEqual(0);
  });
});

describe("startupDate, the clock both start-up emulations share (review findings 5 and 6)", () => {
  const D = startupDate(Date);
  it("reads 0 with no argument and is unchanged with one", () => {
    expect(D.now()).toBe(0);
    expect(new D().getTime()).toBe(0);
    expect(new D(5).getTime()).toBe(5);
    expect(new D("1970-01-01T00:00:01Z").getTime()).toBe(1000);
  });
  it("called without new, answers the string of the 0 instant", () => {
    expect((D as unknown as () => string)()).toBe(new Date(0).toString());
  });
  it("keeps instanceof, the statics and subclassing", () => {
    expect(new D()).toBeInstanceOf(Date);
    expect(new Date(1)).toBeInstanceOf(D);
    expect(D.UTC(1970, 0, 1, 0, 0, 1)).toBe(1000);
    class Later extends D {}
    expect(new Later()).toBeInstanceOf(Later);
    expect(new Later().getTime()).toBe(0);
  });
});

describe("the probe's global-scope rules (scripts/cpu-probe-runtime.mjs, review findings 6 and 10)", () => {
  it("new Date() reads 0 under the rules, and the real clock is back afterwards", async () => {
    const seen = await underGlobalScopeRules(async () => [Date.now(), new Date().toISOString()], 0);
    expect(seen).toEqual([0, "1970-01-01T00:00:00.000Z"]);
    expect(Date.now()).toBeGreaterThan(0);
    expect(new Date().toISOString()).not.toBe("1970-01-01T00:00:00.000Z");
  });
  it("refuseNetwork makes fetch refuse for good: during and after the rules", async () => {
    const real = globalThis.fetch;
    try {
      refuseNetwork();
      await expect(fetch("https://example.test")).rejects.toThrow(NO_NETWORK);
      await underGlobalScopeRules(async () => null, 0);
      await expect(fetch("https://example.test")).rejects.toThrow(NO_NETWORK);
    } finally {
      globalThis.fetch = real;
    }
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
