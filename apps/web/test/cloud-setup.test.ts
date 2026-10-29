// Cloud sessions (CLOUD-1): the setup script's pins match the repository, the SessionStart hook does nothing outside a cloud
// session, the Playwright MCP server is pinned and off on this PC, and the cloud PR script never merges. Runs in Node; the cases
// that run a shell script need bash (Git Bash on Windows, skipped if it is not installed).
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import { CLOUD_ONLY_SERVERS, coversServers, withServersOff } from "../../../tools/mcp-local-off.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const json = (p: string) => JSON.parse(read(p));
const setup = read("scripts/cloud-setup.sh");
const pin = (name: string) => new RegExp(`^${name}=(\\S+)$`, "m").exec(setup)?.[1];

const BASH =
  process.platform === "win32"
    ? join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe")
    : "/bin/bash";
const hasBash = existsSync(BASH);
const bash = (args: string[], env: Record<string, string | undefined> = {}) => {
  const { CLAUDE_CODE_REMOTE: _r, CLAUDE_ENV_FILE: _e, ...base } = process.env;
  return spawnSync(BASH, args, { cwd: ROOT, env: { ...base, ...env }, encoding: "utf8" });
};

describe("the setup script's pins are the repository's", () => {
  it("Node: the .nvmrc major, inside `engines`, with both Linux checksums", () => {
    const node = pin("NODE_VERSION") ?? "";
    const [major, minor] = node.split(".").map(Number);
    expect(String(major)).toBe(read(".nvmrc").trim());
    expect(json("package.json").engines.node).toBe(">=24.19.0 <27");
    expect(major === 24 && (minor ?? 0) >= 19).toBe(true);
    expect(pin("NODE_SHA256_X64")).toMatch(/^[0-9a-f]{64}$/);
    expect(pin("NODE_SHA256_ARM64")).toMatch(/^[0-9a-f]{64}$/);
    expect(setup).toContain("sha256sum -c");
  });
  it("pnpm: package.json `packageManager`", () => {
    expect(`pnpm@${pin("PNPM_VERSION")}`).toBe(json("package.json").packageManager);
  });
  it("Playwright: the @playwright/test pin of every package that has one", () => {
    const dirs = ["apps", "packages"].flatMap((d) => readdirSync(join(ROOT, d)).map((n) => `${d}/${n}`));
    const pins = dirs
      .filter((d) => existsSync(join(ROOT, d, "package.json")))
      .map((d) => json(`${d}/package.json`).devDependencies?.["@playwright/test"])
      .filter(Boolean);
    expect(pins.length).toBeGreaterThan(0);
    for (const p of pins) expect(p).toBe(pin("PLAYWRIGHT_VERSION"));
  });
  it("the MCP server: the version in .mcp.json", () => {
    expect(json(".mcp.json").mcpServers.playwright.args).toContain(
      `@playwright/mcp@${pin("PLAYWRIGHT_MCP_VERSION")}`,
    );
  });
  it("critical steps stop it; only the browsers may fail; it ends with exit 0", () => {
    expect(setup).toMatch(/die "corepack enable"/);
    expect(setup.match(/\|\| true/g)).toHaveLength(1); // the chmod of the browser folder
    expect(setup.trimEnd().endsWith("exit 0")).toBe(true);
    expect(setup).toContain("PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright");
  });
});

describe("the Playwright MCP server (.mcp.json)", () => {
  const servers = json(".mcp.json").mcpServers;
  it("one server, an exact version, headless Chromium with an isolated profile", () => {
    expect(Object.keys(servers)).toEqual(["playwright"]);
    const { command, args, env } = servers.playwright;
    expect(command).toBe("npx");
    const pkg = args.find((a: string) => a.startsWith("@playwright/mcp@"));
    expect(pkg).toMatch(/^@playwright\/mcp@\d+\.\d+\.\d+$/);
    expect(args).toEqual(expect.arrayContaining(["--headless", "--isolated", "--browser", "chromium"]));
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code's ${VAR:-default} expansion in .mcp.json, not a template
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe("${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}");
  });
  it("is kept off on this PC through a git-ignored setting, never through the shared one", () => {
    expect(CLOUD_ONLY_SERVERS).toEqual(["playwright"]);
    const settings = json(".claude/settings.json");
    expect(settings.disabledMcpjsonServers).toBeUndefined();
    expect(settings.enabledMcpjsonServers).toBeUndefined();
    expect(settings.enableAllProjectMcpServers).toBeUndefined();
    expect(settings.enabledPlugins["playwright@claude-plugins-official"]).toBe(true);
    expect(read(".gitignore").split(/\r?\n/)).toContain(".claude/settings.local.json");
  });
  it("mcp-local-off adds the server and keeps everything else", () => {
    const before = { enabledMcpjsonServers: ["x"], disabledMcpjsonServers: ["other"], theme: "dark" };
    const after = withServersOff(before);
    expect(after).toEqual({ ...before, disabledMcpjsonServers: ["other", "playwright"] });
    expect(withServersOff(after)).toEqual(after);
    expect(coversServers(after)).toBe(true);
    expect(coversServers(before)).toBe(false);
    expect(coversServers({})).toBe(false);
  });
});

describe("the SessionStart hook", () => {
  const settings = json(".claude/settings.json");
  it("runs scripts/cloud-session-start.sh on startup and resume, within the 600 s limit; the model guard stays", () => {
    const [entry] = settings.hooks.SessionStart;
    expect(entry.matcher).toBe("startup|resume");
    expect(entry.hooks[0].command).toBe('bash "$CLAUDE_PROJECT_DIR/scripts/cloud-session-start.sh"');
    expect(entry.hooks[0].timeout).toBeLessThanOrEqual(600);
    expect(entry.hooks[0].async).toBeUndefined();
    expect(JSON.stringify(settings.hooks.PreToolUse)).toContain("tools/model-guard.mjs");
  });
  it("its first command is the cloud-session test", () => {
    const code = read("scripts/cloud-session-start.sh")
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith("#"));
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a line of bash, not a template
    expect(code[0]).toBe('[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0');
  });
  it("reinstalls when the lockfile, the workspace file or a package.json changes (L1)", () => {
    expect(read("scripts/cloud-session-start.sh")).toContain(
      "git ls-files -z -- pnpm-lock.yaml pnpm-workspace.yaml 'package.json' '*/package.json'",
    );
  });
  it.skipIf(!hasBash)("does nothing outside a cloud session: exit 0, no output, nothing written", () => {
    const dir = mkdtempSync(join(tmpdir(), "cloud-hook-"));
    try {
      const envFile = join(dir, "env");
      writeFileSync(envFile, "");
      for (const remote of [undefined, "false", "1"]) {
        const r = bash(["scripts/cloud-session-start.sh"], {
          CLAUDE_CODE_REMOTE: remote,
          CLAUDE_ENV_FILE: envFile,
          CLAUDE_PROJECT_DIR: dir, // were it to run, it would fail loudly here
        });
        expect(r.status, String(remote)).toBe(0);
        expect(r.stdout + r.stderr).toBe("");
      }
      expect(readFileSync(envFile, "utf8")).toBe("");
      expect(readdirSync(dir)).toEqual(["env"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.skipIf(!hasBash)(
    "the exact settings command, through bash -c with the real (spaced) project folder: exit 0, no output",
    () => {
      const command = settings.hooks.SessionStart[0].hooks[0].command;
      const r = bash(["-c", command], {
        CLAUDE_CODE_REMOTE: undefined,
        CLAUDE_PROJECT_DIR: ROOT.replace(/[\\/]$/, ""),
      });
      expect(ROOT).toContain(" ");
      expect(r.status).toBe(0);
      expect(r.stdout + r.stderr).toBe("");
    },
  );
  // M1: the model check. The cloud path runs here in an empty folder, where every project step fails at once (named in the
  // summary), so only the model line, the env file and the exit code are read.
  it.skipIf(!hasBash)(
    "in a cloud session, a model other than Opus 5.5 leads the summary; Opus 5.5, no model or no input does not",
    { timeout: 120_000 },
    () => {
      const run = (input: string | null) => {
        const dir = mkdtempSync(join(tmpdir(), "cloud-model-"));
        try {
          const envFile = join(dir, "env");
          writeFileSync(envFile, "");
          const r = spawnSync(BASH, ["scripts/cloud-session-start.sh"], {
            cwd: ROOT,
            env: {
              ...process.env,
              CLAUDE_CODE_REMOTE: "true",
              CLAUDE_ENV_FILE: envFile,
              CLAUDE_PROJECT_DIR: dir,
            },
            input: input ?? undefined,
            stdio: [input === null ? "ignore" : "pipe", "pipe", "pipe"],
            encoding: "utf8",
            timeout: 60_000,
          });
          return { ...r, env: readFileSync(envFile, "utf8") };
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      };
      const start = (model?: string) =>
        JSON.stringify({ hook_event_name: "SessionStart", source: "startup", ...(model ? { model } : {}) });
      const other = run(start("claude-sonnet-5-5"));
      expect(other.status).toBe(0);
      expect(other.stdout).toMatch(
        /^MODEL IS claude-sonnet-5-5, NOT Opus 5\.5: stop and tell the owner; cloud session start/,
      );
      // L4: no wrangler telemetry from the cloud (also exported for every later command)
      expect(other.env).toContain("export WRANGLER_SEND_METRICS=false");
      for (const input of [
        start("claude-opus-5-5"),
        start("claude-opus-5-5[1m]"),
        start(),
        "",
        "not json",
        null,
      ]) {
        const r = run(input);
        expect(r.status, String(input)).toBe(0);
        expect(r.stdout, String(input)).toMatch(/^cloud session start \(/);
      }
    },
  );
});

describe("tools/mcp-local-off.mjs in a cloud session", () => {
  it("refuses and writes nothing (run from a copy, so a mistake could not touch this checkout)", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-off-"));
    try {
      mkdirSync(join(dir, "tools"));
      copyFileSync(join(ROOT, "tools", "mcp-local-off.mjs"), join(dir, "tools", "mcp-local-off.mjs"));
      for (const args of [[], ["--user"]]) {
        const r = spawnSync(process.execPath, [join(dir, "tools", "mcp-local-off.mjs"), ...args], {
          env: { ...process.env, CLAUDE_CODE_REMOTE: "true", HOME: dir, USERPROFILE: dir },
          encoding: "utf8",
        });
        expect(r.status, args.join(" ")).toBe(1);
        expect(r.stderr).toContain("this is a cloud session");
      }
      expect(readdirSync(dir)).toEqual(["tools"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("tools/cloud-pr.sh", () => {
  const script = read("tools/cloud-pr.sh");
  const code = script.split(/\r?\n/).filter((l) => !l.trim().startsWith("#"));
  it("opens a PR over REST and never merges or turns on auto-merge", () => {
    expect(code.join("\n")).toContain('gh api --method POST "repos/$REPO/pulls"');
    expect(code.join("\n")).not.toMatch(/gh pr |merge|--auto|auto_merge|enablePullRequestAutoMerge/);
    expect(script).toContain('REPO="techaust/techaust_platform"');
  });
  it.skipIf(!hasBash)("--dry-run names the request and touches nothing; main is refused", () => {
    const dir = mkdtempSync(join(tmpdir(), "cloud-pr-"));
    try {
      const body = join(dir, "body.md");
      writeFileSync(body, "Summary\n");
      const ok = bash([
        "tools/cloud-pr.sh",
        "--dry-run",
        "--head",
        "fix/x",
        "--title",
        "fix: x",
        "--body-file",
        body,
      ]);
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain(
        "POST repos/techaust/techaust_platform/pulls head=fix/x base=main title=fix: x",
      );
      const main = bash([
        "tools/cloud-pr.sh",
        "--dry-run",
        "--head",
        "main",
        "--title",
        "t",
        "--body-file",
        body,
      ]);
      expect(main.status).toBe(2);
      expect(main.stderr).toContain("refusing");
      expect(bash(["tools/cloud-pr.sh", "--title", "t"]).status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
