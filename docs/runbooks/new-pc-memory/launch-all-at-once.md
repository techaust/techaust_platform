---
name: launch-all-at-once
description: "Owner 2026-10-31: website, admin, portal and payments go live together after M6, M7 and Phase 7; no early website cut-over; estimate 12-17 working days"
metadata:
  node_type: memory
  type: project
  originSessionId: 8ef25ec5-2dc3-460d-89af-56bef31c979f
  modified: 2026-11-03T10:49:48.626Z
---

On 2026-10-31 the owner asked to go live on the domain now, was shown the options (website first, recommended, vs all at once), and chose **all at once**. techaust.com stays on the old `techaust-web` until Phase 7 L8; then the website, admin, portal and payments switch together. Recorded in docs/13, docs/09 (after the dependency view) and CLAUDE.md hard rule 4.

The lead's estimate given to the owner: about 12–17 working days (3–4 weeks), from this project's pace (M5's six milestones took 2 days plus 2 days of audit). The estimate excludes the gateways' live approval (Razorpay may want the legal pages live on techaust.com first, so that part may finish just after launch day).

**2026-11-03 (owner): no fallback.** At L8 the old `techaust-web` Worker (routes, custom domains) is **deleted first**, then techaust.com is attached to the new `web` Worker; nothing old stays live (owner chose "delete before the move" over "right after checks"). Rollback is only the new Worker's previous version or a fix forward. The old site's source folder on the PC stays untouched (hard rule 3). PR #169 updated 09 L8, CLAUDE.md rule 4, 08 §6.3, environments runbook, 13.

**Why:** the owner wants one launch, not a partial one.
**How to apply:** don't propose an early website cut-over again (decided). Push the owner's long-wait tasks early: SES production access, the AWS backup bucket (and the T5 bucket), the gateway accounts and test keys, the website inputs (headshot, bio facts, aliases incl. security@ and privacy@, launch date). Postal address and founder LinkedIn were already added (#57, #58, 2026-10-23).

Related: [[research-tasks-state]], [[working-with-owner]], [[techaust-rebuild-project]]
