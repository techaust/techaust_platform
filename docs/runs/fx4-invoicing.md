Status: open
Tier: A
Usage:

# FX-4: invoicing fixes from the full audit

This is part of the owner's full audit of M1–M5 ([full-audit-m1-m5.md](full-audit-m1-m5.md), "Fix plan", section A5).
- **Model:** Opus 5.5 at high effort for every agent (owner's audit instruction).
- **Base:** `origin/fix/fx3-admin-portal`, which holds FX-1 and the FX-3 builder.
- **Merge order:** M5 owner fixes (#106), FX-1, FX-2, FX-3, then FX-4.
- **Tier A** (money, tax): the builder stops after the logic and API items for the analyst's early check, then the designer does the screens.

## Brief (lead, 2026-10-29)
Read each finding in full in the audit run file, section A5 (findings 1–14; 10 went to FX-1 and 13 is copy).

### Builder (Opus high): logic, API, register
1. **A5 1 (High; 08-C RA-22, RA-23): a tax-only debit note in GSTR-1.** `cdnr.csv` carries a tax-only debit note with taxable 0.00 and no tax column (`packages/core/src/gst/layouts.ts:126-140`). The Offline Tool then imports ₹0 tax and 3B Table 3 under-reports, while the panel says "No errors".
   - `gstr1Sections` returns a **blocking warning** for each such note. It names the note, the recipient GSTIN and the tax heads with amounts to enter by hand.
   - The export panel can't say "No errors" while one is present. The designer shows it.
   - Add a new OPEN row to `docs/08-research-appendix/C-research-register.md`, §1 and the §5 CA list, as `OPEN: <the precise question>`: "How is a tax-only debit note (taxable value nil, tax only) reported in GSTR-1 Table 9B through the Offline Tool, and how does it flow to 3B Table 3?" Cite RA-22 and RA-23. Never guess the answer.
   - Tests, including the twin test of the sections against the hand-computed fixture.
2. **A5 11 (08-C, OPEN for the CA): round-off on a tax-only note.** A tax-only debit note of ₹10.01 IGST totals ₹10.00 after round-off.
   - Never round a tax-only note's total below its tax: no round-off, or round-off only upwards, whichever the tax engine's rules allow without a guess. Say which you chose and why.
   - Add the question to the same OPEN row, or a sibling one.
   - Enforce it in every layer the other note rules use: core, the freeze `WHERE` and the trigger if one covers totals. A new trigger means a new migration; never edit an applied one, and never rebuild a referenced table.
3. **A5 7: the statement's "against" for debit notes.** The statement shows no "against" invoice for debit notes (`packages/db/src/reports.ts:159`). Show the parent number as credit notes do. Test it, and the PDF statement too (`STATEMENT_LAYOUT_ID` changes if the layout does).
4. **A5 9: the supplier copy.** It answers 202 forever when the original PDF never rendered (`apps/admin/worker/document-pdf.ts:136-140`). Answer 409 `pdf_pending` instead, plus a test.
5. **A5 6: ledger rows.** "(after 1 note)" counts credit notes only (`apps/admin/src/lib/notes.ts:218`). Make the helper count and name what it counts ("credit note" / "credit notes"), and give each ledger row its type for the screen. Logic only; the designer places it.
6. **A5 12: the default SAC on a custom line.** A custom line has no default SAC. Default it from the tax settings when one is set (check what the `tax` settings row holds; if no default-SAC setting exists, add one to the settings schema with an empty default, behind the existing settings permission). Tests.
7. **A5 4: audit labels.** Add labels for the 15 `invoice.*` actions, `invoice.issue_auto` and `report.export`, plus Invoices and Reports filter groups (`apps/admin/src/lib/audit.ts:44-114`). The dashboard feed then shows labels, not raw codes.
   - Every new label is `[Placeholder]` copy for 07-Y. Use the wording style of the existing labels.
   - Add a test that every action code written by a route in `ROUTES` has a label.

**Stop here for the analyst's early check** (items 1–2 above all). Commit and report.

### Designer (Opus high, after the early check): screens
- **A5 2 (High):** the issue panel's blocker links get a 44 px hit area (`invoices.css:465-473`).
- **A5 1 (screen):** show the GSTR-1 blocking warning on the export panel.
- **A5 3:** the totals separate line discounts from the document discount (`routes/documents/money.tsx:40-44`). Wording goes to 07-Y.
- **A5 5 (RA-28):** "GST (estimate)" for proformas on the screen, the PDF (`packages/pdf` proforma layout) and the portal. Only new proformas change; frozen envelopes print as they were. Wording goes to 07-Y.
- **A5 6:** the ledger rows show each row's type, and the "(after …)" line uses the new helper.
- **A5 8:** an added LUT row is marked "Not saved yet" until "Save changes".
- **A5 12 (screen):** the SAC is visible on a custom line, not hidden behind "Actions".
- **A5 14:** at 375, the sales-register output-tax table shows a scroll cue. Make it keyboard-scrollable the way FX-3 does for tables (`tabIndex`, `role="region"`, label).
- **The audit filter groups.**
- **Checks:** every invoice, note, report, statement and settings screen at 375, 768, 1024, 1280 and 1600, in both themes and with the in-app theme against the OS theme. Cover the empty, loading and error states, with axe.

### Rules
- Every tax rule is a researched default from 08-C, or an OPEN question; code comments carry `Researched <date>, <source> (08-C <ID>)` or `OPEN (08-C <ID>): <question>`. Never a bare VERIFY.
- Money in integer minor units; no floats (`packages/core/test/no-floats.test.ts`).
- Never touch staging or any hosted service; no workflow changes; install nothing.
- Don't touch FX-2's files (`public/_headers`, `apps/{admin,portal}/worker/{app,index}.ts`, `apps/admin/worker/catalogue.ts`, `apps/web/**`, `scripts/check-*`), or FX-3's open screens (clients, projects, leads, dashboard, notes, portal offer).
- New copy shows `[Placeholder]` and is listed under "Placeholder lines" in your report.
- Commit at least every 20 minutes. Work on your own branch from `origin/fix/fx4-invoicing` (`fix/fx4-builder`, `fix/fx4-designer`) and push only that branch.

### Done means
`pnpm check`, the full `pnpm test` and the admin, portal and jobs builds pass, all through `bash tools/heavy.sh`. Write your report in this file, with:
- the skills loaded;
- each item;
- the tests;
- the commands and their results;
- what you didn't verify;
- the placeholder lines;
- your open questions.

## Builder report (builder, Opus 5.5 high, 2026-10-29): Early check

Branch `fix/fx4-builder` from `origin/fix/fx4-invoicing` (a769e790), five commits: 7f6310d6, cd4b7995, a0f99961, 7cd102a1, 3bd5598d. Stopped after items 1–7 for the analyst's early check (Tier A).

**Skills loaded:**
- `cloudflare:workers-best-practices`: the supplier-copy route keeps its `waitUntil` ask on the request lifetime, and no request state lives at module level. No other change came from it.
- `cloudflare:wrangler`: nothing to change. No binding, var or `wrangler.jsonc` edit, so no `wrangler types` rerun was needed beyond the typecheck's own.
- Not loaded:
  - `cloudflare:workers-profiling`: no CPU or cold-start work. The budget numbers are reported below from the build.
  - `frontend-design` and `dataviz`: no screens (designer).

### Items
1. **A5 1: a tax-only note is a blocking warning (08-C RA-22, RA-23; new OPEN RA-32).**
   - Core: `gstr1Sections` returns one `tax_only_note_manual` warning per credit or debit note whose rate rows carry tax on a taxable value of nil. Each warning has `blocking: true` and `manual`: the note, its kind, number and date, its section (cdnr, cdnur or b2cs), the recipient GSTIN (null when unregistered), the name, the place of supply, the parent number, and IGST, CGST and SGST per rate and in total. The warnings come first and in date order (`packages/core/src/gst/{types,sections,index}.ts`).
   - The CSV rows stay as they were (still OPEN under RA-23: the Offline Tool import is untested).
   - Admin: `buildGstExport` carries `complete` (false while a blocking warning is present) and `blocking` (their count). Warning lines are `WarningLine` (`blocking`, `manual`), blocking ones first (`apps/admin/src/lib/reports-build.ts`).
   - Words: `taxOnlyNoteText` and `GST_COPY.doneManual` (`apps/admin/src/lib/reports.ts`).
   - **The designer must switch `routes/reports/gst.tsx` from `GST_COPY.done` to `doneManual` when `!result.complete`. Until then the panel still says "No errors". I did not touch the screen.**
   - 08-C: new row RA-32, carrying the lead's exact question, and RA-32 is on the §5 CA list.
2. **A5 11: no round-off on a tax-only debit note (new OPEN RA-33).**
   - **Choice: no round-off at all** (round-off 0, total = the tax). Why:
     - it is the engine's existing "none" rounding mode (`rounding.totalUsd: "none"`; `assemble` uses unit 1), so no direction is invented;
     - "upwards only" would be a new rule that bills the client up to 99 paise that is neither tax nor value.
     - RA-14 says the invoice total's rounding is a house choice (s.170 rounds amounts payable).
     - The question is OPEN in 08-C RA-33 and on the §5 CA list.
   - Held in three places, all built from one SQL text, `taxOnlyNoteExactSql` (`packages/db/src/sql-rules.ts`):
     - core: `AssembleInput.noRoundOff`, set by `taxOnlyDebitNote` (`packages/core/src/tax/{totals,credit}.ts`);
     - the note freeze `WHERE` (`noteIssueTail`, `packages/db/src/issue.ts`);
     - the new trigger `documents_tax_only_note_exact`.
   - What the rule checks: a debit note whose reason is `tax_charged_too_low`, or whose taxable value is 0, freezes only with round-off 0, total = CGST + SGST + IGST and `computed.inr.roundOffMinor` 0.
   - **Migration `0052_tax_only_note_triggers.sql`**: one `CREATE TRIGGER` only. No table is rebuilt and no applied migration is edited. Generated with `drizzle-kit generate --custom --name tax_only_note_triggers` and `scripts/write-triggers.ts`. Snapshot `0052_snapshot.json` and journal entry added.
3. **A5 7: the statement names a debit note's invoice.**
   - SQL: `statementSource` now gives `parent` for both note types (`packages/db/src/reports.ts`).
   - Admin: the screen's Details and the CSV say "Debit note against {number}" (07-Y, marked). Without the number they keep 07-V's "Debit note".
   - PDF: `detailsOf` and `STATEMENT_PDF_COPY.kinds.debitNoteAgainst` print the same line, unmarked like every PDF line.
   - **`STATEMENT_LAYOUT_ID` is not bumped.** The markup is unchanged, and the view hash already changes for any statement that holds a debit note, because its `againstNumber` goes from null to the number. So a cached PDF that lacks the line is never reused, and one without debit notes is still correct.
4. **A5 9: supplier copy without the original.** `GET /invoices/:id/pdf/supplier` now answers 409 `pdf_pending` while the original has no PDF, and claims and queues nothing. 202 `{state:"making"}` only once the original exists (`apps/admin/worker/document-pdf.ts`). The SPA already treats 409 `pdf_pending` as pending.
5. **A5 6: the ledger rows.**
   - API: every ledger row carries `type` (`note-view.ts` `itemOf`; `NoteRow.type`).
   - `noteLedgerRows(notes)`: one list, oldest first, each row with `type`, `kind` and `typeText` (core series labels "Credit note" and "Debit note").
   - `creditNoteCount(notes)` gives the count for the balance line.
   - `balanceLine` says "(after 1 credit note)" or "(after {n} credit notes)" (07-Y, marked) (`apps/admin/src/lib/notes.ts`).
   - The screen still sorts on its own and calls `balanceLine(…, notes.credit.length)`, which is still correct. The designer places the type and can switch to the helpers.
6. **A5 12: the default SAC.**
   - The `tax` row had no such setting. New `tax.defaultSac`: "" by default, six digits when set. A stored row without it reads "" (`z.prefault`), and the seed is insert-only, so nothing is migrated. It is saved through the existing `PUT /settings/groups/tax` (`settings.manage`).
   - A **new** custom line sent without a SAC (absent or null) takes it, on proposals, estimates and invoices (`resolveLines(…, defaultSac)`, called from `document-save.ts` and `invoices.ts`).
   - An existing line keeps its own value, so a SAC cleared on purpose stays cleared and the issue is still blocked.
   - Draft views expose `newLineSac` so the screen can prefill.
   - The tax form model carries `defaultSac` (validation and `TAX_SAC_COPY` words) for the designer's field.
7. **A5 4: audit labels.**
   - `ACTION_LABELS` gains:
     - the 15 `invoice.*` actions (`issue_auto` among them; `invoice.sent` is an email template, not an audit action);
     - `document.resend`, `document.links_revoke` and `document.pdf_retry`;
     - `settings.signature.update` and `.delete`;
     - `care_invoice.draft` and `care_invoice.auto_issue_refused`.
     All of these are 07-Y and marked.
   - `report.export` already had its approved 07-V words.
   - Leads, care plans, time and `approval.expire` take the approved 07-Q words the dashboard already used, unmarked. A test keeps them equal to `ACTIVITY_PENDING`.
   - New filter groups "Invoices" (07-R's nav word) and "Reports" (07-V §1).
   - New test `apps/admin/src/lib/audit-labels.test.ts`: every `audit` in `ROUTES` has a label, with `settings.<group>.update` expanded over the generic groups. It reads `guard.ts` and `settings.ts` as `?raw` text, so the SPA's tests never import Worker modules.
   - `dashboard.ts` is untouched (FX-3's area). `activityText` reads `ACTION_LABELS` first, so the feed picks the labels up.

### Tests (new or changed)
- **core:**
  - `test/gst/tax-only-debit.test.ts`: the blocking warnings worked out by hand, intra and inter (₹10.01 IGST), plus b2cs and no-warning cases, and a twin that the heads named equal the tax the cdnr rows carry on a nil taxable value;
  - `test/tax/tax-only-debit.test.ts`: the old expectation 20,500 / −1 is now 20,501 / 0; ₹10.01; every amount from 1 to 99,999 sampled, intra and inter;
  - `test/settings.test.ts`: `defaultSac`.
- **db:**
  - `test/tax-only-note.test.ts` (new): the installed trigger equals the generated one; ₹18.02 issues as ₹18.02; the freeze refuses a rounded tax-only note and writes nothing; the trigger refuses it alone, by reason or by nil taxable, and on an INR-view round-off; an ordinary debit note keeps its round-off; a twin of core against `taxOnlyNoteExactSql` (8 amounts, exact passes, rounded fails);
  - `test/reports.test.ts`: the debit note's parent;
  - `test/care-auto-sql.test.ts`: the snapshot moves once, on purpose (the note tail), with a comment saying so;
  - `test/migrations.test.ts`: 0052 listed.
- **admin:**
  - `src/lib/reports.test.ts`: the blocking warning, `complete`, the words, the debit-note statement words and CSV, and the tax form round trip of `defaultSac`;
  - `src/lib/notes.test.ts`: the balance line, `noteLedgerRows` and `creditNoteCount`;
  - `src/lib/audit-labels.test.ts` (new);
  - `worker/default-sac.test.ts` (new, 5 tests);
  - `worker/note-research.test.ts`: ₹18.02 through the API;
  - `worker/supplier-copy.test.ts`: 409 without the original, no ask claimed;
  - `worker/invoice-notes.test.ts`: the row types;
  - `worker/reports.test.ts`: the debit note's `againstNumber`.
- **pdf:** `test/statement-layout.test.ts`.
- **jobs:** `test/statement-b.test.ts`: the PDF prints "Debit note against …".

### Commands and results (all heavy ones through `tools/heavy.sh`)
- Per-file runs while working, all green:
  - `fx4-db-taxonly` (54);
  - `fx4-admin-1` (44), `fx4-admin-2` (122), `fx4-admin-3` (89);
  - `fx4-db-reports` (26), `fx4-pdf-stmt` (11), `fx4-jobs-stmt` (25).
- `fx4-typecheck` (admin, core, db, pdf, jobs, portal): all Done, no errors.
- `pnpm test`:
  - first run (`fx4-test`): core's gst coverage was 99.9 % against its 100 % gate (an unreachable guard in `manualEntryOf`). Fixed in 7cd102a1, and `pnpm --filter @techaust/core test` then passed its gates.
  - second run (`fx4-test2`): db failed 2 tests, the expected snapshot move and the migration list. Fixed in 3bd5598d.
  - **third run (`fx4-test3`): all green.** auth 135, ui 469 (+2 skipped), core 1776, email 128, db 478, pdf 340, web 428 (+16 skipped), jobs 526, portal 621, admin 3263.
- `fx4-build` (admin, portal, jobs): green.

  | Bundle | Bytes | Startup | Note |
  |---|---|---|---|
  | admin front | 99,131 | — | |
  | admin API | 599,998 | 54.9 ms | the third-Worker trigger is 650,000 |
  | portal | 97,011 | — | |
  | jobs | 867,955 | — | |
- `pnpm check` (`fx4-check`, the one whole-repository lint): exit 0. The migration guard counts 53 migrations, none rebuilds. The 10 lint warnings are all in files this task did not touch.

### Not verified
- Any screen. The GST panel still says "No errors" until the designer uses `complete` and `doneManual`.
- A real Offline Tool import (RA-23), and how a tax-only note should be filed (RA-32).
- The staging or local D1 data. A tax-only debit note **draft** saved before this change with a non-zero round-off now gets `content_changed` (409) at issue, because the recomputation no longer rounds. It must be opened and saved again, or discarded and redrafted. Issued notes are untouched (the trigger fires only at the freeze).
- Rendered PDFs (HTML only, as the existing tests do).

### Placeholder lines (07-Y, `[Placeholder]` on screen until `APPROVED_07Y`)
1. GST panel instead of "No errors": "{n} documents checked. 1 note needs its tax entered by hand before you file." / "… {k} notes need their tax entered by hand before you file."
2. GST warning: "{number} (GSTIN {gstin} | unregistered client) adds tax only. The files show it with a taxable value of 0.00 and no tax, so the offline tool would take its tax as nil. Enter by hand: IGST ₹…, CGST ₹…, SGST ₹…. Ask your CA how to report it in Table 9B." Fallback without facts: "A tax-only note's tax is not in the files. Ask your CA how to report it."
3. Statement Details (screen and CSV marked; PDF unmarked, like every PDF line): "Debit note against {number}".
4. Notes section: "Balance due: {balance} (after 1 credit note)" / "(after {n} credit notes)" (replaces 07-T's "notes").
5. Settings › Tax:
   - label "Default SAC for custom lines";
   - hint "A new line that is not from the catalogue starts with this SAC. Leave it empty to enter one on each line.";
   - error "The default SAC has 6 digits, or leave it empty.";
   - audit field label "Default SAC for custom lines".
6. Audit actions:

   | Action | Words |
   |---|---|
   | `document.resend` | "sent a document again" |
   | `document.links_revoke` | "revoked a document's links" |
   | `document.pdf_retry` | "asked for a document's PDF again" |
   | `settings.signature.update` | "changed the signature image" |
   | `settings.signature.delete` | "removed the signature image" |
   | `invoice.create` | "created an invoice draft" |
   | `invoice.update` | "changed an invoice draft" |
   | `invoice.delete` | "discarded an invoice draft" |
   | `invoice.issue` | "issued an invoice" |
   | `invoice.issue_auto` | "issued a care plan invoice automatically" |
   | `invoice.advance_issue` | "issued a tax invoice for a payment received" |
   | `invoice.void` | "voided an invoice" |
   | `invoice.note_create` | "drafted a credit or debit note" |
   | `invoice.ims_status` | "recorded a client's IMS response" |
   | `invoice.service_completed` | "set the date the service was completed" |
   | `invoice.send` | "sent an invoice" |
   | `invoice.links_revoke` | "revoked an invoice's links" |
   | `invoice.pdf_retry` | "asked for an invoice's PDF again" |
   | `invoice.reminders_pause` | "paused payment reminders" |
   | `invoice.reminders_resume` | "resumed payment reminders" |
   | `care_invoice.draft` | "drafted a care plan invoice" |
   | `care_invoice.auto_issue_refused` | "could not issue a care plan invoice automatically" |

### Open questions
1. **For the CA (in 08-C):**
   - RA-32: how a tax-only debit note is reported in Table 9B through the Offline Tool, and how it flows to 3B Table 3.
   - RA-33: may such a note be rounded to the rupee, and in which direction?
2. **Lead or designer: should "blocking" also hold back the downloads?** I made the export *incomplete* (`complete: false`, never "No errors") but left the files downloadable. The person still needs them to file, with the tax entered by hand. If the lead wants the downloads held until the warning is acknowledged, that is a screen rule for the designer.
3. **Lead:** the brief mentions "the trigger if one covers totals". No existing trigger did, so the new trigger is the third layer. Does the analyst want it kept, given that it adds migration 0052 to the merge order (FX-4 merges last)?
