// Build check for the public site: run after `astro build` (apps/web `build` script). Exits 1 with the list of problems.
// Rules: docs/04 WEB-G-07, -12, -18 and audit M-3 (see scripts/web-dist-checks.mjs).
import { fileURLToPath } from "node:url";
import { checkWeb } from "./web-dist-checks.mjs";
import { measureJs } from "./web-seo-checks.mjs";

const webDir = fileURLToPath(new URL("../apps/web", import.meta.url));
const problems = checkWeb(webDir);
// The five heaviest pages by gzipped JavaScript (budget 50 KB per page, WEB-G-13).
const { rows } = measureJs(`${webDir}/dist`);
console.log("check-web-dist: heaviest pages by gzipped JavaScript");
for (const r of rows.slice(0, 5)) console.log(`  ${(r.total / 1024).toFixed(1).padStart(5)} KB  ${r.name}`);
if (problems.length > 0) {
  console.error(`check-web-dist: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  "check-web-dist: ok (CSP hashes, no inline styles, no GSTIN / @techaustsocial / proprietor name / GA, no preview pages, no price literals, no '&' in page text, no banned phrases, one h1 per page, no unrendered {{ }} ** or arrows)",
);
