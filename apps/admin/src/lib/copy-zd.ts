// 07-ZD (docs/07-content-appendix/ZD-notes-deadline-lut-ims.md), APPROVED by the owner on 2026-10-31, word for word: the credit-note deadline by GSTR-1
// filing frequency (T1), the debit note's LUT (T2) and IMS in the 3B helper (T3) [ADM-INV-11, ADM-INV-18, ADM-REP-04, ADM-SET-03]. Staff-facing. These
// lines replace the 07-T §4 banner lines that named "30 November" and "Talk to your CA". A `{brace}` of 07-ZD is a parameter here. Where a count or a
// number of days is 1, the line is said in its singular, as the admin's other counted lines are (07-T's deadline line, the notes' balance line).
// Pure, so the words are tested without a browser.

/** Line 1: Settings › Tax. The option values are core's `GSTR1_FREQUENCIES` ("quarterly" first, the default: owner, 2026-10-31). */
export const GSTR1_FILING_COPY = {
  label: "GSTR-1 filing",
  options: { quarterly: "Quarterly (QRMP scheme)", monthly: "Monthly" },
  hint: "Sets the last day for credit notes on last year's invoices: 31 October for GST-registered clients, and 30 September for other clients if you file quarterly.",
} as const;

/** Line 9: Settings › Tax, the "Credit note cut-off" hint (lead, 2026-10-31, staff-only wording under the owner's delegation; replaces the earlier one). */
export const CN_CUTOFF_HINT =
  "Credit notes on last year's invoices are blocked after the last GST return period that ends before this date (see GSTR-1 filing below).";

/** Line 2, the note banner before the deadline: `lastDay` the last day a credit note may be dated, `returnBy` the day its return must be filed by. */
export const deadlineBeforeLine = (lastDay: string, returnBy: string) =>
  `Issue any credit note for this invoice by ${lastDay}, so it goes into a GST return filed by ${returnBy}.`;

/** Line 3, the quarterly basis: only when the note goes in the quarterly GSTR-1 (the server's `period` is "quarter"). */
export const DEADLINE_QUARTER_LINE =
  "This client isn't GST registered, so the note goes in your quarterly GSTR-1, not a monthly IFF.";

/** Line 4, the warning (one day in its singular). */
export const deadlineWarnLine = (days: number) =>
  days === 1
    ? "Only 1 day left to issue a credit note on this invoice."
    : `Only ${days} days left to issue a credit note on this invoice.`;

/** Line 5, after the deadline. */
export const deadlinePassedLine = (lastDay: string) =>
  `The last day for a credit note on this invoice was ${lastDay}. A refund now can't reduce the GST already paid.`;

/** Line 6, the issue blocker `debit_lut_missing`: `fy` is the FY label ("2027-28") of the debit note's date. */
export const debitLutMissingLine = (fy: string) =>
  `This debit note is dated in FY ${fy} and the invoice was exported under LUT. Save your LUT for FY ${fy} in Settings › Tax first.`;

/** Line 7, the held row of the GSTR-3B summary (the CSV's words, core `gstr3b-summary-v2`; the screen's 3B table shows the same row). */
export const IMS_HELD_ROW = "Credit notes to registered clients not yet accepted in IMS (not deducted)";

/** Line 8, Reports › GSTR-3B: how many credit notes are held back (one in its singular). */
export const imsHeldLine = (count: number) =>
  count === 1
    ? "1 credit note isn't deducted until your client accepts it in IMS. Check the GST portal's GSTR-3B figures before you file."
    : `${count} credit notes aren't deducted until your client accepts them in IMS. Check the GST portal's GSTR-3B figures before you file.`;
