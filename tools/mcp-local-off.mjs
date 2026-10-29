// Keeps the project's cloud-only MCP servers (.mcp.json: the Playwright server, CLOUD-1) off on this PC, where the Playwright
// plugin already gives every agent a browser. Run it once in each checkout Claude Code is started in (the lead's main checkout):
//   node tools/mcp-local-off.mjs            # writes <checkout>/.claude/settings.local.json (git-ignored)
//   node tools/mcp-local-off.mjs --user     # or ~/.claude/settings.json, which covers every checkout and worktree on this PC
//   node tools/mcp-local-off.mjs --check    # says whether the current checkout is covered; exit 1 if not
// It adds the servers to `disabledMcpjsonServers` (code.claude.com/docs settings: "reject specific servers defined in a project's
// .mcp.json so Claude Code never connects them or asks for approval"; rejection wins over every approval). Other settings in the
// file are kept. It refuses to run in a cloud session (CLAUDE_CODE_REMOTE=true), where the server is the only browser.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The .mcp.json servers that exist for cloud sessions only. */
export const CLOUD_ONLY_SERVERS = ["playwright"];

/** The settings object with the cloud-only servers added to `disabledMcpjsonServers` (nothing else changes). */
export function withServersOff(settings, servers = CLOUD_ONLY_SERVERS) {
  const off = Array.isArray(settings.disabledMcpjsonServers) ? settings.disabledMcpjsonServers : [];
  return { ...settings, disabledMcpjsonServers: [...new Set([...off, ...servers])] };
}

/** Whether a settings object keeps every cloud-only server off. */
export const coversServers = (settings, servers = CLOUD_ONLY_SERVERS) =>
  servers.every(
    (s) => Array.isArray(settings?.disabledMcpjsonServers) && settings.disabledMcpjsonServers.includes(s),
  );

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const args = process.argv.slice(2);
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const local = join(root, ".claude", "settings.local.json");
  const user = join(homedir(), ".claude", "settings.json");
  if (args.includes("--check")) {
    const by = [local, user].filter((f) => coversServers(readJson(f)));
    console.log(
      by.length ? `off on this PC (${by.join(", ")})` : "NOT off: run node tools/mcp-local-off.mjs",
    );
    process.exit(by.length ? 0 : 1);
  }
  if (process.env.CLAUDE_CODE_REMOTE === "true") {
    console.error(
      "mcp-local-off: this is a cloud session, where the .mcp.json browser is the only one; nothing changed",
    );
    process.exit(1);
  }
  const file = args.includes("--user") ? user : local;
  const before = readJson(file);
  if (coversServers(before)) {
    console.log(`already off: ${file}`);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(withServersOff(before), null, 2)}\n`);
    console.log(`turned off ${CLOUD_ONLY_SERVERS.join(", ")} in ${file}`);
  }
}
