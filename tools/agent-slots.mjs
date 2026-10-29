// Whether the lead may start another agent now (docs/14 §5, owner 2026-10-29). Run it before every start:
//   node tools/agent-slots.mjs --running <n> --browsers <n> [--browser] [--usage <pct>] [--cloud]
//                              [--reading <pct> --reading-at <ISO time>]
// - this PC: at most 2 agents (every agent counts, the helpers too), at most 1 using a browser, and none starts while free
//   memory is under 300 MB;
// - a cloud session (--cloud, or CLAUDE_CODE_REMOTE=true, which Claude Code sets only there, on any OS): another agent starts while
//   the virtual machine has at least 3 GB of free memory and its 1-minute load average is under 80 % of its processors, up to 5 agents;
//   at most 1 using a browser for now (the owner allows 2, but one .mcp.json server is one browser with one tab; a second browser
//   agent needs a server of its own, a later task: docs/14 §4);
// - the budget gate: new agents start while the 5-hour bar is at or under 95 %. A cloud session that can't read the bar uses the
//   reading posted in docs/runs/usage-reading.md: none for today (IST) means nothing new starts, one over 2 hours old means one agent
//   at a time.
// Prints one line ("start: yes|no …") and exits 0 when an agent may start, 1 when not. `decide` is pure, for the test. A value that
// isn't a plain non-negative number (whole for --running and --browsers), a flag given without its value, or a --reading-at that
// isn't a date is refused before deciding: "start: no (bad value for --usage: "abc")", exit 1.
import { cpus, freemem, loadavg } from "node:os";

export const LIMITS = {
  local: { agents: 2, browsers: 1, minFreeBytes: 300 * 1024 ** 2 },
  cloud: { agents: 5, browsers: 1, minFreeBytes: 3 * 1024 ** 3, maxLoadShare: 0.8 },
  gatePct: 95,
  staleReadingMs: 2 * 60 * 60 * 1000,
};

/**
 * Whether this process runs in a Claude Code cloud session: Claude Code sets CLAUDE_CODE_REMOTE to "true" there and never on this
 * PC (code.claude.com/docs env-vars, read 2026-10-29). The value is compared exactly, whatever the OS.
 * @param {Record<string, string | undefined>} env
 */
export const isCloudSession = (env) => env.CLAUDE_CODE_REMOTE === "true";

/** The IST calendar day of a UTC instant, as YYYY-MM-DD. */
const istDay = (ms) => new Date(ms + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * @param {{ place: "local" | "cloud", running: number, browsers: number, wantsBrowser: boolean, freeBytes: number, cores: number,
 *   load1: number, usagePct?: number | null, reading?: { pct: number, atMs: number } | null, nowMs: number }} s
 * @returns {{ start: boolean, why: string }}
 */
export function decide(s) {
  const limits = LIMITS[s.place];
  // the budget gate first: a live reading, else (cloud only) the posted one
  let oneAtATime = false;
  if (typeof s.usagePct === "number") {
    if (s.usagePct > LIMITS.gatePct)
      return { start: false, why: `5-hour bar ${s.usagePct} % is over ${LIMITS.gatePct} %` };
  } else if (s.place === "cloud") {
    if (!s.reading || istDay(s.reading.atMs) !== istDay(s.nowMs))
      return { start: false, why: "no usage reading posted today (docs/runs/usage-reading.md)" };
    if (s.reading.pct > LIMITS.gatePct)
      return { start: false, why: `posted 5-hour reading ${s.reading.pct} % is over ${LIMITS.gatePct} %` };
    if (s.nowMs - s.reading.atMs > LIMITS.staleReadingMs) oneAtATime = true;
  } else {
    oneAtATime = true; // this PC can always read the bar; without it, be careful (docs/14 §5)
  }
  if (oneAtATime && s.running >= 1)
    return { start: false, why: "usage reading missing or over 2 hours old: one agent at a time" };
  if (s.running >= limits.agents)
    return { start: false, why: `${s.running} agents running; the ${s.place} limit is ${limits.agents}` };
  if (s.wantsBrowser && s.browsers >= limits.browsers)
    return {
      start: false,
      why: `${s.browsers} browser agents running; the ${s.place} limit is ${limits.browsers}`,
    };
  if (s.freeBytes < limits.minFreeBytes)
    return {
      start: false,
      why: `free memory ${(s.freeBytes / 1024 ** 3).toFixed(2)} GB is under ${(limits.minFreeBytes / 1024 ** 3).toFixed(2)} GB`,
    };
  if (s.place === "cloud" && s.load1 >= limits.maxLoadShare * s.cores)
    return { start: false, why: `load ${s.load1.toFixed(2)} is at or over 80 % of ${s.cores} processors` };
  return {
    start: true,
    why: `${s.place}: ${s.running + 1} of ${limits.agents} agents${s.wantsBrowser ? `, browser ${s.browsers + 1} of ${limits.browsers}` : ""}`,
  };
}

const isMain =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  const args = process.argv.slice(2);
  const val = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  // A flag's value: undefined when the flag is absent; a refusal when it is present without a usable value (NaN would slip
  // through every comparison in `decide`).
  const refuse = (name, raw) => {
    console.log(
      `start: no (bad value for ${name}: ${raw === undefined ? "none given" : JSON.stringify(raw)})`,
    );
    process.exit(1);
  };
  const num = (name, whole = false) => {
    if (!args.includes(name)) return undefined;
    const raw = val(name);
    if (raw === undefined || !(whole ? /^\d+$/ : /^\d+(\.\d+)?$/).test(raw)) refuse(name, raw);
    return Number(raw);
  };
  const cloud = args.includes("--cloud") || isCloudSession(process.env);
  const running = num("--running", true);
  const browsers = num("--browsers", true);
  const usage = num("--usage");
  const readingPct = num("--reading");
  const readingAt = val("--reading-at");
  if (args.includes("--reading-at") && (readingAt === undefined || Number.isNaN(Date.parse(readingAt))))
    refuse("--reading-at", readingAt);
  const r = decide({
    place: cloud ? "cloud" : "local",
    running: running ?? 0,
    browsers: browsers ?? 0,
    wantsBrowser: args.includes("--browser"),
    freeBytes: freemem(),
    cores: cpus().length,
    load1: loadavg()[0],
    usagePct: usage ?? null,
    reading: readingPct !== undefined && readingAt ? { pct: readingPct, atMs: Date.parse(readingAt) } : null,
    nowMs: Date.now(),
  });
  console.log(`start: ${r.start ? "yes" : "no"} (${r.why})`);
  process.exit(r.start ? 0 : 1);
}
