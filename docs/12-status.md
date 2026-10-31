# 12: Status

_Replaced (never appended) at the end of every session. Last updated: **2026-10-31, 15:45** (IST)._

## Done
- **Phases 1–5, M1 (foundation), M2 (public website), M3, M4 and the M5 batch (M5.0–M5.5):** all approved by the owner (M5 on 2026-10-31, [#122](https://github.com/techaust/techaust_platform/pull/122)). Details live in the run files under [runs/](runs/) and in [13-decisions.md](13-decisions.md).
- **The full audit of M1–M5** (2026-10-29/30, [#106](https://github.com/techaust/techaust_platform/pull/106)–[#120](https://github.com/techaust/techaust_platform/pull/120)), the workflow changes ([#118](https://github.com/techaust/techaust_platform/pull/118)), the cloud sessions setup ([#115](https://github.com/techaust/techaust_platform/pull/115)) and the research register settled without a CA or lawyer ([#119](https://github.com/techaust/techaust_platform/pull/119)).
- **Today (2026-10-31):**
  - **T1–T3** ([#123](https://github.com/techaust/techaust_platform/pull/123)) and **T4 + T10** ([#124](https://github.com/techaust/techaust_platform/pull/124)); the T6/T11 wording 07-ZE approved ([#125](https://github.com/techaust/techaust_platform/pull/125)); launch all at once (owner).
  - **Parallel cloud sessions:** the cloud setup fix ([#126](https://github.com/techaust/techaust_platform/pull/126)); the five task sessions restarted from this PC's main session at ~13:00 IST ([run file](runs/cloud-parallel-2026-10-31.md)), watched by a one-minute GitHub watcher plus a 30-minute heartbeat.
  - **T12** ([#129](https://github.com/techaust/techaust_platform/pull/129); [run file](runs/t12-retag-open.md)): settled OPEN tags retagged, 08-C §5 rewritten; sent back once by the main session (RB-23, RB-35, RB-38(c) stay OPEN as 07-ZE says).
  - **T6** ([#130](https://github.com/techaust/techaust_platform/pull/130); [run file](runs/t6-terms-offers.md)): "(IST)" on offer validity, "replaces version N", acceptance only by the button, proposal terms v4, website Terms 0.2, the admin "Client accepted by email?" box. Reviewer APPROVE; CI green; jobs Worker 985,956 bytes. Delivery 0.2 waits for T11.
  - **MCIA re-checked on this PC:** seat and amounts confirmed; two facts corrected in 08-C RB-38 (the fee schedule dates from 15 January 2017; no fee halving on the expedited track; fees are plus taxes).
  - **Owner's answers today:** T6 Q1–Q2, proforma withdraw Q1–Q4 (07-ZF approved), T7 Q1–Q2 (07-ZG approved), M6.1 Q1–Q3 (the deploy step for a third admin Worker, step-up for payments, 07-ZH approved); the `/orchestrate` skill plan (13).

## In progress
- **Three cloud sessions** (environment `techaust_platform`; merge order proforma withdraw → T7 → M6.1):
  - **proforma withdraw** (`feat/proforma-withdraw`, Tier A): reviewer APPROVE; fixing its findings; told to take `main` in; merges next.
  - **T7** (`feat/t7-offer-erasure`, Tier A): designer done; reviewer running.
  - **M6.1** (`feat/m6.1-ledger-payments`, Tier A, milestone): the third admin Worker split (stage A) and ledger data and core (B1) built; the API (B2) and early-check fixes running, then the second early check. Merges last; then the owner approves it on staging.
- **This record** (docs PR) merges itself once CI passes.

## Next
1. Merge the three in order as each PR is ready (the main session reviews each, turns on auto-merge, tells the next branch to take `main` in and renumber migrations). The jobs Worker has ~9,000 bytes left below the 995,000 stop line: check T7's and M6.1's numbers at review.
2. **M6.1 on staging:** the owner checks it and says "approved" before M6.2.
3. Build the **`/orchestrate` skill** (owner, 2026-10-31) after the three merge.
4. **T11** (the deed; needs M6.1's "fully paid"); decide **L9** before M6.2 (M6.1's analyst writes the recommendation); **M6.2–M6.5** (gateway test keys needed); **M7**; the audit of M6–M7; **Phase 7 all at once**. T5 once the owner's AWS is set up.

**Usage now:** 5-hour window ~5 % (reset 15:10 IST). Gate: new agents at or under 95 %; at most 2 agents per cloud session.

## Waits on the owner
- **Now:** archive the T12 and T6 cloud sessions (sidebar › right-click › Archive); keep this main conversation open in the Code tab while the sessions run (the watcher and heartbeat live in it).
- **Start early (so launch day doesn't slip; the lead gives click-by-click steps when each comes up):**
  - **Razorpay, Stripe and PayPal** test accounts and **test keys** (M6.2–M6.4); live approval can take days to weeks;
  - **SES production access** and a production IAM user; **the AWS backup bucket** (and for T5 the S3 bucket in Mumbai); sign the AWS MCP in to the TecHaust account first;
  - **website inputs:** a new headshot, bio facts, the email aliases (hello, billing, no-reply, security, privacy), the launch date; the company LinkedIn page URL, WhatsApp Business number, Cal.com link, 2–3 case-study briefs, one social handle per platform, the 3 blog drafts.
- **Dated duties** (steps in [settle-08c](runs/settle-08c.md)): **by 13 November** the October IFF if an October credit note relies on it; **before the next export invoice** the FY 2026-27 LUT (ARN in Settings › Tax); **by 30 November** the October EDF if any export invoice was raised in October; **monthly** reverse charge on foreign services; **every April** the turnover check; **once** the Offline Tool test import, the CERT-In point of contact, the trademark search (classes 9, 35, 42).
- **Staging data for invoicing:** the real company profile, labelled sample bank details, the Udyam number and category, the signature image (Settings › Company).
- **Zoho:** confirm the `billing@`, `hello` and `no-reply` aliases. **Catalogue › Publish on staging** (if not done yet).
- **Renewals:** the staging SES key `techaust-ses-sender-staging` by **2027-01-21**; Access tokens `staging-cpu-benchmark` by 2027-10-17 and `staging-deploy-check` by 2027-10-30.
- **Not blocking:** upload the social kit; "since 2019" against the GST registration date; wallpapers; printed brand proof and Pantone; business-card phone number; Argon2id timing on a phone; a one-off lawyer review of the deed of assignment someday.
- **Model menu:** Opus 5.5, high, for every conversation.

## Open follow-ups
- **T12 ([run file](runs/t12-retag-open.md)):** copy that still says "Ask your bank or CA" or "with your CA" (admin `reports.ts` ~91, ~224, ~229, ~243, ~256, ~473) and the "list for your CA and lawyer" hints (admin `worker/settings.ts:131-133`, `:634`, `src/api.ts:81`, `components/form.tsx:262`, web `legal-pages.ts:3`; tests pin them): new owner-approved copy; 08-C header lines 7 and 9 (the tag list, the stale CA/lawyer line); 08-C §6 the PA-CB realisation note (RB-01); RA-21 (a note's rate day) still OPEN; the privacy notice's EU/UK legitimate-interests cell (RB-12, legal pages v0.4).
- **T6 ([run file](runs/t6-terms-offers.md)):** a recipient picker for the staff reply (it greets the document's contact); the box on `expired` offers; offers sent before T6 show "(IST)" and line 3 in the portal but not in their stored PDF (kept); the admin `PORTAL_ORIGIN` config test lives in `apps/web/test` (CLAUDE.md mention); not verified: the real portal offer page and queued email (need jobs and Browser Run), a staging admin build. Lines 6, 9, 11, 12, 14, 15 rest on OPEN items (RB-23, RB-38(c)).
- **Parallel task sessions (2026-10-31):** the watcher counts only task-branch pushes (a builder pushing to a `fix/*` sub-branch looks quiet: fold into `/orchestrate`); Auto-fix can't be turned on from the main session for PRs a cloud session opened (the owner can, from the PR bar); `tools/agent-slots.mjs` doesn't hold the 2-agents-per-session cap of parallel runs (the prompt does).
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
