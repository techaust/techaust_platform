// The Turnstile site key the admin and portal sign-in pages are built with (M2.4b). Build time only (node:fs), read from
// the app's wrangler.jsonc exactly as apps/web/src/lib/turnstile.ts does for the website's forms: the key is public and
// has one source, `vars.TURNSTILE_SITE_KEY` per environment, next to the Worker's TURNSTILE_HOSTNAMES.
//   - `vite build` (local, CI): the top-level value, Cloudflare's always-pass TEST key
//   - `CLOUDFLARE_ENV=staging vite build` (the `deploy:staging` script): env.staging's key; the build FAILS if it is
//     empty, so staging never ships a sign-in page without bot protection
//   - production: Phase 7 (its key is empty until the owner creates the widget)
// The static SPA can't read Worker vars at run time, so `vite.config.ts` writes the key into the bundle as a constant.
import { readFileSync } from "node:fs";
import { parseJsonc } from "./check-worker-config.mjs";

/** The site key of one environment of a parsed config (`env` empty or undefined = the top level). */
export function siteKeyOf(config, env) {
  if (!env) return config.vars?.TURNSTILE_SITE_KEY ?? "";
  const scope = config.env?.[env];
  if (!scope) throw new Error(`turnstile: CLOUDFLARE_ENV="${env}" is not an environment in wrangler.jsonc`);
  const key = scope.vars?.TURNSTILE_SITE_KEY ?? "";
  if (env === "staging" && !key)
    throw new Error(
      "turnstile: env.staging has no TURNSTILE_SITE_KEY (the sign-in page would ship without bot protection)",
    );
  return key;
}

/** The key for one app's build: reads `<appDir>/wrangler.jsonc` and `CLOUDFLARE_ENV`. */
export function siteKeyForApp(appDir, env = process.env.CLOUDFLARE_ENV || undefined) {
  const config = parseJsonc(readFileSync(new URL("wrangler.jsonc", appDir), "utf8"));
  return siteKeyOf(config, env);
}
