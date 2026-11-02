// M6.4 PayPal: the staff lines of the admin screens [ADM-PAY-01, ADM-PAY-07, ADM-INV-17, ADM-SET-06; run file docs/runs/m6.4-paypal.md G3 to G7, H]. Staff-only
// words: S1, S2, S8 and S9 are the brief's (section H, S9 as the lead's triage of early check 2 words it), approved by the lead under the owner's delegation once
// placed (07-ZN "Staff lines"). Everything under "designer's drafts" is what the brief lacked: drafted by the designer in the same plain style, unmarked (the M6.2
// `GW_UI` pattern, so the screens read as they will) and listed in the run file's designer report for the lead. S3 to S7 and S10 are the Workers' (review reasons
// in `worker/gateway/reasons.ts`, the bells in the jobs Worker); S11 is the finance Worker's API messages. Pure, so the words are tested without a browser.
import type { AdviceKind, AdviceProvider, WithoutAdviceProvider } from "../api.ts";

// ---- the brief's lines (S1, S2, S8, S9) ---------------------------------------------------------------------------------------------------------------------

export const ZN = {
  // S2
  checkNow: "Check now",
  // S8
  advices: "Remittance advices",
  addAdvice: "Add advice",
  linkPayments: "Link payments",
  removeLink: "Remove link",
  withoutAdvice: "Without advice",
  noAdvices: "No advices yet.",
  // S9 (the page's lede; the bell's words are the jobs Worker's)
  advicesLede: "PayPal keeps these advices for a limited time. Download each one and add it here.",
} as const;

// ---- designer's drafts for the lead (2026-11-02; staff-only) ------------------------------------------------------------------------------------------------

export const ZN_UI = {
  // G3: the PayPal slip on a USD document's Payments panel
  payPalTitle: "PayPal",
  payPalBody:
    "Clients pay with PayPal from their portal page or the emailed invoice link. Each PayPal checkout lasts 3 hours, so there is nothing to copy here.",
  cancelCheckout: "Cancel checkout",
  cancelTitle: "Cancel this PayPal checkout?",
  cancelBody:
    "The client can no longer pay through it, and nothing is charged. They can start again from their portal page.",
  keepCheckout: "Keep checkout",
  cancelled: "PayPal checkout cancelled.",
  earlier: "Earlier PayPal checkouts",
  checking: "Checking…",
  /** "Check now"'s answer, by core's `REFRESH_RESULTS`. */
  checked: {
    processed: "Checked with PayPal. The payments below are up to date.",
    unchanged: "Checked with PayPal. Nothing has changed yet.",
    too_soon: "Checked less than a minute ago. Try again in a minute.",
    no_open_link: "This PayPal checkout is no longer open.",
    needs_review: "Checked with PayPal. The payment needs review.",
    retry: "PayPal couldn't be reached. Try again.",
  } as Record<string, string>,
  checkedOther: "Checked with PayPal.",

  // G5: Remittance advices
  tabAdvices: "Advices",
  withoutCount: (n: number) => (n === 1 ? "1 payment without an advice" : `${n} payments without an advice`),
  withoutLede:
    "Confirmed payments that no advice proves yet. Add the advice, then link these payments to it.",
  noneWithout: "Every payment here is on an advice.",
  colIssued: "Issued",
  colAdvice: "Advice",
  colGateway: "From",
  colPeriod: "Period",
  colInrTotal: "INR total",
  colPayments: "Payments",
  colFile: "File",
  colReceived: "Received",
  colClient: "Client",
  colReference: "Reference",
  colAmount: "Amount",
  colLink: "On advice",
  fileAwaited: "File awaited",
  openFile: "Open file",
  attachFile: "Attach file",
  open: "Open",
  showMore: "Show more",
  periodText: (from: string, to: string) => `${from} to ${to}`,
  periodFrom: (from: string) => `From ${from}`,
  periodTo: (to: string) => `To ${to}`,
  paymentsCount: (n: number) => (n === 1 ? "1 payment" : `${n} payments`),

  // the "Add advice" form
  formIntro: "All fields are needed unless marked optional.",
  provider: "Who issued it",
  kind: "Kind of advice",
  ref: "Advice reference",
  refHint: "As printed on the advice. Up to 64 characters.",
  issuedOn: "Issued on",
  periodFromLabel: "Period from",
  periodToLabel: "Period to",
  inrTotal: "INR total",
  inrTotalHint: "As printed on the advice. For the register only; never used for GST.",
  inrTotalZero: "Enter an amount above zero, or leave it empty.",
  note: "Note",
  file: "The advice's file",
  refMissing: "Enter the advice's reference.",
  issuedMissing: "Enter the day the advice was issued.",
  issuedFuture: "The advice can't be issued after today.",
  periodOrder: "The period can't end before it starts.",
  added: "Advice added.",
  fileSaved: "File attached.",

  // the advice's own dialog
  detailTitle: "Remittance advice",
  recorded: "Added",
  onAdvice: "Payments on this advice",
  noneLinked: "No payments are linked yet.",
  removedLine: (date: string, reason: string) => `Removed ${date}: ${reason}`,
  removedTag: "Removed",
  linked: (n: number) => (n === 1 ? "1 payment linked." : `${n} payments linked.`),
  removed: "Link removed.",
  close: "Close",

  // "Link payments"
  linkLede: (who: string) =>
    `Pick the payments this advice proves. Only confirmed ${who} on no advice are listed.`,
  linkWho: {
    paypal: "PayPal payments",
    stripe: "Stripe payments",
    bank: "bank transfers from abroad",
  } as Record<AdviceProvider, string>,
  selectAll: "Select all shown",
  clearAll: "Clear selection",
  selected: (n: number) => (n === 1 ? "1 selected" : `${n} selected`),
  pick: (what: string) => `Link ${what}`,
  noneToLink: "No payments are waiting for an advice of this kind.",
  atMost: (n: number) => `At most ${n} at a time. Link these, then the rest.`,
  pickOne: "Pick at least one payment.",

  // "Remove link" (the Owner)
  removeBody:
    "The payment goes back to the payments without an advice. The link stays in this advice's history with your reason.",
  removeReason: "Why it is removed",
  removeReasonHint: "Up to 200 characters.",
  removeReasonMissing: "Enter why it is removed.",

  // the payment's entry dialog
  adviceLabel: "Remittance advice",
  adviceNone: "Not on an advice yet",

  // the erase dialog (08-C RB-40 note, lead 2026-11-02: kept as the proof of export realisation)
  eraseKeepsAdvices:
    "Remittance advice files stay as well: they may name the person who paid, and they are kept as the proof that export payments arrived.",
} as const;

/** The advice kinds in words (the names the banks and PayPal print). */
export const ADVICE_KIND_LABELS: Record<AdviceKind, string> = {
  efira: "e-FIRA",
  fira: "FIRA",
  firc: "FIRC",
  brc: "BRC",
  settlement_report: "Settlement report",
  other: "Other",
};

/** Who issued the advice. */
export const ADVICE_PROVIDER_LABELS: Record<AdviceProvider, string> = {
  paypal: "PayPal",
  stripe: "Stripe",
  bank: "Bank",
};

/** The "Without advice" filter: a gateway, or the bank transfers from abroad a bank advice proves. */
export const WITHOUT_PROVIDER_LABELS: Record<WithoutAdviceProvider, string> = {
  paypal: "PayPal",
  stripe: "Stripe",
  manual: "Bank transfers from abroad",
};
