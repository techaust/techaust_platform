// The two deploy-time scripts (owner's yes 2026-10-30): scripts/check-staging-build.mjs refuses to upload a build that is not a staging
// one (a plain build names the production Worker; full audit A1 5), and scripts/staging-health.mjs judges a Worker's health answer
// behind Cloudflare Access (A6 8). Runs in Node; nothing here talks to Cloudflare.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_AUX_TARGETS,
  builtConfigProblems,
  devVarsFiles,
  devVarsProblems,
  problemsFor,
  stagingNameOf,
  webPagesProblems,
} from "../../../scripts/check-staging-build.mjs";
import { CHECKS, checkApp, judge, urlOf } from "../../../scripts/staging-health.mjs";

describe("check-staging-build [A1-5]", () => {
  it("reads the staging name from env.staging", () => {
    expect(stagingNameOf('{ "name": "x", "env": { "staging": { "name": "x-staging" } } }')).toBe("x-staging");
    expect(() => stagingNameOf('{ "name": "x" }')).toThrow(/env.staging.name/);
  });

  it("accepts a staging build and refuses a missing or non-staging one", () => {
    expect(builtConfigProblems({ name: "x-staging" }, "x-staging")).toEqual([]);
    expect(builtConfigProblems(null, "x-staging").join()).toMatch(/no built config/);
    expect(builtConfigProblems({ name: "x" }, "x-staging").join()).toMatch(/is for x, not x-staging/);
  });

  it("wants staging's site key in the pages and not the top level's test key", () => {
    expect(webPagesProblems(['<div data-sitekey="S">'], "S", "T")).toEqual([]);
    expect(webPagesProblems([], "S", "T").join()).toMatch(/no built pages/);
    expect(webPagesProblems(['<div data-sitekey="T">'], "S", "T")).toHaveLength(2);
    expect(webPagesProblems(['<div data-sitekey="S">', "T"], "S", "T").join()).toMatch(/TEST/);
  });

  it("knows the admin API, finance (M6.1 stage A) and invoices (the fourth admin Worker) Workers: their own configs and built dirs, and no other target", () => {
    expect(ADMIN_AUX_TARGETS).toEqual({
      "admin-api": { config: "wrangler.api.jsonc", dist: "techaust_platform_admin_api" },
      "admin-finance": { config: "wrangler.finance.jsonc", dist: "techaust_platform_admin_finance" },
      "admin-invoices": { config: "wrangler.invoices.jsonc", dist: "techaust_platform_admin_invoices" },
    });
    expect(problemsFor("admin-billing")).toEqual(["unknown target admin-billing"]);
  });

  it("admin-invoices wants the flattened build to name techaust-platform-admin-invoices-staging; a plain build names the production Worker and fails", () => {
    const want = stagingNameOf(
      readFileSync(new URL("../../admin/wrangler.invoices.jsonc", import.meta.url), "utf8"),
    );
    expect(want).toBe("techaust-platform-admin-invoices-staging");
    expect(builtConfigProblems({ name: want }, want)).toEqual([]);
    expect(builtConfigProblems({ name: "techaust-platform-admin-invoices" }, want)).toEqual([
      "the build is for techaust-platform-admin-invoices, not techaust-platform-admin-invoices-staging: run the app's build:staging first",
    ]);
  });
});

const res = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? "<html>sign in</html>" : JSON.stringify(body), {
    status,
    headers: { "content-type": body === undefined ? "text/html" : "application/json", ...headers },
  });

describe("staging-health judge [A6-8]", () => {
  const health = { path: "/api/v1/health", status: 200, service: "admin" };
  const ok = { ok: true, service: "admin", env: "staging" };
  const answer = (status: number, body?: unknown, location: string | null = null) => ({
    status,
    location,
    json: body !== undefined,
    body,
  });

  it("passes the staging Worker's own health answer", () => {
    expect(judge(health, answer(200, ok))).toBeNull();
    expect(
      judge({ path: "/api/v1/dashboard", status: 401 }, answer(401, { error: "unauthorised" })),
    ).toBeNull();
  });

  it("fails an Access answer: the sign-in redirect, or strict service-token 401/403 without JSON", () => {
    expect(
      judge(health, answer(302, undefined, "https://x.cloudflareaccess.com/cdn-cgi/access/login")),
    ).toMatch(/Access sign-in page/);
    expect(judge(health, answer(403))).toMatch(/Cloudflare Access/);
    expect(judge(health, answer(401))).toMatch(/Cloudflare Access/);
  });

  it("fails a wrong status, a wrong Worker, a non-staging Worker and a not-ok body", () => {
    expect(judge(health, answer(500, { ok: false }))).toMatch(/500, expected 200/);
    expect(judge({ path: "/api/v1/dashboard", status: 401 }, answer(502, { error: "x" }))).toMatch(/502/);
    expect(judge(health, answer(200, { ...ok, service: "portal" }))).toMatch(/names portal/);
    expect(judge(health, answer(200, { ...ok, env: "production" }))).toMatch(/env production/);
    expect(judge(health, answer(200, { ...ok, ok: false }))).toMatch(/does not say ok/);
    expect(judge(health, answer(200))).toMatch(/not a JSON answer/);
  });

  it("the webhook check wants the Worker's own signature_missing, not any 400 (M6.2, early check 2, finding 17)", () => {
    const hook = CHECKS.jobs.find((c) => c.path === "/razorpay");
    expect(hook).toMatchObject({ status: 400, code: "signature_missing", access: false });
    expect(judge(hook as never, answer(400, { error: { code: "signature_missing" } }))).toBeNull();
    expect(judge(hook as never, answer(400, { error: { code: "bad_request" } }))).toMatch(
      /error code is bad_request, expected signature_missing/,
    );
    expect(judge(hook as never, answer(400, {}))).toMatch(/expected signature_missing/);
  });

  it("M7.2 (run file F): the SES hook outside Access answers its own JSON 401 token_missing; an Access 401 (not JSON) fails", () => {
    const ses = CHECKS.jobs.find((c) => c.path === "/ses");
    expect(ses).toMatchObject({ status: 401, method: "POST", code: "token_missing", access: false });
    expect(judge(ses as never, answer(401, { error: { code: "token_missing" } }))).toBeNull();
    expect(judge(ses as never, answer(401))).toMatch(/from Cloudflare Access/);
    expect(judge(ses as never, answer(401, { error: { code: "token_invalid" } }))).toMatch(
      /expected token_missing/,
    );
  });

  it("knows every staging Worker with a URL, and admin proves its API, invoices and finance Workers through their bindings (M6.1, the fourth Worker)", () => {
    expect(Object.keys(CHECKS).sort()).toEqual(["admin", "jobs", "portal", "web"]);
    expect(CHECKS.admin.map((c) => [c.path, c.status])).toEqual([
      ["/api/v1/health", 200],
      ["/api/v1/leads", 401],
      ["/api/v1/dashboard", 401],
      ["/api/v1/payments", 401],
    ]);
    // M7.5 C4: the website's health route names the Worker and the environment (not any 200 from /api/geo).
    expect(CHECKS.web).toEqual([{ path: "/api/health", status: 200, service: "web" }]);
    expect(
      judge(CHECKS.web[0] as never, answer(200, { ok: true, service: "web", env: "staging" })),
    ).toBeNull();
    expect(judge(CHECKS.web[0] as never, answer(200, { currency: "INR" }))).toMatch(/does not say ok/);
    expect(judge(CHECKS.web[0] as never, answer(200, { ok: true, service: "web", env: "local" }))).toMatch(
      /expected staging/,
    );
    expect(urlOf("jobs")).toBe(
      "https://techaust-platform-jobs-staging.techaust-technologies-153.workers.dev",
    );
  });
});

describe("staging-health checkApp [A6-8]", () => {
  const quiet = { log: () => undefined, sleep: async () => undefined, delays: [0, 1, 1] };

  it("retries until the Worker answers, sending the Access headers and never following a redirect", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const answers = [
      res(503, { ok: false }),
      res(200, { ok: true, service: "jobs", env: "staging" }),
      res(400, { error: { code: "signature_missing" } }),
      res(400, { error: { code: "signature_missing" } }),
      res(400, { error: { code: "signature_missing" } }),
      // M7.2: the SES hook's own JSON 401.
      res(401, { error: { code: "token_missing" } }),
    ];
    const failures = await checkApp("jobs", {
      ...quiet,
      headers: { "CF-Access-Client-Id": "id", "CF-Access-Client-Secret": "s" },
      fetchImpl: async (url, init) => {
        seen.push({ url, init });
        return answers.shift() as Response;
      },
    });
    expect(failures).toEqual([]);
    expect(seen).toHaveLength(6);
    // M7.2: and the SES hook, without the Access token.
    expect(seen[5]?.url).toBe(`${urlOf("jobs")}/ses`);
    expect(seen[5]?.init.headers).toEqual({ "content-type": "application/json" });
    // M6.3: and the Stripe webhook path, the same way.
    expect(seen[3]?.url).toBe(`${urlOf("jobs")}/stripe`);
    expect(seen[3]?.init.headers).toEqual({ "content-type": "application/json" });
    // M6.4: and the PayPal webhook path, the same way.
    expect(seen[4]?.url).toBe(`${urlOf("jobs")}/paypal`);
    expect(seen[4]?.init.method).toBe("POST");
    expect(seen[4]?.init.headers).toEqual({ "content-type": "application/json" });
    expect(seen[0]?.url).toBe(`${urlOf("jobs")}/healthz`);
    expect(seen[0]?.init.redirect).toBe("manual");
    expect(seen[0]?.init.headers).toEqual({ "CF-Access-Client-Id": "id", "CF-Access-Client-Secret": "s" });
    // M6.2: the webhook path is checked WITHOUT the Access token (the H1 bypass) and must answer the Worker's JSON 400.
    expect(seen[2]?.url).toBe(`${urlOf("jobs")}/razorpay`);
    expect(seen[2]?.init.method).toBe("POST");
    expect(seen[2]?.init.headers).toEqual({ "content-type": "application/json" });
  });

  it("fails after the last attempt, naming the reason", async () => {
    let calls = 0;
    const failures = await checkApp("portal", {
      ...quiet,
      fetchImpl: async () => {
        calls++;
        return res(302, undefined, { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/x" });
      },
    });
    expect(calls).toBe(3);
    expect(failures).toEqual([
      "portal /api/v1/health: 302 to the Cloudflare Access sign-in page: Access did not accept the service token for this app",
    ]);
  });

  it("counts a network error as a failed attempt", async () => {
    const failures = await checkApp("web", {
      ...quiet,
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(failures).toEqual(["web /api/health: request failed: TypeError"]);
  });

  it("checks the four admin paths (front, API, invoices, finance), and refuses an unknown app", async () => {
    const urls: string[] = [];
    const failures = await checkApp("admin", {
      ...quiet,
      fetchImpl: async (url) => {
        urls.push(url);
        return url.endsWith("/health")
          ? res(200, { ok: true, service: "admin", env: "staging" })
          : res(401, { ok: false, error: "unauthorised" });
      },
    });
    expect(failures).toEqual([]);
    expect(urls.map((u) => new URL(u).pathname)).toEqual([
      "/api/v1/health",
      "/api/v1/leads",
      "/api/v1/dashboard",
      "/api/v1/payments",
    ]);
    expect(await checkApp("nope", quiet)).toEqual(["unknown app nope"]);
  });

  it("fails admin when the finance Worker's binding answers the front's 502 (early check finding 1)", async () => {
    const failures = await checkApp("admin", {
      ...quiet,
      fetchImpl: async (url) =>
        url.endsWith("/health")
          ? res(200, { ok: true, service: "admin", env: "staging" })
          : url.endsWith("/payments")
            ? res(502, { ok: false, error: { code: "upstream_unavailable" } })
            : res(401, { ok: false, error: "unauthorised" }),
    });
    expect(failures).toEqual(["admin /api/v1/payments: 502, expected 401"]);
  });
});

describe("M7.1 L17: no local secrets file in a build output (check-staging-build and check-spa-headers)", () => {
  it("finds .dev.vars and .dev.vars.<env> anywhere below dist, and nothing in a clean or missing one", () => {
    const dir = mkdtempSync(join(tmpdir(), "devvars-"));
    try {
      expect(devVarsFiles(join(dir, "nope"))).toEqual([]);
      mkdirSync(join(dir, "client", "assets"), { recursive: true });
      writeFileSync(join(dir, "client", "index.html"), "<html></html>");
      writeFileSync(join(dir, "client", ".dev.vars.example"), "NAME=");
      expect(devVarsFiles(dir)).toEqual(["client/.dev.vars.example"]);
      writeFileSync(join(dir, "client", "assets", ".dev.vars"), "SECRET=x");
      mkdirSync(join(dir, "techaust_platform_portal"));
      writeFileSync(join(dir, "techaust_platform_portal", ".dev.vars.staging"), "SECRET=y");
      expect(devVarsFiles(dir)).toEqual([
        "client/.dev.vars.example",
        "client/assets/.dev.vars",
        "techaust_platform_portal/.dev.vars.staging",
      ]);
      expect(devVarsProblems("portal", dir)[0]).toMatch(
        /^portal: dist\/client\/\.dev\.vars\.example is a local secrets file/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("both deploy-time guards call it for the SPAs", () => {
    const build = readFileSync(new URL("../../../scripts/check-staging-build.mjs", import.meta.url), "utf8");
    const headers = readFileSync(new URL("../../../scripts/check-spa-headers.mjs", import.meta.url), "utf8");
    expect(build.match(/devVarsProblems\(/g)?.length).toBe(2); // the SPA targets and the admin aux targets
    expect(headers).toMatch(/devVarsProblems\(app, join\(root, "apps", app, "dist"\)\)/);
  });
});
