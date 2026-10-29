Status: open
Tier: A (it touches money, ledgers, numbering and triggers)
Usage:

# FX-1: data and jobs fixes from the full audit

This is part of the owner's full audit of M1–M5 ([full-audit-m1-m5.md](full-audit-m1-m5.md), "Fix plan").
- **Model:** Opus 5.5 at high effort for every agent.
- **Base:** `origin/fix/m5-owner-findings`. This task merges after the M5 owner-fix PR; then follow CLAUDE.md "after a squash merge".

## Brief (lead, 2026-10-29)
PRD: ADM-SET-04, ADM-INV-02/09/14, JOB-PDF-01, JOB-Q-01, JOB-CRON-01/02 (as cited below). Read each finding in full in the audit run file: sections A0, A5 and A6.

### Builder (Opus high): data, logic, jobs, config, docs
1. **A0 2, distinct numbers across series.**
   - `numberingSettings` (`packages/core/src/schemas/settings.ts:290-300`) refuses a save where two series could print the same number. Rule: each series' literal prefix (the format with `{FY}` and `{N}` removed) must differ.
   - Backstop: a new partial unique index on `documents(number_display)` for invoice-family types where `number_display IS NOT NULL`. A new migration, index only.
   - First prove the existing local data can't break it, and say so.
2. **A0 4, the ledger identity.**
   - A new trigger on frozen invoice-family documents other than credit notes: `paid_minor >= 0` and `balance_minor = max(0, total_minor - paid_minor - credited_minor)`.
   - Check every current write path keeps to it (issue, advance, proforma conversion, credit recompute) and test each one.
3. **A0 5:** make `irn`, `ack_no`, `ack_date` and `signed_qr` set-once by re-creating `documents_frozen_update` (the 0040/0047 pattern; `src/triggers.ts` plus `scripts/write-triggers.ts`). The IRN QR on the PDF stays a follow-up until e-invoicing applies.
4. **A0 6:** `sendStatements` gets a `next_no <= maxNumber` guard and a friendly 409 `series_full`, like `freezeStatement:394`.
5. **A0 8:** the credit-note INR cap refuses a NULL `total_inr_minor` on a parent that has an INR total (re-create the trigger).
6. **A0 9:** issue-time triggers for:
   - the LUT of the receipt day's FY (advances);
   - discount after sale from 2026-11-01 IST.
   Mirror the core and freeze-WHERE rules exactly (`issue.ts:446`, `:705`; `LUT_FOR_FY_SQL`, `DISCOUNT_AFTER_SALE_FROM_SQL`), and tag them with their 08-C IDs.
7. **A0 10:** add the missing docs/04 §9 rows for `invoices.ims`, `invoices.send` and `clients.careAutoIssue`, matching `permissions.ts`.
8. **A5 10:** `voidBlockers` (`packages/core/src/invoices.ts:494`) tests the live-issued status set, not `status !== "issued"`.
9. **A6 2, failed PDFs in the sweep.**
   - Count failed nights per document. Use a new table or column; never rebuild a referenced table.
   - The daily sweep (`apps/jobs/src/pdf.ts:722-725`) skips a document after 3 failed nights and rings a `pdf.refused` bell once.
   - Order the sweep by its last attempt.
10. **A6 3:** `"triggers": {"crons": []}` in jobs `env.production`. `scripts/check-worker-config.mjs` must require an empty array there, and fix the misleading "Not inherited" comments.
11. **A6 4, email retries.**
    - Exponential backoff for an SES `retry` answer: 60 s doubling to 1 h.
    - `max_retries` about 10 on the email queue in staging (and production when it exists).
    - The catch-all uses the same backoff.
    - Record in the code that the 8 s SES timeout can send twice (accepted).
12. **A6 6:** move the purge scan out of `scheduled` into one queued `lead.purge.scan` message, so the cron only enqueues.
13. **A6 7:** repeat the care scan and `alerts.daily` at the next two IST hours (both are idempotent). Test that a repeat does nothing.
14. **A6 10, runbooks.**
    - Update `docs/runbooks/environments.md`: R2 buckets, Browser Run, jobs crons, `ADMIN_JOBS`, five Workers.
    - Add a step-by-step SES key rotation to `ses-and-turnstile.md` (key due by about 2027-01-21).

### Rules
- **Tier A order:** the builder stops after the schema, migrations, triggers and core logic (items 1–6 and 8), with tests, then reports for the analyst's early check. Only then items 7 and 9–14.
- **Migrations:** check CHECK constraints for `__new_` qualification, and no rebuild of a referenced table (`scripts/check-migrations.mjs`). Triggers are generated, never hand-written.
- **Tests:** keep the trigger-coverage tests green.
- **Never touch staging or any hosted service.** The new D1 migrations reach staging only through the normal deploy after merge.

### Done means
`pnpm check` and the full `pnpm test` pass, with a report per item.

### Out of scope
- the e-invoice QR block;
- the `review_items` list (M6.1);
- workflow changes (the owner's yes);
- FX-2, FX-3 and FX-4 files (`apps/admin/src`, `apps/portal`, `apps/web`, the headers files, `packages/pdf`).

## Early check request (builder)
Request from the builder (claude-opus-5-5, high), 2026-10-29, branch `fix/fx1-builder` (commits 44d6ea1c, f38342b0, 32803a99 on top of 672d3aca). Items 1–6 and 8 are built with tests; items 7 and 9–14 are not started.

**Skills loaded:** `cloudflare:workers-best-practices` (no new binding or handler; the one Worker-facing change, `document-send.ts`, keeps every write in its one batch), `cloudflare:wrangler` (no config touched in this part; it applies to items 10 and 11). Not loaded yet, for the later items: `cloudflare:cloudflare` (queues, Browser Run: items 9, 11, 12), `aws-messaging-and-streaming` and `aws-iam` (item 14's SES key rotation).

**Migrations (new files only, nothing applied edited, no table rebuilt; `scripts/check-migrations.mjs`: ok, 51 migrations):**
- `packages/db/migrations/0049_invoice_number_display.sql` (drizzle-kit generate from `src/schema/documents.ts`): `CREATE UNIQUE INDEX documents_invoice_number_display ON documents (number_display) WHERE number_display is not null and type in (the 8 `INVOICE_FAMILY` types)`. Index only; no CHECK, so no `__new_` qualification to fix.
- `packages/db/migrations/0050_ledger_triggers.sql` (`drizzle-kit generate --custom --name ledger_triggers` + `node scripts/write-triggers.ts ledger_triggers`; set `ledger_triggers` = `ledgerTriggerStatements()` in `src/triggers.ts`; the "installed equals generated" test covers it).

**Local data proof for the index (item 1):** a read-only `node:sqlite` query on the shared local D1 (`.wrangler/state/v3/d1/...sqlite`, migrations up to 0047): 0 numbered invoice-family documents, 0 duplicate `number_display`, 0 frozen rows that break the ledger identity, and the stored `numbering` row is the defaults (all prefixes distinct). **Not verified:** staging's data (never touched). There, a duplicate number across series could only exist if two series were saved with clashing formats and both issued in one FY; if it did, 0049 would fail on the staging deploy and nothing after it would apply.

**Triggers in 0050 (each abort message starts with its trigger's name):**
1. `documents_frozen_update` dropped and created again over `FROZEN_COLUMNS_0047` with `SET_ONCE_0050` = 0040's set-once list + `irn`, `ack_no`, `ack_date`, `signed_qr` (item 3). Those four left `MUTABLE_AFTER_FREEZE` and joined `SET_ONCE_AFTER_FREEZE`; `einv_status` stays mutable. The coverage test reads the installed trigger.
2. `documents_credit_note_cap` dropped and created again: 0042's text plus `OR (p.total_inr_minor IS NOT NULL AND NEW.total_inr_minor IS NULL)` inside the parent row (item 5). 0042's generator is unchanged byte for byte (`creditCapSql("")`).
3. `documents_ledger_identity` (item 2): `BEFORE UPDATE OF paid_minor, credited_minor, balance_minor, frozen_at`, when `NEW.frozen_at IS NOT NULL AND NEW.type IN ('proforma', 'tax_invoice', 'export_invoice', 'debit_note')` and `paid_minor IS NULL OR paid_minor < 0 OR balance_minor IS NOT max(0, total_minor - paid_minor - credited_minor)`. `frozen_at` is in the column list, so the freeze itself is judged.
4. `documents_discount_after_sale_from` (item 6b): draft → issued of a credit or debit note whose `header_extras.noteOf.reason.code` is `discount_after_sale` with `issue_date` NULL or before `DISCOUNT_AFTER_SALE_FROM_SQL` (2026-11-01). The twin of core `reasonInForce` and `noteIssueTail`'s WHERE (08-C RA-02).
5. `documents_advance_lut_fy` (item 6a): draft → issued of an `export_invoice` with `export_mode = 'lut'` and `header_extras.advance.receivedOn` set needs `LUT_FOR_FY_SQL` for `fyTokenOfDateSql(receivedOn)`. The twin of core `advanceRouteFor` and the advance freeze's `?33` (08-C RA-19, Q37). `fyTokenOfDateSql` is tested day by day against core `fyOfDate` (2020 to 2031 plus the 2099/2100 turn).

**Every write path checked against `documents_ledger_identity`:**
- Invoice freeze (`freezeStatement`, used by the owner, approval and `care_auto` issues of tax and export invoices, proformas and debit notes): `balance_minor = total_minor` with paid and credited 0. A credit note is outside the trigger (its balance is 0). Tested: `ledger-triggers.test.ts`; the proforma, care and invoice suites pass.
- Advance batch (`advanceIssueStatements`): the new invoice is frozen at the total, then `paid = total, balance = 0`; the proforma gets `paid += amount, balance -= amount` (the freeze WHERE holds `balance >= amount`, so it stays at `total - paid`). Tested over three part payments (`invoice-types.test.ts`, new describe).
- Credit recompute: **changed** to ONE `UPDATE ... FROM (SELECT sum ...) AS s` that writes `credited_minor`, `balance_minor` and `status` together. Before, it was two statements; the first left the row half written and the new trigger refused it. Tested: part credit, full credit, credit on a part-paid invoice. The `care-auto-sql` snapshot (credit-note variant) was updated on purpose.
- Void: writes no ledger column, so the trigger does not fire. Tested.
- No other code writes these columns (grep of admin, jobs, portal and db sources); M6 payments will have to write the three together.
- The trigger is UPDATE-only. An INSERT of an already-frozen row is not a real path (every writer inserts a draft), but many test fixtures (portal included) insert frozen rows directly. Analyst: say if you want INSERT covered too.

**Other changes for items 1, 4 and 8:**
- Core `numbering.ts`: `formatsCanClash` and `numberingClashes`. I added a second test to the brief's rule (same literal text). The brief's rule alone misses a real clash: "TH/{FY}/{N}" with 5 digits and "TH/{FY}/0{N}" with 4 both print TH/2627/00001. So a pair is also refused when the written-out shapes (digits as `#`) can match. This only ever refuses more. A fast-check property proves the check is sound.
- Core `settings.ts`: `numberingSettings` refuses a clash per field (`numberingClashMessage`).
- `apps/admin/worker/settings.ts`: the save route reads with `storedNumberingSettings`, so the rule is applied there too, only for a pair that includes a series this save changes. A stored clash then never blocks a save of another series, as with LD18.
- `sendStatements` gets a required `maxNumber`. A first version's freeze adds ``AND (next number) <= ${maxNumber}`` as a validated integer literal, so the stored statement's placeholders keep their numbers; the `issue-sql` snapshot was updated on purpose for the four first-version variants only. `document-send.ts` passes it, and `explain` answers 409 `series_full` (reusing `SERIES_FULL` from `invoice-model.ts`) after `numbering_changed`. Tested in `documents-series-full.test.ts` (proposal and estimate: refused with nothing moved, and number 9999 still given).
- `voidBlockers`: `not_issued` only outside `LEDGER_STATUSES`, so a draft or a converted proforma.
- The refusal regexes of `invoice-issue.ts` and `invoice-advance.ts` now include the new trigger names, so a disagreement between a WHERE and a trigger reads back as an explained 409, not a 500.
- `packages/db/src/sql-rules.ts` (new, pure): `DISCOUNT_AFTER_SALE_FROM_SQL`, `LUT_FOR_FY_SQL` and `fyTokenOfDateSql`, re-exported from `issue.ts`. The Node-only trigger script and `tsconfig.node.json` can then read them without the D1 types.

**Tests run:**
- core 1,760 pass;
- db 470 pass;
- admin 3,229 pass;
- portal 620 pass;
- typecheck of core, db, admin and jobs: ok;
- admin build: API 596,477 bytes, startup 59.8 ms;
- jobs 518 of 519 pass, one failing (see the blocker below).

**Blocker for the lead (outside my files):** `apps/jobs/test/pdf-notes.test.ts > credit_usd_igst` fails on `documents_discount_after_sale_from`. The fixture `packages/pdf/test/fixtures/notes.ts:82-88` issues a credit note for "Discount after sale" dated 2026-10-28, which RA-02, core `reasonInForce` and the freeze WHERE already refuse. The new trigger is the first layer the fixture's raw freeze meets. The fix is one line in `packages/pdf` (the reason code, or a date of 2026-11-01 or later). `packages/pdf` is outside this task, so I left it. Which task makes that change?

**New copy for page 07-Y:** "Numbers in this series could be the same as in the {series label} series. Give each series its own letters." (Settings › Numbering). The documents screen has no `series_full` line in `apps/admin/src/lib/documents.ts` (it falls back to the API's "This numbering series has no numbers left this year"); that is for the designer or FX-3.

**Open questions for the analyst:**
- `LEDGER_IDENTITY_TYPES_0050` leaves out `receipt`, `receipt_voucher` and `refund_voucher`. They are not issuable yet; M6 defines their ledger. Is that right, or should they be in from now?
- Should the identity also cover INSERT (see above)?
## Early check (analyst claude-opus-5-5/high, 2026-10-29 ~06:40–06:55 IST, on origin/fix/fx1-builder eb009c87): CHANGE (two small fixes), the rest GO
- **GO:**
  - 0049: no legitimate flow needs a repeated printed number; the WHERE list equals `INVOICE_FAMILY`.
  - 0050:
    - the frozen-update rebuild matches the 0047 constants, plus the four set-once fields;
    - the INR cap bites only on foreign-currency parents;
    - the ledger identity is kept by all four write paths (`issue.ts` 385, 544, 737, 754); void writes nothing;
    - the `UPDATE … FROM` is sound;
    - the discount and LUT triggers are the exact mirror of core and the freeze WHERE (RA-19 stays OPEN).
  - `formatsCanClash` can't miss a clash.
  - The `sendStatements` guard and `voidBlockers` are correct.
  - Ran: db 470, core 101, admin 174, migration guard: all pass.
- **Changes:**
  1. **High (test only):** in `packages/pdf/test/fixtures/notes.ts:330`, date only the discount-after-sale fixture `2026-11-02`: `issueDate: spec.reason.code === "discount_after_sale" ? "2026-11-02" : "2026-10-28"`. Keep the reason, which is the only coverage of its label. The builder makes this change; no other branch touches `notes.ts`.
  2. **Medium:** `care-billing.ts:725`: the refusal regex must also match `UNIQUE constraint failed: documents\.` and log the ids-only integrity line, so a 0049 clash during auto-issue is `freeze_refused`, not a retried RPC. Test: a row pre-inserted with the next number makes the auto-issue refuse, leaves the counter unmoved, and leaves the draft a draft.
- **Kept (low):** the literal-text rule refuses some pairs that can't actually clash (only ever more). No change.
- **Builder's questions:** receipt and voucher types go to M6 (widen `LEDGER_IDENTITY_TYPES` in a new migration; RA-17 is OPEN). An INSERT twin trigger comes with the first writer that inserts non-draft rows. Both are follow-ups.
- **Lead's staging check (2026-10-29, read-only SELECTs on staging D1):**
  - (a) duplicate invoice-family numbers: none;
  - (b) rows that break the ledger identity: none;
  - (c) the stored numbering formats all have distinct prefixes (TH/INV, EXP, CN, DN, RV, RF, RCT, PI, EST, PRP): no clash;
  - (d) e-invoice fields set: 0.

  0049 and 0050 will apply cleanly.

## Builder report
Builder claude-opus-5-5, high, 2026-10-29. Branch `fix/fx1-builder` (from `origin/fix/fx1-data-jobs`; the analyst's early check merged in at acb3ee08), 15 commits from 44d6ea1c to 85991c77, pushed. All 14 items are done. Items 1–6 and 8 are described under "Early check request (builder)" above; below are the two early-check changes and items 7 and 9–14.

**Skills loaded:**
- `cloudflare:workers-best-practices`: queue retries and delays kept in the consumer; no new binding; the cron only enqueues.
- `cloudflare:wrangler`: checked in the pinned wrangler `config-schema.json` that `triggers` is `EnvironmentInheritable` while `services` and `secrets` are not. This decided the item 10 comments and the guard.
- `cloudflare:cloudflare`: Queues and Browser Run for items 9, 11 and 12. Retry delays stay at most 1 h, well under the queue maximum; 10 tries fit the message retention.
- `aws-messaging-and-streaming`: SES is the email channel; this only routes, there was no SES API change.
- `aws-iam`: the rotation keeps the existing send-only policy, uses a second access key (an IAM user holds two), and deactivates before deleting.

**Early check changes (analyst, CHANGE 1 and 2):**
1. `packages/pdf/test/fixtures/notes.ts:331`: the "Discount after sale" note fixture is dated 2026-11-02; every other fixture stays at 2026-10-28, and the reason is kept. Packages/pdf: 340 tests pass. Jobs `pdf-notes`: 18 pass.
2. `apps/admin/worker/care-billing.ts`: the care auto-issue's refusal regex now matches `UNIQUE constraint failed: documents\.` and logs an ids-only integrity line (`care invoice issue refused by a unique key`, document id, series, FY). The answer is `freeze_refused`, never a thrown, retried RPC.
   - New test in `care-billing.test.ts`: a proforma pre-printing the invoice series' next number (FY 3435, so no other test meets it) makes the auto-issue refuse. The log line is checked, the counter does not move, and the draft stays a draft.

**Item 7 (A0 10):** docs/04 §9 has three new rows, `invoices.ims` (Owner), `invoices.send` (Owner and Staff, send) and `clients.careAutoIssue` (Owner, step-up; turning it off is `clients.finance.write`), matching `permissions.ts`.

**Item 9 (A6 2, JOB-PDF-01):**
- Migration `0051_pdf_failures.sql` (drizzle-kit, CREATE TABLE only; FK to `documents` with cascade; CHECK `nights >= 0`, qualified with its own table name, not `__new_`).
- Row counting:
  - the sweep records `last_attempt_at` for every document it picks, in one batch, after the `sendBatch`;
  - a PDF dead letter (snapshot or render) counts one failed night per IST day (`last_failed_day`, so a snapshot and a render dead letter on one day count once).
- At 3 nights (`SWEEP_MAX_FAILED_NIGHTS`) the owners get one `pdf.refused` bell (`INSERT OR IGNORE`, unique per owner, kind and document). The sweep leaves the document out both by `nights < 3` and by the existing refused-bell test.
- `SWEEP_SQL` orders by `coalesce(last_attempt_at, 0)`, then `frozen_at`, then id. It still reads `documents_pdf_pending` and finds failures by primary key; the order is a sort of the pending set, and the old "no TEMP B-TREE" assertion was replaced on purpose.
- Tests: least-recently-tried first across two nights; nights counted once per day; at the third night the bell (title and link) and leaving the sweep; a fourth night rings nothing new.
- New bell line for 07-Y: "The PDF of {number} couldn't be made on 3 nights, so the nightly retry has stopped. A developer needs to look at it."

**Item 10 (A6 3):**
- `apps/jobs/wrangler.jsonc` `env.production` gets `"triggers": { "crons": [] }`.
- `jobsConfigProblems` now requires a present, empty list in production: a missing `triggers` is its own problem ("…inherits the top level's") and a non-empty list is "no cron triggers until Phase 7".
- Comments: the wrong "Not inherited" on `triggers` is corrected; the ones on `services`, `secrets` and `browser` were right and stay. The header comment is brought up to date.
- Guard tests are in `apps/web/test/worker-config.test.ts`. **That file is under `apps/web`, FX-2's area**: two assertions changed and one test added. Merge with care if FX-2 touches it.

**Item 11 (A6 4, JOB-Q-01):**
- `emailRetryDelay(attempts)` = min(3,600, 60 × 2^(attempts − 1)), used for an SES `retry` answer and in the catch-all, for the email queue only; the other queues keep their delays.
- Email consumer `max_retries` 5 → 10, top level and staging (production has no queue). That rides out about 4 h 45 min of SES trouble before the dead letter.
- `apps/jobs/src/email.ts` records that the 8 s transport timeout can send twice, and that at-least-once delivery is accepted.
- Tests: the delay table; an SES 503 through `handleQueue` at attempts 1, 4 and 9; a throwing consumer at attempt 3.

**Item 12 (A6 6, JOB-CRON-01):**
- The daily cron no longer calls `enqueueDue`. One `lead.purge.scan` with no cursor (`purgeScanMessage`) rides the statistics `sendBatch`, and the existing consumer does the page.
- Tests:
  - the cron sends the scan and no `lead.purge`;
  - the scan, consumed, queues the due lead;
  - the whole daily cron runs with a D1 trap.
- `stats.test.ts` changed on purpose: 2 queue calls, not 3, and the stats batch has `STATS_METRICS.length + 2` bodies; its "one half failing" test now fails the statement-purge call.

**Item 13 (A6 7):**
- The care scan is queued at 06:00, 07:00 and 08:00 IST, and `alerts.daily` at 09:00, 10:00 and 11:00 (`REPEAT_HOURS` 2). The realisation scan and the EDF reminder stay at 09:00 only.
- Tests:
  - the hour table (billing-routing, reports-b; changed on purpose);
  - a care scan at 07:00 and 08:00 after the 06:00 bill drafted the period queues nothing;
  - alerts at 10:00 and 11:00 after 09:00 queue no email and no new bell.

**Item 14 (A6 10):**
- `docs/runbooks/environments.md`: queue producers and consumers, both private R2 buckets with their bindings, Browser Run (staging jobs only, the daily allowance and pacing), both crons and what each queues (repeats included), the `ADMIN_JOBS` → `BillingJobs` binding and the deploy order, five Workers, and production's empty cron list.
  - Taken from the committed configs and the record, not from the dashboard.
- `ses-and-turnstile.md` Part 8: step-by-step key rotation, next due about **2027-01-21** (key made 2026-10-23). It reuses the existing hidden-input script `.logs/owner/m2.4-ses-keys.ps1`; I read its `RESULT:` lines to word the steps.
  - Steps: make a second key → store it → test → deactivate → delete the next day.
  - It warns that the two `wrangler secret put` calls go live one after the other: an email in that gap gets a permanent 403 and fails, so I check the email log.
  - It warns that a failure on the second put leaves email broken until the script is rerun.

**Files changed (items 7 and 9–14, plus the early-check changes):**
- `apps/admin/worker/care-billing.ts`, `care-billing.test.ts`
- `packages/pdf/test/fixtures/notes.ts`
- `docs/04-prd.md`
- `packages/db/src/schema/documents.ts`, `migrations/0051_pdf_failures.sql`, `meta/0051_snapshot.json`, `_journal.json`; `test/migrations.test.ts` (52 tables, 0051 listed)
- `apps/jobs/src/{pdf,queue,email,purge,index,billing}.ts`, `apps/jobs/wrangler.jsonc`
- `apps/jobs/test/{pdf,pipeline,purge,stats,billing-routing,care-jobs,alerts,reports-b}.test.ts`
- `scripts/check-worker-config.mjs`, `apps/web/test/worker-config.test.ts`
- `docs/runbooks/environments.md`, `docs/runbooks/ses-and-turnstile.md`
- 0049/0050 drizzle snapshots formatted by biome (the first `pnpm check` failed on their format).

**Commands and results (heavy ones through `tools/heavy.sh`; logs in the worktree's `.logs/`):**
- `pnpm check` (whole-repo lint, typecheck, binding, content, worker-config and migration guards):
  - first run: exit 1 on the three drizzle snapshot formats;
  - after formatting: exit 0 (52 migrations, none rebuilds a referenced table).
- `pnpm test` (full), packages:
  - auth 135, ui 469 (+2 skipped), core 1,760, email 128, db 470, pdf 340: all pass;
  - web 428 (+16 skipped), portal 620, jobs 525: all pass;
  - admin 3,226 of 3,230: 4 timed out at 5 s under the full parallel run (`documents-send` V8, `invoice-notes` discard, `reports` statement PDF, `turnstile` 100 requests);
  - admin alone right after: **3,230 pass**.
- `pnpm --filter @techaust/jobs build`: bundle 865,635 bytes (limit 1,000,000), startup 81.2 ms.
- Earlier, `pnpm --filter @techaust/admin build`: API Worker 596,477 bytes, startup 59.8 ms.
- No dev server was started.

**Not verified:**
- Anything on staging: migrations 0049–0051, the crons, the email backoff against real SES, Browser Run.
- The production D1's SQLite for `UPDATE … FROM` (passes in workerd).
- That pnpm's workspace order really puts admin before jobs (A6 8, owner's yes).
- The runbook facts that rest on the record rather than the dashboard (bucket creation, the Browser Run allowance).

**Follow-ups:**
- `LEDGER_IDENTITY_TYPES_0050` widens to the receipt and voucher types in M6, in a new migration (analyst; RA-17 OPEN).
- An INSERT twin of `documents_ledger_identity` comes with the first writer that inserts non-draft rows (analyst).
- The care page's next billing day (core `nextBillingDayOf`) still says "tomorrow" from 06:00 IST, though the repeats at 07:00 and 08:00 can now draft the same day. A small core and copy change, left for the lead.
- `pdf_failures` rows stay after a PDF is finally made (harmless: the sweep reads only documents without a PDF). Clean-up can go with M7.4's retention work.
- New lines for page 07-Y:
  - the numbering clash message (Settings › Numbering);
  - the "nightly retry has stopped" bell.
  - The documents screen has no `series_full` line in `apps/admin/src/lib/documents.ts` (designer or FX-3).
- `apps/web/test/worker-config.test.ts` is touched by this task (item 10 guard tests): watch for an FX-2 overlap at merge.

**Open questions:** none for the owner.
