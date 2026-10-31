# 07-ZK: lines that sent the owner to "your CA" or "your CA and lawyer" (ca-wording)

Status: **DRAFT, waiting on the owner** (run file [ca-wording](../runs/ca-wording.md), Q1). Change a line here first, then in the code. Lines in `{braces}` are filled in by the screen. Every line below is **staff-facing** (the admin app, seen by the Owner and, where noted, the Accountant, Staff or Sales); no client-facing line changes.

**Why.** The owner has no CA or lawyer (owner, 2026-10-30; docs/13; CLAUDE.md rule 8). The lead settles open tax and legal items on the safest reading of the official sources ([08-C §5](../08-research-appendix/C-research-register.md)), and the owner files returns personally. A screen that says "ask your CA" points at someone who isn't there. Each new line says what the owner can do: the settled rule where 08-C settles it, or "check before you file" where 08-C leaves it open. No line claims a professional checked anything, and none names a profession.

**Replaces owner- or lead-approved copy** (each line below quotes the old line and its source): 07-V §2 and §2.2 (lines 1–4), 07-Y item 16 (lines 5–7), 07-S §8 and the error table (lines 8–9), 07-W §4 (lines 11–12). Lines 7, 10 and 13 had no 07 source (typed in code). Each line has the recommendation first; an alternative is given where there is a real choice.

## A. Reports › GST exports (Owner and Accountant)

1. **Page intro** (`apps/admin/src/lib/reports.ts`, `GST_COPY.lede`; 07-V §2).
   - Old: "Files for your GSTR-1 and GSTR-3B, made from the invoices and notes issued in the period. Check them with your CA before you file."
   - **New (Recommended):** "Files for your GSTR-1 and GSTR-3B, made from the invoices and notes issued in the period. Check the figures before you file."

2. **Layout note under the downloads** (`GST_COPY.verify`; 07-V §2). 08-C RA-23: a test import of each file into the GST offline tool before the first GSTR-1 is the owner's duty.
   - Old: "Made with layout {version} for the GSTR-1 offline tool. Layouts change; before your first upload, test-import one file with your CA."
   - **New (Recommended):** "Made with layout {version} for the GSTR-1 offline tool. Layouts change; before your first upload, test-import each file into the offline tool and check what it shows."

3. **Warning: a B2CS row below zero** (`gstWarningText`, `b2cs_negative_net`; 07-V §2.2). 08-C has no row on this yet (a follow-up asks for one), so the line only says to check.
   - Old: "B2CS for {state} and {rate} comes to below zero after credit notes. Check with your CA how to report it."
   - **New (Recommended):** "B2CS for {state} and {rate} comes to below zero after credit notes. Check how this row shows on the GST portal before you file."

4. **Warning: an export invoice issued before 1 October 2026** (`before_fema_2026`; 07-V §2.2; also on Reports › EDF and Export realisation). 08-C RB-02, settled 2026-10-30: 9 months from the invoice date; ask the bank for an extension if that has passed.
   - Old: "Issued before 1 October 2026: a different realisation period may apply. Ask your bank or CA."
   - **New (Recommended):** "Issued before 1 October 2026: the 9 months run from the invoice date. If they have passed, ask your bank for an extension."

## B. Reports › GST exports: a note that changes tax only (Owner and Accountant)

08-C RA-32, settled 2026-10-30: such a note is entered by hand in Table 9B on the GST portal, and GSTR-3B Table 3 is checked before filing. For a note to an unregistered client in the B2CS file, 08-C says nothing about Table 9B, so line 6 names no table.

5. **The warning card, registered client or B2CL note** (`taxOnlyNoteText`; 07-Y item 16). Today the card ends "Enter by hand: {tax heads}. Ask your CA how to report it in Table 9B."
   - Old (whole card): "{number} ({GSTIN or "unregistered client"}) is a debit note that adds tax only. The files show it with a taxable value of 0.00 and no tax column, so its tax may not come through on import. Enter by hand: {tax heads}. Ask your CA how to report it in Table 9B."
   - **New (Recommended):** "{number} ({GSTIN or "unregistered client"}) is a debit note that adds tax only. The files show it with a taxable value of 0.00 and no tax column, so its tax may not come through on import. Enter it by hand in Table 9B on the GST portal: {tax heads}. Then check GSTR-3B Table 3 before you file."
   - For a credit note, "is a debit note that adds tax only" stays "is a credit note that reduces tax only" (unchanged).

6. **The same card, a note in the B2CS file** (07-Y item 16, "For a B2C note the last sentence is …").
   - Old ending: "Enter by hand: {tax heads}. Ask your CA how to report it."
   - **New ending (Recommended):** "Enter it by hand on the GST portal: {tax heads}. Then check GSTR-3B Table 3 before you file."

7. **The card when the note's amounts are missing** (fallback; not in 07, typed in code).
   - Old: "A tax-only note's tax is not in the files. Ask your CA how to report it."
   - **New (Recommended):** "A tax-only note's tax is not in the files. Enter it by hand on the GST portal, then check GSTR-3B Table 3 before you file."

## C. Invoices: a payment received on a proforma (Owner)

8. **Warning: the payment arrived in an earlier month** (`INVT_COPY.previousPeriod`: shown in the dialog and after "issued" in the toast; 07-S §8 `advance_previous_period`). 08-C RA-17: the GST on it belongs to that month (interest under s.50). The new line is the owner-approved 07-ZH line 10, word for word, so the two screens say the same thing.
   - Old: "This payment arrived in an earlier month. The GST on it belongs to that month's return: check with your CA."
   - **New (Recommended):** "This payment arrived in an earlier month. GST on it was due in that month's return; if that return is filed, add it to the next one with interest."

9. **Refusal: the client's GST details changed after the proforma** (`advance_supply_changed`: the server's error, the invoice error list and the proforma panel's note under the disabled button; 07-S error table). 08-C RA-12: refusing is a cautious product choice; the place of supply follows the client's current details.
   - Old: "The client's GST details changed after this proforma was issued, so the tax on this payment can't be worked out from it. Check the client's details with your CA before recording the payment."
   - **New (Recommended):** "The client's GST details changed after this proforma was issued, so the tax on this payment can't be worked out from it. Check the client's GST details. If they are right, issue a new proforma and record the payment on it."
   - Alternative: "… can't be worked out from it. Check the client's GST details before recording the payment." (shorter, but says nothing about what to do if the details are right).

## D. Settings (Owner; the Accountant reads)

10. **Settings › Tax, the E-invoicing switch's hint** (`routes/settings/tax.tsx`; not in 07). 08-C RA-15: e-invoicing applies only once aggregate turnover (every GST registration under the PAN) passes ₹5 crore in any financial year from 2017-18; the yearly turnover check is the owner's April duty (08-C §6).
    - Old: "Off unless your turnover reaches the e-invoicing threshold. Ask your CA."
    - **New (Recommended):** "Leave this off while your turnover (all GST registrations under your PAN) has stayed at ₹5 crore or less in every financial year since 2017-18. Check it each April."

11. **Settings › Terms, the note above the blocks** (`routes/settings/terms.tsx`; 07-W §4 kept it unchanged).
    - Old: "The wording of these blocks is yours and your lawyer's. Confirm it with your CA and a lawyer before documents carry it."
    - **New (Recommended):** "The wording of these blocks is yours. Documents print it word for word, so read a change through before you save it."

12. **Settings › Tax, Payment terms and Retention, the "Researched default" note** (`researchedSettingsText` in `components/form.tsx`; 07-W §4). One text for every settings page; the note no longer names a list.
    - Old: "These defaults follow official sources, researched on 28 October 2026. Questions the sources don't settle are on the list for your CA." (Tax) / "… on the list for your CA and lawyer." (Payment terms, Retention)
    - **New (Recommended):** "These defaults follow official sources, researched on 28 October 2026. Where the sources leave a question open, the default takes the safest reading."
    - Alternative: the same, plus "This isn't tax or legal advice." at the end.
    - The note's tag stays "Researched default" (07-W §4, unchanged).

## E. The rest of the admin (Staff and Sales)

13. **Reports, "isn't built yet" page for Staff and Sales** (`components/shell/nav.tsx`, the Reports item's "arrives" line; not in 07).
    - Old: "Sales, receivables and GST reports, and exports for your CA."
    - **New (Recommended):** "Sales, receivables and GST reports, and the files for your GST returns."

## F. Kept as they are (no change proposed)

These name a CA or a lawyer but are addressed to **the client or a reader**, who may well have one, or they state a decided gate. None of them tells the owner to ask someone.
- Website, Business systems integration FAQ: "It depends on your turnover; your CA confirms it. We build the integration either way." (07-C; the visitor's CA)
- Website, Industries FAQ: "We build software for them every day; your CA stays in charge of tax decisions." (07 §392; the visitor's CA)
- Website, "Who it's for" and the industries page: "CA and accounting firms", "CA firms, finance teams and legal practices" (customer types)
- Catalogue S3 description: "… Legal interpretation comes from your lawyer." (the client's lawyer; S3 is hidden)
- Settings › Flags, the DPDP readiness page: "Stays off until a legal partner is in place." (true: Q-B12 keeps S3 off until a legal partner exists)
- Blog drafts (07-E) and the blog rule "Tax statements say 'confirm with your CA'" (07 §534): addressed to readers
