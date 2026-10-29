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

## Early check
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

## Builder report
_(pending)_
