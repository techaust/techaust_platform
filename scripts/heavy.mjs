// Shared queue for heavy checks (tests, builds, typecheck) when several builder agents work at once.
// Usage: node scripts/heavy.mjs pnpm test
// Runs the command only when no other heavy check holds the lock (one lock per PC, shared by every
// worktree) and the PC has at least MIN_FREE_GB of free memory; otherwise it waits. Exit code = the command's.
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { freemem, tmpdir } from "node:os";
import { join } from "node:path";

const LOCK = join(tmpdir(), "techaust-heavy.lock");
const MIN_FREE_GB = Number(process.env.HEAVY_MIN_FREE_GB ?? 1.5);
const cmd = process.argv.slice(2).join(" ");
if (!cmd) {
  console.error("Usage: node scripts/heavy.mjs <command>");
  process.exit(2);
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function acquire() {
  try {
    closeSync(openSync(LOCK, "wx"));
    writeFileSync(LOCK, String(process.pid));
    return true;
  } catch {
    // Someone holds it; take it over only if that process is gone (a crashed check).
    const pid = Number(readFileSync(LOCK, "utf8").trim() || 0);
    if (pid && !alive(pid)) rmSync(LOCK, { force: true });
    return false;
  }
}

let told = false;
for (;;) {
  const freeGb = freemem() / 1024 ** 3;
  if (freeGb < MIN_FREE_GB) {
    if (!told) console.error(`[heavy] waiting: low memory (${freeGb.toFixed(1)} GB free)`);
    told = true;
  } else if (acquire()) break;
  else if (!told) {
    console.error("[heavy] waiting for another heavy check to finish…");
    told = true;
  }
  sleep(3_000);
}

try {
  const r = spawnSync(cmd, { stdio: "inherit", shell: true });
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(LOCK, { force: true });
}
