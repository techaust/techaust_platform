# 07-Z: new lines from FX-5 (for the owner's approval)

Status: **PENDING the owner** (drafted by the FX-5 builder, 2026-10-30). Every line below shows "[Placeholder]" on screen until you approve this page. Then one switch (`APPROVED_07Z` in `apps/admin/src/lib/copy-z.ts`) removes the marks.

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
