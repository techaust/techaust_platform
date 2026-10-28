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

### A2 public website: reviewer claude-opus-5-5/high, 2026-10-29 ~02:45–03:30 IST, on 937e86d6: SEND BACK
**Ran:**
- web build and dist checks: ok;
- unit tests 443/443; e2e 101/101; content lint ok;
- a sweep of 37 pages × 4 widths × 2 themes with axe, overflow, targets and text size;
- forms end to end to `LEADS_QUEUE` locally.

Shots: `.logs/shots/a2-web/` (main checkout).

**Findings:**
1. **High:** on /security at 375 px, the security.txt `<pre>` scrolls but can't take keyboard focus (WCAG 2.1.1).
   - Where: `apps/web/src/pages/security.astro:17`, `Prose.astro:94`.
   - Fix: wrap the text.
   - Also: axe runs at one width only in e2e. Add 375.
2. **Medium:** `deploy:staging` (also used by `publish-catalogue.yml`) never runs `check-web-dist.mjs`, so the admin-typed catalogue text served on staging is unguarded.
   - Fix: run the dist check before the deploy, and refuse "&" and banned phrases at publish (`apps/admin/worker/catalogue.ts`).
3. **Medium:** the quote endpoint checks codes against the seed catalogue, not the published snapshot (`service-visibility.ts:16-20`, `forms.ts:220`). This is the open M2.4 follow-up.
   - Fix: build the list from the snapshot at build time, plus a parity test.
4. **Medium:** WEB-G-10 is partial. `Organization` lacks `alternateName`, `areaServed`, `naics` and `disambiguatingDescription`. The wording is already in docs/04 (`structured-data.ts:44-57`).
5. **Low:** duplicate landmark names on /pricing, the legal pages and /security. Let the e2e test fail on moderate issues too.
6. **Low:** straight apostrophes in /thanks, the quote hints and the 404 page (`content/forms.ts:64-108`, `shell.ts:142`).
7. **Low:** prose notes are set at 14 px (`Notice.astro:36`); body text must be at least 16 px.
8. **Low:** the CLS test asserts ≤ 0.05; WEB-G-06 says < 0.01.
9. **Low:** the rate-limiter path is never exercised (it errors locally and lets the request through). Add a mocked-limiter unit test.
10. **Low:** 11–13 render-blocking CSS files per page. Fix: one site stylesheet.
11. **Low, owner's copy:** /work shows its lede above an empty state. Suggestion: hide it until there is a case study.
12. **Low, Phase 7:** `/about.html` and `/about/` redirect with 307. Use permanent redirect rules.
13. **Low:** the founder photo uses a plain `<img>`. Switch to `astro:assets` before it arrives (WEB-G-13).
14. **Low:** the footer's first rows are about 6 px out of line at 768 and 1280 (`SiteFooter.astro`).

**Owner inputs, not defects:** headshot and bio; LinkedIn, WhatsApp and Cal.com; case studies; blog drafts; the Turnstile-can't-load line; aliases; launch dates; noindex; backup; Publish on staging; missing 07 sections for S2, S7, S10, S11, S13, S14 and S16.

**Checked and correct:**
- copy word for word on 12 pages;
- prices only from the catalogue, "+ GST", S11 USD on request;
- no "&", no banned phrases, arrows as icons;
- logos generated and following the theme;
- forced colours and reduced motion;
- titles, descriptions, canonicals and OG images;
- sitemap and robots; S3 is a 404.

**Not verified:**
- Lighthouse;
- staging and the served headers;
- the real `/api/geo` and real Turnstile;
- the jobs consumer;
- Safari, Firefox, NVDA, phones;
- Google's Rich Results test.

**Lead's triage:**
- 1–10, 13 and 14 go into an A2 fix task (the designer does the screens; the builder does 2, 3, 4 and 9).
- 11 goes on the owner's copy page.
- 12 is Phase 7.

### A3 admin core: reviewer claude-opus-5-5/high, 2026-10-29 ~02:35–03:15 IST, on 1b788a85: SEND BACK
**Ran:**
- 20 A3 worker test files, 1,609/1,609 passed;
- a functional pass: enrolment and TOTP sign-in, a Sales member, a lead converted to client, a project, a note, a care plan, time logs, the day cap, a stale save, a fake PDF refused, and every route the Sales role must not reach;
- a visual pass with axe, overflow, targets and text size.

Shots: `.logs/shots/a3-admin/` (main checkout).

**Findings:**
1. **High:** tables that scroll sideways can't be scrolled by keyboard (WCAG 2.1.1).
   - Where: the timesheet's `.sheet-wrap` (`time.tsx:373`, `care.css:456`) at 768 and 1024, and `DataTable`'s `.dtable` (`data-table.tsx:56`) when it overflows.
   - Fix: `tabIndex=0`, `role=region`, an `aria-label` and a focus style; axe at 768 and 1024 in e2e.
2. **Medium:** the whole page scrolls sideways at 1024 on /time.
   - Cause: `.visually-hidden` (`app.css:88`) escapes the overflow clip.
   - Fix: `position: relative` on every overflow wrapper, plus a sweep test that `scrollWidth` ≤ `clientWidth` at 768 and 1024.
3. **Medium:** the Entries "Note" column breaks words letter by letter at 1024 (`care.css:600-604`).
4. **Medium, ADM-CLI-03 partial:** the client Overview shows no billed, overdue or balance figures (`clients.ts:790` answers `{available:false}`), though they can be computed from frozen invoices now. "Collected" waits for M6.
5. **Medium, ADM-PRJ-05 partial:** the project's Figures panel shows hours only (`projects.ts:406-408`). Billed can be shown now; paid comes in M6.
6. **Medium (one-line):** the debug line "Password hashing took N ms" is still on the sign-in code step (`sign-in.tsx:272-275`); docs/13 of 2026-10-21 said it would go in M3.1.
7. **Low:** note Markdown leaves headings as literal text (ADM-PRJ-03 says "rich text"). Lead: support `#`–`###` in `@techaust/core/markdown`.
8. **Low, ADM-LEAD-01 partial:** a manual lead has no budget band, timeline or currency (the labels exist in core).
9. **Low, ADM-LEAD-04:** conversion stays on the lead instead of opening the draft proposal. Fix: open the draft (no new copy needed).
10. **Low:** the dashboard's Projects tile leaves out Planned projects, and a date-only next action prints with "23:59 IST".
11. **Low, owner's copy:** the dashboard's foot line repeats itself. Suggestion: "Collected figures and payments waiting for checks arrive with payments."
12. **Low:** the Convert dialog defaults the country to India when the lead gave none. Fix: require a choice.
13. **Low:** staff sign-in has no "Show password" toggle, while enrolment has one.

**Checked and correct:**
- every route in `ROUTES`; the Sales boundaries in the API and the UI;
- search escapes `LIKE`;
- the upload path (cap, sniffing, `FixedLengthStream`, R2 SHA-256, the object removed when the row fails);
- download headers;
- anonymised clients: notes and files deleted, writes locked;
- audit summaries hold ids only; the note renderer sets no HTML;
- milestone invoiced and paid can't be set by hand;
- focus, skip link, 44 px targets, reduced-motion CSS, the logo.

**Not verified:**
- staging and the publish workflow end to end;
- a real 25 MB R2 upload and an upload through the UI;
- the Accountant role signed in;
- the catalogue and template editors, export, erase and care status in the UI (the tests cover them);
- NVDA, Safari, Firefox, phones;
- 768 and 1600 for care, catalogue, settings, users, account and audit;
- dark theme at 1024. Many Playwright shots caught loading frames.

**Lead's triage:**
- 1–10, 12 and 13 go into an A3 fix task (the builder does 4, 5, 7, 8 and 10; the designer does the screens).
- 11 goes on the owner's copy page.
- A re-check covers the screens and widths not checked here.

### A4 documents and portal: reviewer claude-opus-5-5/high, 2026-10-29 ~03:15–03:40 IST, on bf7e7e8f: APPROVE (no critical or high)
**Ran:**
- tests: portal 620, pdf 333, email 128, admin documents, links, offers and approvals 236, jobs offers, pdf and layout gate 118: all pass;
- locally: a proposal sent to 2 contacts and frozen; the portal accept (with a Bengali name), the error summary, a decline, the record, invoices, the ended link and the email previews, at 4 widths in both themes; axe clean except one moderate `region` item.

Shots: `.logs/shots/a4-docs/` (main checkout).

**Findings:**
1. **Medium:** the first click after correcting the name is lost: the error line is removed on blur and the form shifts (`apps/portal/src/components/decision/decision-panel.tsx:263-265`). Fix: keep the error's space or clear it on input; add an e2e test.
2. **Medium:** the document number breaks mid-number in the accept dialog at 375 (`portal.css:1158`). Fix: no-wrap the number; consider a sticky dialog footer.
3. **Medium:** no Bengali or Devanagari font is embedded in the PDFs (`packages/pdf/src/generated/assets.ts`). The certificate prints the typed name. Fix: OFL Noto Sans Bengali and Devanagari subsets as fallbacks, plus a layout-gate test with an Indic name.
4. **Medium, owner's copy (also for the CA and lawyer):** the terms say "our own pre-existing tools, which we list in this proposal", but no proposal has such a list (`packages/db/src/seed/terms.ts:12`). Owner's choice: add a section, or reword the line.
5. **Low (one-line):** "has Approved your request" has a capital letter mid-sentence (`packages/email/src/offers.ts:171`).
6. **Low, owner's copy:** estimates are worded as proposals in three places: the binding sentence, the confirmation email (`offers.ts:89`), and a sentence that repeats the accept notice.
7. **Low:** the Acceptance section still says "Accept this offer…" after a decision. Hide it once decided.
8. **Low:** the agreement checkbox's own hit area is 22 px. Make the whole row the label.
9. **Low:** when the newest version is frozen but not yet rendered, an accept on the old version is refused as `superseded` and leads to a 404 (`offer-sql.ts:94,116`). Fix: point to the newest rendered version, or say "A new version is being prepared".
10. **Low:** the portal sample home lists one item twice (preview data). The "Send to" item belongs to the M5 fix.

**Lead's addition (grep):** 29 bare `VERIFY WITH CA/LEGAL` tags remain in code comments (for example `apps/admin/src/routes/clients/data-tools.tsx:2`, `settings/terms.tsx:1`, `reports/sales-register.tsx:1`). That breaks the 2026-10-28 rule ("Researched <date>, <source> (08-C <ID>)" or "OPEN (08-C <ID>): <question>"). Fix: retag each one against 08-C.

**Requirements:**
- ADM-PROP-07/08/10, POR-01/02/03/05 and POR-06 (read side): met.
- JOB-PDF-01: partial (Indic glyphs; the 20-PDF burst).
- POR-04, 07–09 and 11 are M7.1.

**Not verified:** rendered PDFs, the certificate and the emails from jobs (memory was too low to run jobs), real mail clients, Browser Run fonts, NVDA, Safari and Firefox, phones, staging.

**Lead's triage:**
- 1–3, 5 and 7–9 and the VERIFY retagging go into an A4 fix task.
- 4 and 6 go on the owner's copy page.

## Fix plan (lead, 2026-10-29 03:45 IST)
- **Order:** the M5 owner-fix PR merges first. Then each fix task branches from the newest `main`, so each area merges in turn, and migrations land in this order.
- **Agents:** every builder, designer, analyst and reviewer runs on Opus high.
- **No overlap:** two parallel tasks never touch the same files.

| Task | Findings | Tier | Who | Files (main) |
|---|---|---|---|---|
| **FX-1 data and jobs** | A0 2, 4, 5, 6, 8, 9, 10; A6 2, 3, 4, 6, 7, 10 | A (migrations: an index and triggers only; the analyst's early check) | builder | `packages/db`, `packages/core` (settings schema, invoices), `apps/jobs`, `apps/*/wrangler.jsonc`, `scripts/check-worker-config.mjs`, `docs/04` §9, `docs/runbooks` |
| **FX-2 security and website** | A1 1, 2, 4, 6, 7; A2 1–10, 13, 14 | B | builder (A1, A2 2, 3, 4, 9) then designer (A2 screens) | the `public/_headers` files of all three apps (portal's is new), the header setup in `apps/{admin,portal}/worker/{app,index}.ts`, `scripts/check-prod-readiness.mjs`, a new SPA headers guard, `tools/model-guard.mjs`, `apps/web/**`, `apps/admin/worker/catalogue.ts` (publish text guard) |
| **FX-3 admin and portal** | A3 1–10, 12, 13; A4 1–3, 5, 7–9; retagging the bare VERIFY tags; A6 1c (signature downscaled to ≤ 800×400 at upload) | B | builder (A3 4, 5, 7, 8, 10; A4 3, 5, 9; signature) then designer (A3 1–3, 6, 9, 12, 13; A4 1, 2, 7, 8) | `apps/admin/src/**`, `apps/admin/worker/{clients,projects,dashboard,leads,settings-signature}.ts`, `apps/portal/src/**`, `apps/portal/worker/offer-sql.ts`, `packages/pdf` (fonts), `packages/email/src/offers.ts`, `packages/core/src/markdown*` |
| **FX-4 invoicing** | A5 (after its audit) | A | builder then designer | as A5 finds |

- **Shared files:**
  - FX-2 touches only admin's `public/_headers`, `worker/app.ts` and `worker/catalogue.ts`, not its `src`.
  - FX-1 and FX-3 both touch `packages/core`, but different files: FX-1 has `schemas/settings.ts` and `invoices.ts`, FX-3 has `markdown`.
- **Owner's copy page (07-Y, one page):**
  - A2 11: the /work lede;
  - A3 11: the dashboard foot line;
  - A4 4: the pre-existing tools line in the terms (also for the CA and lawyer);
  - A4 6: three places where estimates are worded as proposals;
  - plus every new line the fixes need.
- **Owner's yes (workflow changes):**
  - A1 3: a dependency audit in CI;
  - A1 5: separate the build and deploy steps;
  - A6 8: explicit deploy order plus `/healthz` smoke checks;
  - A6 9: Traces.
- **Owner's question:** A0 3, voiding an invoice the client has already viewed.
- **Re-check:** after the fix tasks, a final sweep by a reviewer at all widths and in both themes, covering the screens A3 left out.

## Handover
_(written at the end of each conversation)_
