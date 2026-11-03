---
name: record-and-daily-sessions
description: "Daily \"start the day\"/\"end the day\" sessions; CLAUDE.md is rules only; status lives in docs/12-status.md (replaced), plus DECISIONS, CHANGELOG, docs/runs"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 71a8c6af-b618-40db-a348-e49b6de3b130
  modified: 2026-10-06T19:07:07.118Z
---

The owner starts each day in a new conversation with "start the day" (skill `start-session`) and ends it with "end the day" (skill `end-session`). Since 2026-10-08, each step of a task in between (brief, review triage, integration) gets its own conversation, opened with "continue" and resumed from the run file's **Handover** section.

**Where things are recorded:**
- **CLAUDE.md:** rules only, never status or history.
- **`docs/12-status.md`:** the single place for where things stand. It is **replaced** at each session end, never appended to.
- **`docs/13-decisions.md`:** one row per decision: date, decision, who (Owner or Lead), where it's applied. **Never re-ask a question decided there.**
- **`CHANGELOG.md`:** one line per merged PR, newest first.
- **`docs/runs/<task>.md`:** per builder task: `Status:`, `Tier:` and `Usage:` lines, then the brief, the early check (Tier A), the builder's report, the review, the integration notes and the handover.
- **`docs/09-roadmap.md`:** stays the plan.

**Why:** a fresh conversation each day costs far less per turn, and any session must be able to pick up without the owner repeating themselves. Owner decision, 2026-10-07.

**How to apply:**
- At the start, read STATUS, DECISIONS and the open runs, plus CI and PRs, read the usage (`get_usage`) and state the day's gate, then report in one paragraph and continue. For multi-file work, show a numbered plan first unless it's already approved.
- At the end, replace STATUS, add CHANGELOG and DECISIONS rows, check links, open a docs PR with auto-merge, report in plain lines (including the usage and the lead setting the next step needs), and list any running agents without stopping them. `doc-clerk` may draft the CHANGELOG lines; check its diff.

Related: [[model-effort-rule]], [[working-with-owner]]
