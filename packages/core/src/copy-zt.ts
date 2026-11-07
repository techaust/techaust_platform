// The M6–M7 audit's new words for the money core (run file docs/runs/full-audit-m6-m7.md, lead's triage AU1; drafted in docs/07-content-appendix/ZT-audit-money.md),
// in ONE place for the jobs Worker and the email template. The CLIENT lines (C1 to C3: the email about a refund that came back) are the owner's: until the owner
// approved them word for word on 2026-11-07, so `APPROVED_07ZT` is true and the jobs Worker sends `refund.reversed` (the gate `refundReversedCopyGate`, the
// `refundCopyGate` pattern, stays for any later line). The staff lines (the review reason, the receipt bells, the Withdraw line) live with their screens and
// are the lead's under the owner's delegation. No line is legal wording.

/** The owner's approval of 07-ZT's client lines C1 to C3: approved word for word by the owner, 2026-11-07. */
export const APPROVED_07ZT: boolean = true;
const zt = (line: string): string => (APPROVED_07ZT ? line : `[Placeholder] ${line}`);

/** `refund.reversed` (C1 to C3): the refund came back to us, so the money is the client's credit again. */
export const REFUND_REVERSED_COPY = {
  /** C1 */
  subject: (amount: string, documentNumber: string) =>
    zt(`Your refund of ${amount} for ${documentNumber} came back to us`),
  /** C2 */
  body: (firstName: string, amount: string, documentNumber: string) =>
    zt(
      `Hi ${firstName}, the refund of ${amount} for ${documentNumber} was returned to us by the bank or card network, so it didn't reach you. The amount is held as credit on your account.`,
    ),
  /** C3 */
  next: zt(
    "We'll contact you to agree how to send it again. Reply to this email if your bank details have changed.",
  ),
  /** The existing portal button label (07-ZQ C4). */
  button: "View invoice",
} as const;

/** The template's name in Settings › Email (staff line, the lead's). */
export const AUDIT_TEMPLATE_NAMES = { "refund.reversed": "Refund came back (client)" } as const;
