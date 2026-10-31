// The website origin the portal SPA links to (07-W 5.5: the "Privacy notice" link points to the website of the SAME environment). Build time only
// (node:fs), the same way as scripts/turnstile-site-key.mjs: one source, `vars.WEBSITE_ORIGIN` per environment in apps/portal/wrangler.jsonc.
//   - `vite build` (local, CI): the top level, http://localhost:4321 (the website's dev server)
//   - `CLOUDFLARE_ENV=staging vite build`: env.staging's value (the web staging Worker); the build FAILS if it is empty
//   - `CLOUDFLARE_ENV=production vite build`: https://techaust.com
// The static SPA can't read Worker vars at run time, so `vite.config.ts` writes it into the bundle as the constant `__WEBSITE_ORIGIN__` (an origin: no path, no trailing slash).
//
// T6 (07-ZE line 5, owner's Q2 answer 2026-10-31): the admin SPA needs the portal origin of its own environment the same way, for the staff
// reply to an acceptance by email ("… or sign in at {portal link} …"): `vars.PORTAL_ORIGIN` per environment in apps/admin/wrangler.jsonc,
// written into the admin bundle as `__PORTAL_ORIGIN__` (local http://localhost:5174, staging the portal staging Worker, production
// https://portal.techaust.com). The front Worker never reads it; it adds no Worker code.
import { readFileSync } from "node:fs";
import { parseJsonc } from "./check-worker-config.mjs";

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/;

/** The origin in `vars[name]` of one environment of a parsed config (`env` empty or undefined = the top level); `label` names it in errors. */
export function originVarOf(config, env, name, label) {
  const scope = env ? config.env?.[env] : config;
  if (!scope) throw new Error(`${label}: CLOUDFLARE_ENV="${env}" is not an environment in wrangler.jsonc`);
  const origin = scope.vars?.[name] ?? "";
  if (!origin) throw new Error(`${label}: ${env || "the top level"} has no vars.${name}`);
  if (!ORIGIN.test(origin))
    throw new Error(`${label}: "${origin}" must be an origin (scheme and host, no path, no trailing slash)`);
  return origin;
}

/** The website origin of one environment of a parsed config (`env` empty or undefined = the top level). */
export const websiteOriginOf = (config, env) => originVarOf(config, env, "WEBSITE_ORIGIN", "website origin");

/** The portal origin of one environment of a parsed config (the admin's `vars.PORTAL_ORIGIN`). */
export const portalOriginOf = (config, env) => originVarOf(config, env, "PORTAL_ORIGIN", "portal origin");

const configOf = (appDir) => parseJsonc(readFileSync(new URL("wrangler.jsonc", appDir), "utf8"));

/** The origin for one app's build: reads `<appDir>/wrangler.jsonc` and `CLOUDFLARE_ENV`. */
export function websiteOriginForApp(appDir, env = process.env.CLOUDFLARE_ENV || undefined) {
  return websiteOriginOf(configOf(appDir), env);
}

/** The portal origin for one app's build (the admin): reads `<appDir>/wrangler.jsonc` and `CLOUDFLARE_ENV`. */
export function portalOriginForApp(appDir, env = process.env.CLOUDFLARE_ENV || undefined) {
  return portalOriginOf(configOf(appDir), env);
}
