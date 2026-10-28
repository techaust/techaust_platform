Status: open
Tier: A (it covers money, tax, auth, client scoping)
Usage:

# Full audit of M1–M5: review every milestone, fix every finding

**Owner's instruction (2026-10-29, night):**
- Review every milestone built so far thoroughly, fix the findings, and make everything 10/10 in every respect.
- The goal: everything up to M5 is complete and verified.
- **Opus 5.5 at high effort for everything in this task**: audits, reviews, fixes and re-checks.

This replaces the docs/14 split (Sonnet builders, medium-effort fixes and re-checks, a medium lead) for this task only. Recorded in docs/13.

## Scope: seven audit areas
Each area gets a fresh audit with no anchoring on earlier reviews: code, tests, the PRD IDs against docs/04, docs/05 to 08, and a visual pass where there are screens.

| Area | Milestones | What it covers | Auditor |
|---|---|---|---|
| A0 Data and money core | M1.x db, M3–M5 schema | `packages/db` (schema, every migration, triggers, seed, issue and freeze statements), `packages/core` (money, tax, invoices, notes, gst, statement, dates, numbering, permissions) | analyst, Opus high |
| A1 Foundation and security | M1.1–M1.6, M2.4b | monorepo, CI and deploy workflows (fork safety), guards and scripts, `packages/auth`, staff login and 2FA, portal magic links, Turnstile, CSP and headers, secrets handling, Cloudflare Access | reviewer, Opus high (code; `security-review` skill) |
| A2 Public website | M2.1–M2.5 | `apps/web`: pages, copy against docs/07, prices, forms, leads to the jobs queue, SEO, performance, accessibility, build guards | reviewer, Opus high (code and visual) |
| A3 Admin core | M3.1–M3.5 | shell, leads, clients and contacts, projects, files, catalogue and publishing, care plans and time, dashboard, export and anonymise | reviewer, Opus high (code and visual) |
| A4 Documents and portal | M4.1–M4.5 | templates, the tax engine wiring, proposals and estimates, PDFs, send and accept, the portal (offers, sign-in), emails | reviewer, Opus high (code and visual) |
| A5 Invoicing | M5.0–M5.5 | the admin Worker split, invoices, export, proforma, advance, notes, send and reminders, care billing, reports, realisation, statements, finance tiles | reviewer, Opus high (code and visual) |
| A6 Jobs and operations | all | `apps/jobs` (queues, crons, dead letters, idempotency), the 10 ms CPU budget, bundle ceilings, logs without personal data, runbooks | analyst, Opus high |

## Order and rules
1. **The M5 owner-fix task** ([m5-owner-fixes](m5-owner-fixes.md)) finishes first: review, fixes, PR, staging. Its builder started on Sonnet medium before this instruction and is left to finish; its review and every later fix round are Opus high.
2. **Audits run two at a time**, at most one of them using a browser. They start after the M5 fix merges, so they read the newest `main`.
3. **Triage:** every finding of every severity is fixed, except items the record already gives to a later milestone (M6+) or an owner input. Each one stays listed in the follow-ups with its reason.
4. **Fixes:** one fix task per area, or two areas when they touch different files. A builder (Opus high) does data, logic and API; a designer (Opus high) does screens. Tier A areas (A0, A1, A5) get an analyst early check before the screens.
5. **Re-check:** each fix gets a reviewer re-check (Opus high), then a PR. It merges itself once CI is green and goes to staging. One area merges at a time, in a planned order.
6. **Budget gate:** no new agent at ≥ 80 % of the 5-hour window; the next one waits for the reset. The gate never changes a model or an effort.
7. **Owner items:** new copy goes on one page of numbered lines with a recommendation. Decisions that are the owner's go to the owner. Neither is guessed.

## What "verified" can and can't mean here
- **The lead can verify:**
  - `pnpm check` and `pnpm test`;
  - builds, bundle and startup budgets;
  - local runs in the browser (all widths, both themes, axe);
  - CI;
  - staging deploys and the D1 state (read-only).
- **Only the owner or a real device can verify:**
  - anything behind the staging sign-in (Cloudflare Access);
  - real Browser Run PDFs;
  - real mail clients;
  - NVDA;
  - phones;
  - Safari and Firefox;
  - the staging CPU readings.

  Each audit lists these as **not verified**, never as passed.

## Findings
_(one section per area, copied in by the lead)_

## Handover
_(written at the end of each conversation)_
