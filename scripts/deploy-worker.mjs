// M7.5 (owner's Q3 A, 2026-11-01): one Worker's staging deploy from a job that installed ONLY wrangler (`@techaust/deploy-tools`, the apps' pinned version)
// and downloaded the build job's artifact. No package code runs here: the SPAs come built by `build:staging` (their flattened configs name the staging
// Workers), jobs and the website's Worker come pre-bundled by `wrangler deploy --dry-run --env staging --outdir` and are uploaded with `--no-bundle`.
// Each deploy first checks the build is a staging one (scripts/check-staging-build.mjs: the Worker name, the website's Turnstile key, no `.dev.vars`).
// L51 (review 1, finding 2): the artifact comes from a job that ran package code, so the configs in it are not trusted either. `wrangler deploy` RUNS a
// config's `build.command` (wrangler `runCustomBuild`) with the token in its environment: the config each deploy will use is checked first (the redirect
// stays inside `dist`, no `build` key, no key outside FLATTENED_KEYS, `no_bundle`, `main` and the assets inside `dist`; `configProblems`).
//
//   node scripts/deploy-worker.mjs staging|production admin-api|admin-invoices|admin-finance|admin|portal|jobs|web
//   node scripts/deploy-worker.mjs production --check     (every production target's checks, nothing deployed: deploy-prod.yml runs it before
//                                                         the migrations, so a wrong build stops the run before anything changes)
// P7 (docs/runs/p7-launch.md P7-B): production deploys the same way from deploy-prod.yml, with the production builds (`build:production`,
// `wrangler deploy --dry-run --env production --outdir`) and their own guard (scripts/check-prod-build.mjs: the production Worker, no staging
// host or key).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { problemsFor as productionProblemsFor } from "./check-prod-build.mjs";
import { devVarsProblems, problemsFor } from "./check-staging-build.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const WRANGLER = "tools/deploy/node_modules/wrangler/bin/wrangler.js";

/**
 * The pre-bundled Worker of jobs and the website (the build job's `wrangler deploy --dry-run --env staging --outdir <dir>`): the entry keeps its source's
 * name (jobs `src/index.ts` -> index.js, the website's `src/worker.ts` -> worker.js). Checked locally 2026-11-07: `--no-bundle` uploads the same bytes as a
 * bundling deploy (jobs 836.35 KiB, website 293.98 KiB, dry runs).
 */
export const PREBUNDLED = { jobs: "dist-staging/index.js", web: ".wrangler/dist-staging/worker.js" };
/** P7: the production twins (`wrangler deploy --dry-run --env production --outdir <dir>` in deploy-prod.yml's build job). */
export const PREBUNDLED_PRODUCTION = {
  jobs: "dist-production/index.js",
  web: ".wrangler/dist-production/worker.js",
};

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
  jobs: { app: "jobs", args: ["--env", "staging", "--no-bundle", PREBUNDLED.jobs] },
  web: { app: "web", args: ["--env", "staging", "--no-bundle", PREBUNDLED.web] },
};

/**
 * P7: where wrangler runs and with what, per target (production). The SPAs' flattened configs come from `CLOUDFLARE_ENV=production vite build`
 * (the same paths as staging's: the Vite plugin names the folders after the top-level Worker names); jobs and the website deploy their
 * checked-out wrangler.jsonc with `--env production`, pre-bundled. No config has a route or a custom domain: the lead attaches the domains.
 */
export const PRODUCTION_DEPLOYS = {
  "admin-api": STAGING_DEPLOYS["admin-api"],
  "admin-invoices": STAGING_DEPLOYS["admin-invoices"],
  "admin-finance": STAGING_DEPLOYS["admin-finance"],
  admin: STAGING_DEPLOYS.admin,
  portal: STAGING_DEPLOYS.portal,
  jobs: { app: "jobs", args: ["--env", "production", "--no-bundle", PREBUNDLED_PRODUCTION.jobs] },
  web: { app: "web", args: ["--env", "production", "--no-bundle", PREBUNDLED_PRODUCTION.web] },
};

/** The deploy table, the pre-bundled files and the build guard of one scope. */
export const SCOPES = {
  staging: { deploys: STAGING_DEPLOYS, prebundled: PREBUNDLED, guard: problemsFor },
  production: {
    deploys: PRODUCTION_DEPLOYS,
    prebundled: PREBUNDLED_PRODUCTION,
    guard: productionProblemsFor,
  },
};

/** The order both deploy workflows deploy in (from M6.5, owner's Q3 A 2026-11-02). */
export const DEPLOY_ORDER = [
  "admin-api",
  "admin-invoices",
  "admin-finance",
  "admin",
  "portal",
  "jobs",
  "web",
];

/**
 * L51 (review 1, finding 2): the top-level keys a flattened Worker config may have. Taken on 2026-11-07 from today's real builds (`CLOUDFLARE_ENV=staging
 * vite build`, @cloudflare/vite-plugin with wrangler 4.156.2): the admin's four `dist/<worker>/wrangler.json` and the portal's one hold exactly these keys
 * (the admin invoices Worker has no `secrets`; only the front and the portal have `assets`). A key outside the list is refused, so a plugin update that
 * adds one fails the deploy loudly (read what it does, then add it here); `build` (a custom build `wrangler deploy` runs) is never in it.
 */
export const FLATTENED_KEYS = Object.freeze([
  "agent_memory",
  "ai_search",
  "ai_search_namespaces",
  "analytics_engine_datasets",
  "artifacts",
  "assets",
  "cloudchamber",
  "compatibility_date",
  "compatibility_flags",
  "configPath",
  "connect",
  "d1_databases",
  "definedEnvironments",
  "dev",
  "dispatch_namespaces",
  "durable_objects",
  "exports",
  "flagship",
  "hyperdrive",
  "jsx_factory",
  "jsx_fragment",
  "k2",
  "kv_namespaces",
  "logfwdr",
  "main",
  "migrations",
  "mtls_certificates",
  "name",
  "no_bundle",
  "observability",
  "pipelines",
  "preview_urls",
  "python_modules",
  "queues",
  "r2_buckets",
  "ratelimits",
  "rules",
  "secrets",
  "secrets_store_secrets",
  "send_email",
  "services",
  "targetEnvironment",
  "topLevelName",
  "triggers",
  "unsafe_hello_world",
  "upload_source_maps",
  "userConfigPath",
  "vars",
  "vectorize",
  "vpc_networks",
  "vpc_services",
  "worker_loaders",
  "workers_dev",
  "workflows",
]);

/** The redirect file the Vite plugin writes; `wrangler deploy` with no `--config` follows it. */
export const REDIRECT = ".wrangler/deploy/config.json";

/** `path` lies strictly inside `dir` (both through their real paths where they exist, so a symlink can't lead out). */
function inside(dir, path) {
  const real = (p) => (existsSync(p) ? realpathSync(p) : resolve(p));
  const rel = relative(real(dir), real(path));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** A path from a config written on any OS (the plugin writes `..\..\dist\…` on Windows), resolved against `base`. */
const resolveFrom = (base, p) => resolve(base, String(p).replaceAll("\\", "/"));
const shown = (root, p) => relative(root, p).replaceAll("\\", "/");

/**
 * L51: the problems of one flattened config `wrangler deploy` would use (`configFile` absolute, `distDir` the app's `dist`). Empty: deploy it. It must sit
 * inside `dist`, be a JSON object with no `build` and no key outside FLATTENED_KEYS, be `no_bundle` (wrangler uploads what the build made and bundles
 * nothing), and its `main` and `assets.directory` must stay inside `dist`.
 */
export function flattenedConfigProblems(configFile, distDir, scope = "staging") {
  const where = shown(dirname(distDir), configFile);
  if (!inside(distDir, configFile)) return [`${where} is outside dist: refused`];
  if (!existsSync(configFile)) return [`${where} is missing: run the app's build:${scope} first`];
  let config;
  try {
    config = JSON.parse(readFileSync(configFile, "utf8"));
  } catch {
    return [`${where} is not JSON`];
  }
  if (typeof config !== "object" || config === null || Array.isArray(config))
    return [`${where} is not a config object`];
  const problems = [];
  if (Object.hasOwn(config, "build"))
    problems.push(`${where} has a "build" key (wrangler would run it with the token): refused`);
  const allowed = new Set(FLATTENED_KEYS);
  const extra = Object.keys(config).filter((k) => k !== "build" && !allowed.has(k));
  if (extra.length > 0) problems.push(`${where} has keys outside the allow list: ${extra.sort().join(", ")}`);
  if (config.no_bundle !== true) problems.push(`${where} is not no_bundle: wrangler would bundle it`);
  const base = dirname(configFile);
  if (typeof config.main !== "string" || !inside(distDir, resolveFrom(base, config.main)))
    problems.push(`${where}: main is missing or outside dist`);
  if (config.assets !== undefined) {
    const dir = config.assets?.directory;
    if (typeof dir !== "string" || !inside(distDir, resolveFrom(base, dir)))
      problems.push(`${where}: assets.directory is missing or outside dist`);
  }
  return problems;
}

/**
 * L51: the admin front's and the portal's deploy follows `apps/<app>/.wrangler/deploy/config.json`. Its `configPath`, and every auxiliary Worker's, must
 * stay inside `apps/<app>/dist`, and the config it names must pass `flattenedConfigProblems`.
 */
export function redirectProblems(app, root = ROOT, scope = "staging") {
  const appDir = join(root, "apps", app);
  const distDir = join(appDir, "dist");
  const file = join(appDir, REDIRECT);
  if (!existsSync(file)) return [`apps/${app}/${REDIRECT} is missing: run the app's build:${scope} first`];
  let redirect;
  try {
    redirect = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [`apps/${app}/${REDIRECT} is not JSON`];
  }
  if (typeof redirect?.configPath !== "string") return [`apps/${app}/${REDIRECT} names no configPath`];
  const base = dirname(file);
  const problems = flattenedConfigProblems(resolveFrom(base, redirect.configPath), distDir, scope);
  const aux = redirect.auxiliaryWorkers ?? [];
  if (!Array.isArray(aux)) problems.push(`apps/${app}/${REDIRECT}: auxiliaryWorkers is not a list`);
  else
    for (const w of aux)
      if (typeof w?.configPath !== "string" || !inside(distDir, resolveFrom(base, w.configPath)))
        problems.push(`apps/${app}/${REDIRECT}: an auxiliary Worker's config is outside dist: refused`);
  return problems;
}

/** L51: the config each deploy of `scope` will use, checked (the admin Workers behind the front name theirs with `--config`). */
export function configProblems(target, root = ROOT, scope = "staging") {
  const d = SCOPES[scope]?.deploys[target];
  if (!d) return [`unknown target ${target}`];
  if (target === "admin" || target === "portal") return redirectProblems(target, root, scope);
  const at = d.args.indexOf("--config");
  if (at >= 0) {
    const appDir = join(root, "apps", d.app);
    return flattenedConfigProblems(resolve(appDir, d.args[at + 1]), join(appDir, "dist"), scope);
  }
  // jobs and the website deploy their checked-out wrangler.jsonc with `--env staging` (or `--env production`): a redirect file there would point
  // wrangler at a config the build job wrote, so none may exist.
  return existsSync(join(root, "apps", d.app, REDIRECT))
    ? [`apps/${d.app}/${REDIRECT} exists, but ${target} deploys its own wrangler.jsonc: refused`]
    : [];
}

/** Problems before a deploy of `target` in `scope` (staging by default; an empty list: deploy). */
export function preDeployProblems(target, root = ROOT, scope = "staging") {
  const s = SCOPES[scope];
  if (!s) return [`unknown scope ${scope} (known: ${Object.keys(SCOPES).join(", ")})`];
  const d = s.deploys[target];
  if (!d) return [`unknown target ${target} (known: ${Object.keys(s.deploys).join(", ")})`];
  if (!existsSync(join(root, WRANGLER)))
    return [`${WRANGLER} is missing: install @techaust/deploy-tools first`];
  if (target === "jobs" || target === "web") {
    const file = s.prebundled[target];
    const bundle = join(root, "apps", target, file);
    const problems = existsSync(bundle)
      ? []
      : [`apps/${target}/${file} is missing: the build job pre-bundles it`];
    if (scope === "production") problems.push(...s.guard(target));
    else if (target === "web")
      problems.push(...problemsFor("web"), ...devVarsProblems("web", join(root, "apps", "web", "dist")));
    else problems.push(...devVarsProblems("jobs", join(root, "apps", "jobs", "dist-staging")));
    problems.push(...configProblems(target, root, scope));
    return problems;
  }
  return [...s.guard(target), ...configProblems(target, root, scope)];
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [scope, target] = process.argv.slice(2);
  if (!SCOPES[scope]) {
    console.error("usage: node scripts/deploy-worker.mjs staging|production <target>, or production --check");
    process.exit(2);
  }
  if (target === "--check") {
    const all = DEPLOY_ORDER.flatMap((t) =>
      preDeployProblems(t, ROOT, scope).map((p) => `deploy (${scope} ${t}): ${p}`),
    );
    for (const p of all) console.error(p);
    if (all.length > 0) process.exit(1);
    console.log(`deploy-worker: every ${scope} build passes its checks (${DEPLOY_ORDER.join(", ")})`);
    process.exit(0);
  }
  const problems = preDeployProblems(target ?? "", ROOT, scope);
  if (problems.length > 0) {
    for (const p of problems) console.error(`deploy (${scope} ${target}): ${p}`);
    process.exit(1);
  }
  const d = SCOPES[scope].deploys[target];
  const r = spawnSync(process.execPath, [join(ROOT, WRANGLER), "deploy", ...d.args], {
    cwd: join(ROOT, "apps", d.app),
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}
