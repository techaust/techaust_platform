// Guard for the admin Worker bundle (M1.5 part 2): run after `vite build`, it fails when the script grows past half
// of the M0 baseline (277,252 bytes before the cold-start work) or when classic zod finds its way back in (the
// request schemas use `zod/mini`; classic zod is ~150 KB). Part of `pnpm build` in apps/admin.
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const M0_RAW_BYTES = 277_252;
const LIMIT = Math.floor(M0_RAW_BYTES / 2);
// Class names only classic zod registers (zod/mini and the shared core never mention these).
const CLASSIC_MARKERS = ["ZodNumber", "ZodArray", "ZodUnion", "ZodBoolean"];

const file = fileURLToPath(new URL("../apps/admin/dist/techaust_platform_admin/index.js", import.meta.url));
const size = statSync(file).size;
const text = readFileSync(file, "utf8");
const found = CLASSIC_MARKERS.filter((m) => text.includes(m));
const problems = [];
if (size > LIMIT)
  problems.push(`the Worker bundle is ${size} bytes; the limit is ${LIMIT} (50 % of the M0 baseline)`);
if (found.length)
  problems.push(`classic zod is in the Worker bundle (${found.join(", ")}): import from "zod/mini"`);
if (problems.length) {
  console.error(`admin bundle check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`admin bundle ok: ${size} bytes (limit ${LIMIT}), no classic zod`);
