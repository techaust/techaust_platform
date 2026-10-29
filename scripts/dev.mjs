// Starts one local dev server on the ports of TECHAUST_PORT_OFFSET (scripts/dev-ports.mjs; CLOUD-1). The apps' `dev` scripts and
// the admin, portal and web browser-test configs run it:
//   node ../../scripts/dev.mjs <web | webWorker | webE2e | admin | portal | jobs> [extra arguments…]
// It runs the package's own binary with this Node (no shell, so it behaves the same on Windows and Linux), in the app's folder,
// passes kill signals on (Ctrl-C only when it didn't come from a terminal; see forwardedSignals), and exits with the server's exit
// code. At offset 0 the ports are the ones the scripts used
// before; a wrangler Worker also gets its own inspector port when that port is free (the Vite apps set theirs in vite.config.ts).
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { devCommand, freeInspectorPort, portOffset, REPO_ROOT } from "./dev-ports.mjs";

/** The servers whose inspector port the launcher names on the command line (wrangler); Vite's is in its config. */
const WRANGLER_SERVERS = new Set(["webWorker", "webE2e", "jobs"]);

/** The JavaScript file of a package's binary, as installed in the app's node_modules (read from its package.json `bin`). */
export function binFile(appDir, pkg, name) {
  const dir = join(appDir, "node_modules", pkg);
  const { bin } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const rel = typeof bin === "string" ? bin : bin?.[name];
  if (!rel) throw new Error(`dev: ${pkg} has no "${name}" binary`);
  return join(dir, rel);
}

/**
 * The signals the launcher passes on to the server. SIGTERM and SIGHUP always. SIGINT only without a terminal: Ctrl-C in a terminal
 * already reaches the server (same process group), and passing it on as well would be a second Ctrl-C, which can make wrangler and
 * Vite skip stopping workerd cleanly (CLOUD-1 review, finding 11). The launcher still catches SIGINT, so it waits for the server.
 */
export function forwardedSignals(fromTerminal) {
  return fromTerminal ? ["SIGTERM", "SIGHUP"] : ["SIGINT", "SIGTERM", "SIGHUP"];
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const [name, ...extra] = process.argv.slice(2);
  if (!name) {
    console.error("Usage: node scripts/dev.mjs <web|webWorker|webE2e|admin|portal|jobs> [extra arguments…]");
    process.exit(2);
  }
  let cmd;
  try {
    const offset = portOffset();
    const opts = WRANGLER_SERVERS.has(name) ? { inspector: await freeInspectorPort(name, offset) } : {};
    cmd = devCommand(name, offset, REPO_ROOT, opts);
  } catch (e) {
    console.error(`[dev] ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  const appDir = join(REPO_ROOT, "apps", cmd.app);
  const file = binFile(appDir, cmd.bin[0], cmd.bin[1]);
  const args = [...cmd.args, ...extra];
  if (portOffset() !== 0)
    console.error(`[dev] TECHAUST_PORT_OFFSET=${portOffset()}: ${cmd.bin[1]} ${args.join(" ")}`);
  const child = spawn(process.execPath, [file, ...args], {
    cwd: appDir,
    stdio: "inherit",
    env: { ...process.env, ...cmd.env },
  });
  const forward = forwardedSignals(Boolean(process.stdin.isTTY));
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      if (forward.includes(signal) && child.exitCode === null) child.kill(signal);
    });
  }
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
