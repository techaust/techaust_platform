# Run: rt1, the credit-note deadline by filing frequency (T1), the LUT of a debit note's FY (T2), and IMS in the 3B helper (T3)

Status: open
Tier: A
Usage: analyst claude-opus-5-5/high (agent-ac4e091f…, brief draft; skills workers-best-practices, wrangler)

## Brief (lead, 2026-10-31, from the analyst's draft)

**Source:** [settle-08c](settle-08c.md) tasks T1, T2, T3. **PRD IDs:** ADM-INV-11, ADM-INV-18, ADM-REP-04, ADM-SET-03. Base: `main` at 1d202eee (newest migration 0053).
**Owner, 2026-10-31:** TecHaust files GSTR-1 **quarterly (QRMP)** (docs/13). All copy is approved: [07-ZD](../07-content-appendix/ZD-notes-deadline-lut-ims.md).
**Parallel task:** `rt2-signature-udyam` (T4, T10) is being built at the same time; **this task merges first** and owns migration **0054**. rt2 takes its migration out and regenerates as 0055+ after this merges.

### The most important point
`creditAllowed` (`packages/core/src/notes.ts:409`) compares the issue day with `d.date` (the cutoff), not `d.lastDay`. T1 makes `lastDay` earlier than `date`, so `creditAllowed` must switch to `lastDay`; otherwise the note view, the draft create (`invoice-notes.ts:344`, `:524`) and the blockers keep allowing November while the freeze WHERE (`issue.ts:451`, which binds `lastDay`) refuses.

### Rules (tags for code comments)
No CA is engaged (docs/13, 2026-10-30): settled items carry `Researched <date>, <source> (08-C <ID>)`; residual questions carry `OPEN (08-C <ID>): <question>`. Never "VERIFY".
- **R1 (T1) last issue day of a previous-FY credit note.** `Researched 2026-10-30, s.34(2) CGST Act; Rule 59(1)-(2) CGST Rules (IFF) (08-C RA-31, RA-03)`.
  - `returnBy` = the cutoff (`tax.creditNoteCutoff`, 30 Nov after the supply FY); if that FY's annual return was filed on day F before it, `returnBy` = F − 1.
  - `lastDay` = the latest return-period end strictly before `returnBy`. Periods are month ends when `tax.gstr1Frequency` is `monthly`, or `quarterly` with a registered recipient (IFF); quarter ends (30 Jun, 30 Sep, 31 Dec, 31 Mar) when `quarterly` and the recipient is unregistered or overseas. Defaults: registered → 31 Oct; unregistered or overseas → 30 Sep.
  - Recipient = the parent's frozen `recipientStatus` (`note-model.ts:272`).
  - `OPEN (08-C RA-31): does IFF carry only supplies to registered persons (so export and B2C notes go in the quarterly GSTR-1), and can a period's return be filed from the day after it ends?` Overseas as unregistered is the stricter side.
- **R2 (T1) warning dates.** Warn from the first day of the month before `lastDay`'s month; `adviseIssueBy` = `lastDay`; the hard block = `lastDay`.
- **R3 (T1) the frequency is a setting.** `tax.gstr1Frequency: "quarterly" | "monthly"`, through `z.prefault(…, "quarterly")`, default quarterly (owner, 2026-10-31).
- **R4 (T2) a debit note on an LUT export needs the LUT of the note's own FY.** `Researched 2026-10-30, Rule 96A(1) CGST Rules, Notification 37/2017-CT (08-C RA-19, Q39)`.
  - Applies when the parent has `export_mode = 'lut'`; the FY is the note's issue day's. No saved LUT with an ARN for that FY → refused. No IGST alternative (trigger `badParent`, `triggers.ts:776`, pins `export_mode`).
  - The note seals the LUT it relies on as `header_extras.noteOf.lut {fy, arn}`; its PDF prints that LUT instead of `noteOf.parent.lut`. Credit notes unchanged. Replaces LD49's "no LUT code" for debit notes (comment at `notes.ts:270`).
- **R5 (T3) IMS acceptance in the 3B helper.** `Researched 2026-10-28, s.34(2) proviso CGST Act w.e.f. 1 Oct 2025 (08-C RA-04)`.
  - The 3B helper deducts a credit note in **cdnr** only when `ims_status = 'accepted'`; pending, rejected or null stay in 3.1(a) and are listed as "held". Debit notes, cdnur and b2cs unchanged. GSTR-1 files unchanged.
  - A note accepted in a later period is not added to that later period (under-deducts, the safe side): `OPEN (08-C RA-04): in which 3B period does a later IMS acceptance reduce liability?`

### Engineering decisions (lead; recorded in 13)
- **D1** R3 is a setting. **D2** Overseas recipients count as unregistered for QRMP. **D3** The warning starts one month before `lastDay`'s month. **D4** With an annual return filed, `returnBy` = F − 1, then the period rule applies (stricter than today). **D5** R4 offers no IGST route and seals `noteOf.lut`. **D6** The 3B CSV gets layout `gstr3b-summary-v2` with the held row; v1 stays byte-for-byte.

### Builder: data
- `packages/db/src/triggers.ts`: `noteLutTriggerStatements()` and `TRIGGER_SETS.note_lut_triggers`, appended last. Trigger `documents_debit_note_lut_fy`: BEFORE UPDATE OF status, draft → issued, `type='debit_note'`, `export_mode IS 'lut'`, and (`issue_date IS NULL` or NOT `LUT_FOR_FY_SQL` with the FY from `fyTokenOfDateSql("NEW.issue_date")`); the abort message starts with the trigger name.
- Generate with `drizzle-kit generate --custom --name note_lut_triggers` then `scripts/write-triggers.ts note_lut_triggers` → `0054_*`, snapshot, journal. Trigger only; no table rebuild.
- `packages/db/src/issue.ts` `noteIssueTail` (:441): `AND (documents.type <> 'debit_note' OR p.export_mode IS NOT 'lut' OR <LUT_FOR_FY_SQL for fyTokenOfDateSql('?6')>)`. No new bind (?6 is the issue day).
- `packages/db/src/reports.ts` `REGISTER_COLUMNS` (:50): add `d.ims_status`.
- `packages/db/test/migrations.test.ts`: add 0054.

### Builder: logic (`packages/core`)
- `src/notes.ts`: `creditNoteDeadline(input, cutoff, annualReturnsFiled, filing: {frequency, recipientStatus})` (`filing` required); `basis` stays, add `period: "month" | "quarter"`; `creditAllowed` → `lastDay`; `creditNoteAdvice` → R2; append `debit_lut_missing` **last** to `NOTE_BLOCKER_CODES`; `NoteFacts.lut?: {needed, fy, saved}`, `noteBlockers` pushes `{code, fy}` last; `NoteOf`/`noteOfFromStored` optional `lut`; update the header comment.
- `src/schemas/settings.ts`: `gstr1Frequency` (tax schema and defaults).
- `src/gst`: `RegisterRow` and `NoteRow` carry `imsStatus`; `summary.ts` keeps the cdnr and overall checks, proves `3.1(a) + held = old 3.1(a)`, returns `imsHeld {count, numbers, taxable, igst, cgst, sgst}`; `layouts.ts` adds v2 (current), words from 07-ZD line 7.

### Builder: API and SPA logic
- `apps/admin/worker/note-model.ts` `deadlineOf` (:321) passes `filing`; `parentFacts`/`noteOfOf` seal `lut` for an LUT debit note (`lutFor`, core `export-invoice.ts:61`).
- `note-view.ts` (:80): `filing` from the parent's frozen recipient; expose `period`.
- `note-issue.ts`: feed `NoteFacts.lut` in `prepareNoteIssue` (409 `issue_blocked` with `{code:"debit_lut_missing", fy}`); in `explainNote` (:221) a branch for an LUT parent without a LUT for the issue FY → 409 with `{fy}`.
- `invoice-notes.ts`: create and update follow `creditAllowed`; a debit draft is not refused at create.
- `report-rows.ts`: map `ims_status`. `apps/admin/src/lib/reports-build.ts`: pass the held block through.
- `packages/pdf/src/invoice-view.ts:255-263`: `noteOf.lut ?? noteOf.parent.lut` through the existing `lut()` copy.

### Designer: screens (after the early check; load `frontend-design` first; start from the task branch)
- `apps/admin/src/routes/settings/tax.tsx` + `lib/tax-settings.ts`: the GSTR-1 filing field next to the credit-note cutoff (07-ZD line 1).
- `lib/notes.ts` `deadlineBanner` (:174) and `routes/invoices/notes-parts.tsx`: lines 2–5; no literal "30 November", no "Talk to your CA".
- `lib/invoices.ts` / `invoice-types.ts`: `debit_lut_missing` (line 6), target `/settings/tax#luts` like `advance_lut_missing`.
- Reports 3B panel: line 8.
- Screenshots: Tax settings, the banner (info, warning, passed), the blocker, the 3B panel; both themes, both widths; axe 0.

### Tests (failure paths included)
- **Core:** FY 2025-26 parent, default cutoff: monthly any recipient → 2026-10-31; quarterly registered → 2026-10-31; quarterly unregistered or overseas → 2026-09-30. Cutoff {1,31} → 31 Dec for every combination. Annual return filed 2026-09-15 → monthly 2026-08-31, quarterly unregistered 2026-06-30. Property: `lastDay < returnBy`, `lastDay` is a period end, quarterly-unregistered ≤ monthly. `creditAllowed` true on 2026-10-31, false on 2026-11-01. Advice 2026-09-01 / 2026-10-31 and 2026-08-01 / 2026-09-30. An old tax row parses to quarterly; "weekly" refused. `debit_lut_missing` raised for debit + LUT parent + no LUT or a blank ARN for the issue FY; absent for a credit note, an `igst_paid` parent, a saved LUT. 3B: pending, rejected, null credit notes held; accepted deducted; cdnr debit notes and cdnur unaffected; no `totals_mismatch`; v1 golden file unchanged.
- **Route:** credit draft on a registered FY 2025-26 parent: 409 `credit_deadline_passed` with date 2026-10-31 on 2026-11-01, 201 on 2026-10-31; unregistered + quarterly on 2026-10-01: 409 with 2026-09-30, monthly → 201; issue past `lastDay`: 409 `issue_blocked`; the view returns `lastDay`, `deadlineWarnFrom`, `adviseIssueBy`, `period`; LUT debit note dated FY 2027-28 without a 2728 LUT: 409 with `{debit_lut_missing, fy:"2728"}` and nothing written; with it: 200 and sealed `noteOf.lut.fy` "2728"; settings PUT monthly saved, bad value 400; the register page includes `imsStatus`.
- **Freeze WHERE (db, raw `invoiceIssueStatements`):** credit note with `lastDay` 2026-10-31 and ?6 2026-11-01 → no row changed; LUT debit note in an FY without a LUT → no row changed; with the LUT → frozen.
- **Trigger (db):** a direct issue UPDATE of an LUT debit note dated 2027-04-02 without a 2728 LUT rejects with `/documents_debit_note_lut_fy/`; passes with it, for a credit note, and for an `igst_paid` parent.
- **PDF:** a debit note prints `noteOf.lut`; an older envelope prints the parent's.
- **SPA:** banner lines without "30 November"; the held row in the 3B file.
- Existing tests that pin 30 November or `lastDay === date` (core `notes.test.ts`, `lib/notes.test.ts:48/198`, `invoice-notes.test.ts`) are updated, never deleted.

### Early check
The builder stops after the data, core, API and `reports-build.ts` layers and their tests are committed and pushed (including 0054), after `bash tools/heavy.sh --log rt1-<pkg> pnpm --filter @techaust/<pkg> test` for core, db, admin, pdf and `bash tools/heavy.sh --log rt1-check pnpm check`, and appends its report below. The analyst gives GO or CHANGE; then the designer starts.

### Done means
Every test above passes; `pnpm check` and `pnpm test` green; `scripts/check-migrations.mjs` passes and 0054 is trigger-only; the worker-budget reading recorded (admin API ≤ 650,000 planned, now 615,441; startup ≤ 200 ms); designer screenshots; the lead updates 08-C (RA-31, RA-19 Q39, RA-04), 04 (ADM-INV-11, -18, ADM-REP-04, ADM-SET-03), 07-T §4 (pointing to 07-ZD), 13 (D1–D6) and the CLAUDE.md M5.3 paragraph.

### Out of scope
An IGST route for a debit note on an LUT parent; a debit note when IMS rejects a note (RA-04 Q38); the GSTN period of a later acceptance; a per-quarter 3B helper for QRMP filers (follow-up); T4 and T10 (rt2); T12; GSTR-1 file changes.

### Overlap with rt2
Shared files: `packages/core/src/notes.ts` (blocker codes: rt1 appends `debit_lut_missing` last; keep both), `packages/core/src/schemas/settings.ts` (tax vs company object), `apps/admin/worker/note-model.ts`, `note-issue.ts`, `apps/admin/src/{api.ts,lib/notes.ts,lib/invoices.ts,lib/invoice-types.ts}`, `routes/settings/tax.tsx`, `lib/tax-settings.ts`, `packages/pdf/src/invoice-view.ts` (rt1 only :255-263), `packages/db/src/issue.ts` (rt1 only `noteIssueTail`), `triggers.ts` (`TRIGGER_SETS` tail), `_journal.json`, `test/migrations.test.ts`, core `notes.test.ts`, `invoice-notes.test.ts`. Keep hunks small and local.

### Risks
No table rebuild (0054 is triggers only; a `documents` rebuild would cascade). CPU: pure O(1) logic, no extra D1 read. Small admin API growth; the GST core stays SPA-only (`gst-spa-only.test.ts`). Owner impact: merging after 31 Oct blocks FY 2025-26 credit notes; the owner needs none (settle-08c).

### Builder's own rules
Work in your own worktree on `fix/rt1-notes-rules-build` created from `origin/task/rt1-notes-rules`; push only that branch. Commit at least every 20 minutes and at each finished layer. Heavy commands through `bash tools/heavy.sh` (another builder shares the queue). Never touch hosted services. Stop and report when blocked. Append your report (files, commands and results, not verified, questions) under "Early check".

## Early check

### Builder report (early check, 2026-10-31; branch `fix/rt1-notes-rules-build`, on top of 0323ff7f)

**Skills loaded:** `cloudflare:workers-best-practices` (no new binding or handler; every new rule stays inside the existing D1 batch and the freeze `WHERE`, no extra read on the issue path, no `any` or hand-written `Env`), `cloudflare:wrangler` (no config or binding change, so no `wrangler types` rerun; the admin build's bundle check gave the budget reading). No other skill in docs/14 §9 fits builder data/logic work.

**One deviation from the brief, for the analyst (please check first):** R4 and the brief's trigger text key the debit-note LUT rule on the parent's `export_mode = 'lut'`. That column is empty when an export invoice goes out on the **settings'** LUT route (no route typed on the draft): the existing test "a USD invoice under LUT" in `invoice-notes.test.ts` asserts `export_mode: null, supply_type: "export_lut"`, and the note copies the empty column. Keyed on `export_mode` alone, the rule would miss the most common LUT export. I keyed it on **`export_mode = 'lut'` OR `supply_type = 'export_lut'`** everywhere: `noteLutOf` (`p.computed.supply.type`), the freeze `WHERE` (`p.export_mode IS NOT 'lut' AND p.supply_type IS NOT 'export_lut'`), the trigger (the note's own `export_mode`/`supply_type`, or its parent's), and `explainNote`. Tests cover the empty-column case in db and admin. If you want the literal `export_mode` rule instead, 0054 is unapplied and regenerates in a minute.

**What was built (builder layers only; no screens):**
- **Core** (`packages/core/src/notes.ts`): `GSTR1_FREQUENCIES`, `CreditFiling`, `creditNotePeriod`; `creditNoteDeadline(input, cutoff, annualReturnsFiled, filing)` (`filing` required) returns `returnBy` (the cutoff, or the annual-return day − 1, D4) and `period` ("month" | "quarter") besides `date`/`basis`/`supplyFy`/`filedOn`/`lastDay`; `lastDay` = the latest period end strictly before `returnBy` (D2: overseas counts as unregistered). `creditAllowed` now judges `lastDay`. `creditNoteAdvice(lastDay)`: warn from the first of the month before `lastDay`'s month, advise `lastDay` (R2, D3). `debit_lut_missing` appended last to `NOTE_BLOCKER_CODES`; `NoteBlocker.fy`; `NoteFacts.lut {needed, fy, saved}`, pushed last. `NoteOf.lut?` (top level, after `request`), read back by `noteOfFromStored`. Header comment and the LD49 note updated; tags `Researched 2026-10-30, … (08-C RA-31, RA-03)`, `(08-C RA-19, Q39)`, `OPEN (08-C RA-31): …`.
- **Settings** (`schemas/settings.ts`): `tax.gstr1Frequency` = `z.prefault(z.enum(["quarterly", "monthly"]), "quarterly")`. The list is written out rather than imported from `notes.ts` (so the schema does not pull the tax engine into every bundle); a core test pins it to `GSTR1_FREQUENCIES`.
- **GST core**: `RegisterRow.imsStatus?`, `NoteRow.imsStatus`; `gstr3bSummary` deducts a cdnr credit note only when `accepted` and returns `imsHeld {count, numbers, taxableMinor, igstMinor, cgstMinor, sgstMinor}`, amounts **signed** as cdnr sums them, so `3.1(a) + held = old 3.1(a)`; the cdnr check is unchanged and the overall check is 3.1(a) + held + 3.1(b). `linesDeductingAll` gives the pre-rt1 lines. Layout `gstr3b-summary-v2` (current) = the lines + a last row (Table and Place of supply blank, description 07-ZD line 7, always present, zeros when none). **v1 is byte for byte:** it renders `linesDeductingAll`, and the v1 golden file is unchanged (not regenerated). `layout-headers.json` gains v2.
- **DB**: migration **0054_note_lut_triggers** (trigger only: `documents_debit_note_lut_fy`, message starts with its name; `drizzle-kit generate --custom --name note_lut_triggers` + `scripts/write-triggers.ts`; snapshot and journal formatted by Biome). Freeze `WHERE` (`noteIssueTail`): the LUT clause inside the parent `EXISTS`, no new bind (`?6`). `REGISTER_COLUMNS` and `RegisterSqlRow` gain `ims_status`. `migrations.test.ts` lists 0054. `care-auto-sql.test.ts.snap` updated for the new tail (intended).
- **Admin worker**: `deadlineOf` passes `{frequency, recipientStatus}` (frozen); `noteLutOf` (FY of the issue instant, `lutFor(lutsOf(tax))`); `noteOfOf(…, lut)` seals `noteOf.lut` at the issue only (a draft has none; the content hash does not cover it, so drafts made before rt1 still issue); `blockersOfNote({lut})`, judged by `prepareNoteIssue` and by the note's GET view (`invoices.ts`); `explainNote` answers a refused freeze with 409 `issue_blocked` + `[{code: "debit_lut_missing", fy}]`. `note-view.ts` uses the parent's frozen `recipient.gstStatus` (a snapshot without one is judged unregistered, the stricter side) and exposes `returnBy` and `period` beside the advice dates. Draft create and update follow `creditAllowed` (a debit draft is never refused at create). `report-rows.ts` maps `imsStatus`.
- **SPA logic** (`apps/admin/src/lib/reports-build.ts`): `GstExport.imsHeld`, `SalesRegister.imsHeld` (null when there is no 3B file).
- **PDF** (`packages/pdf/src/invoice-view.ts`): a note's route line prints `noteOf.lut ?? noteOf.parent.lut`.

**Files changed:** apps/admin/src/lib/{reports-build.ts, reports.test.ts}; apps/admin/worker/{invoices.ts, note-issue.ts, note-model.ts, note-view.ts, report-rows.ts, invoice-notes.test.ts, report-rows.test.ts, reports-totals.test.ts}; packages/core/src/{notes.ts, schemas/settings.ts, gst/index.ts, gst/layouts.ts, gst/sections.ts, gst/summary.ts, gst/types.ts}; packages/core/test/{notes.test.ts, gst/layouts.test.ts, gst/registers.test.ts, gst/report-csv.test.ts, gst/__snapshots__/layout-headers.json, gst/__snapshots__/gstr3b-summary-v2-q3.csv (new)}; packages/db/migrations/{0054_note_lut_triggers.sql, meta/0054_snapshot.json, meta/_journal.json}; packages/db/src/{issue.ts, reports.ts, triggers.ts}; packages/db/test/{note-rules-rt1.test.ts (new), note-helpers.ts, migrations.test.ts, __snapshots__/care-auto-sql.test.ts.snap}; packages/pdf/src/invoice-view.ts; packages/pdf/test/invoice-layout-m53.test.ts.

**Tests (every item of the brief's list, failure paths included):**
- Core: every FY 2025-26 combination (31 October or 30 September); cutoff {1, 31} gives 31 December for all six filings; annual return filed 15 September gives 31 August (monthly) and 30 June (quarterly, unregistered); a fast-check property (`lastDay < returnBy ≤ date`, `lastDay` a month end and a quarter end for quarters, quarterly-unregistered ≤ monthly, `creditAllowed` exactly `day ≤ lastDay`); `creditAllowed` on 31 October and 1 November; both advice pairs; an old tax row reads quarterly; "weekly" and other values refused; `debit_lut_missing` raised and absent cases; the `noteOf.lut` round trip and damaged shapes.
- 3B: pending, rejected, null, missing and not_applicable are held; accepted is deducted; cdnr debit notes, cdnur and b2cs are unaffected; a two-rate note counts once; no `totals_mismatch`; the v1 golden file is unchanged; a new v2 golden file.
- Route: a registered client's FY 2025-26 parent (draft 201 on 31 October; issue 409 `credit_deadline_passed` with 2026-10-31 on 1 November; a new draft 409 with nothing written; the view's `lastDay`, `returnBy`, `period`, advice dates and `passed`). An unregistered client on quarterly filing, 1 October: 409 with 2026-09-30; monthly: 201 and 31 October. The existing deadline tests are moved to the new dates (none deleted). An LUT debit note dated 2027-04-02 on the settings' LUT route: the view's blocker and the issue's 409 `{debit_lut_missing, fy: "2728"}`, nothing written, no audit row. The letter removed between the read and the batch without a version bump: `explainNote` 409 with the FY. With the 2728 LUT: 200, sealed `noteOf.lut {fy: "2728"}`, the parent's LUT still 2627, the seal verifies. An IGST-paid parent needs no LUT. Settings PUT: monthly 200, "weekly" 400. Register rows carry `imsStatus` equal to the stored column (reports-totals, report-rows).
- Freeze `WHERE` (raw `invoiceIssueStatements`): a credit note with `lastDay` 2026-10-31 and `?6` 2026-11-01 changes no row, and freezes on 31 October; an LUT debit note without and with the LUT (both route kinds); IGST-paid and domestic notes untouched.
- Trigger: the installed SQL equals the generated text. Rejected with `/documents_debit_note_lut_fy/`: 2027-04-02 without a 2728 LUT, a blank ARN, no issue day. Passes: with the LUT, with the legacy single `lut`, for a credit note, for IGST-paid and domestic notes. The settings' route (`export_mode` NULL) is judged.
- PDF: `noteOf.lut` is printed; an older envelope prints the parent's.
- SPA: the held row and count in `buildGstExport` and `buildSalesRegister`.

**Commands and results (all through `bash tools/heavy.sh`):**
- `pnpm --filter @techaust/core test` (log rt1-core): 91 files, 1842 tests passed, coverage gates met. The first run found two uncovered `src/gst` branches (100 % gate); fixed.
- `pnpm --filter @techaust/db test` (rt1-db): 34 files, 501 passed.
- `pnpm --filter @techaust/pdf test` (rt1-pdf): 20 files, 353 passed.
- `pnpm --filter @techaust/admin test` (rt1-admin): 116 files, 3457 passed, **1 failed**: `src/lib/notes.test.ts` "a line for every note blocker code" needs a copy line for the new `debit_lut_missing` (07-ZD line 6). The brief gives that line to the designer (`lib/invoices.ts` / `invoice-types.ts`, target `/settings/tax#luts`), so I left it. It goes green when the designer adds it. The files I changed (invoice-notes, reports-totals, reports, report-rows, note-research) pass on their own (rt1-admin-files).
- `pnpm check` (rt1-check): green (lint, typecheck, web binding guard, worker config guard, migration guard: 55 migrations, none rebuilds a referenced table).
- `pnpm --filter @techaust/admin build` (rt1-admin-build): admin front 99,271 bytes, startup 17.5 ms. **Admin API 617,171 bytes** (+1,730 on 615,441; under the 650,000 plan), startup 59.6 ms. No forbidden modules.
- `pnpm exec biome check` on every changed file before each commit. No dev server was started.

**Not verified:** the staging cold CPU reading (not mine to run). The jobs suite was not run: jobs reads `noteOf` through `noteOfFromStored` and the PDF view, both covered by the core and pdf tests. The whole-repository `pnpm test` was not run (only the four packages above). The designer's screens.

**Open questions:**
1. The `export_mode` vs `supply_type` deviation above: GO or CHANGE.
2. `imsHeld` amounts are signed (negative for credit notes), following the brief's "3.1(a) + held = old 3.1(a)". The v2 held row therefore prints figures like `-2000.00`. If positive "not deducted" figures read better for the owner or CA, that is a v2 layout choice to make before the layout is used.
3. Observation, not changed (outside the brief): a note on an export invoice issued on the settings' LUT route has an empty `export_mode`. The PDF prints a note's route/LUT line only when `header.document.exportMode` is `lut` or `igst_paid`, so such a note's PDF shows no LUT line at all (credit notes too, since M5.3). The debit note now seals its own LUT, but its PDF will not print it in that case. Worth a follow-up for the designer or a later task.
4. The cutoff year is unchanged from M5.3: the cutoff falls in the year the supply FY ends, so a January cutoff lands inside that FY (31 January 2026 for FY 2025-26, last day 31 December 2025). The brief's "31 December for every combination" holds; the year meaning is pre-existing.
