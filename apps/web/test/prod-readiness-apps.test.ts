// scripts/check-prod-readiness.mjs beyond the website (audit A1 finding 6): "[Placeholder" copy in the admin's and the portal's
// built bundles, an empty production Turnstile site key, and queues staging has that production lacks. Runs in Node.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as ready from "../../../scripts/check-prod-readiness.mjs";
// @ts-expect-error plain .mjs without types
import { parseJsonc } from "../../../scripts/check-worker-config.mjs";

type Scope = Record<string, unknown> & {
  name?: string;
  vars?: Record<string, string>;
  d1_databases?: { binding: string; database_name: string; database_id: string }[];
  r2_buckets?: { binding: string; bucket_name: string }[];
  ratelimits?: { name: string; namespace_id: string }[];
  services?: { binding: string; service: string }[];
};

/** P7-B: staging's scope as P7-A mirrors it: production names and ids, its own rate-limit namespaces, production values, no email allow-list. */
const mirror = (staging: Scope): Scope => {
  const text = JSON.stringify(staging)
    .replaceAll("techaust-staging-", "techaust-prod-")
    .replace(/techaust-platform-([a-z-]+?)-staging"/g, 'techaust-platform-$1"');
  const prod = JSON.parse(text) as Scope;
  for (const d of prod.d1_databases ?? [])
    Object.assign(d, { database_name: "techaust-prod", database_id: "prod-id" });
  for (const r of prod.ratelimits ?? []) r.namespace_id = String(Number(r.namespace_id) + 100);
  const vars = { ...(prod.vars ?? {}) };
  delete vars.EMAIL_ALLOWED_RECIPIENTS;
  for (const k of Object.keys(vars))
    vars[k] = k === "TURNSTILE_SITE_KEY" ? "0xprod" : `production-${k.toLowerCase()}`;
  return { ...prod, vars };
};

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

  it("P7-B: leaves a copy gate's own body alone (jobs' bundler keeps the unreachable branch of an approved gate)", () => {
    const gate = ["ZJ=s(e=>Xq?e:`[Placeholder] $", '{e}`,"ZJ")'].join("");
    expect(ready.checkBundleText("jobs", "dist-production/index.js", gate)).toEqual([]);
    expect(
      ready.checkBundleText("jobs", "dist-production/index.js", "`[Placeholder] Your deed`"),
    ).toHaveLength(1);
  });

  it("P7-B: a copy-approval flag left false is a problem; the real source has none", () => {
    const root = mkdtempSync(join(tmpdir(), "ready-flags-"));
    mkdirSync(join(root, "packages", "email", "src"), { recursive: true });
    mkdirSync(join(root, "apps", "portal", "worker"), { recursive: true });
    writeFileSync(
      join(root, "packages", "email", "src", "a.ts"),
      "export const APPROVED_07ZZ: boolean = false;\n",
    );
    writeFileSync(join(root, "apps", "portal", "worker", "b.ts"), "export const APPROVED_07ZY = true;\n");
    writeFileSync(
      join(root, "apps", "portal", "worker", "b.test.ts"),
      "export const APPROVED_07ZX = false;\n",
    );
    const problems: string[] = ready.checkApprovalFlags(root);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("packages/email/src/a.ts: APPROVED_07ZZ is false");
    expect(ready.checkApprovalFlags(join(appsDir, ".."))).toEqual([]);
  });

  it("a missing build is a problem, never a pass (P7-B: the jobs and website production bundles too)", () => {
    const empty = mkdtempSync(join(tmpdir(), "ready-apps-"));
    const problems: string[] = ready.checkBundles(empty);
    expect(problems).toHaveLength(4);
    expect(problems.join("\n")).toContain("apps/admin/dist is not built");
    expect(problems.join("\n")).toContain("apps/portal/dist is not built");
    expect(problems.join("\n")).toContain("apps/jobs/dist-production/index.js is not built");
    expect(problems.join("\n")).toContain("apps/web/.wrangler/dist-production/worker.js is not built");
  });

  /** A made-up apps/ folder with clean builds of the two SPAs and the two pre-bundled production Workers. */
  const cleanBuilds = () => {
    const dir = mkdtempSync(join(tmpdir(), "ready-apps-"));
    for (const app of ["admin", "portal"]) {
      mkdirSync(join(dir, app, "dist", "client", "assets"), { recursive: true });
      mkdirSync(join(dir, app, "dist", "worker"), { recursive: true });
      writeFileSync(join(dir, app, "dist", "client", "index.html"), "<div id=root></div>");
      writeFileSync(join(dir, app, "dist", "client", "assets", "a.js"), 'x.includes("[Placeholder")');
      writeFileSync(join(dir, app, "dist", "client", "assets", "logo.png"), "[Placeholder] binary noise");
    }
    mkdirSync(join(dir, "jobs", "dist-production"), { recursive: true });
    writeFileSync(join(dir, "jobs", "dist-production", "index.js"), "const g=`[Placeholder`;");
    writeFileSync(
      join(dir, "jobs", "dist-production", "index.js.map"),
      '{"sourcesContent":["[Placeholder] in a comment"]}',
    );
    mkdirSync(join(dir, "web", ".wrangler", "dist-production"), { recursive: true });
    writeFileSync(join(dir, "web", ".wrangler", "dist-production", "worker.js"), "export default {};");
    return dir;
  };

  it("reads every text file of a build, the Workers' bundles included", () => {
    const dir = cleanBuilds();
    expect(ready.checkBundles(dir)).toEqual([]);
    writeFileSync(join(dir, "portal", "dist", "worker", "index.js"), 'const t="[Placeholder] Accept";');
    const problems: string[] = ready.checkBundles(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("portal worker/index.js");
  });

  it("P7-B: reads the jobs production bundle (the emails, PDFs and bells) for pending copy, not its source map", () => {
    const dir = cleanBuilds();
    writeFileSync(
      join(dir, "jobs", "dist-production", "index.js"),
      'var r=c?c:"[Placeholder] postal address";',
    );
    const problems: string[] = ready.checkBundles(dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("jobs dist-production/index.js");
    expect(problems[0]).toContain("[Placeholder] postal address");
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

  // P7-B: the real configs' staging scopes, mirrored by hand into a production scope that differs only in values, pass both the queue and
  // service checks and the staging-production comparison (the comparison accepts exactly the P7-A shape, whatever the real production holds).
  it("every real config's staging scope, mirrored into production with production names, passes", () => {
    for (const c of ready.PROD_CONFIGS as { app: string; file: string; turnstile: boolean }[]) {
      const config = parseJsonc(readFileSync(join(appsDir, c.app, c.file), "utf8"));
      const mirrored = { ...config, env: { ...config.env, production: mirror(config.env.staging) } };
      const where = `apps/${c.app}/${c.file}`;
      expect(ready.checkEnvParity(where, mirrored), where).toEqual([]);
      expect(ready.checkProductionConfig(where, mirrored, c), where).toEqual([]);
    }
  });

  // P7-A filled every env.production block (14910a09): production now mirrors staging, the production site keys are set.
  it("today's configs: production is ready (site keys, queues, service bindings) and differs from staging only in values", () => {
    expect(ready.checkProductionConfigs(appsDir)).toEqual([]);
    for (const c of ready.PROD_CONFIGS as { app: string; file: string }[]) {
      const where = `apps/${c.app}/${c.file}`;
      const config = parseJsonc(readFileSync(join(appsDir, c.app, c.file), "utf8"));
      expect(ready.checkEnvParity(where, config), where).toEqual([]);
      // the comparison really ran: production has staging's bindings under production names
      expect(Object.keys(config.env.production.vars ?? {}).length, where).toBeGreaterThan(0);
    }
    const jobs = parseJsonc(readFileSync(join(appsDir, "jobs", "wrangler.jsonc"), "utf8"));
    expect(jobs.env.production.d1_databases[0].database_name).toBe("techaust-prod");
    expect(jobs.env.production.triggers.crons).toEqual(jobs.env.staging.triggers.crons);
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

    it("the invoices config is read", () => {
      expect(ready.PROD_CONFIGS).toContainEqual({
        app: "admin",
        file: "wrangler.invoices.jsonc",
        turnstile: false,
      });
    });
  });

  it("checkProdReadiness includes the apps' problems (their bundles and configs)", () => {
    const empty = join(mkdtempSync(join(tmpdir(), "ready-apps-")), "apps");
    mkdirSync(empty);
    const problems: string[] = ready.checkProdReadiness(join(appsDir, "web"), "does-not-exist.json", empty);
    const text = problems.join("\n");
    expect(text).toContain("apps/jobs/dist-production/index.js is not built");
    expect(text).toContain("apps/admin/wrangler.finance.jsonc is missing.");
  });
});
