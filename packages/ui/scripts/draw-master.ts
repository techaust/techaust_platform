// Writes brand/source/techaust-master.svg. Run: pnpm --filter @techaust/ui draw:master (then build:brand)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMaster } from "../src/brand/master.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "brand/source/techaust-master.svg");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, await renderMaster(root));
console.log("wrote brand/source/techaust-master.svg");
