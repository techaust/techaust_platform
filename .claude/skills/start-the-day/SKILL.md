---
name: start-the-day
description: Morning start for the TecHaust rebuild. Use when the owner says "start the day", "good morning", "let's continue" or similar at the start of a session. Checks setup and status, then proposes the day's next step.
---

Start the owner's working day. Keep it short, and don't build anything yet.

1. **Setup check.** The lead should be Opus 5.5 at medium effort (see "How work is split" in CLAUDE.md). If this session runs on anything else, say so in one line.
2. **Where we are.**
   - Read the status section of CLAUDE.md and the memory notes.
   - Run `git status`, `git branch --show-current` and `git log --oneline -5`.
   - Run `gh pr list --state open` and check CI on any open PR.
3. **What's waiting.** List the owner actions that block the current milestone (from CLAUDE.md and the runbooks), plus anything they said they'd do last time.
4. **Report.** In at most 8 lines, say:
   - where we are
   - what's blocked, and on whom
   - the next step for today, with which parts go to `slice-builder` agents, if any
5. **Wait.** Ask the owner to confirm or to say what they've finished (e.g. "Access is on"). Don't start building, merging or deploying until they reply.
