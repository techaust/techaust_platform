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
  // M6.1 stage A: the BillingJobs entrypoint is exported by the admin finance Worker.
  const finance = read("admin/wrangler.finance.jsonc");
  const jobs = read("jobs/wrangler.jsonc");

  it("the real config passes: both crons and the BillingJobs binding at the top level and in staging, neither in production", () => {
    expect(guard.JOBS_CRONS).toEqual(["0 22 * * *", "30 * * * *"]);
    expect(guard.jobsConfigProblems(jobs, finance)).toEqual([]);
    // FX-1 (A6 3): triggers are inherited, so production states an empty list.
    expect(jobs.env.production.triggers).toEqual({ crons: [] });
    expect(jobs.env.production.services).toBeUndefined();
  });

  it("production without its own triggers would inherit the crons: refused (FX-1, A6 3)", () => {
    const d = structuredClone(jobs);
    d.env.production.triggers = undefined;
    expect(guard.jobsConfigProblems(d, finance)).toEqual([
      'env.production: needs "triggers": { "crons": [] } (an environment without its own triggers inherits the top level\'s)',
    ]);
  });

  it("fails a missing hourly cron, a missing or mispointed binding or entrypoint, and anything in production", () => {
    const a = structuredClone(jobs);
    a.env.staging.triggers.crons = ["0 22 * * *"];
    expect(guard.jobsConfigProblems(a, finance)).toEqual([
      'env.staging: crons must be exactly ["0 22 * * *","30 * * * *"]',
    ]);
    const b = structuredClone(jobs);
    b.env.staging.services = undefined;
    b.services[0].service = "techaust-platform-admin-finance-staging";
    b.services[0].entrypoint = "default";
    expect(guard.jobsConfigProblems(b, finance)).toEqual([
      "(top level): ADMIN_JOBS points at techaust-platform-admin-finance-staging, expected techaust-platform-admin-finance",
      "(top level): ADMIN_JOBS must name the entrypoint BillingJobs",
      "env.staging: the ADMIN_JOBS service binding is missing",
    ]);
    const c = structuredClone(jobs);
    c.env.production.triggers = { crons: ["30 * * * *"] };
    c.env.production.services = structuredClone(jobs.services);
    expect(guard.jobsConfigProblems(c, finance)).toEqual([
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

  it("covers both auxiliary admin configs, and the real configs pass", () => {
    expect(guard.ADMIN_AUX_CONFIGS).toEqual(["wrangler.api.jsonc", "wrangler.finance.jsonc"]);
    expect(guard.apiConfigProblems(finance, front)).toEqual([]);
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
    expect(guard.apiConfigProblems(f, front)).toEqual([
      "env.staging: workers_dev must be false",
      "env.staging: r2_buckets differ from the front's",
    ]);
  });

  it("jobs binds BillingJobs on the finance Worker, no longer on the API Worker", () => {
    expect(guard.jobsConfigProblems(jobs, finance)).toEqual([]);
    expect(guard.jobsConfigProblems(jobs, api)).toEqual([
      "(top level): ADMIN_JOBS points at techaust-platform-admin-finance, expected techaust-platform-admin-api",
      "env.staging: ADMIN_JOBS points at techaust-platform-admin-finance-staging, expected techaust-platform-admin-api-staging",
    ]);
  });
});
