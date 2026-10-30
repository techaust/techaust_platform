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

### Analyst's early check (Opus 5.5 high, read-only, 2026-10-31): CHANGE (small), condensed by the lead
Every rule R1–R5 holds in every layer; 0054 is trigger-only and equals `noteLutTriggerStatements()`; v1 3B byte for byte; failure paths write nothing; tags in the right form. Fixes for the builder (none touches a migration or SQL twin, none overlaps the designer's files):
- **F1 (medium)** `packages/pdf/src/invoice-view.ts:255-263`: an export note issued on the settings' LUT or IGST route (`export_mode` null) prints no route/LUT line and the export place, so R4's sealed `noteOf.lut` never prints in the default case. Take the mode from `export_mode`, else `computed.supply.type` (`export_lut` → `lut`, `export_igst` → `igst_paid`). Tests: debit and credit notes with a null mode and `export_lut` print the LUT line (the debit note's own LUT, the credit note's parent's) and "Outside India (96)"; an `export_igst` note with a null mode prints no LUT line and the export place.
- **F2 (medium)** `packages/core/src/notes.ts` `creditNoteDeadline`: a cutoff in January–March falls inside the supply FY. Use `const year = cutoff.month <= 3 ? start + 2 : start + 1` (the first such day after the FY ends, s.34(2)). Test {1,31} → 2026-12-31 for every filing; add {3,31}: monthly 2027-02-28, quarterly-unregistered 2026-12-31; fix the `CreditDeadline.date` doc comment.
- **F3 (medium)** `packages/core/src/gst/layouts.ts` v2: print the held row as positive magnitudes (no `-0.00`); `Gstr3bImsHeld` stays signed internally; update the doc comments in `summary.ts` and `reports-build.ts`; regenerate the v2 golden; assert held prints positive, `3.1(a) printed − held printed = linesDeductingAll 3.1(a)`, zero row `0.00`.
- **F4 (medium, tests)** a pdf test that seals a debit-note envelope with `noteOf.lut` through the real seal function, `verifyInvoiceEnvelope` returns ok, and the render shows the line; run the jobs suite.
- **F5 (low)** `apps/admin/worker/note-model.ts` `noteLutOf`: read `p.row.supply_type` (as the freeze, trigger and `explainNote` do).
- **F6 (info)** main moved (#122, docs only): merged into the task branch by the lead.

**Lead decisions (to 13):** **D7** the debit-note LUT rule keys on the LUT route, typed or from settings (`export_mode = 'lut'` OR `supply_type = 'export_lut'`), in all four layers (builder's deviation accepted). **D8** the 3B v2 held row prints positive amounts; the value stays signed inside. **D9** F1 and F2 are fixed in this task. For the designer: line 6 prints the FY label through `fyLabelOfToken`; `lib/tax-settings.ts` must round-trip `gstr1Frequency` (else `prefault` resets "Monthly"); the SPA deadline type takes `returnBy` (line 2) and `period` (line 3 only for `"quarter"`); any held amounts shown on screen are positive.
**For 08-C RA-31 (lead, at integration):** `OPEN (08-C RA-31): the October IFF can be filed only 1–13 November; a late IFF pushes the note into the Oct–Dec GSTR-1, filed after 30 November.` Owner duty to note: file the October IFF by 13 November when an October credit note relies on it.
Usage: analyst claude-opus-5-5/high (agent-a8f2ba7b…, skills workers-best-practices, wrangler).

### Builder fixes (F1–F5)
**Builder, 2026-10-31; branch `fix/rt1-early-check` from `origin/task/rt1-notes-rules` (e73f7228); commits 2cee17e8, a9294ab3, 10e4c853, cee66adc.**

**Skills loaded:** `cloudflare:workers-best-practices` (no binding, handler or config change; F5 reads a column already in the parent's row, no extra D1 read), `cloudflare:wrangler` (no config or binding change, so no `wrangler types` rerun). No other skill in docs/14 §9 fits builder fixes with no screens.

**What changed:**
- **F1** `packages/pdf/src/invoice-view.ts`: a note's route mode is the frozen `exportMode` when typed, else the frozen `computed.supply.type` (`export_lut` → `lut`, `export_igst` → `igst_paid`, anything else none). The LUT line (`noteOf.lut ?? noteOf.parent.lut`) and "Outside India (96)" now print for a note on the settings' route.
- **F2** `packages/core/src/notes.ts` `creditNoteDeadline`: `year = cutoff.month <= 3 ? start + 2 : start + 1`; the `CreditDeadline.date` doc comment says so. {1,31} on FY 2025-26 → cutoff 2027-01-31, last day 2026-12-31 for all six filings; {3,31} → 2027-03-31, monthly 2027-02-28, quarterly unregistered or overseas 2026-12-31. The February clamp cases moved to the new year (FY 2022-23 → 2024-02-29 leap, FY 2024-25 → 2026-02-28). The property test also checks the cutoff is after the supply FY ends. November and June cutoffs (every existing route test) are unchanged.
- **F3** `packages/core/src/gst/layouts.ts`: `heldRowOf` prints the held row as magnitudes (bigint negation through `num`, so a zero is `0`, never `-0`); `Gstr3bImsHeld` stays signed. Doc comments in `summary.ts`, `layouts.ts` and `apps/admin/src/lib/reports-build.ts` say so. v2 golden regenerated: only the last row changed (`-2000.00,0.00,-180.00,-180.00` → `2000.00,0.00,180.00,180.00`); v1 golden unchanged. Tests: held prints positive with no "-", `3.1(a) printed − held printed = linesDeductingAll 3.1(a)` on the golden data, zero row `0.00`, `heldRowOf(NO_IMS_HELD)` is `+0` by `Object.is`, a one-paisa held row prints `0.01`. The admin `reports.test.ts` 3B row expectation moved to positive.
- **F4** `packages/pdf/test/fixtures/notes.ts` gains `route: "typed" | "settings"` and `noteLut` options, so `noteOf.lut` is sealed by the real `invoiceSealOf` (not patched into a built envelope). `invoice-layout-m53.test.ts`: for both route kinds the sealed debit note verifies (`verifyInvoiceEnvelope` ok), survives serialise and parse and still verifies, prints its own LUT line, and passes `missingStatutoryLine`; an ARN changed after the seal fails with `snapshot_hash`. F1 tests there too: debit (own LUT 2728) and credit (the invoice's 2627) notes with a null mode under LUT print the LUT line and "Outside India (96)"; an `export_igst` note with a null mode prints no LUT line and the export place; a domestic note has no route and no export place.
- **F5** `apps/admin/worker/note-model.ts` `noteLutOf` reads `p.row.supply_type` (doc comment updated). New pure test `apps/admin/worker/note-lut.test.ts`: with `computed` deliberately disagreeing with the columns, the settings' LUT route is judged (with and without a 2728 LUT), IGST-paid and domestic parents are not, a credit note is not.
- **Jobs suite (asked by F4):** the first run failed 2 tests in `apps/jobs/test/pdf-notes.test.ts` (`debit_usd_lut`): trigger `documents_debit_note_lut_fy` (0054) refused the seed's freeze because the jobs database has no LUT saved. That was rt1's trigger meeting an old test seed (the jobs suite was not run at the early check), not F1–F5. Fixed in the test only: `apps/jobs/test/pdf-note-seed.ts` saves a LUT for the note's issue-day FY just for the freeze and puts the tax row back as it was (or deletes it) afterwards.

**Files changed:** apps/admin/src/lib/{reports-build.ts, reports.test.ts}; apps/admin/worker/{note-model.ts, note-lut.test.ts (new)}; apps/jobs/test/pdf-note-seed.ts; packages/core/src/{notes.ts, gst/layouts.ts, gst/summary.ts}; packages/core/test/{notes.test.ts, gst/report-csv.test.ts, gst/__snapshots__/gstr3b-summary-v2-q3.csv}; packages/pdf/src/invoice-view.ts; packages/pdf/test/{fixtures/notes.ts, invoice-layout-m53.test.ts}. No migration, SQL, trigger or screen touched.

**Commands and results:**
- `pnpm exec biome check --write` on every changed file: clean (3 files reformatted).
- `bash tools/heavy.sh --log rt1fx-core pnpm --filter @techaust/core test`: 91 files, 1844 passed, coverage gates met.
- `bash tools/heavy.sh --log rt1fx-pdf pnpm --filter @techaust/pdf test`: 20 files, 360 passed.
- `bash tools/heavy.sh --log rt1fx-jobs pnpm --filter @techaust/jobs test`: first run 2 failed (above); after the seed fix 31 files, 531 passed. The log still carries one `[mf:error] ZodError` line from miniflare; every test passes and I did not trace which test logs it.
- `bash tools/heavy.sh --log rt1fx-admin pnpm --filter @techaust/admin test`: 117 files, 3461 passed, **1 failed**: `src/lib/notes.test.ts` "a line for every note blocker code" (the `debit_lut_missing` copy line), left for the designer as briefed.
- `bash tools/heavy.sh --log rt1fx-check pnpm check`: green (lint, typecheck, guards, migration guard 55 migrations).

**Not verified:** the db suite was not rerun (no db file changed). The admin build and worker-budget reading were not rerun (one line changed in `note-model.ts`; the early-check reading was 617,171 bytes). The whole-repository `pnpm test`. Screens (the designer's).

**Open questions:** none.
Usage: builder claude-opus-5-5/high (skills workers-best-practices, wrangler).

### Designer report
**Designer, 2026-10-31; branch `design/rt1-screens` from `origin/task/rt1-notes-rules` (e0192d78); commits e9f3dcbb (screens), a3d1bac3 (e2e spec), f37f802c (visual-pass fixes), 904c6c1f (spec: sales register), then this report.** No worker, db, migration or jobs file changed; one core line (an export). Nothing hosted touched. The dev server Playwright started is stopped (no port listening); no MCP browser was opened.

**Skills loaded:**
- `frontend-design:frontend-design`, **loaded first, before any other work.** What it changed: one quiet idea, inside docs/06 and the M5.3/M5.5 screens, no new colours or components. The 3B held amount is drawn as part of 3.1(a), not as a new table: an indented row under 3.1(a) in the muted ink, with a 3 px warning rule on its name, and the same warning rule on the line-8 sentence under the table, so the row and its sentence read as one thing; the held notes' numbers follow in the number face so the Owner knows which to follow up in IMS. The deadline banner keeps M5.3's dated, toned line (the first line carries the weight, the rest quieter) with `text-wrap: pretty` so no line ends on "IFF.". The GSTR-1 field is the page's own select row, placed straight after the cut-off it works with.
- `dataviz`: not loaded. No chart, stat tile or dashboard: the 3B change is one ledger row and one sentence.
- No other docs/14 §9 skill fits (no Worker, route, binding, PDF or email work).

**What was built (07-ZD word for word; every line in `apps/admin/src/lib/copy-zd.ts`):**
- **Line 1, Settings › Tax:** "GSTR-1 filing" select ("Quarterly (QRMP scheme)", "Monthly", core's `GSTR1_FREQUENCIES` order) with the hint, right after "Credit note cut-off". `lib/tax-settings.ts` reads `gstr1Frequency` (a row stored before rt1 reads "quarterly", as the server reads it) and always saves the field's value back (lead D9).
- **Lines 2 to 5, the banner** (`lib/notes.ts` `deadlineBanner`, `routes/invoices/notes-parts.tsx`): line 2 with `lastDay` and `returnBy` (an older API without `returnBy` falls back to `date`); line 3 only when `period` is "quarter" and never after the deadline; from `deadlineWarnFrom` the tone is warning and line 4 leads while at least one day is left (on the last day itself the tone stays warning and line 2 names the day); line 5 in danger once passed. No "30 November", no "Talk to your CA" (a test scans every line). `CreditDeadlineView` gains optional `returnBy` and `period`. 07-T's "The deadline counts from FY …" line is kept.
- **Line 6, `debit_lut_missing`** (`lib/notes.ts` `noteBlockerLine`): the FY label through core `fyLabelOfToken`; "…" when the server sends no FY or a damaged token. `lib/invoices.ts` `blockerTarget` sends it to `/settings/tax#luts`. A new `NoteBlockerList` (notes-parts.tsx) is used by the note draft page and the note dialog: a blocker fixed on a settings page now carries the page's name as its link (the invoice editor's pattern, the whole row a 44 px target). The red test "a line for every note blocker code" is green.
- **Lines 7 and 8, Reports:** GST exports' 3B table gets the held row (line 7's words, positive amounts from core `heldRowOf`, lead D8), only when something is held; `ImsHeldNotice` (routes/reports/parts.tsx) under the table with line 8 and the held numbers. The sales register shows the same notice when its 3B file is on offer. `packages/core/src/gst/index.ts` now exports `heldRowOf` (one line, no logic).
- **Visual-pass fixes on these screens (pre-existing defects met in the shots):** (1) `ReportBlock` was a `<section>` region named like the wide list inside it: three duplicate landmarks on the GST results (axe `landmark-unique`; the sweep only sees the idle page, so it never met them); it is now a plain block under its heading. (2) On a phone the notes ledger's draft row put its dashed slot over the sentence's second line; the draft row keeps its two columns. (3) The 3B row names get `min-width: 11rem` on a phone (the box already scrolls), so a name is not one word a line.
- **Singular forms (flag for the lead):** line 4 with 1 day reads "Only 1 day left to issue a credit note on this invoice."; line 8 with 1 note reads "1 credit note isn't deducted until your client accepts it in IMS. Check the GST portal's GSTR-3B figures before you file." This is the admin's existing practice (07-T's day line, the balance line), but the singular of line 8 changes "aren't … them" to "isn't … it", which 07-ZD does not print. If the owner wants only the plural, it is one line in `copy-zd.ts`.

**Files changed:** apps/admin/src/lib/{copy-zd.ts (new), notes.ts, notes-api.ts, invoices.ts, tax-settings.ts, notes.test.ts, reports.test.ts}; apps/admin/src/routes/invoices/{notes-parts.tsx, note-draft.tsx, note-dialog.tsx}; apps/admin/src/routes/settings/tax.tsx; apps/admin/src/routes/reports/{gst.tsx, parts.tsx, sales-register.tsx}; apps/admin/src/{notes.css, reports.css}; apps/admin/e2e/rt1-screens.spec.ts (new); packages/core/src/gst/index.ts (the `heldRowOf` export).

**Tests:**
- Unit (admin `src/lib`): the banner (lines 2 to 5, the quarter line only for "quarter" and never after, the warning from the server's day, the last day itself, one day in the singular, an older API without `returnBy`/`period`/`deadlineWarnFrom`, the annual-return date, no "30 November" or "CA"); `debit_lut_missing` (FY label twice, "…" for a missing or damaged token, the target `/settings/tax#luts`, the place found in the sentence); Settings › Tax round trip (monthly kept through another field's save, switched both ways, an old row reads quarterly, the words and options); the 3B held row's name equals the CSV's, core's figures are positive, line 8 in both forms.
- E2E `apps/admin/e2e/rt1-screens.spec.ts` (5 tests; axe on every state at 1280 and 390 in both in-app themes against the opposite OS theme; no console errors): Settings › Tax saves Monthly and reads it back, then Quarterly again (real API); the banner from the real server (FY 2026-27 invoice to the sample's unregistered client: 30 Sep 2027, quarter line), then month, warning and passed states with only `creditDeadline` changed in the browser (SIMULATED: the clock can't reach 2027); `debit_lut_missing` through the **real server** (the LUT list emptied, a debit draft made on the sample export invoice, its page names FY 2026-27 and links to the LUT list; Tab reaches the link, Enter lands on `#luts` in view; the LUT and the draft are put back and the test checks the LUT list equals the original); GST exports and Sales register with fake register rows answered in the browser and the step-up taken as fresh (SIMULATED): the held row ₹2,000.00 / ₹0.00 / ₹180.00 / ₹180.00, positive, line 8, the two numbers.

**Commands and results (heavy ones through `bash tools/heavy.sh`):**
- `pnpm install --frozen-lockfile --offline`; `pnpm dev:secrets`, `pnpm db:migrate:local` (0054 applied), `pnpm db:seed:local`, `pnpm portal:sample` (local only).
- `pnpm exec biome check --write` on every changed file before each commit: clean.
- `--log rt1d-admin-files` vitest on `src/lib/notes.test.ts` and `src/lib/reports.test.ts`: 73 passed.
- `--log rt1d-e2e5` `E2E_SAMPLE=1 TECHAUST_PORT_OFFSET=0 RT1_SHOTS=… playwright test e2e/rt1-screens.spec.ts`: **5 passed** (runs e2e to e2e4 found the duplicate landmarks, a selector of mine and the date field's label; fixed).
- `--log rt1d-admin-test` `pnpm --filter @techaust/admin test`: **117 files, 3,467 passed, 0 failed** (the builder's 1 failure is green).
- `--log rt1d-admin-typecheck` `pnpm --filter @techaust/admin typecheck`: exit 0.
- `--log rt1d-admin-build` `pnpm --filter @techaust/admin build`: **admin front 99,271 bytes, startup 9.7 ms; admin API 617,181 bytes** (builder's 617,171 + 10; under the 650,000 plan), startup 59.2 ms; no forbidden modules.
- `--log rt1d-lint` `pnpm lint` (whole repository, once, last): exit 0; 10 warnings and 8 infos, all in files this task didn't touch.

**Screenshots** (`.logs/rt1-design/` in my worktree, 34 PNGs; each at 1280 and 390, light and dark, unless noted):
- `tax-gstr1-filing-*`: the Documents and alerts rows, the GSTR-1 field after the cut-off. `keyboard-tax-gstr1-focus-1280-light`: its focus ring after Tab from the cut-off month.
- `deadline-before-*` (real server): lines 2 and 3, 30 Sep 2027, info. `deadline-before-month-SIMULATED-*`: line 2 alone, 31 Oct 2027. `deadline-warning-SIMULATED-*`: line 4 leading, then 2 and 3, warning. `deadline-passed-SIMULATED-*`: line 5, danger, the credit action gone.
- `blocker-debit-lut-missing-*` (real server): line 6 with "Settings › Tax" as the link. `keyboard-blocker-link-focus-1280-light`: the whole-row focus ring.
- `gst-3b-held-SIMULATED-*`: the 3B table with the held row under 3.1(a) and the line-8 notice with the numbers. `sales-3b-held-SIMULATED-*`: the same notice between the output tax and the downloads.

**Placeholder text:** none. Every word is 07-ZD's (or 07-T's kept line); the singulars above are the only inflections.

**Not verified:** the note dialog's confirm step with `debit_lut_missing` (the same `NoteBlockerList` as the draft page, not opened in the browser); a real 409 `issue_blocked` with `{debit_lut_missing, fy}` at issue (the builder's route tests); the warning, passed and month banners and both 3B screens against a real server (SIMULATED as named); 768 and 1920 widths (the brief asked 1280 and 390; the sweep covers 768 and 1024); a screen reader; the whole-repository `pnpm test` and `pnpm check` (admin suite, admin typecheck and build, and the whole lint only).

**Questions for the lead:**
1. The singular of line 8 ("1 credit note isn't deducted until your client accepts it in IMS.") is not printed in 07-ZD: keep it, or only the plural?
2. "Credit note cut-off"'s existing hint ("After this date following the financial year of the supply, credit notes for it are blocked.") is no longer exact: the block now falls at the end of the last return period before that date (31 October or 30 September by default). It is 07 copy I didn't touch; an owner line for 07 if wanted.
3. The note draft page keeps "Issue debit note" enabled while a blocker shows (M5.3 behaviour: the dialog shows the blockers again and the server refuses). Unchanged; say if it should be disabled.

Usage: designer claude-opus-5-5/high (skills frontend-design).
