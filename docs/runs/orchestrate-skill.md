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
Builder (claude-opus-5-5, high), 2026-11-01, sub-branch `fix/orchestrate-skill-watcher` from `origin/feat/orchestrate-skill` (fast-forwarded to 873cfc2 before the first commit; separate files from the lead's).

**Skills.** None loaded: no row of docs/14 §9 fits a plain Node CLI with Node tests. The Cloudflare rows (`workers-best-practices`, `wrangler`, `workers-profiling`) cover Worker code, bindings and CPU budgets, none of which this touches (and they aren't installed in this cloud session). `orchestrate` (added mid-run by the lead) is the main session's run procedure, not a build skill; I read its §4/§5 instead to check the watcher's flags, lines and exit rules against it (they match). `simplify`/`code-review` belong to the review step.

**Files.**
- `tools/watch-cloud.mjs` (new): the watcher to the brief's contract. Exports `parseRun`, `isRefName`, `parseLsRemote`, `parseStatus`, `classify`, `ACTION_KINDS`, `initialState`, `isDone`, `quietCheck`, `diffTask`, `formatIst`, `formatEvent`, `tokenPathFor`, `writeToken`, `checkToken`, `removeToken`, `Superseded`, `spawnGit`, `readHead`, `createWatcher` (`tick`, `run`, `allDone`, `states`; injected `git`, `now`, `sleep`, `out`, `err`), `statusTable`, `parseArgs`, `main`, `DEFAULTS`.
- `apps/web/test/watch-cloud.test.ts` (new): 69 tests (Node project), git always faked except two CLI runs (`stop`, and the bad run file that exits 2 before any git call, with an empty `PATH`).
- this run file (this section).

**Engineering choices inside the brief** (for the reviewer; none is an owner decision):
1. Git calls are `execFile("git", [...])` (no shell), a 30 s timeout, `windowsHide`, `GIT_TERMINAL_PROMPT=0` (a credential prompt would otherwise hang until the timeout). The remote must be a plain remote name (`[A-Za-z0-9][A-Za-z0-9._-]*`) and branches can't start with `-`, so nothing in the run file can be read by git as an option; `ls-tree` takes the path after `--`.
2. A failed `git show <sha>:<runFile>` is told apart from "file not at that commit" by `git ls-tree --name-only <sha> -- <runFile>` (empty answer = `(no run file yet)`); a timeout or any other failure leaves the head unseen. The committer time comes from `git show -s --format=%ct <sha>`. So a changed head costs fetch + show + show -s (+ ls-tree only when the show failed); an unchanged tick is one ls-remote.
3. A run file with no Status line in its first 40 lines shows `(no Status line)` (class working).
4. Status texts in lines are cut at 120 characters (`…`), keeping a PR URL that the cut would lose, so a line stays short.
5. `QUIET` is not printed for a task that is done (PR READY or merged): it has already asked for the main session or needs nothing. It is printed for WAITING/BLOCKED/FAIL/SENT-BACK tasks.
6. At the first tick, sub-branches already on the remote print `SUB-PUSH` (like the first `STATUS`) but don't re-arm the quiet timer, which starts from the task tip's committer time, so a silent session is still reported on time. A task branch that appears later counts as a push.
7. A failed `ls-remote` skips the whole tick (no false `GONE`); a failed fetch/show for one task doesn't stop the other tasks in that tick.
8. `WATCHER …` and `ALL DONE` lines carry the `HH:MM IST` prefix like the event lines. With `--action-only`, `WATCHER git back` is filtered (it doesn't end in ` ACTION`), as the brief's rule says.
9. Errors at start (bad or unreadable run file, bad option) print one line on **stdout** and exit 2, so a Monitor shows them; `superseded, exiting` goes to stderr as the brief says. `status` exits 1 with one line if `ls-remote` fails (the brief only covers success).
10. `stop` needs only the run file's directory (it removes `<dir>/watch.token`; it doesn't read or validate the run file). Nothing is written beyond the token; a refused start writes no token.

**Commands and results.**
- `pnpm install --frozen-lockfile --offline`: done (worktree had no links).
- `pnpm --filter @techaust/web exec vitest run test/watch-cloud.test.ts`: 1 file, **69 passed** (≈0.9 s).
- `pnpm exec biome check tools/watch-cloud.mjs apps/web/test/watch-cloud.test.ts`: clean (after `--write` formatting).
- `bash tools/heavy.sh --log orchestrate-watcher-lint pnpm lint`: exit 0, 1451 files; 10 warnings and 8 infos, all in files this task didn't touch (`apps/admin/worker/reports.test.ts`, `apps/web/src/lib/catalogue.ts`, `packages/core/src/public-text.ts`, `packages/pdf/test/*`); none in the two new files.
- Manual `status` against the real `origin`, temp run file = `.claude/skills/orchestrate/templates/run.example.json` (task `orchestrate-skill`), 0.8 s, exit 0:
  ```
  task               branch                  head     push age  class    status                                             sub-branches
  orchestrate-skill  feat/orchestrate-skill  873cfc2  3 min     working  builder running (watcher); lead writing the skill  fix/orchestrate-skill-watcher@5095e0d
  ```
- Manual `watch --run <temp> --interval 10`, started 06:05:09 UTC; `stop --run <temp>` from a second shell at 06:05:47 printed `watch-cloud: stop sent`; the watcher exited 0 by 06:05:52 (within 5 s). stdout:
  ```
  11:35 IST watch-cloud: watching 1 task(s) every 10 s, quiet after 45 min
  11:35 IST orchestrate-skill SUB-PUSH fix/orchestrate-skill-watcher 5095e0d
  11:35 IST orchestrate-skill STATUS builder running (watcher); lead writing the skill
  ```
  stderr: `watch-cloud: superseded, exiting`. No watcher process left afterwards.

**Not verified.**
- Windows (Git Bash + Node 24 under the Monitor tool): only run on Linux. The code uses `path`, `execFile` with `windowsHide` and no POSIX-only calls; whether an orphaned copy on Windows really exits relies on its node process still running its sleep loop (it checks the token every 5 s), which the Linux run and the tests show but Windows didn't.
- A git call already in flight when the token changes finishes (up to the 30 s timeout) before the copy exits; the 5 s promise holds while sleeping, which is where the watcher spends nearly all its time.
- A live takeover by a second `watch` copy (covered by the unit test with a real token file in a temp dir, not run by hand).
- The `QUIET`, `GONE`, `WATCHER` and `ALL DONE` lines against the real remote (unit-tested only).
- `pnpm check` / typecheck: not run (out of my brief; the test file isn't in any tsconfig `include`, like `agent-slots.test.ts`).

**Open questions.** None for the owner. For the lead: choices 5 (no QUIET for a done task) and 9 (start errors on stdout) are the two a reviewer might want otherwise.

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
