# 07-ZU: AU45, the statement's "refund returned" line

Status: **drafted by the lead, 2026-11-07, under the owner's blanket approval of 2026-11-07 (13: "AU45 … its wording drafted by the lead under this approval"); awaiting the main session's approval.** Until it is approved the code prints "[Placeholder] " before each line (`APPROVED_07ZU` in `packages/core/src/copy-zu.ts`). English (India/UK spelling), "and" never "&", no banned phrases (07 §1.3), sentence case.

When: a gateway refund we made (07-ZO line 17, "Refund", a debit on the statement) later comes back to us (Stripe reports it `failed` or `canceled` after success; Razorpay or PayPal report a made refund as failed). The client has already had the email 07-ZT C1–C3. The money is the client's credit again, so the statement shows a credit line on the IST day it came back. The original "Refund" line stays on the day it went out, so a statement that ended before the return never changes and every statement's closing balance is the next one's opening balance. Never shown for a lost dispute or an anonymised client.

Where: the statement of account PDF (layout `statement-5`), the admin client's Statement tab (staff see the client's words), and the statement CSV if it carries line kinds.

## Lines
- **U1** the line's label (beside it, the refund's reference, as on the "Refund" line): "Refund returned"
  - Recommendation: approve as written. It pairs with "Refund" in the same column and fits the narrow label column on a phone and in the PDF. Alternative: "Refund returned to your credit" (says where the money went, but wraps to two lines in the PDF's label column).
- **U2** a note printed once under the statement's lines, only when the statement has a U1 line: "A refund returned is one the bank or card network sent back to us. The amount is your credit again."
  - Recommendation: approve as written (it explains the credit without a promise of timing; 07-ZT C3 already tells the client we will contact them). Alternative: leave the note out and rely on the 07-ZT email.
