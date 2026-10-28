# 12: Status

_Replaced (never appended) at the end of every session. Last updated: **2026-10-28, 13:30** (IST)._

## Done
- **Phases 1–5, M1 (foundation), M2 (public website), M3.1–M3.5, M4.1–M4.5:** all approved by the owner (latest: the M3.4–M4.5 batch, 2026-10-26, PR #93). Details live in the run files under [runs/](runs/) and in [13-decisions.md](13-decisions.md).
- **Working rules:** the three-model plan ([14-models-and-usage.md](14-models-and-usage.md)); Team plan gate (5-hour window only; no new agent at ≥ 80 %; lifted by the owner for the rest of M5 only); skills mandatory; Cloudflare Access on every staging Worker.
- **The M5 batch is complete: M5.0 to M5.5 are built, reviewed and on staging** (owner: one batch while away, their calls built as flagged defaults on one question page; [batch run file](runs/m5-batch.md)). Every milestone went brief → builder → early check → designer → review → fixes → re-check → PR; every critical, high and medium finding was fixed in its task.
  - **M5.0 admin Worker split** ([PR #95](https://github.com/techaust/techaust_platform/pull/95); [run file](runs/m5.0-admin-split.md)): the front Worker forwards every other `/api` route to `techaust-platform-admin-api(-staging)` (no URL, no secrets). **Not yet checked by the owner.**
  - **M5.1 tax invoices** ([PR #96](https://github.com/techaust/techaust_platform/pull/96); [run file](runs/m5.1-invoices.md)): gap-free numbers per series and FY in one D1 batch, Owner issue with step-up, Staff request (approve = issue), void, sealed snapshot, the invoice PDF. Migrations 0037–0038.
  - **M5.2 export invoices, proformas, advances** ([PR #97](https://github.com/techaust/techaust_platform/pull/97); [run file](runs/m5.2-invoice-types.md)): LUT and IGST exports with the frozen endorsement and FX, proformas, the tax invoice for a payment received, the mandatory-field checklist, the LUT list. Migrations 0039–0040.
  - **M5.3 credit and debit notes** ([PR #99](https://github.com/techaust/techaust_platform/pull/99); [run file](runs/m5.3-credit-debit-notes.md)): notes against an issued invoice with the credit cap held in four places, the 30 November deadline from settings, IMS answers (Owner), note PDFs with the parent number. Migrations 0041–0042.
  - **M5.4 send, reminders, recurring care invoices** ([PR #100](https://github.com/techaust/techaust_platform/pull/100); [run file](runs/m5.4-send-recurring-reminders.md)): invoice emails and links to finance contacts, automatic reminders, monthly care-plan drafts (auto-issue only with an owner's toggle), daily alerts, the portal's invoice pages; a second cron (hourly). Migrations 0043–0044.
  - **M5.5 GST and CA exports, realisation, EDF, statements, finance tiles** ([PR #101](https://github.com/techaust/techaust_platform/pull/101); run files [5.5a](runs/m5.5a-gst-core.md), [5.5b](runs/m5.5b-exports-statement.md)): GSTR-1, Table 13, sales register, output tax and 3B summary as CSV built in the browser; export realisation stages and alerts; EDF reminders; the client statement with a cached PDF; dashboard finance tiles. Migration 0045.
- **Verified 2026-10-28:** the whole-repo `pnpm check` passes; `pnpm test` passes in every package (auth 135, core 1,718, ui 469, email 128, db 444, pdf 302, web 423, portal 620, jobs 498, admin 3,112 of 3,113: one M5.4 test timed out under load and passes 22 of 22 alone); CI green; the staging deploy of #101 succeeded first time. Staging, read-only (Cloudflare analytics, 4 hours after the deploy): the jobs Worker ran 8 times with 0 errors, CPU p50 1.7 ms, p99 4.6 ms; the admin and portal Workers had no traffic. Bundles: admin API 576,894 bytes (third Worker planned at 650,000), front 98,743, jobs 844,916 (limit 1,000,000).

## In progress
- Nothing is being built. No agent is running.

## Next (when work resumes)
1. **The owner reviews the M5 batch on staging** with the "Owner review pack (2026-10-28)" in the [batch run file](runs/m5-batch.md): the plain-words summary, questions Q1–Q71 (each built with its recommended default) and the copy drafts 07-R, 07-S, 07-T, 07-U, 07-V word for word.
2. **The lead collects every finding first, then one fix task** (a reviewer UI/UX sweep of every affected screen first, owner rule 2026-10-26); approved copy replaces `[Placeholder]`; then the owner's "approved".
3. **Staging readings** once someone signs in to staging (`cpuTimeMs`, front + API ≤ 7 ms): invoice issue at 1 and 100 lines, export, proforma, advance, note issue, send, `/dashboard`, a register page, `realisation.scan`, `pdf.statement`, `care.bill`, `care.issue`, `reminder.send`; plus the M4.x readings still open. The lead can't sign in through Cloudflare Access, so these follow the owner's M5.0 check.
4. **After approval: M6.1** (payments, sandbox only). The 80 % usage gate applies again.

**Usage now:** 5-hour window 1 %. Gate: no new agent at ≥ 80 %; two agents at once, one browser agent.

## Waits on the owner
- **M5.0 staging check (6 steps, about 5 minutes):** sign in to the staging admin; open Dashboard, Leads and a lead; open a client, a proposal and its PDF; in a project, upload and download a file; save one Settings page; sign out. Then tell the lead "done".
- **The M5 batch review:** 71 questions on the [batch page](runs/m5-batch.md) (tax and legal ones VERIFY WITH CA/LEGAL); copy [07-R](07-content-appendix/R-m5.1-invoice-screens.md), [07-S](07-content-appendix/S-m5.2-invoice-types.md), [07-T](07-content-appendix/T-m5.3-credit-debit-notes.md), [07-U](07-content-appendix/U-m5.4-send-recurring-reminders.md), [07-V](07-content-appendix/V-m5.5b-reports-statements.md). Until 07-U is approved, care invoices are only drafted on staging (no automatic issue).
- **Facts to know for the review:** the hourly job runs care billing and reminders on staging (emails only to the staging allow-list); until M6 records payments, an export paid by bank transfer looks unpaid, so realisation alerts fire for it on staging (Q70).
- **Staging data for invoicing:** the real company profile (legal name, GSTIN, address) and clearly labelled sample bank details in staging Settings (Q21); the LUT ARN for FY 2026-27 when filed (U-1; LUT export invoices are blocked until then).
- **Zoho:** confirm the `billing@` alias exists (invoice emails and statements); also `hello` and `no-reply` (they clear Zoho's "Sender couldn't be verified" warning).
- **For the CA or lawyer (VERIFY WITH CA/LEGAL), collected at the batch review:** every M5 tax and invoicing default on the batch page; proposal terms v1's "GST at 18 %" line; anonymising a client deletes its document bells; drafts of a client anonymised later; client-written lead text; signature retention; accept-by-link evidence and the certificate's IP, browser and country; the first-instalment invoice type and place of supply; keeping the decline note.
- **Catalogue › Publish on staging** (if not done yet), so the website shows the six service names with "and".
- **When TecHaust's AWS is needed (Phase 7):** sign the AWS MCP in to the TecHaust account (the lead gives steps).
- **For the website:** a new headshot; bio facts; the company LinkedIn page URL; WhatsApp Business number, Cal.com link, 2–3 case-study briefs, one social handle per platform; the 3 blog drafts ([07-E](07-content-appendix/E-blog-drafts.md)); the postal address against the GST certificate (VERIFY WITH CA/LEGAL); one line for when the "I'm human" check can't load; before production, the security@ and privacy@ aliases (U-5) and "encrypted off-site backups" on /security.
- **SES key rotation:** the staging IAM key `techaust-ses-sender-staging` by **2027-01-21**.
- **Time-sensitive compliance** ([08 §0](08-security-compliance.md); all VERIFY WITH CA): U-3 UPI MDR from 15 Oct 2026; U-1 the LUT; U-2 FEMA EDF filing; U-9 GST rules after the 57th GST Council.
- **Not blocking:** upload the social kit; "since 2019" against the GST registration date (VERIFY WITH CA); wallpapers; Renovate; trademark search (VERIFY WITH LEGAL); printed brand proof and Pantone; business-card phone number; Argon2id timing on a phone; U-6 and U-7.
- **Model menu:** keep **Opus 5.5, medium** for every conversation.

## Open follow-ups
- **M5 (2026-10-28, run files):**
  - a longer timeout for the M5.4 test "each send names the staff member…" in `apps/admin/worker/invoice-send.test.ts` (times out under a full parallel run);
  - export the realisation bounds (1,200 / 36,500) from core instead of three copies (M5.5b re-check low 4);
  - check the code-review helper's 10 M5.4 candidates (it reviewed `main` by mistake) against `main`;
  - the deploy workflow doesn't enforce "admin API before jobs" (a workflow change: owner's yes);
  - a CI job for Linux PDF visual baselines (workflow change: owner's yes);
  - FEMA extensions (M6.1, Q60); refunds, the payment register and "collected" figures (M6);
  - the admin API is at 576,894 bytes: plan the third admin Worker before it passes 650,000 (likely during M6);
  - not verified for M5: staging CPU of the admin routes (no traffic yet), a real Browser Run render of the invoice, note and statement PDFs, `Intl.DisplayNames` on the deployed runtime, NVDA, real mail clients for the invoice and statement emails.
- **Batch review fixes (2026-10-26, [run file](runs/batch-review-fixes.md)):** not verified: NVDA on the new date field and its button names, the native calendar popup; the staging rename reported 7 changes for 6 rows (likely a trigger; not checked).
- **M4.5 (2026-10-26, [run file](runs/m4.5-send-accept.md)):** refill `{{client.contact}}` when a draft's contact changes; one shared list of the 07-N §3 decline reasons in `@techaust/core` (now in admin, portal and jobs); an optional "record Viewed only after a real interaction"; not verified: real mail clients, the certificate on Browser Run (Bengali and Hindi names may fall back to a system font), NVDA, the date-field focus ring in Firefox and Safari.
- **M4.4 (run file):** fold the anonymised check into `mutate`'s condition; one shared "client gone" SQL helper.
- **2026-10-26 (run files):** a rule for the PDF of an anonymised client (VERIFY WITH CA/LEGAL); the data export returns the raw recipient JSON to the person it names (flag for CA/LEGAL); an underscore inside a word becomes italics in core's Markdown; the seeded estimate templates repeat the estimate notice; a CI job for the pdf visual suite so `linux/` baselines exist (workflow change, owner's yes); a `useTemplate` lint info in `apps/web/src/lib/catalogue.ts`.
- **Batch 2026-10-26 (run files):**
  - **M4.3:**
    - sparse positions so a structural edit writes one row;
    - a search parameter on `GET /documents` (M7.3);
    - DELETE of an old-dated time entry is owner-only too;
  - **M3.2:** stale checks on leads with a strictly increasing `updated_at` (a same-millisecond flake in `leads-api.test.ts`);
  - **M4.5:**
    - the automatic "Start project" setting;
    - a set-once `confirmation_queued_at` if staging shows a lost confirmation (M7.2);
    - the local `.dev.vars` copied into a portal `dist` (build guard);
  - **the boot "Loading…" logo** in light mode on a dark OS;
  - **M3.5 notes from a helper (unverified):** the export has no time-log part; `hasAllowance` on the billing day.
- **Batch (run files):** M3.4: a counter row for project codes; triggers backing the anonymised lock (M7.4); portal routes for shared notes and files (M7.1); orphaned R2 objects (M7.4); M4.1: one shared first-word helper; website-form leads refuse retired codes; the "Show on website" description wording (owner, 07-L). M4.2: `ROUND_OFF_BAND` kept a constant. M3.5 (on its branch): billed-period freeze, `last_billed_period`, terms per period from history (M5.4); export of time-log notes and `stats_daily` retention (VERIFY WITH CA/LEGAL). A local portal build copies `.dev.vars` into `dist` (local only; add a build guard).
- **M3.3 ([run file](runs/m3.3-clients.md)):** scope client-tied email kinds explicitly in the export when M4 adds them (VERIFY WITH CA/LEGAL); jobs skip a queued magic-link email whose token was deleted; the 0022 backfill folds ASCII case only; a component test for "Show more contacts".
- **M3.2 ([run file](runs/m3.2-leads.md)):** the `lead.reply` email restyled with the M4 email set; `email_log` rows of purged leads removed by M7.4's age job; the bundle's structural plan before M3.4.
- **M3.1 ([run file](runs/m3.1-admin-shell.md)):** senders reading the stored Settings › Email values (M5.4); bell-row erasure and pruning (M7.4); gateway secret names and a live gateway reverting when the go-live flag is turned off (Phase 7); optional audit export id (L-c); a lost bank-save response gives a false 409 (reloading recovers); remove the "hashing took N ms" line after the owner's phone timing check.
- **M2.5 ([run file](runs/m2.5-seo-perf-a11y.md)):** `zod/mini` on `/contact` and `/get-a-quote` (≈ 20 KB gzipped); not verified: Google's Rich Results validator, real LinkedIn/WhatsApp previews, Safari/Firefox.
- **M2.4b ([run file](runs/m2.4b-signin-email.md) "Re-check", "Handover"):** **Phase 7 checklist:** production `EMAIL_QUEUE` for admin and portal, the production Turnstile widget, fail the production SPA build on an empty `TURNSTILE_SITE_KEY` (via `check-prod-readiness.mjs`); product question "correct password, code never completed: alert?"; `/totp` and `/recovery` build the lockout alert before verifying (kept, rare and true); the React Turnstile wrapper is duplicated in admin and portal (share it when a third screen needs it); the break-glass CLI reset sends no email (prints a reminder); real mail clients beyond Zoho.
- **M2.4 ([run file](runs/m2.4-forms-leads-email.md)):** the Worker reads the seed catalogue while the pages read the snapshot (M4.1); retention for `email_log`, the `f:` counters and a D1 `dead_letters` row (retention job, VERIFY WITH CA/LEGAL); the "your time" line outside IST; a screen reader on the form pages (owner's NVDA pass; Lighthouse done in M2.5).
- **M2.3 ([run file](runs/m2.3-other-pages.md)):** renew `securityTxtExpires` before **2027-10-22**; before production set `site.launchDate` and every legal `effective` to the launch day; not verified: Safari/Firefox, forced colours, a screen reader, GA-on legal pages, the `deploy-prod.yml` run.
- **M2.1 ([run file](runs/m2.1-site-shell.md)):** remove `X-Robots-Tag: noindex` before production; legacy JS MIME types in the inline-script check; header-check host allow-list; WhatsApp `?text=` prefill.
- **M2.2 ([run file](runs/m2.2-home-services.md)):** "Who it's for" lines missing in 07 for some pages; the S5 UI/UX section; the empty row under the S11 hero price in INR; published-snapshot build failure and custom milestone labels (M4.1); not verified: real `/api/geo` swap, no-JS render, Safari/Firefox, screen reader (the FAQ keyboard, hub links, S3 404 and Lighthouse were closed in M2.5).
- **Earlier-work audit ([run file](runs/skill-audit-earlier-2026-10-22.md)):** heavy.sh process-tree kill on Windows; quote-aware comment stripping in the migration guard; tighter no-floats bigint exemption; post-condition for receipts (M6).
- **Skill audit ([run file](runs/skill-audit-2026-10-22.md)):** immutable cache for portal `/assets/*` (M4.5); tracing on staging after checking the Workers Logs quota; Phase 7 WAF/rate-limit also on web `/api/*` and auth routes; more binding types in `check-web-bindings.mjs`; retire catalogue items by deactivating (M4.1); GSTIN formats for TDS/UIN/NRTP (VERIFY WITH CA/LEGAL; batch Q26: when such a client comes).
- **M1.6:** M7.1 document-link audit throttling; merge the bundle guards.
- **M1.5:** break-glass audit-row read-back and an optional "still the only owner" guard; review items M2, L1, L2, L3, `session.tsx` state in an updater; DPDP retention/erasure for IP, user agent and location in the audit log (VERIFY WITH CA/LEGAL); a last-owner check on any future delete-user feature.
- **Social kit:** the Upwork banner's domain line after a real-device check.
- **Wallpapers (low, [run file](runs/brand-wallpapers.md)):** test-strength items.
- **Models and usage:** the cost report after M3.1 (Next 2).
- **Content:** check the other "100 %" mentions in 04 against the content lint.
- **Re-measure:** the old site's TTFB from India, if it still matters before cut-over.
