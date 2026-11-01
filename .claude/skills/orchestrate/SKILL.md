---
name: orchestrate
description: Run pending TecHaust tasks as parallel cloud sessions controlled from the PC main session, and supervise them. Use when the owner says "run these in the cloud", "start a parallel run", "check the cloud sessions", "orchestrate", or after a usage-limit stop ("resume the cloud sessions"). Arguments: none or "start" (plan and start a run), "status", "resume", "stop".
---

The PC session is the **main session**: it plans the run, starts the cloud sessions, watches them, relays the owner's answers and usage readings, reviews every PR before auto-merge, sets the merge order and alone keeps the record. Each cloud session is its task's lead (CLAUDE.md "In a cloud session" → "Parallel task sessions"; [runbook Part 4](../../../docs/runbooks/cloud-sessions.md)). Owner decisions behind this skill: docs/13 rows of 2026-10-31 (parallel task sessions, 2 agents per session, questions through the main session, the protocol, the watcher, `/orchestrate`) and 2026-11-01 (usage pacing).

Files: `templates/shared-rules.md` (the block every prompt starts with), `templates/task-prompt.md`, `templates/run-record.md` (the run's file `docs/runs/cloud-parallel-<date>.md`), `templates/run.example.json` (the watcher's list); the watcher is `tools/watch-cloud.mjs`.

**Arguments:** `status` → step 5 only (one table, then the answers that are due). `resume` → "After a usage-limit stop" below. `stop` → step 10's clean-up without archiving. Otherwise start at step 1.

## 1. Choose the tasks
1. Read the record as `start-session` does (12, 13, the open run files), then `git fetch --prune origin` and list the branches in flight (the PC's own task branches and any open PR).
2. A task qualifies only if **all** of these hold; say which test each other pending task fails:
   - **it skips no milestone:** the milestone before it is approved on staging (CLAUDE.md hard rule 2), or it is planning only (briefs, research drafts: docs, no code);
   - **no migration clash:** it needs no migration, or its migrations can take numbers after every in-flight branch's in a merge order you can state now (a branch touching the same tables or triggers as an in-flight one waits);
   - **no hosted change:** no deploy, secret, Access rule, DNS, Cloudflare/AWS/GitHub setting or owner filing inside the task (a hosted step the owner does before the merge is fine if the PR is held, as M6.2);
   - **not kept on the PC** by an owner decision (13, e.g. 2026-10-31 "M6.2 and T11 run on this PC"), and needs nothing that only the PC has (the owner's AWS, a browser signed in to a hosted service);
   - **no file overlap** with another session or the PC's agents that the prompts can't fence off.
3. **Pacing (owner, 2026-11-01, docs/13):** at most **two** cloud sessions beside the PC's agents; start them **right after a 5-hour reset** (read the bar with `get_usage`: `ToolSearch` → `select:mcp__ccd_session_mgmt__get_usage`); the run stops new agents everywhere at **85 %**. Four sessions plus two PC agents emptied the window in two hours on 2026-11-01.

## 2. The owner's choice
One AskUserQuestion batch (up to 4 questions, the recommendation first, "(Recommended)"): which qualifying tasks start now (at most two), and any decision a task needs before it can start. Never ask what 13 already decides. Write the plan into a new `docs/runs/cloud-parallel-<YYYY-MM-DD>.md` from `templates/run-record.md` (Plan table, "Not started, and why").

## 3. Write the prompts
- Fill in `templates/shared-rules.md` once for the run (number of sessions, the PC's work, the first reading, the migrations rule, the Worker bytes on `main`), then one block per task from `templates/task-prompt.md`. Copy both, exactly as sent, into the run file.
- Each session's name, branch and run file go into `.logs/orchestrate/run.json` (git-ignored; shape in `templates/run.example.json`; sub-branch prefix `fix/<name>-`, as the shared rules tell the sessions).
- Check before starting: the setup script and the SessionStart hook on `main` are current (a session clones `main`); the next free copy-file letters; the merge order.

## 4. Start the sessions and arm the watcher
1. **A session starts only from a message the owner typed in the desktop app's Code tab** with this conversation on screen; a message sent over Remote Control can't create one. If the owner is away or on Remote Control, say so in one line and wait.
2. Start each with `start_session` (target cloud, environment `techaust_platform`, prompt = shared rules + task). Record the session ids, the time and `main`'s short sha in the run file.
3. Within about 10 minutes, check each pushed its branch and run file (`git ls-remote origin refs/heads/<branch>`) and runs on Opus 5.5 (its run file's first lines; a session that stopped in setup shows `[setup] FAILED: …`: archive it and fix the setup first).
4. **Arm the watcher** with the Monitor tool: `node tools/watch-cloud.mjs --run .logs/orchestrate/run.json` (add `--action-only` when usage is over 60 %: only lines that need you). It prints one line per event and exits when every task is PR READY or merged. Only the newest copy runs: starting a new one makes the old one exit within seconds, so re-arming is always safe (the Windows lesson of 2026-10-31: expired Monitors left 11 orphaned watchers and PR READY arrived 30 minutes late).
5. **Heartbeat:** a session-only schedule every 30 minutes that (a) reads the usage and sends it (step 6), (b) re-arms the watcher (step 4.4), (c) runs `node tools/watch-cloud.mjs status --run .logs/orchestrate/run.json` and acts on anything the watcher should have reported.

## 5. React to the watcher's lines
Each line is `HH:MM IST <session> <KIND> <detail>`; lines ending in `ACTION` need you now.
| Kind | What to do |
|---|---|
| `STATUS` | Note it in the orchestrator log only if it matters (a new step, a finding count). |
| `WAITING` | Read the run file's "Questions for the owner" (`git show origin/<branch>:<run file>`). Answer from 13 if it is decided there (send the answer and the row's date). Otherwise collect it for the next owner batch (step 7). |
| `PR-READY` | Review it (step 8). |
| `BLOCKED`, `FAIL` | Read the run file; unblock by message if the record or the plan allows, else take it to the owner with a recommendation. |
| `SENT-BACK` | Nothing unless it repeats: a second send-back of the same finding goes to the owner with the reviewer's words. |
| `SUB-PUSH` | Activity only (an agent pushed `fix/<name>-*`). |
| `QUIET` | 45 minutes with no push on the branch or its sub-branches: send the session "Status?" with the newest usage reading; if it stays quiet 30 minutes more, tell the owner (it may have hit a limit or stalled). |
| `GONE` | The branch was deleted (normally after its merge). |
| `WATCHER git failing` | Check the network on the PC; the watcher retries by itself. |
| `ALL DONE` | Every task is PR READY or merged: finish reviews and merges, then step 9. |

`status` prints the same facts as one table, for "check the cloud sessions".

## 6. Relay usage
- Send every session `USAGE <pct> at <ISO time>` (e.g. `USAGE 42 at 2026-11-01T13:05+05:30`) at the start, at each heartbeat, and whenever the bar crosses 50 %, 70 % or 85 %. Never commit it (`docs/runs/usage-reading.md` stays as it is).
- **Over 85 %:** say so to each session ("USAGE <pct> …: no new agents until the reset at <time>"), start no new PC agent either, and write the reset time in the run file. Running agents keep going and commit as they go.
- Before the window runs out, tell the owner the reset time and that the run continues when they type `/orchestrate resume` after it (on 2026-11-01 nothing reviewed or merged for six hours because nobody typed).

## 7. Questions to the owner, one batch
Collect every open question from every session (and the PC's agents) into **one** AskUserQuestion batch (4 per batch; more batches only if needed), each standing on its own: the session, the plain-English context, the options with the session's recommendation first. New copy goes as one page of numbered lines with recommendations (CLAUDE.md "owner's reviews"). Send each answer to its session as a message, word for word with the date, and log it. Lines the owner delegated (staff-only copy, 13 rows "under the owner's delegation") the main session approves itself and logs as such.

## 8. Review each PR before auto-merge
Read the PR (`gh pr view <N> --json …`, `gh pr diff <N>`) and the run file on its branch. Every item must hold; log the row in the run file's "PR reviews" table:
1. **Verdicts:** the run file has the reviewer's APPROVE (and a re-check APPROVE after any critical or high finding); each finding fixed or kept with a reason; the early check for Tiers A and B.
2. **Models:** the run file's `Usage:` line shows every agent on Opus 5.5 at high (from `node tools/model-audit.mjs`), skills loaded.
3. **CI** green on the PR's head; the branch contains current `main` (else ask the session to take `main` in).
4. **Migrations:** numbered after `main`'s newest and in the planned order; none rebuilds a referenced table (`scripts/check-migrations.mjs`); a change to a table, trigger, constraint or foreign key had the analyst's check.
5. **Workflows:** no `.github/workflows/*` change except one the owner approved (name the 13 row).
6. **Worker bytes** in the run file, under every ceiling and plan line (`scripts/worker-budget.mjs`; docs/12 "Verified" has the last figures).
7. **Tags:** code comments use `Researched …`, `Settled by the lead on the safest reading …` or `OPEN (08-C <ID>)` as the register says (the settled-tag rule, 13 2026-10-31); nothing settles an item 07 or 08-C keeps OPEN.
8. **Copy:** every new user-facing line approved in its 07 appendix (owner, or the lead under delegation for staff-only lines); no new `[Placeholder` outside the issue guard.
9. **Holds and limits:** not held by the record (a held PR gets no auto-merge); `PAYMENTS_LIVE_ALLOWED` still `"false"`; no secrets, personal or client data (the repo is public).

All hold → `gh pr merge <N> --auto --squash` (it merges at once when CI is already green), then bind the PR and turn on Auto-fix (`ccd_pr` `get_status`, else `bind_pr`, then `set_monitor`); if Auto-fix is refused for a PR a cloud session opened, ask the owner to turn it on from the PR bar. Any item fails → send the session the exact finding ("SEND BACK: …") and log it.

**Merge order and renumbering:** merge in the planned order. After each merge, message the next branch: "`<merged PR>` merged: take origin/main in now<, renumber your unapplied migrations from NNNN (and regenerate the trigger set with `scripts/write-triggers.ts`)>, re-run the checks, set PR READY again." Follow CLAUDE.md "migration order across parallel branches" and "after a squash merge"; a merge with many conflicts goes back to that session with an integration brief.

## 9. The record
Only the main session edits `docs/12-status.md`, `docs/13-decisions.md`, `CHANGELOG.md`, `CLAUDE.md` and memory. After each merge (or at the day's end, as `end-session` does), copy from each run file: "Lead decisions (for 13)" → 13 rows (who: Lead, or Owner for the owner's answers), "Follow-ups (for 12)" → 12, "Proposed CLAUDE.md text" → CLAUDE.md where it holds; the run file's orchestrator log, PR reviews and lessons stay in `cloud-parallel-<date>.md`. A lesson that changes how runs work goes into this skill or its templates in the same record PR.

## 10. Morning report and archive
- **Morning report** (the first message after the owner returns, or "start the day" when a run was left going): one short list per session (merged PR with link, PR waiting and why, waiting on the owner, quiet or stopped), the questions as one batch, usage now and the next reset, the lessons in one line each.
- **Archive:** when a session's PR has merged (and a milestone is approved on staging), tell the owner to archive that cloud session (not delete); when the last one is done, run `node tools/watch-cloud.mjs stop --run .logs/orchestrate/run.json`, delete the heartbeat schedule, mark the run file `Status: done`, and tell the owner this main conversation can be archived once the record PR has merged.

## After a usage-limit stop (`/orchestrate resume`)
1. Read the bar; if it is still over 85 %, say when the window resets and stop.
2. **Resume the PC's own agents by message:** each agent stopped by the limit is resumed with SendMessage to its agent id ("The usage window has reset; continue from your last commit."), never restarted from scratch while reachable. Its run file names the step it was on.
3. **Re-arm the watcher** (step 4.4) and the heartbeat (4.5), then run `status` and act on every row (a session that went quiet at the limit gets "continue" with the newest reading).
4. Send every session the new `USAGE <pct> at <ISO time>`, then catch up: reviews of PRs that waited (step 8), the owner's batch (step 7). Log the stop and the resume in the run file.
