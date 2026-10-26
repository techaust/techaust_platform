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
   - `gh pr list --state open` (open PRs, their checks, and whether auto-merge is on)
3. **Check the setup and the budget** ([docs/14](../../../docs/14-models-and-usage.md)):
   - The lead must be **Opus 5.5 at medium effort**, for every step. Run `git status` first: the model-guard hook then reports this session's effort level ("Lead effort level: …"). If the model isn't Opus 5.5 or the effort isn't medium, say so in one line ("Please pick Opus 5.5, medium in the model menu") and do nothing else until it's fixed.
   - Load the usage tool (`ToolSearch` → `select:mcp__ccd_session_mgmt__get_usage`) and read "5-hour limit" (Team plan: there is no weekly pace for our models).
   - State today's gate in one line, e.g. "5-hour window 12 %: up to two agents at once." If the usage can't be read, say so: one agent at a time. If a weekly limit for Opus, Sonnet or Haiku appears, tell the owner.
4. **Say where things stand** in one short paragraph of plain words:
   - what's done since the last session
   - what's in progress
   - what's waiting on the owner
   - the next item
5. **Continue from the next item.**
   - If it touches more than one file, first present a numbered plan and wait, unless the owner has already approved that plan (check `docs/12-status.md` and `docs/13-decisions.md`).
   - If the next item waits on the owner, say exactly what they need to do (click-by-click), and stop.
