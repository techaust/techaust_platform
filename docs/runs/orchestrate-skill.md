# Run: the `/orchestrate` skill and the cloud watcher

Status: fixes running (review 1 SEND BACK: 1 high, 1 medium, 6 low)
Tier: C
Usage: lead claude-opus-5-5/high (cloud session orchestrate-skill); builder claude-opus-5-5/high (model-audit; skills: none — no docs/14 §9 row fits a plain Node CLI, flagged by the audit for that reason): 5-h 5 → ? %; reviewer: below. Reading at the start: USAGE 5 at 2026-11-01T11:15+05:30.

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

### Fix report (r1)
Fix builder (claude-opus-5-5, high), 2026-11-01, `fix/orchestrate-skill-r1` from `origin/feat/orchestrate-skill` (76467fb). Files: `tools/watch-cloud.mjs`, `apps/web/test/watch-cloud.test.ts`, this section. **Skills:** none loaded; no docs/14 §9 row fits a plain Node CLI (the Cloudflare rows are for Worker code, `code-review` for the reviewer).

1. **(high) Saved state.** Per-task state (started, tip, head read, status, class, URL, sub-branch heads, last move, quiet fired, gone) is kept in `<run dir>/watch.state.json` (`statePathFor`, `parseState`, `serializeState`, `readStateFile`, `writeStateFile`). It is loaded when the watcher is created (the token is already written by then). A missing, unreadable or non-JSON file, a different `version` or `remote`, or a task whose saved branch, run file or sub-branch prefixes differ from the run list, or with a field of the wrong shape, means no saved state for that task. The class and URL are worked out again from the saved text. The file is written after a tick only when its text changed: temp file + `renameSync`, after a token check right before the write (a superseded copy throws `Superseded` and writes nothing). A write error prints one stderr line and is retried. With no saved state, a task's first tick fetches each sub-branch once and reads its committer time (a failure counts as now). QUIET starts from the newest of that and the tip's time, and waits for the first read of a listed tip. A branch absent at start whose saved state shows it seen (a tip or a read head) prints GONE once; already gone prints nothing. The header now names everything written. Tests: a second copy over saved state prints nothing and calls only `ls-remote`, and an unchanged tick leaves the file byte-identical. A real change (SUB-PUSH + SENT-BACK) prints once and a third copy prints nothing. A fired QUIET isn't repeated. 60-min tip + 5-min sub → no QUIET at start, QUIET at +40 min (45 after the newest), sub fetched once. A failed sub fetch counts as now. Merged and deleted before a re-arm → GONE, ALL DONE, and a later copy prints only ALL DONE. A never-seen absent branch isn't done. A superseded copy (token changed after its last git call) leaves the file unchanged and no temp file. Corrupt, foreign or malformed files are ignored and replaced. `parseState` per-field checks and a round trip. The old test "starts from the tip's commit time" now passes `subsMs` and covers the busy-sub case. The `--action-only` test's sub-branch is older than the tip.
3. **(low) Prefix overlap.** `subsByTask(heads, tasks)`: a branch goes to the task with the longest matching prefix, and no task branch is ever a sub-branch. `parseRun` refuses the same prefix in two tasks (exit 2) and drops duplicates within one task. Tests: `pay` / `pay-links` (unit and loop), the wide-prefix case, and the refusal.
4. **(low) Classification.** `CLASS_RULES`: keywords match only at the start of the Status text (after punctuation and spaces), case-insensitive, as whole words (a letter, digit, `_` or `-` after them means another word). PR READY (with its URL), WAITING ON, BLOCKED, FAIL/FAILED/FAILING, SEND/SENT BACK. `merged`, `abandoned` and `done` (not `done with`) are the done class `merged`. Tests: the reviewer's five cases plus `done.`, `Abandoned (…)`, `open (… merging …)`, `- PR READY …`, `(BLOCKED) …`, `PR READYING`. **Changed behaviour:** a keyword later in the text no longer counts, so "CI FAILING on lint" is now working. Those two old cases became "FAILING: CI lint" and "FAILED e2e". The shared rules already tell sessions to start the line with the keyword.
5. **(low) No QUIET while WAITING ON** (nor PR READY or done). Tests: waiting stays silent at +60 and +200 min. A later push with a working status re-arms it, and BLOCKED still fires.
6. **(low)** `git ls-tree --full-tree --name-only <sha> -- <path>`; the fake git now answers only that form. `parseRun` also refuses `.` parts (`./a`, `a/./b`, `a/.`, `.`), backslash-leading and UNC paths, and drive letters of either case. Tests added to the run-file refusals.
7. **(low)** Header: the token, the state file, and git's FETCH_HEAD and remote-tracking refs from `git fetch`.

**Commands and results.**
- `pnpm install --frozen-lockfile --offline`: done.
- `pnpm --filter @techaust/web exec vitest run test/watch-cloud.test.ts`: **104 passed** (was 69).
- `pnpm exec biome check tools/watch-cloud.mjs apps/web/test/watch-cloud.test.ts`: clean.
- `bash tools/heavy.sh --log orchestrate-r1-lint pnpm lint`: exit 0, 1451 files, the same 10 warnings and 8 infos in untouched files, none in these two.
- Real check against `origin`. The temp run file lists `orchestrate-skill` (`feat/orchestrate-skill`, `docs/runs/orchestrate-skill.md`) in a scratch directory.
  - First `watch --interval 10`, 06:23:29 to the `stop` at 06:23:57 UTC; exit 0:
    ```
    11:53 IST watch-cloud: watching 1 task(s) every 10 s, quiet after 45 min
    11:53 IST orchestrate-skill SUB-PUSH fix/orchestrate-skill-r1 df81bd4
    11:53 IST orchestrate-skill SUB-PUSH fix/orchestrate-skill-watcher c97cf7b
    11:53 IST orchestrate-skill STATUS fixes running (review 1 SEND BACK: 1 high, 1 medium, 6 low)
    watch-cloud: superseded, exiting   (stderr)
    ```
    `watch.state.json` was written beside the run file. Its `lastMoveMs` is df81bd4's commit time, the newest sub-branch commit, not the task tip from 8 minutes earlier.
  - Second `watch`, 06:24:13 to the `stop` at 06:24:39; exit 0. Only the start line, no repeats:
    ```
    11:54 IST watch-cloud: watching 1 task(s) every 10 s, quiet after 45 min
    watch-cloud: superseded, exiting   (stderr)
    ```
  - `status`, exit 0:
    ```
    task               branch                  head     push age  class    status                                                       sub-branches
    orchestrate-skill  feat/orchestrate-skill  76467fb  8 min     working  fixes running (review 1 SEND BACK: 1 high, 1 medium, 6 low)  fix/orchestrate-skill-r1@df81bd4 fix/orchestrate-skill-watcher@c97cf7b
    ```
  - No watcher process left afterwards.

**Not verified.**
- Windows: `renameSync` over an existing file another process holds open can fail with EPERM there. The watcher then prints one stderr line and retries on the next changed tick, but this wasn't run on Windows.
- Race: a re-armed copy loads the state right after writing its token. If the old copy passed its last token check just before that, it can still write once, and the new copy may repeat at most that one tick's lines.
- QUIET, GONE and ALL DONE against the real remote (unit-tested only, as before).

**Open questions.** None. For the re-check: finding 4 drops mid-text keywords on purpose ("CI FAILING on lint" is working).

## Review
### Review 1 (reviewer, 2026-11-01): SEND BACK
Skills: `code-review` (10 candidates, each verified); `security-review` not loaded (local CLI, no auth or public surface), the injection check done by hand. Ran: the watcher tests (69 passed), Biome clean, a real `status` and a short real `watch` + `stop` (exited within 7 s, no process left).
1. **High** — a re-armed watcher starts from empty state (`tools/watch-cloud.mjs:438` etc.; SKILL.md 4.5): (a) every heartbeat re-announces pending WAITING / PR-READY ACTION lines; (b) QUIET fires for an active session whose builder pushes only `fix/<name>-*` (first-tick sub-branches don't re-arm the timer, which starts from the task tip's commit time); (c) a branch merged and deleted before a re-arm never counts as done, so ALL DONE never prints. Fix: persist per-task state in `<run dir>/watch.state.json`, written only while holding the token; with no saved state start the quiet timer from the newest commit among the tip and its sub-branches; treat an absent branch with saved state as done; tests for all three.
2. **Medium** — the 85 % pacing rule labelled the owner's; docs/13 records it as the Lead's (SKILL.md:20, runbook Part 4, proposed CLAUDE.md item 3).
3. **Low** — overlapping sub-branch prefixes (`pay` and `pay-links`): `fix/pay-links-r1` counts for both. Fix: longest matching prefix wins (or reject overlaps); test.
4. **Low** — classification by substring with PR READY first: "SENT BACK … (was PR READY …)" → pr-ready; "done with builder" → merged; "Fail-safe review" → fail; "abandoned" → working. Fix: match class keywords at the start; `merged`/`abandoned` done; tests.
5. **Low** — QUIET fires for a WAITING session (it ends its turn by rule). Fix: skip while waiting.
6. **Low** — `ls-tree` resolves from the cwd, `show <sha>:<path>` from the root: use `--full-tree`; reject `.` path parts.
7. **Low** — the header says nothing but the token is written; fetch writes FETCH_HEAD and remote refs.
8. **Low** — shared-rules.md:6 points at "step 2" (it is 1.3); the 60 % `--action-only` threshold has no record row; SKILL.md §9 omits CHANGELOG.

**Triage (lead):** all fixed. 2 and 8 by the lead (labels → "Lead, 2026-11-01", step 1.3, the 60 % threshold as a lead decision, CHANGELOG line; SKILL.md §5 also says QUIET never fires for WAITING or PR READY). 1, 3–7 by a fix builder on `fix/orchestrate-skill-r1`. A re-check follows (finding 1 was high).

## Integration notes
(lead)

## Lead decisions (for 13)
- (lead, 2026-11-01) The skill and its templates are written by the lead (they restate the record); the builder builds only the watcher and its tests, in parallel on separate files.
- (lead, 2026-11-01) `status`, `resume` and `stop` from the 2026-10-31 row are skill arguments (`/orchestrate status|resume|stop`); the watcher itself has `watch`, `status` and `stop` (resume = re-arm the watcher and resume agents, a skill step).
- (lead, 2026-11-01) The skill recommends the watcher's `--action-only` once the 5-hour bar is over 60 % (fewer wake-ups of the main session).
- (lead, 2026-11-01) Review triage: the watcher persists its state in `<run dir>/watch.state.json` (written only by the copy holding the token), replacing the brief's "state lives in memory", so a heartbeat re-arm reports only real changes (review finding 1).
- (lead, 2026-11-01) The watcher prints a line on every Status change (the task's wording), and lines that need the main session end with ` ACTION`; `--action-only` prints only those, for a quieter Monitor.

## Proposed CLAUDE.md text
1. In "In a cloud session" → "Parallel task sessions", replace the first bullet's tail "from the shared prompt in [runs/cloud-parallel-2026-10-31.md](docs/runs/cloud-parallel-2026-10-31.md)." with: "with the **`/orchestrate` skill** (`.claude/skills/orchestrate/`: choosing tasks, the shared rules and prompt templates, the watcher, the PR review checklist, merge order, the record, resume after a limit)."
2. Replace the "Cloud sessions can't message back. The main session watches …" bullet's watcher sentence with: "The main session runs `node tools/watch-cloud.mjs --run .logs/orchestrate/run.json` in a Monitor (one line per Status change, PR READY, WAITING ON, BLOCKED/FAIL, sub-branch push `fix/<name>-*`, quiet 45 minutes; only the newest copy runs, so a re-arm by the 30-minute heartbeat never leaves an orphan; `status` prints one table, `stop` ends it)."
3. Add a bullet: "**Pacing** (Lead, 2026-11-01; the owner's gate stays 95 %): a run starts right after a 5-hour reset, with at most two cloud sessions beside the PC's agents; no new agent anywhere over 85 %; after a limit stop, `/orchestrate resume` resumes the PC's agents by SendMessage and re-arms the watcher."
(docs/14 §9 gains the skill row and runbook Part 4 points at the skill in this PR; neither is a main-session-only file.)

## Follow-ups (for 12)
- Closed by this task (remove from 12 "Parallel task sessions (2026-10-31)"): "the watcher counts only task-branch pushes" (the watcher counts `fix/<name>-*`).
- Still open: `tools/agent-slots.mjs` doesn't hold the per-session 2-agent cap or the 85 % pacing line of parallel runs (the shared rules do); Auto-fix for PRs a cloud session opened (the owner turns it on from the PR bar).

## Questions for the owner
None so far.

## Handover
(lead)
