// The staging deploy workflows (owner's yes 2026-10-30): full audit A1 5, package code (install, seed SQL, astro and vite builds) runs
// only in steps WITHOUT the Cloudflare token, and the deploy scripts upload only a staging build; A6 8, the Workers deploy one per step
// in a fixed order (admin API, admin front, portal, jobs, website) with a health check after the admin. Runs in Node (reads files).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

describe.each(["deploy-staging.yml", "publish-catalogue.yml"])("%s [A1-5]", (name) => {
  const text = workflow(name);
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

  it("builds the website in a step without the token, before the step that deploys it", () => {
    const build = running(steps, "pnpm --filter @techaust/web run build:staging");
    const deploy = running(steps, "pnpm --filter @techaust/web run deploy:staging");
    expect(build).toBeGreaterThan(-1);
    expect(hasToken(steps[build] ?? "")).toBe(false);
    expect(deploy).toBeGreaterThan(build);
  });
});

describe("deploy-staging.yml order and health checks [A6-8]", () => {
  const steps = stepsOf(workflow("deploy-staging.yml"));
  const ORDER = [
    "pnpm --filter @techaust/admin run deploy:staging:api",
    "pnpm --filter @techaust/admin run deploy:staging:front",
    "pnpm --filter @techaust/portal run deploy:staging",
    "pnpm --filter @techaust/jobs run deploy:staging",
    "pnpm --filter @techaust/web run deploy:staging",
  ];

  it("deploys the five Workers one per step, in order: admin API, admin front, portal, jobs, website", () => {
    const at = ORDER.map((c) => running(steps, c));
    for (const [i, index] of at.entries()) expect(index, ORDER[i]).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const c of ORDER) expect(steps.filter((s) => s.includes(c))).toHaveLength(1);
    expect(workflow("deploy-staging.yml")).not.toMatch(/pnpm -r[^\n]*deploy/);
  });

  it("the admin API Worker (bound by jobs as ADMIN_JOBS) is deployed before jobs", () => {
    expect(running(steps, ORDER[0] as string)).toBeLessThan(running(steps, ORDER[3] as string));
  });

  it("migrates, seeds, reads the snapshot and builds everything before the first deploy", () => {
    const first = running(steps, ORDER[0] as string);
    for (const before of [
      "Migrate and seed staging D1",
      "Fetch the published catalogue snapshot",
      "Build the admin (staging, no token)",
      "Build the portal (staging, no token)",
      "Build the website (staging, no token)",
    ])
      expect(named(steps, before), before).toBeLessThan(first);
    expect(named(steps, "Migrate and seed staging D1")).toBeGreaterThan(
      named(steps, "Write the seed SQL (no token)"),
    );
  });

  it("checks the admin's health right after its two Workers, before the portal, with the Access token only", () => {
    const health = running(steps, "node scripts/staging-health.mjs admin");
    expect(health).toBe(running(steps, ORDER[1] as string) + 1);
    expect(health).toBeLessThan(running(steps, ORDER[2] as string));
    const step = steps[health] ?? "";
    expect(hasToken(step)).toBe(false);
    expect(step).toContain(`CF_ACCESS_CLIENT_ID: ${secret("CF_ACCESS_BENCH_CLIENT_ID")}`);
    expect(step).toContain(`CF_ACCESS_CLIENT_SECRET: ${secret("CF_ACCESS_BENCH_CLIENT_SECRET")}`);
    expect(step).not.toMatch(/continue-on-error/);
  });

  it("uses no secrets beyond the existing four", () => {
    const used = [...workflow("deploy-staging.yml").matchAll(/secrets\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(used)).toEqual(
      new Set([
        "CF_API_TOKEN_STAGING",
        "CLOUDFLARE_ACCOUNT_ID",
        "CF_ACCESS_BENCH_CLIENT_ID",
        "CF_ACCESS_BENCH_CLIENT_SECRET",
      ]),
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

  it("admin has no combined deploy:staging (its two Workers deploy in separate steps)", () => {
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
