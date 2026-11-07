// P7 (docs/runs/p7-launch.md P7-B 5): `X-Robots-Tag: noindex` only off production. public/_headers holds the headers every environment shares
// and no X-Robots-Tag line; the website's build (the `techaust:noindex-off-production` integration in apps/web/astro.config.mjs) adds the line to
// the `/*` block of dist/_headers on every build except `CLOUDFLARE_ENV=production` (local, CI, staging and the Lighthouse copy stay out of
// search). scripts/web-dist-checks.mjs asserts the built file is exactly public/_headers plus the line off production, and without it on
// production; scripts/check-prod-readiness.mjs reads the built file. Pure functions; no file access.

/** The line added to the `/*` block (two spaces, as every header line of the file). */
export const NOINDEX_LINE = "  X-Robots-Tag: noindex";

/** A live (not commented) X-Robots-Tag line anywhere in a `_headers` text. */
export const hasRobotsHeader = (text) =>
  text.split(/\r?\n/).some((l) => /^\s+x-robots-tag\s*:/i.test(l) && !l.trim().startsWith("#"));

/** Whether a build for `env` (CLOUDFLARE_ENV; undefined or "" for a local build) keeps search engines out. */
export const wantsNoindex = (env) => env !== "production";

/** `text` with NOINDEX_LINE as the last header line of its `/*` block. Throws when the file has no `/*` block or already has the header. */
export function withNoindex(text) {
  if (hasRobotsHeader(text))
    throw new Error("_headers already sets X-Robots-Tag: public/_headers must not (P7)");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === "/*");
  if (start < 0) throw new Error('_headers has no "/*" block to add X-Robots-Tag to');
  let end = start + 1;
  while (end < lines.length && /^\s+\S/.test(lines[end]) && !lines[end].trim().startsWith("#")) end++;
  return [...lines.slice(0, end), NOINDEX_LINE, ...lines.slice(end)].join(eol);
}

/** What dist/_headers must be for a build for `env`, from public/_headers' text. */
export const builtHeadersFor = (publicText, env) =>
  wantsNoindex(env) ? withNoindex(publicText) : publicText;
