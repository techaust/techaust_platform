// Cold-start proxy for the admin Worker bundle (M1.5, docs/runs/m1.5-staff-auth.md part J).
// It starts N fresh Node processes; each one imports the built Worker bundle and answers one
// `GET /api/v1/health`, timing both with process.cpuUsage() (user + system CPU) and wall time.
// This is a PROXY: Node's module loader and JIT are not workerd's, so use it to compare two bundles
// (before / after), never as an absolute number. If the bundle cannot load in Node it says so.
//   node scripts/cold-start.mjs [bundle.js] [--runs 20]
// Default bundle: apps/admin/dist/techaust_platform_admin/index.js (build it first with
//   CLOUDFLARE_ENV=staging pnpm --filter @techaust/admin exec vite build).
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

const here = fileURLToPath(import.meta.url);
const root = resolve(here, "..", "..");

if (process.argv[2] === "--child") {
  const url = pathToFileURL(process.argv[3]).href;
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  const mod = await import(url);
  const cpu1 = process.cpuUsage(cpu0);
  const t1 = performance.now();
  const env = { ENVIRONMENT: "cold-start" };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const res = await mod.default.fetch(new Request("http://localhost/api/v1/health"), env, ctx);
  const cpu2 = process.cpuUsage(cpu0);
  const t2 = performance.now();
  if (res.status !== 200) throw new Error(`health answered ${res.status}`);
  console.log(
    JSON.stringify({
      importCpuMs: (cpu1.user + cpu1.system) / 1000,
      firstCpuMs: (cpu2.user + cpu2.system - cpu1.user - cpu1.system) / 1000,
      totalCpuMs: (cpu2.user + cpu2.system) / 1000,
      importWallMs: t1 - t0,
      totalWallMs: t2 - t0,
    }),
  );
  process.exit(0);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { runs: { type: "string", default: "20" } },
});
const bundle = resolve(positionals[0] ?? resolve(root, "apps/admin/dist/techaust_platform_admin/index.js"));
const runs = Number(values.runs);
const size = statSync(bundle).size;
const gz = gzipSync(readFileSync(bundle)).length;
console.log(`bundle ${bundle}\n  raw ${size} bytes, gzip ${gz} bytes`);

const samples = [];
for (let i = 0; i < runs; i++) {
  const r = spawnSync(process.execPath, [here, "--child", bundle], { encoding: "utf8" });
  if (r.status !== 0) {
    console.log(
      `The bundle does not load in Node (run ${i + 1}); use size only.\n${r.stderr.split("\n").slice(0, 6).join("\n")}`,
    );
    process.exit(0);
  }
  samples.push(JSON.parse(r.stdout.trim().split("\n").at(-1)));
}
const pct = (xs, p) =>
  xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const show = (key) => {
  const xs = samples.map((s) => s[key]);
  return `${key}: median ${pct(xs, 50).toFixed(1)} ms, p90 ${pct(xs, 90).toFixed(1)} ms`;
};
console.log(`${runs} fresh Node processes (${process.version})`);
for (const k of ["importCpuMs", "firstCpuMs", "totalCpuMs", "importWallMs", "totalWallMs"])
  console.log(`  ${show(k)}`);
