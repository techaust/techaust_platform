# 12: Status

_Replaced (never appended) at the end of every session. Last updated: **2026-10-26, 06:10** (IST)._

## Done
- **Phases 1–5:** approved 2026-10-06 ([09-roadmap.md](09-roadmap.md)).
- **M1 Foundation, all approved:** M1.1 tokens, fonts and the "Patina" brand ([PR #3](https://github.com/techaust/techaust_platform/pull/3)); M1.2 core library ([PR #5](https://github.com/techaust/techaust_platform/pull/5)); M1.3 D1 schema, triggers and seed ([PR #6](https://github.com/techaust/techaust_platform/pull/6)); M1.4 auth CPU gate, accepted 2026-10-21 with an exception ([PR #7](https://github.com/techaust/techaust_platform/pull/7), [PR #24](https://github.com/techaust/techaust_platform/pull/24); [cpu-baseline.md](runbooks/cpu-baseline.md)); M1.5 staff auth, approved 2026-10-21 ([PR #27](https://github.com/techaust/techaust_platform/pull/27), [PR #28](https://github.com/techaust/techaust_platform/pull/28)); M1.6 portal auth, approved 2026-10-22 ([PR #29](https://github.com/techaust/techaust_platform/pull/29)).
- **Working rules and plans:** the three-model plan ([PR #13](https://github.com/techaust/techaust_platform/pull/13); [14-models-and-usage.md](14-models-and-usage.md)); skills are mandatory ([PR #33](https://github.com/techaust/techaust_platform/pull/33), [PR #34](https://github.com/techaust/techaust_platform/pull/34)); Cloudflare Access on all four staging Workers ([PR #18](https://github.com/techaust/techaust_platform/pull/18)).
- **Brand extras:** company wallpapers ([PR #15](https://github.com/techaust/techaust_platform/pull/15)); social media kit for 12 platforms ([PR #17](https://github.com/techaust/techaust_platform/pull/17)).
- **Audits 2026-10-22:** [PR #36](https://github.com/techaust/techaust_platform/pull/36), [PR #38](https://github.com/techaust/techaust_platform/pull/38), [PR #41](https://github.com/techaust/techaust_platform/pull/41).
- **M2.1 site shell** approved 2026-10-22 ([PR #31](https://github.com/techaust/techaust_platform/pull/31), [#32](https://github.com/techaust/techaust_platform/pull/32), [#35](https://github.com/techaust/techaust_platform/pull/35)); **M2.2 home + services** approved 2026-10-22 ([PR #42](https://github.com/techaust/techaust_platform/pull/42)–[#44](https://github.com/techaust/techaust_platform/pull/44)); **M2.3 other pages** approved 2026-10-23 ([PR #47](https://github.com/techaust/techaust_platform/pull/47), [#48](https://github.com/techaust/techaust_platform/pull/48); [run file](runs/m2.3-other-pages.md)); **M2.4 forms, leads and emails** approved 2026-10-23 ([PR #50](https://github.com/techaust/techaust_platform/pull/50); [run file](runs/m2.4-forms-leads-email.md)); **CPU tuning** done 2026-10-23 ([PR #53](https://github.com/techaust/techaust_platform/pull/53), [#55](https://github.com/techaust/techaust_platform/pull/55), [#56](https://github.com/techaust/techaust_platform/pull/56); [run file](runs/cpu-tuning-email.md)).
- **M2.4b sign-in emails and Turnstile on sign-in: approved 2026-10-23** ([PR #61](https://github.com/techaust/techaust_platform/pull/61), result [PR #62](https://github.com/techaust/techaust_platform/pull/62); [run file](runs/m2.4b-signin-email.md)):
  - portal sign-in link by email from `no-reply@` (Reply-To `contact@`); staff emails for a new-device sign-in, a 2FA change and a lockout (member and every active owner); Turnstile on portal sign-in always and on admin sign-in after 3 failures, checked before any quota
  - copy from 07 §8 and the owner-approved [07-G](07-content-appendix/G-m2.4b-security-emails.md); owner's sign-in widget `techaust-staging-signin` and both secrets set
  - analyst brief → builder → analyst early check (CHANGE minor) → designer → review APPROVE (8 findings, all fixed or kept with a reason) → re-check APPROVE; `pnpm check` and `pnpm test` green
  - owner's staging test: all four emails arrived, check and lockout worked; CPU all under 10 ms (first jobs invocation after deploy 4 ms; staff email sends 8 ms, accepted with a follow-up)
- **Owner inputs on the site (2026-10-23):** postal address on Contact and the legal pages ([PR #57](https://github.com/techaust/techaust_platform/pull/57)); the founder's LinkedIn on About ([PR #58](https://github.com/techaust/techaust_platform/pull/58)); external links open in a new tab with a notice and a build check ([PR #59](https://github.com/techaust/techaust_platform/pull/59)); footer shows company links only, arrow alignment fixed ([PR #60](https://github.com/techaust/techaust_platform/pull/60)).
- **M2.5 SEO, performance and accessibility: approved 2026-10-24** after the owner's NVDA pass on every page ([PR #66](https://github.com/techaust/techaust_platform/pull/66), [#67](https://github.com/techaust/techaust_platform/pull/67); [run file](runs/m2.5-seo-perf-a11y.md)). **M2 (public website) is complete.**
- **First cost report** ([PR #68](https://github.com/techaust/techaust_platform/pull/68); [appendix](14-models-and-usage-appendix/cost-report-2026-10-23.md)): the week was 20 points under the pace; no model or effort change recommended (the owner has not decided yet).
- **CPU tuning 3 and 4: done 2026-10-24** ([PR #69](https://github.com/techaust/techaust_platform/pull/69), [#72](https://github.com/techaust/techaust_platform/pull/72); [run file](runs/cpu-cold-send.md)): the staging reading passed, every invocation ≤ 7 ms (2FA send 3, `/magic` 6, expansions 1–2, admin sign-in steps 4–6). Re-read on the first real staff emails after Phase 7.
- **PR #70** (the overnight-batch plan) closed unmerged; the owner keeps the original plan (hard rule 2).
- **M3.1 admin shell, users and settings: approved 2026-10-24** ([PR #74](https://github.com/techaust/techaust_platform/pull/74); [run file](runs/m3.1-admin-shell.md); copy [07-H](07-content-appendix/H-m3.1-admin-emails.md)): app shell and navigation; users (invite email, roles, deactivate and reactivate, keyset list); every Settings screen (company, bank with step-up and masked numbers, numbering with the issued-series lock, terms, tax, email, payments with the go-live flag off, retention); the audit-log viewer with a step-up CSV export; the bell; admin CSP and immutable `/assets/*`. Preview approved → builder → analyst check → designer → review (send back) → fixes → two re-checks APPROVE; CI green; staging deployed.
- **M3.2 Leads: approved 2026-10-25** ([PR #76](https://github.com/techaust/techaust_platform/pull/76), merged 2026-10-25; [run file](runs/m3.2-leads.md); copy [07-I](07-content-appendix/I-m3.2-lead-replies.md)): list and board (drag + keyboard "Move to…"), lead page and timeline, manual leads, duplicate links, convert → client + contact + draft proposal (one batch), replies from `hello@` with the three 07-I templates, the retention clean-up (cron 03:30 IST, **dry run** on staging) with the 14-day "Scheduled for deletion" view, stage automation for M4, the numbering lock inside the write (L-d). Migrations 0016–0017 applied on staging. Builder → analyst check → designer → review → fixes → three re-checks APPROVE.
- **M3.3 Clients and contacts (Tier A): approved 2026-10-25** ([PR #77](https://github.com/techaust/techaust_platform/pull/77); [run file](runs/m3.3-clients.md); copy [07-J](07-content-appendix/J-m3.3-client-screens.md)). Started before M3.2's approval on the owner's word (one-time exception to hard rule 2; docs/13). Clients list and page with tabs; Sales reads the tax identity but never money settings, invoices, statement or data tools; currency and type locks; state required for Indian clients; contacts with portal access (off or an email change signs them out); owner-only export and erase/anonymise with step-up (VERIFY WITH CA/LEGAL). Migrations 0018–0023 applied on staging.
- **Staging readings 2026-10-25:** every admin call in the owner's session ≤ 7 ms (clients list 7, client page 4, sign-in 3–5); the first lead clean-up dry run: 0 due, 2 ms. Convert, export and erase were not used on staging yet.
- **M3.3 owner answers** ([PR #78](https://github.com/techaust/techaust_platform/pull/78)): an anonymised individual's GSTIN is cleared (VERIFY WITH CA/LEGAL), the Attach PDF hint, a VERIFY WITH CA/LEGAL note in the data-tool dialogs.
- **Batch M3.4 → M4.5 started 2026-10-25** on the owner's word (one review at the end; [batch run file](runs/m3-m4-batch.md)). Groundwork: the worker budget guard (byte ceiling, startup ≤ 200 ms fastest of 7, forbidden modules) and the batch record ([PR #79](https://github.com/techaust/techaust_platform/pull/79)).
- **On staging, awaiting the owner's batch review** (not yet approved):
  - **M4.2 Tax engine** ([PR #80](https://github.com/techaust/techaust_platform/pull/80); [run file](runs/m4.2-tax-engine.md)): `@techaust/core/tax`, pure; analyst check CHANGE → fixed → review APPROVE → re-check APPROVE.
  - **M3.4 Projects, milestones, notes and file vault** ([PR #81](https://github.com/techaust/techaust_platform/pull/81); [run file](runs/m3.4-projects.md)): R2 `techaust-staging-files` bound; migrations 0024–0025; review and two re-checks APPROVE.
  - **M4.1 Catalogue and publish to website** ([PR #82](https://github.com/techaust/techaust_platform/pull/82); [run file](runs/m4.1-catalogue.md)): publish refuses a snapshot the site can't build; `publish-catalogue.yml` every 30 min; migrations 0026–0027; review SEND BACK → fixed → re-check APPROVE.
  - **M3.5 Care plans, time logs, dashboard v1** ([PR #84](https://github.com/techaust/techaust_platform/pull/84), merged 2026-10-25; run file `docs/runs/m3.5-care-time.md`): migrations 0028–0030; review SEND BACK → fixed → re-check APPROVE (6 lows: 5 fixed by the lead, 1 kept).
- **M4.5 portal preview approved by the owner** (2026-10-25).

- **Team plan (2026-10-26):** the account moved to Claude Team; the budget gate now counts only the 5-hour window, with no new agent at 80 % or more ([PR #86](https://github.com/techaust/techaust_platform/pull/86) and today's end-of-day PR; docs/14 §5). The approved plugins Playwright, Context7, frontend-design and GitHub were reinstalled and declared in `.claude/settings.json`; Supabase, Upstash and the AWS MCP (wrong AWS account) are off for this project only ([PR #87](https://github.com/techaust/techaust_platform/pull/87); docs/10).

## In progress (stopped on the owner's word, 2026-10-26 ≈ 06:05 IST; nothing merged to main since #84 except docs)
Three task lines, each holding the one before. Every brief, report and handover is in its run file on that branch.
- **M4.3 Proposals and estimates** (Tier A).
  - **Where:** `feat/m4.3-builder` at 1278fc1; run file `docs/runs/m4.3-proposals.md` ("Lead handover (2026-10-26, end of day)").
  - **Done today:** the re-check's candidates verified: 1–8 real and fixed with tests (old-dated time-entry DELETE owner-only; "Anonymised client" in the frozen view, per your answer; mid-period care hours; dashboard counts past 100 plans and the burn ranking computed once; the care "Converted to…" line; `section_empty` field; blank display names); 5 not a bug; 9 a copy question. `pnpm check` passed.
  - **Not run yet:** the full `pnpm test`, the worker budget, one test file after its last edit.
- **M4.4 PDF engine** (Tier B).
  - **Where:** `feat/m4.4-screens` at 36a97c1 (holds `feat/m4.4-pdf` and M4.3 up to f81851c); run file `docs/runs/m4.4-pdf.md`.
  - **Done today:** the proposal and estimate PDF layouts finished and checked (pdf tests 114/114, visual suite 30/30 twice, every page looked at in colour and grayscale); the PDF prints the portal host from `PORTAL_URL`.
  - **Left:** the admin PDF panel and the signature control (an untested client layer exists), their screenshots, axe and all checks; the jobs `viewOf` tests were not run.
- **M4.5 Send and accept** (Tier B): unchanged since the 05:40 handover; `feat/m4.5-send-accept` at 5477c99, run file `docs/runs/m4.5-send-accept.md`.

## Next (when work resumes)
1. **M4.3:** the lead runs the full `pnpm test` and the worker budget; then a full re-check (code and visual); then the PR to main (auto-merge, Auto-fix), staging.
2. **M4.4:** merge the latest M4.3 in; the designer finishes the admin PDF panel and signature control; review and fixes; **owner: H2** (Browser Run on the staging jobs Worker); the PR after M4.3 merges.
3. **M4.5:** the designer to the approved preview; review and fixes; **owner: H3**; the PR after M4.4 merges.
4. **Owner's final review of all seven** (M3.4, M3.5, M4.1–M4.5) with the copy 07-K to 07-P word for word. **Then stop: M5 waits for the owner.**
5. **Staging readings** (`cpuTimeMs`) for the proposal save, send and GET, the PDF render, the portal view and accept, an email with a PDF.
6. **Before M5.1:** the admin Worker split (service binding).

**Usage now:** 5-hour window 9 %. **Gate (owner, 2026-10-26):** only the 5-hour window counts; at 80 % or more no new agent starts. Three agents at once until M4.5 is done, one browser agent at a time.


## Waits on the owner
- **At the batch review, new today:** the search placeholder for roles with documents but not leads or clients; "Removed client" (live name) against "Anonymised client" (frozen view); the no-tier "Converted to a care plan" line (07-O §10); the two 07-P lines marked PENDING; wording for the signature "larger than 2400 by 1200 pixels" error.
- **When TecHaust's AWS is needed (Phase 7):** sign the AWS MCP in to the TecHaust account (the lead gives steps), then it is turned back on for this project.
- **At the batch's end:**
  - review M3.4, M3.5 and M4.1–M4.5 on staging;
  - approve the drafted copy word for word: [07-K](07-content-appendix/K-m3.4-project-screens.md), [07-L](07-content-appendix/L-m4.1-catalogue-screens.md), [07-M](07-content-appendix/M-m3.5-care-time-screens.md), and 07-N, 07-O, 07-P (on the task branches until those merge);
  - confirm the 30-day warranty line in the proposal terms.
- **Before M4.4 and M4.5 merge:** H2 and H3 (the lead gives click-by-click steps).
- **For the staging test of proposals:** the seeded catalogue has no deliverables, assumptions or exclusions. Fill them in Catalogue for the services you test, or the lead seeds them from the 07 service pages.
- **When convenient:** the real company details and both bank accounts in staging Settings; the first cost report's "no change".
- **For the website:**
  - a **new headshot** (iPhone guide given 2026-10-23; no photo is used until then)
  - **bio facts** (the lead drafts 80–120 words from them; you approve word for word)
  - the **company LinkedIn page URL**
  - WhatsApp Business number, Cal.com link, 2–3 case-study briefs, one social handle per platform
  - review of the 3 blog drafts ([07-E](07-content-appendix/E-blog-drafts.md))
  - confirm the postal address matches the GST certificate word for word (VERIFY WITH CA/LEGAL)
  - one wording line for when the "I'm human" check can't load
  - before production: confirm the Zoho aliases security@ and privacy@ deliver (U-5), and that "encrypted off-site backups" on /security is true
- **Zoho aliases** `hello`, `billing` and `no-reply` (you'll do them later): they clear Zoho's "Sender couldn't be verified" warning on our emails; a test lead confirms it.
- **SES key rotation:** the staging IAM key `techaust-ses-sender-staging` by **2027-01-21**.
- **Time-sensitive compliance** ([08 §0](08-security-compliance.md); all VERIFY WITH CA): U-3 UPI MDR from 15 Oct 2026; U-1 the LUT; U-2 FEMA EDF filing; U-9 GST rules after the 57th GST Council.
- **Colour note (FYI):** success green `#47730F` → `#44700E` and input-border grey `#7A8B84` → `#75867F` for contrast.
- **Not blocking:** upload the social kit; "since 2019" against the GST registration date (VERIFY WITH CA); wallpapers; Renovate; trademark search (VERIFY WITH LEGAL); printed brand proof and Pantone; business-card phone number; Argon2id timing on a phone; U-6 and U-7.
- **Model menu:** keep **Opus 5.5, medium** for every conversation.

## Open follow-ups
- **2026-10-26 (run files):** a rule for the PDF of an anonymised client (VERIFY WITH CA/LEGAL); the data export returns the raw recipient JSON to the person it names (flag for CA/LEGAL); an underscore inside a word becomes italics in core's Markdown; the seeded estimate templates repeat the estimate notice; a CI job for the pdf visual suite so `linux/` baselines exist (workflow change, owner's yes); a `useTemplate` lint info in `apps/web/src/lib/catalogue.ts`.
- **Batch 2026-10-26 (run files):**
  - **admin Worker headroom:** the service-binding split before M5.1;
  - **M5.2:**
    - store the per-head GST rate in `computed` (a tax invoice must show "CGST 9 %", Rule 46, VERIFY WITH CA);
    - embed the signature image bytes in the invoice snapshot at issue;
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
- **Batch (run files):** M3.4: a counter row for project codes; triggers backing the anonymised lock (M7.4); portal routes for shared notes and files (M7.1); orphaned R2 objects (M7.4); `delivered_at` (M5.1). M4.1: one shared first-word helper; website-form leads refuse retired codes; the "Show on website" description wording (owner, 07-L). M4.2: credit-note LUT/B2C warnings (M5.3); one LUT lookup (M5.2); `ROUND_OFF_BAND` kept a constant. M3.5 (on its branch): billed-period freeze, `last_billed_period`, terms per period from history (M5.4); export of time-log notes and `stats_daily` retention (VERIFY WITH CA/LEGAL). A local portal build copies `.dev.vars` into `dist` (local only; add a build guard).
- **M3.3 ([run file](runs/m3.3-clients.md)):** `contactId` in the document recipient snapshot and keep `CONTACT_ON_ISSUED_DOCUMENT_SQL` current (M4.2/M5); an invoice-currency trigger (M5); scope client-tied email kinds explicitly in the export when M4 adds them (VERIFY WITH CA/LEGAL); jobs skip a queued magic-link email whose token was deleted; the 0022 backfill folds ASCII case only; a component test for "Show more contacts".
- **M3.2 ([run file](runs/m3.2-leads.md)):** the `lead.reply` email restyled with the M4 email set; `email_log` rows of purged leads removed by M7.4's age job; the bundle's structural plan before M3.4.
- **M3.1 ([run file](runs/m3.1-admin-shell.md)):** the series-lock guard inside the issue batch (M3.2; VERIFY WITH CA/LEGAL); the bank purpose-code hint and senders reading the stored Settings › Email values (M5); bell-row erasure and pruning (M7.4); gateway secret names and a live gateway reverting when the go-live flag is turned off (Phase 7); optional audit export id (L-c); a lost bank-save response gives a false 409 (reloading recovers); remove the "hashing took N ms" line after the owner's phone timing check.
- **M2.5 ([run file](runs/m2.5-seo-perf-a11y.md)):** `zod/mini` on `/contact` and `/get-a-quote` (≈ 20 KB gzipped); not verified: Google's Rich Results validator, real LinkedIn/WhatsApp previews, Safari/Firefox.
- **M2.4b ([run file](runs/m2.4b-signin-email.md) "Re-check", "Handover"):** **Phase 7 checklist:** production `EMAIL_QUEUE` for admin and portal, the production Turnstile widget, fail the production SPA build on an empty `TURNSTILE_SITE_KEY` (via `check-prod-readiness.mjs`); product question "correct password, code never completed: alert?"; `/totp` and `/recovery` build the lockout alert before verifying (kept, rare and true); the React Turnstile wrapper is duplicated in admin and portal (share it when a third screen needs it); the break-glass CLI reset sends no email (prints a reminder); real mail clients beyond Zoho.
- **M2.4 ([run file](runs/m2.4-forms-leads-email.md)):** the Worker reads the seed catalogue while the pages read the snapshot (M4.1); retention for `email_log`, the `f:` counters and a D1 `dead_letters` row (retention job, VERIFY WITH CA/LEGAL); the "your time" line outside IST; a screen reader on the form pages (owner's NVDA pass; Lighthouse done in M2.5).
- **M2.3 ([run file](runs/m2.3-other-pages.md)):** renew `securityTxtExpires` before **2027-10-22**; before production set `site.launchDate` and every legal `effective` to the launch day; not verified: Safari/Firefox, forced colours, a screen reader, GA-on legal pages, the `deploy-prod.yml` run.
- **M2.1 ([run file](runs/m2.1-site-shell.md)):** remove `X-Robots-Tag: noindex` before production; legacy JS MIME types in the inline-script check; header-check host allow-list; WhatsApp `?text=` prefill.
- **M2.2 ([run file](runs/m2.2-home-services.md)):** "Who it's for" lines missing in 07 for some pages; the S5 UI/UX section; the empty row under the S11 hero price in INR; published-snapshot build failure and custom milestone labels (M4.1); not verified: real `/api/geo` swap, no-JS render, Safari/Firefox, screen reader (the FAQ keyboard, hub links, S3 404 and Lighthouse were closed in M2.5).
- **Earlier-work audit ([run file](runs/skill-audit-earlier-2026-10-22.md)):** heavy.sh process-tree kill on Windows; quote-aware comment stripping in the migration guard; tighter no-floats bigint exemption; post-condition for receipts/proformas/credit notes (M3/M5).
- **Skill audit ([run file](runs/skill-audit-2026-10-22.md)):** immutable cache for portal `/assets/*` (M4.5); tracing on staging after checking the Workers Logs quota; Phase 7 WAF/rate-limit also on web `/api/*` and auth routes; more binding types in `check-web-bindings.mjs`; `documents.parent_id` FK and issued-status transitions (M3/M5); retire catalogue items by deactivating (M4.1); GSTIN formats for TDS/UIN/NRTP (VERIFY WITH CA/LEGAL, M5); a single issue-batch builder in `packages/db` (M5); invoice emails say "View and pay".
- **M1.6:** M7.1 document-link audit throttling; merge the bundle guards.
- **M1.5:** break-glass audit-row read-back and an optional "still the only owner" guard; review items M2, L1, L2, L3, `session.tsx` state in an updater; DPDP retention/erasure for IP, user agent and location in the audit log (VERIFY WITH CA/LEGAL); a last-owner check on any future delete-user feature.
- **Social kit:** the Upwork banner's domain line after a real-device check.
- **Wallpapers (low, [run file](runs/brand-wallpapers.md)):** test-strength items.
- **Models and usage:** the cost report after M3.1 (Next 2).
- **Code (from 2026-10-07):** the G-11 `annualReturnFiledAt` input (M4/M5); "first character not `0`" in `numbering.ts`.
- **Content:** check the other "100 %" mentions in 04 against the content lint.
- **Re-measure:** the old site's TTFB from India, if it still matters before cut-over.
