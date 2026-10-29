// 07-Z (FX-5, docs/07-content-appendix/Z-fx5-pending.md): the lines FX-5 added that no approved 07 page holds, PENDING the owner. Each one shows
// the "[Placeholder] " mark before the recommended words until the owner approves the page; then `APPROVED_07Z` turns true and the marks go
// (the 07-X and 07-Y pattern, copy-x.ts and copy-y.ts). Its own module, so a screen marks its line without loading another screen's words.

export const APPROVED_07Z = false;
export const PLACEHOLDER_MARK = "[Placeholder]";
/** A 07-Z line as the screen shows it: marked until the owner approves 07-Z. */
export const Z = (line: string): string => (APPROVED_07Z ? line : `${PLACEHOLDER_MARK} ${line}`);

/** 07-Z §1 (FX-5, owner decision 2026-10-30, 08-C RA-10): why an invoice or a proforma the client opened in the portal can't be voided. */
export const VOID_VIEWED_COPY = {
  invoice: Z(
    "The client has opened this invoice in the portal, so it can't be voided. Use a credit note instead.",
  ),
  proforma: Z("The client has opened this proforma in the portal, so it can't be voided."),
} as const;
