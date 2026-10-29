// The agent-start rule (tools/agent-slots.mjs; docs/14 §5, owner 2026-10-29): this PC 2 agents and 1 browser with a 300 MB floor;
// a cloud session up to 5 and 1 browser (2 once a second browser server exists, docs/14 §4) while 3 GB is free and the load is under 80 % of its processors; the 95 % gate; the posted
// reading for a cloud session that can't read the bar. Runs in Node.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import { decide, isCloudSession } from "../../../tools/agent-slots.mjs";

const GB = 1024 ** 3;
const now = Date.parse("2026-10-29T10:00:00Z"); // 15:30 IST
const local = (o: object = {}) =>
  decide({
    place: "local",
    running: 0,
    browsers: 0,
    wantsBrowser: false,
    freeBytes: 2 * GB,
    cores: 4,
    load1: 0,
    usagePct: 40,
    nowMs: now,
    ...o,
  });
const cloud = (o: object = {}) =>
  decide({
    place: "cloud",
    running: 0,
    browsers: 0,
    wantsBrowser: false,
    freeBytes: 8 * GB,
    cores: 8,
    load1: 1,
    usagePct: null,
    reading: { pct: 40, atMs: now - 30 * 60 * 1000 },
    nowMs: now,
    ...o,
  });

describe("this PC", () => {
  it("at most 2 agents, every agent counted", () => {
    expect(local({ running: 1 }).start).toBe(true);
    expect(local({ running: 2 }).start).toBe(false);
  });
  it("at most 1 browser agent", () => {
    expect(local({ running: 1, browsers: 0, wantsBrowser: true }).start).toBe(true);
    expect(local({ running: 1, browsers: 1, wantsBrowser: true }).start).toBe(false);
    expect(local({ running: 1, browsers: 1, wantsBrowser: false }).start).toBe(true);
  });
  it("none starts under 300 MB free", () => {
    expect(local({ freeBytes: 299 * 1024 ** 2 }).start).toBe(false);
    expect(local({ freeBytes: 301 * 1024 ** 2 }).start).toBe(true);
  });
  it("the gate: at or under 95 % starts, over 95 % doesn't; no reading means one at a time", () => {
    expect(local({ usagePct: 95 }).start).toBe(true);
    expect(local({ usagePct: 95.5 }).start).toBe(false);
    expect(local({ usagePct: null }).start).toBe(true);
    expect(local({ usagePct: null, running: 1 }).start).toBe(false);
  });
});

describe("a cloud session", () => {
  it("up to 5 agents and, for now, 1 browser agent (one .mcp.json server is one browser; CLOUD-1 M3)", () => {
    expect(cloud({ running: 4 }).start).toBe(true);
    expect(cloud({ running: 5 }).start).toBe(false);
    expect(cloud({ running: 3, browsers: 0, wantsBrowser: true }).start).toBe(true);
    expect(cloud({ running: 3, browsers: 1, wantsBrowser: true }).start).toBe(false);
    expect(cloud({ running: 3, browsers: 1, wantsBrowser: false }).start).toBe(true);
  });
  it("needs 3 GB free and a load under 80 % of its processors", () => {
    expect(cloud({ freeBytes: 2.9 * GB }).start).toBe(false);
    expect(cloud({ load1: 6.4 }).start).toBe(false); // 80 % of 8
    expect(cloud({ load1: 6.3 }).start).toBe(true);
  });
  it("the posted reading: none today stops new starts, over 2 hours old means one at a time, over 95 % stops", () => {
    expect(cloud({ reading: null }).start).toBe(false);
    expect(cloud({ reading: { pct: 40, atMs: Date.parse("2026-10-28T10:00:00Z") } }).start).toBe(false);
    expect(cloud({ reading: { pct: 40, atMs: now - 3 * 60 * 60 * 1000 } }).start).toBe(true);
    expect(cloud({ reading: { pct: 40, atMs: now - 3 * 60 * 60 * 1000 }, running: 1 }).start).toBe(false);
    expect(cloud({ reading: { pct: 96, atMs: now - 10 * 60 * 1000 } }).start).toBe(false);
    // a live reading wins when the session can read the bar
    expect(cloud({ reading: null, usagePct: 50 }).start).toBe(true);
  });
  it("a reading posted before midnight IST is not today's", () => {
    // 18:00 UTC on the 28th is 23:30 IST on the 28th; now is the 29th IST
    expect(cloud({ reading: { pct: 10, atMs: Date.parse("2026-10-28T18:00:00Z") } }).start).toBe(false);
    // 19:00 UTC on the 28th is 00:30 IST on the 29th: today, but over 2 hours old
    expect(cloud({ reading: { pct: 10, atMs: Date.parse("2026-10-28T19:00:00Z") } }).start).toBe(true);
  });
});

describe("finding a cloud session (CLOUD-1)", () => {
  it("CLAUDE_CODE_REMOTE=true, on any OS; anything else is this PC", () => {
    expect(isCloudSession({ CLAUDE_CODE_REMOTE: "true" })).toBe(true);
    for (const v of [undefined, "", "false", "1", "TRUE"])
      expect(isCloudSession({ CLAUDE_CODE_REMOTE: v })).toBe(false);
  });
  const SCRIPT = fileURLToPath(new URL("../../../tools/agent-slots.mjs", import.meta.url));
  const runCli = (env: Record<string, string>, ...args: string[]) => {
    const { CLAUDE_CODE_REMOTE: _, ...base } = process.env;
    return spawnSync(process.execPath, [SCRIPT, "--usage", "40", ...args], {
      env: { ...base, ...env },
      encoding: "utf8",
    }).stdout;
  };
  it("the command counts as a cloud session with the variable or --cloud, and as this PC without", () => {
    expect(runCli({ CLAUDE_CODE_REMOTE: "true" }, "--running", "5")).toContain("the cloud limit is 5");
    expect(runCli({}, "--cloud", "--running", "5")).toContain("the cloud limit is 5");
    expect(runCli({}, "--running", "5")).toContain("the local limit is 2");
    expect(runCli({ CLAUDE_CODE_REMOTE: "false" }, "--running", "5")).toContain("the local limit is 2");
  });
});

// A non-numeric, negative or missing value used to become NaN and pass every check in `decide` (review side note on #111).
describe("the command refuses a bad value", () => {
  const SCRIPT = fileURLToPath(new URL("../../../tools/agent-slots.mjs", import.meta.url));
  const run = (...args: string[]) => {
    const { CLAUDE_CODE_REMOTE: _, ...env } = process.env;
    return spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: "utf8" });
  };
  it.each([
    [["--usage", "abc"], 'bad value for --usage: "abc"'],
    [["--usage", "-5"], 'bad value for --usage: "-5"'],
    [["--usage", ""], 'bad value for --usage: ""'],
    [["--usage", "0x10"], 'bad value for --usage: "0x10"'],
    [["--running", "1", "--usage"], "bad value for --usage: none given"],
    [["--usage", "--running", "1"], 'bad value for --usage: "--running"'],
    [["--usage", "40", "--running", "x"], 'bad value for --running: "x"'],
    [["--usage", "40", "--running", "-1"], 'bad value for --running: "-1"'],
    [["--usage", "40", "--running", "1.5"], 'bad value for --running: "1.5"'],
    [["--usage", "40", "--browsers", "NaN"], 'bad value for --browsers: "NaN"'],
    [["--usage", "40", "--browsers"], "bad value for --browsers: none given"],
    [
      ["--cloud", "--reading", "abc", "--reading-at", "2026-10-29T10:00:00Z"],
      'bad value for --reading: "abc"',
    ],
    [["--cloud", "--reading", "40", "--reading-at", "yesterday"], 'bad value for --reading-at: "yesterday"'],
    [["--cloud", "--reading", "40", "--reading-at"], "bad value for --reading-at: none given"],
  ])("%j", (args, why) => {
    const r = run(...args);
    expect(r.stdout.trim()).toBe(`start: no (${why})`);
    expect(r.status).toBe(1);
  });
  it("good values still decide", () => {
    const r = run("--usage", "40.5", "--running", "0", "--browsers", "0");
    expect(r.stdout).not.toContain("bad value");
    expect(r.stdout).toMatch(/^start: (yes|no) \(/);
  });
});
