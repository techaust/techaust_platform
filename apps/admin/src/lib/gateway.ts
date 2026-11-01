// The words and the pure rules of the M6.2 Razorpay staff screens (ADM-PAY-02, ADM-PAY-06, ADM-PAY-07, ADM-INV-10, ADM-SET-06, ADM-G-09): the invoice's online
// payments and its Payment link card, the "Needs review" tab, Settings › Gateways.
//
// Copy: 07-ZI S17 to S24 (docs/07-content-appendix/ZI-m6.2-razorpay.md), staff-only, approved by the lead under the owner's delegation, used word for word. The
// review reasons are `apps/admin/worker/gateway/reasons.ts` (one copy for the bells and this list). Lines marked "designer's draft" are what 07-ZI lacked; the run
// file lists them for the lead. Money is formatted only through core; nothing here adds up an amount.
import { divRoundHalfUp, formatMoney, money } from "@techaust/core/money";
import { type NotPayableReason, onlineMinimumOf } from "@techaust/core/online-pay";
import { advanceBlockerWords, notPayableWords, reviewReason } from "../../worker/gateway/reasons.ts";
import type { PaymentLinkStatus, ReviewItem, ReviewResolution } from "../api.ts";
import { RequestError } from "../api.ts";
import type { PillTone } from "../components/display.tsx";
import { CARD_ZM, ZM } from "./copy-zm.ts";
import { blockerLine } from "./invoices.ts";
import { amountText, MODE_LABELS, payErrorText } from "./payments.ts";
import { PORTAL_ORIGIN } from "./portal-origin.ts";

export type { NotPayableReason };
export { notPayableWords, reviewReason };

// ---- 07-ZI S17 to S23 (approved) -------------------------------------------------------------------------------------------------------------------------

export const GW = {
  // S17
  link: "Payment link",
  createLink: "Create payment link",
  copyLink: "Copy link",
  cancelLink: "Cancel link",
  expires: (date: string) => `Expires ${date}`,
  // S18
  feeAbsorbed: (amount: string) => `Fee ${amount} (absorbed)`,
  // S19
  needsReview: "Needs review",
  nothingToReview: "Nothing needs review.",
  // S21
  markResolved: "Mark as resolved",
  tryAgain: "Try again",
  openPayment: "Open payment",
  // S23
  keys: "Keys",
  keysConfigured: "Configured",
  keysMissing: "Missing",
  lastWebhook: "Last verified webhook",
  noWebhook: "No webhook received yet",
} as const;

/** S17's chips, by the link's status ("Replaced" is a stale link: a newer one took its place). `creating` and `failed` are the designer's drafts. */
export const LINK_CHIPS: Record<
  PaymentLinkStatus,
  { label: string; tone: PillTone; icon: "check" | "clock" | "ban" | "undo" | "alert" | "progress" }
> = {
  live: { label: "Live", tone: "info", icon: "clock" },
  paid: { label: "Paid", tone: "success", icon: "check" },
  expired: { label: "Expired", tone: "muted", icon: "ban" },
  cancelled: { label: "Cancelled", tone: "muted", icon: "ban" },
  stale: { label: "Replaced", tone: "muted", icon: "undo" },
  // designer's drafts (a link being made, a link Razorpay refused to make)
  creating: { label: "Being made", tone: "neutral", icon: "progress" },
  failed: { label: "Not made", tone: "danger", icon: "alert" },
};

/** S18: "Razorpay · {method} · {payment id}" (the raw `pay_…` id, as Razorpay's dashboard shows it). */
export const razorpayLine = (mode: string | null, providerPaymentId: string | null): string =>
  [
    "Razorpay",
    mode && Object.hasOwn(MODE_LABELS, mode) ? MODE_LABELS[mode as keyof typeof MODE_LABELS] : null,
    providerPaymentId,
  ]
    .filter(Boolean)
    .join(" · ");

// ---- M6.3: Stripe (07-ZM S13 to S15; marked until the lead approves the placed page) ------------------------------------------------------------------

/** S14: "Stripe · card · {payment id}" (the `pi_…` id as Stripe's dashboard shows it); without an id, its first two parts. */
export const stripeLine = (providerPaymentId: string | null): string =>
  providerPaymentId ? CARD_ZM.paymentRow(providerPaymentId) : ZM("Stripe · card");

/** The line of a gateway payment by its gateway: S14 for Stripe, 07-ZI S18 for Razorpay. */
export const gatewayLine = (
  provider: string,
  mode: string | null,
  providerPaymentId: string | null,
): string => (provider === "stripe" ? stripeLine(providerPaymentId) : razorpayLine(mode, providerPaymentId));

/** The gateway's own name (a proper name, not copy): the "Recorded by" of a gateway entry and the gateway column of "Needs review". */
export const gatewayName = (provider: string | null | undefined): string =>
  provider === "stripe" ? "Stripe" : provider === "paypal" ? "PayPal" : "Razorpay";

/**
 * S14's "about ₹{rate} per USD": the INR Stripe credited over the dollars paid, worked out in bigint to the paisa (round half up, core `divRoundHalfUp`), never
 * from a stored float (L10). Both figures are minor units with two decimals, so paise over cents is rupees per dollar. Null when the dollars are not above 0.
 */
export function inrPerUsdText(inrReceivedMinor: number, usdMinor: number): string | null {
  if (!Number.isSafeInteger(inrReceivedMinor) || !Number.isSafeInteger(usdMinor) || usdMinor <= 0)
    return null;
  const paise = divRoundHalfUp(BigInt(inrReceivedMinor) * 100n, BigInt(usdMinor));
  const n = Number(paise);
  return Number.isSafeInteger(n) ? formatMoney(money(n, "INR"), { symbol: false }) : null;
}

/**
 * S14's two fact lines of a Stripe payment, when Stripe settled it in INR: what it credited (with the rate it implies) and its fee with the GST in it (or 07-ZI
 * S18's "Fee {amount} (absorbed)" when Stripe gave no tax part). Empty for any other payment.
 */
export function stripeFacts(r: {
  provider: string;
  amountMinor: number;
  inrReceivedMinor?: number | null | undefined;
  gatewayFeeInrMinor?: number | null | undefined;
  gatewayFeeTaxInrMinor?: number | null | undefined;
}): string[] {
  if (r.provider !== "stripe") return [];
  const out: string[] = [];
  if (typeof r.inrReceivedMinor === "number") {
    const rate = inrPerUsdText(r.inrReceivedMinor, r.amountMinor);
    if (rate) out.push(CARD_ZM.inrCredited(amountText(r.inrReceivedMinor, "INR"), rate));
  }
  if (typeof r.gatewayFeeInrMinor === "number")
    out.push(
      typeof r.gatewayFeeTaxInrMinor === "number"
        ? CARD_ZM.fee(amountText(r.gatewayFeeInrMinor, "INR"), amountText(r.gatewayFeeTaxInrMinor, "INR"))
        : GW.feeAbsorbed(amountText(r.gatewayFeeInrMinor, "INR")),
    );
  return out;
}

/** S13's "Copy portal link": the client's signed-in invoice page in this environment's portal (null when the build has no portal origin). */
export function portalInvoiceUrl(documentId: string, origin: string = PORTAL_ORIGIN): string | null {
  if (!origin) return null;
  try {
    return new URL(`/invoices/${encodeURIComponent(documentId)}`, origin).href;
  } catch {
    return null;
  }
}

// ---- designer's drafts for the lead (2026-11-01; staff-only) ------------------------------------------------------------------------------------------------

export const GW_UI = {
  paidOnline: "Paid online",
  /** Review finding 13 (the lead's staff line, 2026-11-01): the reference column of a Razorpay row (its `PAY-…` payment id is not a UTR). */
  paymentId: "Payment ID",
  // the brief's own words (run file G1)
  proformaToFollow: "Paid online, tax invoice to follow",
  issuingNow: "Its tax invoice is being issued automatically.",
  createLede: "Razorpay makes a link for one amount. Copy it to the client; it works for 7 days.",
  linkAmount: "Amount of the link",
  between: (minimum: string, balance: string) => `Between ${minimum} and ${balance}.`,
  atMost: (balance: string) => `At most ${balance}, the balance.`,
  wholeRupees: "Whole rupees only on a proforma.",
  linkMade: "Payment link made.",
  linkReused: "The open link for this amount is still live, so it was kept.",
  linkCopied: "Link copied.",
  copyFailed: "Couldn't copy. Select the link and copy it.",
  linkCancelled: "Link cancelled.",
  cancelTitle: "Cancel this payment link?",
  cancelBody: "The client can no longer pay through it. Razorpay is told first.",
  keepLink: "Keep link",
  noLink: "No payment link yet.",
  earlierLinks: "Earlier links",
  reviewOnDoc: (n: number) =>
    n === 1 ? "A payment on this document needs review." : `${n} payments on this document need review.`,
  openReview: "Open Needs review",
  /** The count's words for screen readers (the tab badge and the nav item). */
  reviewCount: (n: number) => (n === 1 ? "1 needs review" : `${n} need review`),
  colArrived: "Arrived",
  colReason: "Reason",
  colClient: "Client",
  colDocument: "Document",
  colAmount: "Amount",
  confirm: "Confirm",
  noClient: "Unknown",
  resolveLegend: "What happened",
  resolveNote: "Note",
  resolveDone: "Marked as resolved.",
  noResolution:
    "Nothing can be recorded for this item yet. Confirm the payment or issue its tax invoice first.",
  retried: {
    processed: "Payment confirmed.",
    duplicate: "Payment confirmed.",
    issued: "Tax invoice issued.",
    already_issued: "Its tax invoice was already issued. The item is resolved.",
    blocked: "The tax invoice still can't be issued.",
    other: "Checked again. It still needs review.",
  } as Record<string, string>,
  lastWebhookAt: (time: string) => `${GW.lastWebhook}: ${time}`,
  missingNames: (names: string) => `Not set: ${names}`,
  keysFromFinance: "Read from the Worker that holds the keys.",
} as const;

/** A window event the Needs review tab sends after a change, so the nav count reads again. */
export const REVIEW_CHANGED = "ta:review-changed";

/** The resolutions, in words (designer's drafts). */
export const RESOLUTION_LABELS: Record<ReviewResolution, string> = {
  confirmed: "The payment is confirmed",
  advance_issued: "Its tax invoice is issued",
  left_as_credit: "It stays as the client's credit",
  dismissed: "Dismiss: nothing to record",
};

/**
 * Which resolutions to offer for an item (early check 2, finding 5; the server's `RESOLUTION_ALLOWED_SQL` is the guard): "dismissed" always; "left as credit" only
 * for `overpaid`; "confirmed" only once the item's payment is confirmed; "tax invoice issued" only once the payment has its receipt. The payment's state is the
 * one read from `GET /payments/:id` (unknown → not offered).
 */
export function allowedResolutions(
  kind: string,
  payment: { status: string; advanceReceiptId: string | null } | null,
): ReviewResolution[] {
  const out: ReviewResolution[] = [];
  if (payment?.status === "confirmed") out.push("confirmed");
  if (payment?.advanceReceiptId) out.push("advance_issued");
  if (kind === "overpaid") out.push("left_as_credit");
  out.push("dismissed");
  return out;
}

/** "Try again" applies to these kinds (the route's own list; an advance item needs its payment). */
export const canRetry = (it: Pick<ReviewItem, "kind" | "payment_id" | "facts">): boolean =>
  ((it.kind === "advance_blocked" || it.kind === "dead_letter") && it.payment_id !== null) ||
  (["refetch_failed", "dead_letter", "unknown_link"].includes(it.kind) &&
    typeof it.facts?.linkId === "string");

const num = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/**
 * A blocker of the automatic tax invoice in words, its last full stop dropped so it sits inside S20's sentence: the gateway advance's own codes from
 * `ADVANCE_BLOCKER_WORDS` (review finding 4: shared with the Worker's bell), the invoice's issue checks in their 07-R/07-S words.
 */
const blockerWords = (code: string) =>
  advanceBlockerWords(code) ?? blockerLine({ code }, "INR").replace(/\.$/, "");

/** The same as a sentence of its own (the "Try again" toast). */
export const advanceBlockerLine = (code: string): string => {
  const w = advanceBlockerWords(code);
  return w ? `${w.charAt(0).toUpperCase()}${w.slice(1)}.` : blockerLine({ code }, "INR");
};

/** S20 for one item, from its kind and its whitelisted facts (a fact the row doesn't carry reads as S20's own fallback). */
export function itemReason(
  it: Pick<ReviewItem, "kind" | "facts" | "amount_minor"> &
    Partial<Pick<ReviewItem, "provider" | "currency">>,
): string {
  const f = it.facts ?? {};
  const blockers = Array.isArray(f.blockers)
    ? f.blockers.filter((b): b is string => typeof b === "string")
    : [];
  return reviewReason(it.kind, {
    // M6.3: the item's own gateway and currency (Stripe items name Stripe and dollars)
    provider: it.provider ?? null,
    currency: it.currency === "USD" ? "USD" : it.currency === "INR" ? "INR" : null,
    paidMinor: num(f.paidMinor) ?? it.amount_minor,
    expectedMinor: num(f.expectedMinor),
    extraMinor: num(f.extraMinor) ?? (it.kind === "overpaid" ? it.amount_minor : null),
    reason: str(f.reason),
    blocker: blockers.length ? blockers.map(blockerWords).join("; ") : null,
  });
}

/** The amount hint under "Amount of the link": the minimum (when the screen knows the part-payment floor) and the balance. */
export function linkHint(balanceMinor: number, floorMinor: number | null, proforma: boolean): string {
  const balance = amountText(balanceMinor, "INR");
  const range =
    floorMinor === null
      ? GW_UI.atMost(balance)
      : GW_UI.between(amountText(onlineMinimumOf(floorMinor, balanceMinor), "INR"), balance);
  return proforma ? `${range} ${GW_UI.wholeRupees}` : range;
}

/** The gateway codes answer with 07-ZI S24's words from the server; everything else as the payment screens say it. */
const GATEWAY_CODES = new Set([
  "amount_below_minimum",
  "amount_above_balance",
  "amount_not_whole_rupee",
  "not_payable_online",
  "link_in_progress",
  "link_not_live",
  "review_resolved",
  "too_many_links",
  "gateway_unavailable",
  "live_not_allowed",
  "gateway_error",
  "no_payment_listed",
  "gateway_refund_needed",
  "gateway_payment",
  "not_retryable",
  "advance_changed",
  "resolution_not_allowed",
  "client_gone",
  // M6.3 (07-ZM S19)
  "payment_processing",
  "amount_above_maximum",
]);
export function gwErrorText(e: unknown): string {
  if (e instanceof RequestError && GATEWAY_CODES.has(e.code) && e.message) {
    const reason = e.extra.details?.reason;
    // `not_payable_online` says why, in S20's words for the reason code
    // M6.3: `use_portal`'s own message already says why (S19)
    return e.code === "not_payable_online" && typeof reason === "string" && reason !== "use_portal"
      ? `${e.message.replace(/\.$/, "")}: ${notPayableWords(reason)}.`
      : e.message;
  }
  return payErrorText(e);
}
