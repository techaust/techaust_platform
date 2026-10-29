Status: PR opened (re-check APPROVE)
Tier: A
Usage: builder claude-opus-5-5/high, 5-h 17 → 31 % (skills: cloudflare:workers-best-practices, cloudflare:wrangler); analyst claude-opus-5-5/high, 5-h 31 → 36 % (skills: cloudflare:workers-best-practices, cloudflare:wrangler, cloudflare:workers-profiling); review fix-round designer claude-opus-5-5/high (skills: frontend-design:frontend-design); re-check reviewer claude-opus-5-5/high, 5-h 44 → 52 % (skills: code-review, cloudflare:workers-best-practices, frontend-design:frontend-design); every other FX-4 run is in `node tools/model-audit.mjs 2026-10-29`, all Opus 5.5 high

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

## Early check (analyst claude-opus-5-5/high, 2026-10-29 ~10:35–11:00 IST, on 9a591121): PROCEED to the designer
_(Summary by the lead; the full text is in the conversation record.)_ No critical or high findings. The tax-only rules are correct and consistent with each other: the GSTR-1 blocking warning (one per note, every section, `complete === (blocking === 0)`, no files when `ok: false`), and no round-off in core, the freeze `WHERE` and trigger 0052 (one shared SQL text, NULL-safe, fires only `draft → issued` of a `debit_note`, generated and pinned like the others, no rebuild, numbered 0052 after FX-1's 0051). The statement's "against" and the hash argument hold. `tax.defaultSac` reaches only new custom lines on drafts. The `ROUTES` label test is real. Budget: admin API 599,998 bytes; expect about 606 KB after `main` merges in, under the 650,000 trigger, and no CPU risk. Tests run: db 46, core 45, admin 60, all green.

**Findings:**
- **M1 (medium):** the SPA maps 409 `pdf_pending` to "being prepared" (`invoices-api.ts:466-470`), so the supplier copy still looks stuck to the user, including for an erased client. Fix (designer): a distinct state; while the original isn't ready, say so and point to the PDF retry; fix the stale comment at `:419-421`; add an SPA test.
- **M2 (medium):** audit actions written outside `ROUTES` show raw codes:
  - `document.accept`, `document.decline`, `document.view`, `offer_link.use` (portal);
  - `document.expire`, `lead.purge` (jobs).

  Fix: labels (07-Q words where they exist, else 07-Y placeholders), and extend `audit-labels.test.ts` to every file that writes `audit_log`.
- **L1:** `sections.ts:427-432` tags an untested Offline Tool claim as Researched. Retag it `OPEN (08-C RA-23)`, and the warning says the tax "may not come through on import".
- **L2:** `taxOnlyNoteText` ignores `m.kind`, and gives head totals only. Words per kind; the designer shows `manual.byRate`.
- **L3:** the sales-register panel says "No errors" while it offers the 3B file. Show the same blocking count there (designer).
- **L4:** `noteLedgerRows` sorts numbers as text (`CN/2627/10` before `/9`). Order by issue instant or integer number.
- **L5:** the RA-33 wording. **Fixed by the lead.**
- **L6:** record the no-round-off deviation in docs/13. **Done by the lead.**
- **L7 (M6 follow-up):** a tax-only debit note can total paise, while the instalment split refuses a non-whole-rupee INR total (`tax/schedule.ts:74`). M6 must let a debit note be paid whole, or allow paise for an unrounded document. Goes on the status page's follow-ups.
- **L8 (staging):** an unissued tax-only debit-note draft or pending approval with a non-zero round-off gets 409 `content_changed` at issue: the safe behaviour. A plain re-save recomputes it. The designer checks that the editor allows saving an unchanged draft.
- **L9 (optional):** an API test that `defaultSac: "12a456"` is a 400.

**Builder questions:** Q2, don't hold the downloads; Q3, keep the trigger (docs/13).

## Fix round 1 (lead's brief; builder claude-opus-5-5/high)
In one commit per item, on `fix/fx4-fix1` from `origin/fix/fx4-invoicing`:
- **M2:** labels and the wider test.
- **L1:** the comment, plus the warning words (07-Y).
- **L2:** the words by kind (credit note vs debit note).
- **L4:** the order.
- **L9:** the test.

Then the full `pnpm test` and `pnpm check` through the queue, and a report here under "Fix round 1 report". The screen items (M1, L2's per-rate table, L3, L8's check) go to the designer with the brief's designer part.

### Fix round 1 report (builder, Opus 5.5 high, 2026-10-29)
Branch `fix/fx4-fix1` from `origin/fix/fx4-invoicing` (e9b8ef1e). One commit per item: 3869e93f (M2), 6294009a (L1), a1b66fcf (L2), f5e6ddf2 (L4), 069dac71 (L9), plus this report.

**Skills loaded:**
- `cloudflare:workers-best-practices`: no change came from it. The one Worker change is a read-only field (`issuedAt`) added to the notes view.
- `cloudflare:wrangler`: nothing to change. No binding, var or config edit.
- Not loaded: `cloudflare:workers-profiling` (no CPU work; one field on one view), `frontend-design` and `dataviz` (no screens).

**Items:**
- **M2: audit labels outside ROUTES** (`apps/admin/src/lib/audit.ts`, `audit-labels.test.ts`).
  - `lead.purge` and `document.expire` take their approved 07-Q words (DASH7, DASH14), unmarked.
  - `document.view`, `document.accept`, `document.decline` and `offer_link.use` (portal, actor "A client contact") are 07-Y lines, marked.
  - The test scans every source that can write an audit row through `import.meta.glob(…?raw)`: admin worker, portal worker, jobs, `packages/db/src` and `scripts/*.mjs`, without tests or test helpers. It collects:
    - `action:` literals and ternaries of literals;
    - the first dotted literal after each hand-written `INSERT INTO audit_log (…)`.
  - A non-literal `action:` value must be listed in `DYNAMIC` with every code it can take: `AlertKind`, `retryAction`, the generic settings route, and the two Turnstile actions. A new one fails as "unknown", and a listed one that no longer exists fails as "stale".
  - Found 90+ codes. Every one has a label.
- **L1: the Offline Tool claim** (`packages/core/src/gst/sections.ts`, `types.ts`, `apps/admin/src/lib/reports.ts`, 08-C RA-32).
  - The claim "the Offline Tool would take its tax as nil" is now `OPEN (08-C RA-23)` (untested). The researched part stays researched: 3B Table 3 is auto-filled from GSTR-1.
  - The warning and the RA-32 row now say its tax "may not come through on import".
- **L2: words by kind** (`reports.ts` `taxOnlyNoteText`).
  - A credit note "is a credit note that reduces tax only"; a debit note "is a debit note that adds tax only".
  - Beyond the brief, my call: a note reported in the **b2cs** file now ends "Ask your CA how to report it." with no table. Our own files put it in B2CS, not 9B, so naming "Table 9B" there would contradict them. cdnr and cdnur keep "… in Table 9B" (the RA-32 question).
  - The per-rate table is still the designer's.
- **L4: ledger order** (`apps/admin/worker/note-view.ts`, `src/lib/notes-api.ts`, `src/lib/notes.ts`).
  - Each ledger row from the API now carries `issuedAt` (`frozen_at`, UTC ms).
  - `noteLedgerRows` sorts by issue date, then `issuedAt` (missing last), then the number's series (text) and its trailing integer (`/10` after `/9`), then id.
  - Series first keeps one-day CN and DN rows stable when an older API sends no instant.
- **L9:** `worker/default-sac.test.ts`. Through `PUT /settings/groups/tax`, `12a456`, five digits, seven digits and a leading space are each 400 `invalid` with `fields` naming `defaultSac`, and the row and its version are unchanged. Six digits save and read back; "" clears.

**Tests:** new or changed tests are in `audit-labels.test.ts` (2 new), `reports.test.ts` (1 new, 2 updated), `notes.test.ts` (1 new), `invoice-notes.test.ts` (`issuedAt` asserted) and `default-sac.test.ts` (1 new).

**Commands and results** (heavy ones through `tools/heavy.sh`):
- Per-file runs while working: `fx4f1-labels` (6), `fx4f1-reports` (35), `fx4f1-notes` (64), `fx4f1-sac` (6). All green.
- `fx4f1-test` (`pnpm test`): all green. auth 135, ui 469 (+2 skipped), core 1776, email 128, db 478, pdf 340, web 428 (+16 skipped), portal 621, jobs 526, admin 3268 (was 3263).
- `fx4f1-check` (`pnpm check`, the one whole-repository lint): exit 0. The typecheck passes in every package. The migration guard counts 53 migrations, none rebuilds. The 10 lint warnings are the same ones as before; none is in a file this round touched.

**Placeholder lines (07-Y, marked until `APPROVED_07Y`)** (they replace or add to the builder report's list):
1. Audit actions:
   - `document.view`: "viewed a proposal or estimate"
   - `document.accept`: "accepted a proposal or estimate"
   - `document.decline`: "declined a proposal or estimate"
   - `offer_link.use`: "opened a proposal or estimate from an email link"
2. The GST warning (replaces line 2 of the earlier list): "{number} (GSTIN {gstin} | unregistered client) is a debit note that adds tax only | is a credit note that reduces tax only. The files show it with a taxable value of 0.00 and no tax column, so its tax may not come through on import. Enter by hand: IGST ₹…, CGST ₹…, SGST ₹…. Ask your CA how to report it in Table 9B." For a B2CS note the last sentence is "Ask your CA how to report it."; the fallback without facts is unchanged.

**Not verified:**
- Any screen. The designer still has M1, L3, the per-rate table, L8, and switching the ledger to `noteLedgerRows`.
- Whether a b2cs tax-only note belongs in Table 7 or 9B. That is RA-32's question for the CA. The line no longer names a table for it.
- The scanner finds codes only in the forms listed above. An action passed through a helper other than `action:`, `auditFirstRow`'s spec or a literal `INSERT INTO audit_log` would not be seen. None exists today.

**Open questions:** none new. The audit filter groups have no "Leads", "Care plans", "Time" or offer-link group yet. That is the designer's audit filter item.

## Designer report (designer, Opus 5.5 high, 2026-10-29)
Branch `fix/fx4-designer` from `origin/fix/fx4-invoicing` (bce6f435), six commits: e80ef6d4, 404fd2bc, fcbc6416, 5cccb205, 32f9654b, 86e593b3, plus this report. Admin SPA only (no Worker, no `packages/`, no portal file changed).

**Skills loaded:**
- `frontend-design:frontend-design`: set the direction inside docs/06. One new device only, the manual-entry card (the problem list's left rule, in warning, with a compact ledger of the report's own type), and no decoration elsewhere; the scroll cue is a plain ink shade, not a new component; the unsaved LUT is plain words with the drafts' pencil, not another pill; I checked each choice against the existing screens rather than adding chrome.
- `dataviz`: the per-rate figures are a table, not a chart (its form heuristic), so no chart was made. What it changed: text in text tokens only, numbers right-aligned in tabular figures, a total row only when there is more than one rate, and only the heads that carry tax.

### Items
1. **A5 2, blocker targets** (`invoices.css`): a blocker row with a link is a full 44 px row. An invisible layer over the row is the link's target and carries the focus ring, so "Settings › Company" and one-line sentences are no longer 20 px targets. Rows with nothing to open keep the old rhythm. Measured: rows 44 to 75 px; clicking "Line 1 needs a 6-digit SAC code." puts the cursor in the line's SAC field.
2. **A5 1 (screen), the GST panel, L2** (`routes/reports/gst.tsx`, new `routes/reports/manual-entries.tsx`, `reports.css`):
   - the heading uses `complete`: the tick and `GST_COPY.done` only when complete, otherwise the warning mark and `GST_COPY.doneManual(checked, blocking)`. It never says "No errors" while a blocking line is present;
   - under it, each tax-only note is a card: the builder's sentence, a ledger of `manual.byRate` (Rate, then only the heads with tax, a Total row when there are two or more rates), and "Open document" (44 px);
   - "Check before filing" keeps only the non-blocking warnings. The downloads stay open (lead's answer to builder Q2).
   - Its own module, because `./parts.tsx` is also imported by the client statement tab, which must not pull in the gst core.
3. **L3, sales register** (`lib/reports-build.ts`, `routes/reports/sales-register.tsx`): `SalesRegister` carries `manual` (the GST export's blocking lines when the 3B file is offered; empty otherwise). With any, the panel shows the same heading line and the same cards. Test added.
4. **A5 3, discounts** (`lib/documents.ts`, `routes/documents/money.tsx`, both editors and both read views): the totals row is named by where the discount comes from: the document only keeps 07-O's "Document discount"; lines only is "Line discounts"; both is "Discounts (lines and document)" (07-Y). Drafts read it from what is typed, parsed through core as the save is; frozen views from the stored discounts. The amount is still the server's one `discountMinor`. Separate rows need the API's help (open question 2).
5. **A5 5, "GST (estimate)" on proformas: not done, blocked.** Telling a new proforma from a frozen one needs a marker sealed at issue, which is the builder's (open question 1). Nothing was changed for it.
6. **A5 6, ledger rows** (`routes/invoices/notes-parts.tsx`, `notes.css`): the section uses `noteLedgerRows` (date, issue instant, integer number) and `creditNoteCount`. Each row shows its type ("Credit note", "Debit note") before its date, with the dates aligned down the column. On a phone the type and date sit under the number.
7. **A5 8, LUT not saved** (`routes/settings/tax.tsx`, `lib/tax-settings.ts` `LUT_UNSAVED`, `lutIsUnsaved`, `screens.css`): a row the stored list doesn't hold (same year, ARN and date) shows "Not saved yet" with a pencil under its year until "Save changes". The list's heads wrap and its cells sit closer, so it fits the settings column at 1024 px (it ran past it once the mark was added; it was already 33 px too wide before, hidden by the page padding). Tests added.
8. **A5 12, SAC** (`routes/documents/lines.tsx`, `documents.css`, both editors, `routes/settings/tax.tsx`, `screens.css`):
   - a custom line's SAC is a field on its row (a catalogue line has none to type). The blocker puts the cursor there, and the details dialog keeps its field;
   - a new custom line starts with the view's `newLineSac`;
   - Settings › Tax has the "Default SAC for custom lines" field with the builder's words.
9. **A5 14, scroll cue** (`routes/reports/parts.tsx` `WideList`, `reports.css`): every report table that scrolls sideways is a focusable region with `role="region"` and its label, inside a box that draws a soft ink shade on the edge hiding more columns, moving to the other edge as it scrolls. It shows only while there is more to see, the box measures on scroll, resize and render, and with reduced motion there is no fade. It also applies to the client statement tab, which uses the same `WideList`; that tab's file is unchanged.
10. **The audit filter groups** (`lib/audit.ts` `ACTION_GROUPS` now `prefixes`, `actionsInGroup`; `routes/audit.tsx`):
    - added Leads, Care plans and Time (the sidebar's words), in the sidebar's order;
    - `care_invoice.*` sits under Invoices, `offer_link.use` under Proposals and estimates, `doc_token.use` under Client portal.
    - New test: every labelled action is in exactly one group, and no prefix is dead. Checked on screen: 22 groups.
11. **M1, supplier copy** (`lib/invoices-api.ts`, `lib/invoices.ts` `supplierCopyUnavailable`, `routes/invoices/read.tsx`, `documents.css`):
    - 409 `pdf_pending` is its own state, `no_original`; 202 stays `pending`. The stale comment at the old `:419-421` now says what the route answers.
    - The button keeps a polite line under it, not a passing toast. For a live client: the copy follows the client's PDF, use Try again on the PDF. For an anonymised client: none was made and none can be.
    - For a live client the page is read again; the PDF panel is keyed on its state, so a page read that finds the PDF not ready draws the panel with its own "Try again".
    - SPA tests: the 202, 409 `pdf_pending`, another 409, offline and ready answers, and both lines.
12. **L8, unchanged draft:** checked by reading `note-dialog.tsx`. Its first step always saves the request (create, or `notesApi.save` on the open draft) before the issue step, with no "unchanged" short-cut. Reopening an old tax-only debit-note draft and pressing the issue button therefore re-saves it, which recomputes the round-off, and then issues with the new `contentSha256`. No change needed. Not exercised with an old draft in the browser.
13. **Found in the sweep, fixed** (`documents.css`, shared by the invoice and proposal editors): at 1024 px with the menu open and the rail beside it, the editor column is about 21 rem wide. A line's quantity, rate and discount ran out of the panel (the unit set one letter per line) and the totals ran past the card. This was there before FX-4. The lines panel and the totals panel are now size containers: below 30 rem a row takes the phone arrangement, and below 20 rem the cells stack. Re-swept: no overflow at any width.

### Shots (`.logs/shots/fx4-designer/`, all local sample data; full page unless "focus")
- `01-invoice-draft-1280-light.png`: a draft with seven blockers as 44 px rows, a custom line's SAC on its row, "Discounts (lines and document)".
- `02-invoice-issued-notes-1280-light.png`: the notes ledger with types, the balance line "(after 1 credit note)", the discount row.
- `03-supplier-copy-no-original-1280-light.png`: the supplier copy's 409 line under the button (the 409 simulated in the browser; locally no PDF is ever made).
- `04-gst-manual-1280-light.png`: the GST panel for Q3 2026-27 with one tax-only debit note: warning heading, the card with its per-rate ledger, the totals.
- `06-invoice-draft-1024-container-fix.png`: the same draft at 1024 after the container fix.
- `07-keyboard-blocker-focus-1280.png`: keyboard focus on a blocker row (the ring around the whole 44 px row).
- `08-lut-unsaved-1024-light.png`: "Not saved yet" under a new LUT's year, the list inside its column.
- `09-sales-output-scroll-cue-375-light.png`, `10-sales-manual-entry-375-light.png`: the output-tax table's scroll cue at 375, and the sales register's manual-entry card.
- The sweep, `{screen}-{375,768,1024,1280,1600}-{light,dark}.png` plus `{screen}-1280-app-dark-os-light.png` and `-app-light-os-dark.png` (in-app theme against the OS theme), with `-focusN.png` crops of the changed part. Screens:
  - `inv-draft`, `inv-issued` and `dn-taxonly` (the ₹18.02 tax-only note, no round-off line);
  - `gst-idle`, `gst-loading` (the read held 4 s), `gst-error` (the register route answering 500) and `gst-manual`;
  - `sales-manual` (1 Oct to 31 Dec 2026) and `sales-empty` (April 2026, the empty state);
  - `settings-tax` (a LUT added, not saved);
  - `audit`, `statement` (client A, "Debit note against …") and `invoices-list`.

### Commands and results
- `pnpm install --frozen-lockfile --offline`: ok. Local setup: `pnpm dev:secrets`, `db:migrate:local` (53, with 0052), `db:seed:local`, `portal:sample`, `invite --role owner`.
  - Sample data was made through the local API: company, bank and client A's GSTIN and address; TH/INV/2627/0001 issued; TH/CN/2627/0001; TH/DN/2627/0001 (tax only, ₹18.02); TH/DN/2627/0002; a draft for client B; `tax.defaultSac` 998314; one stored LUT.
  - Fake GSTINs were made with core's check character.
  - The invoice's `pdf_sha256` was set by hand in the local D1 only, to show the supplier-copy button.
- `heavy.sh fx4d-tc1` (admin `tsc -p tsconfig.json`): exit 0.
- `heavy.sh fx4d-spa1` (5 SPA test files): 124 passed.
- `pnpm exec biome check --write` on every file I changed: clean.
- `heavy.sh fx4d-test` (`pnpm test`): all green. auth 135, ui 469 (+2 skipped), core 1776, email 128, db 478, pdf 340, web 428 (+16 skipped), portal 621, jobs 526, admin 3277 (was 3268).
- `heavy.sh fx4d-build` (admin, portal, jobs): green.
  - admin front 99,131 bytes;
  - admin API 600,019 bytes (+21; under the 650,000 trigger);
  - portal 97,011 bytes;
  - jobs 867,955 bytes.
- `heavy.sh fx4d-check` (`pnpm check`, the one whole-repository lint): exit 0. 10 warnings, all in files I didn't touch; typecheck, binding, content, Worker config and migration guards ok.
- Sweeps (a Playwright 1.64.1 script in my scratchpad, not committed; logs `.logs/fx4d-sweep{1..4}.log`): 13 screens × 5 widths × 2 themes, plus the two theme mismatches at 1280. axe uses the WCAG 2.0/2.1/2.2 A and AA tags.
  - The first pass found two problems: `target-size` on the line SAC at 1024 (the overflow above) and a 99 px sideways scroll on Settings › Tax at 1024 (the LUT list). Both are fixed.
  - The re-sweeps of the changed screens: axe clean, no sideways overflow, at every width and theme.
  - Console: only the 401 before sign-in and the 500s I injected for the error state.
- Keyboard: Tab reaches each blocker row (ring on the whole row) and the scrollable tables. The blocker link focuses the line's SAC field. No traps.
- The dev server (admin, port 5173) was stopped, and every browser was closed.

### Not verified
- A real PDF or Browser Run render. The supplier copy's 409 was simulated in the browser (fetch answering 409). The anonymised-client line is checked by unit test only.
- The proposal editor at 1024. It shares the container fix but I didn't open one.
- A tax-only draft saved before 0052 being re-saved in the browser (L8 is from reading the code).
- After a default-SAC prefill, clearing the SAC on a line never saved: the server may apply the default to a line sent without a SAC. I didn't check what the save sends for an empty field.
- The portal (no portal file changed). NVDA, Safari, Firefox and real phones were not tested.

### Placeholder lines (07-Y, `[Placeholder]` on screen until `APPROVED_07Y`; mine, in addition to the builder's)
1. Under "Download supplier copy", live client: "The supplier copy is made after the client's PDF, which isn't ready yet. Use Try again on the PDF if it is taking longer than usual."
2. The same, anonymised client: "No supplier copy was made before this client was anonymised, and none can be made now."
3. Totals row, line discounts only: "Line discounts".
4. Totals row, line and document discounts: "Discounts (lines and document)".
5. A LUT added but not saved: "Not saved yet".

Words used that were already approved: "SAC" (the details dialog's label), "Rate" and "Total" (07-V's columns), "Open document" (07-V), and "Leads", "Care plans" and "Time" (the sidebar).

### Open questions
1. **A5 5 ("GST (estimate)" on new proformas): blocked on data.** Telling a new proforma from a frozen one needs a marker sealed at issue.
   - Recommended: the builder adds `header.proforma.gstEstimate: true` in the proforma issue path, sealed with the rest. `packages/pdf` (`invoice-view.ts`, `layout/invoice.ts`), the admin `TaxPreview` and the portal invoice view then print the head names as "CGST (estimate)", "SGST (estimate)", "IGST (estimate)" only when it is present (wording for 07-Y).
   - Or the lead sets a cut-over date. I didn't invent one.
   - Then a short designer round.
2. **A5 3 as two rows?** I named the one row by its source (the finding's own alternative). Two rows ("Line discounts", "Document discount") need the views' totals to carry `lineDiscountMinor` and `documentDiscountMinor`; the computed document already has them per line, and the sum is server work. Keep the label (recommended for this task), or a builder round?
3. **The DataTable at 1024 in narrow columns.** The `.dtable` scroll region is FX-3's (A3 1). I only made the LUT list fit; other narrow-column tables may still run into the page padding.

## Lead's answers after the designer (2026-10-29 ~14:10 IST)
1. **A5 5:** go with the sealed marker.
   - The proforma issue path writes `proforma.gstEstimate: true` into the sealed header (`header_extras`) of every proforma issued from now on.
   - The PDF, the admin view and the portal view label the tax heads "(estimate)" only where the marker is present.
   - Frozen proformas print exactly as before.
2. **A5 3:** keep the named single row ("Document discount" / "Line discounts" / "Discounts (lines and document)"). It is accurate, and splitting the figure needs no tax-engine change worth making now.
3. **Narrow tables at 1024:** FX-3's `.dtable` scroll regions cover the general case. The final sweep checks them.

## Builder round 2 (lead's brief; builder claude-opus-5-5/high)
On `fix/fx4-b2` from `origin/fix/fx4-invoicing`:
- **A5 5, the data side.** The marker goes into the proforma issue batch (`packages/db/src/issue.ts`, wherever the proforma `header_extras` are frozen and sealed). It is part of the seal, so a tampered marker fails the seal check like any other sealed field.
  - Expose it on the invoice view (`invoice-view.ts`) and the portal's invoice view (`apps/portal/worker/invoice-summary.ts` / `invoices.ts`).
  - Pass it into the PDF envelope (`packages/pdf` proforma layout input), so the label can be drawn. Jobs refuses a tampered envelope as it does today.
  - Draw the words in the PDF layout as "(estimate)" after each tax head label, marked as 07-Y copy (unmarked in the PDF, like every PDF line).
  - Tests:
    - a new proforma carries the marker;
    - an old one doesn't;
    - the seal covers it;
    - the PDF HTML shows "(estimate)" only with the marker.
- Run the full `pnpm test` and `pnpm check`. Report under "### Builder round 2 report". The admin and portal screen labels then go to a short designer round (or the final sweep's fix task).

### Builder round 2 report (builder, Opus 5.5 high, 2026-10-29)
Branch `fix/fx4-b2` from `origin/fix/fx4-invoicing` (1a6e7441). Code commit 3ea3cf5c, plus this report.

**Skills loaded:**
- `cloudflare:workers-best-practices`: the portal summary keeps reading the frozen D1 row, not the R2 envelope. The marker parse is a pure function with no per-request state, and there is no `import()`. I checked the bundle cost (portal +301 bytes).
- `cloudflare:wrangler`: no config, binding or var changed, so there was no `wrangler types` regeneration and no deploy.
- Not loaded: `cloudflare:workers-profiling` (no CPU-sensitive path changed; the startup figures are below), `frontend-design` (no screen), `security-review`/`code-review` (reviewer skills).

**A5 5, the sealed `proforma.gstEstimate` marker (Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28)):**
- **Core** (`packages/core/src/invoices.ts`, `export-invoice.ts`):
  - `InvoiceSnapshotInput.proforma` is now `{ notice; gstEstimate?: true }`. It is absent on proformas sealed before FX-4, so their hashes don't change.
  - `isGstEstimate(proforma)` counts only the literal `true`.
  - `gstEstimateOfHeaderExtras(text)` reads the marker from the stored `header_extras` text, for the portal.
- **Issue path** (`apps/admin/worker/invoice-model.ts` `headerExtrasOf`): every proforma is sealed and frozen with `{ notice: PROFORMA_NOTICE, gstEstimate: true }`. It is part of the canonical header, so `snapshot_sha256` covers it. The frozen-update trigger already blocks any change to `header_extras` after issue. `headerExtrasOfRow` passes the object through unchanged, so a changed marker fails the seal check.
- **Admin view** (`apps/admin/worker/invoice-view.ts`): `proforma.gstEstimate` is the sealed value on a frozen proforma. On a draft it is `true`, because the draft will be issued with the marker.
- **Portal** (`apps/portal/worker/invoice-summary.ts`): `SUMMARY_COLS` adds `d.header_extras`. `summaryOf` returns `gstEstimate`, which is true only for a proforma with the marker. This covers both the signed-in `/invoices/:id` and the emailed `/t/document`.
- **PDF** (`packages/pdf`):
  - `parseInvoiceEnvelope` refuses a `proforma.gstEstimate` that is anything but `true`.
  - `InvoiceView.proforma.gstEstimate` is true only when `type === "proforma"` and the sealed marker is present.
  - The layout (`layout/invoice.ts` `headLabel`) labels the CGST, SGST and IGST rows of the totals, and the tax summary's column-group heads, with `PROFORMA_PDF_COPY.estimate(head)` = "CGST (estimate)". The summary heads are now escaped too.
  - Older proformas print exactly as before.
- **Jobs:** no source change. The snapshot step builds the envelope from the rows (`invoiceSealPartsOfBundle`), so the marker travels with it, and the render step refuses an envelope whose seal no longer matches.

**Migration:** none. The marker lives in the existing sealed `header_extras` JSON.

**Tests (new or changed):**
- core `invoice-types.test.ts`: the marker changes the snapshot hash; `isGstEstimate` and `gstEstimateOfHeaderExtras` accept only `true` and treat malformed text as no marker. 1778 passed.
- db `invoice-types.test.ts`: the marker is sealed, changes the hash, and survives `headerExtrasJson`/`headerExtrasOfRow`.
- pdf, new `test/proforma-estimate.test.ts` (8 tests):
  - a new proforma carries the marker, verifies, and survives the D1 round trip byte for byte;
  - an older proforma has no marker and still verifies;
  - adding or removing the marker fails `snapshot_hash`, both in the envelope and through the rows;
  - a marker that isn't the literal `true` makes the envelope unparseable;
  - the HTML shows "(estimate)" on the CGST and SGST rows and summary heads only with the marker, and on IGST for an inter-state supply;
  - the total and the taxable value are never labelled;
  - a tax invoice is never labelled;
  - the notice check still passes.
  - The fixture gained an optional `{ gstEstimate }`. pdf: 348 passed.
- admin `invoice-types.test.ts`:
  - the two existing proforma seal tests now expect the marker;
  - new: the draft view says `gstEstimate: true`, the frozen `header_extras` holds the marker, the seal without it fails, and an `UPDATE` of the frozen `header_extras` is refused;
  - new: an older proforma (a copy of an issued row with the notice-only header) shows `gstEstimate: false`.
  - admin: 3279 passed (was 3277).
- portal `invoices.test.ts` (new) and `doc-token.test.ts` (key list and value): true only for a marked proforma; false for a notice-only or extras-less proforma and for a tax invoice carrying a stray marker. portal: 622 passed.
- jobs `pdf-invoice-types.test.ts` (2 new; seed option `gstEstimate`):
  - a marked proforma renders through the real layout with "(estimate)", and an older one without it;
  - a stored envelope with the marker removed is refused before Browser Run.

**Commands and results (all heavy ones through `tools/heavy.sh`):**
- `pnpm install --frozen-lockfile --offline`: ok.
- `pnpm exec biome check --write` on every file I changed: clean.
- Single-file runs: core, pdf (3 files), `fx4b2-admin-types` (52), `fx4b2-db-types` (36), `fx4b2-portal-inv`, `fx4b2-jobs-pdf`: green after two fixes to my own tests (the portal key list; the jobs test's key order in the stored JSON).
- `fx4b2-test` (`pnpm test`): exit 1.
  - auth 135, ui 469 (+2 skipped), core 1778, email 128, db 478, pdf 348, web 428 (+16 skipped) and portal 622 all passed.
  - jobs: 526 passed, 2 failed, both "Test timed out in 5000ms": `pdf.test.ts` "JOB-PDF-01 burst: 20 sends" and `offers.test.ts` "the email consumer sends each once". Neither touches a proforma, and the machine was loaded (portal took 230 s).
  - admin was stopped when jobs failed.
- `fx4b2-jobs-rerun` (those two files): 84 passed.
- `fx4b2-admin-test` (`pnpm --filter @techaust/admin test`): 109 files, 3279 passed.
- `fx4b2-check` (`pnpm check`, the one whole-repository lint): exit 0.
  - 10 warnings, all in files I didn't touch.
  - Typecheck, bindings, content, Worker config and migration guards ok (53 migrations).
- `fx4b2-build` (admin, portal, jobs): green.
  - admin front 99,131 bytes;
  - admin API 600,091 bytes (+72);
  - portal 97,312 bytes (+301);
  - jobs 869,130 bytes (+1,175);
  - every startup under 200 ms.

**Not verified:**
- A real Browser Run render of a marked proforma, or how the longer head ("CGST (estimate)") wraps in the summary's narrow column group on paper. The HTML is tested; the print look is the designer's sweep.
- A clean single `pnpm test` pass: jobs and admin were confirmed in separate reruns after the two load timeouts.
- The admin and portal screens don't show the label yet. The data is exposed (`proforma.gstEstimate` on the admin view, `gstEstimate` on the portal summary); the labels are the designer's short round.

**Placeholder lines (07-Y; printed unmarked in the PDF like every PDF line, pending approval):**
1. A tax head on a proforma sealed with the marker: "<head> (estimate)", i.e. "CGST (estimate)", "SGST (estimate)", "IGST (estimate)" (`PROFORMA_PDF_COPY.estimate`, exported through `@techaust/pdf/copy` so the screens can reuse it).

**Open questions:** none.

## Review (reviewer claude-opus-5-5/high, live browser, 2026-10-29 ~16:20–17:10 IST, on 99d28713): SEND BACK
_(Summary by the lead; the full text is in the conversation record. Shots: `.logs/shots/fx4-review/` in the main checkout.)_

**The tax and money core is correct and consistent across every layer**, checked live with locally issued documents:
- 2 invoices, a proforma, a credit note and 2 tax-only debit notes (₹18.02 CGST+SGST, ₹10.01 IGST);
- the GSTR-1 warning covers cdnr, cdnur and b2cs, and `complete === (blocking === 0)`;
- the per-rate figures match the register;
- no round-off held in core, the freeze `WHERE` and trigger 0052;
- the statement's "against";
- the supplier copy answers 409 then 202;
- the proforma marker is sealed, and the PDF shows "(estimate)" only with it;
- the audit action labels;
- the ledger order;
- no floats;
- migration 0052 is clean.

**Results:**
- `pnpm check`: exit 0.
- `pnpm test`: exit 0, no timeouts; admin 3,379, core 1,810, jobs 531, portal 631, db 478, pdf 348.
- Builds are within budget. The admin API is 611,979 bytes (38 KB under the 650,000 third-Worker trigger; plan for it in M6).

**Findings:**
- **H1 (high):** `quote-model.ts:517` (`sac: l.sac ?? newCustomSac`) puts the default SAC back when the person clears it on a new custom line (the SPA sends `null`). That hides the `line_sac_missing` blocker, so an invoice can be issued with a SAC that was deliberately removed. `default-sac.test.ts:35` locks this in.
  - Fix: apply the default only when `sac` is absent (`undefined`).
- **H2 (high, accessibility):** `routes/invoices/read.tsx:308` keys the PDF panel on `v.pdf.state`, so the panel remounts when the PDF turns ready and focus falls to `<body>` (WCAG 2.4.3). The live region is also mounted already filled.
  - Fix: keep `key={v.id}`, and sync the state from props or restore focus to `#pdf-h`. Add an SPA test.
- **M1:** the screens don't show "(estimate)" for a marked proforma: the admin `TaxPreview` (`money.tsx:55`) and the portal (`screens/invoices.tsx:186,189`). A5 5 covers the screens too.
- **M2:** `ENTITY_LABELS` (`lib/audit.ts:181`) lacks `lead`, `care_plan`, `time_log`, `document_send` and `report`, so raw codes show and the record filter can't pick them.
  - Fix: add the labels, and extend the test to scan the entity types.
- **M3:** the LUT "Not saved yet" line breaks mid-word at 1024 px (`screens.css:227-237`, `overflow-wrap: anywhere`).
- **L1:** the discount row's name comes from the typed fields, but its amount from the saved totals (both editors).
- **L2:** the live-client "no original" supplier line can't be reached (the panel shows `extra` only when the PDF is ready). Drop the dead branch or reword it.
- **L3:** `byDateThenNumber` (`gst/sections.ts:344`) sorts same-day notes as text, so `/10` comes before `/9`.
- **L4:**
  - no test for a tax-only note in `cdnur`;
  - the PDF prints the 07-Y lines "(estimate)" and "Debit note against …" unmarked; record that in docs/13.
- **L5:** `WideList`'s `useEffect(measure)` has no dependency list (`reports/parts.tsx:129`).

## Fix round 1 after the review (lead's triage)
Everything is fixed in this task. L4's record is done by the lead (docs/13).
- **Builder** (`fix/fx4-r1-b`): H1, M2 (the labels and the test), L3, L4 (the `cdnur` test).
- **Designer** (`fix/fx4-r1-d`, when the browser is free): H2, M1 (admin and portal), M3, L1, L2, L5.

Then a re-check (reviewer, Opus high), with H1 and H2 re-run live.

### Fix round 1 after the review, builder report (builder, Opus 5.5 high, 2026-10-29)
Branch `fix/fx4-r1-b` from `origin/fix/fx4-invoicing` (e31a6099). One commit per item: H1 3fa327fb, M2 8fff219d, L3 6eab67ad, L4 b95f479a, plus this report.

**Skills loaded:**
- `cloudflare:workers-best-practices`: the H1 change is pure request-shape logic in `resolveLines`. No new per-request state, no `import()`, no binding.
- `cloudflare:wrangler`: no config, binding or var changed, so no `wrangler types` and no deploy.
- Not loaded: `cloudflare:workers-profiling` (no CPU-sensitive path changed), `frontend-design` (no screen), `code-review`/`security-review` (reviewer skills).

**H1 (`apps/admin/worker/quote-model.ts` `resolveLines`):** a new custom line now takes the default SAC only when its `sac` key is absent (`l.sac === undefined ? newCustomSac : l.sac`). An explicit `null` stays null, so `line_sac_missing` blocks the issue.
- Paths checked: `resolveLines` has two callers, the proposal and estimate save (`document-save.ts:243`) and the invoice draft save (`invoices.ts:883`); both pass `settings.tax.defaultSac || null`. The route schema (`document-save.ts:81`) takes `sac` as optional and nullable, six digits.
- SPA (`lib/documents.ts` `lineIn`, shared by both editors): a custom line always sends `sac` (`nul(l.sac)`: the value, or `null` when empty), and a new line is prefilled from `newLineSac` (`routes/documents/lines.tsx:178`). So the screen sends the default as a value, and a cleared field as `null`, which now stays cleared. Only an API caller that leaves the key out gets the default.
- Existing and catalogue lines are unchanged.
- `default-sac.test.ts`: the old "null is the same as none" test is flipped (a line with a SAC, a line with `null` and a line without the key give `["998316", null, "998313"]` and the blocker on line 2). New tests:
  - "a new custom line sent with `sac: null` stays null and the issue is blocked": the issue is 409 `issue_blocked` with `line_sac_missing`, and no number is assigned;
  - "a new custom line sent without `sac` takes the default";
  - the same for a proposal draft (`[null, "998314"]`).

**M2 (`apps/admin/src/lib/audit.ts` `ENTITY_LABELS`):** added `lead` "Leads", `care_plan` "Care plans", `time_log` "Time" and `report` "Reports" (the sidebar's approved words, unmarked), and `document_send` `Y("Document sends")` (new, marked). The record filter (`routes/audit.tsx`) lists every entry of `ENTITY_LABELS`, so all five are offered with no screen change.
- `audit-labels.test.ts` has a new scan, `writtenEntityTypes`, over the same writers as the action scan (admin and portal Workers, jobs, `packages/db`, `scripts/*.mjs`, tests left out). It reads:
  - every `entityType: …`: literals and ternaries; pass-throughs (`m.entityType`, `r.entity_type`, type annotations, the schema column) are skipped; any other dynamic value fails until it is listed in `DYNAMIC_ENTITY`, which is empty today;
  - in hand-written `INSERT INTO audit_log (…)` SQL, the literal that follows the action literal.
- It fails on any written type without a label. It also fails on a label that nothing writes, unless that label is listed in `LABELLED_NOT_WRITTEN` with a reason. Further checks: the 07-Y mark, the sidebar words, unique filter words, and that the filter maps `ENTITY_LABELS`.
- Mutation check: removing `time_log` from the labels fails the scan with `time_log (worker/time-logs.ts)`. Restored afterwards.

**L3 (issue order of document numbers):** new `compareDocNumbers` in `packages/core/src/numbering.ts`, Worker-safe and re-exported by `gst/types.ts`.
- Order: series as text, then the integer at the end (compared as digit strings, so there is no 2^53 limit), then the full text, so the order is total. A number with no trailing digits sorts after its series' numbered ones.
- `byDateThenNumber` (`gst/sections.ts`) is now date, then `compareDocNumbers`, then id. The cdnr, cdnur and b2b row order and the blocking `tax_only_note_manual` warnings (built from the same sorted items) follow it.
- The same text sort was in three more GST lists and the SPA list, all fixed the same way (date, number, id):
  - `salesRegisterRows` (`gst/registers.ts`, id = `docId`);
  - `edfRows` (`gst/edf.ts`);
  - `realisationRows` (`gst/realisation.ts`);
  - the SPA's `byUrgency` (`lib/reports.ts`), which already imported `@techaust/core` and gains no gst value import.
- `noteLedgerRows` (`lib/notes.ts`) is unchanged: it already did this.
- Tests (`packages/core/test/gst/number-order.test.ts`):
  - helper cases and fast-check properties (antisymmetric, equal only when identical, transitive, matches the integers);
  - 10 same-day credit notes put in shuffled, coming out /1 to /10 in cdnr and in the sales register;
  - 10 same-day tax-only notes, whose warnings come out in issue order;
  - EDF and realisation with /1 to /10;
  - an id tie-break case;
  - `reports.test.ts` checks `byUrgency` /9, /10, /11, /100.
- The core coverage gate (gst 100 % branches) holds.

**L4 (`packages/core/test/gst/tax-only-debit.test.ts`):** two cdnur cases, worked out by hand:
- **EXPWP:** a USD export with IGST, two rates, ₹48,000.00 at 80; the tax-only debit note is USD 12.00 = ₹960.00 IGST, split ₹80.00 at 5 % and ₹880.00 at 18 %. Two cdnur rows (type D, EXPWP, taxable 0, IGST only) and one blocking warning: section `cdnur`, GSTIN null, place of supply 96, `byRate` per rate, IGST 96,000 paise.
- **B2CL:** an inter-state invoice to an unregistered client above the B2CL limit; the tax-only note has ₹10.01 IGST. One cdnur B2CL row and a blocking warning with no GSTIN, place of supply 27 and IGST 1,001.

**Commands and results** (heavy ones through `tools/heavy.sh`):
- `pnpm exec biome check --write <changed files>`: clean each time.
- `vitest run` on `default-sac`, `invoices-issue` and `documents` (admin): 84 passed. `.logs/fx4b-sac.log`
- `vitest run` on `audit-labels` and `screens` (admin): 34 passed. `.logs/fx4b-audit.log`. The mutation run failed as intended: `.logs/fx4b-audit-mut.log`.
- `pnpm --filter @techaust/core test`: the first run had every test passing but stopped on the gst 100 % branch gate (the id tie-break in `edf.ts:151` and `realisation.ts:258` was never reached). After the tie test it passed: 91 files, 1,820 tests. `.logs/fx4b-core.log`
- `pnpm test`: exit 0, no timeouts. `.logs/fx4b-test.log`
  - admin 3,386, core 1,820, jobs 531, portal 631, db 478, pdf 348;
  - web 510 (17 skipped), ui 469 (2 skipped), auth 135, email 128.
- `pnpm check`: exit 0. Lint, typecheck, binding, content, worker config, SPA headers and migration guards all passed (53 migrations). `.logs/fx4b-check.log`

**Not verified:**
- No live browser run of H1. The reviewer's re-check runs it live, as the triage says.
- The SPA's `lineIn` behaviour was checked by reading the code, not by an SPA test.

**Placeholder lines (07-Y, new):**
1. The audit record type `document_send`: "Document sends". "Leads", "Care plans", "Time" and "Reports" are the sidebar's approved words, so they are unmarked.

**Open question for the lead:** `document_send` is never written to `audit_log`. Sends are audited on the `document` record; the type appears only in `email_log`. The label was added as the brief asked, so the record filter now offers "Document sends", which always returns nothing. The test records this in `LABELLED_NOT_WRITTEN`. Recommendation: drop the label and its filter option, or keep it only if a send-level audit row is planned. One line either way.

**Lead, after the builder (2026-10-29):** the builder's open question is answered. Dropped the `document_send` record label, because nothing writes that type to `audit_log` (sends are audited on their document), so its filter would always be empty. The test now proves the label is absent. `audit-labels.test.ts` passes.

### Fix round 1 after the review, designer report (designer, Opus 5.5 high, 2026-10-29)
Branch `fix/fx4-r1-d` from `origin/fix/fx4-invoicing` (acd6df8a). One commit per item: H2 adb3fa5c, L2 e60b2d69, M1 44cd9f9e, L1 78a991e5, L5 edc527f5, M3 fa4934b4, plus this report. Admin and portal SPA only: no Worker, no `packages/`, none of the builder's files.

**Skills loaded:**
- `frontend-design:frontend-design`: kept every change inside the existing screens and docs/06. "(estimate)" is the head's own words, no badge or colour. The H2 fix keeps the panel calm: nothing redraws, only the words change. For M3 I tightened the spacing rather than shrinking or restyling the mark.
- Not loaded: `dataviz` (L5 is the scroll cue of a table, not a chart or tile), the Cloudflare skills (no Worker code), `code-review`/`security-review` (reviewer skills).

**Items:**
1. **H2** (`routes/documents/pdf-panel.tsx`, `routes/invoices/read.tsx`, `lib/pdf.ts`):
   - the invoice page keys `PdfPanel` on `v.id` only;
   - the panel takes a newer page read during render (`pdfReadChanged`: another state or fingerprint), so it is never remounted. The focus stays where it is, and the always-present polite region changes its words in place;
   - `onReady` no longer fires again when the page's own read brought "ready" (no extra reload).
   - Checked live: focus on `#pdf-h`, then the PDF was made ready in the local D1. After the panel's next poll: focus still on `#pdf-h`, the same live-region element (`isConnected`, identical node), one text mutation "PDF ready / Fingerprint a1b2c3d4e5f6", and Tab then goes to "Download PDF".
   - SPA tests (`lib/pdf.test.ts`): the helper, plus source checks that the page keys on `v.id` only and that the panel syncs from `initial` inside the `aria-live` region. The admin tests have no DOM, so there is no render test.
2. **L2** (`lib/invoices.ts`, `routes/invoices/read.tsx`, `lib/invoices-api.ts` comment):
   - dropped the unreachable live-client line and the page re-read (`onNoOriginal`);
   - `supplierCopyLine(state, anonymised)` gives the line only for an anonymised client's 409 (`SUPPLIER_COPY_NONE`, unchanged words, still `Y()`). A live client's 409 now gets the ordinary failure toast;
   - tests updated.
3. **M1** (admin: `routes/documents/money.tsx` `TaxPreview` `estimate` prop, `lib/invoices.ts` `taxHeadEstimate` = `PROFORMA_PDF_COPY.estimate` and `showsGstEstimate`, `lib/invoices-api.ts` `proforma.gstEstimate?`, the invoice editor and page; portal: `api.ts` `gstEstimate?`, `copy-invoices.ts` `INV.pdf.estimateHead`, `totalsRows` moved to `lib/invoices.ts`):
   - CGST, SGST and IGST read "(estimate)" only on a proforma whose marker is `true`. That covers a draft proforma, which the API marks `true` because it will be issued with the marker;
   - a proforma without the marker, an older API, and every other type keep the plain heads;
   - the FX panel's "IGST in INR" stays plain, as on the PDF (only the totals heads change there);
   - tests in both apps;
   - portal sample: `pro-due` now has the marker, and a new `pro-old` is a proforma sealed before FX-4 (listed on `/preview`).
4. **L1** (`lib/documents.ts`, both editors):
   - the invoice editor names the row from its saved view (`discountSources(v)`);
   - the proposal editor keeps `figures.discounts`: it starts from the read, then each save's sent lines and discount (`sentDiscounts`) are applied only when the server answers;
   - `draftDiscountSources` is removed;
   - tests: typing doesn't rename the row, a failed save changes nothing, and a later save that carries the document discount does. Checked live: typing a document discount kept "Line discounts ₹150.00"; after the autosave the row read "Discounts (lines and document) ₹435.00".
5. **L5** (`routes/reports/parts.tsx`): one effect with `[measure]` replaces the dependency-free one. It measures on mount, on scroll, when the box or its first child resizes, and when the content changes (a `MutationObserver` on the subtree, which also re-observes a table drawn afresh).
   - Checked live on the client statement at 768: nothing drawn while the table fits; the end shade appears when it is widened; the start shade after scrolling to the end; nothing again when it fits; a replaced, wider child shows the cue.
   - The first child is the `DataTable`'s `.dtable` div, so adding rows is caught by the mutation observer.
   - A source test was added.
6. **M3** (`screens.css`): the "Not saved yet" mark wraps only between words (`overflow-wrap: normal; word-break: normal; hyphens: none`). The LUT list's inner cells use `--space-2` and the outer edges keep `--space-3`.
   - At 1024 the table is 449 of 449 px, and "[Placeholder]" / "Not saved yet" are two whole-word lines.
   - It is one line at 768 and 1600. At 375 it is the card layout.
   - Once 07-Y is approved the mark is shorter and there is more room.

**Shots** (`.logs/shots/fx4-r1-d/`, local sample data, full page unless "focus"):
- `m1-admin-proforma-marked-1280-light.png`: TH/PI/2627/0001 with "CGST (estimate)", "SGST (estimate)".
- `h2-pdf-ready-focus-kept-1280-light.png`: the panel after it turned ready, the focus ring still on "PDF ready".
- `m3-lut-before-1024-light.png` (the mid-word break "[Placehold/er]") and `m3-lut-after-1024-light.png` (whole words).
- The sweep at 375, 768, 1024 and 1600 in light and dark (`{screen}-{width}-{theme}.png`, with `-focus.png` crops for the LUT list and the statement table). Screens:
  - `adm-pro-marked`: intra-state, PDF ready;
  - `adm-pro-igst-marked`: IGST with a line discount;
  - `adm-pro-old`: the marker removed from the API answer in the browser, plain "IGST";
  - `adm-pro-draft`: the editor, "(estimate)";
  - `adm-inv-draft`: L1, "Discounts (lines and document)";
  - `adm-inv-issued`: the supplier copy button;
  - `adm-settings-tax`: a LUT added, not saved;
  - `adm-statement`: WideList;
  - `por-pro-marked`: portal, "(estimate)";
  - `por-pro-old`: portal, plain heads.
- `adm-pro-marked-1280-app-dark-os-light.png` and `-app-light-os-dark.png`: the in-app theme against the OS theme.

**Commands and results:**
- Local setup in this worktree:
  - `pnpm install --frozen-lockfile --offline`, `pnpm dev:secrets`, `db:migrate:local` (53), `db:seed:local`, `portal:sample`, `invite --role owner`;
  - sample data through the local API: company legal name, address and a fake GSTIN (core check character), a sample INR bank, and billing addresses for clients A (WB) and B (MH);
  - documents: TH/PI/2627/0001 and 0002, TH/INV/2627/0001, an invoice draft and a proforma draft;
  - `pdf_sha256` set by hand in the local D1 only, on PI/0001 and INV/0001.
- Dev servers on 5183 (admin) and 5184 (portal), because another worktree's admin dev server held 5173. Before I noticed, one navigation from my browser opened my invite link on that server (it said "invalid", nothing changed).
- Sweep: a Playwright 1.64.1 script in my scratchpad (not committed), log `.logs/fx4r1d-sweep.log`. 10 screens × 4 widths × 2 themes, plus the two theme mismatches. axe (WCAG 2.0/2.1/2.2 A and AA): no violations anywhere. No sideways page overflow. No console errors.
- Keyboard: Tab from the PDF heading reaches "Download PDF"; focus is visible; no traps on the changed screens.
- Focused tests through `heavy.sh`: `pdf.test.ts` 12, admin `invoices.test.ts` 27, portal `invoices.test.ts` 10, `documents.test.ts` 34, `reports.test.ts` 40, all passed. Admin and portal `tsc -p tsconfig.json`: exit 0.
- `pnpm exec biome check --write` on each changed file: clean.
- `heavy.sh fx4r1d-test` (`pnpm test`): exit 0, no timeouts. admin 3,420, core 1,821, portal 635, jobs 531, web 510 (+17 skipped), db 478, ui 469 (+2 skipped), pdf 348, auth 135, email 128.
- `heavy.sh fx4r1d-build` (admin and portal): green. Admin front 99,271 bytes, admin API 612,169 bytes (no Worker file changed in this round; 38 KB under the 650,000 trigger), portal 97,458 bytes.
- `heavy.sh fx4r1d-check` (`pnpm check`, the one whole-repository lint): **exit 0**. 10 warnings, none in my files (`worker/reports.test.ts`, `public-text.ts`, `catalogue.ts`, the `pdf`/`ui` tests).
- Both dev servers (and their workerd) stopped. No process runs from this worktree (checked). The browser is closed.

**Not verified:**
- No real PDF render (no jobs or Browser Run locally). "Ready" was simulated by setting `pdf_sha256` in the local D1.
- A real proforma sealed before FX-4: "older" is simulated by removing the marker from the API answer in the browser (admin) and by sample data (portal).
- The proposal editor's L1 was checked by unit test only, not in the browser.
- No screen-reader run (NVDA); the live-region announcement is inferred from one in-place text mutation inside a persistent `aria-live="polite"` region.

**Placeholder text:** nothing new. "(estimate)" uses the PDF's word, unmarked like the PDF (docs/13, L4). The `Y()` marks are unchanged. One 07-Y line left the code: the live-client supplier-copy line ("The supplier copy is made after the client's PDF…") can no longer show, so drop it from 07-Y when FX-5 approves the page.

**Open questions:** none.

## Re-check (reviewer claude-opus-5-5/high, live browser, 2026-10-29 ~23:20 to 2026-10-30 ~00:00 IST, on 8ff46dea): APPROVE
_(Copied by the lead: the reviewer's rules forbid it to commit. Shots: `.logs/shots/fx4-recheck/`, logs `.logs/fx4rc/` in the main checkout.)_
All 10 findings fixed; no new critical, high or medium finding.
- **H1, live:** a new custom invoice line prefilled `998313`, cleared and autosaved, reads `sac: null` with `line_sac_missing` line 1; the screen says "Line 1 needs a 6-digit SAC code." and Issue is disabled; `POST /issue` after step-up answers 409 `issue_blocked` with `number: null`; after typing the SAC back the issue gives `TH/INV/2627/0001` (no number used by the refusal). Proposal: the cleared SAC stays null through later autosaves (a tax-engine warning there, as before; the invoice made from it is blocked).
- **H2, live:** with focus on `#pdf-h` and the PDF made ready in the local D1, after the poll focus stays, the live region and section are the same nodes, one mutation batch ("PDF ready / Fingerprint …"), Tab reaches "Download PDF" with a visible outline.
- **M1:** "(estimate)" heads on marked proformas (draft and issued, CGST/SGST and IGST) in admin and portal; plain heads when the marker is absent, and on a tax invoice.
- **M2:** labels added, no `document_send`; the scan finds every written type labelled.
- **M3:** the LUT list at 1024 is 449/449 px with whole-word breaks; one line at 768 and 1600, a card at 375, both themes.
- **L1, live in both editors:** "Line discounts" while typing, "Discounts (lines and document)" after the autosave.
- **L2–L5:** fixed as described; L5 checked live on the client statement at 768.
- **New, low (informational):** `apps/admin/src/routes/reports/parts.tsx:136` `watchTable` never unobserves a replaced first child; a detached `.dtable` stays watched until the effect cleans up. **Lead keeps it:** one detached node per new read, released on unmount, nothing visible; not worth a round.
- **Side note (outside FX-4):** the `code-review` helper ran before the checkout and reviewed #111: non-numeric `--usage`/`--running` slip through `tools/agent-slots.mjs`, and the cloud browser limit is 2 where docs/14 says 1. Both went to the CLOUD-1 fix round (lead, 2026-10-30).
- **Commands:** `pnpm check` exit 0 (53 migrations); `pnpm test` exit 0, no timeouts (admin 3,420, core 1,821, portal 635, jobs 531, web 518, db 478, ui 469, pdf 348, auth 135, email 128); admin and portal builds exit 0: admin front 99,271, admin API 612,169 (38 KB under the 650,000 third-Worker trigger), portal 97,458 bytes.
- **Sweep:** six screens at 375, 768, 1024 and 1600, both themes and the in-app theme against the OS theme; axe 0 violations; no sideways overflow; reduced motion respected; console errors only from the reviewer's own deliberate calls.
- **Not verified:** a real PDF render ("ready" simulated in the local D1); a real proforma sealed before FX-4 (simulated by removing the marker in the browser); NVDA; the anonymised client's supplier-copy 409 line live (unit tests only).

## Integration (lead, 2026-10-30)
- `fix/fx4-r1-b` and `fix/fx4-r1-d` merged; `main` merged twice (FX-3 #110 at acd6df8a, #111 at 8ff46dea, both clean after the per-file resolution recorded above).
- The re-check's `pnpm check` and `pnpm test` on 8ff46dea are the integration run (the branch hasn't moved since).
- PR opened with auto-merge.

## Handover
FX-4 is approved and its PR merges itself once CI passes, then deploys to staging. Next in the audit: **FX-5** (research tags, place of supply and due days, the new terms version, the approval switches and the 07-Y lines, sharp, Noto fonts, the wider VERIFY scan; `docs/runs/fx5-research-tags.md`). FX-5 merges `main` first, after FX-4 lands, and drops the unused 07-Y live-client supplier-copy line (designer's note). Follow-ups kept from FX-4: M6, a tax-only debit note can total paise against the instalment split; the admin API is at 612 KB (third Worker at 650 KB).
