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

### Analyst's early check (Opus 5.5 high, read-only, 2026-10-31): GO, condensed by the lead
R1–R3 hold in every layer (core, route, freeze WHERE with no new bind, trigger, jobs); R2 unchanged; Udyam only on `tax_invoice`, no `undefined`/`null` keys, seals key-for-key as M5.1; 0054 trigger-only; zod namespace imports. Findings:
- **F1 (medium, designer)** `packages/pdf/test/signature-udyam.test.ts:148-153` and `apps/jobs/test/pdf-signature-udyam.test.ts:165` pass whether or not the real layout prints the Udyam line. Make them hard: `expect(html).toContain(`>${LINE}<`)` and `missingStatutoryLine(sealed, html)` null, once per layout; jobs line 165 uses the default `htmlOf` and expects `"rendered"`.
- **F2 (medium, builder)** `apps/jobs/src/pdf.ts:346-355` rings "didn't match its saved copy" for an unsigned document, which isn't true. Add `BELL_COPY.invoiceUnsigned(label)` = 07-ZC line 7, kind stays `pdf.refused`, target `/invoices/${row.id}`.
- **F3 (low, builder)** the OPEN tags at `packages/core/src/udyam.ts:8-9` and `packages/core/src/schemas/settings.ts:100-101` become questions: `OPEN (08-C RB-39): is UDYAM-XX-00-0000000 the official format? The Udyam portal and the MSME notification were not read; this is the shape of the owner's own number and of 07-ZC line 4.`
- **F4 (low, builder)** `apps/admin/worker/settings.ts:~492-497`: a company PUT without the `udyam` key clears it (a cached SPA tab would wipe the number). Keep the stored value when the key is absent, clear only on explicit `null`; tests for both.
- **F5 (low, optional, builder)** pin the golden seal's hex digest as a literal in `apps/admin/worker/signature-udyam.test.ts:346-352`.

**Lead decisions (to 13):** **L7** jobs' `signature_required` refusal uses its own bell line (07-ZC line 7). **L8** a company PUT keeps a stored Udyam number unless `udyam: null` is sent; the form always sends the key. **L9 (before M6.2)** jobs has 17,864 bytes left (982,136 of 1,000,000): decide between `minify: true` on jobs (measured), a separate payment-webhook Worker, or a measured ceiling raise, before M6's webhooks land. Admin API 616,502 of the 650,000 plan line.
**Merge after rt1** (analyst's plan, kept for the integration): take out `0054_signature_triggers.sql`, its snapshot and journal entry, commit; merge `origin/main` (conflicts: `core/src/notes.ts` `NoteFacts` and docblock, `note-model.ts` `blockersOfNote`, `db/src/issue.ts` import, `triggers.ts` (rt1's set first), `migrations.test.ts`); regenerate as 0055 and rename `SIGNED_ALWAYS_TYPES_0054` → `_0055` with every "0054" comment; sign `rawFreeze` in rt1's `packages/db/test/note-rules-rt1.test.ts` (`issuer = SIGNED_ISSUER`) and any rt1 debit-note seed in pdf/jobs tests; re-check the care-auto SQL snapshot by running it (never `-u`); delete any local D1 that applied the old 0054; run db, core, admin, jobs, pdf and `pnpm check`. Only raw-UPDATE tests see trigger messages (the API refuses in the freeze WHERE first).
Usage: analyst claude-opus-5-5/high (agent-a27f3d2f…, skills workers-best-practices, wrangler, workers-profiling).

### Designer (screens and PDF layout)
Start from `origin/task/rt2-signature-udyam` on `design/rt2-screens`. Load `frontend-design` first. Scope: the "Designer" list in the brief, plus F1 above, plus: the company form always sends `udyam` (the block or `null`, L8); the Udyam line printed on the admin and portal on-screen invoice paper from `supplier.udyam`; screenshots of Settings › Company (empty, filled, error), Settings › Tax switch hint, the `signature_missing` blocker on a note and on the advance dialog, a tax invoice PDF with the Udyam line, a credit note and an advance invoice PDF with the signature; both themes, 1280 and 390 wide; axe 0. Don't touch F2–F5 files (`apps/jobs/src/pdf.ts`, `apps/admin/worker/settings.ts`, `packages/core/src/udyam.ts`, `packages/core/src/schemas/settings.ts`).

### Designer report

Designer, Opus 5.5 high, 2026-10-31. Branch `design/rt2-screens`, created from `origin/task/rt2-signature-udyam` (03f7cfa7) and pushed. None of the builder's F2–F5 files were touched.

**Skills:** `frontend-design:frontend-design`, loaded first. It set the direction: everything stays inside the existing system, with no new decoration. The Udyam pair sits with the GST registration as one more registration row. The 07-ZC line 3 note is a muted hint under the "House rule" badge. The Udyam line on the PDF uses the supplier block's own style. The one deliberate choice is where that line breaks (see the PDF item below). `dataviz` was not loaded because the task has no chart or stat tile. Context7 was not needed because no new library API was used.

**What was built**
- **PDF (both layouts).** `supplierLinesHtml` in `packages/pdf/src/layout/invoice.ts` is also used by the skeleton. It prints 07-ZC line 6 as one `<p class="party__line inv-udyam" data-testid="udyam">` holding a single text node, right under the "GSTIN … · State …" line.
  - The view now has `supplier.registrationAt` (`invoice-view.ts`, `invoice-types.ts`): the index of that line in `lines`. With no registration line, the Udyam line goes last.
  - Chromium breaks a line after any hyphen of `UDYAM-WB-00-0000001`, and no CSS stops it. I measured the widths in Archivo: the number is at most 11.4em, and "Udyam Registration No. UDYAM-" is 14.7em. `.doc--invoice .inv-udyam { max-width: 12em }` therefore makes the line always break at its spaces: "Udyam Registration No." / the number / "(Micro enterprise)". The explanation is a TS comment outside the CSS string, so the PDF page carries no extra bytes or words.
- **F1 (hard tests).**
  - `packages/pdf/test/signature-udyam.test.ts`: the designed layout (intra and advance tax invoices) prints the line once, as one text node, inside "From", after the GSTIN line and before the email. `missingStatutoryLine` is null. The skeleton (forced unknown type) does the same. Without the key, neither layout prints any Udyam text. A view with no registration line puts the line last.
  - `apps/jobs/test/pdf-signature-udyam.test.ts`: the passing case uses the default real layout (no `htmlOf`) and expects `"rendered"`, the line exactly once and no bell. The refusals swap the real line out (missing or split) and first assert that the real page had it.
- **Fixtures.**
  - New layout fixture `udyam` (signed tax invoice, made-up `UDYAM-WB-00-0000001`, `LAYOUT_UDYAM`).
  - `advance` and `advance-export` now carry the signature (T4).
  - `visual/notes.spec.ts` passes the signature image, so the visual suite shows notes as they now print.
- **Settings › Company** (`routes/settings/company.tsx`, new `lib/udyam.ts`):
  - "Udyam registration number" (optional) and "Enterprise category" go through `FormField`, as a second row of the GST registration fieldset, with field ids `f-udyam-number` and `f-udyam-category` so API refusals land on the field.
  - The number is upper-cased as it is typed and trimmed when the field is left. It is checked on leaving the field and on save, using core's `UDYAM_NUMBER_RE`, with the 07-ZC line 4 error.
  - The options use `@techaust/pdf/copy`'s `UDYAM_COPY.categories` (L3).
  - The form always sends `udyam`, as the block or `null` (L8). The e2e test proves the request body both ways.
- **Signature hint:** `SIGNATURE_COPY.hint` is now 07-ZC line 2.
- **Settings › Tax:** the signatory switch shows 07-ZC line 3 (`INVT_COPY.signatoryScope`, `.checklist__scope`). The line is part of the switch's accessible description ("House rule This switch covers …").
- **Note blockers:** new `NoteBlockerList` in `notes-parts.tsx`, used by `note-dialog.tsx` and `note-draft.tsx`. A note blocker whose fix is on another page now links that place, the same way the invoice `BlockerList` does: `signature_missing` links "Settings › Company". The advance dialog already used `BlockerList`, so it needed no change; the e2e test proves the refusal and its link.
- **e2e infra (needed by the T4 rule):**
  - `e2e/sample-data.ts` now uploads a drawn sample signature PNG before it issues its credit note. Without it, `E2E_SAMPLE=1` would fail on the 409.
  - `Call` accepts a raw body.
  - `global-setup.ts` writes the throwaway Owner's code secret to the git-ignored `apps/admin/.e2e/owner-totp.hex`, so a spec can step up.
- **New spec `apps/admin/e2e/signature-udyam.spec.ts`:** Company (empty, refused, saved, cleared), keyboard order and visible focus, the Tax switch line, the note blocker and the advance refusal with no signature saved (the signature is put back afterwards), and no console errors. axe runs on every state, in both in-app themes against the opposite OS theme, at 1280 and 390.

**Files changed**
- `packages/pdf/src/{invoice-types.ts, invoice-view.ts, layout/invoice.ts, layout/invoice-skeleton.ts}`
- `packages/pdf/test/{signature-udyam.test.ts, fixtures/invoice-layout.ts}`
- `packages/pdf/visual/notes.spec.ts`
- `apps/jobs/test/pdf-signature-udyam.test.ts`
- `apps/admin/src/routes/settings/{company.tsx, tax.tsx}`
- `apps/admin/src/routes/invoices/{notes-parts.tsx, note-dialog.tsx, note-draft.tsx}`
- `apps/admin/src/lib/{udyam.ts (new), udyam.test.ts (new), pdf.ts, pdf.test.ts, invoice-types.ts, invoice-types.test.ts}`
- `apps/admin/src/shell.css`
- `apps/admin/e2e/{signature-udyam.spec.ts (new), sample-data.ts, global-setup.ts}`

**Commands and results** (heavy ones through `bash tools/heavy.sh`)
- `pnpm --filter @techaust/pdf test` (rt2d-pdf): 21 files, 366 passed. Coverage 97.12 % statements, 91.47 % branches.
- `pnpm --filter @techaust/jobs test` (rt2d-jobs): 32 files, 541 passed.
- `pnpm --filter @techaust/admin test` (rt2d-admin): 118 files, 3471 passed.
- `pnpm --filter @techaust/admin typecheck` passed; `pnpm --filter @techaust/pdf --filter @techaust/jobs typecheck` passed.
- `pnpm --filter @techaust/admin e2e e2e/signature-udyam.spec.ts` with `E2E_SAMPLE=1`, `TECHAUST_PORT_OFFSET=0` and `RT2_SHOTS` (rt2d-e2e): 5 passed. axe found 0 moderate, serious or critical violations on every state.
- Budgets:
  - jobs 982,690 bytes (+554 over the builder's 982,136; 17,310 left), startup 51.5 ms
  - admin front 99,271 and admin API 616,502 (both unchanged)
- `pnpm lint` (once, rt2d-lint): green. 10 warnings, all already in `packages/pdf/test/{envelope,render,variants}.test.ts`.
- Local setup in the worktree: `pnpm dev:secrets`, `pnpm db:migrate:local` (0054 applied), `pnpm db:seed:local`, `pnpm portal:sample`. The Playwright webServer stopped the admin dev server at the end (health check: no answer).

**Screenshots** (`.logs/rt2-design/`, in this worktree, git-ignored)
- `company-empty-{1280,390}-{light,dark}.png`: Settings › Company with no number. Shows the Udyam row, the hint, "Micro enterprise", and the new signature hint (line 2).
- `company-error-{1280,390}-{light,dark}.png`: "UDYAM-WB-00-000001" after leaving the field. Red border and the line 4 error.
- `company-filled-{1280,390}-{light,dark}.png`: saved as `UDYAM-WB-00-0000001` with "Small enterprise". The full-page captures at 1280 show the sticky top bar halfway down. That is how a full-page capture draws it, not a page defect.
- `tax-signatory-{1280,390}-{light,dark}.png`: the "Authorised signatory" switch with the House rule badge and line 3.
- `note-blocker-{1280,390}-{light,dark}.png`: a draft debit note with no signature saved. Line 1 with the "Settings › Company" link (focused in the capture).
- `advance-blocker-{1280,390}-{light,dark}.png`: the advance dialog of an issued sample proforma, refused with line 1 and its link.
- `pdf-udyam.png/.pdf`: a tax invoice with the Udyam line in three lines under "State West Bengal (19)", plus the signature.
- `pdf-advance.png/.pdf` and `pdf-advance-export.png/.pdf`: invoices for a payment received, signed.
- `pdf-note-credit_lines.png/.pdf` and `pdf-note-debit.png/.pdf`: credit and debit notes, signed.
- The PNGs are print-media HTML screenshots at 794 px; the PDFs come from the local Playwright Chromium, not Browser Run.

**Placeholder text:** none. Every new line is 07-ZC word for word.

**Not verified, and open questions**
1. **No on-screen invoice paper exists for the Udyam line, in admin or portal.** The portal invoice page (`apps/portal/src/screens/invoices.tsx`) shows a slip of dates, figures, lines and the tax summary, with no supplier block. Its API (`apps/portal/worker/invoice-summary.ts`) returns no issuer company. The admin invoice page has no supplier block either. The only "paper" is the proposal/estimate `document-paper.tsx`, which never prints Udyam. So 07-ZC line 6 appears on the PDF only. Adding a supplier block to either page would need a builder change (the portal summary API) and new approved copy for the block (for example a "From" heading). That is for the lead and the owner to decide, so I did not build it.
2. **The Udyam fields have no section heading of their own.** No legend was approved, so they sit in the "GST registration" fieldset as a second row. If the owner wants them in their own section, a legend line (for example "Udyam registration") needs approval first.
3. **Visual suite:** the Linux baselines for the new `invoice-udyam` fixture, and for the advance and note fixtures that now show the signature, need regenerating where the suite's baselines are made. The visual suite was not run here (it isn't in CI). The new fixture was printed and looked at instead.
4. **Not checked:** Browser Run itself (the line-break rule depends on the same embedded Archivo, so it should match), staging, and NVDA.

Usage: designer claude-opus-5-5/high (this worktree agent; skills frontend-design).

### Builder fixes (F2–F5)
Branch `fix/rt2-early-check` from `origin/task/rt2-signature-udyam` (fix commit 338ab20e). Skills: `cloudflare:workers-best-practices` (checked the jobs refusal: the bell still goes in one awaited `DB.batch`, no fire-and-forget; no other change), `cloudflare:wrangler` (no config or binding change, so no `wrangler types` rerun; tests ran through the project's pinned Wrangler/Vitest).
- **F2 (L7)** `apps/jobs/src/pdf.ts`: new `BELL_COPY.invoiceUnsigned(label)` = 07-ZC line 7 word for word; the `signature_required` refusal rings it with kind `pdf.refused`, entity `document`, link `/invoices/${row.id}` (the other refusals keep `invoiceRefused`). New test `apps/jobs/test/pdf-unsigned-bell.test.ts` (4 tests): the line word for word, and for an unsigned credit note, debit note and invoice for a payment received, every bell is `{kind: pdf.refused, entity_type: document, title: invoiceUnsigned(number), link: /invoices/:id}` and never the "saved copy" line; no Browser Run call. (The designer's `apps/jobs/test/pdf-signature-udyam.test.ts` was not touched.)
- **F3** `packages/core/src/udyam.ts`, `packages/core/src/schemas/settings.ts`: both tags now read "OPEN (08-C RB-39): is UDYAM-XX-00-0000000 the official format? The Udyam portal and the MSME notification were not read; this is the shape of the owner's own number and of 07-ZC line 4." The schema's `udyam` field comment now states L8.
- **F4 (L8)** `apps/admin/worker/settings.ts`: a company PUT whose value has no `udyam` key (`Object.hasOwn`) keeps the stored number; an explicit `null` clears it; the signature is kept as before. Test in `apps/admin/worker/signature-udyam.test.ts` ("L8: …"): set a number, PUT the other fields without the key plus a changed `principalPlace` (saved, version moves, number kept, signature kept), then explicit `null` clears it, and a later PUT without the key keeps it cleared. The existing "sets and clears" test still passes.
- **F5** same test file: `GOLDEN_M51_SEAL = "0f904eacf4c1197dd50b7eb627379da51bbc66ceeb4c930adccd4bfaa8a88d3c"`, asserted against `invoiceSealOf(parts(M51))` before the loop. `packages/db/src/documents.ts` has no diff against `origin/main`, so this is the M5.1 seal function's digest of that block.

Commands (all through `bash tools/heavy.sh`): `rt2fx-admin-file` (the one admin file, used to read the digest: 11 passed, 1 expected probe failure, then fixed), `rt2fx-jobs-file` 4/4 passed; `rt2fx-core` 91 files / 1,836 tests passed (coverage 99.03 % statements); `rt2fx-admin` 117 files / 3,465 tests passed; `rt2fx-jobs` 33 files / 545 tests passed; `rt2fx-check` (`pnpm check`: lint, typecheck, guards, migration guard 55) exit 0. Biome on the six changed files: clean after `--write` (formatting of the new test only).
Not verified: the designer's parallel changes (F1, the form always sending `udyam`) are not on this branch, so the combined result is unrun; the pdf and db packages were not rerun (no file of theirs changed). No hosted service touched. No open questions.
Usage: builder claude-opus-5-5/high (skills workers-best-practices, wrangler).

### Lead after the designer (2026-10-31)
- **L10** The Udyam line prints on the tax invoice PDF only: neither the admin nor the portal invoice page has a supplier block, and the owner's choice was about the invoice. No on-screen supplier block in this task (it would need API and copy work); not a follow-up unless the owner asks.
- **L11** The Udyam fields stay as a second row of the "GST registration" fieldset (no new legend).
- Follow-up: fresh visual baselines for the `invoice-udyam`, advance and note fixtures when the visual suite's baselines are next made (with the open "Linux PDF visual baselines" item).
- Merged `design/rt2-screens` (ce0a7eaa) into the task branch cleanly; screenshots copied to `.logs/rt2-design/`. Usage: designer claude-opus-5-5/high (frontend-design); builder (F2–F5) claude-opus-5-5/high (workers-best-practices, wrangler).

## Review
### Code review (reviewer, Opus 5.5 high, 2026-10-31, no browser): APPROVE, condensed by the lead
Skills: code-review (9 candidates, 6 kept after verification), security-review (by hand over the task diff; no exploitable issue). Checks at 7b24fff8 in its own worktree: `pnpm check` exit 0 (55 migrations, none rebuilds); core 99.03 %/98.11 %; db 501; pdf 366; jobs 545; admin 3,472. **Budgets at the head:** jobs 983,300 bytes (16,700 left; startup 63.5 ms), admin API 616,569 (startup 54.7 ms), admin front 99,271. R1–R3, L8 and 07-ZC lines 1–7 verified; tags correct, no "VERIFY", no `import { z }`.
1. **low** `apps/jobs/src/pdf.ts:350`: the supplier copy of an older unsigned staging note or advance is refused for good and rings line 7 each ask. Fix: skip the signature refusal for `copy === "supplier"` when the recipient PDF is stored (`row.pdf_sha256` set).
2. **low** `packages/db/src/triggers.ts:955`: the trigger treats a JSON-null `$.advance` as an advance; core uses truthiness. Fix at regeneration: `json_type(NEW.header_extras,'$.advance') = 'object'`, plus a db test pinning the clause.
3. **low** `apps/admin/worker/settings-signature.ts:6`: stale header comment; add the T4 sentence.
4. **low** `apps/admin/src/routes/invoices/notes-parts.tsx:63`: links inside the note dialog drop typed input (same as the advance dialog's `BlockerList`); `NoteBlockerList` duplicates `BlockerList`'s link branch.
5. **low** `apps/admin/src/lib/udyam.ts:13` and core `udyamSettings`: the line 4 error typed twice; export it once from core.
6. **low** `packages/pdf/src/layout/invoice-skeleton.ts:232`: move `.inv-udyam { max-width: 12em }` into `TAX_INVOICE_CSS` with its comment.
Merge-plan additions: also conflicting `packages/core/test/notes.test.ts` (`okFacts` keeps `signatureSaved: true`), `packages/core/src/schemas/settings.ts`, `apps/admin/worker/note-issue.ts`, `packages/db/test/note-helpers.ts`, `apps/jobs/test/pdf-note-seed.ts`, `packages/pdf/test/fixtures/notes.ts`, `apps/admin/src/lib/notes.test.ts`, the care-auto snapshot; after the merge type-check rt1's tests that build `NoteFacts` or freeze notes (`invoice-notes.test.ts` relies on `putCompany` carrying a signature) and run `e2e/rt1-screens.spec.ts` and `signature-udyam.spec.ts` one after the other; rename "0054" in `signature-triggers.test.ts`, `triggers.ts`, `sql-rules.ts`, `issue.ts`, `schema/documents.ts`.
Not verified: the live visual pass (next, when the browser is free), Browser Run, staging, NVDA.

**Lead triage:** fix 1, 2, 3, 5, 6 in this task, together with the merge after rt1 (one builder run with an integration brief). **Kept, 4:** the dialog links follow the existing advance-dialog pattern; one shared blocker list that confirms before leaving unsaved input becomes a listed follow-up (admin UI), not this task.
