// Guard before a production deploy (P7, docs/runs/p7-launch.md P7-B): the production twin of scripts/check-staging-build.mjs. The build runs
// package code in a job with no Cloudflare token and the deploy job uploads what it made, so each deploy first proves it is uploading a
// PRODUCTION build:
//   - admin (front, API, finance, invoices) and portal: `CLOUDFLARE_ENV=production vite build` flattens env.production into
//     dist/<worker>/wrangler.json. A plain `vite build` (local, CI) flattens the TOP level, whose name is ALSO the production Worker's, so
//     the name alone proves nothing here: the flattened config must name the production Worker AND say `targetEnvironment: "production"` and
//     `vars.ENVIRONMENT: "production"` (the top level says "local", a staging build "staging").
//   - every build output (the SPAs' dist, the website's dist and its pre-bundled Worker, jobs' pre-bundled Worker) carries no staging host
//     (`…-staging.techaust-technologies-153.workers.dev`), no staging resource name (`techaust-staging…`) and no staging Turnstile site key.
//   - the website's pages, and the admin's and the portal's sign-in bundles, carry env.production's Turnstile site key and not the top
//     level's always-pass TEST key.
//   - no `.dev.vars` file in any build output (M7.1 L17).
// Usage: node scripts/check-prod-build.mjs admin|admin-api|admin-finance|admin-invoices|portal|web|jobs|dev-vars   (reads apps/<app>/ only).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ADMIN_AUX_TARGETS, devVarsProblems } from "./check-staging-build.mjs";
import { parseJsonc } from "./check-worker-config.mjs";

const APPS_DIR = resolve(fileURLToPath(new URL("../apps/", import.meta.url)));

/** Where the build job puts the pre-bundled production Workers of jobs and the website (`wrangler deploy --dry-run --env production --outdir`). */
export const PREBUNDLED_DIRS = { jobs: "dist-production", web: ".wrangler/dist-production" };

/** The Worker name a production build must carry, from the app's own wrangler config (env.production). */
export function productionNameOf(configText) {
  const name = parseJsonc(configText).env?.production?.name;
  if (!name) throw new Error("env.production.name is missing");
  return name;
}

/** Problems with one flattened (built) Worker config: it must be env.production's (name, target environment and ENVIRONMENT var). */
export function builtConfigProblems(built, productionName) {
  if (!built) return ["no built config: run the app's build:production first"];
  const problems = [];
  if (built.name !== productionName)
    problems.push(
      `the build is for ${String(built.name)}, not ${productionName}: run the app's build:production`,
    );
  if (built.targetEnvironment !== "production")
    problems.push(
      `the build was flattened for ${built.targetEnvironment === undefined ? "the top level (a plain build)" : String(built.targetEnvironment)}, not env.production: run the app's build:production (CLOUDFLARE_ENV=production)`,
    );
  if (built.vars?.ENVIRONMENT !== "production")
    problems.push(
      `the build's ENVIRONMENT is ${String(built.vars?.ENVIRONMENT)}, not production: run the app's build:production`,
    );
  return problems;
}

/**
 * A staging host or a staging resource name in a production build: either means staging values were built in. The quantifiers are bounded
 * (a Worker name is at most 63 characters): an unbounded `[a-z0-9-]+` before the literal backtracks over every long run of letters in a
 * minified bundle, which took minutes on the admin's browser files.
 */
export const STAGING_TRACE =
  /[a-z0-9-]{1,63}-staging\.techaust-technologies-153\.workers\.dev|techaust-staging[a-z0-9-]{0,63}/gi;

/** Problems in one built file: each staging trace and each staging Turnstile key found (a key is a public value; shown in full). */
export function stagingTraceProblems(label, text, stagingKeys = []) {
  const problems = [];
  const traces = [...new Set([...text.matchAll(STAGING_TRACE)].map((m) => m[0]))];
  for (const t of traces)
    problems.push(`${label} carries the staging name or host ${t}: run build:production`);
  for (const key of stagingKeys)
    if (key && text.includes(key))
      problems.push(
        `${label} carries env.staging's Turnstile site key: run build:production (CLOUDFLARE_ENV=production)`,
      );
  return problems;
}

/**
 * The site-key problems of a production build's text: env.production's key (non-empty) somewhere, and the top level's TEST key nowhere.
 * `texts` are the files where the key lands (the website's pages, an SPA's browser bundle).
 */
export function siteKeyProblems(what, texts, productionKey, topKey) {
  if (texts.length === 0) return [`${what}: nothing built: run build:production first`];
  if (!productionKey)
    return [
      `${what}: env.production has no TURNSTILE_SITE_KEY: the lead sets the production widget's public key before a production build`,
    ];
  const problems = [];
  if (!texts.some((t) => t.includes(productionKey)))
    problems.push(
      `${what}: no file carries env.production's Turnstile site key: run build:production (CLOUDFLARE_ENV=production)`,
    );
  if (topKey && topKey !== productionKey && texts.some((t) => t.includes(topKey)))
    problems.push(
      `${what}: a file carries the top level's TEST Turnstile key: it was built for local, not production`,
    );
  return problems;
}

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);
const configOf = (app, file = "wrangler.jsonc") =>
  parseJsonc(readFileSync(join(APPS_DIR, app, file), "utf8"));

/** Text files below `dir` (source maps excluded: they hold the sources' comments, which may name staging; nothing reads them at run time). */
export function textFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return textFiles(path);
    return /\.(?:js|mjs|cjs|html|css|json|txt|xml)$/i.test(name) ||
      name === "_headers" ||
      name === "_redirects"
      ? [path]
      : [];
  });
}

/** Every env.staging Turnstile key of the apps with a widget (the website, the admin front, the portal). */
export function stagingKeys(appsDir = APPS_DIR) {
  return ["web", "admin", "portal"]
    .map(
      (app) =>
        parseJsonc(readFileSync(join(appsDir, app, "wrangler.jsonc"), "utf8")).env?.staging?.vars
          ?.TURNSTILE_SITE_KEY ?? "",
    )
    .filter(Boolean);
}

/** Staging traces in every text file below `dir`, labelled `<app> <path>`. */
function tracesIn(app, dir, base, keys) {
  return textFiles(dir).flatMap((file) =>
    stagingTraceProblems(
      `${app} ${relative(base, file).split(sep).join("/")}`,
      readFileSync(file, "utf8"),
      keys,
    ),
  );
}

/** The flattened config `wrangler deploy` will use in an SPA app (through the redirect file the Vite plugin writes). */
function redirected(appDir) {
  const redirect = readJson(join(appDir, ".wrangler", "deploy", "config.json"));
  if (!redirect?.configPath) return null;
  return readJson(
    resolve(join(appDir, ".wrangler", "deploy"), String(redirect.configPath).replaceAll("\\", "/")),
  );
}

/** M7.1 L17: no `.dev.vars` in any production build output, the pre-bundled Workers included. */
export const devVarsEverywhere = () => [
  ...["admin", "portal", "web", "jobs"].flatMap((app) => devVarsProblems(app, join(APPS_DIR, app, "dist"))),
  ...devVarsProblems("jobs", join(APPS_DIR, "jobs", PREBUNDLED_DIRS.jobs)),
  ...devVarsProblems("web", join(APPS_DIR, "web", PREBUNDLED_DIRS.web)),
];

export function problemsFor(target) {
  if (target === "dev-vars") return devVarsEverywhere();
  const keys = stagingKeys();
  if (target === "admin" || target === "portal") {
    const appDir = join(APPS_DIR, target);
    const config = configOf(target);
    const dist = join(appDir, "dist");
    const client = textFiles(join(dist, "client"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(f, "utf8"));
    return [
      ...devVarsProblems(target, dist),
      ...builtConfigProblems(
        redirected(appDir),
        productionNameOf(readFileSync(join(appDir, "wrangler.jsonc"), "utf8")),
      ),
      ...siteKeyProblems(
        `${target} sign-in bundle`,
        client,
        config.env?.production?.vars?.TURNSTILE_SITE_KEY ?? "",
        config.vars?.TURNSTILE_SITE_KEY ?? "",
      ),
      ...tracesIn(target, join(dist, "client"), dist, keys),
      ...tracesIn(
        target,
        join(dist, target === "admin" ? "techaust_platform_admin" : "techaust_platform_portal"),
        dist,
        keys,
      ),
    ];
  }
  const aux = ADMIN_AUX_TARGETS[target];
  if (aux) {
    const appDir = join(APPS_DIR, "admin");
    const dist = join(appDir, "dist");
    return [
      ...devVarsProblems("admin", dist),
      ...builtConfigProblems(
        readJson(join(dist, aux.dist, "wrangler.json")),
        productionNameOf(readFileSync(join(appDir, aux.config), "utf8")),
      ),
      ...tracesIn("admin", join(dist, aux.dist), dist, keys),
    ];
  }
  if (target === "web") {
    const appDir = join(APPS_DIR, "web");
    const config = configOf("web");
    const dist = join(appDir, "dist");
    const pages = textFiles(dist)
      .filter((f) => f.endsWith(".html"))
      .map((f) => readFileSync(f, "utf8"));
    return [
      ...devVarsProblems("web", dist),
      ...siteKeyProblems(
        "website pages",
        pages,
        config.env?.production?.vars?.TURNSTILE_SITE_KEY ?? "",
        config.vars?.TURNSTILE_SITE_KEY ?? "",
      ),
      ...tracesIn("web", dist, dist, keys),
      ...tracesIn("web", join(appDir, PREBUNDLED_DIRS.web), appDir, keys),
    ];
  }
  if (target === "jobs") {
    const appDir = join(APPS_DIR, "jobs");
    const bundle = join(appDir, PREBUNDLED_DIRS.jobs);
    if (!existsSync(join(bundle, "index.js")))
      return [`apps/jobs/${PREBUNDLED_DIRS.jobs}/index.js is missing: the build job pre-bundles it`];
    return [...devVarsProblems("jobs", bundle), ...tracesIn("jobs", bundle, appDir, keys)];
  }
  return [`unknown target ${target}`];
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const target = process.argv[2] ?? "";
  const problems = problemsFor(target);
  if (problems.length > 0) {
    for (const p of problems) console.error(`production build check (${target}): ${p}`);
    process.exit(1);
  }
  console.log(`production build check (${target}): ok`);
}
