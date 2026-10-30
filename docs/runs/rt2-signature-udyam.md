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

### Builder report (early check, 2026-10-31)

Branch `fix/rt2-signature-udyam-build` (from `origin/task/rt2-signature-udyam`), pushed. Builder layers only: no screen, page, component, style or PDF layout was touched.

**Skills loaded:** `cloudflare:workers-best-practices` (the jobs refusal checked against it: structured `logEvent`, no new bindings or secrets, no buffering, nothing un-awaited); `cloudflare:wrangler` (no Wrangler config or binding change; types come from `wrangler types` inside `typecheck`; the migration went through `drizzle-kit generate --custom` + `scripts/write-triggers.ts`). Context7 was not needed: no new library API was used.

**What was built, by rule**
- **R1 / L1 (signature, keyed on the document):** core `SIGNED_ALWAYS_TYPES`, `signatureRequired(type, isAdvance)`; `signature_missing` in `ISSUE_BLOCKER_CODES` (after `supplier_state`, owned by no checklist item, raised only when `f.advance`) and in `NOTE_BLOCKER_CODES` (both kinds, whatever the switch); required `IssueFacts.signatureSaved` / `NoteFacts.signatureSaved`; the "owns no blocker" comment fixed. DB: `signedIssuerSql` (`sql-rules.ts`) and `SIGNED_FREEZE_SQL` (`issue.ts`: a signed issuer AND its SHA-256 equal to the company row's) appended to the note tail and the advance tail, no new bind. Trigger set `signature_triggers`, migration `0054_signature_triggers.sql` (trigger only, no rebuild), `documents_signature_required` (draft to issued; `SIGNED_ALWAYS_TYPES_0054`, or a tax/export invoice whose `header_extras.advance` is present; refuses a missing reference or any `signatory` key). Admin: `issuerOf(s, bank, who, currency, kind: {type, advance})`, the signed-always kinds ignore the switch; `signatureSaved` from `settings.company.signature` in `issueFactsOf` and `blockersOfNote`, so the issue, the issue request, approve-as-issue and the view all answer 409 `issue_blocked` with `{code: "signature_missing"}`.
- **R2:** unchanged for tax, export and proforma (tests prove a switched-off or unsigned plain invoice still issues and renders).
- **R3 / L2 / L3 / L5 / L6 (Udyam):** core `udyam.ts` (`UDYAM_NUMBER_RE`, `UDYAM_CATEGORIES`, `isUdyam`, `udyamPrintedOn`), `companySettings.udyam` optional nullable strict object, its error text = 07-ZC line 4, `SETTINGS_DEFAULTS.company.udyam = null`. `issuerOf` writes `company.udyam` only for `tax_invoice` with a saved number (ordinary, advance, care auto); no `udyam` or `signatory` key is ever written as `undefined`/`null`. The company PUT needed no code change (the schema validates it; a comment records the set/clear contract). PDF: `UDYAM_COPY` in `layout/copy.ts` (07-ZC lines 5-6), `supplier.udyam` on the invoice view (null without a block), envelope parse refuses a malformed block, verify answers `mismatch` for a block on any type but `tax_invoice`, `missingStatutoryLine` gains `"udyam"` (one text node).
- **L4 (jobs):** `renderInvoice` refuses after the adoption of a stored PDF and before the signature read: `pdf.refused` code `signature_required`, the existing refused bell (`BELL_COPY.invoiceRefused`, link `/invoices/:id`), no retry. `requiresSignature` / `signatureMissing` live in `packages/pdf/src/invoice-integrity.ts`.
- **SPA labels:** the `signature_missing` line (07-ZC line 1) and the `/settings/company` target in `apps/admin/src/lib/invoices.ts`; notes fall through to it.

**Files changed**
- core: `packages/core/src/{udyam.ts (new), invoices.ts, notes.ts, schemas/settings.ts}`; tests `packages/core/test/{invoice-types,invoices,notes,settings}.test.ts`
- db: `packages/db/src/{sql-rules.ts, issue.ts, triggers.ts, schema/documents.ts}`, `packages/db/migrations/0054_signature_triggers.sql`, `meta/0054_snapshot.json`, `meta/_journal.json`; tests `packages/db/test/signature-triggers.test.ts` (new), `helpers.ts` (`TEST_SIGNATURE`, `SIGNED_ISSUER`, `signedCompany`), `note-helpers.ts`, `invoice-types.test.ts` (advance freeze block), `invoices.test.ts`, `ledger-triggers.test.ts`, `note-issue.test.ts`, `tax-only-note.test.ts`, `migrations.test.ts`, `__snapshots__/care-auto-sql.test.ts.snap` (only the added `SIGNED_FREEZE_SQL` line)
- admin worker: `apps/admin/worker/{invoice-model.ts, invoice-issue.ts, invoice-advance.ts, care-billing.ts, note-issue.ts, note-model.ts, settings.ts}`; tests `signature-udyam.test.ts` (new), `care-billing.test.ts` (care auto seals Udyam), `invoices-issue.test.ts`, `test-invoices.ts` (the test company now carries a signature: `TEST_SIGNATURE`, `FROZEN_SIGNATURE`)
- SPA labels: `apps/admin/src/lib/invoices.ts`; tests `apps/admin/src/lib/{invoices,notes}.test.ts`
- pdf: `packages/pdf/src/{invoice-envelope.ts, invoice-integrity.ts, invoice-types.ts, invoice-view.ts, layout/copy.ts}`; tests `packages/pdf/test/signature-udyam.test.ts` (new), fixtures `test/fixtures/{invoice.ts, notes.ts}` (note and advance fixtures signed; an `unsigned` option)
- jobs: `apps/jobs/src/pdf.ts`; tests `apps/jobs/test/pdf-signature-udyam.test.ts` (new), `pdf-note-seed.ts` (`withoutSignatureTrigger`, `unsigned`), `pdf-invoice-seed.ts` (`advance`, `udyam`)

**Commands and results** (all through `bash tools/heavy.sh`; logs in `.logs/`)
- `pnpm --filter @techaust/db test` (rt2-db): 34 files, 501 tests passed
- `pnpm --filter @techaust/core test` (rt2-core): 91 files, 1836 passed; coverage 99.03 % statements, 98.08 % branches
- `pnpm --filter @techaust/admin test` (rt2-admin): 117 files, 3464 passed (run before the last test-only admin commit; the new admin file was re-run alone after it: 11 passed)
- `pnpm --filter @techaust/jobs test` (rt2-jobs): 32 files, 541 passed; the new jobs file re-run after its typing fix: 10 passed
- `pnpm --filter @techaust/pdf test` (rt2-pdf): 21 files, 361 passed; coverage 97.11 % statements, 91.43 % branches
- `pnpm check` (rt2-check): green (lint, typecheck of every package, web binding guard, content lint, worker config guard, SPA headers, migration guard: 55 migrations, none rebuilds a referenced table). It was also the one whole-repository lint.
- Budgets (builds): admin API **616,502** bytes (brief baseline 615,441: +1,061; plan line 650,000), startup 88.1 ms; admin front 99,271; portal 100,589 (limit 120,000); jobs **982,136** (brief baseline 978,987: **+3,149**; ceiling 1,000,000, 17,864 left), startup 66.6 ms.

**Not verified**
- The real PDF layout and the on-screen paper do not print the Udyam line yet (designer): until they do, a tax invoice sealed with a Udyam number is refused by the jobs gate (`statutory_udyam`). Tests prove the gate with a page that has or lacks the line, and `packages/pdf/test/signature-udyam.test.ts` has a case that follows the real layout once it prints the line.
- Screens, Playwright and axe (designer). The full `pnpm test` (web, portal, ui and email packages not run; the portal typecheck and build passed). Nothing on staging; no CPU reading.
- A jobs refusal of an advance envelope carrying the switch-off marker is covered by the pdf unit test only (the freeze WHERE and the trigger keep such a row from existing).

**Open questions and notes for the analyst**
1. Jobs grew 3.1 KB, more than the brief's "< 2 KB" (still under the ceiling): core's `signatureRequired`, `isUdyam`, `udyamPrintedOn` and `UDYAM_COPY` now reach the jobs bundle. The baseline was not rebuilt from `main` here, so part of the gap may predate this branch.
2. The `signature_required` bell reuses the existing approved refused line ("didn't match its saved copy … A developer needs to look at it.") with the invoice's page; 07-ZC has no line of its own for it. The signature bell ("Check the signature in Settings › Company") was not used, because a frozen document can't be fixed there.
3. Beyond the brief's wording: `verifyInvoiceEnvelope` also answers `mismatch` for a Udyam block on any type but `tax_invoice` (R3 held at the render too).
4. `signedIssuerSql` treats any `signatory` key (even `true`) as unsigned, and the trigger keys the advance on `json_type(header_extras, '$.advance') IS NOT NULL` (a present key, even JSON null): the stricter readings.
5. SQLite fires the newest BEFORE trigger first, so tests of other triggers that freeze a note by hand now set a signed issuer (`SIGNED_ISSUER`); their assertions are unchanged.
6. Migration order with rt1: as the brief says, after rt1 merges take out `0054_signature_triggers.sql`, `meta/0054_snapshot.json` and its journal entry, merge `main`, regenerate, and rename `SIGNED_ALWAYS_TYPES_0054` to the new number; `signature_triggers` sits at the tail of `TRIGGER_SETS`.
7. The admin test company now carries a signature by default (`putCompany`), so `invoices-issue.test.ts` expects the frozen reference instead of `null`; tests that need none pass `signature: null`.
