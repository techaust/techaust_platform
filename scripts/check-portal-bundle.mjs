// Guard for the portal Worker bundle (M1.6, LD13): run after `vite build`, it fails when the script grows past
// 80,000 bytes raw (the admin Worker is ~79,000 with far more routes; the same cold-start levers apply from day one:
// minified build, hono/tiny, zod/mini) or when classic zod finds its way in (it is ~150 KB). Part of `pnpm build` in
// apps/portal. A copy of check-admin-bundle.mjs with its own limit.
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LIMIT = 80_000;
// Class names only classic zod registers (zod/mini and the shared core never mention these).
const CLASSIC_MARKERS = ["ZodNumber", "ZodArray", "ZodUnion", "ZodBoolean"];

const file = fileURLToPath(new URL("../apps/portal/dist/techaust_platform_portal/index.js", import.meta.url));
const size = statSync(file).size;
const text = readFileSync(file, "utf8");
const found = CLASSIC_MARKERS.filter((m) => text.includes(m));
const problems = [];
if (size > LIMIT) problems.push(`the Worker bundle is ${size} bytes; the limit is ${LIMIT}`);
if (found.length)
  problems.push(`classic zod is in the Worker bundle (${found.join(", ")}): import from "zod/mini"`);
if (problems.length) {
  console.error(`portal bundle check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`portal bundle ok: ${size} bytes (limit ${LIMIT}), no classic zod`);
