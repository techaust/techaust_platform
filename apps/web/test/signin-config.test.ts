// M2.4b configuration of the admin and portal Workers [ADM-AUTH-06, POR-01, ADM-MAIL-01]. Runs in Node (it reads files).
// The sign-in widget's keys and hosts, the email-queue producer in every environment that has a queue, and the build-time
// site key (scripts/turnstile-site-key.mjs). Nothing here talks to Cloudflare.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as guard from "../../../scripts/check-worker-config.mjs";
import { siteKeyForApp, siteKeyOf } from "../../../scripts/turnstile-site-key.mjs";

type Scope = {
  vars?: Record<string, string>;
  secrets?: { required?: string[] };
  queues?: { producers?: { binding: string; queue: string }[] };
};
type Config = Scope & { env: { staging: Scope; production: Scope } };

const load = (app: string): Config =>
  guard.parseJsonc(readFileSync(new URL(`../../${app}/wrangler.jsonc`, import.meta.url), "utf8")) as Config;

const STAGING_KEY = "0x4AAAAAAFhrfYyx9bhG6lmt";
const TEST_KEY = "1x00000000000000000000AA";
const HOSTS = {
  admin: "techaust-platform-admin-staging.techaust-technologies-153.workers.dev",
  portal: "techaust-platform-portal-staging.techaust-technologies-153.workers.dev",
};

describe.each(["admin", "portal"] as const)("%s wrangler.jsonc", (app) => {
  const c = load(app);

  it("declares TURNSTILE_SECRET as required in every environment, production included", () => {
    for (const scope of [c, c.env.staging, c.env.production])
      expect(scope.secrets?.required).toContain("TURNSTILE_SECRET");
  });

  it("local uses Cloudflare's always-pass test key and localhost", () => {
    expect(c.vars?.TURNSTILE_SITE_KEY).toBe(TEST_KEY);
    expect(c.vars?.TURNSTILE_HOSTNAMES).toBe("localhost");
  });

  it("staging uses the sign-in widget's key and ONLY this app's staging host", () => {
    expect(c.env.staging.vars?.TURNSTILE_SITE_KEY).toBe(STAGING_KEY);
    expect(c.env.staging.vars?.TURNSTILE_HOSTNAMES).toBe(HOSTS[app]);
    // never the website's forms widget, never a test key
    expect(c.env.staging.vars?.TURNSTILE_SITE_KEY).not.toBe("0x4AAAAAAFhXQJodywYfgEIP");
  });

  it("production has an empty key (no widget until Phase 7) and no queue", () => {
    expect(c.env.production.vars?.TURNSTILE_SITE_KEY).toBe("");
    expect(c.env.production.vars?.TURNSTILE_HOSTNAMES).toBe(`${app}.techaust.com`);
    expect(c.env.production.queues).toBeUndefined();
  });

  it("produces to the email queue of each environment that has one (the jobs Worker consumes it)", () => {
    // The portal also asks the jobs Worker for the acceptance certificate (M4.5: PDF_QUEUE); the admin Worker's PDF queue arrives with M4.4.
    const pdf = (env: string) =>
      app === "portal" ? [{ binding: "PDF_QUEUE", queue: `techaust-${env}-pdf` }] : [];
    expect(c.queues?.producers).toEqual([
      { binding: "EMAIL_QUEUE", queue: "techaust-local-email" },
      ...pdf("local"),
    ]);
    expect(c.env.staging.queues?.producers).toEqual([
      { binding: "EMAIL_QUEUE", queue: "techaust-staging-email" },
      ...pdf("staging"),
    ]);
    const jobs = guard.parseJsonc(
      readFileSync(new URL("../../jobs/wrangler.jsonc", import.meta.url), "utf8"),
    ) as { queues: { consumers: { queue: string }[] }; env: { staging: { queues: typeof c.queues } } };
    expect(jobs.queues.consumers.map((q) => q.queue)).toContain("techaust-local-email");
    expect(
      (jobs.env.staging.queues as unknown as { consumers: { queue: string }[] }).consumers.map(
        (q) => q.queue,
      ),
    ).toContain("techaust-staging-email");
  });

  it("keeps Preview URLs off (the existing guard)", () => {
    expect(guard.missingPreviewOff(c)).toEqual([]);
  });
});

describe("the build-time site key (scripts/turnstile-site-key.mjs)", () => {
  const admin = new URL("../../admin/", import.meta.url);
  const portal = new URL("../../portal/", import.meta.url);

  it("a local build gets the test key; a staging build gets the sign-in widget's key", () => {
    for (const dir of [admin, portal]) {
      expect(siteKeyForApp(dir, undefined)).toBe(TEST_KEY);
      expect(siteKeyForApp(dir, "staging")).toBe(STAGING_KEY);
      expect(siteKeyForApp(dir, "production")).toBe("");
    }
  });

  it("a staging build with an empty key fails, and so does an unknown environment", () => {
    expect(() => siteKeyOf({ env: { staging: { vars: { TURNSTILE_SITE_KEY: "" } } } }, "staging")).toThrow(
      /no TURNSTILE_SITE_KEY/,
    );
    expect(() => siteKeyOf({ env: { staging: { vars: {} } } }, "staging")).toThrow(/no TURNSTILE_SITE_KEY/);
    expect(() => siteKeyOf({ env: {} }, "qa")).toThrow(/not an environment/);
    expect(siteKeyOf({ vars: { TURNSTILE_SITE_KEY: "k" } }, undefined)).toBe("k");
    expect(siteKeyOf({}, undefined)).toBe("");
  });
});

describe("what the admin and portal Workers import (CPU budget: the Free plan's 10 ms)", () => {
  for (const app of ["admin", "portal"] as const) {
    const dir = new URL(`../../${app}/worker/`, import.meta.url);
    const sources = readdirSync(dir)
      .filter(
        (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.startsWith("test-") && f !== "fixtures.ts",
      )
      .map((f) => [f, readFileSync(new URL(f, dir), "utf8")] as const);

    it(`${app}: no @techaust/email, and @techaust/core only as types (the zod schemas stay out of the bundle)`, () => {
      expect(sources.length).toBeGreaterThan(3);
      for (const [file, text] of sources) {
        expect(text, `${app}/worker/${file}`).not.toMatch(/from\s+["']@techaust\/email/);
        // a value import is `import …` that is not `import type …`
        const valueImports = [
          ...text.matchAll(/^import(?!\s+type\s)\s[^;]*?from\s+["']@techaust\/core["']/gm),
        ];
        expect(valueImports, `${app}/worker/${file} imports the core index as a value`).toEqual([]);
      }
    });
  }
});
