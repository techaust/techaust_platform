// M7.5 (C2, L22): the config guard for the In-Worker Rate Limiting bindings (scripts/check-worker-config.mjs `rateLimitProblems`): every scope of the admin
// front and the portal lists its own bindings (they are not inherited), each purpose and scope has its own namespace id, the Workers behind the front have
// none, and the repository's configs pass.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_AUX_CONFIGS,
  parseJsonc,
  RATE_LIMITS,
  rateLimitProblems,
  type WranglerConfig,
} from "../../../scripts/check-worker-config.mjs";

const read = (p: string) =>
  parseJsonc(readFileSync(join(import.meta.dirname, "..", "..", "..", "apps", p), "utf8"));

const rl = (name: string, id: string, limit: number) => ({
  name,
  namespace_id: id,
  simple: { limit, period: 60 },
});
/** A config with the three scopes, each with `make(scopeIndex)` as its ratelimits. */
const cfg = (make: (i: number) => unknown[] | undefined): WranglerConfig => ({
  ratelimits: make(0),
  env: { staging: { ratelimits: make(1) }, production: { ratelimits: make(2) } },
});
const portalOk = cfg((i) => [
  rl("RL_SESSION", `${61 + i}01`, 120),
  rl("RL_SIGNIN", `${61 + i}02`, 10),
  rl("RL_LINKS", `${61 + i}03`, 30),
]);

describe("rateLimitProblems [M7.5 L22]", () => {
  it("the repository's admin, portal, web and auxiliary admin configs pass", () => {
    expect(
      rateLimitProblems(
        [
          ["admin", read("admin/wrangler.jsonc"), RATE_LIMITS.admin],
          ["portal", read("portal/wrangler.jsonc"), RATE_LIMITS.portal],
        ],
        [["web", read("web/wrangler.jsonc")]],
        ADMIN_AUX_CONFIGS.map((f) => [f, read(`admin/${f}`)] as [string, WranglerConfig]),
      ),
    ).toEqual([]);
    expect(RATE_LIMITS).toEqual({
      admin: { RL_SESSION: 240, RL_SIGNIN: 20, RL_INVITE: 10 },
      portal: { RL_SESSION: 120, RL_SIGNIN: 10, RL_LINKS: 30 },
    });
  });

  it("a scope that relies on inheritance (no ratelimits of its own) fails", () => {
    const c = cfg((i) =>
      i === 2
        ? undefined
        : [rl("RL_SESSION", "7201", 120), rl("RL_SIGNIN", "7202", 10), rl("RL_LINKS", "7203", 30)],
    );
    c.ratelimits = [rl("RL_SESSION", "7101", 120), rl("RL_SIGNIN", "7102", 10), rl("RL_LINKS", "7103", 30)];
    expect(rateLimitProblems([["portal", c, RATE_LIMITS.portal]])).toEqual([
      'portal env.production: ratelimits must be exactly ["RL_LINKS","RL_SESSION","RL_SIGNIN"] (not inherited: list them in every scope)',
    ]);
  });

  it("a namespace id shared between scopes, purposes or Workers fails; so does one used by another Worker", () => {
    const shared = cfg((i) => [
      rl("RL_SESSION", "6101", 120),
      rl("RL_SIGNIN", `${61 + i}02`, 10),
      rl("RL_LINKS", `${61 + i}03`, 30),
    ]);
    expect(rateLimitProblems([["portal", shared, RATE_LIMITS.portal]])).toEqual([
      "portal env.staging RL_SESSION: namespace_id 6101 is already used by portal (top level) RL_SESSION",
      "portal env.production RL_SESSION: namespace_id 6101 is already used by portal (top level) RL_SESSION",
    ]);
    const web = { ratelimits: [{ name: "RL_FORMS", namespace_id: "6102" }] };
    expect(rateLimitProblems([["portal", portalOk, RATE_LIMITS.portal]], [["web", web]])).toEqual([
      "web (top level) RL_FORMS: namespace_id 6102 is already used by portal (top level) RL_SIGNIN",
    ]);
  });

  it("a wrong limit, a period other than 60 or a namespace id that isn't a positive integer string fails", () => {
    const bad = cfg((i) =>
      i === 0
        ? [
            rl("RL_SESSION", "8101", 999),
            { name: "RL_SIGNIN", namespace_id: "8102", simple: { limit: 10, period: 10 } },
            { name: "RL_LINKS", namespace_id: 8103, simple: { limit: 30, period: 60 } },
          ]
        : (portalOk.env?.[i === 1 ? "staging" : "production"]?.ratelimits as unknown[]),
    );
    expect(rateLimitProblems([["portal", bad, RATE_LIMITS.portal]])).toEqual([
      "portal (top level) RL_SESSION: simple.limit must be 120",
      "portal (top level) RL_SIGNIN: simple.period must be 60",
      "portal (top level) RL_LINKS: namespace_id must be a positive integer, as a string",
    ]);
  });

  it("a Worker behind the front with a limiter fails (the front counts what it forwards)", () => {
    expect(rateLimitProblems([], [], [["api", { env: { staging: { ratelimits: [] } } }]])).toEqual([
      "api env.staging: no ratelimits (the front counts every request it forwards)",
    ]);
  });
});
