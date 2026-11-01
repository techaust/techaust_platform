# Run: the `/orchestrate` skill and the cloud watcher

Status: builder running (watcher); lead writing the skill
Tier: C
Usage: lead claude-opus-5-5/high (cloud session orchestrate-skill); agents below as they run. Reading at the start: USAGE 5 at 2026-11-01T11:15+05:30.

Owner's request: docs/13 row 2026-10-31 "`/orchestrate`: a project skill …" and the 2026-11-01 usage-pacing row; docs/12 "Next" item 4. Built as a cloud session controlled from the PC (2026-11-01).

## Brief

**Goal.** Make the parallel-cloud-session routine of 2026-10-31 and 2026-11-01 repeatable: a project skill the PC main session loads when the owner says "run these in the cloud", "start a parallel run", "check the cloud sessions" or "orchestrate", with its templates, plus a Node watcher that wakes the main session only through one printed line per event and can't leave orphans on Windows.

**Files.**
- Lead (docs, no code): `.claude/skills/orchestrate/SKILL.md`; `.claude/skills/orchestrate/templates/{shared-rules.md,task-prompt.md,run-record.md,run.example.json}`.
- Builder (code and tests): `tools/watch-cloud.mjs`; `apps/web/test/watch-cloud.test.ts` (the Node project of `apps/web/vitest.config.ts`, beside `agent-slots.test.ts`). Nothing else. No package, no workflow, no CI change, no migration.

**`tools/watch-cloud.mjs` contract** (Node 24, standard library only, ESM, JSDoc types like `tools/agent-slots.mjs`, Biome-clean):
- `node tools/watch-cloud.mjs [watch] [--run <file>] [--interval <s>] [--quiet <min>] [--action-only]`
  - `--run` default `.logs/orchestrate/run.json` (git-ignored). Shape:
    `{ "remote": "origin", "tasks": [{ "name": "orchestrate-skill", "branch": "feat/orchestrate-skill", "runFile": "docs/runs/orchestrate-skill.md", "subBranches": ["fix/orchestrate-skill-"] }] }`
    `remote` defaults to `origin`; `subBranches` (prefixes) defaults to `["fix/<name>-"]`. Validate: names unique, `[a-z0-9._-]+`; branches valid ref names (no spaces, `..`, `~^:?*[\`, leading `-`); `runFile` a relative path without `..`; a bad file exits 2 with one line naming the problem.
  - `--interval` default 60 s (minimum 10), `--quiet` default 45 minutes.
- Every interval: **one** `git ls-remote <remote> refs/heads/*` (spawned with an argument array, never a shell; 30 s timeout). From it, the task branches and every branch starting with one of the task's sub-branch prefixes.
- **Fetch only what changed:** when a task branch's head differs from the last head *read*, `git fetch --no-tags <remote> <branch>` then `git show <sha>:<runFile>`; the head counts as seen **only after** its run file was read (lesson 2026-10-31: a push marked seen before it was read hid a PR READY for 30 minutes). A run file missing at that commit is status "(no run file yet)".
- **Status parsing** (pure, exported): the first line matching `^\s*(?:\*\*)?Status:(?:\*\*)?\s*(.+?)\s*$` within the first 40 lines; classify into `pr-ready` (`PR READY`, with the first `https://…/pull/N` URL if present), `waiting` (`WAITING ON`), `blocked` (`BLOCKED`), `fail` (`FAIL`/`FAILED`/`FAILING`, word match), `sent-back` (`SEND BACK`/`SENT BACK`), `merged` (`merged` or `done` at the start), else `working`. Case-insensitive.
- **Events** (pure diff of two snapshots, exported), one line each to stdout, `HH:MM IST <name> <KIND> <detail>`:
  - `STATUS <old> -> <new>` on any change of the status text (first read prints the current status as `STATUS <new>`);
  - plus, when the new class is pr-ready / waiting / blocked / fail / sent-back, the kind is `PR-READY`, `WAITING`, `BLOCKED`, `FAIL`, `SENT-BACK` instead of `STATUS`, and the line ends with ` ACTION`;
  - `SUB-PUSH <branch> <short sha>` when a sub-branch appears or moves (no fetch needed);
  - `QUIET <n> min` once when neither the task branch nor any of its sub-branches has moved for `--quiet` minutes (ends with ` ACTION`); re-armed by the next push. At start the timer begins from the task branch tip's committer time (read after the first fetch), so a session already silent is reported on time;
  - `GONE` when a task branch seen earlier disappears from the remote (merged and deleted), counted as done;
  - `--action-only` prints only lines ending in ` ACTION` (and the start, stop and all-done lines).
- **Only the newest copy runs:** at start, write a random token (`crypto.randomUUID()`) to `<run dir>/watch.token`; check it before every git call and at least every 5 s while sleeping; when the file holds anything else (or is gone), print `watch-cloud: superseded, exiting` to stderr and exit 0. An expired Monitor on Windows leaves its bash and node alive: this is what makes them exit.
- **Transient git failures:** a failed or timed-out ls-remote, fetch or show is retried on the next tick without changing state; after 5 consecutive failed ticks print one line `WATCHER git failing for <n> ticks: <short error> ACTION`, then nothing more until a success (then `WATCHER git back`).
- **Exit:** when every task is `pr-ready`, `merged` or `GONE`, print `ALL DONE` and exit 0. SIGINT/SIGTERM exit 0 quietly.
- **Subcommands:** `status [--run <file>]` prints one table (task, branch, head short sha, last push age in minutes from the head's committer time, status class, status text, sub-branches with short shas) from one ls-remote and fetches of the task branches, then exits 0; `stop [--run <file>]` removes the token file so a running copy exits within 5 s, and prints `watch-cloud: stop sent`.
- State lives in memory; nothing else is written. No personal data, no secrets, nothing sent anywhere but `git`.
- **Pure parts exported for tests:** `parseRun`, `parseLsRemote`, `parseStatus`, `classify`, `diffTask` (old state, new observation, now → events and new state), the quiet timer, `formatIst`, and a `checkToken(path, token)` / token writer. The loop takes an injected `git` runner and clock so the test can drive it with a fake.

**Tests** (`apps/web/test/watch-cloud.test.ts`, Vitest Node project): run-file validation (good, duplicate name, bad ref, `..` path); ls-remote parsing; status parsing and classification (bold `**Status:**`, PR READY with URL, WAITING ON OWNER (Q1), BLOCKED, FAIL vs a word like "failover", SEND BACK, merged, plain); change detection (first read, same status no line, change, action marks, sub-branch appear/move, GONE); the quiet timer (fires once at 45 min, not at 44, re-armed by a sub-branch push, starts from the tip's commit time); seen-only-after-read (a failed `show` leaves the head unseen and the next tick reports it); transient failures (5 failing ticks → one line, recovery line); token takeover (a second writer makes the first exit; `stop` removes it) with a temp dir; all done exits; `--action-only` filtering; a CLI smoke test with `spawnSync` on a bad run file (exit 2). No network: git is always faked except the CLI smoke test, which fails before any git call.

**Done means:** the builder's own `pnpm --filter @techaust/web exec vitest run test/watch-cloud.test.ts` green, `pnpm lint` clean on the two files, a manual run of `status` against this repo's real `origin` (with a temporary run file listing this task) in the report. Then review, fixes, `pnpm check` green.

**Out of scope:** any change to `tools/watch.sh`, `agent-slots.mjs` (the per-session 2-agent cap stays a follow-up), workflows, CLAUDE.md, the record (12, 13, CHANGELOG), `.claude/settings.json`, agents.

## Builder report
(builder)

## Review
(lead copies the reviewer's reply here)

## Integration notes
(lead)

## Lead decisions (for 13)
- (lead, 2026-11-01) The skill and its templates are written by the lead (they restate the record); the builder builds only the watcher and its tests, in parallel on separate files.
- (lead, 2026-11-01) `status`, `resume` and `stop` from the 2026-10-31 row are skill arguments (`/orchestrate status|resume|stop`); the watcher itself has `watch`, `status` and `stop` (resume = re-arm the watcher and resume agents, a skill step).
- (lead, 2026-11-01) The watcher prints a line on every Status change (the task's wording), and lines that need the main session end with ` ACTION`; `--action-only` prints only those, for a quieter Monitor.

## Proposed CLAUDE.md text
1. In "In a cloud session" → "Parallel task sessions", replace the first bullet's tail "from the shared prompt in [runs/cloud-parallel-2026-10-31.md](docs/runs/cloud-parallel-2026-10-31.md)." with: "with the **`/orchestrate` skill** (`.claude/skills/orchestrate/`: choosing tasks, the shared rules and prompt templates, the watcher, the PR review checklist, merge order, the record, resume after a limit)."
2. Replace the "Cloud sessions can't message back. The main session watches …" bullet's watcher sentence with: "The main session runs `node tools/watch-cloud.mjs --run .logs/orchestrate/run.json` in a Monitor (one line per Status change, PR READY, WAITING ON, BLOCKED/FAIL, sub-branch push `fix/<name>-*`, quiet 45 minutes; only the newest copy runs, so a re-arm by the 30-minute heartbeat never leaves an orphan; `status` prints one table, `stop` ends it)."
3. Add a bullet: "**Pacing** (owner, 2026-11-01): a run starts right after a 5-hour reset, with at most two cloud sessions beside the PC's agents; no new agent anywhere over 85 %; after a limit stop, `/orchestrate resume` resumes the PC's agents by SendMessage and re-arms the watcher."
(docs/14 §9 gains the skill row and runbook Part 4 points at the skill in this PR; neither is a main-session-only file.)

## Follow-ups (for 12)
- Closed by this task (remove from 12 "Parallel task sessions (2026-10-31)"): "the watcher counts only task-branch pushes" (the watcher counts `fix/<name>-*`).
- Still open: `tools/agent-slots.mjs` doesn't hold the per-session 2-agent cap or the 85 % pacing line of parallel runs (the shared rules do); Auto-fix for PRs a cloud session opened (the owner turns it on from the PR bar).

## Questions for the owner
None so far.

## Handover
(lead)
