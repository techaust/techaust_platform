// Cold-start proxy for the admin Worker bundle (M1.5, docs/runs/m1.5-staff-auth.md part J).
// It starts N fresh Node processes; each one imports the built Worker bundle and answers one
// `GET /api/v1/health`, timing both with process.cpuUsage() (user + system CPU) and wall time.
// This is a PROXY: Node's module loader and JIT are not workerd's, so use it to compare two bundles
// (before / after), never as an absolute number. If the bundle cannot load in Node it says so.
//
// Node itself costs about 20 ms on a first `Request`/`Response` (its fetch stack initialises lazily), whatever the
// bundle is. So the script also runs the same measurement on an EMPTY Worker (`fetch: () => Response.json(...)`)
// and prints the numbers "net of the floor": that is the part the bundle is responsible for. Windows reports
// process CPU in ~15.6 ms ticks, so compare on the wall figures.
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
const FLOOR = "floor";
const FLOOR_MODULE = "data:text/javascript,export default { fetch: () => Response.json({ ok: true }) };";

if (process.argv[2] === "--child") {
  const url = process.argv[3] === FLOOR ? FLOOR_MODULE : pathToFileURL(process.argv[3]).href;
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

/** `runs` fresh processes of one module; null when it can't be loaded in Node. */
function measure(target) {
  const out = [];
  for (let i = 0; i < runs; i++) {
    const r = spawnSync(process.execPath, [here, "--child", target], { encoding: "utf8" });
    if (r.status !== 0) {
      console.log(
        `The bundle does not load in Node (run ${i + 1}); use size only.\n${r.stderr.split("\n").slice(0, 6).join("\n")}`,
      );
      return null;
    }
    out.push(JSON.parse(r.stdout.trim().split("\n").at(-1)));
  }
  return out;
}
const pct = (xs, p) =>
  xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const col = (samples, key) => samples.map((s) => s[key]);

const samples = measure(bundle);
if (!samples) process.exit(0);
const floor = measure(FLOOR);
console.log(`${runs} fresh Node processes (${process.version})`);
for (const k of ["importCpuMs", "firstCpuMs", "totalCpuMs", "importWallMs", "totalWallMs"]) {
  const xs = col(samples, k);
  console.log(`  ${k}: median ${pct(xs, 50).toFixed(1)} ms, p90 ${pct(xs, 90).toFixed(1)} ms`);
}
if (floor) {
  const f = pct(col(floor, "totalWallMs"), 50);
  const fi = pct(col(floor, "importWallMs"), 50);
  const total = pct(col(samples, "totalWallMs"), 50);
  console.log(
    `empty Worker (the Node floor): total wall median ${f.toFixed(1)} ms, import ${fi.toFixed(1)} ms`,
  );
  console.log(`  net of the floor: total wall median ${(total - f).toFixed(1)} ms (the bundle's own share)`);
}
