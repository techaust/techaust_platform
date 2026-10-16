// Checks a rendered kit folder (default <repo>/.logs/social/kit) the way test/social.test.ts checks the committed
// one: every file present and nothing else, exact size, sRGB 8-bit, current source hash, under each limit.
// Run: node packages/ui/scripts/check-social-out.ts [dir]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBrand, parseMaster } from "../src/brand/compose.ts";
import { pngInfo, sourceHash } from "../src/brand/png.ts";
import { socialPlan, socialReadme } from "../src/brand/social.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(process.argv[2] ?? join(root, "..", "..", ".logs", "social", "kit"));
const brand = createBrand(parseMaster(readFileSync(join(root, "brand/source/techaust-master.svg"), "utf8")));
const plan = socialPlan(brand);
const all = (d: string): string[] =>
  readdirSync(d).flatMap((n) =>
    statSync(join(d, n)).isDirectory() ? all(join(d, n)) : [relative(dir, join(d, n))],
  );

const problems: string[] = [];
const want = [...plan.map((f) => f.file), "README.md"].sort();
const got = all(dir)
  .map((f) => f.replaceAll("\\", "/"))
  .sort();
if (JSON.stringify(want) !== JSON.stringify(got)) problems.push(`file list differs:\n${got.join("\n")}`);
if (readFileSync(join(dir, "README.md"), "utf8") !== socialReadme(plan)) problems.push("README differs");
let largest = { file: "", bytes: 0 };
for (const f of plan) {
  const buf = readFileSync(join(dir, f.file));
  if (buf.length > largest.bytes) largest = { file: f.file, bytes: buf.length };
  if (f.kind === "svg") {
    if (buf.toString("utf8") !== f.svg) problems.push(`${f.file}: svg differs`);
    continue;
  }
  if (f.kind === "jpg") {
    if (buf.length >= (f.item.jpg?.maxBytes ?? 0)) problems.push(`${f.file}: ${buf.length} bytes`);
    if (!buf.toString("latin1").includes(`techaust:svg-sha256=${sourceHash(f.svg)}`))
      problems.push(`${f.file}: hash`);
    console.log(`${f.file}: ${buf.length} bytes`);
    continue;
  }
  const i = pngInfo(buf);
  const colour = f.item.transparent ? 6 : 2;
  if (i.width !== f.width || i.height !== f.height) problems.push(`${f.file}: ${i.width}×${i.height}`);
  if (i.colourType !== colour || i.bitDepth !== 8 || !i.srgb || i.iccp)
    problems.push(`${f.file}: colour ${i.colourType}`);
  if (i.source !== sourceHash(f.svg)) problems.push(`${f.file}: stale`);
  if (buf.length >= f.item.maxBytes) problems.push(`${f.file}: ${buf.length} bytes over ${f.item.maxBytes}`);
}
console.log(`${plan.length} files checked; largest ${largest.file} (${Math.round(largest.bytes / 1024)} KB)`);
console.log(problems.length ? `PROBLEMS:\n${problems.join("\n")}` : "all good");
process.exitCode = problems.length ? 1 : 0;
