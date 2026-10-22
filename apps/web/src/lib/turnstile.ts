// The Turnstile site key the form pages are built with (FRM-02). Build time only (node:fs). The key is public; its one
// source is `TURNSTILE_SITE_KEY` in apps/web/wrangler.jsonc, per environment, next to the Worker's TURNSTILE_HOSTNAMES:
//   - `astro build` (local, CI, `dev:worker`): the top-level value, Cloudflare's always-pass TEST key
//   - `CLOUDFLARE_ENV=staging astro build` (the `deploy:staging` script): env.staging's key, the widget
//     "techaust-staging-forms"; the build FAILS if it is empty, so staging never ships a form without spam protection
//   - production: Phase 7 (its key is empty until the owner creates the widget; the endpoints answer 503 until then)
// The static pages can't read Worker vars at run time, so the key is written into the HTML at build time.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appRoot } from "./catalogue";

/** wrangler.jsonc to a value: drops comments and trailing commas, leaving string contents alone. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) throw new Error("unterminated /* comment");
      i = end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  // (A function, not the "$1" pattern: the build's typed-amount check reads "$" and a digit as a price.)
  return JSON.parse(out.replace(/,(\s*[}\]])/g, (_comma, tail: string) => tail));
}

type Config = { vars?: Record<string, string>; env?: Record<string, { vars?: Record<string, string> }> };

/** The site key of one environment of a parsed config (`env` empty or undefined = the top level). */
export function siteKeyOf(config: Config, env?: string): string {
  if (!env) return config.vars?.TURNSTILE_SITE_KEY ?? "";
  const scope = config.env?.[env];
  if (!scope) throw new Error(`turnstile: CLOUDFLARE_ENV="${env}" is not an environment in wrangler.jsonc`);
  const key = scope.vars?.TURNSTILE_SITE_KEY ?? "";
  if (env === "staging" && !key)
    throw new Error("turnstile: env.staging has no TURNSTILE_SITE_KEY (the forms would ship without spam protection)");
  return key;
}

let cached: string | undefined;

/** The site key for this build (read once). */
export function turnstileSiteKey(): string {
  if (cached === undefined) {
    const config = parseJsonc(readFileSync(join(appRoot(), "wrangler.jsonc"), "utf8")) as Config;
    cached = siteKeyOf(config, process.env.CLOUDFLARE_ENV || undefined);
  }
  return cached;
}
