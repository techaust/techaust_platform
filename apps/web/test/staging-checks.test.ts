// The two deploy-time scripts (owner's yes 2026-10-30): scripts/check-staging-build.mjs refuses to upload a build that is not a staging
// one (a plain build names the production Worker; full audit A1 5), and scripts/staging-health.mjs judges a Worker's health answer
// behind Cloudflare Access (A6 8). Runs in Node; nothing here talks to Cloudflare.
import { describe, expect, it } from "vitest";
import {
  ADMIN_AUX_TARGETS,
  builtConfigProblems,
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

  it("knows the admin API and finance Workers (M6.1 stage A): their own configs and built dirs, and no other target", () => {
    expect(ADMIN_AUX_TARGETS).toEqual({
      "admin-api": { config: "wrangler.api.jsonc", dist: "techaust_platform_admin_api" },
      "admin-finance": { config: "wrangler.finance.jsonc", dist: "techaust_platform_admin_finance" },
    });
    expect(problemsFor("admin-billing")).toEqual(["unknown target admin-billing"]);
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

  it("knows every staging Worker with a URL, and admin proves its API and finance Workers through their bindings (M6.1)", () => {
    expect(Object.keys(CHECKS).sort()).toEqual(["admin", "jobs", "portal", "web"]);
    expect(CHECKS.admin.map((c) => [c.path, c.status])).toEqual([
      ["/api/v1/health", 200],
      ["/api/v1/leads", 401],
      ["/api/v1/dashboard", 401],
    ]);
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
    expect(seen).toHaveLength(3);
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
    expect(failures).toEqual(["web /api/geo: request failed: TypeError"]);
  });

  it("checks the three admin paths (front, API, finance), and refuses an unknown app", async () => {
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
    ]);
    expect(await checkApp("nope", quiet)).toEqual(["unknown app nope"]);
  });
});
