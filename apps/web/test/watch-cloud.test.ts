// The cloud watcher (tools/watch-cloud.mjs; run orchestrate-skill, owner 2026-10-31 and 2026-11-01): the run file, git's answers,
// Status classes, change detection, the quiet timer, seen-only-after-read, transient git failures, the newest-copy token, ALL DONE,
// --action-only and the command line. Runs in Node; git is always faked except the CLI smoke test, which fails before any git call.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkToken,
  classify,
  createWatcher,
  diffTask,
  formatEvent,
  formatIst,
  initialState,
  NO_RUN_FILE,
  NO_STATUS_LINE,
  parseArgs,
  parseLsRemote,
  parseRun,
  parseState,
  parseStatus,
  quietCheck,
  readHead,
  removeToken,
  serializeState,
  statePathFor,
  statusTable,
  subsByTask,
  tokenPathFor,
  writeToken,
  // @ts-expect-error plain .mjs without types
} from "../../../tools/watch-cloud.mjs";

const SCRIPT = fileURLToPath(new URL("../../../tools/watch-cloud.mjs", import.meta.url));
const MIN = 60_000;
const T0 = Date.parse("2026-11-01T06:00:00Z"); // 11:30 IST
const sha = (c: string) => c.repeat(40);

type Task = { name: string; branch: string; runFile: string; subBranches: string[] };
type Run = { remote: string; tasks: Task[] };
type GitResult = { ok: true; stdout: string } | { ok: false; error: string; timedOut?: boolean };
type Event = { kind: string; detail: string; action: boolean };
type State = ReturnType<typeof initialState>;

const runOf = (...names: string[]): Run =>
  parseRun(
    JSON.stringify({
      tasks: names.map((n) => ({ name: n, branch: `feat/${n}`, runFile: `docs/runs/${n}.md` })),
    }),
  ).run;

const runText = (status: string) => `# Run: x\n\nStatus: ${status}\nTier: C\n`;

/**
 * A fake remote: branch → { sha, files at that sha, commit time }. `fail` makes the named git verbs fail; `calls` records every
 * call. The fake answers `show <sha>:<path>` only for a sha the remote holds (as if fetched).
 */
function fakeRemote() {
  const branches = new Map<string, string>();
  const commits = new Map<string, { files: Record<string, string>; ct: number }>();
  const fail = new Set<string>();
  const calls: string[][] = [];
  const push = (branch: string, s: string, files: Record<string, string> = {}, ctMs = T0) => {
    branches.set(branch, s);
    commits.set(s, { files, ct: Math.floor(ctMs / 1000) });
  };
  const git = async (args: string[]): Promise<GitResult> => {
    calls.push(args);
    const verb = args[0] === "show" && args[1] === "-s" ? "commit-time" : args[0];
    if (fail.has(verb)) return { ok: false, error: `fatal: ${verb} failed` };
    if (verb === "ls-remote")
      return {
        ok: true,
        stdout: [...branches].map(([b, s]) => `${s}\trefs/heads/${b}\n`).join(""),
      };
    if (verb === "fetch") return { ok: true, stdout: "" };
    if (verb === "show") {
      const [s, path] = args[1].split(/:(.*)/s);
      const c = commits.get(s);
      if (!c) return { ok: false, error: `fatal: bad object ${s}` };
      if (!(path in c.files)) return { ok: false, error: `fatal: path '${path}' does not exist in '${s}'` };
      return { ok: true, stdout: c.files[path] };
    }
    if (verb === "ls-tree") {
      // only the root-relative form is answered (finding 6): ls-tree --full-tree --name-only <sha> -- <path>
      if (args[1] !== "--full-tree" || args[2] !== "--name-only" || args[4] !== "--")
        return { ok: false, error: `unexpected git ${args.join(" ")}` };
      const c = commits.get(args[3]);
      if (!c) return { ok: false, error: "fatal: not a tree object" };
      return { ok: true, stdout: args[5] in c.files ? `${args[5]}\n` : "" };
    }
    if (verb === "commit-time") {
      const c = commits.get(args[3]);
      return c ? { ok: true, stdout: `${c.ct}\n` } : { ok: false, error: "fatal: bad object" };
    }
    return { ok: false, error: `unexpected git ${args.join(" ")}` };
  };
  return { branches, push, git, fail, calls };
}

function harness(
  run: Run,
  opts: {
    quietMin?: number;
    actionOnly?: boolean;
    token?: { path: string; value: string };
    statePath?: string;
    remote?: ReturnType<typeof fakeRemote>;
    start?: number;
  } = {},
) {
  const remote = opts.remote ?? fakeRemote();
  let now = opts.start ?? T0;
  const out: string[] = [];
  const err: string[] = [];
  const w = createWatcher({
    run,
    git: remote.git,
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    out: (l: string) => out.push(l),
    err: (l: string) => err.push(l),
    intervalMs: MIN,
    quietMs: (opts.quietMin ?? 45) * MIN,
    actionOnly: opts.actionOnly,
    token: opts.token ?? null,
    statePath: opts.statePath ?? null,
  });
  const advance = (ms: number) => {
    now += ms;
  };
  const take = () => out.splice(0);
  return { remote, w, out, err, advance, take, at: () => now };
}

describe("the run file", () => {
  it("a good file, with the defaults filled in", () => {
    const r = parseRun(
      JSON.stringify({
        tasks: [
          {
            name: "orchestrate-skill",
            branch: "feat/orchestrate-skill",
            runFile: "docs/runs/orchestrate-skill.md",
          },
          {
            name: "m6.2",
            branch: "feat/m6.2-gateway",
            runFile: "docs\\runs\\m6.2.md",
            subBranches: ["fix/m6.2-", "x/"],
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.run.remote).toBe("origin");
    expect(r.run.tasks[0].subBranches).toEqual(["fix/orchestrate-skill-"]);
    expect(r.run.tasks[1].runFile).toBe("docs/runs/m6.2.md");
    expect(r.run.tasks[1].subBranches).toEqual(["fix/m6.2-", "x/"]);
  });
  it.each([
    ["not JSON", "{", /not JSON/],
    ["no tasks", JSON.stringify({ tasks: [] }), /non-empty/],
    [
      "a duplicate name",
      JSON.stringify({
        tasks: [
          { name: "a", branch: "feat/a", runFile: "a.md" },
          { name: "a", branch: "feat/b", runFile: "b.md" },
        ],
      }),
      /tasks\[1\]\.name "a" is a duplicate/,
    ],
    [
      "a capital in a name",
      JSON.stringify({ tasks: [{ name: "A", branch: "x", runFile: "a.md" }] }),
      /\.name/,
    ],
    ...[
      "feat/a b",
      "feat/a..b",
      "-feat",
      "feat/a~1",
      "feat^",
      "feat:x",
      "feat?",
      "feat*",
      "feat[",
      "feat\\x",
      "feat/.x",
      "feat.lock",
      "",
    ].map((b) => [
      `bad ref ${JSON.stringify(b)}`,
      JSON.stringify({ tasks: [{ name: "a", branch: b, runFile: "a.md" }] }),
      /\.branch .* is not a valid branch name/,
    ]),
    [
      "a .. path",
      JSON.stringify({ tasks: [{ name: "a", branch: "feat/a", runFile: "docs/../secret.md" }] }),
      /must not contain "\.\."/,
    ],
    [
      "an absolute path",
      JSON.stringify({ tasks: [{ name: "a", branch: "feat/a", runFile: "/etc/passwd" }] }),
      /relative path/,
    ],
    [
      "a drive path",
      JSON.stringify({ tasks: [{ name: "a", branch: "feat/a", runFile: "C:\\x.md" }] }),
      /relative path/,
    ],
    [
      "a lower-case drive path",
      JSON.stringify({ tasks: [{ name: "a", branch: "feat/a", runFile: "d:x.md" }] }),
      /relative path/,
    ],
    [
      "a backslash-leading path",
      JSON.stringify({ tasks: [{ name: "a", branch: "feat/a", runFile: "\\docs\\a.md" }] }),
      /relative path/,
    ],
    [
      "a UNC path",
      JSON.stringify({ tasks: [{ name: "a", branch: "feat/a", runFile: "\\\\server\\share\\a.md" }] }),
      /relative path/,
    ],
    ...["./docs/a.md", "docs/./a.md", "docs/.", "."].map((f) => [
      `a "." part in ${JSON.stringify(f)}`,
      JSON.stringify({ tasks: [{ name: "a", branch: "feat/a", runFile: f }] }),
      /must not contain "\.\.", "\." or empty parts/,
    ]),
    [
      "the same sub-branch prefix in two tasks",
      JSON.stringify({
        tasks: [
          { name: "pay", branch: "feat/pay", runFile: "a.md", subBranches: ["fix/pay-"] },
          { name: "links", branch: "feat/links", runFile: "b.md", subBranches: ["fix/pay-"] },
        ],
      }),
      /sub-branch prefix "fix\/pay-" is in both "pay" and "links"/,
    ],
    [
      "a bad sub-branch prefix",
      JSON.stringify({ tasks: [{ name: "a", branch: "feat/a", runFile: "a.md", subBranches: ["-x"] }] }),
      /subBranches/,
    ],
    [
      "a remote that reads as an option",
      JSON.stringify({
        remote: "--upload-pack=x",
        tasks: [{ name: "a", branch: "feat/a", runFile: "a.md" }],
      }),
      /remote/,
    ],
  ])("refuses %s", (_label, text, why) => {
    const r = parseRun(text as string);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(why as RegExp);
    expect(r.error).not.toContain("\n");
  });
});

describe("git's answers", () => {
  it("ls-remote: heads only, branch names with slashes, CRLF", () => {
    const text = `${sha("a")}\trefs/heads/main\r\n${sha("b")}\trefs/heads/feat/x\n${sha("c")}\trefs/tags/v1\n${sha("d")}\tHEAD\n\n`;
    const heads = parseLsRemote(text);
    expect([...heads]).toEqual([
      ["main", sha("a")],
      ["feat/x", sha("b")],
    ]);
  });
});

describe("the Status line", () => {
  it("plain and bold, the first one within 40 lines", () => {
    expect(parseStatus("# Run\n\nStatus: builder running\nStatus: later\n")).toBe("builder running");
    expect(parseStatus("# Run\r\n**Status:** PR READY  \r\n")).toBe("PR READY");
    expect(parseStatus(`${"x\n".repeat(39)}Status: at line 40\n`)).toBe("at line 40");
    expect(parseStatus(`${"x\n".repeat(40)}Status: at line 41\n`)).toBeNull();
    expect(parseStatus("# Run\nno status here\n")).toBeNull();
  });
  it.each([
    ["PR READY https://github.com/techaust/techaust_platform/pull/146 (CI green)", "pr-ready"],
    ["pr ready", "pr-ready"],
    ["WAITING ON OWNER (Q1)", "waiting"],
    ["BLOCKED: no network to Cloudflare", "blocked"],
    ["FAILING: CI lint", "fail"],
    ["FAILED e2e", "fail"],
    ["fail", "fail"],
    ["Fail-safe review", "working"],
    ["failover of the watcher under test", "working"],
    ["CI FAILING on lint", "working"],
    ["SEND BACK from the reviewer", "sent-back"],
    ["sent back, designer fixing", "sent-back"],
    ["SENT BACK by main session (was PR READY https://github.com/o/r/pull/150); fixing", "sent-back"],
    ["builder running; WAITING ON OWNER before PR READY", "working"],
    ["done with builder; reviewer running", "working"],
    ["merged as #140", "merged"],
    ["Done", "merged"],
    ["done.", "merged"],
    ["abandoned", "merged"],
    ["Abandoned (owner, 2026-11-01)", "merged"],
    ["designer done, reviewer next", "working"],
    ["builder running (watcher); lead writing the skill", "working"],
    ["open (CI green, merging after #149)", "working"],
    ["- PR READY https://github.com/o/r/pull/3", "pr-ready"],
    ["(BLOCKED) no network", "blocked"],
    ["PR READYING", "working"],
  ])("%s → %s", (status, cls) => {
    expect(classify(status).cls).toBe(cls);
  });
  it("PR READY carries the first pull URL", () => {
    expect(
      classify("PR READY https://github.com/o/r/pull/146 then https://github.com/o/r/pull/147").url,
    ).toBe("https://github.com/o/r/pull/146");
    expect(classify("PR READY").url).toBeNull();
  });
});

describe("change detection", () => {
  const obs = (o: Partial<{ tip: string | null; subs: Record<string, string>; read: unknown }>) => ({
    tip: sha("a"),
    subs: {},
    read: null,
    ...o,
  });
  const read = (status: string, head = sha("a"), commitMs = T0) => ({ head, status, commitMs });
  const step = (old: State, o: object, now = T0) => diffTask(old, obs(o), now, { quietMs: 45 * MIN });

  it("the first read prints the status; the same status prints nothing; a change prints old -> new", () => {
    const a = step(initialState(), { read: read("builder running") });
    expect(a.events).toEqual([{ kind: "STATUS", detail: "builder running", action: false }]);
    const b = step(a.state, { tip: sha("b"), read: read("builder running", sha("b")) }, T0 + MIN);
    expect(b.events).toEqual([]);
    const c = step(b.state, { tip: sha("c"), read: read("reviewer running", sha("c")) }, T0 + 2 * MIN);
    expect(c.events).toEqual([
      { kind: "STATUS", detail: "builder running -> reviewer running", action: false },
    ]);
  });
  it("statuses that need the main session carry their own kind and the action mark", () => {
    const a = step(initialState(), { read: read("builder running") });
    for (const [status, kind] of [
      ["PR READY https://github.com/o/r/pull/9", "PR-READY"],
      ["WAITING ON OWNER (Q1)", "WAITING"],
      ["BLOCKED: x", "BLOCKED"],
      ["FAILED: CI lint", "FAIL"],
      ["SENT BACK", "SENT-BACK"],
    ]) {
      const e = step(a.state, { tip: sha("b"), read: read(status, sha("b")) }, T0 + MIN).events;
      expect(e).toEqual([{ kind, detail: `builder running -> ${status}`, action: true }]);
      expect(formatEvent(T0 + MIN, "t", e[0])).toBe(
        `11:31 IST t ${kind} builder running -> ${status} ACTION`,
      );
    }
    expect(step(initialState(), { read: read("WAITING ON OWNER (Q1)") }).events[0]).toEqual({
      kind: "WAITING",
      detail: "WAITING ON OWNER (Q1)",
      action: true,
    });
  });
  it("a long status is cut, but a PR URL is kept", () => {
    const long = `PR READY ${"x".repeat(200)} https://github.com/o/r/pull/77`;
    const e = step(initialState(), { read: read(long) }).events[0] as Event;
    expect(e.detail.length).toBeLessThan(170);
    expect(e.detail.endsWith(" https://github.com/o/r/pull/77")).toBe(true);
  });
  it("a sub-branch that appears or moves prints SUB-PUSH; one that is deleted prints nothing", () => {
    const a = step(initialState(), { read: read("x") });
    const b = step(a.state, { subs: { "fix/t-review": sha("e") } }, T0 + MIN);
    expect(b.events).toEqual([{ kind: "SUB-PUSH", detail: `fix/t-review ${"e".repeat(7)}`, action: false }]);
    expect(step(b.state, { subs: { "fix/t-review": sha("e") } }, T0 + 2 * MIN).events).toEqual([]);
    const c = step(b.state, { subs: { "fix/t-review": sha("f") } }, T0 + 2 * MIN);
    expect(c.events.map((e: Event) => e.kind)).toEqual(["SUB-PUSH"]);
    expect(step(c.state, { subs: {} }, T0 + 3 * MIN).events).toEqual([]);
  });
  it("GONE when a task branch seen earlier disappears, once, and the task counts as done", () => {
    const never = step(initialState(), { tip: null });
    expect(never.events).toEqual([]);
    const a = step(initialState(), { read: read("x") });
    const g = step(a.state, { tip: null }, T0 + MIN);
    expect(g.events).toEqual([{ kind: "GONE", detail: "", action: false }]);
    expect(g.state.gone).toBe(true);
    expect(step(g.state, { tip: null }, T0 + 2 * MIN).events).toEqual([]);
  });
});

describe("the quiet timer", () => {
  const step = (old: State, o: object, now: number) =>
    diffTask(old, { tip: sha("a"), subs: {}, read: null, ...o }, now, { quietMs: 45 * MIN });

  it("quietCheck: fires at 45 minutes, not at 44, and only once", () => {
    expect(quietCheck({ lastMoveMs: T0, quietFired: false }, T0 + 44 * MIN, 45 * MIN).fire).toBe(false);
    expect(quietCheck({ lastMoveMs: T0, quietFired: false }, T0 + 45 * MIN, 45 * MIN)).toEqual({
      fire: true,
      minutes: 45,
    });
    expect(quietCheck({ lastMoveMs: T0, quietFired: true }, T0 + 90 * MIN, 45 * MIN).fire).toBe(false);
    expect(quietCheck({ lastMoveMs: null, quietFired: false }, T0 + 90 * MIN, 45 * MIN).fire).toBe(false);
  });
  it("fires once at 45 min, re-armed by a sub-branch push", () => {
    let s = step(initialState(), { read: { head: sha("a"), status: "x", commitMs: T0 } }, T0).state;
    const at44 = step(s, {}, T0 + 44 * MIN);
    expect(at44.events).toEqual([]);
    const at45 = step(at44.state, {}, T0 + 45 * MIN);
    expect(at45.events).toEqual([{ kind: "QUIET", detail: "45 min", action: true }]);
    expect(formatEvent(T0 + 45 * MIN, "t", at45.events[0])).toBe("12:15 IST t QUIET 45 min ACTION");
    s = step(at45.state, {}, T0 + 46 * MIN).state;
    expect(step(s, {}, T0 + 80 * MIN).events).toEqual([]);
    // a sub-branch push re-arms it
    s = step(s, { subs: { "fix/t-x": sha("f") } }, T0 + 81 * MIN).state;
    expect(step(s, {}, T0 + 125 * MIN).events).toEqual([]);
    expect(step(s, {}, T0 + 126 * MIN).events).toEqual([{ kind: "QUIET", detail: "45 min", action: true }]);
  });
  it("a task-branch push re-arms it, even when its run file could not be read yet", () => {
    const s = step(initialState(), { read: { head: sha("a"), status: "x", commitMs: T0 } }, T0).state;
    const moved = step(s, { tip: sha("b") }, T0 + 30 * MIN).state;
    expect(step(moved, { tip: sha("b") }, T0 + 74 * MIN).events).toEqual([]);
    expect(step(moved, { tip: sha("b") }, T0 + 75 * MIN).events[0].kind).toBe("QUIET");
  });
  it("starts from the newest of the tip's and the sub-branches' commit times, so a silent session is reported at once", () => {
    const first = step(
      initialState(),
      {
        subs: { "fix/t-old": sha("e") },
        read: { head: sha("a"), status: "x", commitMs: T0 - 50 * MIN },
        subsMs: T0 - 55 * MIN,
      },
      T0,
    );
    expect(first.events.map((e: Event) => e.kind)).toEqual(["SUB-PUSH", "STATUS", "QUIET"]);
    expect(first.events[2].detail).toBe("50 min");
    // a builder pushing only its sub-branch 5 minutes ago: the session isn't quiet (review 1, finding 1b)
    const busy = step(
      initialState(),
      {
        subs: { "fix/t-new": sha("e") },
        read: { head: sha("a"), status: "x", commitMs: T0 - 60 * MIN },
        subsMs: T0 - 5 * MIN,
      },
      T0,
    );
    expect(busy.events.map((e: Event) => e.kind)).toEqual(["SUB-PUSH", "STATUS"]);
    expect(step(busy.state, {}, T0 + 39 * MIN).events).toEqual([]);
    expect(step(busy.state, {}, T0 + 40 * MIN).events).toEqual([
      { kind: "QUIET", detail: "45 min", action: true },
    ]);
    // subsMs counts only at a task's first tick
    expect(step(busy.state, { subsMs: T0 + 30 * MIN }, T0 + 40 * MIN).events[0].kind).toBe("QUIET");
    const fresh = step(
      initialState(),
      { read: { head: sha("a"), status: "x", commitMs: T0 - 10 * MIN } },
      T0,
    );
    expect(fresh.events.map((e: Event) => e.kind)).toEqual(["STATUS"]);
    expect(step(fresh.state, {}, T0 + 34 * MIN).events).toEqual([]);
    expect(step(fresh.state, {}, T0 + 35 * MIN).events[0].kind).toBe("QUIET");
  });
  it("not for a task that is done (PR READY, merged or abandoned)", () => {
    for (const status of ["PR READY", "merged as #1", "abandoned"]) {
      const s = step(initialState(), { read: { head: sha("a"), status, commitMs: T0 } }, T0).state;
      expect(step(s, {}, T0 + 60 * MIN).events).toEqual([]);
    }
  });
  it("not while the session is WAITING ON the owner (finding 5); a later status brings it back", () => {
    const s = step(
      initialState(),
      { read: { head: sha("a"), status: "WAITING ON OWNER (Q1)", commitMs: T0 } },
      T0,
    ).state;
    expect(step(s, {}, T0 + 60 * MIN).events).toEqual([]);
    expect(step(s, {}, T0 + 200 * MIN).events).toEqual([]);
    const back = step(
      s,
      { tip: sha("b"), read: { head: sha("b"), status: "builder running", commitMs: T0 + 210 * MIN } },
      T0 + 210 * MIN,
    ).state;
    expect(step(back, { tip: sha("b") }, T0 + 254 * MIN).events).toEqual([]);
    expect(step(back, { tip: sha("b") }, T0 + 255 * MIN).events[0].kind).toBe("QUIET");
    // still fires for BLOCKED (it needs the main session, not the owner)
    const b = step(
      initialState(),
      { read: { head: sha("a"), status: "BLOCKED: x", commitMs: T0 } },
      T0,
    ).state;
    expect(step(b, {}, T0 + 45 * MIN).events[0].kind).toBe("QUIET");
  });
  it("not before the first read of a listed tip (a failed first read has no time to count from)", () => {
    const s = step(initialState(), { subs: { "fix/t-x": sha("e") }, subsMs: T0 - 90 * MIN }, T0);
    expect(s.events.map((e: Event) => e.kind)).toEqual(["SUB-PUSH"]);
    expect(step(s.state, {}, T0 + MIN).events).toEqual([]);
    // the read comes: the newer time (the tip's) wins
    const r = step(s.state, { read: { head: sha("a"), status: "x", commitMs: T0 - 10 * MIN } }, T0 + 2 * MIN);
    expect(r.events.map((e: Event) => e.kind)).toEqual(["STATUS"]);
    expect(step(r.state, {}, T0 + 35 * MIN).events[0].kind).toBe("QUIET");
  });
});

describe("the watcher loop (fake git, fake clock)", () => {
  it("prints the first status, then only changes, each line HH:MM IST <task> <KIND> <detail>", async () => {
    const h = harness(runOf("t"));
    h.remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("builder running") });
    await h.w.tick();
    expect(h.take()).toEqual(["11:30 IST t STATUS builder running"]);
    await h.w.tick();
    expect(h.take()).toEqual([]);
    h.advance(MIN);
    h.remote.push("feat/t", sha("b"), {
      "docs/runs/t.md": runText("PR READY https://github.com/o/r/pull/5"),
    });
    await h.w.tick();
    expect(h.take()).toEqual([
      "11:31 IST t PR-READY builder running -> PR READY https://github.com/o/r/pull/5 ACTION",
    ]);
  });
  it("fetches only a head that changed: one ls-remote per tick otherwise", async () => {
    const h = harness(runOf("t"));
    h.remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("x") });
    await h.w.tick();
    expect(h.remote.calls.map((c) => c[0])).toEqual(["ls-remote", "fetch", "show", "show"]);
    expect(h.remote.calls[0]).toEqual(["ls-remote", "origin", "refs/heads/*"]);
    expect(h.remote.calls[1]).toEqual(["fetch", "--no-tags", "origin", "feat/t"]);
    expect(h.remote.calls[2]).toEqual(["show", `${sha("a")}:docs/runs/t.md`]);
    h.remote.calls.length = 0;
    await h.w.tick();
    await h.w.tick();
    expect(h.remote.calls.map((c) => c[0])).toEqual(["ls-remote", "ls-remote"]);
  });
  it("a run file missing at that commit is '(no run file yet)'; no Status line has its own text", async () => {
    const h = harness(runOf("t", "u"));
    h.remote.push("feat/t", sha("a"), {});
    h.remote.push("feat/u", sha("b"), { "docs/runs/u.md": "# Run\nnothing\n" });
    await h.w.tick();
    expect(h.take()).toEqual([`11:30 IST t STATUS ${NO_RUN_FILE}`, `11:30 IST u STATUS ${NO_STATUS_LINE}`]);
  });
  it("seen only after read: a failed show leaves the head unseen and the next tick reports it", async () => {
    const h = harness(runOf("t"));
    h.remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("builder running") });
    await h.w.tick();
    h.take();
    h.remote.push("feat/t", sha("b"), { "docs/runs/t.md": runText("PR READY") });
    h.remote.fail.add("show");
    await h.w.tick();
    expect(h.take()).toEqual([]);
    expect(h.w.states.get("t").head).toBe(sha("a"));
    h.remote.fail.delete("show");
    await h.w.tick();
    expect(h.take()).toEqual(["11:30 IST t PR-READY builder running -> PR READY ACTION"]);
  });
  it("a failed fetch is retried on the next tick", async () => {
    const h = harness(runOf("t"));
    h.remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("x") });
    h.remote.fail.add("fetch");
    await h.w.tick();
    expect(h.take()).toEqual([]);
    h.remote.fail.delete("fetch");
    await h.w.tick();
    expect(h.take()).toEqual(["11:30 IST t STATUS x"]);
  });
  it("git failing: one line after 5 failed ticks, nothing more, then 'git back' on success", async () => {
    const h = harness(runOf("t"));
    h.remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("x") });
    h.remote.fail.add("ls-remote");
    for (let i = 0; i < 4; i++) await h.w.tick();
    expect(h.take()).toEqual([]);
    await h.w.tick();
    expect(h.take()).toEqual(["11:30 IST WATCHER git failing for 5 ticks: fatal: ls-remote failed ACTION"]);
    for (let i = 0; i < 10; i++) await h.w.tick();
    expect(h.take()).toEqual([]);
    h.remote.fail.delete("ls-remote");
    await h.w.tick();
    expect(h.take()).toEqual(["11:30 IST t STATUS x", "11:30 IST WATCHER git back"]);
    // a short run of failures under 5 prints nothing at all
    h.remote.fail.add("ls-remote");
    for (let i = 0; i < 4; i++) await h.w.tick();
    h.remote.fail.delete("ls-remote");
    await h.w.tick();
    expect(h.take()).toEqual([]);
  });
  it("a failed ls-remote never reports GONE", async () => {
    const h = harness(runOf("t"));
    h.remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("x") });
    await h.w.tick();
    h.take();
    h.remote.fail.add("ls-remote");
    await h.w.tick();
    expect(h.take()).toEqual([]);
    expect(h.w.states.get("t").gone).toBe(false);
  });
  it("sub-branches by prefix, never the task branch itself", async () => {
    const h = harness(runOf("t"));
    h.remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("x") });
    h.remote.push("fix/t-review", sha("e"));
    h.remote.push("fix/tt-other", sha("f"));
    await h.w.tick();
    expect(h.take()).toEqual(["11:30 IST t SUB-PUSH fix/t-review eeeeeee", "11:30 IST t STATUS x"]);
  });
  it("ALL DONE once every task is PR READY, merged or gone", async () => {
    const remote = fakeRemote();
    remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("PR READY") });
    remote.push("feat/u", sha("b"), { "docs/runs/u.md": runText("merged as #1") });
    remote.push("feat/v", sha("c"), { "docs/runs/v.md": runText("reviewer running") });
    let now = T0;
    let ticks = 0;
    const out: string[] = [];
    const w = createWatcher({
      run: runOf("t", "u", "v"),
      // v's branch is merged and deleted before the third tick
      git: async (args: string[]) => {
        if (args[0] === "ls-remote" && ++ticks === 3) remote.branches.delete("feat/v");
        return remote.git(args);
      },
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
      out: (l: string) => out.push(l),
      intervalMs: MIN,
    });
    expect(await w.run()).toBe(0);
    expect(ticks).toBe(3);
    expect(out.at(-2)).toBe("11:32 IST v GONE");
    expect(out.at(-1)).toBe("11:32 IST ALL DONE");
  });
  it("--action-only prints only ACTION lines, plus the start and ALL DONE lines", async () => {
    const h = harness(runOf("t"), { actionOnly: true });
    h.remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("builder running") }, T0 - 50 * MIN);
    h.remote.push("fix/t-review", sha("e"), {}, T0 - 60 * MIN);
    await h.w.tick();
    expect(h.take()).toEqual(["11:30 IST t QUIET 50 min ACTION"]);
    h.remote.push("feat/t", sha("b"), { "docs/runs/t.md": runText("PR READY") });
    const code = await h.w.run();
    expect(code).toBe(0);
    expect(h.take()).toEqual([
      "11:30 IST watch-cloud: watching 1 task(s) every 60 s, quiet after 45 min",
      "11:30 IST t PR-READY builder running -> PR READY ACTION",
      "11:30 IST ALL DONE",
    ]);
  });
});

describe("sub-branch prefixes that overlap (finding 3)", () => {
  const run = parseRun(
    JSON.stringify({
      tasks: [
        { name: "pay", branch: "feat/pay", runFile: "docs/runs/pay.md" },
        { name: "pay-links", branch: "feat/pay-links", runFile: "docs/runs/pay-links.md" },
      ],
    }),
  ).run as Run;

  it("a branch goes to the task with the longest matching prefix, a task branch to no task", () => {
    const heads = new Map([
      ["feat/pay", sha("a")],
      ["feat/pay-links", sha("b")],
      ["fix/pay-r1", sha("c")],
      ["fix/pay-links-r1", sha("d")],
      ["fix/payroll", sha("e")],
    ]);
    const subs = subsByTask(heads, run.tasks);
    expect(subs.get("pay")).toEqual({ "fix/pay-r1": sha("c") });
    expect(subs.get("pay-links")).toEqual({ "fix/pay-links-r1": sha("d") });
    // a prefix wide enough to match the other task's branch still never takes it
    const wide = parseRun(
      JSON.stringify({
        tasks: [
          { name: "a", branch: "feat/a", runFile: "a.md", subBranches: ["feat/"] },
          { name: "b", branch: "feat/b", runFile: "b.md" },
        ],
      }),
    ).run as Run;
    expect(subsByTask(new Map([["feat/b", sha("a")]]), wide.tasks).get("a")).toEqual({});
  });
  it("the watcher prints each sub-branch once, on its own task", async () => {
    const h = harness(run);
    h.remote.push("feat/pay", sha("a"), { "docs/runs/pay.md": runText("x") });
    h.remote.push("feat/pay-links", sha("b"), { "docs/runs/pay-links.md": runText("y") });
    h.remote.push("fix/pay-links-r1", sha("d"));
    await h.w.tick();
    expect(h.take()).toEqual([
      "11:30 IST pay STATUS x",
      "11:30 IST pay-links SUB-PUSH fix/pay-links-r1 ddddddd",
      "11:30 IST pay-links STATUS y",
    ]);
  });
});

describe("saved state: a re-armed copy reports only what changed (finding 1)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const statePathIn = () => {
    const d = mkdtempSync(join(tmpdir(), "watch-cloud-state-"));
    dirs.push(d);
    return join(d, "watch.state.json");
  };

  it("a second copy over the first one's state prints nothing for unchanged tasks, then a real change", async () => {
    const statePath = statePathIn();
    const remote = fakeRemote();
    remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("WAITING ON OWNER (Q1)") });
    remote.push("feat/u", sha("b"), { "docs/runs/u.md": runText("PR READY https://github.com/o/r/pull/9") });
    remote.push("feat/v", sha("c"), { "docs/runs/v.md": runText("builder running") });
    remote.push("fix/v-r1", sha("d"));
    const first = harness(runOf("t", "u", "v"), { statePath, remote });
    await first.w.tick();
    expect(first.take()).toEqual([
      "11:30 IST t WAITING WAITING ON OWNER (Q1) ACTION",
      "11:30 IST u PR-READY PR READY https://github.com/o/r/pull/9 ACTION",
      "11:30 IST v SUB-PUSH fix/v-r1 ddddddd",
      "11:30 IST v STATUS builder running",
    ]);
    const saved = JSON.parse(readFileSync(statePath, "utf8"));
    expect(saved.version).toBe(1);
    expect(saved.tasks.v.state).toMatchObject({
      head: sha("c"),
      status: "builder running",
      subs: { "fix/v-r1": sha("d") },
    });
    expect(readdirSync(dirname(statePath))).toEqual(["watch.state.json"]); // no temp file left

    // the heartbeat re-arms: a new copy, 30 minutes later
    remote.calls.length = 0;
    const second = harness(runOf("t", "u", "v"), { statePath, remote, start: T0 + 30 * MIN });
    await second.w.tick();
    expect(second.take()).toEqual([]);
    expect(remote.calls.map((c) => c[0])).toEqual(["ls-remote"]); // nothing re-read, no sub-branch fetched
    const before = readFileSync(statePath, "utf8");
    await second.w.tick();
    expect(readFileSync(statePath, "utf8")).toBe(before); // an unchanged tick writes nothing new
    // a real change is still printed, once
    second.remote.push("feat/v", sha("e"), { "docs/runs/v.md": runText("SENT BACK by the reviewer") });
    second.remote.push("fix/v-r1", sha("f"));
    await second.w.tick();
    expect(second.take()).toEqual([
      "12:00 IST v SUB-PUSH fix/v-r1 fffffff",
      "12:00 IST v SENT-BACK builder running -> SENT BACK by the reviewer ACTION",
    ]);
    const third = harness(runOf("t", "u", "v"), { statePath, remote, start: T0 + 60 * MIN });
    await third.w.tick();
    expect(third.take()).toEqual([]);
  });
  it("a fired QUIET is not fired again by a re-armed copy", async () => {
    const statePath = statePathIn();
    const remote = fakeRemote();
    remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("builder running") }, T0 - 50 * MIN);
    const first = harness(runOf("t"), { statePath, remote, actionOnly: true });
    await first.w.tick();
    expect(first.take()).toEqual(["11:30 IST t QUIET 50 min ACTION"]);
    const second = harness(runOf("t"), { statePath, remote, start: T0 + 30 * MIN, actionOnly: true });
    await second.w.tick();
    expect(second.take()).toEqual([]);
  });
  it("first arm: a 60-minute-old tip and a 5-minute-old sub-branch → QUIET only 45 minutes after the newest", async () => {
    const h = harness(runOf("t"));
    h.remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("builder running") }, T0 - 60 * MIN);
    h.remote.push("fix/t-r1", sha("e"), {}, T0 - 5 * MIN);
    await h.w.tick();
    expect(h.take()).toEqual(["11:30 IST t SUB-PUSH fix/t-r1 eeeeeee", "11:30 IST t STATUS builder running"]);
    // the sub-branch was fetched once, to read its time
    expect(h.remote.calls.filter((c) => c[0] === "fetch")).toEqual([
      ["fetch", "--no-tags", "origin", "feat/t"],
      ["fetch", "--no-tags", "origin", "fix/t-r1"],
    ]);
    h.advance(39 * MIN);
    await h.w.tick();
    expect(h.take()).toEqual([]);
    h.advance(MIN);
    await h.w.tick();
    expect(h.take()).toEqual(["12:10 IST t QUIET 45 min ACTION"]);
    expect(h.remote.calls.filter((c) => c[0] === "fetch")).toHaveLength(2);
  });
  it("first arm: a sub-branch whose time can't be read counts as now, never as 0", async () => {
    const h = harness(runOf("t"));
    h.remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("builder running") }, T0 - 60 * MIN);
    h.remote.push("fix/t-r1", sha("e"), {}, T0 - 90 * MIN);
    const git = h.remote.git;
    // the sub-branch's fetch fails; the task branch's works
    const w = createWatcher({
      run: runOf("t"),
      git: (args: string[]) =>
        args[0] === "fetch" && args[3] === "fix/t-r1"
          ? Promise.resolve({ ok: false, error: "fatal: fetch failed" })
          : git(args),
      now: h.at,
      sleep: async () => {},
      out: (l: string) => h.out.push(l),
      intervalMs: MIN,
    });
    await w.tick();
    expect(h.take()).toEqual(["11:30 IST t SUB-PUSH fix/t-r1 eeeeeee", "11:30 IST t STATUS builder running"]);
    expect(w.states.get("t").lastMoveMs).toBe(T0);
  });
  it("a branch merged and deleted before a re-arm still counts as done: GONE once, then ALL DONE", async () => {
    const statePath = statePathIn();
    const remote = fakeRemote();
    remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("PR READY https://github.com/o/r/pull/9") });
    remote.push("feat/v", sha("c"), { "docs/runs/v.md": runText("PR READY https://github.com/o/r/pull/8") });
    const first = harness(runOf("t", "v"), { statePath, remote });
    await first.w.tick();
    first.take();
    // the main session squash-merges v and t's session sends it back; the copy expires; v's branch is deleted
    remote.push("feat/t", sha("b"), {
      "docs/runs/t.md": runText("SENT BACK by main session (was PR READY …); fixing"),
    });
    first.advance(MIN);
    await first.w.tick();
    first.take();
    remote.branches.delete("feat/v");
    remote.branches.delete("feat/t");
    const second = harness(runOf("t", "v"), { statePath, remote, start: T0 + 30 * MIN });
    expect(await second.w.run()).toBe(0);
    expect(second.take()).toEqual([
      "12:00 IST watch-cloud: watching 2 task(s) every 60 s, quiet after 45 min",
      "12:00 IST t GONE",
      "12:00 IST v GONE",
      "12:00 IST ALL DONE",
    ]);
    // a later copy over the gone state doesn't print GONE again
    const third = harness(runOf("t", "v"), { statePath, remote, start: T0 + 60 * MIN });
    expect(await third.w.run()).toBe(0);
    expect(third.take()).toEqual([
      "12:30 IST watch-cloud: watching 2 task(s) every 60 s, quiet after 45 min",
      "12:30 IST ALL DONE",
    ]);
  });
  it("a task never seen and absent from the remote isn't done, even with a saved state file", async () => {
    const statePath = statePathIn();
    const remote = fakeRemote();
    const first = harness(runOf("t"), { statePath, remote });
    await first.w.tick();
    const second = harness(runOf("t"), { statePath, remote });
    await second.w.tick();
    expect(second.take()).toEqual([]);
    expect(second.w.allDone()).toBe(false);
  });
  it("a superseded copy writes no state, even when the token changed after its last git call", async () => {
    const d = mkdtempSync(join(tmpdir(), "watch-cloud-state-"));
    dirs.push(d);
    const statePath = join(d, "watch.state.json");
    const tokenPath = join(d, "watch.token");
    const value = writeToken(tokenPath);
    const remote = fakeRemote();
    remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("builder running") });
    const err: string[] = [];
    let takeOver = false;
    const w = createWatcher({
      run: runOf("t"),
      git: async (args: string[]) => {
        const r = await remote.git(args);
        if (takeOver && args[0] === "show" && args[1] === "-s") writeToken(tokenPath); // a newer copy starts
        return r;
      },
      now: () => T0,
      sleep: async () => {},
      out: () => {},
      err: (l: string) => err.push(l),
      intervalMs: MIN,
      token: { path: tokenPath, value },
      statePath,
    });
    await w.tick();
    const before = readFileSync(statePath, "utf8");
    remote.push("feat/t", sha("b"), { "docs/runs/t.md": runText("reviewer running") });
    takeOver = true;
    expect(await w.run()).toBe(0);
    expect(err).toEqual(["watch-cloud: superseded, exiting"]);
    expect(readFileSync(statePath, "utf8")).toBe(before);
    expect(readdirSync(d).sort()).toEqual(["watch.state.json", "watch.token"]);
  });
  it("a corrupt, foreign or malformed state file is ignored, never a crash, and replaced by a good one", async () => {
    const statePath = statePathIn();
    const remote = fakeRemote();
    remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("builder running") });
    for (const text of [
      "{not json",
      "[]",
      JSON.stringify({ version: 2, remote: "origin", tasks: {} }),
      // the task now has another branch: its saved state belongs to another run
      JSON.stringify({
        version: 1,
        remote: "origin",
        tasks: {
          t: {
            branch: "feat/other",
            runFile: "docs/runs/t.md",
            subBranches: ["fix/t-"],
            state: {
              ...initialState(),
              started: true,
              head: sha("a"),
              tip: sha("a"),
              status: "builder running",
            },
          },
        },
      }),
      // a field of the wrong type
      JSON.stringify({
        version: 1,
        remote: "origin",
        tasks: {
          t: {
            branch: "feat/t",
            runFile: "docs/runs/t.md",
            subBranches: ["fix/t-"],
            state: {
              ...initialState(),
              started: "yes",
              head: sha("a"),
              tip: sha("a"),
              status: "builder running",
            },
          },
        },
      }),
    ]) {
      writeFileSync(statePath, text);
      const h = harness(runOf("t"), { statePath, remote });
      await h.w.tick();
      expect(h.take()).toEqual(["11:30 IST t STATUS builder running"]);
      expect(parseState(readFileSync(statePath, "utf8"), runOf("t")).get("t")).toMatchObject({
        head: sha("a"),
        status: "builder running",
      });
    }
  });
  it("parseState: per-task checks, the class worked out again from the text", () => {
    const run = runOf("t", "u");
    const good = {
      ...initialState(),
      started: true,
      tip: sha("a"),
      head: sha("a"),
      status: "abandoned",
      cls: "working",
    };
    const entry = (state: object) => ({
      branch: "feat/t",
      runFile: "docs/runs/t.md",
      subBranches: ["fix/t-"],
      state,
    });
    const text = (tasks: object, remote = "origin") => JSON.stringify({ version: 1, remote, tasks });
    expect(parseState(null, run).size).toBe(0);
    const s = parseState(text({ t: entry(good), u: entry(good) }), run);
    expect([...s.keys()]).toEqual(["t"]); // u's entry names t's branch
    expect(s.get("t").cls).toBe("merged");
    expect(parseState(text({ t: entry(good) }, "upstream"), run).size).toBe(0);
    for (const bad of [
      { tip: "nope" },
      { lastMoveMs: 0 },
      { lastMoveMs: "1" },
      { subs: { "fix/t-x": "zz" } },
      { subs: { "bad ref": sha("a") } },
      { subs: [] },
      { gone: null },
    ])
      expect(parseState(text({ t: entry({ ...good, ...bad }) }), run).size).toBe(0);
    expect(parseState(text({ t: { ...entry(good), subBranches: ["fix/"] } }), run).size).toBe(0);
    expect(parseState(text({ t: entry(null) }), run).size).toBe(0);
  });
  it("serializeState round-trips through parseState", () => {
    const run = runOf("t");
    const state = {
      ...initialState(),
      started: true,
      tip: sha("a"),
      head: sha("a"),
      status: "PR READY https://github.com/o/r/pull/4",
      subs: { "fix/t-b": sha("b"), "fix/t-a": sha("c") },
      lastMoveMs: T0,
      quietFired: true,
    };
    const back = parseState(serializeState(run, new Map([["t", state]])), run).get("t");
    expect(back).toEqual({ ...state, cls: "pr-ready", url: "https://github.com/o/r/pull/4" });
  });
});

describe("only the newest copy runs (token)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "watch-cloud-"));
    dirs.push(d);
    return d;
  };

  it("writeToken, checkToken, removeToken", () => {
    const path = join(tmp(), "deep", "watch.token");
    const a = writeToken(path);
    expect(checkToken(path, a)).toBe(true);
    const b = writeToken(path);
    expect(b).not.toBe(a);
    expect(checkToken(path, a)).toBe(false);
    expect(checkToken(path, b)).toBe(true);
    removeToken(path);
    expect(checkToken(path, b)).toBe(false);
    expect(() => removeToken(path)).not.toThrow();
  });
  it("a second writer makes the running copy exit 0 within 5 s of sleep, with no more git calls", async () => {
    const path = join(tmp(), "watch.token");
    const value = writeToken(path);
    const h = harness(runOf("t"), { token: { path, value } });
    h.remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("x") });
    let sleeps = 0;
    const w = createWatcher({
      run: runOf("t"),
      git: h.remote.git,
      now: h.at,
      sleep: async (ms: number) => {
        expect(ms).toBeLessThanOrEqual(5_000);
        if (++sleeps === 3) writeToken(path); // a newer copy starts
        h.advance(ms);
      },
      out: (l: string) => h.out.push(l),
      err: (l: string) => h.err.push(l),
      intervalMs: MIN,
      token: { path, value },
    });
    expect(await w.run()).toBe(0);
    expect(sleeps).toBe(3);
    expect(h.err).toEqual(["watch-cloud: superseded, exiting"]);
    expect(h.remote.calls.filter((c) => c[0] === "ls-remote")).toHaveLength(1);
  });
  it("a token gone before a git call stops the copy before that call", async () => {
    const path = join(tmp(), "watch.token");
    const value = writeToken(path);
    const h = harness(runOf("t"), { token: { path, value } });
    h.remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("x") });
    removeToken(path); // `stop`
    expect(await h.w.run()).toBe(0);
    expect(h.remote.calls).toEqual([]);
    expect(h.err).toEqual(["watch-cloud: superseded, exiting"]);
  });
  it("the CLI's stop removes the token beside the run file", () => {
    const d = tmp();
    const runPath = join(d, "run.json");
    const path = join(d, "watch.token");
    const value = writeToken(path);
    const r = spawnSync(process.execPath, [SCRIPT, "stop", "--run", runPath], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("watch-cloud: stop sent");
    expect(checkToken(path, value)).toBe(false);
  });
});

describe("readHead and the status table", () => {
  it("readHead returns the status and the committer time", async () => {
    const remote = fakeRemote();
    remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("x") }, T0 - 7 * MIN);
    const task = runOf("t").tasks[0];
    expect(await readHead(remote.git, "origin", task, sha("a"))).toEqual({
      ok: true,
      status: "x",
      commitMs: Math.floor((T0 - 7 * MIN) / 1000) * 1000,
    });
    remote.fail.add("ls-tree");
    remote.push("feat/t", sha("b"), {});
    expect((await readHead(remote.git, "origin", task, sha("b"))).ok).toBe(false);
  });
  it("one row per task: head, push age, class, status, sub-branches", async () => {
    const remote = fakeRemote();
    remote.push("feat/t", sha("a"), { "docs/runs/t.md": runText("PR READY") }, T0 - 12 * MIN);
    remote.push("fix/t-review", sha("e"));
    const t = await statusTable({ run: runOf("t", "u"), git: remote.git, now: () => T0 });
    expect(t.ok).toBe(true);
    expect(t.lines).toHaveLength(3);
    expect(t.lines[0]).toMatch(/^task\s+branch\s+head\s+push age\s+class\s+status\s+sub-branches$/);
    expect(t.lines[1].split(/\s{2,}/)).toEqual([
      "t",
      "feat/t",
      "aaaaaaa",
      "12 min",
      "pr-ready",
      "PR READY",
      "fix/t-review@eeeeeee",
    ]);
    expect(t.lines[2].split(/\s{2,}/)).toEqual(["u", "feat/u", "-", "-", "(no branch)", "-", "-"]);
  });
});

describe("the command line", () => {
  it("parseArgs: defaults, commands and refusals", () => {
    expect(parseArgs([])).toEqual({
      ok: true,
      cmd: "watch",
      runPath: ".logs/orchestrate/run.json",
      intervalS: 60,
      quietMin: 45,
      actionOnly: false,
    });
    expect(
      parseArgs(["--interval", "10", "--quiet", "30", "--action-only", "--run", "r.json"]),
    ).toMatchObject({
      cmd: "watch",
      intervalS: 10,
      quietMin: 30,
      actionOnly: true,
      runPath: "r.json",
    });
    expect(parseArgs(["status", "--run", "x.json"])).toMatchObject({ cmd: "status", runPath: "x.json" });
    expect(parseArgs(["--interval", "9"]).ok).toBe(false);
    expect(parseArgs(["--interval", "abc"]).ok).toBe(false);
    expect(parseArgs(["--quiet", "0"]).ok).toBe(false);
    expect(parseArgs(["--run"]).ok).toBe(false);
    expect(parseArgs(["--bogus"]).ok).toBe(false);
    expect(parseArgs(["restart"]).ok).toBe(false);
  });
  it("the token and the state file sit beside the run file", () => {
    expect(statePathFor(join("a", "b", "run.json"))).toBe(join("a", "b", "watch.state.json"));
    expect(tokenPathFor(join("a", "b", "run.json"))).toBe(join("a", "b", "watch.token"));
  });
  it("formatIst is HH:MM in IST", () => {
    expect(formatIst(Date.parse("2026-11-01T18:29:00Z"))).toBe("23:59");
    expect(formatIst(Date.parse("2026-11-01T18:30:00Z"))).toBe("00:00");
  });
  it("a bad run file exits 2 with one line naming the problem, before any git call", () => {
    const d = mkdtempSync(join(tmpdir(), "watch-cloud-cli-"));
    try {
      const runPath = join(d, "run.json");
      writeFileSync(runPath, JSON.stringify({ tasks: [{ name: "a", branch: "feat/a b", runFile: "a.md" }] }));
      // an empty PATH: if the script reached git it would fail differently; it must refuse first
      const r = spawnSync(process.execPath, [SCRIPT, "--run", runPath], {
        encoding: "utf8",
        env: { PATH: "" },
      });
      expect(r.status).toBe(2);
      expect(r.stdout.trim().split("\n")).toHaveLength(1);
      expect(r.stdout).toMatch(
        /^watch-cloud: bad run file .*: tasks\[0\]\.branch "feat\/a b" is not a valid branch name/,
      );
      // nothing written beside it: no token for a refused run
      expect(() => readFileSync(join(d, "watch.token"))).toThrow();
      const missing = spawnSync(process.execPath, [SCRIPT, "status", "--run", join(d, "nope.json")], {
        encoding: "utf8",
      });
      expect(missing.status).toBe(2);
      expect(missing.stdout).toMatch(/cannot read the run file/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
