// 07-W 5.5: the portal SPA's "Privacy notice" link points to the website of the same environment. The origin has one source, `vars.WEBSITE_ORIGIN`
// in apps/portal/wrangler.jsonc, written into the bundle at build time (scripts/website-origin.mjs, the constant `__WEBSITE_ORIGIN__`).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as guard from "../../../scripts/check-worker-config.mjs";
import { websiteOriginForApp, websiteOriginOf } from "../../../scripts/website-origin.mjs";

const config = guard.parseJsonc(
  readFileSync(new URL("../../portal/wrangler.jsonc", import.meta.url), "utf8"),
) as { vars: Record<string, string>; env: Record<string, { vars: Record<string, string> }> };
const APP = new URL("../../portal/", import.meta.url);

describe("the portal's website origin", () => {
  it("local, staging and production point to their own website", () => {
    expect(websiteOriginOf(config, undefined)).toBe("http://localhost:4321");
    expect(websiteOriginOf(config, "staging")).toBe(
      "https://techaust-platform-web-staging.techaust-technologies-153.workers.dev",
    );
    expect(websiteOriginOf(config, "production")).toBe("https://techaust.com");
  });

  it("reads the real file per CLOUDFLARE_ENV", () => {
    expect(websiteOriginForApp(APP, undefined)).toBe("http://localhost:4321");
    expect(websiteOriginForApp(APP, "staging")).toContain("techaust-platform-web-staging");
    expect(websiteOriginForApp(APP, "production")).toBe("https://techaust.com");
  });

  it("an empty, malformed or unknown value fails the build", () => {
    const bad = (v: string) => ({ vars: { WEBSITE_ORIGIN: v }, env: {} });
    expect(() => websiteOriginOf(bad(""), undefined)).toThrow(/no vars.WEBSITE_ORIGIN/);
    expect(() => websiteOriginOf(bad("https://techaust.com/"), undefined)).toThrow(/must be an origin/);
    expect(() => websiteOriginOf(bad("techaust.com"), undefined)).toThrow(/must be an origin/);
    expect(() => websiteOriginOf(config, "nowhere")).toThrow(/not an environment/);
  });
});
