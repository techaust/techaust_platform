// Guard before a staging deploy (full audit A1 5): the build and the deploy are separate steps since 2026-10-30 (the build runs package
// code without the Cloudflare token; only the deploy step has it), so the deploy must prove it is uploading a STAGING build:
//   - admin, portal: `CLOUDFLARE_ENV=staging vite build` writes `.wrangler/deploy/config.json`, which points `wrangler deploy` at the
//     flattened config in dist/. That config must name the staging Worker. A plain `vite build` (local, CI) flattens the TOP level,
//     whose name is the PRODUCTION Worker's, so a deploy after it would go to production: refused here. Admin also checks the API
//     Worker's flattened config (deployed with `--config`).
//   - web: `wrangler deploy --env staging` picks the Worker, but the pages are static and carry the Turnstile site key chosen at build
//     time; the built pages must hold env.staging's key and not the top level's test key.
// Usage: node scripts/check-staging-build.mjs admin|admin-api|portal|web   (run from anywhere; reads apps/<app>/ only).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseJsonc } from "./check-worker-config.mjs";

const APPS_DIR = resolve(fileURLToPath(new URL("../apps/", import.meta.url)));

/** The Worker name a staging build must carry, from the app's own wrangler config (env.staging). */
export function stagingNameOf(configText) {
  const name = parseJsonc(configText).env?.staging?.name;
  if (!name) throw new Error("env.staging.name is missing");
  return name;
}

/** Problems with one flattened (built) Worker config against the staging name. Empty = it is a staging build. */
export function builtConfigProblems(built, stagingName) {
  if (!built) return ["no built config: run the app's build:staging first"];
  if (built.name !== stagingName)
    return [`the build is for ${String(built.name)}, not ${stagingName}: run the app's build:staging first`];
  return [];
}

/** Problems with the built website's pages: env.staging's site key present somewhere, the top-level key nowhere. */
export function webPagesProblems(htmlTexts, stagingKey, topKey) {
  const problems = [];
  if (htmlTexts.length === 0) return ["no built pages in apps/web/dist: run build:staging first"];
  if (!htmlTexts.some((t) => t.includes(stagingKey)))
    problems.push(
      "no page carries env.staging's Turnstile site key: run build:staging (CLOUDFLARE_ENV=staging)",
    );
  if (topKey && topKey !== stagingKey && htmlTexts.some((t) => t.includes(topKey)))
    problems.push(
      "a page carries the top level's TEST Turnstile key: the pages were built for local, not staging",
    );
  return problems;
}

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);

/** The flattened config `wrangler deploy` will use in an SPA app (through the redirect file the Vite plugin writes). */
function redirected(appDir) {
  const redirect = readJson(join(appDir, ".wrangler", "deploy", "config.json"));
  if (!redirect?.configPath) return null;
  return readJson(resolve(join(appDir, ".wrangler", "deploy"), redirect.configPath));
}

function htmlFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return name.endsWith(".html") ? [path] : [];
  });
}

export function problemsFor(target) {
  if (target === "admin" || target === "portal") {
    const appDir = join(APPS_DIR, target);
    const name = stagingNameOf(readFileSync(join(appDir, "wrangler.jsonc"), "utf8"));
    return builtConfigProblems(redirected(appDir), name);
  }
  if (target === "admin-api") {
    const appDir = join(APPS_DIR, "admin");
    const name = stagingNameOf(readFileSync(join(appDir, "wrangler.api.jsonc"), "utf8"));
    return builtConfigProblems(
      readJson(join(appDir, "dist", "techaust_platform_admin_api", "wrangler.json")),
      name,
    );
  }
  if (target === "web") {
    const appDir = join(APPS_DIR, "web");
    const config = parseJsonc(readFileSync(join(appDir, "wrangler.jsonc"), "utf8"));
    const stagingKey = config.env?.staging?.vars?.TURNSTILE_SITE_KEY ?? "";
    if (!stagingKey) return ["env.staging has no TURNSTILE_SITE_KEY"];
    const pages = htmlFiles(join(appDir, "dist")).map((p) => readFileSync(p, "utf8"));
    return webPagesProblems(pages, stagingKey, config.vars?.TURNSTILE_SITE_KEY ?? "");
  }
  return [`unknown target ${target}`];
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const target = process.argv[2] ?? "";
  const problems = problemsFor(target);
  if (problems.length > 0) {
    for (const p of problems) console.error(`staging build check (${target}): ${p}`);
    process.exit(1);
  }
  console.log(`staging build check (${target}): ok`);
}
