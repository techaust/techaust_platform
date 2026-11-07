// AU45's new words for the client's statement of account (run file docs/runs/au45-statement.md; drafted in docs/07-content-appendix/ZU-au45-statement.md), in ONE
// place for the statement PDF (`packages/pdf`), the admin Statement tab and its CSV. A gateway refund that came back to us (Stripe `failed` or `canceled` after
// success; Razorpay or PayPal reporting a made refund as failed) is a credit line on the IST day it came back; the "Refund" debit stays on the day it went out.
// Lines U1 and U2 were drafted by the lead under the owner's blanket approval of 2026-11-07 and approved by the main session the same day, so `APPROVED_07ZU` is
// true; the gate (`zu`) stays for any later line. No line is legal wording.

import type { StatementKind } from "./statement.ts";

/** The approval of 07-ZU's lines U1 and U2: approved word for word by the main session under the owner's delegation, 2026-11-07. */
export const APPROVED_07ZU: boolean = true;
const zu = (line: string): string => (APPROVED_07ZU ? line : `[Placeholder] ${line}`);

/** U1: the statement line's label (core `StatementKind` "refund_returned"); the gateway's refund id is printed beside it, as on the "Refund" line. */
export const STATEMENT_REFUND_RETURNED_WORD: string = zu("Refund came back");

/** U2: a note printed once under the lines (the PDF and the admin tab), only when the statement has a U1 line. */
export const STATEMENT_REFUND_RETURNED_NOTE: string = zu(
  "A refund that came back is one the bank or card network returned to us. The amount is your credit again.",
);

/**
 * U2's rule in ONE place (review low 2, AU45): the note, once, when any line of the statement is a refund that came back (`refund_returned`), else null. The
 * statement PDF's view and the admin Statement tab both call it, over every line they show.
 */
export const returnedNoteFor = (entries: readonly { readonly kind: StatementKind }[]): string | null =>
  entries.some((e) => e.kind === "refund_returned") ? STATEMENT_REFUND_RETURNED_NOTE : null;

/** Every 07-ZU line, for the gate's test. */
export const zuAllText = (): readonly string[] => [
  STATEMENT_REFUND_RETURNED_WORD,
  STATEMENT_REFUND_RETURNED_NOTE,
];
