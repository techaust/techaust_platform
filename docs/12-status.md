# 12: Status

_Replaced (never appended) at the end of every session. Last updated: **2026-10-31, 02:00** (IST)._

## Done
- **Phases 1–5, M1 (foundation), M2 (public website), M3.1–M3.5, M4.1–M4.5:** all approved by the owner (latest: the M3.4–M4.5 batch, 2026-10-26, PR #93). Details live in the run files under [runs/](runs/) and in [13-decisions.md](13-decisions.md).
- **The M5 batch (M5.0–M5.5)** built, reviewed and on staging (PRs #95–#101, #103), with the research and wording task (#104) and the owner's M5 findings (#106). Waits for the owner's "approved".
- **The full audit of M1–M5: complete** (owner's order, 2026-10-29; [run file](runs/full-audit-m1-m5.md)). Seven areas audited; every finding fixed in FX-1 to FX-5 ([#107](https://github.com/techaust/techaust_platform/pull/107), [#108](https://github.com/techaust/techaust_platform/pull/108), [#110](https://github.com/techaust/techaust_platform/pull/110), [#113](https://github.com/techaust/techaust_platform/pull/113), [#116](https://github.com/techaust/techaust_platform/pull/116)); the final sweep of the website, admin and portal and its fixes ([#120](https://github.com/techaust/techaust_platform/pull/120); [run file](runs/final-sweep.md)). Every fix task went through a review, its fixes and a re-check.
  - **FX-5:** research tags, 07-X/07-Y wording, Bengali and Devanagari PDF fallback fonts, and the owner's rule that an invoice the client has opened can't be voided (trigger 0053; the portal records the view in the read's own batch).
  - **Final sweep:** website reflow at 320 px; admin layouts at tablet widths, 44 px targets, unique landmarks, server errors never shown as "offline", activity rows with working links; portal load-failure pages, Paid, Credited and discount rows, a note's invoice link and reason; the 07-ZA copy (owner-approved 1–20) and 07-ZB; proposal terms version 3 ("this proposal or estimate").
- **Workflow changes (owner's yes, 2026-10-30; [#118](https://github.com/techaust/techaust_platform/pull/118); [run file](runs/audit-workflows.md)):** a dependency audit in CI; builds without the Cloudflare token; five deploys in a fixed order with an Access health check after each (the new `staging-deploy-check` token); Workers Traces on staging; zod 4.6.6. The first deploy on it passed every step.
- **Cloud sessions setup ([#115](https://github.com/techaust/techaust_platform/pull/115); [run file](runs/cloud-1-sessions.md)):** the cloud command guard (four review rounds), dev ports per session, the REST PR helper. Not yet used in a real cloud session.
- **No CA or lawyer (owner, 2026-10-30):** every OPEN item in the research register settled on the safest reading, with the owner's choices ([#119](https://github.com/techaust/techaust_platform/pull/119); [run file](runs/settle-08c.md)); CLAUDE.md rule 8 updated.
- **Verified 2026-10-30/31:** `pnpm check` and every package's tests pass (core 1,827, pdf 352, portal 651, admin 3,452, db 491, web 714, jobs 531; timeouts only under load, each passing alone); e2e web 212, portal 9, admin 6/6 with sample data (`E2E_SAMPLE=1`); axe 0 on every checked screen; Workers within budget (portal 100,589; admin front 99,271; admin API 615,441; jobs 978,987 bytes).

## In progress
- Nothing is being built. No agent is running. The staging deploy of #120 follows main's CI (it adds proposal terms version 3 where staging's newest terms are the seeded version 2); the next session checks it.

## Next (when work resumes)
1. **Check #120's staging deploy** (all five deploys and health checks green).
2. **The owner checks staging and says "approved" for the M5 batch** (see "Waits on the owner").
3. **Research tasks from [settle-08c](runs/settle-08c.md)**, Tier A ones with an analyst brief and early check: T1 credit-note cutoff one month earlier (needs the GSTR-1 frequency), T2 the LUT of a debit note's FY, T3 the 3B helper nets a credit note only once IMS-accepted, T4 signature always on notes and advance invoices, T10 the Udyam number on tax invoices, T7 erasure in never-accepted offers (before 13 May 2027), T6 terms and offer copy with the four new clauses (copy to the owner), T11 the deed of assignment for Aadhaar eSign, T5 the CERT-In log copy to S3 Mumbai (after the owner's AWS setup), T12 retag and rewrite 08-C §5.
4. **Withdraw a proforma the client has seen** (owner's yes, 2026-10-30; Tier A; new copy to the owner).
5. **After approval: M6.1** (payments, sandbox only), with T8 (TDS by certificate) and the planned third admin Worker (admin API at 615,441 bytes; plan before 650,000).

**Usage now:** 5-hour window about 40 %. Gate: new agents at or under 95 %; this PC at most 2 agents, 1 using a browser.

## Waits on the owner
- **Your GSTR-1 frequency** (monthly or quarterly): gst.gov.in › Login › Services › Returns › Opt-in for Quarterly Return.
- **M5 staging check and approval:** sign in to the staging admin; open Dashboard, Leads and a lead; a client, a proposal and its PDF; in a project, upload and download a file; save one Settings page; try an invoice, a credit note and the Settings › Tax checklist; sign out. Then "done" with any findings, or "approved".
- **Dated duties** (your own actions; steps in [settle-08c](runs/settle-08c.md)):
  - **before the next export invoice:** file the FY 2026-27 LUT and save its ARN in Settings › Tax;
  - **by 30 November:** the October EDF to your bank, if any export invoice was raised in October; ask the bank the questions in settle-08c (EDF format, purpose code, IEC, closure up to ₹10 lakh, PA-CB proof);
  - **monthly:** reverse charge on foreign services, by spreadsheet;
  - **every April:** the turnover check;
  - **once:** the Offline Tool test import before the first real GSTR-1; the CERT-In point of contact (the lead confirms the format first); the trademark search (classes 9, 35, 42).
- **For T5:** an AWS S3 bucket in Mumbai and an access key, with the lead's script (when the task starts).
- **Staging data for invoicing:** the real company profile (legal name, GSTIN, address), clearly labelled sample bank details, the Udyam number (in Settings, never in code).
- **Zoho:** confirm the `billing@` alias (invoice emails and statements); also `hello` and `no-reply`.
- **Catalogue › Publish on staging** (if not done yet).
- **When TecHaust's AWS is needed:** sign the AWS MCP in to the TecHaust account (it is on another account today).
- **For the website:** a new headshot; bio facts; the company LinkedIn page URL; WhatsApp Business number; Cal.com link; 2–3 case-study briefs; one social handle per platform; the 3 blog drafts; the postal address checked against the GST certificate; before production, the security@ and privacy@ aliases.
- **Renewals:** the staging SES key `techaust-ses-sender-staging` by **2027-01-21**; Access tokens `staging-cpu-benchmark` by 2027-10-17 and `staging-deploy-check` by 2027-10-30.
- **Not blocking:** upload the social kit; "since 2019" against the GST registration date; wallpapers; printed brand proof and Pantone; business-card phone number; Argon2id timing on a phone; a one-off lawyer review of the deed of assignment someday.
- **Model menu:** Opus 5.5, high, for every conversation.

## Open follow-ups
- **Final sweep (2026-10-31, [run file](runs/final-sweep.md)):** the week grid's "1 h 45 min" wraps at 1280 with the menu open; the activity feed's label for a credit or debit note issue; same-name people in the Time Entries table; the website focus outline 1.6 px against docs/06's 2 px.
- **Workflows (2026-10-30, [run file](runs/audit-workflows.md)):** allow-list entries bound to a version or path; a separate deploy job; a web `/api/health`; trace size and query-string redaction after a week (by 2026-11-06); the zod allow-list entry expires 2026-11-13 (astro update).
- **Cloud sessions:** the first real cloud session runs "check cloud setup" ([runbook](runbooks/cloud-sessions.md) Part 3).
- **Research (2026-10-30, [run file](runs/settle-08c.md)):** still OPEN: RB-06 (purpose code, a bank fact), RB-21 (West Bengal stamp rate), RB-22(b) (read G.S.R. 789(E) before 1 Jan 2027), RA-34 (the GSTIN check test before Phase 7); also the FX day of a USD debit note, the IGST-route endorsement wording, the LUT ARN format.
- **M5 (2026-10-28, run files):**
  - a longer timeout for the M5.4 test "each send names the staff member…" in `apps/admin/worker/invoice-send.test.ts` (times out under a full parallel run);
  - export the realisation bounds (1,200 / 36,500) from core instead of three copies (M5.5b re-check low 4);
  - check the code-review helper's 10 M5.4 candidates (it reviewed `main` by mistake) against `main`;
  - a CI job for Linux PDF visual baselines (workflow change: owner's yes);
  - FEMA extensions (M6.1, Q60); refunds, the payment register and "collected" figures (M6);
  - the admin API is at 587,821 bytes: plan the third admin Worker before it passes 650,000 (likely during M6);
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
