// Local dev-server ports, shifted by one variable so two browser agents (designer and reviewer) can run their own dev servers
// side by side (CLOUD-1; docs/14 §4: the first browser agent uses offset 0, the second 100).
//
//   TECHAUST_PORT_OFFSET=100 pnpm --filter @techaust/admin dev   → admin on :5273, its workerd inspector on :9329
//
// Offset 0 (the default, and every run on this PC) is today's behaviour exactly: the same ports, no inspector port is named (wrangler
// and the Vite plugin pick the first free one from 9229 themselves), and the global dev registry. Any other offset also gives each
// Worker a fixed inspector port and a dev registry of its own (`.wrangler/registry-<offset>` in the repository), so the jobs
// Worker's service binding to the admin API (ADMIN_JOBS) finds the admin API of its own set, never the other agent's.
// Allowed offsets: 0, 100, 200 … 900 (a test proves no two of them share a port).
//
// Pure functions, except `portOffset()`'s default argument (process.env), so the tests never depend on the caller's environment.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Today's ports (offset 0). `webWorker` (`dev:worker`) and `jobs` both use wrangler's 8787, as they always have. */
export const BASE_PORTS = Object.freeze({
  web: 4321, // astro dev (pages only)
  webWorker: 8787, // the web Worker with its /api routes (`pnpm --filter @techaust/web dev:worker`)
  webE2e: 8799, // the web browser tests' wrangler dev (apps/web/playwright.config.ts)
  admin: 5173, // vite: the admin SPA, its front Worker and the admin API Worker
  portal: 5174, // vite: the portal SPA and its Worker
  jobs: 8787, // wrangler dev: the jobs Worker
});

/** The inspector (DevTools) port of each Worker process at a non-zero offset: 9229 + slot + offset. */
export const INSPECTOR_BASE = 9229;
const INSPECTOR_SLOT = Object.freeze({ admin: 0, portal: 1, jobs: 2, webWorker: 3, webE2e: 4 });

export const OFFSET_STEP = 100;
export const MAX_OFFSET = 900;
export const ALLOWED_OFFSETS = Object.freeze(
  Array.from({ length: MAX_OFFSET / OFFSET_STEP + 1 }, (_, i) => i * OFFSET_STEP),
);

/** The offset from a raw value (unset or empty = 0). Anything other than 0, 100 … 900 throws, so a typo never lands on a stranger's port. */
export function parseOffset(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return 0;
  const text = String(raw).trim();
  const n = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!ALLOWED_OFFSETS.includes(n))
    throw new Error(
      `TECHAUST_PORT_OFFSET="${text}": use 0 (the default), or 100, 200 … ${MAX_OFFSET} (docs/14 §4: the second browser agent uses 100)`,
    );
  return n;
}

/** The offset of this process (TECHAUST_PORT_OFFSET). */
export const portOffset = (env = process.env) => parseOffset(env.TECHAUST_PORT_OFFSET);

const known = (name) => {
  if (!Object.hasOwn(BASE_PORTS, name)) throw new Error(`dev ports: unknown server "${name}"`);
  return name;
};

/** The listening port of one dev server. */
export const devPort = (name, offset = 0) => BASE_PORTS[known(name)] + parseOffset(offset);

/** `http://localhost:<port>` of one dev server. */
export const localOrigin = (name, offset = 0) => `http://localhost:${devPort(name, offset)}`;

/** The inspector port to name for one Worker process, or undefined at offset 0 (wrangler and Vite pick a free one, as today). */
export function inspectorPort(name, offset = 0) {
  const n = parseOffset(offset);
  if (!Object.hasOwn(INSPECTOR_SLOT, name)) throw new Error(`dev ports: "${name}" has no Worker inspector`);
  return n === 0 ? undefined : INSPECTOR_BASE + INSPECTOR_SLOT[name] + n;
}

/** Every port one set of dev servers may listen on at an offset (the inspector ports only where they are named). */
export function portsOf(offset) {
  const n = parseOffset(offset);
  const ports = Object.keys(BASE_PORTS).map((name) => devPort(name, n));
  for (const name of Object.keys(INSPECTOR_SLOT)) {
    const p = inspectorPort(name, n);
    if (p !== undefined) ports.push(p);
  }
  return [...new Set(ports)];
}

/**
 * Moves the port of a local origin (`http://localhost:<port>`, optionally with a path) by the offset; any other URL (staging,
 * production) is returned unchanged. Used for the local values baked into a build or passed to a Worker as a var.
 */
export function shiftLocalUrl(url, offset = 0) {
  const n = parseOffset(offset);
  const m = /^(http:\/\/localhost:)(\d+)(\/.*)?$/.exec(url);
  if (!m || n === 0) return url;
  return `${m[1]}${Number(m[2]) + n}${m[3] ?? ""}`;
}

/** The environment that gives a non-zero offset its own dev registry (wrangler and the Vite plugin read different names). */
export function registryEnv(repoRoot, offset = 0) {
  const n = parseOffset(offset);
  if (n === 0) return {};
  const path = join(repoRoot, ".wrangler", `registry-${n}`);
  return { WRANGLER_REGISTRY_PATH: path, MINIFLARE_REGISTRY_PATH: path };
}

/** The repository root (this file sits in <root>/scripts). */
export const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The local value of one var in an app's wrangler.jsonc (top level), for the vars a shifted set must override. */
function localVar(app, name, repoRoot) {
  const text = readFileSync(join(repoRoot, "apps", app, "wrangler.jsonc"), "utf8");
  const m = new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`).exec(text);
  if (!m) throw new Error(`dev ports: apps/${app}/wrangler.jsonc has no "${name}"`);
  return m[1];
}

/** `--var NAME:value` pairs for the local URLs a Worker carries, each shifted by the offset (none at offset 0). */
function shiftedVars(app, names, offset, repoRoot) {
  if (offset === 0) return [];
  return names.flatMap((name) => [
    "--var",
    `${name}:${localVar(app, name, repoRoot)
      .split(",")
      .map((u) => shiftLocalUrl(u, offset))
      .join(",")}`,
  ]);
}

const inspectorArgs = (name, offset) => {
  const p = inspectorPort(name, offset);
  return p === undefined ? [] : ["--inspector-port", String(p)];
};

/**
 * The command one dev server runs, as `{ app, bin: [package, binName], args, env }`: `app` is the folder under apps/ it runs in,
 * `bin` the package whose binary runs (the launcher scripts/dev.mjs resolves it to a file and runs it with this Node), `env` the
 * extra environment. At offset 0 the arguments are exactly the ones the apps' scripts used before CLOUD-1.
 * @param {"web" | "webWorker" | "webE2e" | "admin" | "portal" | "jobs"} name
 */
export function devCommand(name, offset = 0, repoRoot = REPO_ROOT) {
  const n = parseOffset(offset);
  const port = String(devPort(name, n));
  const env = registryEnv(repoRoot, n);
  switch (name) {
    case "web":
      return { app: "web", bin: ["astro", "astro"], args: ["dev", "--port", port], env: {} };
    case "webWorker":
      // Before CLOUD-1: a bare `wrangler dev` (wrangler's default port, 8787). The forms accept POSTs only from the page origins in
      // FORMS_ALLOWED_ORIGINS, so a shifted set passes its own.
      return {
        app: "web",
        bin: ["wrangler", "wrangler"],
        args: [
          "dev",
          ...(n === 0 ? [] : ["--port", port]),
          ...inspectorArgs(name, n),
          ...shiftedVars("web", ["FORMS_ALLOWED_ORIGINS"], n, repoRoot),
        ],
        env,
      };
    case "webE2e": {
      // The browser tests serve the built site on their own port; the forms must accept that page origin (FRM-03).
      return {
        app: "web",
        bin: ["wrangler", "wrangler"],
        args: [
          "dev",
          "--port",
          port,
          ...inspectorArgs(name, n),
          "--var",
          `FORMS_ALLOWED_ORIGINS:${localOrigin(name, n)}`,
        ],
        env,
      };
    }
    case "admin":
    case "portal":
      // The Vite plugin's inspector port is set in vite.config.ts (it has no command-line flag); the registry comes from `env`.
      return { app: name, bin: ["vite", "vite"], args: ["--port", port, "--strictPort"], env };
    case "jobs":
      return {
        app: "jobs",
        bin: ["wrangler", "wrangler"],
        args: [
          "dev",
          "--port",
          port,
          "--persist-to",
          "../../.wrangler/state",
          ...inspectorArgs(name, n),
          ...shiftedVars("jobs", ["ADMIN_URL", "PORTAL_URL", "EMAIL_ASSET_BASE"], n, repoRoot),
        ],
        env,
      };
    default:
      throw new Error(`dev ports: unknown server "${name}"`);
  }
}
