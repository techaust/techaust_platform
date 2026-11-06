// M7.5 (owner's Q3 A, 2026-11-01): one Worker's staging deploy from a job that installed ONLY wrangler (`@techaust/deploy-tools`, the apps' pinned version)
// and downloaded the build job's artifact. No package code runs here: the SPAs come built by `build:staging` (their flattened configs name the staging
// Workers), jobs and the website's Worker come pre-bundled by `wrangler deploy --dry-run --env staging --outdir` and are uploaded with `--no-bundle`.
// Each deploy first checks the build is a staging one (scripts/check-staging-build.mjs: the Worker name, the website's Turnstile key, no `.dev.vars`).
//
//   node scripts/deploy-worker.mjs staging admin-api|admin-invoices|admin-finance|admin|portal|jobs|web
// Production deploys come at Phase 7 (L3-L4): this script refuses them until then.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { devVarsProblems, problemsFor } from "./check-staging-build.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const WRANGLER = "tools/deploy/node_modules/wrangler/bin/wrangler.js";

/** The pre-bundled Worker of jobs and the website (the build job's `wrangler deploy --dry-run --env staging --outdir <dir>`). */
export const PREBUNDLED = { jobs: "dist-staging", web: ".wrangler/dist-staging" };

/** Where wrangler runs and with what, per target (staging). */
export const STAGING_DEPLOYS = {
  "admin-api": { app: "admin", args: ["--config", "dist/techaust_platform_admin_api/wrangler.json"] },
  "admin-invoices": {
    app: "admin",
    args: ["--config", "dist/techaust_platform_admin_invoices/wrangler.json"],
  },
  "admin-finance": { app: "admin", args: ["--config", "dist/techaust_platform_admin_finance/wrangler.json"] },
  // The front and the portal: the Vite plugin's redirect (.wrangler/deploy/config.json) points wrangler at the flattened staging config.
  admin: { app: "admin", args: [] },
  portal: { app: "portal", args: [] },
  jobs: { app: "jobs", args: ["--env", "staging", "--no-bundle", `${PREBUNDLED.jobs}/index.js`] },
  web: { app: "web", args: ["--env", "staging", "--no-bundle", `${PREBUNDLED.web}/index.js`] },
};

/** Problems before a staging deploy of `target` (an empty list: deploy). */
export function preDeployProblems(target, root = ROOT) {
  const d = STAGING_DEPLOYS[target];
  if (!d) return [`unknown target ${target} (known: ${Object.keys(STAGING_DEPLOYS).join(", ")})`];
  if (!existsSync(join(root, WRANGLER)))
    return [`${WRANGLER} is missing: install @techaust/deploy-tools first`];
  if (target === "jobs" || target === "web") {
    const bundle = join(root, "apps", target, PREBUNDLED[target], "index.js");
    const problems = existsSync(bundle)
      ? []
      : [`apps/${target}/${PREBUNDLED[target]}/index.js is missing: the build job pre-bundles it`];
    if (target === "web")
      problems.push(...problemsFor("web"), ...devVarsProblems("web", join(root, "apps", "web", "dist")));
    else problems.push(...devVarsProblems("jobs", join(root, "apps", "jobs", PREBUNDLED.jobs)));
    return problems;
  }
  return problemsFor(target);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [scope, target] = process.argv.slice(2);
  if (scope !== "staging") {
    console.error("deploy-worker: only `staging` deploys exist before Phase 7 (production comes at L3-L4).");
    process.exit(2);
  }
  const problems = preDeployProblems(target ?? "");
  if (problems.length > 0) {
    for (const p of problems) console.error(`deploy (${target}): ${p}`);
    process.exit(1);
  }
  const d = STAGING_DEPLOYS[target];
  const r = spawnSync(process.execPath, [join(ROOT, WRANGLER), "deploy", ...d.args], {
    cwd: join(ROOT, "apps", d.app),
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}
