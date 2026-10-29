---
name: start-session
description: Start or resume work on the TecHaust rebuild. Use when the owner says "start the day", "good morning", "continue", "resume" or "where are we".
---

1. **Read the record:**
   - `CLAUDE.md` (the rules)
   - `docs/12-status.md` (where things stand)
   - `docs/13-decisions.md` (never re-ask a decided question)
   - any open `docs/runs/*.md`: on "continue", start from the newest **Handover** section

   Then check the work in flight: `git status`, `git branch --show-current`, `git worktree list`. If the current branch's PR has merged and nothing is uncommitted, switch to `main`, run `git pull --ff-only`, and delete that local branch.
2. **Check GitHub:**
   - `gh run list --limit 3` (the latest CI run and its result)
   - `gh pr list --state open --json number,title,headRefName,isDraft,autoMergeRequest,statusCheckRollup` (open PRs, their checks, and whether auto-merge is on)
3. **Catch up with cloud sessions** (on this PC only; skip this step when `CLAUDE_CODE_REMOTE` is `true`). A cloud session can open a PR but can't turn on auto-merge or Auto-fix, so its work, including its "end the day" record, waits here (owner, 2026-10-29):
   - **Bring the checkouts up to date:** `git fetch --prune origin`. In the main checkout, if it's clean and on `main`, run `git pull --ff-only`. For each side worktree in `git worktree list` whose branch has moved on `origin` (a cloud session worked on the same task), run `git -C <path> pull --ff-only`. If it can't fast-forward because both sides moved, don't merge or force anything: report it as a merge for the lead.
   - **Cloud PRs:** every open PR from step 2 that has auto-merge off and isn't a draft. For each one:
     - check the record (`docs/12-status.md`, `docs/13-decisions.md`) for a hold;
     - if it isn't held, run `gh pr merge <N> --auto --squash`;
     - held or not, bind it to this session and turn on Auto-fix (`ccd_pr` `get_status`, else `bind_pr`, then `set_monitor`), as for every PR.

     Name each one to the owner with its link and what it is.
   - **The cloud's record:** if one of those PRs is a cloud "end the day" (a `docs/…` branch changing `docs/12-status.md`), it is newer than `main`'s record until it merges. Read it from its branch (`git show origin/<branch>:docs/12-status.md`, and the run files' newest **Handover** the same way), and use it for steps 5 and 6 instead of `main`'s copy.
   - **Clean-up:** delete local branches whose PRs have merged (`git branch -d`, never `-D` on a branch with unmerged work).
4. **Check the setup and the budget** ([docs/14](../../../docs/14-models-and-usage.md)):
   - The lead must be **Opus 5.5 at high effort**, for every step (owner, 2026-10-29). Run `git status` first: the model-guard hook then reports this session's effort level ("Lead effort level: …"). If the model isn't Opus 5.5 or the effort isn't high, say so in one line ("Please pick Opus 5.5, high in the model menu") and do nothing else until it's fixed.
   - Load the usage tool (`ToolSearch` → `select:mcp__ccd_session_mgmt__get_usage`) and read "5-hour limit" (Team plan: there is no weekly pace for our models).
   - State today's gate in one line, e.g. "5-hour window 12 %: up to two agents at once (this PC)." New agents start while the bar is at or under 95 %; `node tools/agent-slots.mjs` decides each start (docs/14 §5). If the usage can't be read, say so: one agent at a time. In a cloud session that can't read the bar, read `docs/runs/usage-reading.md` (none today → nothing new starts; over 2 hours old → one agent at a time). If a weekly limit for Opus appears, tell the owner.
5. **Say where things stand** in one short paragraph of plain words:
   - what's done since the last session (on this PC or in a cloud session), and which cloud PRs step 3 picked up
   - what's in progress
   - what's waiting on the owner
   - the next item
6. **Continue from the next item.**
   - If it touches more than one file, first present a numbered plan and wait, unless the owner has already approved that plan (check `docs/12-status.md` and `docs/13-decisions.md`).
   - If the next item waits on the owner, say exactly what they need to do (click-by-click), and stop.
