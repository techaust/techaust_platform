---
name: cloud-parallel-sessions
description: "Owner 2026-10-31 — pending tasks run as parallel cloud sessions controlled by the PC \"main session\"; how to watch them, lessons, outcome of the first run"
metadata:
  node_type: memory
  type: project
  originSessionId: 5a058cb8-cadb-41a9-bff2-57ddcf481cf4
  modified: 2026-10-31T16:19:54.815Z
---

Owner (2026-10-31): every pending, unblocked task runs at once as its own cloud session (environment `techaust_platform`), started and controlled by the main session on the PC. At most 2 agents per cloud session. Questions go through the main session (run files → one AskUserQuestion batch → answers by SendMessage). Protocol: runbook `docs/runbooks/cloud-sessions.md` Part 4; CLAUDE.md "In a cloud session"; prompts and log: `docs/runs/cloud-parallel-2026-10-31.md`.

**Why:** the owner wants all work moving at once, with one place to talk to, and no time lost waiting on answers.

**How to apply:**
- `start_session` target cloud needs this conversation on screen in the Code tab (else "not_on_screen"); check `list_start_targets` first. Creating gateway/third-party accounts or handling keys can't be delegated to cloud sessions (owner's action; guide + hidden-input script instead).
- Cloud sessions can't message back. Watch with a Monitor polling each task branch's run-file `Status:` line every minute (wake only on WAITING / PR READY / blocked / failing / quiet 45 min, counting `fix/*` sub-branch pushes), re-armed by a session-only CronCreate heartbeat that also sends `USAGE <pct> at <ISO time>` on 5+ point moves and a fresh reading right after each 5-hour reset. Mark a push "seen" only after its status was read. **On Windows an expired/stopped Monitor leaves its bash running**: the script must exit when a newer copy starts (pid file), or orphans swallow events.
- Review every PR before auto-merge (T12 #129 was sent back for retagging RB-23/RB-35/RB-38(c) as settled; check workflow diffs against the owner's approval, migrations, Worker bytes, `PAYMENTS_LIVE_ALLOWED`). `gh pr merge --auto` merges at once when CI is green; `gh pr update-branch` when BEHIND by docs only.
- Auto-fix (`set_monitor`) is refused for every PR this way (even `gh pr create` ones); the owner can switch it on.
- Cloud quirks: Cloudflare skills don't load (model-audit flags no-skill runs); `security-review` needs `origin/HEAD`; the Playwright MCP looks in `/opt/pw-browsers`.

Outcome of the first run (2026-10-31): T12 #129, T6 #130, proforma withdraw #132, T7 #133, M6.1 #135 all merged by 21:40 IST; record #136. Next: M6.1 staging approval, the L9 decision, then the `/orchestrate` project skill (owner-approved). See [[record-and-daily-sessions]], [[model-effort-rule]], [[batch-m5-state]].
