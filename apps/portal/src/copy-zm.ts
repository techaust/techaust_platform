// 07-ZM (docs/07-content-appendix/ZM-m6.3-stripe.md): the portal's client lines of Pay by card [POR-06, M6.3]. Lines 1 to 8, owner-approved word for word
// (2026-11-01, Q4 A); lines 9 to 12 are sent to Stripe by the finance Worker (apps/admin/worker/gateway/stripe-links.ts and core `stripe.ts`). Each line shows the
// "[Placeholder] " mark while `APPROVED_07ZM` is false (the copy-zi.ts pattern); the screens are the designer's (run file G), these words are what they show.
// 07-ZI lines 2 to 6, 10, 11 and 14 are reused for Stripe as they are (currency-neutral): `PAY_ZI` in copy-zi.ts.

// APPROVED by the owner, 2026-11-01 (run file m6.3-stripe, Q4 A).
export const APPROVED_07ZM: boolean = true;
const ZM = (line: string): string => (APPROVED_07ZM ? line : `[Placeholder] ${line}`);

export const PAY_ZM = {
  /** Line 1: the button on an eligible USD document. */
  payByCard: ZM("Pay by card"),
  /** Line 2: the dialog's button. */
  continue: ZM("Continue to Stripe"),
  /** Line 3: the dialog's note. */
  howItWorks: ZM(
    "You'll pay by card on Stripe's page. Stripe asks for the cardholder's name and billing address. We never see your card details.",
  ),
  /** Line 4: not confirmed yet (also the 409 `payment_processing` answer). */
  notYet: ZM(
    "We haven't had confirmation from Stripe yet. If your card was charged, the payment will show here once Stripe confirms it. There's no need to pay again.",
  ),
  /** Line 5: back from Stripe's page without paying (`?pay=cancel`). */
  cancelled: ZM("You left Stripe's page. If you didn't finish paying, you can try again."),
  /** Line 6: above the online maximum (provider-neutral; M6.4 reuses it). */
  maximum: (maximum: string) =>
    ZM(
      `Online payments are limited to ${maximum} at a time. Pay part now and the rest later, or pay by bank transfer.`,
    ),
  /** Line 7: a USD proforma's payment received. */
  receivedProforma: (amount: string) =>
    ZM(
      `Thank you. We've received ${amount}. The invoice for this payment will follow and will appear under Invoices.`,
    ),
  /** Line 8: the USD proforma's line. */
  proformaPaid: (date: string) => ZM(`Paid by card on ${date}; invoice to follow`),
} as const;
