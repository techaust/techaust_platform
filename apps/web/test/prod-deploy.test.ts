// P7-B (docs/runs/p7-launch.md): the production deploy's own checks. scripts/prod-health.mjs (the production hosts, env "production", no Access
// token), scripts/check-prod-build.mjs (a production build names the production Worker for env.production and carries no staging host, name or
// Turnstile key), scripts/web-noindex.mjs with the dist check (X-Robots-Tag: noindex only off production), and the staging-production comparison
// of scripts/check-prod-readiness.mjs. Runs in Node (made-up answers, builds and configs).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as build from "../../../scripts/check-prod-build.mjs";
// @ts-expect-error plain .mjs without types
import * as ready from "../../../scripts/check-prod-readiness.mjs";
// @ts-expect-error plain .mjs without types
import * as health from "../../../scripts/prod-health.mjs";
// @ts-expect-error plain .mjs without types
import * as dist from "../../../scripts/web-dist-checks.mjs";
// @ts-expect-error plain .mjs without types
import * as noindex from "../../../scripts/web-noindex.mjs";

const scratchDirs: string[] = [];
afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("prod-health: the production hosts, env production, no Access token", () => {
  it("knows the four production hosts and reads each app's real health path", () => {
    expect(health.PRODUCTION_HOSTS).toEqual({
      web: "https://techaust.com",
      admin: "https://admin.techaust.com",
      portal: "https://portal.techaust.com",
      jobs: "https://hooks.techaust.com",
    });
    expect(health.CHECKS.admin.map((c: { path: string }) => c.path)).toEqual(["/api/v1/health"]);
    expect(health.CHECKS.portal.map((c: { path: string }) => c.path)).toEqual(["/api/v1/health"]);
    expect(health.CHECKS.web.map((c: { path: string }) => c.path)).toEqual(["/api/health"]);
    expect(health.CHECKS.jobs.map((c: { path: string }) => c.path)).toEqual([
      "/healthz",
      "/razorpay",
      "/stripe",
      "/paypal",
      "/ses",
    ]);
    // The real routes (read from the code, not the brief's shorthand).
    const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
    expect(read("admin/worker/routes-front.ts")).toContain('app.get("/v1/health"');
    expect(read("portal/worker/index.ts")).toContain('app.get("/v1/health"');
    expect(read("jobs/src/index.ts")).toContain('app.get("/healthz"');
    expect(read("web/src/worker.ts")).toContain('app.get("/health"');
  });

  it("every check goes without an Access token: the admin only through its health path (the Access bypass)", () => {
    for (const checks of Object.values(health.CHECKS) as { access?: boolean }[][])
      for (const c of checks) expect(c.access).toBe(false);
    expect(health.CHECKS.admin).toHaveLength(1);
  });

  it("passes the production Worker's own answer, sending no Access headers and never following a redirect", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return json(200, { ok: true, service: "admin", env: "production" });
    };
    const failures = await health.checkProductionApp("admin", {
      fetchImpl,
      sleep: async () => {},
      log: () => {},
    });
    expect(failures).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://admin.techaust.com/api/v1/health");
    expect(seen[0]?.init.redirect).toBe("manual");
    expect(JSON.stringify(seen[0]?.init.headers ?? {})).not.toMatch(/CF-Access/i);
  });

  it("fails a staging answer, an Access page, and retries for about two minutes before giving up", async () => {
    const waits: number[] = [];
    const staging = async () => json(200, { ok: true, service: "portal", env: "staging" });
    const failures: string[] = await health.checkProductionApp("portal", {
      fetchImpl: staging,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      log: () => {},
    });
    expect(failures).toEqual([
      "portal /api/v1/health: the health body says env staging, expected production",
    ]);
    expect(waits.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(90_000);
    expect(waits).toHaveLength(health.DELAYS_MS.length - 1);
    const access = async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://techaust.cloudflareaccess.com/cdn-cgi/access/login" },
      });
    const [reason] = await health.checkProductionApp("admin", {
      fetchImpl: access,
      sleep: async () => {},
      log: () => {},
    });
    expect(reason).toMatch(/Cloudflare Access sign-in page/);
  });

  it("jobs: the public webhooks answer the Worker's own codes", async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith("/healthz")) return json(200, { ok: true, service: "jobs", env: "production" });
      if (url.endsWith("/ses")) return json(401, { error: { code: "token_missing" } });
      return json(400, { error: { code: "signature_missing" } });
    };
    expect(
      await health.checkProductionApp("jobs", { fetchImpl, sleep: async () => {}, log: () => {} }),
    ).toEqual([]);
  });
});

describe("check-prod-build: a production build, and nothing of staging in it", () => {
  const flattened = (over: Record<string, unknown> = {}) => ({
    name: "techaust-platform-portal",
    targetEnvironment: "production",
    vars: { ENVIRONMENT: "production" },
    ...over,
  });

  it("accepts env.production's flattened config", () => {
    expect(build.builtConfigProblems(flattened(), "techaust-platform-portal")).toEqual([]);
  });

  it("refuses a plain build (the top level also names the production Worker), a staging build and a missing one", () => {
    const plain = build.builtConfigProblems(
      flattened({ targetEnvironment: undefined, vars: { ENVIRONMENT: "local" } }),
      "techaust-platform-portal",
    );
    expect(plain.join("\n")).toMatch(/top level \(a plain build\)/);
    expect(plain.join("\n")).toMatch(/ENVIRONMENT is local/);
    const staging = build.builtConfigProblems(
      flattened({
        name: "techaust-platform-portal-staging",
        targetEnvironment: "staging",
        vars: { ENVIRONMENT: "staging" },
      }),
      "techaust-platform-portal",
    );
    expect(staging).toHaveLength(3);
    expect(build.builtConfigProblems(null, "x")[0]).toMatch(/build:production first/);
  });

  it("finds a staging host, a staging resource name and a staging Turnstile key in a built file", () => {
    const text =
      'a="https://techaust-platform-portal-staging.techaust-technologies-153.workers.dev/";b="techaust-staging-docs";k="0xSTAGINGKEY"';
    const problems: string[] = build.stagingTraceProblems("portal client/a.js", text, ["0xSTAGINGKEY"]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("techaust-platform-portal-staging.techaust-technologies-153.workers.dev");
    expect(problems[1]).toContain("techaust-staging-docs");
    expect(problems[2]).toContain("env.staging's Turnstile site key");
    expect(
      build.stagingTraceProblems("x", 'u="https://portal.techaust.com/";e="staging"', ["0xSTAGINGKEY"]),
    ).toEqual([]);
  });

  it("scans a long run of letters (as minified bundles have) in linear time", () => {
    const started = performance.now();
    expect(build.stagingTraceProblems("x", "a".repeat(300_000), [])).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("wants env.production's site key and not the top level's test key; an empty production key is refused", () => {
    expect(build.siteKeyProblems("pages", ['<div data-sitekey="0xprod">'], "0xprod", "1x00")).toEqual([]);
    expect(build.siteKeyProblems("pages", ['<div data-sitekey="1x00">'], "0xprod", "1x00")).toHaveLength(2);
    expect(build.siteKeyProblems("pages", ["<p>"], "", "1x00")[0]).toMatch(
      /env.production has no TURNSTILE_SITE_KEY/,
    );
    expect(build.siteKeyProblems("pages", [], "0xprod", "1x00")[0]).toMatch(/nothing built/);
  });

  it("reads the real staging keys of the three apps with a widget, skips source maps, and knows every target", () => {
    expect(build.stagingKeys().length).toBe(3);
    const dir = mkdtempSync(join(tmpdir(), "prod-build-"));
    scratchDirs.push(dir);
    writeFileSync(join(dir, "index.js"), "x");
    writeFileSync(join(dir, "index.js.map"), "x");
    writeFileSync(join(dir, "_headers"), "x");
    expect(
      build
        .textFiles(dir)
        .map((f: string) => f.slice(dir.length + 1))
        .sort(),
    ).toEqual(["_headers", "index.js"]);
    expect(build.problemsFor("nope")).toEqual(["unknown target nope"]);
    expect(build.PREBUNDLED_DIRS).toEqual({ jobs: "dist-production", web: ".wrangler/dist-production" });
  });
});

describe("X-Robots-Tag: noindex only off production (scripts/web-noindex.mjs, the dist check)", () => {
  const publicText = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");

  it("public/_headers carries no X-Robots-Tag; every build but production adds it to the /* block", () => {
    expect(noindex.hasRobotsHeader(publicText)).toBe(false);
    expect(noindex.wantsNoindex(undefined)).toBe(true);
    expect(noindex.wantsNoindex("staging")).toBe(true);
    expect(noindex.wantsNoindex("production")).toBe(false);
    const built: string = noindex.withNoindex(publicText);
    expect(noindex.hasRobotsHeader(built)).toBe(true);
    const block = built.slice(built.indexOf("/*\n"), built.indexOf("\n\n", built.indexOf("/*\n")));
    expect(block.split("\n").at(-1)).toBe("  X-Robots-Tag: noindex");
    expect(built.replace("  X-Robots-Tag: noindex\n", "")).toBe(publicText);
    expect(noindex.builtHeadersFor(publicText, "production")).toBe(publicText);
  });

  it("refuses a file that already has the header or has no /* block", () => {
    expect(() => noindex.withNoindex("/*\n  X-Robots-Tag: noindex\n")).toThrow(/already sets/);
    expect(() => noindex.withNoindex("/a\n  B: c\n")).toThrow(/no "\/\*" block/);
    expect(noindex.withNoindex("/*\r\n  A: b\r\n\r\n/x\r\n  C: d\r\n")).toBe(
      "/*\r\n  A: b\r\n  X-Robots-Tag: noindex\r\n\r\n/x\r\n  C: d\r\n",
    );
  });

  it("the dist check wants noindex in dist/_headers on staging and local builds, and none on production", () => {
    const withIt = noindex.withNoindex(publicText);
    expect(dist.checkBuiltHeaders(publicText, withIt, "staging")).toEqual([]);
    expect(dist.checkBuiltHeaders(publicText, withIt, undefined)).toEqual([]);
    expect(dist.checkBuiltHeaders(publicText, publicText, "production")).toEqual([]);
    expect(dist.checkBuiltHeaders(publicText, publicText, "staging")[0]).toMatch(/must stay out of search/);
    expect(dist.checkBuiltHeaders(publicText, withIt, "production")[0]).toMatch(/production build/);
    expect(dist.checkBuiltHeaders(withIt, withIt, "staging")[0]).toMatch(
      /public\/_headers sets X-Robots-Tag/,
    );
    expect(dist.checkBuiltHeaders(publicText, null, "staging")[0]).toMatch(/missing/);
  });

  it("the readiness check reads the built dist/_headers", () => {
    expect(ready.checkNoindex(noindex.withNoindex(publicText))[0]).toMatch(
      /dist\/_headers sets X-Robots-Tag/,
    );
    expect(ready.checkNoindex(publicText)).toEqual([]);
    expect(ready.checkNoindex(null)[0]).toMatch(/dist\/_headers is missing/);
    const src = readFileSync(new URL("../../../scripts/check-prod-readiness.mjs", import.meta.url), "utf8");
    expect(src).toContain('join(dist, "_headers")');
    expect(src).not.toContain('join(webDir, "public", "_headers")');
  });
});

describe("readiness: staging and production differ only in values (P7-B 4)", () => {
  const staging = {
    vars: {
      ENVIRONMENT: "staging",
      EMAIL_ALLOWED_RECIPIENTS: "a@b",
      PORTAL_URL: "https://x-staging.y.workers.dev/",
    },
    d1_databases: [
      { binding: "DB", database_name: "techaust-staging", database_id: "s", migrations_dir: "m" },
    ],
    r2_buckets: [{ binding: "DOCS", bucket_name: "techaust-staging-docs" }],
    browser: { binding: "BROWSER" },
    ratelimits: [{ name: "RL_FORMS", namespace_id: "4201", simple: { limit: 2, period: 60 } }],
    triggers: { crons: ["0 22 * * *", "30 * * * *"] },
    secrets: { required: ["A", "B"] },
  };
  const prod = {
    vars: { ENVIRONMENT: "production", PORTAL_URL: "https://portal.techaust.com/" },
    d1_databases: [{ binding: "DB", database_name: "techaust-prod", database_id: "p", migrations_dir: "m" }],
    r2_buckets: [{ binding: "DOCS", bucket_name: "techaust-prod-docs" }],
    browser: { binding: "BROWSER" },
    ratelimits: [{ name: "RL_FORMS", namespace_id: "4301", simple: { limit: 2, period: 60 } }],
    triggers: { crons: ["30 * * * *", "0 22 * * *"] },
    secrets: { required: ["B", "A"] },
  };
  const parity = (p: Record<string, unknown>, top: Record<string, unknown> = {}) =>
    ready.checkEnvParity("w", { ...top, env: { staging, production: { ...prod, ...p } } }) as string[];

  it("passes a production scope that differs only in values (the email allow-list is staging's alone)", () => {
    expect(parity({})).toEqual([]);
    expect(ready.checkEnvParity("w", { env: { staging } })).toEqual([]);
  });

  it.each([
    ["a missing D1", { d1_databases: [] }, /the D1 bindings differ/],
    [
      "staging's database",
      {
        d1_databases: [
          { binding: "DB", database_name: "techaust-staging", database_id: "s", migrations_dir: "m" },
        ],
      },
      /is staging's database/,
    ],
    [
      "another migrations folder",
      {
        d1_databases: [
          { binding: "DB", database_name: "techaust-prod", database_id: "p", migrations_dir: "x" },
        ],
      },
      /migrations_dir x/,
    ],
    ["a missing R2 bucket", { r2_buckets: [] }, /the R2 bindings differ/],
    ["no browser", { browser: undefined }, /the browser bindings differ/],
    ["a missing rate limit", { ratelimits: [] }, /the rate limits differ/],
    [
      "another limit",
      { ratelimits: [{ name: "RL_FORMS", namespace_id: "4301", simple: { limit: 20, period: 60 } }] },
      /rate limit RL_FORMS is/,
    ],
    [
      "staging's namespace",
      { ratelimits: [{ name: "RL_FORMS", namespace_id: "4201", simple: { limit: 2, period: 60 } }] },
      /shares staging's namespace_id 4201/,
    ],
    ["no crons", { triggers: { crons: [] } }, /the crons differ/],
    ["a missing secret", { secrets: { required: ["A"] } }, /the secrets.required sets differ/],
    ["an extra var", { vars: { ...prod.vars, EXTRA: "1" } }, /the vars keys differ/],
    ["a missing var", { vars: { ENVIRONMENT: "production" } }, /the vars keys differ/],
    [
      "the email allow-list",
      { vars: { ...prod.vars, EMAIL_ALLOWED_RECIPIENTS: "" } },
      /EMAIL_ALLOWED_RECIPIENTS, which applies only on staging/,
    ],
    [
      "a staging value",
      { vars: { ...prod.vars, PORTAL_URL: "https://techaust-platform-portal-staging.x.workers.dev/" } },
      /vars.PORTAL_URL names a staging/,
    ],
    ["a local value", { vars: { ...prod.vars, PORTAL_URL: "http://localhost:5174/" } }, /vars.PORTAL_URL/],
    [
      "a staging bucket",
      { r2_buckets: [{ binding: "DOCS", bucket_name: "techaust-staging-docs" }] },
      /names techaust-staging-docs/,
    ],
    [
      "a staging queue",
      { queues: { producers: [{ binding: "PDF_QUEUE", queue: "techaust-staging-pdf" }] } },
      /names techaust-staging-pdf/,
    ],
  ])("refuses %s", (_name, p, problem) => {
    expect(parity(p as Record<string, unknown>).join("\n")).toMatch(problem);
  });

  it("crons are inherited: a scope without its own takes the top level's (jobs' production sets its own)", () => {
    const { triggers: _t, ...noTriggers } = prod;
    const config = {
      triggers: { crons: ["0 22 * * *", "30 * * * *"] },
      env: { staging, production: noTriggers },
    };
    expect(ready.checkEnvParity("w", config)).toEqual([]);
    expect(
      ready.checkEnvParity("w", { triggers: { crons: [] }, env: { staging, production: noTriggers } }).join(),
    ).toMatch(/the crons differ/);
  });

  it("checkProductionConfigs runs the comparison on every real config", () => {
    const dir = mkdtempSync(join(tmpdir(), "ready-parity-"));
    scratchDirs.push(dir);
    mkdirSync(join(dir, "jobs"), { recursive: true });
    writeFileSync(
      join(dir, "jobs", "wrangler.jsonc"),
      JSON.stringify({
        env: { staging: { ...staging, name: "j-staging" }, production: { ...prod, browser: undefined } },
      }),
    );
    const problems = (ready.checkProductionConfigs(dir) as string[]).filter((p) =>
      p.startsWith("apps/jobs/"),
    );
    expect(problems.join("\n")).toMatch(/apps\/jobs\/wrangler\.jsonc: the browser bindings differ/);
  });
});
