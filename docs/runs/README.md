# Run files

Each task given to a builder gets one file, `docs/runs/<task>.md` (for example `m1.5-admin-shell.md`), that starts with three header lines:
- `Status: open | merged (PR #N) | abandoned`
- `Tier: A | B | C` ([14 §2](../14-models-and-usage.md))
- `Usage:` one entry per agent run: the agent, model and effort, then the weekly and 5-hour percentages at its start and end, e.g. `builder Sonnet/high: weekly 42 → 49 %, 5-h 3 → 38 %`

Then these sections:

1. **Brief**, written by the lead before the builder starts:
   - the PRD IDs
   - the files involved
   - what "done" means
   - what's out of scope, and what another task owns
2. **Early check** (Tier A only): the builder's report once the schema, migrations, core logic and API routes are committed, then the lead's notes on that diff.
3. **Builder report**, written by the builder:
   - the files changed
   - the commands run and their results
   - anything not verified
   - open questions
4. **Review**, the reviewer's reply (APPROVE or SEND BACK, with each finding's severity), copied in by the lead.
5. **Integration notes**, written by the lead:
   - how the task was merged
   - the full-check results
   - follow-ups (the medium and low findings that weren't fixed)
6. **Handover**, written by the lead at the end of each conversation: where the task stands, the next step, and the lead setting that step needs. The next conversation ("continue") starts here.
