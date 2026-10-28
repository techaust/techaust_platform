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

### A0 data and money core: analyst claude-opus-5-5/high, 2026-10-29 01:00–01:45 IST, on 6a260d3d
1. **High:** two test helpers take today as the UTC date while the server uses IST.
   - Where: `apps/admin/worker/test-notes.ts:62` and `note-research.test.ts:230-231`.
   - Effect: 6 tests (invoice-notes, note-research, reports-totals) fail every day from 00:00 to 05:29 IST, so CI is red about 23 % of the day. Proven at 01:22 IST.
   - Fix: use `todayIso()` (`test-invoice-types.ts:34`), and add a guard test against `toISOString().slice(0, 10)` in test helpers. **Goes into the M5 owner-fix round** (CI).
2. **Medium:** two series can print the same number in one FY (Rule 46(b)).
   - Where: `packages/core/src/schemas/settings.ts:290-300`; the unique index is on (`number_display`, `series`, `version`).
   - Fix: refuse a save where two series' formats clash (distinct prefixes), plus a partial unique index on `number_display` for invoice-family types (index-only migration).
3. **Medium, owner question (OPEN, 08-C RA-10):** an invoice the client has already opened in the portal can still be voided.
   - Where: `apps/admin/worker/invoices.ts:1168-1176`, `packages/core/src/invoices.ts:491`. The portal lists every frozen invoice at once (`apps/portal/worker/invoices.ts:27`) and records `viewed_at`.
   - Options: (a) a portal view also blocks the void (recommended); (b) the portal hides invoices until they are sent.
4. **Medium:** nothing in the database ties `balance_minor` to total − paid − credited. `paid_minor` and `balance_minor` are mutable after freeze, and `documents_ledger_bounds` checks only the bounds.
   - Fix: a new trigger on frozen invoice-family documents except credit notes: `paid_minor` ≥ 0 and `balance_minor` = max(0, total − paid − credited). Before M6.1.
5. **Low:** the e-invoice fields (`irn`, `ack_no`, `ack_date`, `signed_qr`) stay editable after issue, and no PDF renders the IRN QR (ADM-INV-14 partial).
   - Fix: make them set-once by re-creating `documents_frozen_update`. The QR block is a follow-up for when e-invoicing applies (OPEN: threshold).
6. **Low:** a full proposal or estimate series gives a generic 500, not `series_full` (`packages/db/src/issue.ts:119-128` has no max guard).
7. **Low:** tests read the clock once at module load and break across IST midnight or 1 April (`documents-send.test.ts:28`, `reports-totals.test.ts:56`, `dashboard-finance.test.ts:20`).
   - Fix: compute the value inside each test, or pin the clock (`vi.useFakeTimers({toFake:["Date"]})` at 12:00 IST, mid-month, mid-FY).
8. **Low:** the credit-note INR cap passes when a note's `total_inr_minor` is NULL on a USD parent (`triggers.ts:752-753`). Add a NULL guard by re-creating the trigger.
9. **Low:** the LUT-of-the-receipt-FY and the discount-after-sale (from 2026-11-01) rules have no trigger, only core and the freeze WHERE. Either add issue-time triggers or correct CLAUDE.md's "every layer". Lead: add the triggers.
10. **Low, docs:** docs/04 §9 lacks the rows for `invoices.ims`, `invoices.send` and `clients.careAutoIssue`.

**Partial requirements:**
- ADM-INV-14 (finding 5).
- ADM-SET-04 (finding 2).
- ADM-INV-02 and -09: the ledger identity (finding 4).

**Checked and correct:**
- No rebuild after 0006.
- Gap-free numbering in one batch; issue date, FY and FX day from one instant.
- The credit cap in four layers; the void rule all in SQL.
- Care billing day ≤ 28.
- Core: 1,755 tests; coverage 98.97 % statements, 98.05 % branches; the tax and gst 100 % gates pass.
- Settings defaults match 08-C.

**Not verified:**
- the full db, admin, jobs and portal suites;
- every CHECK constraint and the seed SQL line by line;
- the GST CSV formats;
- tax-engine rounding beyond `lines.ts`;
- the jobs IST-hour dispatch;
- whether finding 8 can actually happen.

**Lead's triage:**
- Finding 1 goes into the M5 owner-fix round.
- Findings 2 and 4–10 go into one A0 fix task (Tier A, migrations: index and triggers only).
- Finding 3 waits for the owner.

### A6 jobs and operations: analyst claude-opus-5-5/high, 2026-10-29 01:45–02:00 IST, on 38e2fe87
1. **High (not measured):** the new PDF integrity check inflates every Flate stream of 4 KB or more (`packages/pdf/src/integrity.ts:121`). A transparent PNG signature (2400×1200 allowed, `settings-signature.ts:26-27`) means megabytes of pixels to inflate in one invocation, so the consumer could be cut off and retried, then dead-lettered, and signed invoices would get no PDF. **Goes into the M5 owner-fix round 1:** an 8 KB threshold, an inflate budget with an accepted partial check and a log line, and the hash computed once. Later: downscale the signature at upload to at most 800×400 (A4/A5 fix), and record a staging `cpuTimeMs` reading for `pdf.rendered`.
2. **Medium:** documents that keep failing block the daily PDF sweep and use up Browser Run time (`pdf.ts:722-725`; dead letters ring only `pdf.failed`). Fix: count failures per document, stop sweeping it after N nights with a `pdf.refused` bell, and order the sweep by last attempt.
3. **Medium (latent):** jobs production inherits both crons (`apps/jobs/wrangler.jsonc:41`; `triggers` is inheritable). The guard `check-worker-config.mjs:124` requires it to be absent. Fix: `"triggers": {"crons": []}` in `env.production`, and make the guard require an empty array.
4. **Medium:** an email outage of a few minutes fails emails for good (`queue.ts:215` retries after a fixed 30 s, the catch-all `:232`, `max_retries` 5). Fix: exponential backoff from 60 s to 1 h, `max_retries` about 10, and optionally one re-drive from the DLQ. The 8 s SES timeout can send twice: at-least-once delivery is accepted.
5. **Low:** the PDF is hashed twice (fix round 1 covers it).
6. **Low:** the daily cron reads D1 (`purge.ts:37`), though `index.ts:28` says it doesn't. Move that read into a queued message, or correct the comment.
7. **Low:** the care scan (06:00 IST) and `alerts.daily` (09:00 IST) run on a single tick each. Repeat both at the next two hours: both are idempotent.
8. **Low, owner's yes (workflow change):** the deploy order (admin API, then jobs) rests on alphabetical order. Fix: explicit steps, plus a `/healthz` smoke check after each.
9. **Low:** no queue-consumer CPU readings in `cpu-baseline.md`; no Traces. Enabling Traces is the owner's choice.
10. **Low, docs:** `environments.md` is stale (R2 "Not created yet", no Browser Run, no crons, no `ADMIN_JOBS`, "four Workers"). `ses-and-turnstile.md` has no step-by-step for the 90-day key rotation. Backup and restore, incident and secret-rotation runbooks are due in M7.5 and L7.
- **Missing or partial, and when it's due:**
  - JOB-Q-01 / docs/05 §11.2: dead letters in an admin "Needs review" list (`review_items`) do not exist and nothing schedules them. Lead: M6.1, since ADM-PAY-07 needs it too.
  - JOB-CRON-01: session, token and log clean-up and the D1 usage check are due in M7.4.
  - JOB-PDF-01: the 20-PDF burst is not proven on staging.
  - Not yet due: JOB-CRON-03 (M7.2), JOB-BKP-01 (L7), JOB-HOOK-01–03 (M6).
- **Headroom on the Free plan, estimated:**
  - Queues: about 1,000 operations a day out of 10,000.
  - Browser Run: about 250 renders a month; a care-billing day takes 80–200 s of the 600 s daily allowance.
  - D1: well within limits.
  - R2: about 9 years to 10 GB.
  - The jobs bundle will likely pass its ceiling in M6: plan a webhook Worker before M6.2.
- **Logs:** clean of personal data.
- **Not verified:**
  - the structure of real Browser Run PDFs;
  - the check's CPU on real PDFs;
  - whether queue consumers really have 10 ms or 30 s of CPU;
  - the deployed state of the hosted services;
  - pnpm's ordering guarantee.

**Lead's triage:**
- 1 and 5 go into the M5 owner-fix round 1.
- 2, 3, 4, 6, 7 and 10 go into an A6 fix task.
- 8 waits for the owner's yes.
- 9: the runbook part goes into the A6 task; Traces is the owner's choice.
- The `review_items` gap goes to M6.1.

### A1 foundation and security: reviewer claude-opus-5-5/high, 2026-10-29 ~02:00–02:40 IST, on bb6f3b5b: SEND BACK
Tests run: auth 135/135, admin auth-related 1,683/1,683, portal auth and scope 421/421.
1. **High:** the portal's pages have no security headers.
   - Where: `apps/portal/public/_headers` has never existed, and the Worker runs only for `/api/*`.
   - Missing: CSP, `frame-ancestors`, HSTS, nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP and `X-Robots-Tag`. So Accept and Continue can be framed, and any future XSS has no CSP behind it.
   - Fix: a `_headers` file modelled on admin's, plus a build guard that every SPA's `dist/client/_headers` holds the docs/08 §3.1 set.
2. **Medium:** no `Cross-Origin-Resource-Policy: same-site` on static files (`apps/admin/public/_headers`, `apps/web/public/_headers`).
3. **Medium, owner's yes (workflow):** no dependency audit in CI (docs/08 §3.5).
4. **Low:** the admin and portal API secure-headers use Hono's defaults: HSTS of 180 days, not 1 year, and no Permissions-Policy (`apps/admin/worker/app.ts:33`, `apps/portal/worker/index.ts:44`). Fix: explicit options, as web does.
5. **Low, owner's yes (workflow):** `vite build` and `astro build` run in the same step as `CLOUDFLARE_API_TOKEN` (`deploy-staging.yml:78-82`, `publish-catalogue.yml`). Fix: split build and deploy. Also, `renovate.json` automerges devDependency patches (latent).
6. **Low:** `check-prod-readiness.mjs` covers the website only. Add: `[Placeholder` in the admin and portal bundles, empty production `TURNSTILE_SITE_KEY`s, and missing production queues (before Phase 7).
7. **Low (tooling):** `tools/model-guard.mjs:31` doesn't refuse an Agent call with no `subagent_type`.

**Checked and correct:**
- staff sign-in end to end (Argon2id, pepper, fake salts, gated reserve, TOTP replay, recovery, `__Host-` cookies, expiries, step-up, revocation, last-owner rule, invites);
- the guard against docs/04 §9; the API Worker has no URL and re-runs CSRF and the guard;
- portal client scoping (`forClient`); tokens only in request bodies;
- the website forms' order of checks; HMAC'd addresses only;
- no secret committed;
- CI fork-safe, SHA-pinned, least privilege; the production deploy guarded;
- release-age and build allow-lists set.

**Missing or partial:**
- docs/08 §3.1: findings 1, 2 and 4.
- docs/08 §3.5: finding 3.
- docs/08 §3.4: access-log retention (M7.4).
- 08-C RB-12 OPEN: whether IP and user agent may stay in the audit log for its 10 years (VERIFY WITH CA/LEGAL; a CA question).

**Not verified:**
- Access on staging, and the headers staging actually serves;
- the hosted secrets and Turnstile hostname lists;
- branch protection and the production environment's reviewers;
- Safari and Firefox SameSite behaviour;
- the full admin, portal and web suites.

**Lead's triage:**
- 1, 2, 4, 6 and 7 go into an A1 fix task.
- 3 and 5 wait for the owner's yes.

## Handover
_(written at the end of each conversation)_
