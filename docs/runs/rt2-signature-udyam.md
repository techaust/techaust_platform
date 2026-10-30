# Run: rt2, the signature always on notes and advance invoices (T4) and the Udyam number on tax invoices (T10)

Status: open
Tier: A
Usage: analyst claude-opus-5-5/high (agent-a6087809…, brief draft; skills workers-best-practices, wrangler, workers-profiling)

## Brief (lead, 2026-10-31, from the analyst's draft)

**Source:** [settle-08c](settle-08c.md) tasks T4 and T10. **PRD IDs:** ADM-INV-01, ADM-INV-06, ADM-INV-07, ADM-SET-01.
**Owner, 2026-10-31:** the Udyam line prints on **tax invoices only** (ordinary, for a payment received, automatic care); export invoices, proformas and notes leave it off. All copy is approved: [07-ZC](../07-content-appendix/ZC-signature-udyam.md).
**Parallel task:** `rt1-notes-rules` (T1 credit-note cutoff by QRMP, T2 the LUT of a debit note's FY, T3 the 3B helper and IMS) runs at the same time and **merges first**. See "Overlap" below.

### Rules (tags for code comments)
- **R1** A credit note, a debit note, and a tax or export invoice for a payment received (`header_extras.advance` present) always freeze the signature reference, never freeze `signatory: false`, and can't be issued while Settings has no signature.
  - Notes: `Researched 2026-10-30, Rule 53(1A) CGST Rules (08-C RA-22)`.
  - Advance invoice: `Researched 2026-10-30, s.31(3)(d) CGST Act and Rule 50 CGST Rules (08-C RA-17)` (safest reading, docs/13 2026-10-30).
  - Residual questions go in comments as `OPEN (08-C RA-22): do Rules 50 and 53 carry Rule 46(q)'s electronic-issue proviso, and does a stored image meet "signature" on an electronic document?` (never "VERIFY"; no CA is engaged, the safest reading is what we build). A DSC is out of scope.
- **R2** Tax invoices, export invoices and proformas keep the existing signatory switch: `Researched 2026-10-28, Rule 46(q) proviso CGST Rules (08-C RA-06)`. Unchanged.
- **R3** Udyam prints as 07-ZC line 6 on `tax_invoice` documents only. Owner's choice, not a legal requirement: `Researched 2026-10-30, MSMED ss.15–16 (08-C RB-39(a))`. The number lives in Settings › Company, never in code. Format `UDYAM-XX-00-0000000` (shape only; the official format source was not checked: say so in the comment as `OPEN (08-C RB-39)`).

### Engineering decisions (lead; recorded in 13)
- **L1** The signature requirement is keyed on the document (note types, or `header_extras.advance` present), never on the checklist.
- **L2** `issuerOf` takes the document kind. Signed-always kinds ignore `invoiceChecklist.signatory`. Udyam is added only for `tax_invoice` with a saved number, as `company.udyam = {number, category}`.
- **L3** The category is stored (`micro | small | medium`, default `micro`); the printed words come from `@techaust/pdf/copy`.
- **L4** Jobs refuses a note or advance envelope with no signature (`pdf.refused`, code `signature_required`, bell), including older staging documents; PDFs already stored are adopted before the check.
- **L5** The Udyam check is shape only: the form trims and upper-cases; the schema accepts only the canonical form. No GSTIN-state cross-check.
- **L6** `udyam` and `signatory` keys are written only when present (never `undefined` or `null` keys), so every existing seal is unchanged; a golden-hash test proves it.

### Builder: data, logic, API, jobs (files)
- **Core** `packages/core/src/notes.ts`: `signature_missing` in `NOTE_BLOCKER_CODES`; required `NoteFacts.signatureSaved`; the blocker for both note kinds whatever the checklist says.
- **Core** `packages/core/src/invoices.ts`: `signature_missing` in `ISSUE_BLOCKER_CODES` (no checklist item owns it); required `IssueFacts.signatureSaved`, blocker only when `f.advance`; `SIGNED_ALWAYS_TYPES = ["credit_note","debit_note"]` and `signatureRequired(type, isAdvance)`; fix the comment near `invoices.ts:191` ("owns no blocker").
- **Core** `packages/core/src/schemas/settings.ts`: `companySettings.udyam` optional, nullable strict object `{number (regex ^UDYAM-[A-Z]{2}-\d{2}-\d{7}$), category enum}`; `SETTINGS_DEFAULTS.company.udyam = null`. zod imported only as a namespace.
- **DB** `packages/db/src/sql-rules.ts`: `signedIssuerSql(issuerExpr)` = signature sha present and no `signatory` key.
- **DB** `packages/db/src/issue.ts`: append `signedIssuerSql('?9')` and "sha equals the company row's sha" to the note tail and the advance tail. No new bind parameters.
- **DB** `packages/db/src/schema/documents.ts`: `InvoiceIssuerSnapshot.company.udyam?`.
- **DB** `packages/db/src/triggers.ts`: new set `signature_triggers` with `documents_signature_required` (BEFORE UPDATE OF status, draft → issued, signed-always types or an advance tax/export invoice, NOT signed → abort; message starts with the trigger name); pin the type list as a constant named after the migration.
- **Migration:** `drizzle-kit generate --custom --name signature_triggers` then `scripts/write-triggers.ts signature_triggers`. Trigger only; no table rebuild.
- **API** `apps/admin/worker/invoice-model.ts` (`issuerOf` with the kind; `signatureSaved` in `issueFactsOf`/`blockersOf`), `note-model.ts`, `note-issue.ts`, `invoice-advance.ts`, `invoice-issue.ts`, `care-billing.ts` (pass the kind), `settings.ts` (company PUT sets and clears `udyam`).
- **PDF logic** `packages/pdf/src/invoice-envelope.ts` (a present `udyam` must match, else null), `invoice-view.ts` (`supplier.udyam` line from `layout/copy.ts`, 07-ZC line 6), `invoice-integrity.ts` (`requiresSignature(envelope)`; `missingStatutoryLine` gains `"udyam"`: a sealed Udyam not printed as one text node is refused).
- **Jobs** `apps/jobs/src/pdf.ts` `renderInvoice`: the L4 refusal and bell.
- **SPA labels** `apps/admin/src/lib/invoices.ts`, `notes.ts`: label (07-ZC line 1) and the `/settings/company` target for `signature_missing`.

### Designer: screens and PDF layout (after the early check)
- `apps/admin/src/routes/settings/company.tsx`: Udyam field and category select through `FormField`, error state (07-ZC lines 4–5); the signature hint (`apps/admin/src/lib/pdf.ts`, line 2).
- `apps/admin/src/routes/settings/tax.tsx`: the switch's added line (line 3).
- `apps/admin/src/routes/invoices/notes-parts.tsx` and the advance dialog: the blocker with its link.
- `packages/pdf/src/layout/invoice.ts`, `layout/invoice-skeleton.ts`: the Udyam line under the GSTIN · State line as one text node; fixtures and screenshots (tax invoice with Udyam; credit note and advance invoice with the signature).
- Admin and portal on-screen invoice paper shows the line. Both themes, the widths, axe 0.

### Tests (failure paths included)
- **Core:** the blocker on both note kinds with the switch on and off, none with a signature; on an advance only, never on a plain tax/export invoice or proforma; Udyam schema accepts canonical and null and an absent key, refuses lowercase, digits in the state letters, 6 or 8 digits, no prefix; stable blocker order; coverage ≥ 90 %.
- **DB:** the trigger aborts an unsigned (or `signatory: false`) credit note, debit note and advance invoice; a tax/export invoice or proforma with `signatory: false` still issues; an old unsigned frozen note survives later ledger updates; freeze WHERE with an unsigned issuer or a different sha writes nothing (no counter, audit row, parent ledger change, `advance_receipts` row); installed triggers equal `TRIGGER_SETS`; the type constant pinned to the trigger text.
- **Admin API:** 409 `signature_missing` on note issue, issue request and view; switch off → the note still freezes the signature, no `signatory` key; advance unsigned → 409, nothing written; switch off → issued and signed; `invoices-issue.test.ts` switch test still passes; Udyam PUT valid 200, invalid 400; a tax invoice (incl. advance and care auto) seals `udyam`, export/proforma/notes don't; a later settings change leaves the issued row and its seal intact; golden seal of an existing fixture unchanged.
- **Jobs:** unsigned note/advance refused with the bell; unsigned plain tax invoice renders; Udyam absent from the HTML or malformed → refused; old envelopes render as before.
- **PDF:** the line is one text node in both layouts and absent with the key.
- **Screens:** Playwright and axe on Settings › Company.

### Early check
The builder stops once core, db (sql-rules, issue, triggers, the migration), the admin worker, envelope/view/integrity, jobs, the SPA labels and their tests are committed and pushed, after:
`bash tools/heavy.sh --log rt2-db pnpm --filter @techaust/db test`, the same for core, admin and jobs, and `bash tools/heavy.sh --log rt2-check pnpm check`.

### Done means
Every rule holds in core, the route, the freeze WHERE, the trigger and the jobs refusal; screens checked; `pnpm check` and `pnpm test` green; budgets recorded; the lead updates CLAUDE.md (house rules line), 08-C rows RA-17, RA-22, RB-39 and 13.

### Out of scope
T1–T3 (rt1); printing MSMED rights text, terms and legal pages (T6); a DSC; back-filling or re-sealing issued documents; Udyam on proposals, estimates or statements; T12 retags.

### Overlap with rt1 (merges first) and migration order
- Likely shared files: `packages/core/src/notes.ts` (blocker list, `NoteFacts`), `packages/core/src/schemas/settings.ts` (rt1: `tax` row; rt2: `company` row), `packages/db/src/issue.ts`, `sql-rules.ts`, `triggers.ts` (`TRIGGER_SETS` tail: rt1 first), migrations `0054_*` with snapshot and journal, the installed-trigger tests, `apps/admin/worker/note-model.ts`, `note-issue.ts`, `apps/admin/src/lib/{notes,invoices}.ts`.
- After rt1 merges, on the task branch: `git rm` our custom migration and its snapshot, drop our `_journal.json` entry, commit; merge `origin/main` keeping both sides; regenerate with the two commands above (renaming the pinned constant to the new number); re-run the db suite and `scripts/check-migrations.mjs`. If rt1 recreates an existing trigger, the analyst checks the merge first.

### Risks
- No table rebuild (Udyam is settings JSON; the trigger is new).
- CPU: one `json_extract` and one sub-select per freeze; a regex in jobs.
- Bundles: admin API 615,441 of the 650,000 plan line; jobs 978,987 of 1,000,000. Expect < 2 KB each. Stop and report if a ceiling or the plan line would be crossed.
- Visible change: with the switch off, notes and advance invoices still print the signature block (07-ZC line 2 explains it).
- Staging: unsigned staging notes without a stored supplier copy will ring a refused bell (expected).

### Builder's own rules
Work in your own worktree on `fix/rt2-signature-udyam-build` created from `origin/task/rt2-signature-udyam`; push only that branch. Commit at least every 20 minutes and at each finished layer. Heavy commands through `bash tools/heavy.sh`. Never touch hosted services. Stop and report when blocked. Append your report (files, commands and results, not verified, questions) under "Early check" below.

## Early check
