Status: all seven areas audited (2026-11-07); fix round running (AF1 money and gateways; AF2 jobs, portal, notifications, data protection: early check ready on `fix/audit-af2`; then the designer)
Tier: A (it covers money, gateways, refunds, client scoping, staff auth and deletion)
Usage:

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
