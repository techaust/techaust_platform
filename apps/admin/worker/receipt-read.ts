// M6.5 (ADM-PAY-09, L34): `GET /payments/:id/receipt`, a payment's receipt (number, day, status, PDF state; `payments.read`), in the finance Worker beside the
// payment (plain SQL: none of the issue code; the receipt's issue and PDF routes are the invoices Worker's, receipt-issue.ts). `{ receipt: null }` while the
// payment has none ("Receipt being prepared" on the screen). `refundedInFull` (M7.2 review 1, finding 5) tells the screen to hide "Send receipt again".
import { RECEIPT_OF_PAYMENT_SQL } from "@techaust/db/receipts";
import { Hono } from "hono/tiny";
import type { AppEnv } from "./context.ts";
import { idParam, param } from "./http.ts";

type ReceiptRow = {
  id: string;
  number_display: string | null;
  issue_date: string | null;
  status: string;
  has_pdf: number;
  voided_at: number | null;
  refunded_in_full: number;
};

export const paymentReceipt = new Hono<AppEnv>().get("/:id/receipt", param(idParam), async (c) => {
  const { id } = c.req.valid("param");
  const r = await c.env.DB.prepare(RECEIPT_OF_PAYMENT_SQL).bind(id).first<ReceiptRow>();
  if (!r) return c.json({ receipt: null });
  return c.json({
    receipt: {
      id: r.id,
      number: r.number_display,
      issueDate: r.issue_date,
      status: r.status,
      hasPdf: r.has_pdf === 1,
      voidedAt: r.voided_at,
      /** M7.2 review 1, finding 5: the payment's money has all gone back; "Send receipt again" is refused (409 `receipt_refunded`), so the screen hides it. */
      refundedInFull: r.refunded_in_full === 1,
    },
  });
});
