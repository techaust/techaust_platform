// T6 (07-ZE line 5, owner's Q2 answer 2026-10-31): the admin SPA's staff reply to an acceptance by email names the portal of the same environment.
// The origin has one source, `vars.PORTAL_ORIGIN` in apps/admin/wrangler.jsonc, written into the bundle at build time (scripts/website-origin.mjs,
// the constant `__PORTAL_ORIGIN__`). Each environment's value is the portal Worker of that environment.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as guard from "../../../scripts/check-worker-config.mjs";
import { portalOriginForApp, portalOriginOf } from "../../../scripts/website-origin.mjs";

const read = (path: string) =>
  guard.parseJsonc(readFileSync(new URL(path, import.meta.url), "utf8")) as {
    name: string;
    vars: Record<string, string>;
    env: Record<string, { name: string; vars: Record<string, string>; workers_dev?: boolean }>;
  };
const admin = read("../../admin/wrangler.jsonc");
const portal = read("../../portal/wrangler.jsonc");
const ADMIN = new URL("../../admin/", import.meta.url);

describe("the admin's portal origin", () => {
  it("local, staging and production point to their own portal", () => {
    expect(portalOriginOf(admin, undefined)).toBe("http://localhost:5174");
    expect(portalOriginOf(admin, "staging")).toBe(
      "https://techaust-platform-portal-staging.techaust-technologies-153.workers.dev",
    );
    expect(portalOriginOf(admin, "production")).toBe("https://portal.techaust.com");
  });

  it("each value is that environment's portal: its workers.dev name on staging, its sign-in host in production", () => {
    expect(portalOriginOf(admin, "staging")).toBe(
      `https://${portal.env.staging?.name}.techaust-technologies-153.workers.dev`,
    );
    expect(portal.env.staging?.workers_dev).toBe(true);
    expect(portalOriginOf(admin, "production")).toBe(
      `https://${portal.env.production?.vars.TURNSTILE_HOSTNAMES}`,
    );
  });

  it("reads the real file per CLOUDFLARE_ENV", () => {
    expect(portalOriginForApp(ADMIN, "")).toBe("http://localhost:5174");
    expect(portalOriginForApp(ADMIN, "staging")).toContain("techaust-platform-portal-staging");
    expect(portalOriginForApp(ADMIN, "production")).toBe("https://portal.techaust.com");
  });

  it("an empty, malformed or unknown value fails the build", () => {
    const bad = (v: string) => ({ vars: { PORTAL_ORIGIN: v }, env: {} });
    expect(() => portalOriginOf(bad(""), undefined)).toThrow(
      /portal origin: the top level has no vars.PORTAL_ORIGIN/,
    );
    expect(() => portalOriginOf(bad("https://portal.techaust.com/"), undefined)).toThrow(/must be an origin/);
    expect(() => portalOriginOf(bad("portal.techaust.com"), undefined)).toThrow(/must be an origin/);
    expect(() => portalOriginOf(admin, "nowhere")).toThrow(/not an environment/);
  });

  it("the API Worker doesn't carry it (only the SPA reads it, at build time)", () => {
    const api = read("../../admin/wrangler.api.jsonc");
    expect(api.vars.PORTAL_ORIGIN).toBeUndefined();
    for (const scope of Object.values(api.env)) expect(scope.vars.PORTAL_ORIGIN).toBeUndefined();
  });
});
