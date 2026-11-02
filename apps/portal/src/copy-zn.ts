// 07-ZN (docs/07-content-appendix/ZN-m6.4-paypal.md): the portal's client lines of Pay with PayPal [POR-06, M6.4]. Lines 1 to 14, owner-approved word for word
// (2026-11-02); lines 4, 5, 6 and 12 reuse lines approved earlier (07-ZI 10 and 11, 07-ZM 7 and 6), so they are those constants, not copies. Line 15 is sent
// to PayPal by the finance Worker (core `paypal.ts`), not shown here. copy-zn.test.ts reads the page, so a change made there and not here fails.
import { PAY_ZI } from "./copy-zi.ts";
import { PAY_ZM } from "./copy-zm.ts";

export const PAY_ZN = {
  /** Line 1: the button on a USD document, after "Pay by card" (`online.providers` order). */
  payWithPayPal: "Pay with PayPal",
  /** Line 2: the dialog's button. */
  continue: "Continue to PayPal",
  /** Line 3: the dialog's note. */
  howItWorks: "You'll pay on PayPal's page. We never see your card or bank details.",
  /** Line 4 (07-ZI 10): back from PayPal while the capture is checked (`processing`). */
  checking: PAY_ZI.checking,
  checkingBody: PAY_ZI.checkingBody,
  /** Line 5 (07-ZI 11): received (an export invoice or a debit note). */
  received: PAY_ZI.received,
  /** Line 6 (07-ZM 7): received on a proforma. */
  receivedProforma: PAY_ZM.receivedProforma,
  /** Line 7: back from PayPal's page without paying (`not_completed`, or the cancel return). */
  notCompleted: "You left PayPal before paying. Nothing was charged.",
  /** Line 8: PayPal declined the payment method; the button only with PayPal's own page for the same order (`retryUrl`). */
  declined: "PayPal declined that payment method. You haven't been charged.",
  tryAgain: "Try again on PayPal",
  /** Line 9: the order expired before it was captured. */
  expired: "This PayPal payment has expired. Nothing was charged. Start again to pay.",
  /** Line 10: PayPal holds the capture (`pending`; also the 409 `payment_processing` of PayPal and the waiting state). */
  pending:
    "PayPal is still checking this payment. It will show on this invoice once PayPal completes it. There's no need to pay again.",
  /** Line 11: the amount due changed after the client started; nothing captured. */
  changed:
    "We couldn't take this payment because the amount due has changed since you started. Nothing was charged. Please start again.",
  /** Line 12 (07-ZM 6): above the online maximum (the dialog's line). */
  maximum: PAY_ZM.maximum,
  /** Line 13: PayPal can't be used right now (the return route's 503; the server's words on a refused press). */
  unavailable: "PayPal isn't available right now. You can pay another way shown on this page.",
  /** Line 14: the summary's rows (a proforma's payment waits for its invoice). */
  paid: (date: string) => `Paid by PayPal on ${date}`,
  paidProforma: (date: string) => `Paid by PayPal on ${date}; invoice to follow`,
} as const;
