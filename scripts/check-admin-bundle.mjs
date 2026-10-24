// Guard for the admin Worker bundle (M1.5 part 2): run after `vite build`, it fails when the script grows past 60 %
// of the M0 baseline (277,252 bytes before the cold-start work) or when classic zod finds its way back in (the
// request schemas use `zod/mini`; classic zod is ~150 KB). Part of `pnpm build` in apps/admin.
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const M0_RAW_BYTES = 277_252;
// 60 % of M0 from M3.2 (lead, 2026-10-24): the leads API needs ~27 KB; the sign-in cold-start CPU is re-read on staging.
const LIMIT = Math.floor((M0_RAW_BYTES * 3) / 5);
// Names only classic zod registers. zod/mini's shared core registers the same classes with a leading "$" (`$ZodNumber`), which
// appear as soon as a schema uses a number, array or boolean (the M3.1 settings schemas do), so a marker counts only when the
// quoted name has no "$" before it.
const CLASSIC_MARKER = /["'`]Zod(?:Number|Array|Union|Boolean)["'`]/;

const file = fileURLToPath(new URL("../apps/admin/dist/techaust_platform_admin/index.js", import.meta.url));
const size = statSync(file).size;
const text = readFileSync(file, "utf8");
const found = CLASSIC_MARKER.exec(text);
const problems = [];
if (size > LIMIT)
  problems.push(`the Worker bundle is ${size} bytes; the limit is ${LIMIT} (60 % of the M0 baseline)`);
if (found) problems.push(`classic zod is in the Worker bundle (${found[0]}): import from "zod/mini"`);
if (problems.length) {
  console.error(`admin bundle check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`admin bundle ok: ${size} bytes (limit ${LIMIT}), no classic zod`);
