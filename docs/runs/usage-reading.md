# Usage reading for cloud sessions

A cloud session that can't read the 5-hour bar itself reads this file before starting any agent (docs/14 §5, owner 2026-10-29):
- **No reading for today (IST):** nothing new starts.
- **A reading over 2 hours old:** one agent at a time.
- **A reading over 95 %:** nothing new starts.

The local lead (or the owner) updates the line below on the cloud session's branch. Keep the format: `node tools/agent-slots.mjs --cloud --reading <pct> --reading-at <time>` takes these two values.

**Parallel task sessions** (owner, 2026-10-31; [runbook Part 4](../runbooks/cloud-sessions.md)): the main session sends each cloud session `USAGE <pct> at <ISO time>` (e.g. `USAGE 3 at 2026-10-31T11:54+05:30`) as a message. The session passes the newest one to `agent-slots.mjs` and never edits or commits this file, so five branches don't fight over one line.

Reading: none yet
