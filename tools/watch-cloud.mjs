// Watches the parallel cloud sessions of a run (runbook cloud-sessions Part 4, skill .claude/skills/orchestrate) and wakes the
// PC main session with one printed line per event. Run it through the Monitor tool:
//   node tools/watch-cloud.mjs [watch] [--run <file>] [--interval <s>] [--quiet <min>] [--action-only]
//   node tools/watch-cloud.mjs status [--run <file>]
//   node tools/watch-cloud.mjs stop [--run <file>]
// - the run file (default .logs/orchestrate/run.json, git-ignored) lists the tasks:
//   { "remote": "origin", "tasks": [{ "name": "x", "branch": "feat/x", "runFile": "docs/runs/x.md", "subBranches": ["fix/x-"] }] }
//   `remote` defaults to origin, `subBranches` (prefixes) to ["fix/<name>-"]; a branch matching prefixes of two tasks belongs to
//   the task with the longest matching prefix (identical prefixes in two tasks are refused); a bad file prints one line, exits 2;
// - every interval (default 60 s, at least 10): one `git ls-remote <remote> refs/heads/*`; a task branch whose head differs from
//   the last head *read* is fetched and its run file read at that commit; the head counts as seen only once the file was read
//   (2026-10-31: a push marked seen before it was read hid a PR READY for 30 minutes);
// - lines, `HH:MM IST <task> <KIND> <detail>`: STATUS on a change of the run file's Status line (PR-READY, WAITING, BLOCKED, FAIL,
//   SENT-BACK instead when the status *starts* with that keyword and needs the main session), SUB-PUSH, QUIET (no push on the
//   branch or its sub-branches for --quiet minutes, default 45; never while WAITING ON, PR READY or done), GONE (the branch was
//   deleted: done); lines that need the main session end with " ACTION" and --action-only prints only those (plus the start and
//   ALL DONE lines). Git failing for 5 ticks in a row prints one WATCHER line, then "WATCHER git back";
// - what it knows of each task is kept in <run dir>/watch.state.json, so a re-armed copy (the 30-minute heartbeat) prints only
//   what changed since the last copy: no repeated WAITING / PR-READY / SUB-PUSH lines, and a branch merged and deleted in between
//   still counts as done. A task with no saved state times QUIET from the newest commit on its branch and sub-branches;
// - only the newest copy runs: each start writes a random token to <run dir>/watch.token and a copy whose token is gone or
//   replaced exits 0 within 5 s (an expired Monitor on Windows leaves its bash and node running) and never writes the state
//   file again. `stop` removes the token;
// - exits 0 with ALL DONE once every task is PR READY, merged or gone; SIGINT and SIGTERM exit 0 quietly.
// Git runs with an argument array (never a shell), a 30 s timeout and no credential prompt. Written: the token and the state file
// (temp file + rename) beside the run file, and git's own FETCH_HEAD and remote-tracking refs from `git fetch` in the repository.
// Nothing is sent anywhere but to git. The pure parts are exported for apps/web/test/watch-cloud.test.ts.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const DEFAULTS = {
  runPath: ".logs/orchestrate/run.json",
  intervalS: 60,
  minIntervalS: 10,
  quietMin: 45,
  gitTimeoutMs: 30_000,
  failTicks: 5,
  tokenCheckMs: 5_000,
  statusLines: 40,
  maxStatusChars: 120,
};

export const NO_RUN_FILE = "(no run file yet)";
export const NO_STATUS_LINE = "(no Status line)";

/** @typedef {{ name: string, branch: string, runFile: string, subBranches: string[] }} Task */
/** @typedef {{ remote: string, tasks: Task[] }} Run */
/** @typedef {"pr-ready" | "waiting" | "blocked" | "fail" | "sent-back" | "merged" | "working"} StatusClass */
/** @typedef {{ ok: true, stdout: string } | { ok: false, error: string, timedOut?: boolean }} GitResult */
/** @typedef {(args: string[]) => Promise<GitResult>} Git */
/** @typedef {{ kind: string, detail: string, action: boolean }} Event */
/**
 * What the watcher knows of one task. `tip` is the head last listed by ls-remote, `head` the head whose run file was last read.
 * @typedef {{ started: boolean, tip: string | null, head: string | null, status: string | null, cls: StatusClass | null,
 *   url: string | null, subs: Record<string, string>, lastMoveMs: number | null, quietFired: boolean, gone: boolean }} TaskState
 */
/**
 * One tick's view of a task: the listed head (null when the branch is absent), the listed sub-branches, the run file read at
 * the head when it was fetched this tick (null when it wasn't, or the read failed), and, at a task's first tick only, the newest
 * committer time among its sub-branches (`subsMs`; a sub-branch whose time couldn't be read counts as now).
 * @typedef {{ tip: string | null, subs: Record<string, string>,
 *   read: { head: string, status: string, commitMs: number | null } | null, subsMs?: number | null }} Observation
 */

// ---------------------------------------------------------------------------------------------------------------- the run file

const NAME_RE = /^[a-z0-9._-]+$/;
const REMOTE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * A usable branch name (git check-ref-format, the parts that matter here): no spaces or control characters, no `..`, none of
 * `~^:?*[\`, no leading `-` (it would read as a git option), no empty, leading-dot or `.lock` component, no `@{`.
 * @param {string} s
 * @param {boolean} [prefix] a sub-branch prefix may end in "/" or "-"
 */
export function isRefName(s, prefix = false) {
  if (typeof s !== "string" || s === "" || s === "@") return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this refuses
  if (/[\s\x00-\x1f\x7f~^:?*[\\]/.test(s) || s.includes("..") || s.includes("@{")) return false;
  if (s.startsWith("-") || s.startsWith("/") || s.includes("//")) return false;
  const parts = s.split("/");
  const last = parts.length - 1;
  return parts.every((p, i) => {
    if (p === "") return prefix && i === last;
    return !p.startsWith(".") && !p.endsWith(".lock") && !(i === last && !prefix && p.endsWith("."));
  });
}

/**
 * The run file's text → the tasks, or the one problem that makes it unusable.
 * @param {string} text
 * @returns {{ ok: true, run: Run } | { ok: false, error: string }}
 */
export function parseRun(text) {
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `not JSON (${e instanceof Error ? e.message : String(e)})` };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "not a JSON object" };
  const obj = /** @type {Record<string, unknown>} */ (raw);
  const remote = obj.remote ?? "origin";
  if (typeof remote !== "string" || !REMOTE_RE.test(remote))
    return { ok: false, error: `remote ${JSON.stringify(remote)} is not a remote name` };
  if (!Array.isArray(obj.tasks) || obj.tasks.length === 0)
    return { ok: false, error: "tasks must be a non-empty list" };
  /** @type {Task[]} */
  const tasks = [];
  const names = new Set();
  for (const [i, t] of obj.tasks.entries()) {
    const at = `tasks[${i}]`;
    if (!t || typeof t !== "object" || Array.isArray(t))
      return { ok: false, error: `${at} is not an object` };
    const { name, branch, runFile, subBranches } = /** @type {Record<string, unknown>} */ (t);
    if (typeof name !== "string" || !NAME_RE.test(name))
      return { ok: false, error: `${at}.name ${JSON.stringify(name)} must match [a-z0-9._-]+` };
    if (names.has(name)) return { ok: false, error: `${at}.name "${name}" is a duplicate` };
    names.add(name);
    if (typeof branch !== "string" || !isRefName(branch))
      return { ok: false, error: `${at}.branch ${JSON.stringify(branch)} is not a valid branch name` };
    if (typeof runFile !== "string" || runFile.trim() === "")
      return { ok: false, error: `${at}.runFile must be a relative path` };
    const file = runFile.replace(/\\/g, "/");
    if (file.startsWith("/") || /^[A-Za-z]:/.test(file) || file.startsWith("-"))
      return { ok: false, error: `${at}.runFile ${JSON.stringify(runFile)} must be a relative path` };
    if (file.split("/").some((p) => p === ".." || p === "." || p === ""))
      return {
        ok: false,
        error: `${at}.runFile ${JSON.stringify(runFile)} must not contain "..", "." or empty parts`,
      };
    const subs = subBranches ?? [`fix/${name}-`];
    if (!Array.isArray(subs) || subs.some((p) => typeof p !== "string" || !isRefName(p, true)))
      return { ok: false, error: `${at}.subBranches must be a list of branch-name prefixes` };
    tasks.push({ name, branch, runFile: file, subBranches: [...new Set(subs)] });
  }
  // a prefix in two tasks would leave its sub-branches with no single owner (the longest matching prefix decides otherwise)
  /** @type {Map<string, string>} */
  const prefixOwner = new Map();
  for (const t of tasks)
    for (const p of t.subBranches) {
      const other = prefixOwner.get(p);
      if (other !== undefined)
        return {
          ok: false,
          error: `sub-branch prefix ${JSON.stringify(p)} is in both "${other}" and "${t.name}"`,
        };
      prefixOwner.set(p, t.name);
    }
  return { ok: true, run: { remote, tasks } };
}

// ------------------------------------------------------------------------------------------------------------ git's answers

/**
 * `git ls-remote` output → branch name → head sha (only refs/heads/*; any other line is skipped).
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseLsRemote(text) {
  const heads = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{40}|[0-9a-f]{64})\trefs\/heads\/(\S+)$/.exec(line.trim());
    if (m) heads.set(m[2], m[1]);
  }
  return heads;
}

const STATUS_RE = /^\s*(?:\*\*)?Status:(?:\*\*)?\s*(.+?)\s*$/;

/**
 * The run file's Status text: the first matching line within the first 40 lines, else null.
 * @param {string} text
 * @returns {string | null}
 */
export function parseStatus(text) {
  const lines = text.split(/\r?\n/, DEFAULTS.statusLines);
  for (const line of lines) {
    const m = STATUS_RE.exec(line);
    if (m) return m[1];
  }
  return null;
}

// A keyword counts only at the start of the Status text (after punctuation or spaces) and as a whole word: a letter, digit,
// "_" or "-" after it means another word ("Fail-safe review", "failover"), so a keyword later in the text ("SENT BACK … (was
// PR READY …)", "builder running; WAITING ON OWNER before PR READY") never decides the class. Case-insensitive.
const KEYWORD_END = String.raw`(?![\p{L}\p{N}_-])`;
/** @type {[RegExp, StatusClass][]} */
const CLASS_RULES = [
  [new RegExp(String.raw`^PR\s+READY${KEYWORD_END}`, "iu"), "pr-ready"],
  [new RegExp(String.raw`^WAITING\s+ON${KEYWORD_END}`, "iu"), "waiting"],
  [new RegExp(`^BLOCKED${KEYWORD_END}`, "iu"), "blocked"],
  [new RegExp(`^FAIL(?:ED|ING)?${KEYWORD_END}`, "iu"), "fail"],
  [new RegExp(String.raw`^SEN[DT]\s+BACK${KEYWORD_END}`, "iu"), "sent-back"],
  // done: merged, abandoned, or "done" (but not "done with …", which is a step finished, not the task)
  [new RegExp(String.raw`^(?:merged|abandoned|done(?!\s+with${KEYWORD_END}))${KEYWORD_END}`, "iu"), "merged"],
];

/**
 * The class of a Status text, from the keyword it starts with (see CLASS_RULES); PR READY carries the first pull URL.
 * @param {string} status
 * @returns {{ cls: StatusClass, url: string | null }}
 */
export function classify(status) {
  const s = status.replace(/^[^\p{L}\p{N}]+/u, "");
  for (const [re, cls] of CLASS_RULES) {
    if (!re.test(s)) continue;
    if (cls !== "pr-ready") return { cls, url: null };
    const url = /https:\/\/\S+?\/pull\/\d+/.exec(s);
    return { cls, url: url ? url[0] : null };
  }
  return { cls: "working", url: null };
}

/** The status classes that need the main session, with the kind their line carries. */
export const ACTION_KINDS = /** @type {const} */ ({
  "pr-ready": "PR-READY",
  waiting: "WAITING",
  blocked: "BLOCKED",
  fail: "FAIL",
  "sent-back": "SENT-BACK",
});

// --------------------------------------------------------------------------------------------------------- change detection

/** @returns {TaskState} */
export const initialState = () => ({
  started: false,
  tip: null,
  head: null,
  status: null,
  cls: null,
  url: null,
  subs: {},
  lastMoveMs: null,
  quietFired: false,
  gone: false,
});

/** A task needs nothing more: PR READY, merged, or its branch was deleted. @param {TaskState} s */
export const isDone = (s) => s.gone || s.cls === "pr-ready" || s.cls === "merged";

/**
 * The quiet timer: fires once when nothing moved for `quietMs` (re-armed by the caller on the next push).
 * @param {{ lastMoveMs: number | null, quietFired: boolean }} s
 * @param {number} nowMs
 * @param {number} quietMs
 * @returns {{ fire: boolean, minutes: number }}
 */
export function quietCheck(s, nowMs, quietMs) {
  if (s.lastMoveMs === null) return { fire: false, minutes: 0 };
  const idle = nowMs - s.lastMoveMs;
  return { fire: !s.quietFired && idle >= quietMs, minutes: Math.floor(idle / 60_000) };
}

/** The later of a time that may be unset and a time. @param {number | null} a @param {number} b */
const later = (a, b) => (a === null ? b : Math.max(a, b));

/** @param {string} s */
const short = (s) => (s.length > DEFAULTS.maxStatusChars ? `${s.slice(0, DEFAULTS.maxStatusChars - 1)}…` : s);

/** @param {string} text @param {string | null} url */
const shown = (text, url) => {
  const s = short(text);
  return url && !s.includes(url) ? `${s} ${url}` : s;
};

/**
 * One task's events between the last state and this tick's observation, and the new state. Pure.
 * - the first read prints the status (`STATUS <new>`), a change `STATUS <old> -> <new>`; a status needing the main session uses
 *   its own kind and marks the line as an action;
 * - a sub-branch that appears or moves prints SUB-PUSH (no fetch); a head or sub-branch move after the first tick re-arms QUIET;
 * - QUIET is timed, at a task's first tick, from the newest committer time among the tip (once read) and the sub-branches, so a
 *   session already silent is reported on time and one whose builder pushes only sub-branches isn't; it waits for the first read
 *   of a listed tip, and is not printed for a task that is waiting on the owner (it ended its turn by rule) or done (it already
 *   asked for the main session, or needs nothing);
 * - a task branch seen earlier (a tip or a read head) and now absent prints GONE once and counts as done.
 * @param {TaskState} old
 * @param {Observation} obs
 * @param {number} nowMs
 * @param {{ quietMs: number }} opts
 * @returns {{ events: Event[], state: TaskState }}
 */
export function diffTask(old, obs, nowMs, opts) {
  /** @type {Event[]} */
  const events = [];
  const s = { ...old, subs: { ...obs.subs } };
  let moved = false;
  if (obs.tip === null) {
    if ((old.tip !== null || old.head !== null) && !old.gone) {
      events.push({ kind: "GONE", detail: "", action: false });
      s.gone = true;
    }
  } else {
    if (old.started && obs.tip !== old.tip) moved = true;
    s.gone = false;
  }
  s.tip = obs.tip;
  for (const [branch, sha] of Object.entries(obs.subs)) {
    if (old.subs[branch] === sha) continue;
    events.push({ kind: "SUB-PUSH", detail: `${branch} ${sha.slice(0, 7)}`, action: false });
    if (old.started) moved = true;
  }
  if (obs.read) {
    const { cls, url } = classify(obs.read.status);
    if (obs.read.status !== old.status) {
      const kind =
        cls in ACTION_KINDS ? ACTION_KINDS[/** @type {keyof typeof ACTION_KINDS} */ (cls)] : "STATUS";
      const now = shown(obs.read.status, url);
      events.push({
        kind,
        detail: old.status === null ? now : `${short(old.status)} -> ${now}`,
        action: kind !== "STATUS",
      });
    }
    s.head = obs.read.head;
    s.status = obs.read.status;
    s.cls = cls;
    s.url = url;
    if (old.head === null && obs.read.commitMs !== null)
      s.lastMoveMs = later(s.lastMoveMs, obs.read.commitMs);
  }
  if (!old.started && obs.subsMs != null) s.lastMoveMs = later(s.lastMoveMs, obs.subsMs);
  if (moved) {
    s.lastMoveMs = nowMs;
    s.quietFired = false;
  }
  s.started = true;
  const unread = s.tip !== null && s.head === null;
  if (!isDone(s) && s.cls !== "waiting" && !unread) {
    const q = quietCheck(s, nowMs, opts.quietMs);
    if (q.fire) {
      events.push({ kind: "QUIET", detail: `${q.minutes} min`, action: true });
      s.quietFired = true;
    }
  }
  return { events, state: s };
}

/** HH:MM in IST. @param {number} ms */
export const formatIst = (ms) => new Date(ms + 5.5 * 60 * 60 * 1000).toISOString().slice(11, 16);

/** @param {number} nowMs @param {string} who @param {Event} ev */
export const formatEvent = (nowMs, who, ev) =>
  `${formatIst(nowMs)} IST ${who} ${ev.kind}${ev.detail ? ` ${ev.detail}` : ""}${ev.action ? " ACTION" : ""}`;

// ------------------------------------------------------------------------------------------------------------------ the token

/** @param {string} runPath */
export const tokenPathFor = (runPath) => join(dirname(runPath), "watch.token");

/** Writes a fresh token (this copy is now the newest) and returns it. @param {string} path */
export function writeToken(path) {
  const token = randomUUID();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, token);
  return token;
}

/** Whether the token file still holds this copy's token (gone or replaced: false). @param {string} path @param {string} token */
export function checkToken(path, token) {
  try {
    return readFileSync(path, "utf8").trim() === token;
  } catch {
    return false;
  }
}

/** Removes the token, so a running copy exits within 5 s. @param {string} path */
export const removeToken = (path) => rmSync(path, { force: true });

export class Superseded extends Error {}

// ------------------------------------------------------------------------------------------------------------- the state file

export const STATE_VERSION = 1;

/** @param {string} runPath */
export const statePathFor = (runPath) => join(dirname(runPath), "watch.state.json");

const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** @param {unknown} v */
const isShaOrNull = (v) => v === null || (typeof v === "string" && SHA_RE.test(v));
/** @param {unknown} v */
const isStringOrNull = (v) => v === null || typeof v === "string";

/**
 * One saved task state, checked field by field; anything off → null (that task starts with no saved state). The class and URL
 * are worked out again from the saved status text, so a saved file never carries an out-of-date class.
 * @param {unknown} raw
 * @returns {TaskState | null}
 */
function taskStateOf(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (typeof r.started !== "boolean" || typeof r.quietFired !== "boolean" || typeof r.gone !== "boolean")
    return null;
  if (!isShaOrNull(r.tip) || !isShaOrNull(r.head) || !isStringOrNull(r.status)) return null;
  if (
    r.lastMoveMs !== null &&
    !(typeof r.lastMoveMs === "number" && Number.isFinite(r.lastMoveMs) && r.lastMoveMs > 0)
  )
    return null;
  if (!r.subs || typeof r.subs !== "object" || Array.isArray(r.subs)) return null;
  /** @type {Record<string, string>} */
  const subs = {};
  for (const [b, v] of Object.entries(r.subs)) {
    if (!isRefName(b) || typeof v !== "string" || !SHA_RE.test(v)) return null;
    subs[b] = v;
  }
  const status = /** @type {string | null} */ (r.status);
  const { cls, url } = status === null ? { cls: null, url: null } : classify(status);
  return {
    started: r.started,
    tip: /** @type {string | null} */ (r.tip),
    head: /** @type {string | null} */ (r.head),
    status,
    cls,
    url,
    subs,
    lastMoveMs: /** @type {number | null} */ (r.lastMoveMs),
    quietFired: r.quietFired,
    gone: r.gone,
  };
}

/**
 * The saved state file's text → the saved state of each task of this run. A task is taken only when its saved entry names the
 * same branch, run file and sub-branch prefixes (and the file the same remote); unreadable, malformed or foreign text → nothing.
 * @param {string | null} text
 * @param {Run} run
 * @returns {Map<string, TaskState>}
 */
export function parseState(text, run) {
  /** @type {Map<string, TaskState>} */
  const saved = new Map();
  if (text === null) return saved;
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return saved;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return saved;
  const file = /** @type {Record<string, unknown>} */ (raw);
  if (file.version !== STATE_VERSION || file.remote !== run.remote) return saved;
  if (!file.tasks || typeof file.tasks !== "object" || Array.isArray(file.tasks)) return saved;
  const tasks = /** @type {Record<string, unknown>} */ (file.tasks);
  for (const task of run.tasks) {
    if (!Object.hasOwn(tasks, task.name)) continue;
    const entry = tasks[task.name];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = /** @type {Record<string, unknown>} */ (entry);
    if (e.branch !== task.branch || e.runFile !== task.runFile) continue;
    if (JSON.stringify(e.subBranches) !== JSON.stringify(task.subBranches)) continue;
    const state = taskStateOf(e.state);
    if (state) saved.set(task.name, state);
  }
  return saved;
}

/**
 * The state file's text for this run (stable key order, so an unchanged state gives the same text).
 * @param {Run} run
 * @param {Map<string, TaskState>} states
 */
export function serializeState(run, states) {
  /** @type {Record<string, unknown>} */
  const tasks = {};
  for (const t of run.tasks) {
    const s = /** @type {TaskState} */ (states.get(t.name));
    tasks[t.name] = {
      branch: t.branch,
      runFile: t.runFile,
      subBranches: t.subBranches,
      state: {
        started: s.started,
        tip: s.tip,
        head: s.head,
        status: s.status,
        cls: s.cls,
        url: s.url,
        subs: Object.fromEntries(Object.entries(s.subs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
        lastMoveMs: s.lastMoveMs,
        quietFired: s.quietFired,
        gone: s.gone,
      },
    };
  }
  return `${JSON.stringify({ version: STATE_VERSION, remote: run.remote, tasks }, null, 2)}\n`;
}

/** The state file's text, or null when it is missing or unreadable. @param {string} path */
export function readStateFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Writes the state file atomically: a temp file beside it, then a rename over it. @param {string} path @param {string} text */
export function writeStateFile(path, text) {
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

// -------------------------------------------------------------------------------------------------------------------- git

/** @param {string} s */
const shortError = (s) =>
  (
    s
      .trim()
      .split(/\r?\n/)
      .find((l) => l.trim() !== "") ?? "git failed"
  )
    .trim()
    .slice(0, 100);

/**
 * Runs git with an argument array (no shell), a timeout and no credential prompt.
 * @param {string[]} args
 * @param {{ timeoutMs?: number, cwd?: string }} [opts]
 * @returns {Promise<GitResult>}
 */
export function spawnGit(args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.gitTimeoutMs;
  return new Promise((done) => {
    execFile(
      "git",
      args,
      {
        cwd: opts.cwd,
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
      (error, stdout, stderr) => {
        if (!error) return done({ ok: true, stdout });
        const timedOut = error.killed === true;
        done({
          ok: false,
          timedOut,
          error: timedOut
            ? `git ${args[0]} timed out after ${timeoutMs / 1000} s`
            : shortError(String(stderr) || error.message),
        });
      },
    );
  });
}

/**
 * Fetches a task branch and reads its run file and committer time at `sha`. A run file missing at that commit is NO_RUN_FILE;
 * any git failure is `ok: false` (the caller leaves the head unseen and retries on the next tick).
 * @param {Git} git
 * @param {string} remote
 * @param {Task} task
 * @param {string} sha
 * @returns {Promise<{ ok: true, status: string, commitMs: number } | { ok: false, error: string }>}
 */
export async function readHead(git, remote, task, sha) {
  const fetched = await git(["fetch", "--no-tags", remote, task.branch]);
  if (!fetched.ok) return { ok: false, error: fetched.error };
  const shown = await git(["show", `${sha}:${task.runFile}`]);
  /** @type {string} */
  let status;
  if (shown.ok) status = parseStatus(shown.stdout) ?? NO_STATUS_LINE;
  else {
    if (shown.timedOut) return { ok: false, error: shown.error };
    // tell "no such file at that commit" from a real failure: ls-tree answers empty for a missing path
    // --full-tree: the path from the repository root, as `show <sha>:<path>` reads it, whatever the current directory
    const listed = await git(["ls-tree", "--full-tree", "--name-only", sha, "--", task.runFile]);
    if (!listed.ok || listed.stdout.trim() !== "") return { ok: false, error: shown.error };
    status = NO_RUN_FILE;
  }
  const time = await git(["show", "-s", "--format=%ct", sha]);
  if (!time.ok) return { ok: false, error: time.error };
  const secs = Number(time.stdout.trim());
  if (!Number.isFinite(secs) || secs <= 0)
    return { ok: false, error: `no commit time for ${sha.slice(0, 7)}` };
  return { ok: true, status, commitMs: secs * 1000 };
}

/**
 * A sub-branch's committer time: fetched, then read; null when either fails.
 * @param {Git} git
 * @param {string} remote
 * @param {string} branch
 * @param {string} sha
 * @returns {Promise<number | null>}
 */
async function commitMsOf(git, remote, branch, sha) {
  const fetched = await git(["fetch", "--no-tags", remote, branch]);
  if (!fetched.ok) return null;
  const time = await git(["show", "-s", "--format=%ct", sha]);
  if (!time.ok) return null;
  const secs = Number(time.stdout.trim());
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : null;
}

/**
 * The listed branches → each task's sub-branches. A task branch is never a sub-branch; a branch matching prefixes of two tasks
 * goes to the task with the longest matching prefix (parseRun refuses a prefix shared by two tasks, so there is no tie).
 * @param {Map<string, string>} heads
 * @param {Task[]} tasks
 * @returns {Map<string, Record<string, string>>}
 */
export function subsByTask(heads, tasks) {
  /** @type {Map<string, Record<string, string>>} */
  const out = new Map(tasks.map((t) => [t.name, {}]));
  const taskBranches = new Set(tasks.map((t) => t.branch));
  for (const [branch, sha] of heads) {
    if (taskBranches.has(branch)) continue;
    /** @type {{ name: string, len: number } | null} */
    let best = null;
    for (const t of tasks)
      for (const p of t.subBranches)
        if (branch.startsWith(p) && (best === null || p.length > best.len))
          best = { name: t.name, len: p.length };
    if (best) /** @type {Record<string, string>} */ (out.get(best.name))[branch] = sha;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the loop

/**
 * The watcher, driven by an injected git runner and clock. `tick()` runs one round; `run()` loops until ALL DONE or superseded.
 * With `statePath`, the tasks start from the saved state (parseState) and every tick that changed a state writes it back,
 * atomically and only while this copy still holds the token (checked right before the write; a superseded copy writes nothing).
 * @param {{ run: Run, git: Git, now: () => number, sleep: (ms: number) => Promise<void>, out: (line: string) => void,
 *   err?: (line: string) => void, intervalMs?: number, quietMs?: number, actionOnly?: boolean,
 *   token?: { path: string, value: string } | null, statePath?: string | null }} o
 */
export function createWatcher(o) {
  const intervalMs = o.intervalMs ?? DEFAULTS.intervalS * 1000;
  const quietMs = o.quietMs ?? DEFAULTS.quietMin * 60_000;
  const err = o.err ?? (() => {});
  const statePath = o.statePath ?? null;
  const saved = statePath ? parseState(readStateFile(statePath), o.run) : new Map();
  /** @type {Map<string, TaskState>} */
  const states = new Map(o.run.tasks.map((t) => [t.name, saved.get(t.name) ?? initialState()]));
  let written = statePath ? serializeState(o.run, states) : "";
  let writeFailed = false;
  let failing = 0;
  const tokenOk = () => !o.token || checkToken(o.token.path, o.token.value);
  const saveState = () => {
    if (!statePath) return;
    const text = serializeState(o.run, states);
    if (text === written) return;
    if (!tokenOk()) throw new Superseded();
    try {
      writeStateFile(statePath, text);
      written = text;
      writeFailed = false;
    } catch (e) {
      // the next changed tick tries again; one line until a write succeeds
      if (!writeFailed)
        err(`watch-cloud: cannot write ${statePath}: ${e instanceof Error ? e.message : String(e)}`);
      writeFailed = true;
    }
  };
  /** @type {Git} */
  const git = async (args) => {
    if (!tokenOk()) throw new Superseded();
    return o.git(args);
  };
  /** @param {string} line @param {boolean} [always] */
  const print = (line, always = false) => {
    if (always || !o.actionOnly || line.endsWith(" ACTION")) o.out(line);
  };
  /** @param {string | null} error */
  const endTick = (error) => {
    if (error === null) {
      if (failing >= DEFAULTS.failTicks) print(`${formatIst(o.now())} IST WATCHER git back`);
      failing = 0;
      return;
    }
    failing += 1;
    if (failing === DEFAULTS.failTicks)
      print(`${formatIst(o.now())} IST WATCHER git failing for ${failing} ticks: ${error} ACTION`);
  };

  const tick = async () => {
    const listed = await git(["ls-remote", o.run.remote, "refs/heads/*"]);
    if (!listed.ok) return endTick(listed.error);
    const heads = parseLsRemote(listed.stdout);
    const subsOf = subsByTask(heads, o.run.tasks);
    /** @type {string | null} */
    let failure = null;
    for (const task of o.run.tasks) {
      const old = /** @type {TaskState} */ (states.get(task.name));
      const tip = heads.get(task.branch) ?? null;
      const subs = /** @type {Record<string, string>} */ (subsOf.get(task.name));
      /** @type {Observation["read"]} */
      let read = null;
      if (tip !== null && tip !== old.head) {
        const r = await readHead(git, o.run.remote, task, tip);
        if (r.ok) read = { head: tip, status: r.status, commitMs: r.commitMs };
        else failure ??= r.error;
      }
      // first sight of a task with no saved state: QUIET starts from the newest sub-branch commit too (a failed read: now)
      /** @type {number | null} */
      let subsMs = null;
      if (!old.started)
        for (const [branch, sha] of Object.entries(subs)) {
          const ms = (await commitMsOf(git, o.run.remote, branch, sha)) ?? o.now();
          subsMs = later(subsMs, ms);
        }
      const nowMs = o.now();
      const { events, state } = diffTask(old, { tip, subs, read, subsMs }, nowMs, { quietMs });
      states.set(task.name, state);
      for (const ev of events) print(formatEvent(nowMs, task.name, ev));
    }
    saveState();
    endTick(failure);
  };

  const allDone = () => [...states.values()].every(isDone);

  /** @returns {Promise<number>} the exit code */
  const run = async () => {
    print(
      `${formatIst(o.now())} IST watch-cloud: watching ${o.run.tasks.length} task(s) every ${intervalMs / 1000} s, quiet after ${quietMs / 60_000} min`,
      true,
    );
    for (;;) {
      try {
        await tick();
      } catch (e) {
        if (!(e instanceof Superseded)) throw e;
        err("watch-cloud: superseded, exiting");
        return 0;
      }
      if (allDone()) {
        print(`${formatIst(o.now())} IST ALL DONE`, true);
        return 0;
      }
      for (let slept = 0; slept < intervalMs; ) {
        const step = Math.min(DEFAULTS.tokenCheckMs, intervalMs - slept);
        await o.sleep(step);
        slept += step;
        if (!tokenOk()) {
          err("watch-cloud: superseded, exiting");
          return 0;
        }
      }
    }
  };

  return { tick, run, allDone, states };
}

/**
 * The `status` table: one ls-remote, then each present task branch fetched and read.
 * @param {{ run: Run, git: Git, now: () => number }} o
 * @returns {Promise<{ ok: true, lines: string[] } | { ok: false, error: string }>}
 */
export async function statusTable(o) {
  const listed = await o.git(["ls-remote", o.run.remote, "refs/heads/*"]);
  if (!listed.ok) return { ok: false, error: `git ls-remote failed: ${listed.error}` };
  const heads = parseLsRemote(listed.stdout);
  const subsOf = subsByTask(heads, o.run.tasks);
  const rows = [["task", "branch", "head", "push age", "class", "status", "sub-branches"]];
  for (const task of o.run.tasks) {
    const tip = heads.get(task.branch);
    const subs = Object.entries(/** @type {Record<string, string>} */ (subsOf.get(task.name)))
      .map(([b, sha]) => `${b}@${sha.slice(0, 7)}`)
      .join(" ");
    if (!tip) {
      rows.push([task.name, task.branch, "-", "-", "(no branch)", "-", subs || "-"]);
      continue;
    }
    const r = await readHead(o.git, o.run.remote, task, tip);
    if (!r.ok) {
      rows.push([task.name, task.branch, tip.slice(0, 7), "-", "(git failed)", r.error, subs || "-"]);
      continue;
    }
    const age = `${Math.max(0, Math.floor((o.now() - r.commitMs) / 60_000))} min`;
    rows.push([
      task.name,
      task.branch,
      tip.slice(0, 7),
      age,
      classify(r.status).cls,
      short(r.status),
      subs || "-",
    ]);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return {
    ok: true,
    lines: rows.map((r) =>
      r
        .map((c, i) => c.padEnd(widths[i]))
        .join("  ")
        .trimEnd(),
    ),
  };
}

// ----------------------------------------------------------------------------------------------------------------- the CLI

/**
 * The command line → what to do, or the one problem (exit 2).
 * @param {string[]} argv
 * @returns {{ ok: true, cmd: "watch" | "status" | "stop", runPath: string, intervalS: number, quietMin: number,
 *   actionOnly: boolean } | { ok: false, error: string }}
 */
export function parseArgs(argv) {
  const args = [...argv];
  let cmd = /** @type {"watch" | "status" | "stop"} */ ("watch");
  if (args[0] !== undefined && !args[0].startsWith("--")) {
    const c = /** @type {string} */ (args.shift());
    if (c !== "watch" && c !== "status" && c !== "stop")
      return { ok: false, error: `unknown command "${c}"` };
    cmd = c;
  }
  const res = {
    ok: /** @type {const} */ (true),
    cmd,
    runPath: DEFAULTS.runPath,
    intervalS: DEFAULTS.intervalS,
  };
  let quietMin = DEFAULTS.quietMin;
  let actionOnly = false;
  while (args.length > 0) {
    const flag = /** @type {string} */ (args.shift());
    if (flag === "--action-only") {
      actionOnly = true;
      continue;
    }
    if (flag !== "--run" && flag !== "--interval" && flag !== "--quiet")
      return { ok: false, error: `unknown option "${flag}"` };
    const v = args.shift();
    if (v === undefined || v.startsWith("--")) return { ok: false, error: `${flag} needs a value` };
    if (flag === "--run") res.runPath = v;
    else if (!/^\d+$/.test(v)) return { ok: false, error: `${flag} must be a whole number, not "${v}"` };
    else if (flag === "--interval") {
      if (Number(v) < DEFAULTS.minIntervalS)
        return { ok: false, error: `--interval must be at least ${DEFAULTS.minIntervalS} s` };
      res.intervalS = Number(v);
    } else {
      if (Number(v) < 1) return { ok: false, error: "--quiet must be at least 1 min" };
      quietMin = Number(v);
    }
  }
  return { ...res, quietMin, actionOnly };
}

/** @param {string[]} argv @returns {Promise<number>} the exit code */
export async function main(argv) {
  const a = parseArgs(argv);
  if (!a.ok) {
    console.log(`watch-cloud: ${a.error}`);
    return 2;
  }
  const runPath = resolve(a.runPath);
  const tokenPath = tokenPathFor(runPath);
  if (a.cmd === "stop") {
    removeToken(tokenPath);
    console.log("watch-cloud: stop sent");
    return 0;
  }
  let text;
  try {
    text = readFileSync(runPath, "utf8");
  } catch {
    console.log(`watch-cloud: cannot read the run file ${a.runPath}`);
    return 2;
  }
  const parsed = parseRun(text);
  if (!parsed.ok) {
    console.log(`watch-cloud: bad run file ${a.runPath}: ${parsed.error}`);
    return 2;
  }
  /** @type {Git} */
  const git = (args) => spawnGit(args);
  if (a.cmd === "status") {
    const t = await statusTable({ run: parsed.run, git, now: Date.now });
    if (!t.ok) {
      console.log(`watch-cloud: ${t.error}`);
      return 1;
    }
    for (const line of t.lines) console.log(line);
    return 0;
  }
  const quiet = () => process.exit(0);
  process.on("SIGINT", quiet);
  process.on("SIGTERM", quiet);
  const w = createWatcher({
    run: parsed.run,
    git,
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    intervalMs: a.intervalS * 1000,
    quietMs: a.quietMin * 60_000,
    actionOnly: a.actionOnly,
    token: { path: tokenPath, value: writeToken(tokenPath) },
    statePath: statePathFor(runPath),
  });
  return w.run();
}

const isMain =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) process.exitCode = await main(process.argv.slice(2));
