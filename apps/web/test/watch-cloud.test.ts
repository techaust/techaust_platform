// The cloud watcher (tools/watch-cloud.mjs; run orchestrate-skill, owner 2026-10-31 and 2026-11-01): the run file, git's answers,
// Status classes, change detection, the quiet timer, seen-only-after-read, transient git failures, the newest-copy token, ALL DONE,
// --action-only and the command line. Runs in Node; git is always faked except the CLI smoke test, which fails before any git call.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  parseStatus,
  quietCheck,
  readHead,
  removeToken,
  statusTable,
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
      const c = commits.get(args[2]);
      if (!c) return { ok: false, error: "fatal: not a tree object" };
      return { ok: true, stdout: args[4] in c.files ? `${args[4]}\n` : "" };
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
  opts: { quietMin?: number; actionOnly?: boolean; token?: { path: string; value: string } } = {},
) {
  const remote = fakeRemote();
  let now = T0;
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
    ["CI FAILING on lint", "fail"],
    ["e2e FAILED", "fail"],
    ["fail", "fail"],
    ["testing failover of the watcher", "working"],
    ["SEND BACK from the reviewer", "sent-back"],
    ["sent back, designer fixing", "sent-back"],
    ["merged as #140", "merged"],
    ["Done", "merged"],
    ["designer done, reviewer next", "working"],
    ["builder running (watcher); lead writing the skill", "working"],
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
      ["CI FAILED", "FAIL"],
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
  it("starts from the tip's commit time, so a session already silent is reported at the first read", () => {
    const first = step(
      initialState(),
      { subs: { "fix/t-old": sha("e") }, read: { head: sha("a"), status: "x", commitMs: T0 - 50 * MIN } },
      T0,
    );
    expect(first.events.map((e: Event) => e.kind)).toEqual(["SUB-PUSH", "STATUS", "QUIET"]);
    expect(first.events[2].detail).toBe("50 min");
    const fresh = step(
      initialState(),
      { read: { head: sha("a"), status: "x", commitMs: T0 - 10 * MIN } },
      T0,
    );
    expect(fresh.events.map((e: Event) => e.kind)).toEqual(["STATUS"]);
    expect(step(fresh.state, {}, T0 + 34 * MIN).events).toEqual([]);
    expect(step(fresh.state, {}, T0 + 35 * MIN).events[0].kind).toBe("QUIET");
  });
  it("not for a task that is done (PR READY or merged)", () => {
    const s = step(initialState(), { read: { head: sha("a"), status: "PR READY", commitMs: T0 } }, T0).state;
    expect(step(s, {}, T0 + 60 * MIN).events).toEqual([]);
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
    h.remote.push("fix/t-review", sha("e"));
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
