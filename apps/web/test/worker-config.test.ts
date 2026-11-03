// Worker configuration guards. Runs in Node (it reads files).
//  - L1 (audit 2026-10-22): only the routes the Worker implements run it; junk /api paths get the static 404.
//  - M1: the preview-URL guard (scripts/check-worker-config.mjs) fails on a config that lets Preview URLs through.
//  - M2.4: the no-data-bindings guard (scripts/check-web-bindings.mjs) still rejects D1/R2/KV/DO/Hyperdrive, and the
//    form bindings (queue, rate limiter, secrets) are declared where the staging deploy needs them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as bindingGuard from "../../../scripts/check-web-bindings.mjs";
// @ts-expect-error plain .mjs without types
import * as guard from "../../../scripts/check-worker-config.mjs";
import app from "../src/worker.ts";

const config = guard.parseJsonc(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const patterns: string[] = config.assets.run_worker_first;

/** Does an assets `run_worker_first` pattern (a literal path or a trailing `/*`) match this path? */
const matches = (pattern: string, path: string) =>
  pattern.endsWith("/*") ? path.startsWith(pattern.slice(0, -1)) : path === pattern;

describe("web run_worker_first (audit L1)", () => {
  it("does not send every /api path to the Worker", () => {
    expect(patterns).not.toContain("/api/*");
    expect(patterns).toEqual(["/api/geo", "/api/forms/*"]);
  });

  it("covers every route the Worker implements", () => {
    const routes = app.routes.filter((r) => r.method !== "ALL");
    const all = app.routes.map((r) => r.path);
    expect(all).toContain("/api/forms/:kind");
    for (const r of [...routes, ...app.routes.filter((x) => x.path.startsWith("/api/forms"))]) {
      const sample = r.path.replace(/\*$/, "x");
      expect(
        patterns.some((p) => matches(p, sample)),
        `${r.method} ${r.path} must be in run_worker_first`,
      ).toBe(true);
    }
  });

  it.each(["/api/nope", "/api/x", "/api", "/api/geo2", "/api/form/x"])(
    "%s is served by assets, not the Worker",
    (path) => {
      expect(patterns.some((p) => matches(p, path))).toBe(false);
    },
  );
});

describe("web binding guard (docs/05 §1.1)", () => {
  it("the real config declares no data bindings", () => {
    expect(
      bindingGuard.findForbidden(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")),
    ).toEqual([]);
  });

  it.each(["d1_databases", "r2_buckets", "kv_namespaces", "durable_objects", "hyperdrive"])(
    "still rejects %s",
    (key) => {
      expect(bindingGuard.findForbidden(`{ "${key}": [] }`)).toEqual([key]);
    },
  );

  it("allows queues, rate limits and secrets", () => {
    expect(
      bindingGuard.findForbidden('{ "queues": {}, "ratelimits": [], "secrets": { "required": ["X"] } }'),
    ).toEqual([]);
  });
});

describe("form bindings (M2.4)", () => {
  it("top level and staging declare the queue, the rate limiter and both secrets; production has none", () => {
    for (const scope of [config, config.env.staging]) {
      expect(scope.queues.producers[0].binding).toBe("LEADS_QUEUE");
      expect(scope.ratelimits[0]).toMatchObject({ name: "RL_FORMS", simple: { limit: 2, period: 60 } });
      expect(scope.secrets.required).toEqual(["TURNSTILE_SECRET", "FORMS_IP_PEPPER"]);
    }
    expect(config.env.staging.queues.producers[0].queue).toBe("techaust-staging-leads");
    expect(config.env.production.queues).toBeUndefined();
  });
});

describe("preview-URL guard (audit M1)", () => {
  const off = { preview_urls: false };

  it("passes a config that is off at every level", () => {
    expect(guard.missingPreviewOff({ ...off, env: { staging: off, production: off } })).toEqual([]);
  });

  it("fails when the top level, staging or production is missing or true", () => {
    expect(guard.missingPreviewOff({ env: { staging: off, production: off } })).toEqual(["(top level)"]);
    expect(
      guard.missingPreviewOff({ ...off, env: { staging: { preview_urls: true }, production: off } }),
    ).toEqual(["env.staging"]);
    expect(guard.missingPreviewOff({ ...off, env: { staging: off } })).toEqual(["env.production"]);
    expect(guard.missingPreviewOff({})).toEqual(["(top level)", "env.staging", "env.production"]);
  });

  it.each(["admin", "portal", "web", "jobs"])("the real %s config passes", (name) => {
    const real = guard.parseJsonc(
      readFileSync(new URL(`../../${name}/wrangler.jsonc`, import.meta.url), "utf8"),
    );
    expect(guard.missingPreviewOff(real)).toEqual([]);
  });

  it("parses comments, trailing commas and strings holding slashes", () => {
    expect(guard.parseJsonc('{ // c\n "a": "http://x//y", /* b */ "b": [1,],\n}')).toEqual({
      a: "http://x//y",
      b: [1],
    });
  });
});

describe("admin API Worker config guard (M5.0)", () => {
  const read = (p: string) =>
    guard.parseJsonc(readFileSync(new URL(`../../admin/${p}`, import.meta.url), "utf8"));
  const api = read("wrangler.api.jsonc");
  const front = read("wrangler.jsonc");
  const clone = () => structuredClone(api);

  it("the real configs pass", () => {
    expect(guard.apiConfigProblems(api, front)).toEqual([]);
    expect(guard.frontServiceProblems(front, api)).toEqual([]);
    expect(guard.missingPreviewOff(api)).toEqual([]);
  });

  it("fails workers_dev true", () => {
    const c = clone();
    c.env.staging.workers_dev = true;
    expect(guard.apiConfigProblems(c, front)).toEqual(["env.staging: workers_dev must be false"]);
  });

  it.each(["routes", "route", "assets", "previews", "secrets"])("fails a %s entry", (key) => {
    const c = clone();
    c[key] = key === "routes" ? [{ pattern: "x.example/*", zone_name: "example" }] : {};
    expect(guard.apiConfigProblems(c, front)).toEqual([
      `(top level): ${key} is not allowed on the API Worker`,
    ]);
  });

  it("fails preview_urls true", () => {
    const c = clone();
    c.preview_urls = true;
    expect(guard.apiConfigProblems(c, front)).toEqual(["(top level): preview_urls must be false"]);
  });

  it("fails a bucket or database that differs from the front's", () => {
    const c = clone();
    c.env.staging.r2_buckets[0].bucket_name = "other";
    c.env.staging.d1_databases[0].database_id = "other";
    expect(guard.apiConfigProblems(c, front)).toEqual([
      "env.staging: d1_databases differ from the front's",
      "env.staging: r2_buckets differ from the front's",
    ]);
  });

  it("fails a queue that differs from the front's", () => {
    const c = clone();
    c.env.staging.queues.producers[0].queue = "other";
    expect(guard.apiConfigProblems(c, front)).toEqual(["env.staging: queues differ from the front's"]);
  });

  it("fails a name equal to the front's", () => {
    const c = clone();
    c.env.staging.name = front.env.staging.name;
    expect(guard.apiConfigProblems(c, front)).toEqual(["env.staging: name must differ from the front's"]);
  });

  it("fails a var that differs from the front's", () => {
    const c = clone();
    c.env.staging.vars.PAYMENTS_LIVE_ALLOWED = "true";
    expect(guard.apiConfigProblems(c, front)).toEqual([
      "env.staging: var PAYMENTS_LIVE_ALLOWED differs from the front's",
    ]);
  });

  it("fails a compatibility date or flags that differ from the front's", () => {
    const c = clone();
    c.compatibility_date = "2026-01-01";
    c.compatibility_flags = [];
    expect(guard.apiConfigProblems(c, front)).toEqual([
      "(top level): compatibility_date differs from the front's",
      "(top level): compatibility_flags differ from the front's",
    ]);
  });

  it("fails a front without the staging service binding, or pointing at the wrong Worker", () => {
    const f = structuredClone(front);
    f.env.staging.services = undefined;
    expect(guard.frontServiceProblems(f, api)).toEqual([
      "env.staging: the ADMIN_API service binding is missing",
    ]);
    const g = structuredClone(front);
    g.env.staging.services[0].service = "techaust-platform-admin-api";
    expect(guard.frontServiceProblems(g, api)).toEqual([
      "env.staging: ADMIN_API points at techaust-platform-admin-api, expected techaust-platform-admin-api-staging",
    ]);
  });
});

describe("jobs Worker config guard (M5.4, LD57, LD61)", () => {
  const read = (p: string) => guard.parseJsonc(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8"));
  // M6.1 stage A: the BillingJobs entrypoint was exported by the admin finance Worker; since the fourth admin Worker (2026-11-03) by the invoices Worker.
  const invoices = read("admin/wrangler.invoices.jsonc");
  const jobs = read("jobs/wrangler.jsonc");

  it("the real config passes: both crons and the BillingJobs binding at the top level and in staging, neither in production", () => {
    expect(guard.JOBS_CRONS).toEqual(["0 22 * * *", "30 * * * *"]);
    expect(guard.jobsConfigProblems(jobs, invoices)).toEqual([]);
    // FX-1 (A6 3): triggers are inherited, so production states an empty list.
    expect(jobs.env.production.triggers).toEqual({ crons: [] });
    expect(jobs.env.production.services).toBeUndefined();
  });

  it("production without its own triggers would inherit the crons: refused (FX-1, A6 3)", () => {
    const d = structuredClone(jobs);
    d.env.production.triggers = undefined;
    expect(guard.jobsConfigProblems(d, invoices)).toEqual([
      'env.production: needs "triggers": { "crons": [] } (an environment without its own triggers inherits the top level\'s)',
    ]);
  });

  it("fails a missing hourly cron, a missing or mispointed binding or entrypoint, and anything in production", () => {
    const a = structuredClone(jobs);
    a.env.staging.triggers.crons = ["0 22 * * *"];
    expect(guard.jobsConfigProblems(a, invoices)).toEqual([
      'env.staging: crons must be exactly ["0 22 * * *","30 * * * *"]',
    ]);
    const b = structuredClone(jobs);
    b.env.staging.services = undefined;
    b.services[0].service = "techaust-platform-admin-invoices-staging";
    b.services[0].entrypoint = "default";
    expect(guard.jobsConfigProblems(b, invoices)).toEqual([
      "(top level): ADMIN_JOBS points at techaust-platform-admin-invoices-staging, expected techaust-platform-admin-invoices",
      "(top level): ADMIN_JOBS must name the entrypoint BillingJobs",
      "env.staging: the ADMIN_JOBS service binding is missing",
    ]);
    const c = structuredClone(jobs);
    c.env.production.triggers = { crons: ["30 * * * *"] };
    c.env.production.services = structuredClone(jobs.services);
    expect(guard.jobsConfigProblems(c, invoices)).toEqual([
      "env.production: no cron triggers until Phase 7",
      "env.production: no ADMIN_JOBS service binding until Phase 7",
    ]);
  });
});

describe("jobs Worker minify and source maps (L9, owner 2026-10-31)", () => {
  const read = (p: string) => guard.parseJsonc(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8"));
  const jobs = read("jobs/wrangler.jsonc");

  it("the real config minifies and uploads source maps at the top level, and no environment switches them off", () => {
    expect(jobs.minify).toBe(true);
    expect(jobs.upload_source_maps).toBe(true);
    expect(guard.jobsBuildProblems(jobs)).toEqual([]);
  });

  it("fails a missing or false top-level key", () => {
    const a = structuredClone(jobs);
    delete a.minify;
    a.upload_source_maps = false;
    expect(guard.jobsBuildProblems(a)).toEqual([
      "(top level): minify must be true (L9)",
      "(top level): upload_source_maps must be true (L9)",
    ]);
  });

  it("fails an environment that sets either key to anything but true", () => {
    const b = structuredClone(jobs);
    b.env.staging.minify = false;
    b.env.production.upload_source_maps = "false";
    expect(guard.jobsBuildProblems(b)).toEqual([
      "env.staging: minify must not be switched off (L9)",
      "env.production: upload_source_maps must not be switched off (L9)",
    ]);
    const c = structuredClone(jobs);
    c.env.staging.minify = true;
    expect(guard.jobsBuildProblems(c)).toEqual([]);
  });
});

describe("admin finance Worker config guard (M6.1 stage A, ADM-PAY-01)", () => {
  const read = (p: string) => guard.parseJsonc(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8"));
  const finance = read("admin/wrangler.finance.jsonc");
  const api = read("admin/wrangler.api.jsonc");
  const front = read("admin/wrangler.jsonc");
  const jobs = read("jobs/wrangler.jsonc");

  it("covers the three auxiliary admin configs, and the real configs pass", () => {
    expect(guard.ADMIN_AUX_CONFIGS).toEqual([
      "wrangler.api.jsonc",
      "wrangler.finance.jsonc",
      "wrangler.invoices.jsonc",
    ]);
    expect(guard.apiConfigProblems(finance, front, guard.FINANCE_OPTS)).toEqual([]);
    expect(guard.missingPreviewOff(finance)).toEqual([]);
    expect(guard.observabilityProblems(finance)).toEqual([]);
    expect(guard.frontServiceProblems(front, api, finance)).toEqual([]);
  });

  it("names its own Worker in every scope, runs finance.ts, and has no public URL", () => {
    expect(finance.main).toBe("worker/finance.ts");
    expect([finance.name, finance.env.staging.name, finance.env.production.name]).toEqual([
      "techaust-platform-admin-finance",
      "techaust-platform-admin-finance-staging",
      "techaust-platform-admin-finance",
    ]);
    for (const c of [finance, finance.env.staging, finance.env.production]) {
      expect(c.workers_dev).toBe(false);
      expect(c.preview_urls).toBe(false);
    }
  });

  it("the front binds ADMIN_FINANCE in all three scopes, to the finance Worker of that scope", () => {
    const want = [
      [front, "techaust-platform-admin-finance"],
      [front.env.staging, "techaust-platform-admin-finance-staging"],
      [front.env.production, "techaust-platform-admin-finance"],
    ] as const;
    for (const [c, service] of want) {
      expect(c.services).toContainEqual({ binding: "ADMIN_FINANCE", service });
    }
  });

  it("fails a front without ADMIN_FINANCE, one pointing at the API Worker, or one naming an entrypoint", () => {
    const a = structuredClone(front);
    a.env.production.services = a.env.production.services.filter(
      (s: { binding: string }) => s.binding !== "ADMIN_FINANCE",
    );
    expect(guard.frontServiceProblems(a, api, finance)).toEqual([
      "env.production: the ADMIN_FINANCE service binding is missing",
    ]);
    const b = structuredClone(front);
    b.env.staging.services[1].service = "techaust-platform-admin-api-staging";
    b.env.staging.services[1].entrypoint = "BillingJobs";
    expect(guard.frontServiceProblems(b, api, finance)).toEqual([
      "env.staging: ADMIN_FINANCE points at techaust-platform-admin-api-staging, expected techaust-platform-admin-finance-staging",
      "env.staging: ADMIN_FINANCE must not name an entrypoint",
    ]);
  });

  it("fails a finance Worker named like the API Worker", () => {
    const f = structuredClone(finance);
    f.env.staging.name = api.env.staging.name;
    expect(guard.frontServiceProblems(front, api, f)).toContain(
      "env.staging: the API and finance Workers must have different names",
    );
  });

  it("fails a finance config with a public URL or another bucket", () => {
    const f = structuredClone(finance);
    f.env.staging.workers_dev = true;
    f.env.staging.r2_buckets[0].bucket_name = "other";
    expect(guard.apiConfigProblems(f, front, guard.FINANCE_OPTS)).toEqual([
      "env.staging: workers_dev must be false",
      "env.staging: r2_buckets differ from the front's",
    ]);
  });

  it("jobs binds BillingJobs on the invoices Worker (the fourth admin Worker), no longer on the finance or API Worker", () => {
    const invoices = read("admin/wrangler.invoices.jsonc");
    expect(guard.jobsConfigProblems(jobs, invoices)).toEqual([]);
    expect(guard.jobsConfigProblems(jobs, finance)).toEqual([
      "(top level): ADMIN_JOBS points at techaust-platform-admin-invoices, expected techaust-platform-admin-finance",
      "env.staging: ADMIN_JOBS points at techaust-platform-admin-invoices-staging, expected techaust-platform-admin-finance-staging",
    ]);
    expect(guard.jobsConfigProblems(jobs, api)).toEqual([
      "(top level): ADMIN_JOBS points at techaust-platform-admin-invoices, expected techaust-platform-admin-api",
      "env.staging: ADMIN_JOBS points at techaust-platform-admin-invoices-staging, expected techaust-platform-admin-api-staging",
    ]);
  });

  it("finance's one service binding is ADMIN_ADVANCE (the fourth admin Worker), none in production; any other is refused", () => {
    const f = structuredClone(finance);
    f.env.staging.services.push({ binding: "ADMIN_API", service: "techaust-platform-admin-api-staging" });
    f.env.production.services = [
      {
        binding: "ADMIN_ADVANCE",
        service: "techaust-platform-admin-invoices",
        entrypoint: "GatewayAdvance",
      },
    ];
    delete f.services;
    expect(guard.apiConfigProblems(f, front, guard.FINANCE_OPTS)).toEqual([
      '(top level): services must be exactly ["ADMIN_ADVANCE"]',
      'env.staging: services must be exactly ["ADMIN_ADVANCE"]',
      "env.production: services must be exactly []",
    ]);
    // The API Worker may hold none.
    const a = structuredClone(api);
    a.env.staging.services = [{ binding: "ADMIN_ADVANCE", service: "x" }];
    expect(guard.apiConfigProblems(a, front)).toEqual([
      "env.staging: services is not allowed on the API Worker",
    ]);
  });
});

describe("admin invoices Worker config guard (the fourth admin Worker, 2026-11-03, ADM-G-02)", () => {
  const read = (p: string) => guard.parseJsonc(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8"));
  const invoices = read("admin/wrangler.invoices.jsonc");
  const finance = read("admin/wrangler.finance.jsonc");
  const api = read("admin/wrangler.api.jsonc");
  const front = read("admin/wrangler.jsonc");
  const jobs = read("jobs/wrangler.jsonc");
  const portal = read("portal/wrangler.jsonc");

  it("the real configs pass: the front's resources, no public URL, no secrets, no service binding, no LEADS_QUEUE, traces on staging only", () => {
    expect(guard.AUX_OPTS["wrangler.invoices.jsonc"]).toBe(guard.INVOICES_OPTS);
    expect(guard.apiConfigProblems(invoices, front, guard.INVOICES_OPTS)).toEqual([]);
    expect(guard.missingPreviewOff(invoices)).toEqual([]);
    expect(guard.observabilityProblems(invoices)).toEqual([]);
    expect(guard.frontServiceProblems(front, api, finance, invoices)).toEqual([]);
    expect(guard.entrypointBindingProblems(jobs, portal, finance, invoices)).toEqual([]);
    expect(guard.gatewayConfigProblems(jobs, portal, finance, [["admin invoices", invoices]])).toEqual([]);
  });

  it("names its own Worker in every scope, runs invoicing.ts, and has no public URL", () => {
    expect(invoices.main).toBe("worker/invoicing.ts");
    expect([invoices.name, invoices.env.staging.name, invoices.env.production.name]).toEqual([
      "techaust-platform-admin-invoices",
      "techaust-platform-admin-invoices-staging",
      "techaust-platform-admin-invoices",
    ]);
    for (const c of [invoices, invoices.env.staging, invoices.env.production]) {
      expect(c.workers_dev).toBe(false);
      expect(c.preview_urls).toBe(false);
      expect(c.vars.PAYMENTS_LIVE_ALLOWED).toBe("false");
    }
  });

  it("fails a secret, a service binding, a LEADS_QUEUE producer, a public URL, another database or a live flag on the invoices Worker", () => {
    const c = structuredClone(invoices);
    c.secrets = { required: ["RAZORPAY_KEY_ID"] };
    c.env.staging.services = [
      { binding: "ADMIN_FINANCE", service: "techaust-platform-admin-finance-staging" },
    ];
    c.env.staging.queues.producers.push({ binding: "LEADS_QUEUE", queue: "techaust-staging-leads" });
    c.env.staging.workers_dev = true;
    c.env.staging.d1_databases[0].database_id = "other";
    expect(guard.apiConfigProblems(c, front, guard.INVOICES_OPTS)).toEqual([
      "(top level): secrets is not allowed on the API Worker",
      "env.staging: workers_dev must be false",
      "env.staging: services is not allowed on the API Worker",
      "env.staging: d1_databases differ from the front's",
      "env.staging: queues differ from the front's",
    ]);
    const live = structuredClone(invoices);
    live.env.production.vars.PAYMENTS_LIVE_ALLOWED = "true";
    expect(guard.gatewayConfigProblems(jobs, portal, finance, [["admin invoices", live]])).toEqual([
      'admin invoices env.production: PAYMENTS_LIVE_ALLOWED must be "false"',
    ]);
  });

  it('all six configs must STATE PAYMENTS_LIVE_ALLOWED "false" in every scope; a missing flag fails [early check finding 5, M6.5 F]', () => {
    expect(guard.LIVE_FLAG_REQUIRED).toEqual([
      "jobs",
      "portal",
      "finance",
      "admin",
      "admin api",
      "admin invoices",
    ]);
    const inv = structuredClone(invoices);
    delete inv.env.staging.vars.PAYMENTS_LIVE_ALLOWED;
    const f = structuredClone(finance);
    delete f.vars.PAYMENTS_LIVE_ALLOWED;
    delete f.env.production.vars.PAYMENTS_LIVE_ALLOWED;
    // M6.5 (F): the API config is on the list too: a missing flag there fails like the others
    const a = structuredClone(api);
    delete a.env.staging.vars.PAYMENTS_LIVE_ALLOWED;
    expect(
      guard.gatewayConfigProblems(jobs, portal, f, [
        ["admin invoices", inv],
        ["admin api", a],
      ]),
    ).toEqual([
      'finance (top level): PAYMENTS_LIVE_ALLOWED must be "false"',
      'finance env.production: PAYMENTS_LIVE_ALLOWED must be "false"',
      'admin invoices env.staging: PAYMENTS_LIVE_ALLOWED must be "false"',
      'admin api env.staging: PAYMENTS_LIVE_ALLOWED must be "false"',
    ]);
  });

  it("the front binds ADMIN_INVOICES in all three scopes, to the invoices Worker of that scope, without an entrypoint", () => {
    for (const [c, service] of [
      [front, "techaust-platform-admin-invoices"],
      [front.env.staging, "techaust-platform-admin-invoices-staging"],
      [front.env.production, "techaust-platform-admin-invoices"],
    ] as const)
      expect(c.services).toContainEqual({ binding: "ADMIN_INVOICES", service });
    const a = structuredClone(front);
    a.services = a.services.filter((s: { binding: string }) => s.binding !== "ADMIN_INVOICES");
    const inv = a.env.staging.services.find((s: { binding: string }) => s.binding === "ADMIN_INVOICES");
    inv.service = "techaust-platform-admin-finance-staging";
    inv.entrypoint = "GatewayAdvance";
    expect(guard.frontServiceProblems(a, api, finance, invoices)).toEqual([
      "(top level): the ADMIN_INVOICES service binding is missing",
      "env.staging: ADMIN_INVOICES points at techaust-platform-admin-finance-staging, expected techaust-platform-admin-invoices-staging",
      "env.staging: ADMIN_INVOICES must not name an entrypoint",
    ]);
  });

  it("fails an invoices Worker named like the finance or API Worker", () => {
    const i = structuredClone(invoices);
    i.env.staging.name = finance.env.staging.name;
    i.env.production.name = api.env.production.name;
    expect(guard.frontServiceProblems(front, api, finance, i)).toEqual(
      expect.arrayContaining([
        "env.staging: the finance and invoices Workers must have different names",
        "env.production: the API and invoices Workers must have different names",
      ]),
    );
  });

  it("the entrypoint bindings: each points at its Worker and names its entrypoint in the top level and staging, none in production", () => {
    const j = structuredClone(jobs);
    const f = structuredClone(finance);
    const p = structuredClone(portal);
    const by = (c: { services: { binding: string; service: string; entrypoint?: string }[] }, b: string) =>
      c.services.find((s) => s.binding === b) as { service: string; entrypoint?: string };
    // jobs' advance pointed at finance (the old home), its BillingJobs without an entrypoint, its gateway at invoices
    by(j, "ADMIN_ADVANCE").service = "techaust-platform-admin-finance";
    delete by(j.env.staging, "ADMIN_JOBS").entrypoint;
    by(j.env.staging, "ADMIN_GATEWAY").service = "techaust-platform-admin-invoices-staging";
    // finance's advance naming the wrong entrypoint; the portal's ADMIN_PAY at invoices
    by(f.env.staging, "ADMIN_ADVANCE").entrypoint = "BillingJobs";
    by(p, "ADMIN_PAY").service = "techaust-platform-admin-invoices";
    // anything in production
    j.env.production.services = [
      { binding: "ADMIN_ADVANCE", service: "techaust-platform-admin-invoices", entrypoint: "GatewayAdvance" },
    ];
    expect(guard.entrypointBindingProblems(j, p, f, invoices)).toEqual([
      "(top level): jobs's ADMIN_ADVANCE points at techaust-platform-admin-finance, expected techaust-platform-admin-invoices",
      "(top level): portal's ADMIN_PAY points at techaust-platform-admin-invoices, expected techaust-platform-admin-finance",
      "env.staging: finance's ADMIN_ADVANCE must name the entrypoint GatewayAdvance",
      "env.staging: jobs's ADMIN_JOBS must name the entrypoint BillingJobs",
      "env.staging: jobs's ADMIN_GATEWAY points at techaust-platform-admin-invoices-staging, expected techaust-platform-admin-finance-staging",
      "env.production: jobs has no ADMIN_ADVANCE until Phase 7",
    ]);
    // A missing binding.
    const k = structuredClone(jobs);
    k.env.staging.services = k.env.staging.services.filter(
      (s: { binding: string }) => s.binding !== "ADMIN_ADVANCE",
    );
    expect(guard.entrypointBindingProblems(k, portal, finance, invoices)).toEqual([
      "env.staging: jobs's ADMIN_ADVANCE service binding is missing",
    ]);
  });
});

describe("M6.2 gateway wiring (run file F)", () => {
  const read = (p: string) => guard.parseJsonc(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8"));
  const jobs = read("jobs/wrangler.jsonc");
  const portal = read("portal/wrangler.jsonc");
  const finance = read("admin/wrangler.finance.jsonc");
  const front = read("admin/wrangler.jsonc");

  it("the real configs pass: ADMIN_GATEWAY and ADMIN_PAY to the finance entrypoints, the webhook secret on jobs, the key pair on finance only", () => {
    expect(guard.gatewayConfigProblems(jobs, portal, finance, [["admin", front]])).toEqual([]);
    expect(guard.apiConfigProblems(finance, front, guard.FINANCE_OPTS)).toEqual([]);
    // without the finance options the secrets and vars are refused as before
    expect(guard.apiConfigProblems(finance, front).length).toBeGreaterThan(0);
  });

  it("refuses a mispointed binding, a missing webhook secret, the key pair on jobs, a stub transport on staging, anything in production, a live flag", () => {
    const j = structuredClone(jobs);
    j.env.staging.services = j.env.staging.services.filter(
      (x: { binding: string }) => x.binding !== "ADMIN_GATEWAY",
    );
    j.secrets.required = ["SES_ACCESS_KEY_ID", "SES_SECRET_ACCESS_KEY", "RAZORPAY_KEY_ID"];
    j.env.production.services = [{ binding: "ADMIN_GATEWAY", service: "x", entrypoint: "GatewayEvents" }];
    const p = structuredClone(portal);
    p.services[0].entrypoint = "GatewayEvents";
    const f = structuredClone(finance);
    f.env.staging.vars.GATEWAY_TRANSPORT = "stub";
    f.vars.PAYMENTS_LIVE_ALLOWED = "true";
    expect(guard.gatewayConfigProblems(j, p, f)).toEqual([
      "(top level): portal's ADMIN_PAY must name the entrypoint PortalPayments",
      "(top level): jobs must require the secret RAZORPAY_WEBHOOK_SECRET",
      "(top level): jobs must require the secret STRIPE_WEBHOOK_SECRET",
      "(top level): jobs must require the secret PAYPAL_WEBHOOK_ID",
      "(top level): jobs must not hold a gateway's API key (finance only, L1, L3)",
      "env.staging: jobs's ADMIN_GATEWAY service binding is missing",
      "env.staging: finance GATEWAY_TRANSPORT must be api",
      "env.production: jobs has no ADMIN_GATEWAY until Phase 7",
      'finance (top level): PAYMENTS_LIVE_ALLOWED must be "false"',
    ]);
  });

  it("finance's own LEADS_QUEUE producer points at the jobs Worker's leads queue (top level, staging), none in production; the shared queues still match the front's [early check 2, finding 2]", () => {
    expect(finance.queues.producers.map((q: { binding: string }) => q.binding)).toContain("LEADS_QUEUE");
    const f = structuredClone(finance);
    f.env.staging.queues.producers = f.env.staging.queues.producers.map(
      (q: { binding: string; queue: string }) =>
        q.binding === "LEADS_QUEUE" ? { ...q, queue: "techaust-staging-email" } : q,
    );
    f.env.production.queues = { producers: [{ binding: "LEADS_QUEUE", queue: "techaust-production-leads" }] };
    expect(guard.gatewayConfigProblems(jobs, portal, f)).toEqual([
      "env.staging: finance's LEADS_QUEUE must be the jobs Worker's leads queue (techaust-staging-leads)",
      "env.production: finance has no LEADS_QUEUE until Phase 7",
    ]);
    // the other producers are still compared with the front's
    const g = structuredClone(finance);
    g.queues.producers = g.queues.producers.filter((q: { binding: string }) => q.binding !== "PDF_QUEUE");
    expect(guard.apiConfigProblems(g, front, guard.FINANCE_OPTS)).toEqual([
      "(top level): queues differ from the front's",
    ]);
  });

  it("finance's secrets are exactly the key pair and (M6.3) the Stripe restricted key, and none in production", () => {
    const f = structuredClone(finance);
    f.env.staging.secrets = { required: ["RAZORPAY_KEY_ID"] };
    f.env.production.secrets = { required: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"] };
    expect(guard.apiConfigProblems(f, front, guard.FINANCE_OPTS)).toEqual([
      'env.staging: secrets.required must be exactly ["PAYPAL_CLIENT_ID","PAYPAL_CLIENT_SECRET","RAZORPAY_KEY_ID","RAZORPAY_KEY_SECRET","STRIPE_SECRET_KEY"]',
      "env.production: secrets.required must be exactly []",
    ]);
  });

  it("M6.3: the Stripe webhook secret is the jobs Worker's only; the portal holds no Stripe secret", () => {
    const f = structuredClone(finance);
    f.env.staging.secrets = { required: [...f.env.staging.secrets.required, "STRIPE_WEBHOOK_SECRET"] };
    const p = structuredClone(portal);
    p.secrets = { required: ["STRIPE_SECRET_KEY"] };
    expect(guard.gatewayConfigProblems(jobs, p, f)).toEqual([
      "(top level): the portal holds no gateway secret",
      "env.staging: the Stripe webhook secret is the jobs Worker's, never finance's",
    ]);
  });

  it("M6.4: the PayPal webhook id is the jobs Worker's only; the client id and secret finance's only; the portal holds no PayPal secret; no deployed jobs is local", () => {
    const f = structuredClone(finance);
    f.env.staging.secrets = { required: [...f.env.staging.secrets.required, "PAYPAL_WEBHOOK_ID"] };
    const p = structuredClone(portal);
    p.secrets = { required: ["PAYPAL_CLIENT_SECRET"] };
    const j = structuredClone(jobs);
    j.env.staging.secrets.required = [...j.env.staging.secrets.required, "PAYPAL_CLIENT_ID"];
    j.env.staging.vars.ENVIRONMENT = "local";
    expect(guard.gatewayConfigProblems(j, p, f)).toEqual([
      "(top level): the portal holds no gateway secret",
      "env.staging: jobs must not hold a gateway's API key (finance only, L1, L3)",
      "env.staging: the PayPal webhook id is the jobs Worker's, never finance's",
      'env.staging: jobs ENVIRONMENT must not be "local" (the PayPal hook would take the local certificate)',
    ]);
    const k = structuredClone(jobs);
    k.env.staging.secrets.required = k.env.staging.secrets.required.filter(
      (n: string) => n !== "PAYPAL_WEBHOOK_ID",
    );
    expect(guard.gatewayConfigProblems(k, portal, finance)).toEqual([
      "env.staging: jobs must require the secret PAYPAL_WEBHOOK_ID",
    ]);
  });
});
