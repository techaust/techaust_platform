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
