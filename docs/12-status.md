# 12: Status

_Replaced (never appended) at the end of every session. Last updated: **2026-10-31, 12:15** (IST)._

## Done
- **Phases 1–5, M1 (foundation), M2 (public website), M3, M4 and the M5 batch (M5.0–M5.5):** all approved by the owner (M5 on 2026-10-31, [#122](https://github.com/techaust/techaust_platform/pull/122)). Details live in the run files under [runs/](runs/) and in [13-decisions.md](13-decisions.md).
- **The full audit of M1–M5** (2026-10-29/30, [#106](https://github.com/techaust/techaust_platform/pull/106)–[#120](https://github.com/techaust/techaust_platform/pull/120); [run file](runs/full-audit-m1-m5.md), [final sweep](runs/final-sweep.md)), the workflow changes ([#118](https://github.com/techaust/techaust_platform/pull/118)), the cloud sessions setup ([#115](https://github.com/techaust/techaust_platform/pull/115)) and the research register settled without a CA or lawyer ([#119](https://github.com/techaust/techaust_platform/pull/119); [run file](runs/settle-08c.md)).
- **Today (2026-10-31):**
  - **T1–T3** ([#123](https://github.com/techaust/techaust_platform/pull/123); [run file](runs/rt1-notes-rules.md)): the credit-note deadline by GSTR-1 filing frequency (TecHaust files quarterly, QRMP), the LUT of a debit note's own FY (trigger 0054), IMS in the 3B helper (layout v2). Copy 07-ZD approved by the owner.
  - **T4 + T10** ([#124](https://github.com/techaust/techaust_platform/pull/124); [run file](runs/rt2-signature-udyam.md)): the signature always on credit and debit notes and invoices for a payment received (trigger 0055, jobs refusal), the Udyam number on tax invoices (Settings › Company), accessible admin dialogs (refusals read out, focus kept clear of the sticky buttons). Copy 07-ZC approved by the owner.
  - **The T6 and T11 wording** approved by the owner: 20 lines and Q1–Q4 ([07-ZE](07-content-appendix/ZE-terms-offers-deed.md); #125).
  - **Launch all at once** (owner): no early website cut-over; everything goes live together after M6, M7 and Phase 7 (estimate: about 12–17 working days, 3–4 weeks, gateway live approval not included; [09-roadmap](09-roadmap.md)).
  - **Parallel task sessions** (owner): every pending, unblocked task runs as its own cloud session, controlled by a main session on this PC; at most 2 agents per session; questions come through the main session. The plan, shared rules and five prompts: [runs/cloud-parallel-2026-10-31](runs/cloud-parallel-2026-10-31.md); the protocol: [runbook Part 4](runbooks/cloud-sessions.md), CLAUDE.md, docs/14 §5.
  - **The five sessions were started and all stopped in setup** ("node -v says v24.22.1, not v24.22.2": the cloud image now has its own Node in `/opt/node24`). Fixed in [#126](https://github.com/techaust/techaust_platform/pull/126) (Node in `/opt/techaust-node`); not yet run on a real cloud machine.
- **Verified today:** the rt2 integration at 32f788d8: `pnpm check` exit 0 and `pnpm test` all green (auth 135, ui 471, core 1,861, email 130, db 514, pdf 376, web 714, portal 651, jobs 549, admin 3,493); both browser test sets and axe passed in the reviews; CI and the staging deploy of #124 (a703bf56) green. Workers: admin front 99,271, admin API 618,422, jobs **984,266 of 1,000,000** bytes.

## In progress
- **[#126](https://github.com/techaust/techaust_platform/pull/126)** (the cloud setup fix) merges itself once CI passes (auto-merge on; Auto-fix is the owner's switch in its PR bar, the app refused it here).
- **This record** (docs PR of today's second end of day) merges itself once CI passes.
- No agent is running. No cloud session is running (all five stopped in setup).

## Next (when work resumes; say "start the day" in a new conversation)
0. **Restart the five parallel cloud sessions** once #126 has merged and the owner has pasted the new setup script ([handover](runs/cloud-parallel-2026-10-31.md)): T12, T6, withdraw a seen proforma, T7, M6.1 (items 1–5 below), each from the prompt in that file, merge order T12 → T6 → proforma → T7 → M6.1. Then "check the cloud sessions" to control them.
1. **T6** (Tier B/C; [07-ZE](07-content-appendix/ZE-terms-offers-deed.md)): first the MCIA check (its fee schedule, and whether its rules allow a Kolkata seat; if either fails, 07-ZE line 12 goes back to the owner), then the brief, the build (offer wording, proposal terms v4, website Terms 0.2; Delivery 0.2 waits for T11), the review.
2. **T7** erasure in never-accepted offers (Tier A, before 13 May 2027).
3. **Withdraw a proforma the client has seen** (owner's yes, 2026-10-30; Tier A; new copy to the owner).
4. **T12** retag the OPEN comments and rewrite 08-C §5.
5. **M6 Payments** (sandbox only): M6.1 with T8 (TDS by certificate) and the third admin Worker plan (admin API at 618,422; plan before 650,000), then T11 (the deed, needs "fully paid"); decide L9 (jobs minify, a separate payment-webhook Worker or a measured ceiling) **before M6.2**; M6.2–M6.5.
6. **M7** (M7.1–M7.5), an audit of M6–M7, then **Phase 7 all at once** (L1–L11). T5 (CERT-In log copy to S3 Mumbai) once the owner's AWS is set up.

**Usage now:** 5-hour window 3 %. Gate: new agents at or under 95 %; this PC at most 2 agents, 1 using a browser.

## Waits on the owner
- **Now, after #126 merges:** paste the new setup script into the `techaust_platform` environment (claude.ai/code › environment › gear › Setup script; copy the Raw file from `main`; [runbook](runbooks/cloud-sessions.md) Part 2, step 6), and archive the five failed cloud sessions. Then "start the day" here.
- **Start early (outside waiting times, so launch day doesn't slip; the lead gives click-by-click steps when each comes up):**
  - **SES production access** (AWS › SES › Account dashboard › Request production access) and a production IAM user, so emails reach any address;
  - **the AWS backup bucket** (and for T5 the S3 bucket in Mumbai), with the lead's script; sign the AWS MCP in to the TecHaust account first (it is on another account today);
  - **Razorpay, Stripe and PayPal** accounts and their **test keys** (M6.2–M6.4); live approval can take days to weeks, and Razorpay may want the legal pages live on techaust.com first;
  - **website inputs:** a new headshot, bio facts, the email aliases (hello, billing, no-reply, security, privacy), the launch date; also the company LinkedIn page URL, WhatsApp Business number, Cal.com link, 2–3 case-study briefs, one social handle per platform, the 3 blog drafts.
- **Dated duties** (your own actions; steps in [settle-08c](runs/settle-08c.md)):
  - **by 13 November:** file the October IFF if an October credit note relies on it (otherwise the note moves into the Oct–Dec GSTR-1, filed after 30 November);
  - **before the next export invoice:** file the FY 2026-27 LUT and save its ARN in Settings › Tax;
  - **by 30 November:** the October EDF to your bank, if any export invoice was raised in October; ask the bank the questions in settle-08c;
  - **monthly:** reverse charge on foreign services, by spreadsheet; **every April:** the turnover check;
  - **once:** the Offline Tool test import before the first real GSTR-1; the CERT-In point of contact; the trademark search (classes 9, 35, 42).
- **Staging data for invoicing:** the real company profile (legal name, GSTIN, address), clearly labelled sample bank details, the Udyam number and category (Settings › Company), the signature image (Settings › Company; needed for any credit or debit note or advance invoice).
- **Zoho:** confirm the `billing@` alias (invoice emails and statements); also `hello` and `no-reply`.
- **Catalogue › Publish on staging** (if not done yet).
- **Renewals:** the staging SES key `techaust-ses-sender-staging` by **2027-01-21**; Access tokens `staging-cpu-benchmark` by 2027-10-17 and `staging-deploy-check` by 2027-10-30.
- **Not blocking:** upload the social kit; "since 2019" against the GST registration date; wallpapers; printed brand proof and Pantone; business-card phone number; Argon2id timing on a phone; a one-off lawyer review of the deed of assignment someday.
- **Model menu:** Opus 5.5, high, for every conversation.

## Open follow-ups
- **Parallel task sessions (2026-10-31, [run file](runs/cloud-parallel-2026-10-31.md)):** `tools/agent-slots.mjs` doesn't hold the 2-agents-per-session cap of parallel runs yet (the prompt does); the #126 fix is unverified on a real cloud machine.
- **Model audit (2026-10-31):** the rt2 integration builder (agent-ae999e0f) loaded no skill though it reported two; recorded in its run file.
- **rt1 ([run file](runs/rt1-notes-rules.md)):** (1) a migration that folds any legacy `tax.lut` into the list and drops the key, **before production**; (2) the 3B helper's IMS status per period (OPEN RA-04); (3) an optional "IFF filed" setting (OPEN RA-31); (4) show known blockers on a dialog's confirm step before step-up; (5) the draft row's 44 px inline link line gap (cosmetic).
- **rt2 ([run file](runs/rt2-signature-udyam.md)):** the invoice issue dialog's wrong-code notice and one shared `invalid_code` helper; a BEFORE INSERT signature trigger; inner spaces in a pasted Udyam number; one shared must-be-signed list; the `Field` scroll effect key; the save bar after a "No change" save; fresh visual baselines (invoice-udyam, advance, note fixtures); the duplicate PNG builder in `apps/admin/e2e/sample-data.ts`; the `.inv-udyam` 12em rule if the Udyam format ever changes; not verified: NVDA, Browser Run renders of the Udyam line and the signed notes.
- **Final sweep (2026-10-31, [run file](runs/final-sweep.md)):** the week grid's "1 h 45 min" wraps at 1280 with the menu open; the activity feed's label for a credit or debit note issue; same-name people in the Time Entries table; the website focus outline 1.6 px against docs/06's 2 px.
- **Workflows (2026-10-30, [run file](runs/audit-workflows.md)):** allow-list entries bound to a version or path; a separate deploy job; a web `/api/health`; trace size and query-string redaction after a week (by 2026-11-06); the zod allow-list entry expires 2026-11-13 (astro update).
- **Research (2026-10-30, [run file](runs/settle-08c.md)):** still OPEN: RB-06 (purpose code, a bank fact), RB-21 (West Bengal stamp rate), RB-22(b) (read G.S.R. 789(E) before 1 Jan 2027), RA-34 (the GSTIN check test before Phase 7); also the FX day of a USD debit note, the IGST-route endorsement wording, the LUT ARN format.
- **M5 (2026-10-28, run files):**
  - a longer timeout for the M5.4 test "each send names the staff member…" in `apps/admin/worker/invoice-send.test.ts` (times out under a full parallel run);
  - export the realisation bounds (1,200 / 36,500) from core instead of three copies (M5.5b re-check low 4);
  - check the code-review helper's 10 M5.4 candidates (it reviewed `main` by mistake) against `main`;
  - a CI job for Linux PDF visual baselines (workflow change: owner's yes);
  - FEMA extensions (M6.1, Q60); refunds, the payment register and "collected" figures (M6);
  - the admin API is at 618,422 bytes: plan the third admin Worker before it passes 650,000 (M6.1);
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
