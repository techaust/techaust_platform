// The staging deploy workflows (owner's yes 2026-10-30): full audit A1 5, package code (install, seed SQL, astro and vite builds) runs
// only in steps WITHOUT the Cloudflare token, and the deploy scripts upload only a staging build; A6 8, the Workers deploy one per step
// in a fixed order (from M6.5, owner's Q3 A 2026-11-02: admin API, admin invoices, admin finance, admin front, portal, jobs, website) with a
// health check after each app (the admin's once its four Workers are new). M7.5 (owner's Q3 A): three jobs, the token only in the two that install
// nothing but wrangler. Runs in Node (reads files).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import * as d from "../../../scripts/deploy-worker.mjs";

const read = (path: string) =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const workflow = (name: string) => read(`.github/workflows/${name}`);
const scripts = (app: string): Record<string, string> => JSON.parse(read(`apps/${app}/package.json`)).scripts;

/** The steps of a workflow's single job, each as its YAML text without comment lines (a comment above a step is not its code). */
const stepsOf = (text: string) =>
  text
    .slice(text.indexOf("    steps:\n"))
    .split("\n      - ")
    .slice(1)
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("#"))
        .join("\n"),
    );
/** `${{ secrets.NAME }}` as the workflow writes it. */
const secret = (name: string) => ["$", "{{ secrets.", name, " }}"].join("");
const hasToken = (step: string) => step.includes("CLOUDFLARE_API_TOKEN");
const named = (steps: string[], name: string) => steps.findIndex((s) => s.includes(`name: ${name}`));
const running = (steps: string[], command: string) => steps.findIndex((s) => s.includes(command));

/** Commands that run package code, which must never share a step with the token. */
const PACKAGE_CODE = [
  "pnpm install",
  "seed:sql",
  "build:staging",
  "astro build",
  "vite build",
  "pnpm build",
  "pnpm -r",
];

describe("publish-catalogue.yml [A1-5]", () => {
  const text = workflow("publish-catalogue.yml");
  const steps = stepsOf(text);

  it("sets no secret at the job or workflow level", () => {
    const head = text.slice(0, text.indexOf("    steps:\n"));
    expect(head).not.toMatch(/secrets\./);
  });

  it("never runs package code in a step that has the Cloudflare token", () => {
    for (const step of steps.filter(hasToken))
      for (const command of PACKAGE_CODE) expect(step, `a token step runs ${command}`).not.toContain(command);
  });

  it("gives the token only to the credentials check and the wrangler steps", () => {
    const allowed = [
      "name: Check staging credentials",
      "wrangler d1 ",
      "node scripts/fetch-catalogue-snapshot.mjs",
      "run deploy:staging",
    ];
    for (const step of steps.filter(hasToken))
      expect(
        allowed.some((a) => step.includes(a)),
        step.split("\n")[0],
      ).toBe(true);
  });
});

/** One job's text of a workflow (from `  <name>:` to the next job or the end). */
const jobOf = (text: string, name: string) => {
  const start = text.indexOf(`\n  ${name}:\n`);
  if (start < 0) return "";
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};

/** Commands that run workspace package code: never in a job that holds the Cloudflare token (M7.5, owner's Q3 A). */
const WORKSPACE_CODE = [
  ...PACKAGE_CODE,
  "pnpm --filter @techaust/admin",
  "pnpm --filter @techaust/portal",
  "pnpm --filter @techaust/web",
  "pnpm --filter @techaust/jobs",
  "pnpm --filter @techaust/db",
];
const WRANGLER_ONLY = "pnpm install --frozen-lockfile --filter @techaust/deploy-tools";

describe("deploy-staging.yml: three jobs, the token only where nothing but wrangler is installed (M7.5, owner's Q3 A) [A1-5]", () => {
  const text = workflow("deploy-staging.yml");
  const prepare = jobOf(text, "prepare");
  const build = jobOf(text, "build");
  const deploy = jobOf(text, "deploy");

  it("has the three jobs, in order, the later ones needing the earlier", () => {
    for (const j of [prepare, build, deploy]) expect(j.length).toBeGreaterThan(100);
    expect(build).toContain("needs: prepare");
    expect(deploy).toContain("needs: [prepare, build]");
    expect(text.indexOf("\n  prepare:\n")).toBeLessThan(text.indexOf("\n  build:\n"));
    expect(text.indexOf("\n  build:\n")).toBeLessThan(text.indexOf("\n  deploy:\n"));
  });

  it("sets no secret at the workflow level, and the build job reaches none at all", () => {
    expect(text.slice(0, text.indexOf("\njobs:\n"))).not.toMatch(/secrets\./);
    expect(build).not.toMatch(/secrets\./);
    expect(build).not.toMatch(/CLOUDFLARE_API_TOKEN/);
  });

  it.each([
    ["prepare", prepare],
    ["deploy", deploy],
  ])("the %s job installs only wrangler and runs no workspace package code", (_name, job) => {
    expect(job).toContain(WRANGLER_ONLY);
    const lines = job.split("\n").filter((l) => !l.trim().startsWith("#"));
    for (const line of lines) {
      if (line.includes(WRANGLER_ONLY)) continue;
      for (const command of WORKSPACE_CODE) expect(line, `${_name} runs ${command}`).not.toContain(command);
    }
  });

  it("the token reaches only the credentials check, the wrangler steps and the deploys", () => {
    for (const [job, allowed] of [
      [
        prepare,
        [
          "name: Check staging credentials",
          "wrangler.js d1 migrations apply",
          "node scripts/fetch-catalogue-snapshot.mjs",
        ],
      ],
      [deploy, ["wrangler.js d1 execute DB", "node scripts/deploy-worker.mjs staging"]],
    ] as const)
      for (const step of stepsOf(job).filter(hasToken))
        expect(
          allowed.some((a) => step.includes(a)),
          step.split("\n")[0],
        ).toBe(true);
  });

  it("migrates and reads the snapshot first; builds and bundles with no token; seeds before the first Worker deploys", () => {
    const p = stepsOf(prepare);
    expect(named(p, "Migrate staging D1")).toBeLessThan(named(p, "Fetch the published catalogue snapshot"));
    const b = stepsOf(build);
    for (const name of [
      "Write the seed SQL (no token)",
      "Build the admin (staging, no token)",
      "Build the portal (staging, no token)",
      "Build the website (staging, no token)",
      "Bundle the jobs and website Workers (staging, no token)",
    ])
      expect(named(b, name), name).toBeGreaterThan(-1);
    expect(build).toContain("include-hidden-files: true");
    const d = stepsOf(deploy);
    expect(named(d, "Seed staging D1")).toBeLessThan(
      running(d, "node scripts/deploy-worker.mjs staging admin-api"),
    );
    expect(running(d, "actions/download-artifact")).toBeLessThan(named(d, "Seed staging D1"));
  });

  const ORDER = [
    "node scripts/deploy-worker.mjs staging admin-api",
    "node scripts/deploy-worker.mjs staging admin-invoices",
    "node scripts/deploy-worker.mjs staging admin-finance",
    "node scripts/deploy-worker.mjs staging admin\n",
    "node scripts/deploy-worker.mjs staging portal",
    "node scripts/deploy-worker.mjs staging jobs",
    "node scripts/deploy-worker.mjs staging web",
  ];
  const steps = stepsOf(deploy).map((s) => `${s}\n`);

  it("deploys the seven Workers one per step, in order: admin API, admin invoices, admin finance, admin front, portal, jobs, website", () => {
    const at = ORDER.map((c) => running(steps, c));
    for (const [i, index] of at.entries()) expect(index, ORDER[i]).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const c of ORDER) expect(steps.filter((s) => s.includes(c))).toHaveLength(1);
    for (const [i, index] of at.entries())
      expect(steps[index], ORDER[i]).toContain(`name: Deploy ${i + 1} of 7,`);
  });

  it.each([
    ["admin", 3],
    ["portal", 4],
    ["jobs", 5],
    ["web", 6],
  ] as const)(
    "checks the %s health right after its (last) deploy, with the deploy-check token only",
    (app, at) => {
      const health = running(steps, `node scripts/staging-health.mjs ${app}`);
      expect(health).toBe(running(steps, ORDER[at] as string) + 1);
      const step = steps[health] ?? "";
      expect(hasToken(step)).toBe(false);
      expect(step).toContain(`CF_ACCESS_CLIENT_ID: ${secret("CF_ACCESS_DEPLOY_CLIENT_ID")}`);
      expect(step).toContain(`CF_ACCESS_CLIENT_SECRET: ${secret("CF_ACCESS_DEPLOY_CLIENT_SECRET")}`);
      expect(step).not.toMatch(/continue-on-error/);
    },
  );

  it("the deploy-check token is checked in the first job, and reaches no step but that check and the health checks", () => {
    expect(named(stepsOf(prepare), "Check the deploy-check token is set")).toBeGreaterThan(-1);
    for (const job of [prepare, build, deploy])
      for (const step of stepsOf(job))
        if (step.includes("CF_ACCESS_DEPLOY"))
          expect(
            step.includes("name: Check the deploy-check token is set") ||
              step.includes("node scripts/staging-health.mjs"),
          ).toBe(true);
  });

  it("uses no secrets beyond the existing two and the deploy-check token", () => {
    const used = [...text.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(used)).toEqual(
      new Set([
        "CF_API_TOKEN_STAGING",
        "CLOUDFLARE_ACCOUNT_ID",
        "CF_ACCESS_DEPLOY_CLIENT_ID",
        "CF_ACCESS_DEPLOY_CLIENT_SECRET",
      ]),
    );
  });

  it("runs only for pushes to this repository's main (never a fork's pull request)", () => {
    expect(prepare).toContain("github.event.workflow_run.event == 'push'");
    expect(prepare).toContain("github.event.workflow_run.head_repository.full_name == github.repository");
    expect(build).toContain("if: needs.prepare.outputs.ready == 'true'");
    expect(deploy).toContain("if: needs.prepare.outputs.ready == 'true'");
  });
});

describe("deploy-prod.yml: build without secrets, deploy with wrangler only (M7.5, owner's Q3 A)", () => {
  const text = workflow("deploy-prod.yml");
  const build = jobOf(text, "build");
  const deploy = jobOf(text, "deploy");

  it("the build job has no environment and no secret, runs the readiness and .dev.vars checks, and hands an artifact on", () => {
    expect(build).toContain("needs: guard");
    expect(build).not.toMatch(/secrets\.|environment:/);
    expect(build).toContain("node scripts/check-prod-readiness.mjs");
    expect(build).toContain("node scripts/check-staging-build.mjs dev-vars");
    expect(build).toContain("actions/upload-artifact@");
  });

  it("the deploy job holds the production environment and installs only wrangler", () => {
    expect(deploy).toContain("needs: build");
    expect(deploy).toContain("environment: production");
    expect(deploy).toContain(WRANGLER_ONLY);
    expect(deploy).toContain("actions/download-artifact@");
    for (const line of deploy
      .split("\n")
      .filter((l) => !l.trim().startsWith("#") && !l.includes(WRANGLER_ONLY)))
      for (const command of WORKSPACE_CODE) expect(line).not.toContain(command);
  });
});

describe("scripts/deploy-worker.mjs (M7.5, owner's Q3 A)", () => {
  it("knows the seven staging targets; jobs and the website go up pre-bundled, never re-bundled", () => {
    expect(Object.keys(d.STAGING_DEPLOYS).sort()).toEqual(
      ["admin", "admin-api", "admin-finance", "admin-invoices", "jobs", "portal", "web"].sort(),
    );
    expect(d.STAGING_DEPLOYS.jobs.args).toEqual(["--env", "staging", "--no-bundle", "dist-staging/index.js"]);
    expect(d.STAGING_DEPLOYS.web.args).toContain("--no-bundle");
    expect(d.WRANGLER).toBe("tools/deploy/node_modules/wrangler/bin/wrangler.js");
  });

  it("refuses an unknown target, and a missing wrangler or bundle, before anything runs", () => {
    expect(d.preDeployProblems("production-web").join()).toMatch(/unknown target/);
    const empty = fileURLToPath(new URL("./fixtures/", import.meta.url));
    expect(d.preDeployProblems("jobs", empty).join()).toMatch(/deploy-tools/);
  });

  it("the deploy-tools package installs wrangler alone, at the apps' pinned version", () => {
    const tools = JSON.parse(read("tools/deploy/package.json"));
    expect(tools.dependencies).toBeUndefined();
    expect(Object.keys(tools.devDependencies)).toEqual(["wrangler"]);
    expect(tools.devDependencies.wrangler).toBe(
      JSON.parse(read("apps/jobs/package.json")).devDependencies.wrangler,
    );
  });
});

describe("the apps' staging scripts [A1-5]", () => {
  it.each([
    ["admin", "CLOUDFLARE_ENV=staging vite build"],
    ["portal", "CLOUDFLARE_ENV=staging vite build"],
    ["web", "CLOUDFLARE_ENV=staging astro build"],
  ])("%s: build:staging builds for staging and deploys nothing", (app, build) => {
    const s = scripts(app)["build:staging"] ?? "";
    expect(s.startsWith(build)).toBe(true);
    expect(s).not.toContain("wrangler deploy");
  });

  const DEPLOYS: [string, string, string][] = [
    ["admin", "deploy:staging:api", "admin-api"],
    ["admin", "deploy:staging:finance", "admin-finance"],
    // The fourth admin Worker (2026-11-03).
    ["admin", "deploy:staging:invoices", "admin-invoices"],
    ["admin", "deploy:staging:front", "admin"],
    ["portal", "deploy:staging", "portal"],
    ["web", "deploy:staging", "web"],
  ];
  it.each(DEPLOYS)(
    "%s %s checks the build is a staging one, then only runs wrangler",
    (app, name, target) => {
      const parts = (scripts(app)[name] ?? "").split("&&").map((x) => x.trim());
      expect(parts[0]).toBe(`node ../../scripts/check-staging-build.mjs ${target}`);
      expect(parts.slice(1).every((p) => p.startsWith("wrangler deploy"))).toBe(true);
      expect(parts).toHaveLength(2);
    },
  );

  it("jobs deploys with wrangler alone (it bundles; no build step of its own)", () => {
    expect(scripts("jobs")["deploy:staging"]).toBe("wrangler deploy --env staging");
  });

  it("admin has no combined deploy:staging (its four Workers deploy in separate steps)", () => {
    expect(scripts("admin")["deploy:staging"]).toBeUndefined();
  });

  it.each(["admin", "portal", "web", "jobs"])("%s has no pre/post deploy or build hooks", (app) => {
    for (const key of Object.keys(scripts(app))) expect(key).not.toMatch(/^(pre|post)(deploy|build)/);
  });
});

describe("renovate.json [A1-5]", () => {
  const config = JSON.parse(read("renovate.json"));
  it("automerges nothing, devDependency updates included", () => {
    expect(read("renovate.json")).not.toMatch(/"automerge":\s*true/);
    expect(config.automerge).toBe(false);
    const dev = config.packageRules.find((r: { matchDepTypes?: string[] }) =>
      r.matchDepTypes?.includes("devDependencies"),
    );
    expect(dev?.automerge).toBe(false);
  });
});
