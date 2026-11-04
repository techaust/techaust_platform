---
name: working-with-owner
description: "How to work with the owner: not a shell user, multiple-choice decisions only for theirs, honest reports, no installs, PRs merge on green, secrets via hidden-input PowerShell scripts"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 71a8c6af-b618-40db-a348-e49b6de3b130
  modified: 2026-10-06T19:07:13.192Z
---

**Instructions:**
- Click-by-click steps, one command per code block, with full paths. The owner isn't a shell user.

**Decisions:**
- Ask only the owner's own decisions, as multiple-choice questions with the recommendation first.
- Take routine engineering decisions myself, state them, and record them as "Lead" in DECISIONS.

**Reporting:**
- Say honestly what ran, what passed, and what wasn't verified.

**Installs:**
- Never install plugins, MCP servers or packages without the owner's go-ahead.

**Git and PRs:**
- Never push to `main` and never force-push.
- Every PR gets `gh pr merge --auto --squash`: it merges itself on green (owner, 2026-10-07; "Allow auto-merge" turned on with the owner's approval).
- Milestones are approved by looking at staging, and the next milestone waits for "approved".
- Held PRs get no auto-merge. PR #7 waits for "Access is on".

**Secrets:**
- Write a small PowerShell script with hidden input that checks the value and stores it (or puts it on the clipboard).
- The owner pastes back only its result line.
- Anything pasted into chat is treated as exposed and gets rotated.

**Data:**
- Never invent client data. A missing client input becomes a clearly named, flagged default only when the owner says so.

**Why:** these are the owner's standard rules from their other project, applied here on 2026-10-07.

**How to apply:** in every session. These are also hard rules in CLAUDE.md.

Related: [[model-effort-rule]], [[record-and-daily-sessions]]

**Auto-fix on every PR** (owner rule, 2026-10-08: "everything has to be automatic"):
- Right after `gh pr create`, or when first working on an existing PR, bind the PR (`ccd_pr` `get_status` / `bind_pr`) and turn on Auto-fix (`set_monitor`), held PRs included.
- Auto-fix never means auto-merge for a held PR.
- No app setting makes Auto-fix the default, so this is a per-PR step.
- Auto-fix wakes the session that turned it on, so tell the owner to archive (never delete) a session only after its PRs have merged. `set_monitor` `auto_archive_on_close` does the archiving automatically.

**Staging tests (2026-10-23):** when the owner says "do everything yourself", say plainly what the lead can't do (sign in with their password/authenticator or Cloudflare Access, complete Turnstile) and do the rest (read D1, logs, CPU). Guides must be complete: name the exact email/account for every step, the exact button labels, the order, and what each step should produce. Read the records before claiming a bug (an "alert missing" was a known browser / an invite sign-in, both correct).

**Tool scope (owner, 2026-11-04):** the owner wants only the tools this project uses to show in it. Unused plugins, connections and skills are off in the committed `.claude/settings.json` (docs/10); never turn one back on without the owner. An app-wide switch (like the Claude Docs connector) is the owner's call because it affects other projects (other projects on the PC use Supabase, Upstash and Sentry).
