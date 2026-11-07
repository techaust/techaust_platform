# 12: Status

_Replaced (never appended) at the end of every session._

## Date
**2026-11-07** (end of the day that began on 2026-11-06; the lead worked overnight on the owner's word). The next conversation starts with "start the day" (or "continue").

## Done
- **Phases 1–5, M1–M6 (37 milestones) approved.** Details in [runs/](runs/) and [13-decisions.md](13-decisions.md).
- **On `main` and on staging, awaiting the owner's check:**
  - **M7.1, the full client portal:** [#182](https://github.com/techaust/techaust_platform/pull/182).
  - **M7.2, notifications and digest:** [#184](https://github.com/techaust/techaust_platform/pull/184); the owner did H1–H4 and approved 07-ZQ.
  - **M7.3, reports and dashboard v2:** [#186](https://github.com/techaust/techaust_platform/pull/186); [run file](runs/m7.3-reports.md).
- **Dependency allow-list renewed to 2026-12-13:** [#188](https://github.com/techaust/techaust_platform/pull/188). CI would otherwise have failed from 2026-11-14.
- **M7.4, data protection: built, reviewed (APPROVE), re-checked (APPROVE).** The lead's final run is green. [#187](https://github.com/techaust/techaust_platform/pull/187) is CI green and **held**.
- **M7.5, hardening: built, reviewed and re-checked (both APPROVE).** [#189](https://github.com/techaust/techaust_platform/pull/189) is CI green and **held**.
  - Audits A1 (ASVS 5.0.0 L2 and Top 10:2025: no critical or high finding) and A2 (headers and budget); four runbooks; two analyst checks.
  - The lead's final run passed every package suite (≈ 12,980 tests), build and check; every Worker is under its limits.
- **M6–M7 full audit: all seven areas audited and every finding fixed or decided** (AU1–AU64; there was no critical finding).
  - The fixes passed two analyst early checks and a re-check, then review APPROVE and its re-check APPROVE; the lead's final run passed every package suite.
  - [#190](https://github.com/techaust/techaust_platform/pull/190) is **held**.

## In progress
- Three held PRs, stacked: [#187](https://github.com/techaust/techaust_platform/pull/187) (M7.4), then [#189](https://github.com/techaust/techaust_platform/pull/189) (M7.5), then [#190](https://github.com/techaust/techaust_platform/pull/190) (the audit).
  - They merge in that order. Each later branch takes `main` in after the earlier squash (CLAUDE.md's pre-squash-head rule).
  - Auto-fix is on for all three; auto-merge is off.
  - Each carries its own CLAUDE.md section and run file (with its Handover).
- Side worktrees: `../m74-side`, `../m75-side`, `../audit-side` (one per held branch). No agent is running.

## Next
1. **The owner's staging check of M7.1–M7.3**, then their approval. Then the lead reads the new routes' first-run CPU.
2. **#187 (M7.4):** the owner's three steps. The lead then turns on auto-merge. After the deploy come the staging steps (in the M7.4 run file).
3. **#189 (M7.5):** the owner's two steps. After its merge:
   - the owner runs the benchmark workflow (`suite=routes` three times, then `load`);
   - the lead reads I1 and I2 and runs the staging restore drill;
   - the owner decides between $5 and Free (J).
4. **#190 (the audit):** merges after #189. It has no owner step.
5. **Owner's copy page, then Phase 7** ([09](09-roadmap.md) L1–L11). Before L1:
   - the backup pipeline (N8; needs the owner's AWS bucket);
   - a "Rebuild PDF" tool;
   - the "refund returned" statement line, if the owner says yes.

## Waits on the owner
- **The M7.1–M7.3 staging check** (about 30–40 minutes; the lead gives each command in full).
  - **M7.1:**
    1. Run `pnpm portal:link --email <the sample finance contact> --staging` and open the link it prints.
    2. Home → a project → download a shared file.
    3. Profile → change the phone number → Save.
    4. Requests → "Get a copy of my personal data" → Send.
    5. Invoices → Pay (a sandbox payment) until it shows Paid.
    6. On an emailed "View & pay" link, press "I've paid".
    7. As the Owner in the staging admin, open Payments → Notices and the client's Requests tab.
    8. Check that a contact without "can see finance" sees no money.
  - **M7.2:** a simulator bounce and complaint, the digest (the first one arrives on Monday 9 November, 09:00–11:00 IST), the unsubscribe link, the unfinished sign-in email, and DKIM `h=`. Also confirm the custom event bus was deleted, and report the SES suppression-list setting.
  - **M7.3:** each report, and the Accountant role as read-only.
- **#187 (M7.4):**
  1. Run once: `powershell -ExecutionPolicy Bypass -File "D:\Business\1. Parent Project\TecHaust Technologies\Application\m74-side\scripts\set-erasure-hash-key.ps1"`, then copy back only the RESULT line.
  2. Say yes to the jobs Worker's `FILES` binding (list and delete only).
  3. Approve 07-ZR C1–C7 and the Rule 9 block. The postal address is still missing.
- **#189 (M7.5):**
  - **Q4:** create a read-only Cloudflare Account Analytics token, then run `scripts/set-cf-analytics-token.ps1` (the lead gives the clicks).
  - **Q2:** an Access Service Auth policy for the benchmark token on the portal and web staging apps.
  - **Questions:**
    - L47: the portal is at 163,583 bytes, past its 160,000 plan line (recommended: raise the line to 180,000 and don't split).
    - QA: where incident evidence is kept (recommended: a folder outside the repository).
    - QB: when to do the staging Time Travel rehearsal, with the owner present.
- **The owner's copy page** (one page of numbered lines, with the lead's recommendations):
  - 07-ZT C1–C3, the refund-came-back email;
  - the 07-ZP Requests empty line;
  - the RB-45 privacy line, so contacts know colleagues see their name and title;
  - the privacy notice's "New request" wording;
  - the Terms upload sentence;
  - the RA-29 fees note;
  - AU45, a "refund returned" statement line (recommended: build it before launch).
- **Hosted, on the owner's yes:** SES runbook Part 9, on the #190 branch: `techaust-marketing` suppression set to BOUNCE only, so a digest complaint never stops an owner's security alerts.
- **Before launch:**
  - the $5 Workers Paid decision (after M7.5's measurement);
  - the founder's bio facts;
  - the Zoho aliases (`billing@`, `hello`, `no-reply`, `privacy@`, `security@`);
  - the postal address;
  - the AWS backup bucket (N8);
  - SES production access;
  - the live gateway applications.
- **Earlier tests still open:**
  - the SES simulator test (it also checks `SES_EVENTS_TOKEN`; if `/ses` rejects the token, re-run `tools/set-gateway-keys.ps1 -Gateway ses-events`, now BOM-safe);
  - the unfinished sign-in email.
- **Optional:** a one-off CA view on 08-C RA-36/RA-41; the AD bank's written word before the first export refund (RB-43).
- **Dated duties** (steps in [settle-08c](runs/settle-08c.md)):
  - by 13 November, the October IFF, if an October credit note relies on it;
  - before the next export invoice, the FY 2026-27 LUT;
  - by 30 November, the October EDF, if any export invoice was raised in October;
  - monthly, reverse charge on foreign services;
  - every April, the turnover check;
  - once each: the Offline Tool test import, the CERT-In point of contact, the trademark search.
- **Renewals:**
  - the dependency allow-list by 2026-12-13 (M7.5 binds each entry to its versions and path);
  - the staging SES key `techaust-ses-sender-staging` by 2027-01-21;
  - the Access tokens `staging-cpu-benchmark` by 2027-10-17 and `staging-deploy-check` by 2027-10-30.
- **Model menu:** Opus 5.5, high, for every conversation.

## Open follow-ups
- **2026-11-07, new (the M6–M7 audit; its run file is on #190):**
  - AU45: the "refund returned" statement line (the owner's decision);
  - AU49: a partial index for reversed refunds if staging's rows read grow;
  - three more capped body readers to fold into `@techaust/core/body` (`apps/jobs/src/hooks/shared.ts`, `usage.ts`, `apps/web/src/forms.ts`);
  - the twelve monthly revenue cards at 768 px;
  - staging D1 `rows_written` for the retention budget;
  - real gateway and SES behaviour after a refund comes back;
  - the backup pipeline (N8) and a "Rebuild PDF" tool for a lost stored PDF (both before Phase 7 L1);
  - the break-glass CLI reset email to the member and the owners (L29).
- **2026-11-07, new (M7.5; its run file is on #189):**
  - Trusted Types (Phase 7, with e2e on three browsers);
  - the WAF rate-limit rule for anonymous refusals (Phase 7 L10);
  - the unindexed `staff_users` foreign keys (none is ever deleted);
  - the clock's 50-row read (L50);
  - jobs bytes 871 K of 1,000,000 (watch it);
  - start-up of the admin API, jobs and invoices Workers at 146–163 ms under load (gate 200);
  - "Show more" on the Notices table at 1024 px;
  - the M7.5 staging items: I1, I2, the restore drill, the key-match step, and `rate limiter failed` lines (must be zero on staging).
- **2026-11-06, new (M7.4; its run file is on #187):**
  - wire the postal address into `RULE9_BLOCK` and `check-prod-readiness`;
  - `GET /client-requests/:id` so a bell opens a request outside the current filter;
  - the advice-file test with only a removed link.
- **2026-11-06 (M7.3, [run file](runs/m7.3-reports.md) Handover):**
  - the INR-missing line in the USD views;
  - the readout above a short plot;
  - no-break bucket headings;
  - a shared meter track;
  - a `useShowMore` hook;
  - a cheaper per-client walk;
  - a newest-first broad search;
  - a same-months-last-FY comparison;
  - ageing at a past date (Tier A);
  - a Staff projects or time report;
  - the care overage amount;
  - staging first-run CPU of the new routes.
- **2026-11-05, new (M7.1, [run file](runs/m7.1-portal.md)):** the real-stack gateway payment e2e (stub + `pay-simulate.mjs`) never written; staging first-run CPU of the new portal routes (after the owner's check); NVDA on the new screens; a per-client open-requests badge on the client page's Requests tab; `invoice-advance.ts` taking a `noticeId` (L25, M7.2 or later); a 1024 px check of the Notices table with the menu expanded; Auto-fix couldn't be turned on by this session for #177, #179, #182 (the owner can, from the PR bar); `git worktree remove` leaves `node_modules` folders behind on Windows (delete them by long path afterwards).
- **2026-11-05, new (M7.2, [run file](runs/m7.2-notifications.md) on #184):** a forwarding mailbox's bounce isn't suppressed (SES's list is the backstop); `GET /emails` with `record {type, id}` so every row links; Easy DKIM over the one-click headers (check `h=` on staging); EventBridge Sandbox sample events as fixtures (facts 5 and 11 verbatim); the Owner's rail no longer fits a 900 px-tall window (scrolls); the Sent column shows a retried send's created time; the digest's reminder count copies M5.4's claim rules (one shared fragment); the pre-M6.5 credit-refund case gets no refund email (`no_document`); in-flight refunds count as refunded in full (consistent with M6.5).
- **2026-11-04 (M6.5):** one Razorpay sandbox refund as a check before Phase 7.
- **2026-11-04, new (tool scope, #175):** Phase 7 turns Sentry (`sentry@synced`) and the AWS connection (`deniedMcpServers` `aws-mcp`, and `plugin:aws-core:aws-mcp` in the local `~/.claude.json`) back on; the settings schema refuses `:` in a blocked server name, so plugin servers are blocked by URL or by their plugin being off.
- **2026-11-04, new (the formatted PC, [#173](https://github.com/techaust/techaust_platform/pull/173)):** the next Cloudflare tooling update takes wrangler 4.157.0 and `@cloudflare/vitest-plugin` 1.5.1 (released 2026-11-03, under the one-day age today); the Node 26 LTS move (CI follows `.nvmrc` 24; engines allow < 27), a decision for later; four slow tests time out in a full parallel `pnpm test` on this 8 GB PC and pass alone (`apps/web` `geo.test.ts` "India gets INR" and `cloud-setup.test.ts` cloud-pr dry run, `apps/admin` `password-policy.test.ts` ×2): add them to the flaky-under-load list; stopping `pnpm dev` on Windows leaves node and workerd running (with the heavy.sh process-tree item); the Playwright plugin runs `@playwright/mcp@latest` while `.mcp.json` pins 0.0.83 for the cloud (set by the plugin); GitHub squash commits carry the GitHub profile name "TecHuast Technologies" (the profile display name; the owner can correct it on GitHub).
- **2026-11-03, new (M6.5, [run file](runs/m6.5-receipts-refunds.md)):** record real sandbox refund, dispute and settlement payloads on staging and pin the readers (before M6.5's approval); an age-based `refund_stuck` (a refund the gateway keeps "pending" never opens it, L49); a client-scoped receipts list in the portal (M7.1, POR-07); a later `refund.failed` noted on an open `refunded_outside` item; a chargeback spread over two invoices; a bounded realisation scan; a maintained credit figure in place of the computed one; the credit-note dialog's reason not prefilled from the refund dialog (kept); the finance start-up re-read on a quiet machine (one reading of 142 ms under load; 72 ms quiet); not verified live: M4/M5 CSS, the "Show more" in a settlement, the RA-41 toast, the SWIFT default (source tests).
- **2026-11-03, new (#168 review):** a repo-wide `scripts/` guard in `pnpm check` for fetch options workerd refuses (every Worker source, both quote styles) (the gateway, SES and Turnstile calls use `redirect: "manual"` since the M6–M7 audit, #190). Lesson: a test that injects its own `fetch` hides runtime-rejected options; fakes now build workerd's `new Request(input, init)`.
- **2026-11-03, new (T11):** the `deed.signed` email is lost if its enqueue fails after the deed is signed (`apps/admin/worker/deeds.ts` `enqueueDeedSigned`): a sweep or a jobs retry.
- **2026-11-03, new (the fourth admin Worker, [run file](runs/admin-split-plan.md)):** the `finance-rpc.ts` warm fixture gets a made-up PayPal token and joins the secret-shape scan; a `BillingJobs` start-up dry run if `care.bill` reads hot on staging; staging cold readings of `GatewayAdvance` and the moved invoice routes; Phase 7: production creates the invoices Worker before the front, finance and jobs that bind it (runbook).
- **2026-11-03, new (M6.4, [run file](runs/m6.4-paypal.md) "Follow-ups (for 12)"):**
  - **Owner's staging run:** the PayPal facts above; then make the return's `token` required (review 1 finding 6); staging cold CPU of the capture RPC and the hook.
  - **Phase 7:** PayPal cert hosts tied to the mode; the live token and cert hosts; Table 11A/11B and refund-voucher documents for overpayment credit before the first live payment (08-C RA-41).
  - **Later polish:** stacked Payments-panel cards when the panel is narrow; the `?c=` ask honouring `retryAfterS`; tests for the Payment ID column and the empty Link payments step; `verifyPayPalSignature` returning the URL that verified; the "Without advice" count's scan if it grows; NVDA on the new screens.
  - **Process:** Auto-fix can't be turned on by this session for PRs it didn't open (#163) and wasn't sure of (#164); a cloud session the owner deletes leaves its merged work intact.
- **2026-11-02, new:**
  - **M6.5, from the staging fixes ([run file](runs/m6.3-staging-fixes.md)):** the void trigger `documents_void_no_payment` with the checkout rule (a trigger migration, the analyst's check); the proforma void/withdraw line for overpaid online money (still names "Confirm by issuing"); a partial index on pending payments if the link check's scans grow; **staging leftover:** TH/PI/2627/0002 shows a manual $23.60 receipt (TH/EXP/2627/0002) and the Stripe $23.60 held as credit (option A): refund that Stripe test payment in M6.5's refund test.
  - **M6.5, from M6.3 ([run file](runs/m6.3-stripe.md)):** a held `not_export_receipt` payment leaves Pay by card on; the panel returns the server's payable verdict for "Copy portal link"; gateway-neutral labels for "UTR or bank reference" on card payments. Not verified: the emailed-link Pay by card page; the refused-key state on Settings › Gateways; a `not_export_receipt` or refunded payment on screen (tests only).
  - **Before M7.1 (with the portal ceiling):** the unit words ("lump sum") in core for the portal's on-screen views and the admin preview; portal bytes 119,256 of 120,000 (watch in M6.4).
  - **Phase 7 (M6.3):** the hook's `livemode` check from the Settings mode; ask Stripe whether Checkout without a Customer is enough for export documents (RB-42); the purpose code for software exports (RB-06); the "Before going live" text on Settings › Gateways; a CA's opinion before the first live card receipt.
  - **PDF ([run file](runs/m6.3-staging-fixes.md)):** two-page short documents kept (a 2-line USD LUT export invoice with the SWIFT block, 18 mm over; one-line estimates, 30–71 mm over); not verified: Browser Run renders on staging, the CI page-count step's first Linux run (it ran on #160: green).
  - **CPU warm-up ([run file](runs/cpu-warmup.md)):** the figures above stand in for the `f:1` reading; finance start-up under load near 150 ms in one review run (trim the dry run past 150 ms); the invoice detail batches all nine note reads (only if D1 query counts matter).
  - **Portal local time ([run file](runs/portal-local-time.md)):** one shared zone-name rule in `@techaust/core/dates`; a `/o` e2e test in London.
  - **Process:** Auto-fix couldn't be turned on by this session for #153, #154, #157, #159 and #160 (the app wasn't sure it opened them; the owner can from the PR bar); briefs make agents check out before loading `code-review`.
  - **Flaky under load:** 5 s timeouts in `worker/offer-erasure.test.ts` and `worker/invoices-detail-batch.test.ts` (pass alone); the M6.2 vault test; local miniflare D1 "internal error" with two dev processes on one SQLite file (seen once by the reviewer, fine on retry).
- **2026-11-01, new:**
  - **T11 ([run file](runs/t11-deed.md)):** an Owner "Email again" for a failed `deed.signed` send; one look at a staging deed PDF rendered by Browser Run; the email in real mail clients; the Delivery 0.2 effective date set to the launch day with the others; the M3 PDF polling and the portal finance gate checked in a browser; the 375 px tab strip scroll (existing `Tabs`).
  - **M6.2 (not verified yet):** a local end-to-end `pay-simulate` run (jobs' local `ADMIN_GATEWAY` binding to the finance Worker inside Vite never connected); "Continue to Razorpay" clicked; the emailed-link Pay page live; Razorpay's `fee`/`tax` meaning, the paid-event payload layout and the fetched link's `payments[]` (a mismatch goes to review, never to the ledger); the staging CPU reading with the `f:1` marker; `refreshForClient`/`createLink` re-counted after T11.
  - **CA wording ([run file](runs/ca-wording.md)):** a clearer line 9 ("void or withdraw the old proforma, then issue a new one", new copy); 08-C RA-10 and RA-36 rows still say "OPEN (CA)"; `REALISATION_COPY.beforeFema` disagrees with 07-ZK line 4; the Settings › Terms "Researched default" tag.
  - **Polish sweep ([run file](runs/polish-sweep.md)):** the pre-existing Revoke-session paths (review finding 4, the reviewer's fix recorded there).
  - **Test hardening ([run file](runs/test-hardening.md)):** its "Follow-ups (for 12)" (items needing files T11 and M6.2 were editing).
  - **Style clashes ([run file](runs/css-collisions.md)):** the other switch screens after the ink bar not photographed; real Windows high contrast; the portal `.back` screenshot.
  - **Cloud:** the `security-review` skill still needs `origin/HEAD` in cloud clones; resumed agent runs show "skills: none" in `model-audit` (an artifact of resuming).
  - **Leftover folders:** empty `.claude/worktrees/agent-*` folders whose long paths `git worktree remove` couldn't delete; removed by long path, a few may remain.
- **M6.1 ([run file](runs/m6.1-ledger-payments.md)):** TDS after a full credit note (refund due or a revised TDS return? 08-C §5, decide with M6.5); the EDF "Amount realised" from payments (M6.5); `/payments` "All payments" by date received; Confirm's name for a 404 requested row; a server-side open-documents route past 500; `/payments/:id` behind the first page; the admin bell's "9+" accessible name (axe, since #78); no screenshot of "Move excess to credit"; not verified: the first finance deploy, a real `BillingJobs` call, D1 query plans and R2 conditional puts on staging, a Staff browser session.
- **T7 ([run file](runs/t7-offer-erasure.md)):** **F1 before Phase 7:** the 10-year finance backup must leave out proposals and estimates (or redacted rows); F3 queued `email_log` rows of an anonymised person; F4 a staging CPU reading of anonymise with 10 offers; **F5 before 13 May 2027:** a supported way to anonymise a person on more than 10 offers; after an anonymise the Emails row shows "Not sent", and the dialog title scrolls away.
- **Proforma withdraw ([run file](runs/proforma-withdraw.md)):** the portal `/document/pdf` read-to-view gaps (`PDF_STATE_SQL`); T6 code-review candidates to check (`packages/pdf/src/view.ts:212`, `apps/admin/src/lib/offers.ts:151`, `send-parts.tsx:112`); the Emails panel for a proforma withdrawn before its PDF; a read-only staging check of proformas voided after a view before FX-5 (owner's yes).
- **Cloud sessions:** the `playwright` MCP server looks for Chromium under `/opt/pw-browsers` while the setup installs it in `/opt/ms-playwright` (designers fell back to `@playwright/test`); the `security-review` skill needs `origin/HEAD` (`git remote set-head origin main`); Cloudflare skills don't load in cloud sessions, so model-audit flags agent runs with no skill (every run was Opus 5.5 at high).
- **T12 ([run file](runs/t12-retag-open.md)):** 08-C §6 the PA-CB realisation note (RB-01); RA-21 (a note's rate day) still OPEN; the privacy notice's EU/UK legitimate-interests cell (RB-12, legal pages v0.4). (The CA/lawyer screen lines were replaced by #142.)
- **T6 ([run file](runs/t6-terms-offers.md)):** a recipient picker for the staff reply (it greets the document's contact); the box on `expired` offers; offers sent before T6 show "(IST)" and line 3 in the portal but not in their stored PDF (kept); the admin `PORTAL_ORIGIN` config test lives in `apps/web/test` (CLAUDE.md mention); not verified: the real portal offer page and queued email (need jobs and Browser Run), a staging admin build. Lines 6, 9, 11, 12, 14, 15 rest on OPEN items (RB-23, RB-38(c)).
- **Parallel task sessions (2026-10-31):** the watcher counts only task-branch pushes (a builder pushing to a `fix/*` sub-branch looks quiet: fold into `/orchestrate`); Auto-fix can't be turned on from the main session for PRs a cloud session opened (the owner can, from the PR bar); `tools/agent-slots.mjs` doesn't hold the 2-agents-per-session cap of parallel runs (the prompt does).
- **Model audit (2026-10-31):** the rt2 integration builder (agent-ae999e0f) loaded no skill though it reported two; recorded in its run file.
- **rt1 ([run file](runs/rt1-notes-rules.md)):** (1) a migration that folds any legacy `tax.lut` into the list and drops the key, **before production**; (2) the 3B helper's IMS status per period (OPEN RA-04); (3) an optional "IFF filed" setting (OPEN RA-31); (4) show known blockers on a dialog's confirm step before step-up; (5) the draft row's 44 px inline link line gap (cosmetic).
- **rt2 ([run file](runs/rt2-signature-udyam.md)):** the invoice issue dialog's wrong-code notice and one shared `invalid_code` helper; a BEFORE INSERT signature trigger; inner spaces in a pasted Udyam number; one shared must-be-signed list; the `Field` scroll effect key; the save bar after a "No change" save; fresh visual baselines (invoice-udyam, advance, note fixtures); the duplicate PNG builder in `apps/admin/e2e/sample-data.ts`; the `.inv-udyam` 12em rule if the Udyam format ever changes; not verified: NVDA, Browser Run renders of the Udyam line and the signed notes.
- **Final sweep (2026-10-31, [run file](runs/final-sweep.md)):** the week grid's "1 h 45 min" wraps at 1280 with the menu open; the activity feed's label for a credit or debit note issue; same-name people in the Time Entries table; the website focus outline 1.6 px against docs/06's 2 px.
- **Workflows (2026-10-30, [run file](runs/audit-workflows.md)):** trace size and query-string redaction after a week (still to read on staging). Entry binding, the separate deploy job and web `/api/health` are done in M7.5 (#189); the allow-list was renewed (#188).
- **Research (2026-10-30, [run file](runs/settle-08c.md)):** still OPEN: RB-06 (purpose code, a bank fact), RB-21 (West Bengal stamp rate), RB-22(b) (read G.S.R. 789(E) before 1 Jan 2027), RA-34 (the GSTIN check test before Phase 7); also the FX day of a USD debit note, the IGST-route endorsement wording, the LUT ARN format.
- **M5 (2026-10-28, run files):**
  - a longer timeout for the M5.4 test "each send names the staff member…" in `apps/admin/worker/invoice-send.test.ts` (times out under a full parallel run);
  - export the realisation bounds (1,200 / 36,500) from core instead of three copies (M5.5b re-check low 4);
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
- **Batch (run files):** M3.4: a counter row for project codes; M4.1: one shared first-word helper; website-form leads refuse retired codes; the "Show on website" description wording (owner, 07-L). M4.2: `ROUND_OFF_BAND` kept a constant. M3.5 (on its branch): billed-period freeze, `last_billed_period`, terms per period from history (M5.4); export of time-log notes and `stats_daily` retention (VERIFY WITH CA/LEGAL).
- **M3.3 ([run file](runs/m3.3-clients.md)):** scope client-tied email kinds explicitly in the export when M4 adds them (VERIFY WITH CA/LEGAL); jobs skip a queued magic-link email whose token was deleted; the 0022 backfill folds ASCII case only; a component test for "Show more contacts".
- **M3.2 ([run file](runs/m3.2-leads.md)):** the `lead.reply` email restyled with the M4 email set; the bundle's structural plan before M3.4.
- **M3.1 ([run file](runs/m3.1-admin-shell.md)):** senders reading the stored Settings › Email values (M5.4); gateway secret names and a live gateway reverting when the go-live flag is turned off (Phase 7); optional audit export id (L-c); a lost bank-save response gives a false 409 (reloading recovers); remove the "hashing took N ms" line after the owner's phone timing check.
- **M2.5 ([run file](runs/m2.5-seo-perf-a11y.md)):** `zod/mini` on `/contact` and `/get-a-quote` (≈ 20 KB gzipped); not verified: Google's Rich Results validator, real LinkedIn/WhatsApp previews, Safari/Firefox.
- **M2.4b ([run file](runs/m2.4b-signin-email.md) "Re-check", "Handover"):** **Phase 7 checklist:** production `EMAIL_QUEUE` for admin and portal, the production Turnstile widget, fail the production SPA build on an empty `TURNSTILE_SITE_KEY` (via `check-prod-readiness.mjs`); product question "correct password, code never completed: alert?"; `/totp` and `/recovery` build the lockout alert before verifying (kept, rare and true); the React Turnstile wrapper is duplicated in admin and portal (share it when a third screen needs it); the break-glass CLI reset sends no email (prints a reminder); real mail clients beyond Zoho.
- **M2.4 ([run file](runs/m2.4-forms-leads-email.md)):** the "your time" line outside IST; a screen reader on the form pages. (Retention is M7.4; no `dead_letters` table exists.)
- **M2.3 ([run file](runs/m2.3-other-pages.md)):** renew `securityTxtExpires` before **2027-10-22**; before production set `site.launchDate` and every legal `effective` to the launch day; not verified: Safari/Firefox, forced colours, a screen reader, GA-on legal pages, the `deploy-prod.yml` run.
- **M2.1 ([run file](runs/m2.1-site-shell.md)):** remove `X-Robots-Tag: noindex` before production; WhatsApp `?text=` prefill. (The MIME types and the header host allow-list are done in M7.5.)
- **M2.2 ([run file](runs/m2.2-home-services.md)):** "Who it's for" lines missing in 07 for some pages; the S5 UI/UX section; the empty row under the S11 hero price in INR; published-snapshot build failure and custom milestone labels (M4.1); not verified: real `/api/geo` swap, no-JS render, Safari/Firefox, screen reader (the FAQ keyboard, hub links, S3 404 and Lighthouse were closed in M2.5).
- **Earlier-work audit ([run file](runs/skill-audit-earlier-2026-10-22.md)):** heavy.sh process-tree kill on Windows; post-condition for receipts (M6). (Quote-aware stripping and the bigint exemption are done in M7.5.)
- **Skill audit ([run file](runs/skill-audit-2026-10-22.md)):** Phase 7 WAF/rate-limit on web `/api/*` and auth routes; retire catalogue items by deactivating (M4.1); GSTIN formats for TDS/UIN/NRTP (batch Q26). (Portal cache, tracing and the binding allow list are done.)
- **M1.6:** M7.1 document-link audit throttling; merge the bundle guards.
- **M1.5:** a last-owner check on any future delete-user feature. (Break-glass guards, the review items and the audit IP scrub are done in M7.4/M7.5.)
- **Social kit:** the Upwork banner's domain line after a real-device check.
- **Wallpapers (low, [run file](runs/brand-wallpapers.md)):** test-strength items.
- **Models and usage:** the cost report after M3.1 (Next 2).
- **Content:** check the other "100 %" mentions in 04 against the content lint.
- **Re-measure:** the old site's TTFB from India, if it still matters before cut-over.
