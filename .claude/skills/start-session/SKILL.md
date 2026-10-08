---
name: start-session
description: Start or resume work on the TecHaust rebuild. Use when the owner says "start the day", "good morning", "continue", "resume" or "where are we".
---

1. **Read the record:**
   - `CLAUDE.md` (the rules)
   - `docs/12-status.md` (where things stand)
   - `docs/13-decisions.md` (never re-ask a decided question)
   - any open `docs/runs/*.md`: on "continue", start from the newest **Handover** section

   Then check the work in flight: `git status`, `git branch --show-current`, `git worktree list`.
2. **Check GitHub:**
   - `gh run list --limit 3` (the latest CI run and its result)
   - `gh pr list --state open` (open PRs, their checks, and whether auto-merge is on)
3. **Check the setup and the budget** ([docs/14](../../../docs/14-models-and-usage.md)):
   - The lead should be Opus 5.5 at medium effort (high only for one named task). If this session runs on anything else, say so in one line, and don't pin it.
   - Load the usage tool (`ToolSearch` → `select:mcp__ccd_session_mgmt__get_usage`) and read "Weekly · all models" and "5-hour limit".
   - Work out the pace: 14 % × days since the last Monday 10:00 UTC (15:30 IST) reset.
   - State today's gate in one line, e.g. "Weekly 67 % vs pace 42 %: over the pace, one agent at a time." If the usage can't be read, treat it as over the pace and say so.
4. **Say where things stand** in one short paragraph of plain words:
   - what's done since the last session
   - what's in progress
   - what's waiting on the owner
   - the next item
5. **Continue from the next item.**
   - If it touches more than one file, first present a numbered plan and wait, unless the owner has already approved that plan (check `docs/12-status.md` and `docs/13-decisions.md`).
   - If the next item waits on the owner, say exactly what they need to do (click-by-click), and stop.
