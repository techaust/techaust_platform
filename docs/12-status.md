# 12: Status

_Replaced (never appended) at the end of every session. Last updated: **2026-10-28, 23:15** (IST)._

## Done
- **Phases 1–5, M1 (foundation), M2 (public website), M3.1–M3.5, M4.1–M4.5:** all approved by the owner (latest: the M3.4–M4.5 batch, 2026-10-26, PR #93). Details live in the run files under [runs/](runs/) and in [13-decisions.md](13-decisions.md).
- **Working rules:** the three-model plan ([14-models-and-usage.md](14-models-and-usage.md)); Team plan gate (5-hour window only; no new agent at ≥ 80 %); skills mandatory; Cloudflare Access on every staging Worker; owner rule 8 (2026-10-28): tax and legal items are researched from official sources and tagged "Researched <date>, <source>" or "OPEN: <question>".
- **The M5 batch: M5.0 to M5.5 built, reviewed and on staging** (PRs [#95](https://github.com/techaust/techaust_platform/pull/95)–[#97](https://github.com/techaust/techaust_platform/pull/97), [#99](https://github.com/techaust/techaust_platform/pull/99)–[#101](https://github.com/techaust/techaust_platform/pull/101); [batch run file](runs/m5-batch.md)): admin Worker split, tax invoices, export invoices, proformas and advances, credit and debit notes, sending, reminders and recurring care invoices, GST and CA exports, realisation, EDF, statements, finance tiles. Staging fix after the owner's M5.0 check: [#103](https://github.com/techaust/techaust_platform/pull/103).
- **Research and wording, merged 2026-10-28** ([PR #104](https://github.com/techaust/techaust_platform/pull/104); [run file](runs/research-and-wording.md)). It replaces the owner's line-by-line M5 review (owner, 2026-10-28).
  - **Register:** [08-C](08-research-appendix/C-research-register.md), 65 items, settled with a source or OPEN with the CA's or lawyer's question.
  - **Owner answers:** Q37 lapsed LUT blocked; Q11 DUPLICATE FOR SUPPLIER copy; Q35 tax-only debit note; accept-by-link for any value. Every other batch question (Q1–Q71) is settled by the register or by its built default (08-C §7).
  - **Rules built:** the LUT of the receipt day's FY; discount after sale from 1 Nov 2026; tax-only debit note; supplier copy; FX same-day rule with a dated statement; credit-note advice dates; email logs ≥ 12 months; signatory switch; backup gate before production; security.txt ≤ 365 days; prior-price lint.
  - **Copy:** 07-R to 07-V approved by the lead under the owner's delegation; 07-W for the gaps; legal pages v0.3; no `[Placeholder]` left on any screen. Care invoices can now be issued automatically where an owner has switched it on.
  - Migrations 0046–0048.
- **Verified 2026-10-28:** `pnpm check` and `pnpm test` pass in every package (auth 135, ui 469, core 1,752, email 128, db 452, pdf 318, web 443, portal 620, jobs 507, admin 3,170); review SEND BACK (1 high, 3 medium, 7 low) → all fixed → re-check APPROVE; CI green on #104. Bundles: admin API 587,821 bytes (third Worker planned at 650,000), jobs 851,190 (limit 1,000,000).

## In progress
- Nothing is being built. No agent is running. The staging deploy of #104 runs from `main` (CI, then "Deploy staging", which applies migrations 0046–0048 to staging D1). If it fails on a temporary Cloudflare API error, the lead re-runs it once (13-decisions, 2026-10-27).

## Next (when work resumes)
1. **Check the #104 staging deploy** (run green, migrations 0046–0048 applied); re-run once if Cloudflare's API flaked.
2. **The owner checks staging and says "approved" for the M5 batch** (see "Waits on the owner"). Their findings are collected first, then one fix task, after a reviewer UI/UX sweep of every affected screen (owner rule 2026-10-26).
3. **Staging readings** once someone signs in to staging (`cpuTimeMs`, front + API ≤ 7 ms): invoice issue at 1 and 100 lines, export, proforma, advance, note issue, send, `/dashboard`, a register page, `realisation.scan`, `pdf.statement`, `pdf.supplier`, `care.bill`, `care.issue`, `reminder.send`; plus the M4.x readings still open. The lead can't sign in through Cloudflare Access.
4. **After approval: M6.1** (payments, sandbox only). The 80 % usage gate applies.

**Usage now:** 5-hour window 57 % (resets 23:10 IST). Gate: no new agent at ≥ 80 %; two agents at once, one browser agent.

## Waits on the owner
- **Dated duties** ([08-C](08-research-appendix/C-research-register.md) §6):
  - **now:** file the FY 2026-27 LUT and save its ARN in Settings › Tax (LUT export invoices stay blocked until then);
  - **by 31 October:** credit notes for FY 2025-26 supplies (the law's limit is reporting them by 30 November);
  - **by 30 November:** the October EDF to your bank, if any export invoice was raised in October;
  - **every April:** the turnover check.
- **For the CA and the lawyer:** the OPEN list in [08-C §5](08-research-appendix/C-research-register.md) (one place; it replaces the earlier scattered "VERIFY WITH CA/LEGAL" items).
- **M5 staging check and approval:**
  - the M5.0 six steps: sign in to the staging admin; open Dashboard, Leads and a lead; open a client, a proposal and its PDF; in a project, upload and download a file; save one Settings page; sign out;
  - then try an invoice, a credit note and the Settings › Tax checklist;
  - tell the lead "done" with any findings, or "approved".
- **Local test database** (only before someone runs the app on this PC): stop the app, delete `.wrangler\state\v3\d1`, then run `pnpm db:migrate:local` and `pnpm db:seed:local` (the permission check refused the lead's delete).
- **Staging data for invoicing:** the real company profile (legal name, GSTIN, address) and clearly labelled sample bank details in staging Settings; the LUT ARN when filed.
- **Zoho:** confirm the `billing@` alias exists (invoice emails and statements); also `hello` and `no-reply`.
- **Catalogue › Publish on staging** (if not done yet), so the website shows the six service names with "and".
- **When TecHaust's AWS is needed (Phase 7):** sign the AWS MCP in to the TecHaust account (the lead gives steps).
- **For the website:**
  - content: a new headshot; bio facts; the company LinkedIn page URL; WhatsApp Business number; Cal.com link; 2–3 case-study briefs; one social handle per platform; the 3 blog drafts ([07-E](07-content-appendix/E-blog-drafts.md)); one line for when the "I'm human" check can't load;
  - the postal address, checked against the GST certificate;
  - before production: the security@ and privacy@ aliases (U-5).
- **SES key rotation:** the staging IAM key `techaust-ses-sender-staging` by **2027-01-21**.
- **Not blocking:** upload the social kit; "since 2019" against the GST registration date; wallpapers; Renovate; trademark search (U-8, 08-C RB-34); printed brand proof and Pantone; business-card phone number; Argon2id timing on a phone; U-6 and U-7.
- **Model menu:** keep **Opus 5.5, medium** for every conversation.

## Open follow-ups
- **Research and wording (2026-10-28, run file):** a docs-only sweep of the 224 remaining VERIFY tags (older plan and research docs) against 08-C; purge `pdf_asks` rows; release the supplier-copy claim when jobs refuses a render; one clock reading for the draft's no-rate day (`invoices.ts:861`); the 07-T banner names "30 November" while the cutoff is a setting; `meta.verify` strings → a `kind` field; re-read the CBIC s.34 page after 1 November; not verified: a real Browser Run render of the supplier copy, signatory-off and IGST-advance PDFs; the shared local D1 needs a reset before the next local run (steps in the run file).
- **M5 (2026-10-28, run files):**
  - a longer timeout for the M5.4 test "each send names the staff member…" in `apps/admin/worker/invoice-send.test.ts` (times out under a full parallel run);
  - export the realisation bounds (1,200 / 36,500) from core instead of three copies (M5.5b re-check low 4);
  - check the code-review helper's 10 M5.4 candidates (it reviewed `main` by mistake) against `main`;
  - the deploy workflow doesn't enforce "admin API before jobs" (a workflow change: owner's yes);
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
