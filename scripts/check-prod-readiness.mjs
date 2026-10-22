// Pre-production check (M2.3): run by .github/workflows/deploy-prod.yml before a production deploy, NEVER by CI or the
// staging deploy. It fails while a pending owner input is still a placeholder, so production can't ship with one.
// Each failure line says what the owner must supply. Pure functions for the tests; the CLI is at the bottom.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The marker the `Placeholder` component writes (apps/web/src/components/Placeholder.astro). */
export const PLACEHOLDER_MARKER = "placeholder__tag";
/** The text `{{postal_address}}` shows while the address is empty (apps/web/src/lib/tokens.ts). */
export const POSTAL_PLACEHOLDER_TEXT = "[Postal address: owner input pending]";

/** A string value of `key: "…"` in site.ts ("" when empty or missing). */
export function readSiteString(siteTs, key) {
  return new RegExp(`\\b${key}:\\s*"([^"]*)"`).exec(siteTs)?.[1] ?? "";
}
/** A boolean value of `key: true|false` in site.ts (false when missing). */
export function readSiteBool(siteTs, key) {
  return new RegExp(`\\b${key}:\\s*(true|false)\\b`).exec(siteTs)?.[1] === "true";
}

/** Config the owner must have filled in: [{ key, what }]. */
const REQUIRED_TEXT = [
  [
    "postalAddress",
    "the postal address for the legal pages (site.postalAddress in apps/web/src/config/site.ts)",
  ],
  ["linkedinFounder", "the founder's LinkedIn URL (site.linkedinFounder)"],
  ["founderPhoto", "the founder's headshot (site.founderPhoto)"],
  ["founderBio", "the founder's bio (site.founderBio)"],
];

/** Config problems from the text of site.ts. */
export function checkSiteConfig(siteTs) {
  const problems = [];
  for (const [key, what] of REQUIRED_TEXT)
    if (!readSiteString(siteTs, key).trim()) problems.push(`The owner must supply ${what}: it is empty.`);
  if (!readSiteBool(siteTs, "aliasesConfirmed"))
    problems.push(
      "The owner must confirm that the security@ and privacy@ aliases deliver (U-5), then set site.aliasesConfirmed to true.",
    );
  return problems;
}

/** Problems in one built page: a Placeholder component or the postal-address placeholder is still on it. */
export function checkBuiltPage(name, html) {
  const problems = [];
  if (html.includes(PLACEHOLDER_MARKER))
    problems.push(`${name}: still shows a Placeholder (an owner input is missing); supply it, then rebuild.`);
  if (html.includes(POSTAL_PLACEHOLDER_TEXT))
    problems.push(`${name}: still shows the postal-address placeholder; the owner must supply the address.`);
  return problems;
}

/** The X-Robots-Tag: noindex line of the `/*` block in public/_headers. */
export function checkNoindex(headersText) {
  const set = headersText
    .split(/\r?\n/)
    .some((l) => /^\s+x-robots-tag\s*:\s*[^#\n]*noindex/i.test(l) && !l.trim().startsWith("#"));
  return set
    ? [
        "public/_headers still sets X-Robots-Tag: noindex (staging only): remove it for production (Phase 7, with the robots work).",
      ]
    : [];
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Everything for `webDir` (apps/web); needs dist built. Returns the problems (empty = ready). */
export function checkProdReadiness(webDir) {
  const dist = join(webDir, "dist");
  if (!existsSync(dist)) return [`${dist} does not exist: build the site first.`];
  const problems = checkSiteConfig(readFileSync(join(webDir, "src", "config", "site.ts"), "utf8"));
  for (const file of walk(dist))
    if (file.endsWith(".html"))
      problems.push(...checkBuiltPage(relative(dist, file).split(sep).join("/"), readFileSync(file, "utf8")));
  problems.push(...checkNoindex(readFileSync(join(webDir, "public", "_headers"), "utf8")));
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const webDir = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web");
  const problems = checkProdReadiness(webDir);
  if (problems.length > 0) {
    console.error(`check-prod-readiness: ${problems.length} problem(s), production is blocked:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("check-prod-readiness: ok");
}
