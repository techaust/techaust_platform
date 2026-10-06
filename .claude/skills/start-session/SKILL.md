---
name: start-session
description: Start or resume work on the TecHaust rebuild. Use when the owner says "start the day", "good morning", "continue", "resume" or "where are we".
---

1. **Read the record:**
   - `CLAUDE.md` (the rules)
   - `docs/12-status.md` (where things stand)
   - `docs/13-decisions.md` (never re-ask a decided question)
   - any open `docs/runs/*.md`

   Then check the work in flight: `git status`, `git branch --show-current`, `git worktree list`.
2. **Check GitHub:**
   - `gh run list --limit 3` (the latest CI run and its result)
   - `gh pr list --state open` (open PRs, their checks, and whether auto-merge is on)
3. **Check the setup.** The lead should be Opus 5.5 at medium effort. If this session runs on anything else, say so in one line, and don't pin it.
4. **Say where things stand** in one short paragraph of plain words:
   - what's done since the last session
   - what's in progress
   - what's waiting on the owner
   - the next item
5. **Continue from the next item.**
   - If it touches more than one file, first present a numbered plan and wait, unless the owner has already approved that plan (check STATUS and DECISIONS).
   - If the next item waits on the owner, say exactly what they need to do (click-by-click), and stop.
