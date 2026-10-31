// 07-ZL (docs/07-content-appendix/ZL-polish-sweep.md): the staff-facing lines of the polish sweep [ADM-DASH-01, ADM-AUD-02], DRAFT, waiting for the
// main session's approval under the owner's delegation. Each one shows the "[Placeholder] " mark before the words until the page is approved; then
// `APPROVED_07ZL` turns true and the marks go (the 07-X, 07-Y and 07-Z pattern, copy-y.ts). Its own module, so a screen marks its line without loading
// another screen's words. Pure, so the words are tested without a browser (copy-zl.test.ts reads the 07-ZL file).

export const APPROVED_07ZL = false;
export const PLACEHOLDER_MARK = "[Placeholder]";
/** A 07-ZL line as the screen shows it: marked until 07-ZL is approved. */
export const ZL = (line: string): string => (APPROVED_07ZL ? line : `${PLACEHOLDER_MARK} ${line}`);

/** Lines 1 and 2: the activity feed's and the audit log's words for `invoice.issue` when the issued document is a note (`issuedText` in audit.ts). */
export const NOTE_ISSUED = {
  credit_note: ZL("issued a credit note"),
  debit_note: ZL("issued a debit note"),
} as const;

/** Line 3: the notifications bell's name over 9 unread (the badge shows "9+"; up to 9 the name keeps the exact count). */
export const BELL_OVER_NINE = ZL("Notifications, 9+ unread");
