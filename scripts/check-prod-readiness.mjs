// Pre-production check (M2.3): run by .github/workflows/deploy-prod.yml before a production deploy, NEVER by CI or the
// staging deploy. It fails while a pending owner input is still a placeholder, so production can't ship with one.
// Each failure line says what the owner must supply. Pure functions for the tests; the CLI is at the bottom.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { POSTAL_PLACEHOLDER_TEXT, readSiteBool, readSiteString, walk } from "./web-shared.mjs";

export { POSTAL_PLACEHOLDER_TEXT, readSiteBool, readSiteString };

/** The marker the `Placeholder` component writes (apps/web/src/components/Placeholder.astro). */
export const PLACEHOLDER_MARKER = "placeholder__tag";
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

/**
 * The launch day (site.launchDate) must be set, and every legal page's `effective` in content/legal.ts must equal it
 * (owner, 2026-10-22: the effective date is the launch day). `legalTs` is the text of apps/web/src/content/legal.ts.
 */
export function checkLaunchDate(siteTs, legalTs) {
  const launch = readSiteString(siteTs, "launchDate").trim();
  if (!launch)
    return [
      "The launch date is not set: the lead sets site.launchDate and every legal page's `effective` date (apps/web/src/content/legal.ts) to the launch day, together, before production.",
    ];
  const dates = [...legalTs.matchAll(/\beffective:\s*"([^"]*)"/g)].map((m) => m[1]);
  if (dates.length === 0)
    return [
      "No `effective` dates found in apps/web/src/content/legal.ts (the readiness check cannot read them).",
    ];
  const wrong = [...new Set(dates.filter((d) => d !== launch))];
  return wrong.length
    ? [
        `Legal page effective date(s) ${wrong.join(", ")} differ from site.launchDate ${launch}: the lead sets both to the launch day before production.`,
      ]
    : [];
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

/** Everything for `webDir` (apps/web); needs dist built. Returns the problems (empty = ready). */
export function checkProdReadiness(webDir) {
  const dist = join(webDir, "dist");
  if (!existsSync(dist)) return [`${dist} does not exist: build the site first.`];
  const siteTs = readFileSync(join(webDir, "src", "config", "site.ts"), "utf8");
  const problems = checkSiteConfig(siteTs);
  problems.push(...checkLaunchDate(siteTs, readFileSync(join(webDir, "src", "content", "legal.ts"), "utf8")));
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
