# P7 LUT fold: retire the legacy single `tax.lut` before production

Status: brief written (lead, 2026-11-07 night); builder next.
Tier: A (tax: LUT routes on export invoices, advances and debit notes; Rule 96A). Branch: `feat/p7-lut-fold` from `origin/main`.

## Why
- **The owner (13, 2026-11-07):** nothing production needs stays pending before go-live.
- **rt1 follow-up 1** ([rt1-notes-rules](rt1-notes-rules.md), item 4 of the low findings and the lead's triage): before production, one migration folds any legacy M3 `tax.lut` into the M5.2 `luts` list and drops the key.
  - Today the settings screen still saves `lut` (`packages/core/src/schemas/settings.ts`: "the current screen still saves it").
  - Core (`lutsOf`, `lutForFyAsSql`, `legacyLutFate` in `packages/core/src/export-invoice.ts`) and SQL (`LUT_FOR_FY_SQL` and its twins) carry legacy branches that judge it differently. The direction is fail-closed, but there are two rules for one fact.
- 08-C RA-19 is settled. The LUT rules themselves don't change: only where the letter is stored.

## Do
1. **Data migration** (custom SQL, numbered after main's newest; in `packages/db/migrations` with the journal and snapshot as drizzle-kit expects; read CLAUDE.md "Migrations" first).
   - For the `settings` row holding `tax`: when `tax.lut` has a non-blank ARN and FY, and `luts` has no entry for that FY, append `{arn, fy}` to `luts`, under exactly `legacyLutFate`'s fold rules (read them).
   - Then remove the `lut` key in every case.
   - Idempotent. Test it on rows with: no lut; an empty lut; a lut whose FY already exists in `luts`; a foldable lut; a malformed lut (which `legacyLutFate` leaves out).
   - **Tell the lead the migration number before committing it:** another branch (`feat/rebuild-pdf`) is also adding one.
2. **Schema and screen:**
   - `settings.ts` stops accepting or writing `lut`. A stored row that still has it parses, and the key is ignored, so a later rollback can't crash.
   - The admin Settings › Tax screen stops sending it; check `apps/admin/src/routes/settings/*` and its lib.
3. **Code:**
   - Remove the legacy branches in `lutsOf`, `lutForFyAsSql`, `legacyLutFate` and any caller.
   - Remove the legacy part of `LUT_FOR_FY_SQL` and every SQL twin (grep `tax.lut`, `'$.lut'`, `legacy`).
   - Update the twin tests so core and SQL agree exactly again; the one known difference in the rt1 triage disappears.
4. **The seed:** read the settings default and make sure it no longer writes `lut`.

**Not your files** (others are editing them in parallel):
- `apps/admin/worker/gateway/*` and the payment hooks;
- the statement code;
- `apps/jobs/src/pdf.ts` and the admin PDF routes;
- the workflows and the backup scripts.

**Order:**
1. builder (stops after the migration, core and SQL for the analyst's early check);
2. the analyst's early check;
3. the reviewer (a designer only if the Tax screen visibly changes);
4. fixes, then a re-check.

**Done when:**
- the core (coverage gate), db, admin and jobs suites and `pnpm check` are green;
- the migration is listed in the run file;
- the Worker bytes are recorded;
- "## Builder report" is appended here;
- `fix/p7-lut-fold-b1` is pushed.
