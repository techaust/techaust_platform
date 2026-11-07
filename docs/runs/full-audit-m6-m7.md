Status: all seven areas audited (2026-11-07); fix round running (AF1 money and gateways; AF2 jobs, portal, notifications, data protection; then the designer)
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
