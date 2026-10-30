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
