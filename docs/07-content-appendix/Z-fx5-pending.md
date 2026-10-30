# 07-Z: new lines from FX-5 (for the owner's approval)

Status: **APPROVED by the owner, 2026-10-30** ("The four new screen lines (07-Z): Yes"). The switch `APPROVED_07Z` in `apps/admin/src/lib/copy-z.ts` is on, so no line shows "[Placeholder]".

**How to answer:**
- "Approve all";
- or "Approve all except N, M", giving your wording for those;
- or "Change N to …".

The text after each number is the recommendation. Staff-facing (admin) unless marked.

---

## 1. Void after a portal view (owner decision 2026-10-30, docs/13; 08-C RA-10)
An invoice or proforma the client has opened in the portal can no longer be voided. These lines say why, on the invoice's page and in the void dialog.

1. Invoice: "The client has opened this invoice in the portal, so it can't be voided. Use a credit note instead."
2. Proforma: "The client has opened this proforma in the portal, so it can't be voided."

## 2. Proposal terms and the due days (full audit C4)
The proposal terms are one text shared by every proposal, so the number of days to pay that they state must be the one in Settings › Payment terms. Saving terms with another number is refused; changing the setting first is allowed, and Settings › Payment terms then says the terms disagree. `{days}` is "7 days" (or "1 day"; two numbers are joined with "and").

3. Settings › Terms, the save is refused: "These terms say invoices are due within {days}, but Settings › Payment terms says {days}. Change the number here, or change Payment terms first."
4. Settings › Payment terms, while the newest proposal terms state other days: "Your proposal terms say invoices are due within {days}. Save a new version in Settings › Terms so they match."
