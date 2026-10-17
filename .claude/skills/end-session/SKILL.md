---
name: end-session
description: Close the day on the TecHaust rebuild and leave the record current. Use when the owner says "end the day", "stop for today", "pause" or "wrap up".
---

1. **`docs/12-status.md`:** **replace** it with the state now. Never append. Use the sections:
   - Date
   - Done
   - In progress
   - Next
   - Waits on the owner
   - Open follow-ups
2. **`CHANGELOG.md`:** add one line per PR merged since the last entry, newest first. Format: `- YYYY-MM-DD [#N](https://github.com/techaust/techaust_platform/pull/N) title`. Get them from `gh pr list --state merged --limit 20`.
3. **`docs/13-decisions.md`:** add one row for every decision taken today, whether by the owner or the lead. Columns: date, decision, who, where it's applied.
4. **Run files:** bring every `docs/runs/*.md` touched today up to date, including its integration notes, its `Usage:` line and a **Handover** section (where the task stands and the next step).
5. **Models:** run `node tools/model-audit.mjs` (today's runs, with the model and effort from their own logs). Copy each agent run's model and effort into its run file's `Usage:` line. Anything flagged goes into the owner summary.
6. **Links:** check every relative link in the documents you changed, and fix any broken ones.
7. **Pull request:**
   - commit the documents on a `docs/…` branch
   - push, run `gh pr create`, then `gh pr merge --auto --squash` (merge on green, the owner's rule)
   - turn on Auto-fix for it (`ccd_pr` `set_monitor`), as for every PR
8. **Agents:** list any agent still running (builder, designer, analyst, reviewer). **Stop none without the owner's word.**
9. **Tell the owner,** in a few plain lines:
   - what was done
   - what was verified, and how
   - what waits on them
   - the next step (the lead is always Opus 5.5 at medium, [docs/14](../../../docs/14-models-and-usage.md) §3), and anything the model audit flagged
   - the usage now (weekly and 5-hour %)
   - the PR link, and that this session can be archived (not deleted) once that PR has merged
