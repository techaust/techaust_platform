// Header guard for the two SPAs (audit A1 finding 1; docs/08-security-compliance.md section 3.1). Every static response of the
// admin and the portal gets its headers from `public/_headers`, which Vite copies to `dist/client/_headers`; Cloudflare reads
// that copy at deploy. The portal shipped without one (A1), so a missing or thinned file now fails:
//   node scripts/check-spa-headers.mjs admin|portal   after `vite build` (the apps' `build` and `deploy:staging` scripts):
//                                                      checks dist/client/_headers
//   node scripts/check-spa-headers.mjs --source       in `pnpm check`: checks both apps' public/_headers (no build needed)
// Pure functions for apps/web/test/spa-headers.test.ts; the CLI is at the bottom.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsp, parseHeaders } from "./headers-shared.mjs";

export const SPA_APPS = ["admin", "portal"];

/** Referrer policies that never send a path or query to another site (docs/08: strict-origin-when-cross-origin, or stricter). */
const REFERRER_OK = new Set([
  "strict-origin-when-cross-origin",
  "strict-origin",
  "same-origin",
  "no-referrer",
]);
/** Browser features no SPA uses (docs/08 section 3.1: camera, microphone, geolocation and payment off). */
const FEATURES_OFF = ["camera", "microphone", "geolocation", "payment"];

/**
 * Sources an app must NOT allow. The portal signs clients in by email link: it compiles no WebAssembly (the admin's Argon2id
 * does) and checks no password against Have I Been Pwned, so those two admin allowances stay out of its policy (FX-2 brief).
 */
export const FORBIDDEN_SOURCES = {
  admin: [],
  portal: ["'wasm-unsafe-eval'", "https://api.pwnedpasswords.com"],
};

/** Problems with the `/*` block of one SPA's `_headers` text (empty = the docs/08 section 3.1 set is there). */
export function checkSpaHeaders(app, text) {
  const p = (m) => `${app} _headers: ${m}`;
  const h = parseHeaders(text);
  const problems = [];

  const hsts = h["strict-transport-security"] ?? "";
  const maxAge = Number(/max-age=(\d+)/i.exec(hsts)?.[1] ?? 0);
  if (maxAge < 31536000)
    problems.push(p("Strict-Transport-Security needs max-age of at least 31536000 (1 year)"));
  if (!/includesubdomains/i.test(hsts)) problems.push(p("Strict-Transport-Security needs includeSubDomains"));
  if ((h["x-content-type-options"] ?? "").toLowerCase() !== "nosniff")
    problems.push(p("X-Content-Type-Options must be nosniff"));
  if (!REFERRER_OK.has((h["referrer-policy"] ?? "").toLowerCase()))
    problems.push(p("Referrer-Policy must be strict-origin-when-cross-origin (or stricter)"));
  const perms = (h["permissions-policy"] ?? "").replace(/\s+/g, "");
  for (const f of FEATURES_OFF)
    if (!perms.split(",").includes(`${f}=()`))
      problems.push(p(`Permissions-Policy must switch ${f} off (${f}=())`));
  if ((h["cross-origin-opener-policy"] ?? "").toLowerCase() !== "same-origin")
    problems.push(p("Cross-Origin-Opener-Policy must be same-origin"));
  if (!["same-site", "same-origin"].includes((h["cross-origin-resource-policy"] ?? "").toLowerCase()))
    problems.push(p("Cross-Origin-Resource-Policy must be same-site (or same-origin)"));
  if (!/\bnoindex\b/i.test(h["x-robots-tag"] ?? ""))
    problems.push(p("X-Robots-Tag must say noindex (the admin and the portal are never indexed)"));

  const raw = h["content-security-policy"];
  if (!raw) return [...problems, p("no Content-Security-Policy")];
  const csp = parseCsp(raw);
  const is = (dir, value) => (csp[dir] ?? []).length === 1 && csp[dir][0] === value;
  if (!csp["default-src"]) problems.push(p("CSP has no default-src"));
  if (!csp["script-src"]) problems.push(p("CSP has no script-src"));
  else if (!csp["script-src"].includes("'self'")) problems.push(p("CSP script-src must allow 'self'"));
  for (const dir of ["default-src", "script-src", "script-src-elem", "script-src-attr", "style-src"]) {
    const src = csp[dir] ?? [];
    for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "*", "data:", "blob:", "http:", "https:"])
      if ((dir !== "style-src" || bad.startsWith("'")) && src.includes(bad))
        problems.push(p(`CSP ${dir} must not contain ${bad}`));
  }
  if (!is("frame-ancestors", "'none'")) problems.push(p("CSP frame-ancestors must be 'none'"));
  if (!is("object-src", "'none'")) problems.push(p("CSP object-src must be 'none'"));
  if (!is("base-uri", "'none'") && !is("base-uri", "'self'"))
    problems.push(p("CSP base-uri must be 'none' or 'self'"));
  if (!csp["form-action"]) problems.push(p("CSP has no form-action"));
  // Turnstile: its script host and its frame go together (developers.cloudflare.com/turnstile/reference/content-security-policy).
  const turnstile = "https://challenges.cloudflare.com";
  if ((csp["script-src"] ?? []).includes(turnstile) !== (csp["frame-src"] ?? []).includes(turnstile))
    problems.push(
      p(`CSP must list ${turnstile} in both script-src and frame-src (the Turnstile widget), or in neither`),
    );
  const all = Object.values(csp).flat();
  for (const bad of FORBIDDEN_SOURCES[app] ?? [])
    if (all.includes(bad)) problems.push(p(`CSP must not allow ${bad} (${app} does not need it)`));
  return problems;
}

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
export const builtHeadersFile = (app, base = root) => join(base, "apps", app, "dist", "client", "_headers");
export const sourceHeadersFile = (app, base = root) => join(base, "apps", app, "public", "_headers");

/** The check for one file: a missing file is a problem in itself (the SPA would ship with no headers). */
export function checkSpaHeadersFile(app, file) {
  if (!existsSync(file))
    return [`${app}: ${file} is missing, so every page would ship without security headers`];
  return checkSpaHeaders(app, readFileSync(file, "utf8"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2];
  const targets =
    arg === "--source"
      ? SPA_APPS.map((app) => [app, sourceHeadersFile(app)])
      : SPA_APPS.includes(arg)
        ? [[arg, builtHeadersFile(arg)]]
        : null;
  if (!targets) {
    console.error("usage: node scripts/check-spa-headers.mjs admin|portal|--source");
    process.exit(2);
  }
  const problems = targets.flatMap(([app, file]) => checkSpaHeadersFile(app, file));
  if (problems.length > 0) {
    console.error(`check-spa-headers: ${problems.length} problem(s)`);
    for (const x of problems) console.error(`  - ${x}`);
    process.exit(1);
  }
  console.log(
    `check-spa-headers: ok (${targets.map(([app]) => app).join(", ")}: the docs/08 section 3.1 set)`,
  );
}
