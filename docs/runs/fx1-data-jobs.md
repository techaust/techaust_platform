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
_(pending)_
