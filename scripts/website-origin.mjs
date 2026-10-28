// The website origin the portal SPA links to (07-W 5.5: the "Privacy notice" link points to the website of the SAME environment). Build time only
// (node:fs), the same way as scripts/turnstile-site-key.mjs: one source, `vars.WEBSITE_ORIGIN` per environment in apps/portal/wrangler.jsonc.
//   - `vite build` (local, CI): the top level, http://localhost:4321 (the website's dev server)
//   - `CLOUDFLARE_ENV=staging vite build`: env.staging's value (the web staging Worker); the build FAILS if it is empty
//   - `CLOUDFLARE_ENV=production vite build`: https://techaust.com
// The static SPA can't read Worker vars at run time, so `vite.config.ts` writes it into the bundle as the constant `__WEBSITE_ORIGIN__` (an origin: no path, no trailing slash).
import { readFileSync } from "node:fs";
import { parseJsonc } from "./check-worker-config.mjs";

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/;

/** The origin of one environment of a parsed config (`env` empty or undefined = the top level). */
export function websiteOriginOf(config, env) {
  const scope = env ? config.env?.[env] : config;
  if (!scope)
    throw new Error(`website origin: CLOUDFLARE_ENV="${env}" is not an environment in wrangler.jsonc`);
  const origin = scope.vars?.WEBSITE_ORIGIN ?? "";
  if (!origin) throw new Error(`website origin: ${env || "the top level"} has no vars.WEBSITE_ORIGIN`);
  if (!ORIGIN.test(origin))
    throw new Error(
      `website origin: "${origin}" must be an origin (scheme and host, no path, no trailing slash)`,
    );
  return origin;
}

/** The origin for one app's build: reads `<appDir>/wrangler.jsonc` and `CLOUDFLARE_ENV`. */
export function websiteOriginForApp(appDir, env = process.env.CLOUDFLARE_ENV || undefined) {
  const config = parseJsonc(readFileSync(new URL("wrangler.jsonc", appDir), "utf8"));
  return websiteOriginOf(config, env);
}
