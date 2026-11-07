Status: fixes reviewed (APPROVE) and re-checked (APPROVE), lead final checks green (2026-11-07); PR held until #187 (M7.4) and #189 (M7.5) merge
Tier: A (it covers money, gateways, refunds, client scoping, staff auth and deletion)
Usage: every run claude-opus-5-5/high (from `node tools/model-audit.mjs 2026-11-06`). Audits: B0, B1 and B6 analysts (`cloudflare:workers-best-practices`, plus `wrangler` for B0 and `workers-profiling` for B6); B2, B3, B4 and B5 reviewers, with no helper because of the 2-agent cap (`frontend-design`, `workers-best-practices`, plus `dataviz` for B2/B4 and `aws-core:aws-messaging-and-streaming` for B4). Fixes: builder AF1 (`workers-best-practices`, `wrangler`), AF1 fix leg (`workers-best-practices`, `wrangler`, `turnstile-spin`), builder AF2 (`workers-best-practices`, `wrangler`, `cloudflare`, `aws-core:aws-messaging-and-streaming`; resumed for the merge), builder AF3 (`workers-best-practices`, `wrangler`, `cloudflare`, `aws-core:aws-messaging-and-streaming`), designer (`frontend-design`, `dataviz`), review-fix builder (`workers-best-practices`, `wrangler`, `frontend-design`). Checks: AF1 early check, AF1 re-check and AF2 early check, analysts (`workers-best-practices`); reviewer (`code-review` with its read-only helper general-purpose claude-opus-5-5/high, `security-review`, `workers-best-practices`, `frontend-design`, `dataviz`); re-check reviewer (`workers-best-practices`, `frontend-design`). 5-hour readings 5–88 % in the first window and 0–37 % after the reset; `node tools/agent-slots.mjs` before each start; the only flagged runs are the `code-review` helpers (allowed, docs/14 §9)

# Full audit of M6–M7: review every milestone, fix every finding

**Owner's instruction (2026-11-07, night):**
> "Complete M7.5 and all the milestones. Then start the audit and complete."

The brief planned this audit after M7.5 ("After M7.5: the M6–M7 audit, then Phase 7"). Opus 5.5 at high effort throughout, as every task.

## Base and branches
- M7.4 (#187) and M7.5 are held PRs, waiting for the owner's hosted steps and approval. The audit reads the **M7.5 head** (`feat/m7.5-hardening`, which contains M7.4) so it covers everything.
- Fixes go on `fix/audit-m6-m7` from that head. Its PR merges after #187 and the M7.5 PR, in that order (CLAUDE.md "a later branch built on an earlier milestone's pre-squash head").
- **Rule 2 exception (owner's instruction):** the audit starts before M7.1–M7.5 are approved on staging.

## Scope: seven audit areas
Each area gets a fresh audit with no anchoring on earlier reviews. It reads the code, the tests, the PRD IDs against docs/04, docs/05 to 08 and 08-C, and does a visual pass where there are screens.

| Area | Milestones | What it covers | Auditor |
|---|---|---|---|
| B0 Money core | M6.1, M6.5, #160 | `packages/db` payments, allocations, ledger, recompute, refunds, receipts, reconciliation, `sql-rules.ts`, triggers 0059–0072; `packages/core` ledger, payments, refunds, receipts, the gateway judges; every amount, currency, TDS, FX and FEMA rule against 08-C | analyst |
| B1 Gateways and webhooks | M6.2–M6.4 | finance `gateway/` (Razorpay, Stripe, PayPal: links, sessions, orders, settle, capture claims, sweeps, refund events), jobs hooks (`/razorpay`, `/stripe`, `/paypal`), the RPC entrypoints, the portal pay paths, `PAYMENTS_LIVE_ALLOWED` and the key guards | analyst |
| B2 Finance screens | M6.1–M6.5 | admin Payments (record, verify, withdraw, credit, TDS, advices, notices, needs review, refunds, reconciliation, credit held), the invoice payment panels | reviewer (code and visual) |
| B3 Client portal | M7.1, M6.2–M6.4 portal parts | every portal route and screen: scoping (`forClient`, cross-tenant 404s), offers, invoices, pay, receipts, files, requests, profile, deeds, the emailed-link pages | reviewer (code and visual) |
| B4 Notifications and reports | M7.2, M7.3 | SES events, suppression, bells, staff prefs, the digest and unsubscribe, the Email log; reports, registers, exports, dashboard v2 | reviewer (code and visual) |
| B5 Data protection and the 2026-10-31/11-01 tasks | M7.4, T6, T7, T11, proforma withdraw | requests and the DSR clock, legal hold, retention and the R2 outbox, erasure and the keyed hash, consent receipts, offer redaction, deeds, offer terms | reviewer (code and visual) |
| B6 Jobs and operations | all of M6–M7 | `apps/jobs` (every queue kind, crons, dead letters, idempotency, sweeps' bounds), the 10 ms CPU and statement budgets, bundle ceilings, logs without personal data, the runbooks against the code | analyst |

M7.5 itself is not re-audited here: its own review and re-check cover it. B6 reads its runbooks and tools.

## Order and rules
1. M7.5 finishes first (review, fixes, re-check, held PR), so the audit reads its final head.
2. **Audits run two at a time,** at most one using a browser. The order is B0 + B3, then B1 + B2, then B4 + B5, then B6.
3. **Triage:** every finding of every severity is fixed, except items the record gives to Phase 7 or to an owner input. Each of those stays listed with its reason.
4. **Fixes:** a builder does data, logic and API, and a designer does screens. The Tier A areas (B0, B1, B3, B5) get an analyst early check before the screens.
5. **Re-check:** a reviewer re-checks each fix round; a second review follows any critical or high finding.
6. **Budget gate:** no new agent over 95 % of the 5-hour window (85 % while two run). The gate never changes a model or an effort.
7. **Owner items:** new copy goes on one page of numbered lines with a recommendation. Decisions that are the owner's go to the owner. Neither is guessed.

## What "verified" can and can't mean here
- **The lead can verify:** `pnpm check`, `pnpm test`, builds and budgets, local browser runs (widths, both themes, axe), CI.
- **Only the owner or a real device can verify:** staging behind Access, real Browser Run PDFs, real mail clients, real gateway sandboxes end to end, NVDA, phones, Safari and Firefox, the staging CPU readings. Each audit lists these as **not verified**, never as passed.

## Findings

### B0 Money core: analyst claude-opus-5-5/high, 2026-11-07, on f4b793ef
Skills `cloudflare:workers-best-practices`, `cloudflare:wrangler`. Read-only.
1. **High:** a Stripe refund that fails after `succeeded` (the bank returns the funds up to 30 days later, docs.stripe.com/refunds) is ignored: `gateway/refund-events.ts:91` short-cuts on `succeeded` before any re-fetch, `refund-flow.ts:234` returns, and trigger `payment_refunds_status_flow` forbids leaving `succeeded`. The ledger, statement and register keep a refund that came back; nobody is told.
2. **Medium:** `recon.ts:124-136` (`GATEWAY_UNSETTLED_SQL`, `MANUAL_UNTICKED_SQL`) and `CREDIT_HELD_SQL` (`packages/db/src/refunds.ts:359-370`) walk all confirmed payments on every page; no rows-read tests.
3. **Low:** the rejected and withdrawn payment lists scan `payments` by rowid (`payments.ts:386-389`).
4. **Low:** RA-40's credit-note link rule is in the route only, not in `refundInsertStatement`'s WHERE (`packages/db/src/refunds.ts:89`) or the trigger, though the comment says it is.
5. **Low:** `reductions.ts:148-150` drops a stored letter whenever `stored.created`, even if the winning row points at the same key; `reductionLetterStatement` has no anonymised-client guard.
6. **Low:** `realisationReductionStatement` and `bankMatchStatement` have no `NOT EXISTS (id)`, so a double submit gives a 500.
7. **Low:** `RECEIPTS_DUE_SQL` (oldest first, LIMIT 20) is blocked forever by receipts that can't be issued (a full series): no attempt count and no bell.
8. **Low:** the first gateway refund answer (`refunds.ts:514-515`) is applied without `isOurs` (amount, currency, id).
9. **Low:** a withdrawn payment keeps an active bank tick and advice link (`payments.ts:1067-1118`).
10. **Low (tests):** cancel's `refund_found` and `not_cancellable`, recon `match_exists`, the route's `reduction_refused` have no failure-path test.

**Lead's triage (2026-11-07):**
- **AU1 (1):** fix A, the safe reading.
  - A new trigger migration lets the system move a **gateway** refund `succeeded → failed` with `failure_code` and a set-once `reversed_at`. It's allowed only from the gateway path after a re-fetch confirms `failed` (Stripe `failed`, or `requires_action` after success).
  - The webhook re-fetches before the `succeeded` short-cut. The refund's money returns to the client's credit through the existing non-failed readers.
  - One review item `refund_reversed` and one owners' bell, once per refund.
  - Razorpay and PayPal take the same path if their answer ever says failed after success.
  - The client email about it is new client copy, so it's held behind a copy gate until the owner approves the line (07, next letter); the staff lines are the lead's.
- **AU2 (2, 3):** the recon lists use `payments_confirmed_provider` with literal provider filters. Rows-read tests at 2,000 and 5,000 payments for all three lists; `CREDIT_HELD_SQL` gets bounded if it's over 9,000. For finding 3, an index on `(status, received_on, id)` (CREATE INDEX only) and a keyset on `received_on`.
- **AU3 (4–8):** as proposed. Finding 7 counts failures per payment, leaves the payment out after 3, rings one bell, and gives a `series_full` reason.
- **AU4 (9):** A. The withdraw is refused with 409 `payment_linked` (route and WHERE) while an active bank tick or advice link exists. The Owner removes them first.
- **AU5 (10):** one failure-path test each.

### B1 Gateways and webhooks: analyst claude-opus-5-5/high, 2026-11-07, on f4b793ef
Skills `cloudflare:workers-best-practices`. Read-only. No critical or high finding.
- **M1 (medium):** a payment partly refunded before we first settle it.
  - Razorpay (`packages/core/src/razorpay.ts:287-365`, `settle.ts:647-716`) confirms the full amount, because it never reads `amount_refunded`. A refund event that arrives first is dropped as `not_ours` (`refund-events.ts:132`).
  - Stripe (`core/stripe.ts:655-657`, `stripe-settle.ts:339-348`) and PayPal (`core/paypal.ts:607`, `paypal-capture.ts:484-488`) raise an item only. The money we kept never enters the books.
- **L1:** the Stripe hook keys on the flag alone (`hooks/stripe.ts:112-126`) while finance uses mode and flag, so test events are dropped while the flag is true and the mode is still test.
- **L2:** calls that carry credentials follow redirects (`gateway/razorpay.ts:114`, `stripe.ts:140`, `paypal.ts:130`, `paypal-token.ts:51`).
- **L3:** gateway answers are read in full with `res.json()`, with no size cap.
- **L4:** the Stripe hook answers 400 to a signed body it can't parse (`hooks/stripe.ts:99-110`), and Stripe retries and may disable the endpoint.
- **L5:** Razorpay has no stale-link refresh in the sweep (`STALE_LIVE_CHECKOUTS_SQL` covers Stripe only).
- **L6:** PayPal's sweep expiry writes no audit row (`paypalExpireUnclaimedStatement`).
- **L7:** `live_not_allowed` during a re-fetch is permanent for Razorpay and Stripe but retried for PayPal.
- **L8:** the sweep's `sendBatch` holds up to 90 messages, close to the Queues limit of 100.

**Lead's triage (2026-11-07):**
- **AU6 (M1):** as proposed. Razorpay reads `amount_refunded`. All three judges get a "partly refunded" verdict: a pending row with no ledger move, `checkoutPaid: "if_open"`, and a `refunded_outside` item carrying the refunded amount. A full refund stays item-only. Tests: one per gateway, plus the refund event that arrives before `payment_link.paid`.
- **AU7 (L1–L8):** all as proposed:
  - L1: while the flag is true, store both modes with `livemode` and let the judge decide.
  - L2: `redirect: "manual"`, with a 3xx mapped to `bad_answer`.
  - L3: a capped read of 256 KiB.
  - L4: 200 with `invalid_event` logged, plus a lenient row when the ids can be read.
  - L5: Razorpay links that have been live for at least 1 hour and not refreshed in 6 hours, at most 10 an hour.
  - L6: guarded system audit rows.
  - L7: `live_not_allowed` is retried like `unconfigured`.
  - L8: chunks of at most 100 messages, with a test.

### B6 Jobs and operations: analyst claude-opus-5-5/high, 2026-11-07, on f4b793ef
Skills `cloudflare:workers-best-practices`, `cloudflare:workers-profiling`. Read-only. No critical or high finding.
- **M1:** the live retention run has no write budget per run (`apps/jobs/src/retention.ts:221-224`; 500 rows per table per page, pages re-sent until done). A backlog after months of dry runs can use up D1's 100,000 rows written a day for the whole account, so every query is refused into business hours. The dry-run count caps at 10,000 without saying so.
- **M2 (M7.5 runbook):** drill-log.md steps 3–4 load into one database and verify another; it should use `drill:verify --import`. The migration count is stale.
- **M3 (M7.5 runbook):** restore.md's "look back and copy" drops writes made while rewound: webhook events (paid money unrecorded), `doc_counters` (duplicate numbers) and emails. Queue delivery should be paused, staff kept out, and payments reconciled afterwards.
- **L1:** bells used as once-only markers (`pdf.refused`, the alerts' "one bell ever") are deleted by the `bells` retention family, so refusals and alerts ring again.
- **L2 (M7.5):** `usage.daily` goes silent on a 401/403 or a missing token; it needs one owners' bell per IST day.
- **L3 (M7.5):** the usage reading lags about 27.5 h; enqueue it from the 06:00 IST tick instead.
- **L4 (= B0 7):** the receipt issue sweep has no attempt bound and no rotation.
- **L5:** dead letters of `refund.notify`, `staff.notify`, `digest.weekly`, `signin.unfinished` and `bells.sweep` get only the generic alert. A dead-lettered `refund.notify` falls outside the 75-minute lookback, so the client never gets the email. A dead-lettered `recon.fetch` day is lost.
- **L6:** a `pdf.deed` dead letter is only logged.
- **L7 (runbook):** environments.md has drifted: the FILES bindings, the cron messages, the health-check order, jobs' required secrets, the events queue.
- **L8 (M7.5 runbook):** incident.md has drifted: F1 and F4 now exist, the analytics token script, the `magic_link_tokens` trigger, a line reference.
- **L9:** cpu-baseline.md's jobs figures are stale (856,445 bytes; 161 ms start-up).
- **L10 (M7.5):** the route inventory never fills the jobs `email`, `lead` and DLQ rows (the label join).
- **L11 (M7.5 runbook):** budget-audit.md must say the D1 limits are per account (staging and production share them).
- **L12:** restore.md §4.1 misses deed numbers.
- **L13:** the `requests.clock` reads only 50 open requests (= L50 of M7.4, recorded).

**Lead's triage (2026-11-07):**
- **AU8:** the M7.5 items (M2, M3, L2, L3, L7, L8, L9, L10, L11, L12) are fixed in M7.5's review fix round.
- **AU9 (M1):**
  - each live family stops after 20 pages per run and marks "more tomorrow", and the run still finishes and rings its bell;
  - the dry-run count shows "10,000 or more" when capped;
  - test it.
- **AU10 (L1):** the refusal is recorded outside `notifications` (`pdf_failures.refused_at` by ADD COLUMN), and the marker kinds are left out of the `bells` family. Both ways get tests.
- **AU11:**
  - L4 is fixed with B0 7.
  - L5: name the kinds in the dead-letter alert; a `refund.notify` dead letter rings a bell with the client code; the 09:00 tick also fetches the day before yesterday, after proving storage is idempotent.
  - L6: one owners' bell.
  - L13 stays as L50.

### B3 Client portal: reviewer claude-opus-5-5/high, 2026-11-07, on 6465a264
Skills `cloudflare:workers-best-practices`, `frontend-design`; no helper, because of the cap. Portal tests 950/950. Visual at 390, 768 and 1280 in both themes: axe 0, no CSP violation, 44 px targets. No critical or high finding.

**Medium:**
- **M1:** `POST /t/document` (`doc-token.ts:160-205`) serves the summary from the first batch's read and writes the view in a second batch with no `linkLiveSql`, so a void landing between them passes (RA-10).
- **M2:** 07-ZR is unapproved, so the Profile request dialog and request rows show `[Placeholder]`. This waits on the owner.
- **M3:** API error bodies still carry "[Placeholder] C15/C17/C24" (`paid-notice.ts:71`, `profile.ts:47`, `requests.ts:49-50`), which `check-prod-readiness` would block.
- **M4:** the privacy notice lacks RB-45's line (colleagues with portal access see a contact's name and title). Owner copy.
- **M5:** the privacy notice names a "Request my data" control that doesn't exist (`legal-pages.ts:287`). Owner copy.
- **M6:** Profile › Requests has no empty state, and "New request" floats mid-page at 1280 px (`profile.tsx:264-292`, `m71.css:615-638`). Copy gap for the owner, plus layout.

**Low:**
- **L1:** receipt emails link to `/invoices`, not `/receipts` (`apps/jobs/src/receipts.ts:297`, `apps/admin/worker/receipt-send.ts:127`).
- **L2:** `/pay/paypal/return` and `/auth/logout` do D1 work with no limiter, and no reason is recorded.
- **L3:** `SESSION_READ` (`guard.ts:93-94`) doesn't hold `cl.anonymised_at IS NULL`.
- **L4:** a stale "OPEN (08-C RB-45)" comment (`profile.tsx:2-3`).
- **L5:** Home's empty states use two styles.
- **L6:** the Terms mention client uploads, but the portal has none (`legal-pages.ts:454`). Owner copy.

**Lead's triage (2026-11-07):**
- **AU12 (M1):** the second batch writes the view first, guarded on `linkLiveSql`, then re-reads the summary and serves only from that re-read; if it's gone, a 404 with no `p:fail:` count. A race test like the `PDF_STATE_SQL` ones.
- **AU13 (M3, L1, L2, L3, L4):**
  - M3: the approved 07-ZP words go in the `message` fields.
  - L1: both URLs change to `/receipts`.
  - L2: `/pay/paypal/return` joins `RL_LINKS` and `/auth/logout` joins `RL_SIGNIN`.
  - L3: the join holds `cl.anonymised_at IS NULL`.
  - L4: the tag becomes "Settled".
- **AU14 (M6 layout, L5):** the designer aligns the Requests head with the grid and makes Home's empty states consistent, or records why they differ.
- **Owner's copy page (morning):**
  - M2: approve 07-ZR, which already waits;
  - M4: the RB-45 privacy line;
  - M5: the "New request" wording in the privacy notice;
  - M6: the Requests empty line;
  - L6: the Terms upload sentence.

  The lead drafts each with a recommendation; legal pages get a version bump when the owner approves.

### B2 Finance screens: reviewer claude-opus-5-5/high, 2026-11-07, on 326ff504
Skills `frontend-design`, `dataviz`, `cloudflare:workers-best-practices`; no helper. Verdict SEND BACK (one high). Local live flows: record, refund from credit, RA-40 panel, stub link, withdraw refusal, Fetch now, advices. axe 0, no sideways scroll, 44 px targets, both themes against the OS.
1. **High:** the focus ring is invisible on unselected tabs, on every admin screen that uses `Tabs`. `app.css:89-91` (`[tabindex="-1"]:focus { outline: none }`) meets the manual-activation tabs' `tabIndex=-1` (`components/tabs.tsx:81`). WCAG 2.4.7.
2. **Medium:** "Send receipt again" never marks refused contacts. The server sends `details.contactIds` (`receipt-send.ts:87`), but the SPA reads the top-level `contactIds` (`api.ts:1277`).
3. **Medium:** the gateway's refusal `code` is missing from `PAYMENT_DETAIL_KEYS`, so the refund dialog never shows the gateway's reason (`api.ts:1300-1316`, `refund-dialog.tsx:379`). Also, `refundableMinor` and `holdingMinor` are read but never sent (`:368-376`).
4. **Medium:** "Withdraw" is offered on a payment that has a refund, and the server always refuses it (`payments.tsx:771-776`, `payments.ts:1113`).
5. **Low:** a confirmed payment's dialog doesn't state the part kept as credit (`payments.tsx:974-990`).
6. **Low:** the single-group FilterBar on the Refunds tab wraps "Failed" at 1280 px.
7. **Low:** "Make the PDF again" on a receipt has no busy guard (`refund-parts.tsx:318-330`).
8. **Low:** the Reconciliation fees note reads like an internal note (RA-29 is OPEN).

**Lead's triage (2026-11-07):**
- **AU15 (1):** scope the rule to the elements it was written for (headings and dialog titles with `tabindex="-1"`), give `.tabs__tab` a `:focus-visible` ring, and add an e2e step that arrows across a tablist and asserts an outline.
- **AU16 (2, 3, 4, 7):**
  - 2: receipt-send answers like `recipientRefusal` (top-level `contactIds`), with a screen test;
  - 3: add `code` to `PAYMENT_DETAIL_KEYS` and delete the dead branch;
  - 4: `GET /payments/:id` sends `hasLiveRefund`, and Withdraw is hidden with the line beside it;
  - 7: mark busy before the request.
- **AU17 (5, 6):** designer: a "Kept as credit" row from existing 07-ZH words, and a single-group FilterBar at one column.
- **AU18 (8):** kept, since it states OPEN 08-C RA-29 honestly. The owner's copy page offers a staff-facing wording: "We show Razorpay's fees and their GST as absorbed until we confirm how Razorpay invoices them."

### B4 Notifications and reports: reviewer claude-opus-5-5/high, 2026-11-07, on d83579bb
Skills: `cloudflare:workers-best-practices`, `dataviz`, `frontend-design`, `aws-core:aws-messaging-and-streaming`. No helper. Verdict: APPROVE, with nothing critical or high.

Ran:
- jobs `ses-hook` and `m72-jobs`: 47 passed;
- admin, 6 files: 74 passed;
- e2e `m72-notifications` and `m73-reports` (`E2E_SAMPLE=1`; axe at 3 widths, both themes): 30 passed.

The tab focus-ring finding (B2 1) doesn't reach these screens: they have no tablists.

**Findings:**
- **M1:** `care-billing.ts:182-188` `recipientsOf` ignores `email_suppressions` and `bounced_at`. A care invoice can auto-issue to a stopped billing contact with the bell saying "issued and emailed"; the pipeline then skips the email and reminders run against a dead address.
- **M2:** on the Care plan hours report at 390 px, the period text overflows into "Included" (`reports.css:1197` `nowrap`, `care-hours.tsx:83`). The e2e checks no overflow inside a cell.
- **L1:** a complaint on the non-transactional digest suppresses the owner's whole address, so security alerts stop too (`email-events.ts:85-99`).
- **L2:** the send routes count stopped recipients in `document_sends` and in the `queued` number (`receipt-send.ts:65-67,101`, the invoice and offer sends, `refund-notify.ts:51-55`). The pipeline is the real guard.
- **L3:** the email log says "Sent" in the list but "Queued" on the detail page for the same `created_at`.
- **L4:** at 768 px the Reports navigation strip cuts its last item ("Care pla") with no fade.
- **L5:** at 768 px the revenue tables scroll sideways inside their regions.
- **Note:** an orphan `workerd.exe` (PID 7424) may be left over. The lead checks.

**Lead's triage (2026-11-07):**
- **AU19 (M1):** leave out suppressed addresses and erased `h:` keys in `CONTACTS_OF_DOC_SQL` / `CONTACTS_OF_PLAN_SQL` (or in `recipientsOf` plus the sends WHERE). With no contact left, take the `notEmailed` path. Add a test.
- **AU20 (L1):** a complaint whose `email_log.template` is non-transactional switches that member's digest off (`digest_off_via`) instead of suppressing the address. Add a test.
- **AU21 (L2):** `NOT EXISTS` against suppressions in every send's INSERT WHERE and in `REFUND_CONTACTS_SQL`, so the `queued` count is true. Add tests.
- **AU22 (M2, L3, L4, L5), for the designer:**
  - M2: dates stay whole, a wrap is allowed at "to", and a cell-overflow assertion goes in the m73 e2e.
  - L3: one label for that time on both screens.
  - L4: an edge fade on the strip, or wrap it.
  - L5: cards below about 900 px.

### B5 Data protection and the 2026-10-31/11-01 tasks: reviewer claude-opus-5-5/high, 2026-11-07, on 00ae8fbf
Skills: `cloudflare:workers-best-practices`, `frontend-design`. No helper. Verdict: APPROVE, with nothing critical or high.

Ran:
- admin: 126/126;
- db: 135/135;
- jobs: 28/28;
- core: 65/65;
- e2e `m74-data-protection` and `t11-deed`: 22/22.

**Findings:**
- **M1:** deleting a note or file of a held client answers 500 (`notes.ts:185`, `files.ts:322`). The triggers `notes_held_no_delete` / `files_held_no_delete` raise, nothing catches it, and the SPA still offers Delete.
- **M2:** the lead export lacks `processors` and the lead's own `client_requests` (`lead-data.ts:138-147`); the contact export has both. DPDP s.11(1)(b); RB-36.
- **L1:** a hold on a client or contact doesn't stop the erase or purge of an unconverted lead with the same address (`lead-data.ts:76-87`, `leads_held_no_*`, `LEAD_DELETABLE_SQL`).
- **L2:** `documents_held_no_redact` fires only on the first redaction (`0079:72`).
- **L3:** a done access request accepts an export date before `received_at` (`client-requests.ts:90`, `0079:190`).
- **L4:** a `consent_withdrawal` request can close `done` without proof of the withdrawal.
- **L5:** the lead erase dialog's staff line understates what is kept (`copy-zr.ts:378`).
- **L6:** the `suppression.lift` audit row keeps the keyed hash for good; anonymising keeps the staff `close_note` on requests and payment notices.
- **L7:** at 768 px the lead page's h1 wraps beside three buttons.

**Lead's triage (2026-11-07):**
- **AU23 (M1):** the DELETE WHERE gets `NOT EXISTS (held)` and answers 409 `legal_hold` with the S1 line. The SPA hides Delete while held. Worker tests and an e2e step.
- **AU24 (M2):** `processors: processorsBlock()` and a paged `client_requests` part in the lead export, with tests.
- **AU25 (L1, L2, L3, L6):** in a new trigger migration (never editing 0079):
  - L1: `HELD_EMAIL_SQL` in the lead erase's first row and the purge's due rule, mirrored in the two lead triggers;
  - L2: the redaction hold fires on every redaction;
  - L3: export date ≥ `received_at` in the route and the trigger;
  - L6: the audit summary of `suppression.lift` drops the hash, and anonymising clears both `close_note`s.

  Tests for each.
- **AU26 (L4):** settled on the safest reading (DPDP s.6(4)–(6)): a `consent_withdrawal` request closes `done` only with a linked `lead.consent_withdraw` audit row or a contact consent-change row after the request arrived (route, WHERE and trigger). Otherwise it's declined with a reason.
- **AU27 (L5):** staff line, reworded by the lead: "A scrambled form of the address is kept only to stop emails to it and to prove what they agreed to. Email records keep the address until they expire."
- **AU28 (L7):** designer. The actions wrap under the title below about 900 px.

## AF1 report (Early check): builder claude-opus-5-5/high, 2026-11-07, branch `fix/audit-af1` (from `origin/fix/audit-m6-m7` 00ae8fbf, merged 8563097f)
Tier A: stopped here for the analyst's early check (schema, migrations, core logic, routes and their tests are done; the designer's layout work on the Payments screens is not started).

**Skills loaded:** `cloudflare:workers-best-practices` (redirect and body-size guards on credentialed gateway calls, no `ctx` misuse, generated `Env` only); `cloudflare:wrangler` (no config or binding changed, so nothing to regenerate; used to confirm no `wrangler.jsonc` edit was needed). Context7 (PayPal REST spec) checked whether a capture carries a refunded total: it does not in the published capture schema, so PayPal's partial-refund item says "part of it" (not verified on a sandbox).

### Changes
**Migrations (my own two; AF2 takes the next number):**
- `packages/db/migrations/0081_audit_money.sql` (drizzle-generated, ADD COLUMN and CREATE INDEX only): `payment_refunds.reversed_at`; `payments.receipt_failures` (NOT NULL DEFAULT 0), `receipt_tried_at`, `receipt_fail_reason`, `receipt_fail_version`; partial index `payments_status_received (status, received_on, id) WHERE status IN ('rejected','withdrawn')` (partial so no other query's plan can pick it: an unpartial one stole `payments_proof_awaited`'s plan in `stripe.test.ts`).
- `packages/db/migrations/0082_audit_money_triggers.sql` (set `audit_money_triggers`, `scripts/write-triggers.ts`): drops and recreates `review_items_values_insert/update` (kind `refund_reversed`), `payment_refunds_bounds` (RA-40: a linked credit note issued on or after the payment's day and covering the refund) and `payment_refunds_status_flow` (a GATEWAY refund, not manual and not a chargeback, with a gateway id, may move `succeeded → failed` once, with `failure_code` and `reversed_at` set in the same move and its settled time and day kept; `reversed_at` only by that move). No table rebuilt; `scripts/check-migrations.mjs` ok (83 migrations). 0070's output is byte-identical (the drift test in `triggers.test.ts` passes).
- `packages/db/src/triggers.ts` (`refundTriggerParts("0070"|"0082")`, `gatewayTriggerParts` gains `"0082"`, `REVIEW_KINDS_0082`, `AUDIT_MONEY_RECREATED_*_0082`), `packages/db/src/schema/payments.ts`.

**AU1 (B0 1), a gateway refund that fails after `succeeded`:**
- `packages/core/src/refund-gateways.ts`: Stripe's `requires_action` is marked (`requiresAction`); `reversalOf(g)` (failed → the gateway's code; `requires_action` → `stripe_requires_action`).
- `packages/db/src/refunds.ts`: `refundReverseStatement` (every rule in the WHERE, bound to the gateway id); `reversed_at` in `REFUND_COLS`.
- `apps/admin/worker/refund-flow.ts`: `reverseIfFailed` (ONE batch: reverse, audit `refund.status` with `reversed: true`, then guarded on it the `refund_reversed` item and the owners' bell once per refund, and the event's move: 4 to 5 statements); `isOurs` exported and now also checks currency and the gateway id we hold.
- `apps/admin/worker/gateway/refund-events.ts`: a refund of ours that succeeded is re-fetched before anything (manual, chargeback, already reversed or no gateway id: quiet as before); answer `{needs_review, refundReversed}`.
- Money back to credit through the existing readers (status `succeeded` / not `failed`): proved in `packages/db/test/refund-statements.test.ts` (free money, `CLIENT_CREDIT_SQL`, statement totals, Collected, refunds register).
- The client email (07-ZT C1–C3, OFF): `packages/core/src/copy-zt.ts` (`APPROVED_07ZT = false`, every line "[Placeholder] "), `packages/core/src/notifications.ts` (`refund.reversed` message), `packages/core/src/gateway-rpc.ts` (`refundReversed`), `packages/core/src/email-templates.ts`, `packages/email/src/{notifications,index,fixtures}.ts` (the builder's plain template, as `request.received`; snapshots `packages/email/test/__snapshots__/all/refund-reversed.*`), `apps/jobs/src/refund-notify.ts` (`processRefundReversed`, `refundReversedCopyGate`: held outside local), `apps/jobs/src/queue.ts`, `apps/jobs/src/gateway.ts`. Copy drafted in `docs/07-content-appendix/ZT-audit-money.md`.

**AU2 (B0 2, 3):**
- `apps/admin/worker/recon.ts`: both lists read `payments_confirmed_provider` with literal providers, in a bounded window of `RECON_SCAN` (1,000) payments per page (the unbounded manual list read **10,000 rows at 5,000** bank payments: over target, so it is bounded like credit-held). Pages hold exactly the unbounded answer (test with two unticked payments across windows).
- `packages/db/src/refunds.ts`: `CREDIT_HELD_SQL` read **15,013 rows at 5,000** payments (6,000-ish at 2,000), so it is now `creditHeldSql(CREDIT_HELD_SCAN = 1,000)` with `creditHeldPage` (the route: `apps/admin/worker/credit-held.ts`); twin-tested against `CREDIT_HELD_SQL_UNBOUNDED` at 2,000 and 5,000 and with a 50-payment window (`packages/db/test/credit-held-rows.test.ts`); every page ≤ 9,000 rows (asserted). A page may hold fewer than 50 rows and still give `next` (API shape unchanged).
- `apps/admin/worker/payments.ts`: rejected/withdrawn list through `payments_status_received`, keyset `(received_on, id)` (the rowid branch removed).

**AU3 (B0 4–8):**
- RA-40 in `refundInsertStatement`'s WHERE and in the 0082 trigger (tests: statement 0 rows, trigger abort, the covering note accepted).
- `apps/admin/worker/reductions.ts`: the letter is dropped from DOCS only when the row doesn't name that key (also on the throw path); 409 `client_gone` before upload and in `reductionLetterStatement`'s WHERE.
- `NOT EXISTS (id)` in `realisationReductionStatement` and `bankMatchStatement`; on zero rows the routes re-read by id: the same request → 200, the same id with other details → 409 (`reduction_exists`, `match_exists`) (`REDUCTION_BY_ID_SQL`, `BANK_MATCH_BY_ID_SQL`).
- Receipts (`packages/db/src/receipts.ts`, `apps/admin/worker/receipt-issue.ts`): `RECEIPTS_DUE_SQL` never-tried first, then least recently tried, left out after 3 failures under one numbering version (back when the numbering settings change); `receiptFailureStatements` (2 statements: the count, then ONE owners' bell `receipt.blocked` guarded on exactly the third failure at this instant); `series_full` reason. **Found while testing:** the refused issue's own abort ("issue did not freeze…") wasn't matched by the catch, so a full series THREW (the sweep's message died in the DLQ every hour); now a counted refusal. Closes B6 L4.
- `isOurs` on the first gateway answer in `apps/admin/worker/refunds.ts` (not ours → 202 `requested`, the sweep finds it by our id).

**AU4 (B0 9):** `packages/db/src/ledger.ts` `NO_ACTIVE_LINK_SQL` in the withdraw WHERE; `apps/admin/worker/payments.ts` re-read → 409 `payment_linked`; `apps/admin/worker/payment-messages.ts`; SPA line in `PAY_ERRORS.payment_linked`.

**AU5 (B0 10):** failure-path tests: cancel `not_cancellable` and `refund_found` (gateway already holds it: the row follows, 409), recon `match_exists` (another target, a second tick), `reduction_refused` (above the total), non-export 404.

**AU6 (B1 M1):** `readRazorpayPayment` reads `amount_refunded` (`refundedMinor`); verdict `partly_refunded` in all three judges (`packages/core/src/{razorpay,stripe,paypal}.ts`; Stripe and PayPal after RA-38's `not_export_receipt`, whose tax consequence comes first; Razorpay before the amount check); `settle.ts`, `stripe-settle.ts`, `paypal-capture.ts` record it pending (no ledger move, `checkoutPaid: "if_open"`) with a `refunded_outside` item carrying `refundedMinor` (PayPal: `reason: partly_refunded`, no amount); a full refund stays item-only. Tests: core judges per gateway, Stripe settle, and Razorpay with the refund event arriving BEFORE `payment_link.paid` (ignored as not ours, then pending with the amount).

**AU7 (B1 L1–L8):**
- L1 `apps/jobs/src/hooks/stripe.ts`: flag true → both modes kept with `livemode` in the facts; flag false → only test events.
- L2/L3 `apps/admin/worker/gateway/answer.ts` (`readJsonCapped` 256 KiB, `isRedirect`), used by `razorpay.ts`, `stripe.ts`, `paypal.ts`, `paypal-token.ts` (`redirect: "manual"`, 3xx → `bad_answer`). The start-up dry run's body-less answers still read (`json()` fallback).
- L4: unreadable signed body → 200, `invalid_event` logged, an `ignored` row when `evt_` id and type can be read.
- L5: `RAZORPAY_STALE_LINKS_SQL` in the sweep (live ≥ 1 h, not refreshed in 6 h, ≤ 10).
- L6: `paypalExpireUnclaimedStatements` (system `payment.link_end` audit rows, same read as the expiry).
- L7: `live_not_allowed` retried in `settle.ts`, `stripe-settle.ts`, `events.ts`.
- L8: sweep sends through `sendChunked` (≤ 100 per `sendBatch`).

**AU16 server parts:** `receipt-send.ts` answers top-level `contactIds`; `code` in `PAYMENT_DETAIL_KEYS` and the dead limit branch deleted (`refund-dialog.tsx`); `GET /payments/:id` sends `hasLiveRefund` and `bankTicked`, Withdraw hidden with the line beside it (`withdrawBlockedLine`, a plain `<p className="hint">`: the designer places it); "Make the PDF again" busy before the request (`refund-parts.tsx`).

**AU21 (lead's message):** `email_suppressions` `NOT EXISTS` in `receipt-send.ts` (pre-check and INSERT WHERE) and in `REFUND_CONTACTS_SQL`; jobs also leaves out erased `h:` addresses in one read (`withoutErased`; without the key it throws and the message retries, as the email consumer). The finance Worker has no erasure key, so `receipt-send.ts` can't check the `h:` form (an erased contact is anonymised there, which the rule already refuses; the email consumer stays the guard for a re-typed erased address).

**Statement counts (≤ 45):** reversal 4–5 (main, audit, item, bell, event move); receipt failure 2; withdraw unchanged plus nothing; refund insert unchanged; PayPal sweep expiry 2 (was 1) in a 9-statement read batch.

### Commands and results
- `bash tools/heavy.sh --log af1-admin-full pnpm --filter @techaust/admin test`: 194 files, **5,272 passed**.
- `bash tools/heavy.sh --log af1-pkgs pnpm --filter @techaust/{db,core,email,jobs,portal} test`: db 1,060, core 2,708 (coverage gate passed), email 202, jobs 772, portal 950, all passed.
- `bash tools/heavy.sh --log af1-typecheck{,2} … typecheck` (admin, core, jobs, db, email, portal): 0 errors.
- `bash tools/heavy.sh --log af1-build-admin pnpm --filter @techaust/admin --filter @techaust/jobs build`: budgets ok (front 121,265; API 556,285; finance 433,812; invoices 564,184; jobs 863,885 bytes; start-up ≤ 122.5 ms).
- `node scripts/check-migrations.mjs`: ok. `pnpm lint` (once, final): 3 format errors in my generated `0081/0082` snapshot and journal JSON, fixed with `biome format` and re-checked; the remaining 14 warnings and 8 infos are in files this branch doesn't touch.

### Not verified
- Real gateways: Stripe's `refund.failed` / `requires_action` after success, Razorpay's `amount_refunded` on a partly refunded payment, PayPal's PARTIALLY_REFUNDED capture (no refunded total read) are from the vendors' documented shapes and the simulator, not a sandbox.
- The `refund.reversed` email is a plain builder template with placeholder words; no designer pass, no real mail client.
- Rows-read figures are local workerd, not staging D1.
- `pnpm check` as a whole (CSS collisions, web guards) was not run; only the migration guard.

### Open questions
1. **The owner (07-ZT C1–C3):** approve the client email about a refund that came back (recommendations in the appendix). Until then `APPROVED_07ZT` is false and nothing is sent outside local.
2. **The lead (07-ZT lines 1–8):** the staff lines drafted for review items, the receipt bells, `reduction_exists`, `payment_linked` and the hidden-Withdraw lines.
3. **The lead:** a reversed refund that had come from a PENDING gateway payment (L33: the payment was rejected when the refund succeeded) reverses the refund row, but the money does not come back as credit: a rejected payment holds none. The `refund_reversed` item tells the Owner; should such a payment be re-opened (a new trigger move `rejected → pending_verification`), or is the item enough? I left it as item only.
4. **The lead:** an active bank tick on a refund that is later reversed stays (the refund's debit was seen in the statement); say if it should be removed with the reversal.
5. **Merge order:** two migrations, `0081_audit_money` and `0082_audit_money_triggers`; AF2 renumbers after them.

### Lead's answers to AF1 (2026-11-07)
- **AU29:**
  - 07-ZT staff lines 1–8 are approved by the lead under the owner's delegation.
  - The "Send receipt again" refused-recipient line becomes "Some recipients can't get this receipt: they need portal access and finance access, and an address that isn't stopped." (lead's line; the designer wires it).
  - C1–C3 go on the owner's copy page; the email stays gated off.
- **AU30 (Q3):** a reversed refund that came from a pending gateway payment (L33, already rejected) stays a `refund_reversed` item. The Owner records the money from it; there's no automatic re-open of a rejected payment (safest: no money is counted without the Owner).
- **AU31 (Q4):** a bank tick on a reversed refund is kept: the outgoing entry was real, and the bank shows the return as its own line.
- **Merge order:** AF1 (0081, 0082) merges first, then AF2 renumbers after it.

## Early check of AF1 (analyst, 2026-11-07): NO-GO, small fixes
Analyst claude-opus-5-5/high; skill `cloudflare:workers-best-practices`. Read-only at 530d88e2.

**Sound:** the reversal trigger and its single path; forged or replayed events can't reverse; every reader moves; AU2's pagination adds up to the unbounded answer; RA-40 is identical in route, WHERE and trigger; the AU3, AU4, AU6, AU7 and AU21 items; migrations 0081/0082 are ADD COLUMN, partial index and triggers only.

**Findings:**
- **H1:** the bounded windows can return an empty page with `next` set. `credit-held-tab.tsx:44,132` and `reconciliation.tsx:164,557` stop paging and show the empty state. On the RA-41 tab that wrongly says no client held credit once there are more than 1,000 confirmed payments.
- **M1:** a reversed refund of an L33 (rejected pending) payment is called client credit, in the client email (`refund-notify.ts:190-193`) and the staff line (`reasons.ts:153-155`). It isn't credit.
- **M2:** 07-ZT line 2 gives an order the database refuses: a partial refund of a pending payment is refused, and so is a confirm with a live refund (`reasons.ts:139-143`).
- **M3:** no failure-path test for `live_not_allowed` being retried, `isOurs` on the first refund answer at the route, or PayPal's `partly_refunded` settle branch.
- **L1:** Stripe `requires_action` after success can still pay out, but our reversal is permanent (`core/refund-gateways.ts:55`).
- **L2:** a reversal changes past periods' refunds register, Collected, statement and RA-41.
- **L3:** a payment left out of the receipt sweep after `series_full` stays out after the FY changes.
- **L4:** the SES transport (`packages/email/src/transport.ts:149`) and Turnstile siteverify have no `redirect: "manual"` or capped read.

### Lead's triage of the early check (2026-11-07)
- **AU32 (H1):** both screens keep `next` whatever the page size. An empty page with `next` set fetches the next page by itself (up to 20 pages, with a "Checking older payments" line from the lead under the delegation). The empty state shows only when `next` is null. Screen tests with an empty first page.
- **AU33 (M1):** `REFUND_REVERSED_ROW_SQL` holds `p.status = 'confirmed'`, so no client email goes out for a rejected payment. The staff line for that case: "{Gateway}'s refund of {amount} came back after it was made. The payment was rejected when this refund was made, so the money isn't counted here. Record it as a payment." Tests for each.
- **AU34 (M2):** line 2 is reworded to the order that works: "{Gateway} had already refunded {refunded} of this payment of {amount} when it reached us, so it waits here. Confirm it, putting only what was kept on the invoice, then record the {refunded} refund from credit with {Gateway}'s refund id." (and a PayPal variant without the amount). An end-to-end worker test: confirm with a partial allocation, then an outside refund from credit. If the Needs-review confirm can't leave the refunded part off the invoice, fix that and report it.
- **AU35 (M3):** the three failure-path tests.
- **AU36 (L1):** settled on the safest reading: reverse only on Stripe `failed` or `canceled`. A `requires_action` after success opens a `refund_reversed`-family item without a reversal, and only logs if one is already open.
- **AU37 (L2):** settled on the safest reading, so filed periods don't move: the period-end and range readers count a reversed refund as out until `reversed_at` (`status = 'succeeded' OR (reversed_at IS NOT NULL AND reversed_at > <period end>)`). 08-C RA-41 gets a note. Tests across a period boundary.
- **AU38 (L3):** a `series_full` exclusion also lifts when the FY of `receipt_tried_at` is earlier than today's FY. Test.
- **AU39 (L4):** `redirect: "manual"` and a capped read on the SES transport and Turnstile siteverify, with tests (both hosts are fixed: defence in depth).

### Lead's answers to AF2 (2026-11-07)
- **AU40 (Q1):** a run-wide cap of 30 pages per nightly run across all families (about 15,000 rows). With index writes that stays well under D1's 100,000 rows written a day for the whole account, with room left for the business day. The families after the cap get "more tomorrow".
- **AU41 (Q2):** no `ERASURE_HASH_KEY` on the invoices Worker, so the owner has no extra step. The email consumer stays the guard for the erased form (it skips the email and rings a bell); the plain stop is checked up front.
- **AU42 (Q3):** a digest complaint only switches that member's digest off. There is no extra bell.
- **AU43:**
  - The care bell tail (staff line): "…no billing contact can receive it (they need portal access, finance access and an address that isn't stopped)".
  - AF2's drafted staff lines are approved by the lead under the owner's delegation (the retention "{n} or more" and "More are deleted tomorrow night", the dead-letter names, the refund-email and deed-PDF bells, the consent-withdrawal close lines and the `withdrawal_required` / `export_before_received` messages).
  - The lead updated 07-ZR's erase line (AU27) and environments.md's second settlement fetch.
- **Routing:** the receipt-send `/receipts` link goes to the AF1 fix leg. AF2 merges the audit branch and renumbers its migrations to 0083/0084 (AF1 holds 0081/0082).

## AF2 report (Early check): builder claude-opus-5-5/high, 2026-11-07, branch `fix/audit-af2` from `origin/fix/audit-m6-m7` (8563097f)
Skills loaded: `cloudflare:workers-best-practices` (no `ctx` destructuring, every async write awaited or in `waitUntil`, generated `Env` only, no `redirect: "error"`), `cloudflare:wrangler` (no config or binding change was needed; nothing hosted touched), `cloudflare:cloudflare` (Queues dead letters, D1 write budget per account for AU9), `aws-core:aws-messaging-and-streaming` (SES complaint handling for AU20: the complaint routes through the existing EventBridge hook, no SES or IAM change). Not loaded: `cloudflare:workers-profiling` (no CPU measurement made; the warm-up fixtures were regenerated by the repo's own probe), `frontend-design` (no screen designed: the SPA changes are logic and builder-drafted lines for the designer and lead).

Commits: 4b27eaa0 (schema, migrations, triggers), eff5ca53 (retention, PDF refusal), 81378213 (dead letters, recon), 0eb72401 (portal, sends, SES), 853060b5 (data protection), 018ff374 (purge test, portal fixture), the test-contract commit, and the final fixture, lint and report commit. Runbook `environments.md` still says "the Razorpay settlement fetch" at 09:00 IST (now two days): a doc edit for the lead.

### Migrations (to renumber after AF1's 0081 merges)
- **0081_audit_af2** (drizzle): four `ALTER TABLE … ADD`: `retention_run_counts.pages`, `.capped`, `.more_tomorrow`; `pdf_failures.refused_at`. No rebuild.
- **0082_audit_af2_triggers** (custom, `scripts/write-triggers.ts audit_af2_triggers`, generator `packages/db/src/triggers-audit-af2.ts`): back-fill of `pdf_failures.refused_at` from existing `pdf.refused` document bells; `pdf_failures_refused_once`; `retention_run_counts_af2_insert/_update`; DROP+CREATE `leads_held_no_delete`, `leads_held_no_erase` (address held, `HELD_EMAIL_AF2`), `documents_held_no_redact` (every redaction), `client_requests_close_rules` (0079's rules + export date ≥ arrival + consent-withdrawal proof), `staff_notification_prefs_values(_update)` (+`complaint`), `client_requests_erase_details`, `payment_notices_erase_note`, `client_requests_unlink_lead`, `client_requests_unlink_contact`, `payment_notices_unlink_contact` (close notes cleared), `payment_notices_fixed` (close note may only become empty). 0079, 0072 and 0074 regenerate unchanged (checked: `CLOSE_BAD_0079`, `contactHeld`, `clientHeld` were only exported).
- Locally drizzle numbered them 0081 and 0082 (it numbers from the journal, so 0082 alone wasn't possible without a placeholder). After AF1 merges: take both out with their snapshots and journal entries, merge, then `drizzle-kit generate --name audit_af2` and `--custom --name audit_af2_triggers` + `node scripts/write-triggers.ts audit_af2_triggers`. The meta files were formatted by Biome like 0080's.

### What changed, by item
- **AU9:** `packages/db/src/retention.ts` `LIVE_PAGES_PER_RUN = 20`; the live upsert counts `pages`, ends the family at the budget with `more_tomorrow` (a stopped page never marks it); the dry run counts each table once in a sub-select and sets `capped`. The run still finishes and rings as before. API `GET /retention/report` gives `capped`, `moreTomorrow`; SPA `settings/retention.tsx` shows "{n} or more" and the draft line "More are deleted tomorrow night" (lead's words needed). Note: 20 pages × 500 rows × 16 tables could still reach 160,000 deletes a night on a huge backlog; D1's 100,000 rows written a day is per account. A lower budget (for example 10 pages) is a one-line change if the lead wants it.
- **AU10:** jobs `pdf.ts`: every `pdf.refused` document bell is written with `REFUSED_MARK_SQL` (refused_at, set once); the 3-night stop marks it (`STOPPED_MARK_SQL`) and its bell rings only while unmarked; the sweep reads `f.refused_at IS NULL`, never the bell. `BELL_MARKER_KINDS` (`pdf.refused`, `milestone.unbilled`, `proforma.tax_invoice_due`, the four export stage kinds) are left out of the `bells` family.
- **AU11:** jobs `email.ts` `DEAD_LETTER_KIND_NAMES` names `refund.notify`, `staff.notify`, `digest.weekly`, `signin.unfinished`, `bells.sweep` in the alert; a `refund.notify` dead letter rings `refund.email_failed` to the owners with the client code (`/payments?tab=refunds`, once per refund); `deed-pdf.ts` `processDeedDeadLetter` rings one `pdf.failed` bell per deed and IST day (only a final or signed deed without its PDF, client not anonymised); `billing.ts` queues `recon.fetch` for yesterday and the day before at 09:00 IST; `apps/admin/worker/recon-twice.test.ts` proves a day stored twice adds and changes nothing (recon.ts untouched).
- **AU12:** portal `doc-token.ts` `/t/document`: one batch, `LINK_VIEW_SQL` (view first, only while the link is live) → `DOC_REREAD_SQL` → lines, credit notes, Pay now → audit row and 200 access row guarded on the document still open and the link live; served only from the re-read, else 404 with one 404 access row and no `p:fail:` count.
- **AU13:** `message` fields carry the approved 07-ZP C15/C17/C24 words (`paid-notice.ts` with the balance formatted, `profile.ts`, `requests.ts`); receipt email link `/receipts` in `apps/jobs/src/receipts.ts:297` only; `/auth/logout` → `RL_SIGNIN`, `/pay/paypal/return` → `RL_LINKS` (`rate-limit.ts`, and a test that no public POST row is left unlimited); `SESSION_READ` joins `cl.anonymised_at IS NULL`; RB-45 tag Settled in `apps/portal/src/screens/m71/profile.tsx`. The portal warm-up fixture was regenerated because `SESSION_READ`'s text changed (see below).
- **AU19:** `care-billing.ts` reads `stopped` per contact and `recipientsOf` leaves stopped addresses out; none left → issued, `notEmailed`, no sends or reminders. The sends statement also refuses a stopped recipient (all or none, as before).
- **AU20:** `packages/db/src/email-events.ts`: a complaint on a non-transactional email (`digest.weekly`) writes no suppression and no "emails stopped" bell; it switches that member's digest off (`digest_off_via = 'complaint'`, only if it was on). A bounce of the digest still stops the address.
- **AU21:** `NOT_STOPPED_SQL` (`packages/db/src/issue.ts`): the plain stop and the `h:` keyed form. Held in the offer send's freeze guard and its `document_sends` INSERT, the invoice send (`invoiceSendStatements`, used by the route and the care issue), the offer resend (`document-links.ts`), and `VALID_RECIPIENTS_SQL` / `VALID_INVOICE_RECIPIENTS_SQL` (the route's pre-check and its explanation), so a stopped recipient is 409 `recipient_invalid` with its id (the screens already can't pick one). The `h:` form needs `ERASURE_HASH_KEY`: `recipientHashes` computes it only on a Worker that holds the key (the admin API: offers); on the invoices Worker it is null and the email pipeline stays the guard for that form (see questions). `receipt-send.ts` and `refund-notify.ts` (AF1's) untouched.
- **AU23:** `notes.ts` / `files.ts` DELETE `AND NOT HELD_ROW_SQL(...)`; a refusal answers 409 `legal_hold` with the S1 words; the project GET gives `clientLegalHold`; `NotesPanel` / `FilesPanel` take `held` and hide Delete (client overview, client files tab, project page).
- **AU24:** lead export summary `processors: processorsBlock()`; part `client_requests` (keyset by `created_at, id`, on `client_requests_lead`).
- **AU25:** L1 `HELD_EMAIL_SQL` (moved to `packages/db/src/dp-shared.ts`, exported as `@techaust/db/dp-shared`, re-exported by `retention.ts`) in the lead erase's read and first row, the purge's `DUE` and `SCAN_SQL`, the leads-due list, and the two lead triggers; L2 the redaction trigger fires on every redaction; L3 the close's WHERE refuses an export date before the IST day of arrival and stores `max(date, received_at)`, the trigger holds `export_sent_at ≥ received_at`, the screen checks the day too; L6 `suppression.lift` audit summary `{reason: "erased"}`, close notes cleared on anonymise, erase and lead delete (triggers).
- **AU26:** core `closeVerdict` → `withdrawal_required` without a linked action or for a request naming no contact or lead; the close's WHERE and trigger require `CONSENT_WITHDRAW_ACTION_SQL` (a `lead.consent_withdraw` of its lead, or a `contact.update` of its contact whose `changed` holds `marketingConsent` plus a `withdraw` receipt, both after arrival). SPA `lib/requests.ts` offers the matching rows; `detail.tsx` words them with drafted lines.
- **AU27:** `apps/admin/src/lib/copy-zr.ts` `eraseBody` takes the lead's sentence word for word (07-ZR's appendix line in `docs/07-content-appendix/ZR-m7.4-data-protection.md` still has the old sentence: a doc edit for the lead).

### Statement counts (every write one batch, every rule in its WHERE)
`/t/document` 7 (+1 access row on the race path); invoice send unchanged (sends, reminders, audit) plus at most one 5-row read for the hashes; offer send unchanged plus that read; care issue unchanged; SES complaint 6 (event, log, suppression, digest switch, bell, read-back); retention live page unchanged (1 + tables); note/file delete 2 (+1 read on refusal); lead erase unchanged; request close unchanged; refund-email and deed dead letters 1 each. None is near 45.

### Tests (all through `tools/heavy.sh`, logs in `.logs/af2-*`)
- db: `audit-af2-triggers` 11/11 (0081 adds only, 0082 regenerates, the frozen twins equal the runtime SQL, every new trigger accepts and refuses), `retention-budget` 4/4 (budget and more tomorrow, a stopped page, capped trial count, marker bells kept in both modes), `portal-triggers`, `email-events` (AU20), `data-protection-triggers`, `triggers`, `retention-pages`, `retention`: all passed.
- jobs: `pdf`, `pdf-invoice`, `pdf-notes`, `pdf-invoice-types`, `pdf-layout-gate`, `m74-dp`, `m72-jobs` (AU11 names, refund bell, two recon days), `deed-pdf` (AU11 L6), `billing-routing`, `reports-b`, `receipts-refunds` (the `/receipts` link), `ses-hook`, `purge` (AU25 L1): all passed.
- admin: `audit-af2-dp` 6/6 (AU23–AU26 failure paths first), `recon-twice`, `invoice-send` (AU21 plain and `h:` forms), `document-links` (AU21 resend), `care-billing` (AU19), `m74-data-protection` (L6 lift summary, the export manifest), `vault`, `projects`, `warm-routes`, `src/lib/m74-screens` (AU26 SPA logic): all passed.
- core: `dsr` (AU26 verdict).
- **Final checks:** whole packages: portal 954/954; jobs 767/767; core all passed (coverage 97.5 % statements); db 1069 with the migration list and the offer send's SQL snapshot updated on purpose for AU21 (`issue-sql`, `migrations`; re-run passed); admin 5264 of 5266 on the full run, the two failures fixed and re-run (`warm-advance`: the invoices RPC fixture regenerated because the care contacts read changed; `audit-labels`: a parameter named `action` renamed): 43/43. Typecheck (admin, portal, jobs, db, core) passed after one fix. The whole-repository `pnpm lint` ran once: one error, mine (`receipts-refunds.test.ts` optional chaining), fixed and the file re-checked; its other 14 warnings and 8 infos are in files this round didn't touch.
- Warm-up fixtures: `node scripts/cpu-probe.mjs --build --write-fixtures` (twice); kept only the files whose SQL changed: `apps/portal/worker/warm-fixtures/portal.ts` (`SESSION_READ`) and `apps/admin/worker/warm-fixtures/invoices-rpc.ts` (care contacts read); the other regenerated fixtures were sample noise and were reverted. After AF1 merges, regenerate once more if its hot-route SQL changed too.

### Copy drafted (builder's words, for the lead; none is client-facing)
- Retention: "{n} or more" (the triage's), "More are deleted tomorrow night".
- Dead-letter alert names: "refund email to a client", "staff notification email", "owners' weekly digest", "unfinished sign-in alert", "hourly staff email check".
- Bells: "The email about a refund to {client_code} couldn't be sent. Tell the client about the refund yourself."; "The PDF of deed {number} couldn't be made. Open the deed and make it again."
- Request close: `withdrawalGuide`, `unmatchedWithdrawal`, `withdrawalAction`, `withdrawalMissing`, `withdrawalLoading`, `withdrawalNone`, `withdrawalOption`, `exportSentEarly`, refusals `withdrawal_required`, `export_before_received` (copy-zr.ts, ZR_DETAIL / ZR_CLOSE); worker messages for the same two codes.
- The care bell's "not emailed" tail still says "no billing contact has portal access", which is not the reason when the address is stopped: a line such as "…was issued, but no billing contact can be emailed, so it wasn't emailed." is the lead's to word.

### Not done or not verified
- The `h:` (erased) form in the invoice sends and the care issue: the invoices Worker has no `ERASURE_HASH_KEY`, and adding a required secret is a hosted step (the owner's `wrangler secret put` on staging). The email consumer still skips and rings for that form.
- `apps/admin/worker/receipt-send.ts:127` (AF1's) still links receipt emails to `/invoices`, and `REFUND_CONTACTS_SQL` (AF1's `refund-notify.ts`) has no stop check: both for AF1 or the lead to route.
- `packages/db/src/receipts.ts` (AF1's) still reads the `pdf.refused` bell for its sweep; that stays correct because the marker kinds are now never cleaned up, but a receipt refusal writes no `refused_at` (the receipt path is AF1's file).
- No screen layout was designed; the SPA changes are logic and drafted lines. Staging, real SES complaints, real Razorpay settlements and the CPU readings are not verified.

### Questions
1. AU9: keep 20 pages a night per family, or lower it so the worst night stays under D1's 100,000 writes a day for the whole account?
2. AU21: add `ERASURE_HASH_KEY` to the admin invoices Worker (an owner step, `wrangler secret put` on staging) so invoice and care sends refuse the erased form up front, or keep the email consumer as that form's guard?
3. AU20: should a spam report of the digest also ring the owners (new staff line), or is the switched-off digest enough?

## AF2 after merge (builder): claude-opus-5-5/high, 2026-11-07
- **Merge and renumbering** (CLAUDE.md "migration order across parallel branches"): AF2's unapplied 0081/0082 with their snapshots and journal entries were taken out (39d4a088), `origin/fix/audit-m6-m7` (58afaed5, AF1's `0081_audit_money` and `0082_audit_money_triggers`) merged (798ff834), then AF2's regenerated as **`0083_audit_af2`** (`drizzle-kit generate --name audit_af2`: the same four ADD COLUMNs) and **`0084_audit_af2_triggers`** (`--custom` + `node scripts/write-triggers.ts audit_af2_triggers`); meta formatted by Biome. Conflicts resolved: `TRIGGER_SETS` (both sets, AF1's first), the migration list (0081–0084), this run file (AF1's sections, then AF2's). `node scripts/check-migrations.mjs`: ok (85 migrations, none rebuilds a referenced table). Trigger names: 0082 recreates `payment_refunds_bounds`, `payment_refunds_status_flow`, `review_items_values_insert/_update`; 0084 recreates none of those, so neither set redefines the other's.
- **AU40 (the lead's answer 1):** `RUN_PAGE_CAP = 30` replaces the per-family 20 (`packages/db/src/retention.ts`): one run's live pages across all families. A page within the cap acts and counts; the page that reaches it with rows still due ends its family with `more_tomorrow`; a family whose page comes after it acts on nothing (`capped` 1, which every DELETE and scrub of that page reads in the same batch), is done, and says `more_tomorrow` when rows are due. A page the switch stopped marks neither. Tests: `retention-budget` (the cap reached on one family, the next family after the cap, the next night, a stopped page), `retention` (a page's deletes now bind ?1 to ?4).
- **AU41 (2):** no erasure key on the invoices Worker; the comments in `invoice-send.ts` and `care-billing.ts` record that the email consumer stays the erased form's guard (the lead's decision).
- **AU42 (3):** nothing added for the digest's spam report.
- **AU43 (4):** the care bell's not-emailed line is the lead's: "Care invoice {number} for {client} was issued, but no billing contact can receive it (they need portal access, finance access and an address that isn't stopped)." (`care-billing.ts`, its tests updated; 07-U's appendix line still has the old words: a doc edit for the lead).
- **Runs after the merge** (`tools/heavy.sh`, logs `.logs/af2m-*`): db 1078/1079 on the full run, the one failure an assertion changed on purpose for AU40 (deletes bind four values), then 32/32 for the four retention and trigger files; jobs 776/776; portal 954/954; admin 5283/5283 (the warm-up tests included, so no fixture needed regenerating); typecheck of admin, portal, jobs, db and core passed. The whole-repository lint was not re-run (it ran once before the merge); the changed files were checked with Biome.
- `receipt-send.ts` and `refund-notify.ts` untouched.

## AF1 fix leg (builder): builder claude-opus-5-5/high, 2026-11-07, branch `fix/audit-af1b` (from `origin/fix/audit-m6-m7` 58afaed5; not merged with the later AF2 merge on that branch: no file overlaps it except this run file)
**Skills loaded:** `cloudflare:workers-best-practices` (redirect and capped reads on credentialed outbound calls, no `ctx` misuse, generated `Env` only); `cloudflare:wrangler` (no config or binding changed; builds and the warm-fixture run only); `cloudflare:turnstile-spin` (its siteverify contract: fail closed on non-2xx and unreadable answers, kept; the setup wizard itself doesn't apply: no widget or secret is created). Not loaded: `cloudflare:workers-profiling` (no CPU change measured; the build's start-up check passed), `aws-messaging-and-streaming` (the SES change is the HTTP client only, no SES configuration).

### Changes
- **AU32 (H1):** `apps/admin/src/lib/keyset-pages.ts` (`readPastEmptyPages`: at most `EMPTY_PAGE_LIMIT` 20 pages in a row, the server's `next` kept whatever the page held; `showsEmpty`; `CHECKING_OLDER_LINE` "Checking older payments…", the lead's line). `credit-held-tab.tsx` and `reconciliation.tsx` (`usePages`, so all four lists) use it for the first page and "Show more"; the empty state shows only when `next` is null; the line is a plain `<p className="hint" role="status">` for the designer to place. Tests: `apps/admin/src/lib/keyset-pages.test.ts` (an empty first page, empty to the end, the 20-page limit then "Show more", a failed read, a source check of both screens). The SPA has no DOM test runner, so the "screen tests" are the pure reader plus the source check.
- **AU33 (M1):** `apps/jobs/src/refund-notify.ts` `REFUND_REVERSED_ROW_SQL` holds `p.status = 'confirmed'`. `apps/admin/worker/refund-flow.ts`: a reversal whose payment is `rejected` writes its `refund_reversed` item with `facts.reason = "payment_rejected"`; `refund-events.ts` then answers no `refundReversed` (no email asked for). `gateway/reasons.ts` carries the lead's line. Tests: jobs (a rejected payment's reversal: `none`), admin end to end (below), SPA line.
- **AU34 (M2):** line 2 reworded to the lead's words (Razorpay/Stripe with the amount; PayPal: "…had already refunded part of this payment of {amount} when it reached us, so it waits here. Confirm it, putting only what was kept on the invoice, then record the refund from credit with PayPal's refund id."). End-to-end worker test (`apps/admin/worker/audit-money-af1b.test.ts`): a Razorpay payment first seen with ₹100 refunded → pending + item; `POST /payments/:id/verify` confirm with an allocation of total − refunded (200, `unallocatedMinor` = the refunded part, item resolved); `POST /payments/:id/refunds` from credit, `outside` with Razorpay's refund id (checked at the stub gateway) → succeeded; the invoice owes the refunded part, no credit left. **The confirm already leaves the refunded part off the invoice: no code change was needed.**
- **AU35 (M3):** tests in `audit-money-af1b.test.ts`: Razorpay with a live key while live is off, `payment_link.paid` and `.expired` → `retry`, nothing written, then settles with the test key (`settle.ts`, `events.ts`); Stripe the same (`stripe-settle.ts`); the route's first refund answer not ours (another amount; another of our ids) → 202 `requested`, the row unchanged; PayPal `PARTIALLY_REFUNDED` capture first seen → pending, one `refunded_outside` item with `reason: partly_refunded`, no allocation, balance unchanged.
- **AU36 (L1):** `packages/core/src/refund-gateways.ts`: `reversalOf` reverses only on `failed` (Stripe `failed`/`canceled`); new `awaitsAction`. `refund-events.ts`: a succeeded refund that Stripe shows `requires_action` opens ONE `refund_reversed` item at `facts.stage = "requires_action"` with the owners' bell (event `needs_review`, outcome `refund_requires_action`); a second answer only logs (`refund_requires_action_known`). `packages/db/src/refunds.ts` `refundItemOnceGuard` takes an optional `stage` (`json_extract(facts,'$.stage') IS ?`), so the requires-action item and a later real reversal's item never block each other. **Builder's draft line for the lead** (`reasons.ts`, staff-only): "{Gateway} needs the client to act before the refund of {amount} can reach them, so it may not have arrived. It still counts as made here. Check it in {Gateway}'s dashboard." The SPA's `itemReason` passes `facts.stage`. Test: requires_action → item, again → logged, then failed → reversed with its own item (and AU33's line, the payment being rejected).
- **AU37 (L2):** `packages/db/src/sql-rules.ts`: `refundOutAtSql(f, at)` (succeeded, or failed with `reversed_at >= at`), `refundsOutSql(from, to, asOf)` (succeeded through `payment_refunds_settled` UNION ALL the reversed ones through `payment_refunds_status_list`, a seek of the failed refunds), `istDayEndMsSql(day)`. Readers: RA-41 `paymentFreeAtSql` (so `CREDIT_HELD_SQL` and the confirm/record lines); `COLLECTED_SQL` and `COLLECTED_TILE_SQL` (each of FY, month and previous month by its own last day); `REFUNDS_REGISTER_SQL`; `REVENUE_MONTHS_SQL` (each month by its own end) and its grouped twin; `REVENUE_CLIENTS_SQL`; the statement of account (`statementSource`: the whole statement as at the end of `?4`; `statementBalanceBeforeBinds` now takes `to`, callers in `apps/admin/worker/statements.ts` and `apps/jobs/src/statement-pdf.ts`). 08-C RA-41 note added. Tests (`packages/db/test/refund-statements.test.ts`): a refund out on 3 Nov that came back on 5 Dec stays in November's statement, register, Collected, the tile's previous month, revenue by month (= twin) and by client, and RA-41 credit at 30 Nov (₹300 held, not ₹500); every range ending 31 Dec drops it; plan checks that the readers seek both indexes and never scan `payment_refunds`. Two plan-scan checks (`packages/db/test/reports-v2.test.ts`, `apps/admin/worker/reports-stress.test.ts`) now leave out the walk of a CO-ROUTINE (the FROM subquery's own SEARCHes are listed above it). The dashboard tile is a hot route, so the admin warm fixtures were regenerated (`node scripts/cpu-probe.mjs --write-fixtures` after the admin, jobs and portal builds; the portal's own fixture was left as it was: its SQL is unchanged and `apps/portal` is AF2's).
- **AU38 (L3):** `packages/db/src/receipts.ts` `RECEIPTS_DUE_SQL`: a `series_full` payment comes back once `istFyOfMsSql(receipt_tried_at)` < the FY of `?1` (the sweep's cut-off: its run time less `RECEIPT_SWEEP_AFTER_MS`, so on 1 April it returns within that margin; `apps/jobs/src/receipts.ts` not touched). Tests: across the 31 March / 1 April IST boundary (any other refusal stays out); `istFyOfMsSql` twin-tested with core `fyOf`. The existing AU3 test now binds a cut-off in the same FY as its tries.
- **AU39 (L4):** `packages/email/src/transport.ts`: `redirect: "manual"` (aws4fetch keeps the option on its signed `Request`), a 3xx → `retry` (`"<status> redirect"`), the answer read through `readTextCapped` / `SES_ANSWER_MAX_BYTES` 16 KiB (over the cap: status only). `packages/auth/src/turnstile.ts`: `redirect: "manual"` (a 3xx is not `ok`: false), the answer read through `SITEVERIFY_MAX_BYTES` 16 KiB (over: false). Tests: `packages/email/test/audit-transport.test.ts`, `packages/auth/test/turnstile.test.ts`.
- **AU13 (lead's addition):** `apps/admin/worker/receipt-send.ts` links the portal's `/receipts`; test in `m72-routes.test.ts`. **`REFUND_CONTACTS_SQL` verified on this base:** it holds `NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email = lower(c.email))` (`apps/jobs/src/refund-notify.ts`), and the erased `h:` form is left out by `withoutErased`.
- Migrations: none.

### Commands and results
- `bash tools/heavy.sh --log af1b-typecheck2 … typecheck` (admin, core, db, email, auth, jobs): exit 0 (the first run found one test typing error, fixed).
- `bash tools/heavy.sh --log af1b-pkgs pnpm --filter @techaust/{db,core,email,auth,jobs} test`: db 1,063, core 2,708 (coverage gate passed), email 205, auth 156, jobs 773: all passed.
- `bash tools/heavy.sh --log af1b-admin2 pnpm --filter @techaust/admin test`: 196 files, **5,288 passed** (the first run, `af1b-admin`, failed 2: the reports stress scan check and the warm fixtures, both fixed as above).
- Builds: admin (front 121,791; API 556,646; finance 435,852; invoices 565,300 bytes; start-up ≤ 92.4 ms), jobs 865,552, portal 161,767 (its plan-line note, unchanged by this branch). `node scripts/cpu-probe.mjs --write-fixtures`: 7 files written, 6 committed. Portal warm tests (2 files, 15) pass with the old portal fixture.
- `pnpm lint` (once): exit 0, 14 warnings and 8 infos, none in files this branch changed (the two files edited after it were checked with `biome check`).

### Not verified
- Real gateways (Stripe `requires_action` after success, a capped SES answer, a 3xx from either host): stubs only.
- Rows read on staging D1: the new reversed branch reads every failed refund (`payment_refunds_status_list` seek); locally a handful. The refunds register now sorts its FY's refunds in a temporary b-tree (the union has no single index order): its rows read grow with the FY's refund count (tens), not measured at scale.
- The SPA paging on a real screen (no DOM runner): the reader and the source wiring are tested; the designer places the line.
- `pnpm check` as a whole was not run.

### Open questions
1. **The lead:** the `requires_action` staff line (draft above).
2. **The lead:** the statement of account is now "as at the end of its last day": a refund that went out in October and came back in November is in October's statement and in November's opening balance only if the November statement ends before it came back, so November's opening can differ from October's closing by that refund (each statement is internally consistent). A "refund returned" credit line would make consecutive statements chain, but needs a new line kind (core, PDF layout `statement-4`, screens, copy): say if it's wanted (a later task).
3. **The lead:** Collected and revenue by month count a reversed refund in the month it went out, and nothing in the month it came back (the lead's rule as written); a month that only holds the return shows no inflow for it. Same question as 2 for those readers.
4. **Merge:** no migration; `apps/jobs/src/statement-pdf.ts` and `apps/jobs/src/refund-notify.ts` are touched (not in AF2's list); `apps/portal/**` untouched.

### Lead's answers to the AF1 fix leg (2026-11-07)
- **AU44:** the Stripe `requires_action` staff line is approved by the lead: "{Gateway} needs the client to act before the refund of {amount} can reach them, so it may not have arrived. It still counts as made here. Check it in {Gateway}'s dashboard."
- **AU45 (follow-up, for the owner):** a refund that comes back changes nothing for the month it went out, so filed periods hold (AU37). A client statement whose period spans the return shows no line for it, so one statement's closing balance and the next one's opening can differ by that refund. Joining them needs a new client-facing "refund returned" line (core, PDF layout, portal, copy). It goes to the owner's list with the lead's recommendation: build it before launch, as its own small task. The case is rare (a card refund the bank returns).
- **AU46:** Collected and revenue count a refund that came back in the month it went out, with no inflow in the month it returned (the cash view of the AU37 rule). Accepted.
- **Integration:** AF2 and the AF1 fix leg both regenerated `warm-fixtures/invoices-rpc.ts`. The lead regenerated every warm fixture from the merged code (`cpu-probe --build --write-fixtures`); the admin `warm-routes`, `warm-rpc` and portal `warm-routes` tests pass.

## Re-check of the AF1 fix leg (analyst, 2026-11-07): GO
Analyst claude-opus-5-5/high; skill `cloudflare:workers-best-practices`. At c88e84ab. AU32 to AU39 are each fixed completely, with a test that fails without it; db `refund-statements` 44/44 after the AF2 merge. Nothing critical, high or medium.
- **L1:** after the AU38 FY lift the failure counter doesn't reset, so a payment gets only one try in the new FY (`packages/db/src/receipts.ts:164`).
- **L2:** the relaxed scan checks (`reports-v2.test.ts:84-91`, `reports-stress.test.ts:207-215`) skip by alias name, and `f` is also a `payment_refunds` alias.
- **L3:** the reversed branch of `refundsOutSql` seeks every failed refund; the register sorts its FY in a temporary b-tree.
- **Designer note:** after 20 empty pages the list shows neither rows nor an empty state.

### Lead's triage (2026-11-07)
- **AU47 (L1):** count afresh when the last try was in an earlier FY (three tries per FY, and the bell can ring again); test on 1 April after three refusals in March.
- **AU48 (L2):** give the `refundsOutSql` source its own alias (`fo`) and skip only that exact co-routine line.
- **AU49 (L3):** a follow-up. If staging's rows-read figures grow, add a partial index on `payment_refunds (settled_on, id) WHERE status = 'failed' AND reversed_at IS NOT NULL` (index only).
- **AU50 (designer):** after 20 empty pages, a line under the list. Lead's staff line: "No more payments found in these pages. Show more to keep looking further back."

## Early check of AF2 (analyst, 2026-11-07): GO, fixes before the review
Analyst claude-opus-5-5/high; skill `cloudflare:workers-best-practices`. Read-only at c88e84ab. Nothing critical or high.

**What it checked:**
- **Migrations:** 0084's 12 recreated triggers keep every earlier rule word for word.
- **Retention cap:** a capped page deletes nothing.
- **Other fixes:** AU10, AU11, AU12, AU13, AU19, AU20, AU21 and AU23–AU27 are sound.
- **Batches and logs:** batches are well under 45 statements; logs carry ids only.

**Medium:**
- **M1:** the cap counts pages, not rows written. Index writes make a page cost about 4,000–4,500 rows written, so 30 pages can reach about 120,000–135,000 against the account's 100,000 a day (estimate, not measured).
- **M2:** erasing or anonymising a contact can answer 500 when the same address is held under another client (0084's `leads_held_no_erase` against `MATCHED_LEADS`; the pre-checks miss it; `clients.ts:1468,1488-1493,1694,1734,1762`).
- **M3:** leaving the marker bells out of retention keeps an anonymised individual's name in `milestone.unbilled` and `proforma.tax_invoice_due` bell titles for good (`alerts.ts:150-162`; the anonymise bell delete skips `entity_type = 'milestone'`). DPDP s.8(7), RB-11.
- **M4 (hosted):** the SES account-level suppression list blocks complaints by default, so an owner's spam click on the digest can silently drop their security alerts at SES.

**Low:**
- **L1:** `/auth/logout` on `RL_SIGNIN`: a 429 doesn't sign the person out.
- **L2:** the AU23 e2e step is missing.
- **L3:** the invoice-send `h:` test relies on a key the staging invoices Worker doesn't have; the offer first send has no stopped-recipient test.

### Lead's triage (2026-11-07)
- **AU51 (M1):** budget by measured writes. Add up `meta.rows_written` from every page batch into a new `retention_run_counts.written` column (ADD COLUMN), and stop the run at 40,000 rows written a night; `within` reads that total. Test that the worst-case capped night stays within the budget.
- **AU52 (M2):** a `NOT EXISTS (… MATCHED_LEADS … HELD_EMAIL_SQL)` guard in the first-row guard and the held read of both erase and anonymise, answering 409 `legal_hold`. Test: the same address at two clients, one held.
- **AU53 (M3):** settled on the safest reading (DPDP s.8(7)).
  - The individual anonymise also deletes the `entity_type = 'milestone'` bells of that client's milestones.
  - The `bells` family scrubs the marker kinds' titles to a neutral line after 12 months instead of keeping them.
  - Tests for each.
- **AU54 (M4):** the builder drafts an owner step for `docs/runbooks/ses-and-turnstile.md`: `techaust-marketing` gets its own suppression options (BOUNCE only), checked against AWS's configuration-set suppression docs, click by click. The owner does it (hosted, on the owner's yes).
- **AU55 (L1):** logout is limited per session (`RL_SESSION`, keyed by the cookie hash), and a 429 on logout still clears the cookie. Test.
- **AU56 (L3):** relabel the invoice test as the route's rule when the key is present, and add an offer first-send test with the address stopped between the pre-check and the batch.
- **AU57:** AF1 re-check AU47 and AU48 go to the same builder. L2 (the AU23 e2e step) goes to the designer.

### Lead's answers to AF3 (2026-11-07)
- **AU58:** the neutral title of a scrubbed marker bell is approved by the lead: "An alert from over a year ago. Its details were removed after 12 months."
- **AU59:** settled on the safest reading (RA-25: a hold for legal claims outweighs erasure). **Any** held holder of the address (contact, client or lead, at any client) stops an erase or anonymise with 409 `legal_hold`, not only a held lead the erase would mark. The erase's `h:` stop would otherwise suppress a held person's emails.
- **AU60:** sign-out keeps a generous per-address limit as well (60 a minute, its own namespace id per scope, required by `check-worker-config.mjs`), checked before D1. A 429 from either limiter still clears the cookie.

## AF3 report: builder claude-opus-5-5/high, 2026-11-07, branch `fix/audit-af3` from `origin/fix/audit-m6-m7` (c06754ec)
**Skills loaded:** `cloudflare:workers-best-practices` (every write awaited, generated `Env` only, no `ctx` misuse; the measured-writes record is awaited before the next page is queued); `cloudflare:wrangler` (no config or binding change: `RL_SESSION` already exists in every portal scope; nothing hosted touched); `cloudflare:cloudflare` (D1's `meta.rows_written` and its 100,000 daily writes; Workers Rate Limiting for AU55); `aws-core:aws-messaging-and-streaming` (routes SES questions to the SES docs; the AU54 settings were checked against the AWS SES Developer Guide through Context7). Not loaded: `cloudflare:workers-profiling` (no CPU change measured; the warm fixture was regenerated by the repo's probe), `frontend-design` (no screen touched).

Commits: f4407885 (db: schema, 0085, 0086, retention, receipts, refunds alias, their tests), a220f2bb (admin and portal routes and tests), 370beb08 (runbook draft), 606df731 (jobs consumer test), 4e271fe4 (invoices warm fixture), and this report.

### What changed, by item
- **AU51:** `retention_run_counts.written` (**0085_audit_af3**, one `ALTER TABLE … ADD`; no rebuild) held by the new trigger set **`audit_af3_triggers`** (**0086**, generator `packages/db/src/triggers-audit-af3.ts`: a whole number, never below 0, only up; new triggers only, nothing earlier dropped or recreated). `packages/db/src/retention.ts`: `RUN_WRITE_BUDGET = 40_000` replaces `RUN_PAGE_CAP`; `within` reads `sum(written)` of the run; a page within the budget acts (its family is done only when its tables run short); the next page that finds the budget spent acts on nothing, ends its family with `capped` and `more_tomorrow` when rows are due (`pages` still counts). `RECORD_WRITTEN_SQL` and `rowsWrittenOf` (sum of `meta.rows_written` of every statement of the batch); `apps/jobs/src/retention.ts` adds the batch's measured writes to the family's row right after the batch and before it queues the next page (the leads queue runs one message at a time, `max_concurrency` 1 in every scope). `LIVE_PAGE_WRITE_CEILING = 10_000`: the worst night is the budget plus one page (≤ 50,000, half of D1's 100,000 a day). Tests (`packages/db/test/retention-budget.test.ts`): the recorded writes; the budget spent → next page and another family do nothing, next night carries on; **the worst night measured in local workerd** (a 60,000-row backlog: it stops with rows left, total ≥ the budget, never more than one page over, every page ≤ the ceiling); full pages of the counters and the bells measured ≤ the ceiling and every family's direct writes (500 rows × (1 + its indexes) per table) ≤ the ceiling; the switch-off page; the trigger refusals. Jobs `m74-dp`: the consumer records the page's writes.
- **AU52:** `MATCHED_LEAD_HELD_SQL(c)` (`apps/admin/worker/offer-redaction.ts`, beside `MATCHED_LEAD_EMAILS_SQL`, the same matching as `MATCHED_LEADS` on alias `c`, with `HELD_EMAIL_SQL` from `@techaust/db/dp-shared`) in the erase/anonymise first row's guard and its refusal read (`clients.ts` `eraseBatch`), the T7 read's `held` (so the anonymise answers before `too_many_offers`), and, for consistency, the anonymise-in-parts guard and read (`redactPart`) → 409 `legal_hold`. No statement added. Tests `apps/admin/worker/audit-af3-dp.test.ts`: the same address at two clients, the other client held: erase, anonymise and the offers part are 409 `legal_hold`, nothing written (contact, lead, audit); hold lifted → the erase goes and the lead is marked; a held contact elsewhere and a held lead of another client with the address do the same.
- **AU53:** (1) the individual anonymise's bell DELETE (`clients.ts`, the statement that already takes document, payment, request and notice bells, T7's 45 kept) also takes `entity_type = 'milestone'` bells of the client's milestones (they never ring again: the daily alerts skip an anonymised client). (2) The `bells` family has a second entry: marker kinds older than 12 months (`?1`) whose title is not yet neutral get `title = BELL_MARKER_SCRUBBED_TITLE` (a scrub, never a delete; a scrubbed row is not due again; read through `notifications_created`). Tests: admin (an individual's milestone bells of both kinds go, another client's stay; a business client's stay), db (`retention-budget` AU10/AU53: old markers keep their rows with the neutral title, an 11-month marker keeps its title, the dry run counts the scrubs, nothing due the next night; `retention.test.ts`'s cross-check now keys by family and position and seeds a marker bell, `bells: 3`).
- **AU54:** `docs/runbooks/ses-and-turnstile.md` Part 9 (owner's hosted step, only on the lead's go-ahead): `techaust-marketing` → Suppression list options → Override account level settings, Enabled, reason Bounce only; `techaust-transactional` untouched. Checked against the AWS SES Developer Guide ("Using configuration set-level suppression…", "Creating configuration sets → Suppression list options", "Managing lists and subscriptions"; API `SuppressedReasons = BOUNCE`). No AWS call made.
- **AU55:** `apps/portal/worker/rate-limit.ts`: `/auth/logout` leaves `addressBindingOf` (no `RL_SIGNIN`); `SESSION_LIMITED_PUBLIC`. `auth.ts` logout: after the cleared cookie is set and the cookie hashed, `sessionAllowed` (`RL_SESSION`, the guard's own bucket `s:<HMAC>`) before any D1 work; a 429 carries the cleared cookie. Tests `m75-hardening.test.ts`: 429 with `__Host-ta_portal=; … Max-Age=0`, no D1 call, no access row, the session untouched, the key equal to the guard's, the address limiter never asked; within the limit 204 and the session revoked; no cookie → 204, limiter not asked; the "no public POST row unlimited" check now lists the sign-out as session-limited.
- **AU56:** `invoice-send.test.ts`: the AU21 test split: the plain stop (any Worker), and the `h:` form labelled as the route's rule where the Worker holds `ERASURE_HASH_KEY`, with the same send through an env without the key → 200 (the email consumer is that form's guard, AU41). `offers-send.test.ts`: an address stopped between the pre-check and the batch on the first send → 409 `recipient_invalid` naming it, no number taken (counter, rows, audit, `number_display` null); without it the send takes the next number.
- **AU47:** `receiptFailureStatements` counts afresh (`1`) when the version changed **or** the last try's IST FY differs from now's; the third refusal of a FY rings again (the bell row, unique per member, kind and payment, is brought back unread with its new time by `ON CONFLICT … DO UPDATE`). Test (`refund-statements.test.ts`): three refusals on 31 March, out with one bell; 1 April → due, the first refusal counts 1 and it stays due; the third of the new FY rings the same rows again, unread.
- **AU48:** the `refundsOutSql` source is aliased `fo` at all three callers (`ledger.ts` `settledRefundsFrom`, `COLLECTED_SQL`, `COLLECTED_TILE_SQL`; `reports.ts` `REFUNDS_REGISTER_SQL`, `REVENUE_MONTHS_SQL` through `refundedOutJson`). The plan checks (`packages/db/test/reports-v2.test.ts`, `apps/admin/worker/reports-stress.test.ts`) skip only the exact line `SCAN fo`, only when the plan has `CO-ROUTINE fo`; any other co-routine walk counts as a scan, and `fo` is in the scan list.

### Statement counts
Erase/anonymise/part: unchanged (the new checks are conditions of existing statements). Logout: unchanged (the limiter is no D1 work). Retention page: unchanged batch, plus one single-statement UPDATE of the measured total after it. Receipt failure: unchanged (2).

### Commands and results (all through `tools/heavy.sh`, logs in `.logs/af3-*`)
- db: changed files 7/7 (130 tests), then the package **1,091/1,091**.
- jobs: package **777/777**; `m74-dp` again after the added assertion 16/16.
- portal: changed files 5/5 (176), then the package **955/955**.
- admin: changed files 7/7 (123); the package **5,304 of 5,305**: the one failure was `warm-routes` (the dashboard tile's SQL changed with the alias). `node scripts/cpu-probe.mjs --build --write-fixtures` regenerated 7 files; only `apps/admin/worker/warm-fixtures/invoices.ts` had a changed SQL key (kept), the six others were sample noise (reverted). `warm-routes`, `warm-rpc`, `warm-advance`, `dashboard-stress` then 31/31.
- core: package passed (coverage 98.09 % statements).
- Typecheck: db, core, jobs, portal, admin: exit 0.
- `node scripts/check-migrations.mjs`: ok (87 migrations, none rebuilds a referenced table).
- Biome on every changed file; the whole-repository `pnpm lint` once at the end: exit 0, 14 warnings and 8 infos, none in a file this round changed (`.logs/af3-lint.log`).

### Not verified
- Staging D1's own `meta.rows_written` per page (measured in local workerd only; D1 may count differently). The budget then errs only by the difference per page; `LIVE_PAGE_WRITE_CEILING` is a bound measured locally on counters, bells and stats pages, and by index count for the others (cascades and trigger writes not counted there: the `runs` family's cascade to `retention_run_counts` is a handful of rows a night).
- A dry run also records its writes (harmless; only live pages read the budget).
- AU54 is a draft: nothing was changed in AWS.
- No screen touched; the retention screen still shows "More are deleted tomorrow night" from `more_tomorrow`.

### Questions
1. **AU53 staff line (lead):** the neutral title of a marker bell after 12 months, builder's draft: "An alert from over a year ago. Its details were removed after 12 months." (`BELL_MARKER_SCRUBBED_TITLE`, `packages/db/src/retention.ts`; staff-only).
2. **AU52 scope (lead):** the guard stops the erase only when a lead the erase would mark carries a held address. A held contact at another client with the same address but no such lead doesn't stop it (the erase still writes the `h:` stop for that address through the triggers, so emails to the held client's contact with that address stop too). Keep it, or should a held contact anywhere with the same address stop the erase as well?
3. **AU55 (lead):** a junk cookie on each sign-out request is its own session bucket, so a flood of junk-cookie sign-outs is no longer bounded per address (each one costs one D1 batch that writes nothing). Keep the triage's per-session limit only, or also keep a generous per-address limit on the sign-out that still clears the cookie on a 429?

**After the lead's answers (AU58–AU60), commit 978010fd:** AU58: the neutral bell line stays as drafted. AU59: `ADDRESS_HELD_SQL(c)` (`apps/admin/worker/offer-redaction.ts`, replacing `MATCHED_LEAD_HELD_SQL`) adds `HELD_EMAIL_SQL(c.email)`, so any held holder of the contact's own address (a contact with it at any client, itself or its client held, or a held lead with it) stops the erase, the anonymise and the offers part, whether or not a lead of the person carries it: in the first-row guards, the refusal reads, the anonymise read's `held` and `redactPart` (409 `legal_hold`, no statement added). Test (`audit-af3-dp.test.ts`): a held contact at client A, no lead, the same address at client B: erase, anonymise and the part are 409 with nothing written (contact, `erased_hash`, audit); a held client A does the same; lifted, the erase goes and A's contact stays. AU60: the portal binding `RL_SIGNOUT` (60 a minute, namespace ids 6104 / 6204 / 6304 in the top level, staging and production; `RATE_LIMITS.portal` in `scripts/check-worker-config.mjs` requires it in every scope) is asked per address (`signOutAddressAllowed`, its own key, never the sign-in's) before the session limiter and before any D1 work; a 429 from either still carries the cleared cookie. Tests (`m75-hardening.test.ts`): the session limit's 429, the address limit's 429 (session limiter not asked), keys per address (an IPv6 /64 one address) apart from `RL_SIGNIN`'s, both allowed → 204 and the session revoked, no cookie → no limiter asked. Runs (`tools/heavy.sh`, one package at a time, `.logs/af3b-*`): admin **5,306/5,306**, portal **956/956**, web **1,001 passed, 18 skipped** (the worker-config tests), `node scripts/check-worker-config.mjs` ok; typecheck portal, admin and web exit 0. `RL_SIGNOUT` is a config-only binding like the portal's three existing ones (the namespace id is chosen in `wrangler.jsonc`); it reaches staging with the next deploy, not verified there. Nothing hosted was touched.

## Designer report: designer claude-opus-5-5/high, 2026-11-07, branch `fix/audit-design` (from `origin/fix/audit-m6-m7` c06754ec; merged ced36f65 and b4acadb7, both clean)

**Skills:** `frontend-design:frontend-design` (loaded first; it set the restraint: no new visual devices, every fix uses an existing part — `EmptyLine`, `.pay-line`, the token ring, DataTable's own cards — and one live line per list foot instead of scattered hints); `dataviz` (for the report tables: the revenue table becomes DataTable's cards rather than a narrower table with dropped columns, so no figure is hidden; the care-hours meter keeps its single hue). Not loaded: the Cloudflare and AWS skills (no Worker, binding or email change), `code-review` / `security-review` (reviewer's).

### What changed, by item
- **AU15 (high):** `apps/admin/src/app.css` and `apps/portal/src/app.css`: the no-ring rule now reads `[tabindex="-1"]:not(a, button, input, select, textarea, summary, [role="tab"], [role="menuitem"], [role="option"]):focus`, so programmatic-focus targets (headings, dialog titles, notices, `main`) stay ring-free and roving controls keep it. `.tabs__tab:focus-visible` (`screens.css`) and `.menu__item:focus-visible` (`shell.css`) draw `2px solid var(--color-focus)` themselves. The portal has no roving tabindex today; the rule is scoped the same way so it can't bite later. e2e (`m74-data-protection.spec.ts`, new test): focus the selected tab, ArrowRight, the focused unselected tab's computed outline is `solid 2px`; ArrowDown in a note's menu, the focused item's outline isn't `none`.
- **AU23 e2e (AF2 check L2):** same new test: its own client "Zinnia Mills (sample)" with a contact, project, note and file (SQL, local only; code `ZM-…` sorts after the samples so "the first client" tests still find one with contacts), Delete offered before the hold, then a hold through `POST /legal-holds`: no Delete in the note menu or the files list on the project and on the client page; the hold is lifted in `finally`.
- **AU14 (B3 M6, L5):** portal Profile › Requests: "New request" sits beside the heading (`.m71-requests__head` start-aligned; it wraps under it on a phone); no requests → `EmptyLine` with the marked placeholder `ZP_PENDING.requestsEmpty` (`copy-zp.ts`, TODO naming 07-ZP; kept out of `zpAllText`, a test checks it carries the mark), as wide as the details panel above (36rem). Home: the two money blocks now use `EmptyLine` like the decision, projects and shared blocks (one empty style on the page); `.m71-money__empty` removed.
- **AU17 (B2 5):** a confirmed payment's dialog says what it keeps as credit, line 47's existing words ("{amount} is kept as {client}'s credit."), under its "Put on" list (or alone when it went on nothing): `keptOnPaymentLine` in `lib/payments.ts` (core `money`/`add`/`subtract`/`sum`; amount − allocations + releases). It is not shown while `hasLiveRefund` isn't `false` (a refund may have taken some of that credit; the refunds list says so), nor for waiting, TDS or withdrawn entries. Tests in `payments.test.ts`.
- **AU17 (B2 6):** `FilterBar` adds `filters--single` when it has one chip group and no search or extra field; `shell.css` gives it one full-width column, so the Refunds tab's four chips sit on one row at 1280.
- **AU16 placement:** the Withdraw-hidden reason is a `.pay-line` (Info icon) on its own line at the top of the dialog's sticky actions row, the buttons in one row under it (`.pay-entry__why`).
- **AU29:** `ZQ_ERRORS.recipient_invalid` is the lead's line word for word; `m72-screens.test.ts` pins it. The per-contact mark ("This contact can't get the receipt now…") is unchanged.
- **AU22 (B4 M2):** care hours: each date in its own `nowrap` span, a break allowed only around "to"; the used meter's `min-width` is `min(12rem, 100%)` (at 390 it ran 38 px under "Over" in the card). e2e (`m73-reports.spec.ts`, new test) at 390 and 768: no date on two line boxes, the period cell and every other visible cell or card fact hold their text (scrollWidth ≤ clientWidth + 1).
- **AU22 (L3):** the email page's time fact reads "Sent" once the email left and "Queued" before, the list column's own rule (`sentShown`), so one time has one label on both screens (existing words only).
- **AU22 (L4):** the Reports index wraps from 48rem (it did from 64rem), so 768 shows every report; on a phone it still scrolls, and the edge that hides more reports fades (`data-more` start/end/both set from the scroll position in `frame.tsx`, a CSS mask).
- **AU22 (L5):** Revenue's four tables render as DataTable's cards up to 56.24rem (`.m73-table--cards`), every figure kept.
- **AU28 (B5 L7):** `PageHeader` takes `wideActions`; between 48rem and 56.24rem the title gets its own row and the actions wrap under it. Used on the lead page.
- **AU32/AU50:** `components/keyset-foot.tsx` (`KeysetFoot`): "Show more" with one always-present `role="status"` line beside it: "Checking older payments…" while empty pages are read on, the lead's AU50 line after a read that stopped at 20 empty pages with pages left (`stalledAt`, `keysetFootLine`, `NO_MORE_FOUND_LINE` in `lib/keyset-pages.ts`). With nothing found yet the empty table isn't drawn; the foot stands in its place. Used by Credit at period end and all three Reconciliation lists (and the settlement dialog). Tests in `keyset-pages.test.ts`; the source checks there and in `b6-screens.test.ts` follow the new foot.

### Placeholder and staff lines
- **Placeholder (owner's copy page):** `[Placeholder] Requests empty line (owner's words, 07-ZP)` (portal Profile › Requests with none). `check-prod-readiness` blocks production while it shows.
- No new staff words: the kept line is 07-ZH line 47, the time label reuses "Sent"/"Queued", AU29 and AU50 are the lead's lines.

### Screenshots (`.logs/audit-design/`, copied from `.logs/shots/audit-design/`; admin in-app theme set against the OS's other theme)
- `payments-tab-focus-{390,768,1280}-{light,dark}.png`: the ring on the focused, unselected tab after ArrowRight.
- `payments-refunds-filter-*`: the Refunds tab's chips on one row.
- `payment-kept-*`: a confirmed sample payment's dialog with its kept-as-credit line.
- `payment-withdraw-hidden-*`: the same dialog with a refund (mocked `hasLiveRefund`), the reason above the buttons (the 1280 shot is after the fix that gave it its own line).
- `credit-held-stalled-*`, `reconciliation-stalled-*`: 20 empty pages with more left (mocked), the AU50 line beside "Show more".
- `care-hours-*`, `revenue-*`: dates whole with a break at "to"; the index wrapped at 768, faded at 390; revenue as cards at 390 and 768, the table at 1280.
- `emails-*`, `email-detail-*`: the log and one email's "Queued"/"Sent" fact (the `email-detail-768-light` shot caught the loading state; the others show the page).
- `lead-*`: the lead page, actions under the title at 768, beside it at 1280.
- `portal-profile-requests-empty-{1280-light,390-dark,768-light}.png`, `portal-profile-keyboard-768-light.png`: the head, the placeholder empty line, the focus ring on "New request".
- `portal-home-empty-{1280-light,390-dark}.png`: Home with every block empty in one style.
- `m74/`, `m73/`: the specs' own screenshots.

### Commands and results
- `pnpm --filter @techaust/admin test` (heavy): 5,300 passed, 1 failed (`b6-screens.test.ts` source check of the old `<ShowMore`); fixed, then `b6-screens`, `keyset-pages`, `m72-screens`, `payments` 70/70.
- `pnpm --filter @techaust/portal test` (heavy): 955/955.
- Typecheck admin and portal (heavy): 0 errors.
- e2e (heavy, `E2E_SAMPLE=1`): `m74-data-protection` 12 tests, 10 passed and 2 failed on the first run (a strict-mode locator in the new test, and the new client sorting first without a contact); after the fix both re-run green (the other 10 had passed). `m73-reports` 16 passed, the new overflow test failed on the meter, fixed and confirmed by a probe (0 overflowing cells at 390, 768, 1280); not re-run as a spec after the CSS fix. `m72-notifications` 14/14. Portal `portal.spec.ts` 13/13 (axe at 390 and 1280, both themes).
- My own pass (Playwright script against the local admin): axe 0 and no sideways scroll on every screen above at 390, 768 and 1280 in both themes; no console errors. Portal pages with real empty data: axe 0 (768 light Profile, 768 dark Home), no console errors.
- `node scripts/css-collisions.mjs`: ok. `pnpm lint` (whole repo, once, heavy): exit 0; 14 warnings, none in a line I changed (the m71.css ones are its existing `.icon` descendant rules).

### Not verified
- After the merge of AF3 (b4acadb7) no test or e2e was re-run (no file of mine overlaps it).
- The `m73-reports` spec as a whole after the meter fix, and the full `m74` spec in one run after its fix (both tests re-run alone).
- NVDA, Safari, Firefox and real phones; the "Send receipt again" refusal line on a real refusal (text only, pinned by a test).
- Local DB note: the first m74 run left a sample client `H-MW5YYI6P` with no contact in this worktree's local D1; I gave it a sample contact so the "first client" tests pass. Local only.

### Open questions
- The owner's words for the Requests empty line (07-ZP).
- At 768 the 12 monthly revenue cards make a long page; if the owner prefers, a later pass could fold the empty months. Kept as cards per the triage.

## Review of the fix round (reviewer, 2026-11-07): APPROVE
Copied by the lead (the reviewer couldn't commit). Reviewer claude-opus-5-5/high with `code-review` (its read-only helper on Opus 5.5), `security-review`, `cloudflare:workers-best-practices`, `frontend-design` and `dataviz`. Diff `05f7a521..1c24e418`, plus 55126b45. Nothing critical, high or medium.

**Ran:** db 170/170, admin 110/110, portal 60/60, jobs 79/79, e2e `m73-reports` + `m74-data-protection` 29/29.

**Visual pass:** admin payments, reconciliation, reports and the lead page; portal Profile and Home; both themes and in-app vs OS theme. axe 0, no sideways scroll, keyboard order fine.

**Findings:**
- **L1:** every event about a succeeded gateway refund now re-fetches it; a failing gateway retries and dead-letters a refund that is fine (`gateway/refund-events.ts:102-117`).
- **L2:** the dead-letter names and the bell lack `refund.reversed` (`apps/jobs/src/email.ts:335-341,420`).
- **L3:** the extracted `ERASURE_ACTION_0079` and `CLOSE_BAD_0079` lost 2 spaces of indentation against the applied 0079 (`triggers-data-protection.ts:187-199`). Regenerating would rewrite 0079 (whitespace only); the drift test folds whitespace.
- **L4:** `REFUND_REVERSED_ROW_SQL` is built by `String.replace` on exact text (`refund-notify.ts:191`).
- **L5:** at 390 px a tabbed Reports nav link sits partly under the fade (`reports/frame.tsx:33-51`, `reports.css`).
- **L6:** a dead `p.rowid AS rid` and its comment (`payments.ts:424`), and a stale `reversedRefundsSql` name (`sql-rules.ts:27`).
- **L7:**
  - the failed-refund seek (= AU49, kept as a follow-up);
  - `withoutErased` runs before the send-window check in `processRefundReversed` / `processRefundNotify`;
  - three copies of the capped body reader;
  - recon's `windowSql` duplicates `creditHeldSql`'s paging.

### Lead's triage of the review (2026-11-07)
- **AU61:**
  - **L1:** re-fetch a succeeded refund only for events that can mean a reversal (Stripe `refund.failed` / `refund.updated`, Razorpay `refund.failed`, PayPal's denied or reversed refund events); every other event closes quietly as `refund_settled`. Test.
  - **L2:** `refund.reversed` is named in the dead-letter alert and rings the same refund bell. Test.
  - **L3:** restore the exact indentation, and make the drift test compare the regenerated text exactly.
  - **L4:** one builder function takes the status clause. Test.
  - **L5:** on `focusin`, scroll the link fully into view (`nearestScrollLeft`).
  - **L6:** delete the dead column and fix both comments.
  - **L7:** check the send window first. One shared capped body reader (in `packages/core` or a shared fetch helper the three packages can import without a new package). One shared bounded-window paging helper for `creditHeldSql` and recon.
- **AU49** stays a follow-up.

## Review fixes (builder): AU61, builder claude-opus-5-5/high, 2026-11-07, branch `fix/audit-rev` from `origin/fix/audit-m6-m7` (f42bc7f6)
Skills: `cloudflare:workers-best-practices` (L1, L2, L4, L7: no buffering of unbounded bodies, no gateway call on a routine event, no key work outside the send window), `cloudflare:wrangler` (loaded per docs/14 §9; no config or binding changed, so nothing of it applied), `frontend-design` (L5: the fade's width named once, as the row's `scroll-padding-inline`, read by the frame). Commits 871d3e94, f9271d51, 2610d41d, 8662f22e.

### What changed, by item
- **L1:** core `mayReverseRefund(provider, eventType)` (`refund-gateways.ts`): Stripe `refund.failed` / `refund.updated`, Razorpay `refund.failed`. PayPal: the only refund event this branch reads is `PAYMENT.CAPTURE.REFUNDED` (a success; PayPal names no refund-failed event, and `PAYMENT.CAPTURE.REVERSED` is M6.4's capture path, not a refund), so none re-fetches. `gateway/refund-events.ts`: a succeeded refund on any other event closes as `refund_settled` with no gateway call. Tests: core (the mapped names), admin `audit-money.test.ts` (Razorpay `refund.processed` / `refund.created` with the gateway down: `processed`, `refund_settled`, 0 fetches; `refund.failed` still re-fetches and reverses; Stripe `refund.created` 0 fetches, `refund.updated` re-fetches).
- **L2:** `apps/jobs/src/email.ts`: `refund.reversed` named in `DEAD_LETTER_KIND_NAMES` ("returned-refund email to a client", builder's words for the lead, staff-only) and rings the same `refund.email_failed` bell through `parseRefundReversed` (one per owner and refund, so a refund whose notify and reversal emails both dead-letter rings once). Test in `m72-jobs.test.ts` (named, belled once, a malformed body rings nothing).
- **L3:** `ERASURE_ACTION_0079` / `CLOSE_BAD_0079` take 0079's own indentation back; the generator now reproduces 0079 byte for byte. Every trigger set was compared byte for byte: only 0079 had drifted (0072, 0074, 0082, 0084, 0086 and the rest were exact; 0001 keeps its known prefix exception). **0084 (unapplied, on this branch only, not on `main`) is regenerated** with `scripts/write-triggers.ts audit_af2_triggers`, whitespace only, because it embeds `CLOSE_BAD_0079`. 0079 itself is untouched (also not on `main` yet). Drift tests now compare exact text: `triggers.test.ts` reads every migration with Vite's eager `?raw` glob (typed in `test/env.d.ts`), and the 0079 test in `data-protection-triggers.test.ts` likewise.
- **L4:** `refundRowSql(statusClause)` builds `REFUND_ROW_SQL` and `REFUND_REVERSED_ROW_SQL`; test that both equal the builder's output and share every byte but the clause.
- **L5:** `revealScrollLeft` (lib/reports.ts, `nearestScrollLeft` with the fade's inset, clamped for wide links) used by the frame for the open report and, new, on `focusin` inside `.report-nav`; `reports.css` gives `.report-nav` `scroll-padding-inline: var(--space-10)` (the fade's width; the frame reads it from the computed style). Unit test of the decision (7 cases).
- **L6:** `p.rowid AS rid` and its `& { rid }` type gone from the payments list; the list's doc comment now names every variant's index and says no cursor uses rowid; `sql-rules.ts:27` names `refundsOutSql`'s second branch. The payments list is a finance hot route, so the start-up dry run fixtures were regenerated (`node scripts/cpu-probe.mjs --write-fixtures` after admin, jobs and portal builds; 7 files, made-up data only).
- **L7:**
  - `processRefundNotify` / `processRefundReversed`: no contacts → `none`; then the send window; only then `withoutErased`. Test: outside the window both answer `delayed` with no erasure key set; inside it the missing key still throws (retried).
  - core `@techaust/core/body` (`readBodyCapped`, `readTextCapped`, pure over `ReadableStream`): used by `gateway/answer.ts` (keeps its no-body `json()` path for the dry run and its `{ok:false}` mapping), `packages/email` (re-exports it as `readTextCapped`, same cap and `.catch`), `packages/auth/src/turnstile.ts` (same cap, fails closed). **`packages/auth` gains `"@techaust/core": "workspace:*"`** (a workspace link, no npm package; lockfile +3 lines): auth imported nothing from core before, and no other place is shared by all three. Core test `body.test.ts`.
  - `boundedWindowSql` (`@techaust/db/refunds`) builds `creditHeldSql` and recon's `windowSql`. Twin tests run the hand-written windows (kept in the tests) against the shared ones on every page: db `credit-held-rows.test.ts` (scan 1,000 and 50 at 5,007 payments), admin `audit-money.test.ts` (both recon lists at 5,000 payments): identical rows.

### Commands and results (all through `tools/heavy.sh`, logs `.logs/au61-*`)
- Tests: core 2,713/2,713 (coverage 98.1 % statements); db 1,092/1,092; auth 156/156; email 205/205; jobs 780/780; admin 5,310/5,310 (199 files, worker and SPA).
- Typecheck: core, db, auth, email, jobs, admin, portal, web: all exit 0.
- Builds: admin (budgets ok: front 121,871, API 561,095, finance 435,938, invoices 567,389 bytes), jobs (871,132), portal (163,583: the build's note says past its 160,000 plan line; not caused here, the shared reader replaced turnstile's own copy).
- `node scripts/check-migrations.mjs`: ok (87 migrations).
- Final `pnpm lint` (once): exit 0, 0 errors; 14 warnings and 8 infos, all in files this round didn't touch (pdf tests, portal CSS, core `public-text.ts`, web `catalogue.ts`, admin `reports.test.ts`).

### Not verified
- L5 in a browser (no live check at 390 px; the scroll decision is unit-tested and the CSS is one property). A designer or reviewer pass should confirm a tabbed link clears the fade.
- Other capped readers outside the brief remain separate: `apps/jobs/src/hooks/shared.ts`, `apps/jobs/src/usage.ts`, `apps/web/src/forms.ts` (a follow-up if the lead wants one reader everywhere).

### Questions
- The auth → core workspace link (L7): keep it, or should the Turnstile reader stay its own copy?
- L2's alert words "returned-refund email to a client" are mine; approve or replace.

### Lead's answers to the review fixes (2026-11-07)
- **AU62:** `packages/auth` keeps its new workspace link to `@techaust/core`. It's internal and pure (no new outside package; packages import packages).
- **AU63:** the dead-letter alert name for `refund.reversed` is reworded by the lead to "the email telling a client their refund came back" (staff line).
- **AU64:** the portal bundle is 163,583 bytes (ceiling 200,000; plan line 160,000; L47 is the owner's question, and the lead's recommendation stays: raise the line to 180,000). The other three copies of a capped reader (`apps/jobs/src/hooks/shared.ts`, `usage.ts`, `apps/web/src/forms.ts`) become a follow-up.

## Lead's final checks (2026-11-07)
At 5fa703d7, one package at a time (a re-check reviewer ran beside it, so the start-up times read high):
- **`pnpm build`:** exit 0.
- **`pnpm check`:** exit 0.
- **`pnpm test`:** core 2,713; db 1,092; auth 156; email 205; pdf 415; ui 471 (+2 skipped); testing 4; web 1,019; portal 957; jobs 780; admin 5,310. All pass.
- **Bytes and start-up (fastest of 7):**

  | Worker | Bytes | Start-up |
  |---|---|---|
  | admin front | 121,871 | 51.2 ms |
  | API | 561,095 | 159.4 ms |
  | finance | 435,938 | 129.6 ms |
  | invoices | 567,389 | 146.0 ms |
  | portal | 163,583 (past the 160,000 plan line; L47, the owner's) | 67.6 ms |
  | jobs | 871,148 | 163.2 ms |

  All are under their ceilings and the 200 ms gate.
- **Migrations:** 0080–0086 pass `check-migrations` (87 in all).
- **Earlier finding, fixed:** a full parallel run timed out on two web tests under load; one package at a time is green. The `rate-limit-config` core test missed `RL_SIGNOUT` and was fixed by the lead (55126b45).

## Re-check of the review fixes (reviewer, 2026-11-07): APPROVE
Copied by the lead. Reviewer claude-opus-5-5/high; skills `cloudflare:workers-best-practices`, `frontend-design`. At 5fa703d7, diff `f42bc7f6..5fa703d7`.
- **L1–L7:** each fixed completely, with a test that fails without it.
- **0084:** changed in whitespace only (`git diff -w` empty); 0079 untouched.
- **Shared reader:** each caller keeps its cap and its error mapping; the auth to core link has no cycle and adds 76 bytes per bundle.
- **Warm fixtures:** made-up data only.
- **L5 in the browser:** at 390 px in both themes every tabbed link clears the fade (smallest gap 40 px); at 768 px the index wraps.
- **Ran:** core 9/9, db 112/112, jobs 42/42, auth 11/11, email 3/3, admin 131/131.
- **One new low:** a comment named a test file that doesn't exist (`triggers-data-protection.ts:192`). Fixed by the lead (it names `test/triggers.test.ts` and `test/data-protection-triggers.test.ts`).

**Status of the fix round:** reviewed (APPROVE) and re-checked (APPROVE); the lead's final checks are green. The PR is held until #187 and #189 merge.

## Handover (2026-11-07)
- **Where it stands:** all seven areas audited (B0–B6), and every finding fixed or decided (AU1–AU64).
  - Two analyst early checks plus one re-check (GO); the designer's screens; review APPROVE and re-check APPROVE; the lead's final checks green.
  - PR [#190](https://github.com/techaust/techaust_platform/pull/190) is open and **held** (Auto-fix on). It merges after #187 and #189, then takes `main` in under CLAUDE.md's pre-squash-head rule.
  - No owner step of its own.
- **Waits on the owner:**
  - 07-ZT C1–C3 (the refund-came-back email, gated off);
  - the portal Requests empty line (07-ZP);
  - the RB-45 privacy line and the "New request" privacy wording;
  - the Terms upload sentence;
  - the RA-29 fees note;
  - AU45, a "refund returned" statement line (recommended before launch);
  - the SES runbook Part 9 hosted step (on the owner's yes).
- **Follow-ups:**
  - AU49: a partial index for reversed refunds if staging's rows read grow;
  - three more capped body readers (`apps/jobs/src/hooks/shared.ts`, `usage.ts`, `apps/web/src/forms.ts`);
  - the twelve monthly revenue cards at 768 px (fold the empty months if the owner prefers);
  - staging D1 `rows_written` for the retention budget;
  - real gateway and SES behaviour after a refund comes back.
- **CLAUDE.md:** the audit section was added on this branch (2026-11-07).

## The owner's copy approval (2026-11-07, lead)
- **Owner, 2026-11-07:** approved the owner's copy page as recommended (items 11–19 of the list of pending approvals). Commits f3c04f63, 815f7e95 and 452e1688:
  - 07-ZT C1–C3 word for word, so `APPROVED_07ZT` is on;
  - privacy notice 0.3: RB-45, 07-ZR C7, and the "New request" path in place of "Request my data";
  - Terms 0.3: the upload sentence removed;
  - the portal Requests empty line G13, "You haven't sent any requests yet.";
  - the RA-29 fees note in the owner's wording;
  - AU45, the "refund returned" statement line: yes, as its own task after this PR merges.
- **Lead's run:**
  - core 2713/2713, portal 957/957, jobs 780/780, admin 5310/5310;
  - web 1021/1021, after the sitemap date test followed privacy's 0.3 effective date;
  - email 205/205, after the refund-reversed snapshot update (only the mark removed);
  - `pnpm check` green.
- **Review** (reviewer, Opus 5.5 high): SEND BACK on **high 1**. The drafted privacy line "They can't see your email address or phone number" was untrue: an accepted offer's record (`ACCEPTANCE_SQL`) and certificate (`CERT_KEY_SQL`, `certificate.ts`) are scoped to the client and show the accepter's email, IP address and browser to colleagues.
  - The owner chose the wording with the exception (a54df17a): "Other people at your organisation who have client portal access can see your name and job title. If you accept a proposal or estimate, they can also see its acceptance record, which shows your name, email address, IP address and browser."
  - Low 4 (stale refund-notify comments) was fixed in 30c77a03.
  - Second review (rule: after a high finding): APPROVE.
- **Kept:** low 6, the core constant `PRIVACY_KEYED_FORM_LINE` duplicates the web page's C7 words (typographic apostrophes there). It is a follow-up: one source, or a test pinning both.
- Usage: reviewer agent-aac3227c422cb1f6b, claude-opus-5-5/high, skills: code-review. Its `code-review` helper ran at low effort (flagged by `model-audit`; recorded in the M7.4 run file).
