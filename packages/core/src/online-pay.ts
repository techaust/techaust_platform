// Online payment rules, pure (M6.2; ADM-PAY-02, ADM-PAY-07, ADM-SET-05, ADM-SET-06, POR-06; run file docs/runs/m6.2-razorpay.md B). Which documents a client may pay
// online, and which amounts. The portal, the admin's "Create payment link" and the finance Worker's `createLink` all ask these, and the SQL repeats the same rules in
// its WHERE. Integer minor units only (no floats; `test/no-floats.test.ts` lists this file).

/** The document types a client may pay online (a tax invoice, a debit note, a proforma). Export invoices are excluded with overseas clients (owner, 2026-11-01, Q3 A). */
export const ONLINE_PAYABLE_TYPES = ["tax_invoice", "debit_note", "proforma"] as const;
export type OnlinePayableType = (typeof ONLINE_PAYABLE_TYPES)[number];

/** Razorpay's smallest amount: ₹1 (the same as `RAZORPAY_MIN_AMOUNT_MINOR` in `@techaust/core/razorpay`; a test compares the two). */
export const GATEWAY_MIN_MINOR = 100;

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
};
export type PayableClient = {
  readonly country: string;
  readonly gstStatus: string;
  readonly anonymised: boolean;
};

/**
 * Whether a document can be paid online now (POR-06, Razorpay in M6.2): a tax invoice, debit note or proforma; in INR; of a DOMESTIC client (in India and not
 * `overseas`: owner, 2026-11-01, Q3 A; OPEN (08-C RB-01): does a USD invoice paid through a PA-CB that credits us in INR count as "settled in INR"?); not anonymised;
 * issued; not void or withdrawn; with something due of at least ₹1 (Razorpay's minimum). A proforma's balance must be whole rupees (LD28: its payment becomes a tax
 * invoice for the amount received, issued in whole units), else `target_not_whole_unit`.
 */
export function payableOnline(
  doc: PayableDoc,
  client: PayableClient,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "not_payable_online"; readonly reason: NotPayableReason } {
  const no = (reason: NotPayableReason) => ({ ok: false, code: "not_payable_online", reason }) as const;
  if (!(ONLINE_PAYABLE_TYPES as readonly string[]).includes(doc.type)) return no("type_not_payable");
  if (client.anonymised) return no("client_anonymised");
  if (client.country !== "IN" || client.gstStatus === "overseas") return no("client_overseas");
  if (doc.currency !== "INR") return no("not_inr");
  if (!doc.frozen) return no("not_issued");
  if (doc.withdrawn) return no("withdrawn");
  if (doc.status === "void") return no("void");
  // Early check 1, finding 5: a proforma is paid only while issued or converted (the SQL twin holds the same).
  if (doc.type === "proforma" && doc.status !== "issued" && doc.status !== "converted")
    return no("not_issued");
  if (!Number.isSafeInteger(doc.balanceMinor) || doc.balanceMinor <= 0) return no("nothing_due");
  if (doc.balanceMinor < GATEWAY_MIN_MINOR) return no("below_gateway_minimum");
  if (doc.type === "proforma" && doc.balanceMinor % 100 !== 0) return no("target_not_whole_unit");
  return { ok: true };
}

/**
 * The smallest amount a client may pay online: the part-payment floor (Settings › Payment terms, `razorpayMinPartialInrMinor`), never under Razorpay's ₹1 (early
 * check 1, finding 4: a floor of 0 must not let 1 to 99 paise through), or the whole balance if lower.
 */
export const onlineMinimumOf = (floorMinor: number, balanceMinor: number): number =>
  Math.min(Math.max(floorMinor, GATEWAY_MIN_MINOR), balanceMinor);

/**
 * The default part-payment floor, INR 10,000 (docs/04 ADM-SET-05; the default of Settings › Payment terms `razorpayMinPartialInrMinor`). Researched 2026-10-29,
 * Razorpay first_min_partial_amount (08-C RB-39): a commercial default, no regulatory floor.
 */
export const DEFAULT_PART_FLOOR_MINOR = 10_000_00;

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
  | { readonly ok: false; readonly code: "amount_not_whole_rupee" };

/**
 * Whether `amountMinor` may be paid online against `balanceMinor` (07-ZI lines 4 to 7): at most the balance (`amount_above_balance`), at least the minimum
 * (`onlineMinimumOf`: the floor, or the balance if lower; `amount_below_minimum` with `minimumMinor`), and in whole rupees when asked (`wholeRupees`: a proforma,
 * LD28; `amount_not_whole_rupee`). The part-payment floor is a commercial setting (Researched 2026-10-29, Razorpay `first_min_partial_amount` (08-C RB-39)); links
 * are made for one fixed amount (`accept_partial: false`, L2), so the floor is applied here, not by Razorpay. An amount that is not a positive safe integer is below
 * the minimum.
 */
export function payAmountVerdict(i: {
  readonly amountMinor: number;
  readonly balanceMinor: number;
  readonly floorMinor: number;
  readonly wholeRupees: boolean;
}): PayAmountVerdict {
  const minimumMinor = onlineMinimumOf(i.floorMinor, i.balanceMinor);
  if (!Number.isSafeInteger(i.amountMinor) || i.amountMinor <= 0)
    return { ok: false, code: "amount_below_minimum", minimumMinor };
  if (i.amountMinor > i.balanceMinor)
    return { ok: false, code: "amount_above_balance", balanceMinor: i.balanceMinor };
  if (i.amountMinor < minimumMinor) return { ok: false, code: "amount_below_minimum", minimumMinor };
  if (i.wholeRupees && i.amountMinor % 100 !== 0) return { ok: false, code: "amount_not_whole_rupee" };
  return { ok: true };
}

/** The reasons a gateway payment waits in "Needs review" (07-ZI line 20; the twin of `REVIEW_KINDS` in the db schema, held by the 0064 triggers). */
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
] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];
export const REVIEW_RESOLUTIONS = ["confirmed", "advance_issued", "left_as_credit", "dismissed"] as const;
export type ReviewResolution = (typeof REVIEW_RESOLUTIONS)[number];
