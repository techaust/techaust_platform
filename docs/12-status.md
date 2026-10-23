# 12: Status

_Replaced (never appended) at the end of every session. Last updated: **2026-10-23, 21:45** (IST) (IST)._

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

- **M2.5 SEO, performance and accessibility: built and on staging, awaiting the owner's NVDA check and approval** ([PR #66](https://github.com/techaust/techaust_platform/pull/66); [run file](runs/m2.5-seo-perf-a11y.md)): JSON-LD graph on every page (checked against the visible FAQ, breadcrumbs and price), sitemap, per-environment robots.txt, llms.txt, a share image per page from the brand geometry, SEO tags and a 50 KB JS budget checked at build, Playwright (axe light and dark on 36 pages, keyboard, forms, CLS) and Lighthouse CI (mobile, 10 templates: performance 98–100, accessibility, best practices and SEO 100) in the CI `checks` job. Builder → designer → review (send back) → fixes → re-check APPROVE; CI green on Linux. NVDA guide: [runbooks/nvda-check.md](runbooks/nvda-check.md) ([PR #67](https://github.com/techaust/techaust_platform/pull/67)).
- **First cost report** ([PR #68](https://github.com/techaust/techaust_platform/pull/68); [appendix](14-models-and-usage-appendix/cost-report-2026-10-23.md)): the week was 20 points under the pace; no model or effort change recommended (the owner has not decided yet).
- **CPU tuning 3, staff emails and portal `/magic`: merged** ([PR #69](https://github.com/techaust/techaust_platform/pull/69); [run file](runs/cpu-staff-email.md)): the portal warms its sign-in path at start-up; queue log lines carry `iso`/`n` so staging readings separate cold from warm. Review and re-check APPROVE. Staging measurement waits for the owner.

## In progress
- **PR #69's staging deploy** runs after `main`'s CI (on its own; nothing to do).
- **[PR #70](https://github.com/techaust/techaust_platform/pull/70) (the overnight-batch decisions): open, auto-merge turned off** by the lead because the owner changed the overnight plan ("I have changed the plan", 2026-10-23 evening). The owner decides tomorrow whether it merges, changes or closes. The overnight session that opened it was stopped; nothing else of it exists (no other branch or PR).

## Next
1. **The owner's plan for the next build** (changed this evening; the lead asks first thing tomorrow, then updates or closes PR #70). Until the owner says otherwise, CLAUDE.md hard rule 2 stands: M3.1 starts only after M2.5 is approved, with its design preview approved first.
2. **M2.5 approval:** the owner's NVDA pass ([guide](runbooks/nvda-check.md)); any findings in a follow-up PR; then "approved", which closes M2.
3. **CPU staging test** ([run file](runs/cpu-staff-email.md) Step 3, about 10 minutes): sign in to staging admin from a new browser, use one recovery code, request a portal sign-in link; the lead reads `cpuTimeMs` with `iso`/`n`. Pass: each ≤ 7 ms. If cold (`n=1`) staff sends stay at 8 ms, the next candidate is deriving the SES signing key during the `staff.alert` expansion.
4. **M3.1 admin shell, users and settings** (Tier A; design preview first unless the owner's new plan says otherwise).

**Usage now:** weekly 39 %, 5-hour about 27 %; under the pace (≈ 60 %). Weekly reset **Mon 26 Oct, 15:30 IST**. Model audit: all runs within the plan.

## Waits on the owner
- **Today's items:** the NVDA check and "approved" for M2.5; the CPU staging test; the new build plan and PR #70; whether to accept the cost report's "no change".
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
- **M2.5 ([run file](runs/m2.5-seo-perf-a11y.md)):** `zod/mini` on `/contact` and `/get-a-quote` (≈ 20 KB gzipped saved; shared schemas used by two Workers); the zod `jitless` CSP guard for admin and portal (M3.1); not verified: Google's Rich Results validator, real LinkedIn/WhatsApp previews, Safari/Firefox, NVDA (owner).
- **CPU tuning 3 ([run file](runs/cpu-staff-email.md)):** staging Step 3 with the owner; if needed, the SES signing key derived during the `staff.alert` expansion; `/step-up` (up to 9 ms) and `/totp` in a later round.
- **M2.4b ([run file](runs/m2.4b-signin-email.md) "Re-check", "Handover"):** staff-email CPU before launch (Next 2); **Phase 7 checklist:** production `EMAIL_QUEUE` for admin and portal, the production Turnstile widget, fail the production SPA build on an empty `TURNSTILE_SITE_KEY` (via `check-prod-readiness.mjs`); product question "correct password, code never completed: alert?"; `/totp` and `/recovery` build the lockout alert before verifying (kept, rare and true); the React Turnstile wrapper is duplicated in admin and portal (share it when a third screen needs it); the break-glass CLI reset sends no email (prints a reminder); real mail clients beyond Zoho.
- **M2.4 ([run file](runs/m2.4-forms-leads-email.md)):** the Worker reads the seed catalogue while the pages read the snapshot (M4.1); retention for `email_log`, the `f:` counters and a D1 `dead_letters` row (retention job, VERIFY WITH CA/LEGAL); the "your time" line outside IST; a screen reader on the form pages (owner's NVDA pass; Lighthouse done in M2.5).
- **M2.3 ([run file](runs/m2.3-other-pages.md)):** the website liability cap into the settings defaults (M3.1); renew `securityTxtExpires` before **2027-10-22**; before production set `site.launchDate` and every legal `effective` to the launch day; not verified: Safari/Firefox, forced colours, a screen reader, GA-on legal pages, the `deploy-prod.yml` run.
- **M2.1 ([run file](runs/m2.1-site-shell.md)):** remove `X-Robots-Tag: noindex` before production; legacy JS MIME types in the inline-script check; header-check host allow-list; WhatsApp `?text=` prefill.
- **M2.2 ([run file](runs/m2.2-home-services.md)):** "Who it's for" lines missing in 07 for some pages; the S5 UI/UX section; the empty row under the S11 hero price in INR; published-snapshot build failure and custom milestone labels (M4.1); not verified: real `/api/geo` swap, no-JS render, Safari/Firefox, screen reader (the FAQ keyboard, hub links, S3 404 and Lighthouse were closed in M2.5).
- **Earlier-work audit ([run file](runs/skill-audit-earlier-2026-10-22.md)):** heavy.sh process-tree kill on Windows; quote-aware comment stripping in the migration guard; tighter no-floats bigint exemption; post-condition for receipts/proformas/credit notes (M3/M5).
- **Skill audit ([run file](runs/skill-audit-2026-10-22.md)):** immutable cache for admin/portal `/assets/*` (M3.1/M4.5); tracing on staging after checking the Workers Logs quota; Phase 7 WAF/rate-limit also on web `/api/*` and auth routes; more binding types in `check-web-bindings.mjs`; `documents.parent_id` FK and issued-status transitions (M3/M5); retire catalogue items by deactivating (M4.1); GSTIN formats for TDS/UIN/NRTP (VERIFY WITH CA/LEGAL, M5); a single issue-batch builder in `packages/db` (M5); invoice emails say "View and pay".
- **M1.6:** M7.1 document-link audit throttling; merge the bundle guards.
- **M1.5:** break-glass audit-row read-back and an optional "still the only owner" guard; review items M2, L1, L2, L3, `session.tsx` state in an updater; DPDP retention/erasure for IP, user agent and location in the audit log (VERIFY WITH CA/LEGAL); keyset pagination on `GET /users`, HIBP `connect-src` and removing the "hashing took N ms" line (M3.1, with the SPA CSP for `challenges.cloudflare.com`); a last-owner check on any future delete-user feature.
- **Social kit:** the Upwork banner's domain line after a real-device check.
- **Wallpapers (low, [run file](runs/brand-wallpapers.md)):** test-strength items.
- **Models and usage:** the next cost report after M3.1 ([14 §8](14-models-and-usage.md)).
- **Code (from 2026-10-07):** the G-11 `annualReturnFiledAt` input (M4/M5); "first character not `0`" in `numbering.ts`.
- **Content:** check the other "100 %" mentions in 04 against the content lint.
- **Re-measure:** the old site's TTFB from India, if it still matters before cut-over.
