# Run files

Each task given to a builder gets one file, `docs/runs/<task>.md` (for example `m1.5-admin-shell.md`), that starts with a status line, `Status: open | merged (PR #N) | abandoned`, followed by these sections:

1. **Brief**, written by the lead before the builder starts:
   - the PRD IDs
   - the files involved
   - what "done" means
   - what's out of scope
2. **Builder report**, written by the builder:
   - the files changed
   - the commands run and their results
   - anything not verified
   - open questions
3. **Review**, the reviewer's reply (APPROVE or SEND BACK, with findings), copied in by the lead.
4. **Integration notes**, written by the lead:
   - how the task was merged
   - the full-check results
   - follow-ups
