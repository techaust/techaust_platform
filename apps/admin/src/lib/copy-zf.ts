// 07-ZF (docs/07-content-appendix/ZF-proforma-withdraw.md): withdrawing a proforma the client has already received [ADM-INV-10], APPROVED by the owner on
// 2026-10-31 (lines 1 to 20; line 21, an email, dropped). Staff-facing lines 1 to 17, word for word. Each one shows the "[Placeholder] " mark before the
// words until the owner approves the page; then `APPROVED_07ZF` turns true and the marks go (the 07-X, 07-Y and 07-Z pattern, copy-z.ts). A `{brace}` of
// 07-ZF is a parameter here. Its own module, so a screen marks its line without loading another screen's words. Pure, so the words are tested without a
// browser (copy-zf.test.ts reads the 07-ZF file).

export const APPROVED_07ZF = true;
export const PLACEHOLDER_MARK = "[Placeholder]";
/** A 07-ZF line as the screen shows it: marked until the owner approves 07-ZF. */
export const ZF = (line: string): string => (APPROVED_07ZF ? line : `${PLACEHOLDER_MARK} ${line}`);

/** A reason typed with its own closing mark keeps it; any other gets the line's full stop (07-ZF 7's "{reason}."). */
const sentenceEnd = (reason: string) => (/[.!?]$/.test(reason.trim()) ? "" : ".");

/** The withdraw action, its dialog, its toast, the banner and the badge (07-ZF 1 to 9). */
export const WITHDRAW_COPY = {
  /** Line 1: the action on the invoice page (the More menu, where Void is). */
  button: ZF("Withdraw proforma"),
  /** Line 2. */
  title: (number: string) => ZF(`Withdraw proforma ${number}`),
  /** Line 3. */
  body: ZF(
    "The client has already received this proforma, so it can't be voided. Withdrawing takes it back: it keeps its number and stays in your records, the client sees it as withdrawn in the portal, and its reminders stop. You can withdraw it only while nothing has been paid against it and no invoice has been made from it.",
  ),
  /** Line 4: the 07-ZA line 18 label (a proforma's void dialog), and the empty reason's line. */
  reasonLabel: ZF("Reason (required, kept with the proforma)"),
  reasonEmpty: ZF("Enter a reason for withdrawing."),
  /** Line 5. */
  confirm: ZF("Withdraw proforma"),
  /** Line 6 (the existing milestone line follows it). */
  toast: (number: string) => ZF(`Proforma ${number} withdrawn.`),
  /** Line 7: the banner of a withdrawn proforma. */
  banner: (date: string, name: string, reason: string) =>
    ZF(
      `Withdrawn ${date} by ${name}: ${reason}${sentenceEnd(reason)} The client sees it as withdrawn in the portal.`,
    ),
  /** Line 8: the status badge. */
  badge: ZF("Withdrawn"),
  /** Line 9: the audit log and the activity rows. */
  audit: ZF("withdrew a proforma"),
} as const;

/** Lines 10 to 14: a refused withdrawal, by the API's code (core `WITHDRAW_BLOCKER_CODES`, and the route's `withdraw_proforma_only`). */
export const WITHDRAW_ERRORS = {
  already_withdrawn: ZF("This proforma is already withdrawn."),
  proforma_paid: ZF("This proforma can't be withdrawn because a payment has been recorded against it."),
  proforma_converted: ZF("This proforma can't be withdrawn because an invoice has been made from it."),
  not_delivered: ZF("This proforma hasn't reached the client yet, so void it instead."),
  not_proforma: ZF("Only an issued proforma can be withdrawn."),
  withdraw_proforma_only: ZF("Only an issued proforma can be withdrawn."),
  already_void: ZF("Only an issued proforma can be withdrawn."),
  not_issued: ZF("Only an issued proforma can be withdrawn."),
} as const;

/** Lines 15 and 16: why a proforma the client has received can't be voided (they replace 07-Z §1's proforma line and the emailed-proforma line). */
export const VOID_DELIVERED_PROFORMA = {
  viewed: ZF(
    "The client has opened this proforma in the portal, so it can't be voided. Withdraw it instead.",
  ),
  emailed: ZF("This proforma has been emailed to the client, so it can't be voided. Withdraw it instead."),
} as const;

/** Line 17: the end of 07-ZA §10's locked banner on an issued proforma (its first two sentences unchanged). */
export const PROFORMA_LOCKED_END = ZF(
  "If it's wrong and nothing has been paid or converted, void it if the client hasn't received it yet, or withdraw it if they have, then issue a new one.",
);
