// 07-ZI (docs/07-content-appendix/ZI-m6.2-razorpay.md): Pay now through Razorpay [POR-06, ADM-PAY-02, ADM-PAY-12], client lines 1 to 16 APPROVED by the owner
// on 2026-11-01 (as drafted), word for word. `{slots}` are filled by the screen with core-formatted amounts and the page's dates. Lines 17 to 19 are Razorpay's
// own page description, written by the finance Worker, not here. No line names a card or bank field: there are none (ADM-PAY-12).

export const PAY_ZI = {
  /** Line 1: the button. */
  payNow: "Pay now",
  /** Line 2: the dialog's question (its title). */
  howMuch: "How much would you like to pay?",
  /** Line 3: the first choice. */
  full: (amount: string) => `The full amount due (${amount})`,
  /** Line 4: the second choice. */
  part: (minimum: string) => `Part of it (at least ${minimum})`,
  /** Line 5: the part amount's hint, and its error when it can't be read. */
  between: (minimum: string, balance: string) => `Enter an amount between ${minimum} and ${balance}.`,
  /** Line 6: under the minimum / over the balance. */
  atLeast: (minimum: string) => `Enter an amount of at least ${minimum}.`,
  tooMuch: (balance: string) => `That's more than the amount due (${balance}).`,
  /** Line 7: a proforma is paid in whole rupees (LD28). */
  wholeRupees: "Enter a whole number of rupees.",
  /** Line 8: the dialog's action. */
  continue: "Continue to Razorpay",
  /** Line 9: under the choices. */
  howItWorks:
    "You'll pay on Razorpay's page by UPI, card or netbanking. We never see your card or bank details.",
  /** Line 10: back from Razorpay, while the payment is checked. */
  checking: "Checking your payment…",
  checkingBody:
    "This usually takes under a minute. You can close this page; the invoice will show the payment once it's confirmed.",
  /** Line 11: received (a tax invoice or debit note). */
  received: (amount: string) => `Thank you. We've received ${amount}.`,
  /** Line 12: received on a proforma. */
  receivedProforma: (amount: string) =>
    `Thank you. We've received ${amount}. Your tax invoice for this payment is being prepared and will appear under Invoices.`,
  /** Line 13: no confirmation yet after a minute. */
  notYet:
    "We haven't had confirmation from Razorpay yet. If money left your account, it will show here once Razorpay confirms it. There's no need to pay again.",
  /** Line 14: online payment can't go ahead. */
  unavailable:
    "Online payment isn't available right now. You can pay by bank transfer using the details on the invoice.",
  /** Line 15: back from Razorpay on the signed-out return page. */
  returned:
    "Thank you. If your payment went through, it will show on the invoice within a few minutes. Open the link in our email again to see it.",
  /** Line 16: a proforma with an online payment waiting for its tax invoice. */
  proformaPaid: (date: string) => `Paid online on ${date}; tax invoice to follow`,
} as const;
