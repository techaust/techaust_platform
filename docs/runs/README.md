# Run files

Each task given to a builder or designer gets one file, `docs/runs/<task>.md` (for example `m1.5-admin-shell.md`), that starts with three header lines:
- `Status: open | merged (PR #N) | abandoned`
- `Tier: A | B | C` ([14 §2](../14-models-and-usage.md))
- `Usage:` one entry per agent run: the agent, model and effort (copied from `node tools/model-audit.mjs`, not from what was intended), then the weekly and 5-hour percentages at its start and end, e.g. `builder claude-sonnet-5-5/high: weekly 42 → 49 %, 5-h 3 → 38 %`

Then these sections:

1. **Brief**, written by the lead before any agent starts (drafted by the `analyst` for Tier A):
   - the PRD IDs
   - the files involved, split by layer: data, logic and API for the `builder`; screens for the `designer`
   - for M2.1, M2.2, M3.1 and M4.5: "Preview" first ([14 §4](../14-models-and-usage.md))
   - what "done" means
   - what's out of scope, and what another task owns
2. **Early check** (Tier A only): the builder's report once the schema, migrations, core logic and API routes are committed, then the analyst's GO or CHANGE on that diff.
3. **Builder report**, written by the builder:
   - the files changed
   - the commands run and their results
   - anything not verified
   - open questions
4. **Designer report**, written by the designer: the same, plus the screenshot paths, any placeholder text, and confirmation that the `frontend-design` skill was loaded first (the lead checks this before the review). For a preview, the owner's approval follows it.
5. **Review**, the reviewer's reply (APPROVE or SEND BACK, with each finding's severity, and the visual review when there are screens), copied in by the lead.
6. **Integration notes**, written by the lead:
   - how the task was merged
   - the full-check results
   - follow-ups (the medium and low findings that weren't fixed)
7. **Handover**, written by the lead at the end of each conversation: where the task stands and the next step. The next conversation ("continue") starts here.
