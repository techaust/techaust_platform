// Online payment rules, pure (M6.2, M6.3; ADM-PAY-02, ADM-PAY-07, ADM-SET-05, ADM-SET-06, POR-06; run files docs/runs/m6.2-razorpay.md B and docs/runs/m6.3-stripe.md
// B). Which documents a client may pay online through which gateway, and which amounts. The portal, the admin's "Create payment link" and the finance Worker's
// `createLink` all ask these, and the SQL repeats the same rules in its WHERE (`onlinePayableSql`, one rule table: L14). Integer minor units only (no floats;
// `test/no-floats.test.ts` lists this file).

/** The document types a client may pay online through Razorpay (a tax invoice, a debit note, a proforma): `ONLINE_RULES.razorpay.types` (owner, 2026-11-01, Q3 A). */
export const ONLINE_PAYABLE_TYPES = ["tax_invoice", "debit_note", "proforma"] as const;
export type OnlinePayableType = (typeof ONLINE_PAYABLE_TYPES)[number];

/** Razorpay's smallest amount: ₹1 (the same as `RAZORPAY_MIN_AMOUNT_MINOR` in `@techaust/core/razorpay`; a test compares the two). */
export const GATEWAY_MIN_MINOR = 100;

/** The gateways a client may pay through (M6.2 Razorpay, M6.3 Stripe; M6.4 adds PayPal as a row of `ONLINE_RULES`). */
export const ONLINE_PROVIDERS = ["razorpay", "stripe"] as const;
export type OnlineProvider = (typeof ONLINE_PROVIDERS)[number];
export const isOnlineProvider = (v: unknown): v is OnlineProvider =>
  (ONLINE_PROVIDERS as readonly unknown[]).includes(v);

export type OnlineRule = {
  /** The one currency the gateway takes for us. */
  readonly currency: "INR" | "USD";
  /** Whose documents: `domestic` (in India and not `overseas`) or `overseas` (exactly the complement). */
  readonly clients: "domestic" | "overseas";
  readonly types: readonly string[];
  /** The gateway's smallest amount (minor units). */
  readonly minMinor: number;
  /** A proforma's balance and amount are in whole units (LD28: its payment becomes a tax invoice for the amount received, issued in whole units). */
  readonly wholeUnitsOnProforma: boolean;
};

/**
 * One rule table for every gateway (M6.3 run file B, L14; the SQL twin is `onlinePayableSql` in `@techaust/db/sql-rules`, held to this table by a db test):
 *   - razorpay (M6.2): INR documents of domestic clients (owner, 2026-11-01, Q3 A; a USD invoice credited to us in INR through a gateway keeps the 9-month
 *     realisation period: Settled by the lead on the safest reading, 2026-10-30 (08-C RB-01)): tax invoice, debit note, proforma; ₹1 minimum; a proforma in whole
 *     rupees;
 *   - stripe (M6.3, L1): USD documents of overseas clients: export invoice, its debit note, proforma; USD 0.50 minimum (`STRIPE_MIN_AMOUNT_MINOR` in
 *     `@techaust/core/stripe`, a test compares the two; UNCONFIRMED, V19); cents allowed on a proforma (its tax invoice for the payment received is issued by the
 *     Owner with the day's rate, Q1 A).
 */
export const ONLINE_RULES: Readonly<Record<OnlineProvider, OnlineRule>> = {
  razorpay: {
    currency: "INR",
    clients: "domestic",
    types: ONLINE_PAYABLE_TYPES,
    minMinor: GATEWAY_MIN_MINOR,
    wholeUnitsOnProforma: true,
  },
  stripe: {
    currency: "USD",
    clients: "overseas",
    types: ["export_invoice", "debit_note", "proforma"],
    minMinor: 50,
    wholeUnitsOnProforma: false,
  },
};

export const NOT_PAYABLE_REASONS = [
  "type_not_payable",
  "not_inr",
  "client_overseas",
  "client_anonymised",
  "not_issued",
  "void",
  "withdrawn",
  "nothing_due",
  "below_gateway_minimum",
  "target_not_whole_unit",
  // M6.3: a USD gateway for a client in India, a document not in USD, nothing payable under the online maximum, and a gateway payment still waiting (generic).
  "client_domestic",
  "not_usd",
  "above_gateway_maximum",
  "payment_pending",
] as const;
export type NotPayableReason = (typeof NOT_PAYABLE_REASONS)[number];

export type PayableDoc = {
  readonly type: string;
  readonly currency: string;
  /** The document is issued (frozen). */
  readonly frozen: boolean;
  readonly status: string;
  /** A withdrawn proforma (core `isWithdrawn`, SQL `withdrawnSql`). */
  readonly withdrawn: boolean;
  readonly balanceMinor: number;
  /**
   * M6.3 (generic, every gateway; reviewer X1): the document has a gateway payment still waiting (`pending_verification` with `requested_allocations` naming it: a
   * paid USD proforma waiting for the Owner, Q1 A, or a Razorpay proforma waiting for its automatic tax invoice; from M6.4 a PayPal checkout in
   * `capture_pending`). Paying again would take the same balance twice. Missing reads as none; the SQL twin always reads it.
   */
  readonly paymentPending?: boolean;
};
export type PayableClient = {
  readonly country: string;
  readonly gstStatus: string;
  readonly anonymised: boolean;
};

/** Whether a client is domestic for the gateways: in India and not `overseas` (overseas is exactly the complement: `country <> 'IN' OR gst_status = 'overseas'`). */
export const isDomesticClient = (c: Pick<PayableClient, "country" | "gstStatus">): boolean =>
  c.country === "IN" && c.gstStatus !== "overseas";

/**
 * Whether a document can be paid online now through `provider` (POR-06; `ONLINE_RULES`), in this order: a type the gateway takes; a client not anonymised and on the
 * gateway's side (`client_overseas` for Razorpay, `client_domestic` for Stripe); the gateway's currency (`not_inr`, `not_usd`); issued; not withdrawn or void; a
 * proforma issued or converted; no gateway payment still waiting on it (`payment_pending`); something due (`nothing_due`) of at least the gateway's minimum
 * (`below_gateway_minimum`); a proforma's balance in whole units where the gateway's row says so (`target_not_whole_unit`); and, when `limits` are given, some amount
 * payable under the online maximum (`onlineMinimumOf(floor, balance)` at most `maxMinor`, else `above_gateway_maximum`).
 */
export function payableOnline(
  doc: PayableDoc,
  client: PayableClient,
  provider: OnlineProvider,
  limits?: { readonly floorMinor: number; readonly maxMinor: number | null },
):
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "not_payable_online"; readonly reason: NotPayableReason } {
  const no = (reason: NotPayableReason) => ({ ok: false, code: "not_payable_online", reason }) as const;
  const rule = Object.hasOwn(ONLINE_RULES, provider) ? ONLINE_RULES[provider] : null;
  if (!rule?.types.includes(doc.type)) return no("type_not_payable");
  if (client.anonymised) return no("client_anonymised");
  const domestic = isDomesticClient(client);
  if (rule.clients === "domestic" && !domestic) return no("client_overseas");
  if (rule.clients === "overseas" && domestic) return no("client_domestic");
  if (doc.currency !== rule.currency) return no(rule.currency === "INR" ? "not_inr" : "not_usd");
  if (!doc.frozen) return no("not_issued");
  if (doc.withdrawn) return no("withdrawn");
  if (doc.status === "void") return no("void");
  // Early check 1, finding 5: a proforma is paid only while issued or converted (the SQL twin holds the same).
  if (doc.type === "proforma" && doc.status !== "issued" && doc.status !== "converted")
    return no("not_issued");
  if (doc.paymentPending === true) return no("payment_pending");
  if (!Number.isSafeInteger(doc.balanceMinor) || doc.balanceMinor <= 0) return no("nothing_due");
  if (doc.balanceMinor < rule.minMinor) return no("below_gateway_minimum");
  if (rule.wholeUnitsOnProforma && doc.type === "proforma" && doc.balanceMinor % 100 !== 0)
    return no("target_not_whole_unit");
  if (
    limits &&
    limits.maxMinor !== null &&
    onlineMinimumOf(limits.floorMinor, doc.balanceMinor) > limits.maxMinor
  )
    return no("above_gateway_maximum");
  return { ok: true };
}

/**
 * The smallest amount a client may pay online: the part-payment floor (Settings › Payment terms, `razorpayMinPartialInrMinor` or, M6.3, `onlineMinPartialUsdMinor`),
 * never under Razorpay's ₹1 (early check 1, finding 4: a floor of 0 must not let 1 to 99 paise through; for USD this is one dollar, above Stripe's 50 cents), or the
 * whole balance if lower.
 */
export const onlineMinimumOf = (floorMinor: number, balanceMinor: number): number =>
  Math.min(Math.max(floorMinor, GATEWAY_MIN_MINOR), balanceMinor);

/**
 * The default part-payment floor, INR 10,000 (docs/04 ADM-SET-05; the default of Settings › Payment terms `razorpayMinPartialInrMinor`). Researched 2026-10-29,
 * Razorpay first_min_partial_amount (08-C RB-39): a commercial default, no regulatory floor.
 */
export const DEFAULT_PART_FLOOR_MINOR = 10_000_00;

/** M6.3: the default smallest card part-payment on a USD document, USD 100, or the whole balance if less (owner, 2026-11-01, Q2 A; `onlineMinPartialUsdMinor`). */
export const DEFAULT_USD_PART_FLOOR_MINOR = 100_00;

/**
 * M6.3 (L9): the default largest online payment on a USD document, USD 25,000 (`overseasOnlineMaxUsdMinor`, shared with PayPal in M6.4). Researched 2026-10-28, RBI
 * PA Directions 2025, para 11(d) (08-C RB-07): ₹25 lakh per PA-CB transaction (PayPal, M6.4); USD 25,000 stays under it while the rupee is below ₹100 per USD
 * (today's rate not verified; the Owner keeps the setting below the limit at the day's rate, S18). Stripe is not a PA-CB (08-C RA-38), so for Stripe this
 * maximum is the L9 safest setting, not a legal limit (lead, 2026-11-02; 08-C RB-07).
 */
export const DEFAULT_ONLINE_MAX_USD_MINOR = 25_000_00;

/**
 * The part-payment floor as a reader that cannot run the settings schema (the portal Worker) finds it in the stored Payment terms row (`json_extract`, fix round 3
 * item 1): null or undefined (the group, or the figure, never saved) is the default, as `resolveSetting` merges it; a whole number ≥ 0 is the floor; anything else
 * (a corrupted row, read as -1) is unreadable: null, and the page offers the full amount only. The finance Worker's `payAmountVerdict` still decides.
 */
export const storedFloorOf = (v: unknown): number | null =>
  v === null || v === undefined
    ? DEFAULT_PART_FLOOR_MINOR
    : Number.isSafeInteger(v) && (v as number) >= 0
      ? (v as number)
      : null;

export type PayAmountVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "amount_below_minimum"; readonly minimumMinor: number }
  | { readonly ok: false; readonly code: "amount_above_balance"; readonly balanceMinor: number }
  | { readonly ok: false; readonly code: "amount_above_maximum"; readonly maximumMinor: number }
  | { readonly ok: false; readonly code: "amount_not_whole_rupee" };

/**
 * Whether `amountMinor` may be paid online against `balanceMinor` (07-ZI lines 4 to 7), in this order: a positive safe integer (else below the minimum); at most the
 * balance (`amount_above_balance`); at most the online maximum when one is given (M6.3 L9: `amount_above_maximum` with `maximumMinor`; Researched 2026-10-28, RBI PA
 * Directions 2025, para 11(d) (08-C RB-07): ₹25 lakh per PA-CB transaction; for Stripe, not a PA-CB, the L9 safest setting, not a legal limit); at least the minimum (`onlineMinimumOf`: the floor, or the balance if lower;
 * `amount_below_minimum` with `minimumMinor`); and in whole rupees when asked (`wholeRupees`: a Razorpay proforma, LD28; `amount_not_whole_rupee`). The part-payment
 * floor is a commercial setting (Researched 2026-10-29, Razorpay `first_min_partial_amount` (08-C RB-39)); links are made for one fixed amount, so the floor is
 * applied here, not by the gateway.
 */
export function payAmountVerdict(i: {
  readonly amountMinor: number;
  readonly balanceMinor: number;
  readonly floorMinor: number;
  readonly wholeRupees: boolean;
  /** The most one online payment may be (Settings › Payment terms `overseasOnlineMaxUsdMinor` for Stripe, L9); null or missing: no maximum (Razorpay). */
  readonly maxMinor?: number | null;
}): PayAmountVerdict {
  const minimumMinor = onlineMinimumOf(i.floorMinor, i.balanceMinor);
  if (!Number.isSafeInteger(i.amountMinor) || i.amountMinor <= 0)
    return { ok: false, code: "amount_below_minimum", minimumMinor };
  if (i.amountMinor > i.balanceMinor)
    return { ok: false, code: "amount_above_balance", balanceMinor: i.balanceMinor };
  if (i.maxMinor !== undefined && i.maxMinor !== null && i.amountMinor > i.maxMinor)
    return { ok: false, code: "amount_above_maximum", maximumMinor: i.maxMinor };
  if (i.amountMinor < minimumMinor) return { ok: false, code: "amount_below_minimum", minimumMinor };
  if (i.wholeRupees && i.amountMinor % 100 !== 0) return { ok: false, code: "amount_not_whole_rupee" };
  return { ok: true };
}

/** The reasons a gateway payment waits in "Needs review" (07-ZI line 20; the twin of `REVIEW_KINDS` in the db schema, held by the 0064 and 0066 triggers). */
export const REVIEW_KINDS = [
  "amount_mismatch",
  "currency_mismatch",
  "reference_mismatch",
  "order_mismatch",
  "payment_not_on_link",
  "not_captured",
  "partial_payment",
  "unknown_link",
  "document_not_payable",
  "advance_blocked",
  "refetch_failed",
  "dead_letter",
  "overpaid",
  "proforma_overpaid",
  "client_gone",
  "unreadable_event",
  /**
   * M6.3 (lead, 2026-11-02, early check 1 decision 1): a USD card payment whose card was issued in India, or whose country Stripe did not give, is not an inflow of
   * foreign exchange, so it is recorded pending and never confirmed by the system (Settled by the lead on the safest reading, 2026-11-02 (08-C RA-38)).
   */
  "not_export_receipt",
] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];
export const REVIEW_RESOLUTIONS = ["confirmed", "advance_issued", "left_as_credit", "dismissed"] as const;
export type ReviewResolution = (typeof REVIEW_RESOLUTIONS)[number];
