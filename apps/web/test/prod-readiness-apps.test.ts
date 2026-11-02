// scripts/check-prod-readiness.mjs beyond the website (audit A1 finding 6): "[Placeholder" copy in the admin's and the portal's
// built bundles, an empty production Turnstile site key, and queues staging has that production lacks. Runs in Node.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as ready from "../../../scripts/check-prod-readiness.mjs";

const appsDir = fileURLToPath(new URL("../..", import.meta.url));

describe("pending copy in the built bundles", () => {
  it("finds the [Placeholder] mark of an unapproved line, with a little context", () => {
    const js = 'const a="[Placeholder] A new proposal takes its Deliverables section";';
    const problems: string[] = ready.checkBundleText("portal", "client/assets/index-1.js", js);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("portal client/assets/index-1.js");
    expect(problems[0]).toContain("[Placeholder] A new proposal");
    expect(problems[0]).toContain("APPROVED_07X");
  });

  it("finds a [Placeholder: …] tag in built HTML and counts every mark", () => {
    const html = "<p>[Placeholder: owner input]</p><p>[Placeholder] two</p>";
    expect(ready.checkBundleText("admin", "client/index.html", html)).toHaveLength(2);
  });

  it("leaves the issue guard alone: the bare prefix the guard searches for, in JS and in the freeze SQL", () => {
    const guard = [
      'l.description.includes("[Placeholder")',
      "l.description.includes('[Placeholder')",
      "l.description.includes(`[Placeholder`)",
      "WHERE pl.description LIKE '%[Placeholder%'",
    ].join("\n");
    expect(ready.checkBundleText("admin", "techaust_platform_admin_api/index.js", guard)).toEqual([]);
  });

  it("a missing build is a problem, never a pass", () => {
    const empty = mkdtempSync(join(tmpdir(), "ready-apps-"));
    const problems: string[] = ready.checkBundles(empty);
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toContain("apps/admin/dist is not built");
    expect(problems.join("\n")).toContain("apps/portal/dist is not built");
  });

  it("reads every text file of a build, the Workers' bundles included", () => {
    const dir = mkdtempSync(join(tmpdir(), "ready-apps-"));
    for (const app of ["admin", "portal"]) {
      mkdirSync(join(dir, app, "dist", "client", "assets"), { recursive: true });
      mkdirSync(join(dir, app, "dist", "worker"), { recursive: true });
      writeFileSync(join(dir, app, "dist", "client", "index.html"), "<div id=root></div>");
      writeFileSync(join(dir, app, "dist", "client", "assets", "a.js"), 'x.includes("[Placeholder")');
      writeFileSync(join(dir, app, "dist", "client", "assets", "logo.png"), "[Placeholder] binary noise");
    }
    expect(ready.checkBundles(dir)).toEqual([]);
    writeFileSync(join(dir, "portal", "dist", "worker", "index.js"), 'const t="[Placeholder] Accept";');
    const problems: string[] = ready.checkBundles(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("portal worker/index.js");
  });
});

describe("production Worker configs", () => {
  const config = (prod: Record<string, unknown> | undefined) => ({
    env: {
      staging: {
        vars: { TURNSTILE_SITE_KEY: "0xstaging" },
        queues: {
          producers: [
            { binding: "EMAIL_QUEUE", queue: "techaust-staging-email" },
            { binding: "PDF_QUEUE", queue: "techaust-staging-pdf" },
          ],
          consumers: [{ queue: "techaust-staging-pdf" }, { queue: "techaust-staging-pdf-dlq" }],
        },
      },
      ...(prod ? { production: prod } : {}),
    },
  });

  it("names an empty production site key, each missing producer binding and each missing consumer", () => {
    const problems: string[] = ready.checkProductionConfig(
      "apps/portal/wrangler.jsonc",
      config({ vars: { TURNSTILE_SITE_KEY: "" } }),
      { turnstile: true },
    );
    const text = problems.join("\n");
    expect(text).toContain("TURNSTILE_SITE_KEY is empty");
    expect(text).toContain("EMAIL_QUEUE");
    expect(text).toContain("PDF_QUEUE");
    expect(text).toContain("techaust-staging-pdf-dlq");
    expect(problems).toHaveLength(5);
  });

  it("passes a production scope that has the key, the same bindings and the same consumers under its own names", () => {
    const prod = {
      vars: { TURNSTILE_SITE_KEY: "0xprod" },
      queues: {
        producers: [
          { binding: "EMAIL_QUEUE", queue: "techaust-email" },
          { binding: "PDF_QUEUE", queue: "techaust-pdf" },
        ],
        consumers: [{ queue: "techaust-pdf" }, { queue: "techaust-production-pdf-dlq" }],
      },
    };
    expect(ready.checkProductionConfig("x", config(prod), { turnstile: true })).toEqual([]);
  });

  it("ignores the site key where the Worker has no widget, and a missing env.production is a problem", () => {
    const prod = {
      queues: {
        producers: [
          { binding: "EMAIL_QUEUE", queue: "e" },
          { binding: "PDF_QUEUE", queue: "p" },
        ],
        consumers: [{ queue: "techaust-pdf" }, { queue: "techaust-pdf-dlq" }],
      },
    };
    expect(ready.checkProductionConfig("x", config(prod), { turnstile: false })).toEqual([]);
    expect(ready.checkProductionConfig("x", config(undefined), { turnstile: false })[0]).toContain(
      "no env.production",
    );
  });

  it("today's configs: production is blocked on the three site keys and on the queues (before Phase 7)", () => {
    const text = (ready.checkProductionConfigs(appsDir) as string[]).join("\n");
    for (const app of ["web", "admin", "portal"])
      expect(text).toContain(`apps/${app}/wrangler.jsonc: env.production.vars.TURNSTILE_SITE_KEY is empty`);
    expect(text).not.toContain("apps/admin/wrangler.api.jsonc: env.production.vars.TURNSTILE_SITE_KEY");
    expect(text).not.toContain("apps/admin/wrangler.finance.jsonc: env.production.vars.TURNSTILE_SITE_KEY");
    for (const where of [
      "admin/wrangler.jsonc",
      "admin/wrangler.api.jsonc",
      "admin/wrangler.finance.jsonc",
      "portal/wrangler.jsonc",
      "jobs/wrangler.jsonc",
    ]) {
      expect(text).toContain(`apps/${where}: staging sends on the queue binding EMAIL_QUEUE`);
      expect(text).toContain(`apps/${where}: staging sends on the queue binding PDF_QUEUE`);
    }
    expect(text).toContain("apps/web/wrangler.jsonc: staging sends on the queue binding LEADS_QUEUE");
    expect(text).toContain("apps/jobs/wrangler.jsonc: staging consumes techaust-staging-email");
  });

  // The fourth admin Worker (2026-11-03, L7; review finding 4): every staging service binding needs a production twin (same binding, same entrypoint, the
  // production Worker's name).
  describe("service bindings need a production twin (L7)", () => {
    const withServices = (
      staging: { binding: string; service: string; entrypoint?: string }[],
      prod: { binding: string; service: string; entrypoint?: string }[] | undefined,
    ) => ({
      env: {
        staging: { services: staging },
        production: prod === undefined ? {} : { services: prod },
      },
    });
    const advance = {
      binding: "ADMIN_ADVANCE",
      service: "techaust-platform-admin-invoices-staging",
      entrypoint: "GatewayAdvance",
    };

    it("a production finance without ADMIN_ADVANCE fails", () => {
      expect(
        ready.checkProductionConfig("apps/admin/wrangler.finance.jsonc", withServices([advance], undefined), {
          turnstile: false,
        }),
      ).toEqual([
        "apps/admin/wrangler.finance.jsonc: staging binds the service ADMIN_ADVANCE (entrypoint GatewayAdvance) but env.production has none: bind it to techaust-platform-admin-invoices (Phase 7, owner approval).",
      ]);
    });

    it("a production jobs without ADMIN_JOBS, ADMIN_ADVANCE or ADMIN_GATEWAY fails, one problem each", () => {
      const staging = [
        {
          binding: "ADMIN_JOBS",
          service: "techaust-platform-admin-invoices-staging",
          entrypoint: "BillingJobs",
        },
        {
          binding: "ADMIN_GATEWAY",
          service: "techaust-platform-admin-finance-staging",
          entrypoint: "GatewayEvents",
        },
        advance,
      ];
      const problems: string[] = ready.checkProductionConfig("j", withServices(staging, []), {
        turnstile: false,
      });
      expect(problems).toHaveLength(3);
      for (const b of ["ADMIN_JOBS", "ADMIN_GATEWAY", "ADMIN_ADVANCE"])
        expect(problems.join("\n")).toContain(`staging binds the service ${b}`);
    });

    it("a twin naming another entrypoint, the staging Worker or another Worker fails", () => {
      for (const twin of [
        { ...advance, service: "techaust-platform-admin-invoices", entrypoint: "BillingJobs" },
        { ...advance, service: "techaust-platform-admin-invoices", entrypoint: undefined },
        { ...advance },
        { ...advance, service: "techaust-platform-admin-finance" },
      ])
        expect(
          ready.checkProductionConfig("f", withServices([advance], [twin]), { turnstile: false })[0],
          JSON.stringify(twin),
        ).toMatch(
          /^f: env.production's ADMIN_ADVANCE must name techaust-platform-admin-invoices \(entrypoint GatewayAdvance\)/,
        );
    });

    it("passes the production twins, with or without an entrypoint (the front's bindings name none)", () => {
      const front = [
        { binding: "ADMIN_API", service: "techaust-platform-admin-api-staging" },
        { binding: "ADMIN_INVOICES", service: "techaust-platform-admin-invoices-staging" },
      ];
      const prod = [
        { binding: "ADMIN_API", service: "techaust-platform-admin-api" },
        { binding: "ADMIN_INVOICES", service: "techaust-platform-admin-invoices" },
        { ...advance, service: "techaust-platform-admin-invoices" },
      ];
      expect(
        ready.checkProductionConfig("x", withServices([...front, advance], prod), { turnstile: false }),
      ).toEqual([]);
    });

    it("today's configs: the invoices config is read, and finance, jobs and the portal are blocked on their service bindings (before Phase 7)", () => {
      expect(ready.PROD_CONFIGS).toContainEqual({
        app: "admin",
        file: "wrangler.invoices.jsonc",
        turnstile: false,
      });
      const text = (ready.checkProductionConfigs(appsDir) as string[]).join("\n");
      expect(text).toContain(
        "apps/admin/wrangler.invoices.jsonc: staging sends on the queue binding PDF_QUEUE",
      );
      expect(text).toContain("apps/admin/wrangler.finance.jsonc: staging binds the service ADMIN_ADVANCE");
      for (const b of ["ADMIN_JOBS", "ADMIN_ADVANCE", "ADMIN_GATEWAY"])
        expect(text).toContain(`apps/jobs/wrangler.jsonc: staging binds the service ${b}`);
      expect(text).toContain("apps/portal/wrangler.jsonc: staging binds the service ADMIN_PAY");
      // The front's production bindings already name the production Workers.
      expect(text).not.toContain("apps/admin/wrangler.jsonc: staging binds the service");
      expect(text).not.toContain("apps/admin/wrangler.jsonc: env.production's");
    });
  });

  it("checkProdReadiness includes the apps' problems", () => {
    const problems: string[] = ready.checkProdReadiness(join(appsDir, "web"), "does-not-exist.json", appsDir);
    expect(problems.join("\n")).toContain("TURNSTILE_SITE_KEY is empty");
  });
});
