// The ledger, pure (M6.1; ADM-PAY-05, ADM-PAY-06, ADM-INV-02, ADM-INV-09, ADM-INV-16; run file docs/runs/m6.1-ledger-payments.md, L2, L6 to L9, L13, L17, L19).
// No I/O, no zod, no floats: amounts cross the boundary as safe integers (minor units) and every sum runs in bigint. Codes only: the words are the screens' (07-ZH).
//
//   - a document's ledger: its balance, the excess paid back to the client's credit, and the status (`docLedger`, `ledgerStatusOf`, `balanceOf`, `refundDueOf`;
//     moved here from `notes.ts` with TDS, which still re-exports them). The SQL recompute in `@techaust/db/ledger` is the twin of `ledgerStatusOf` (a test
//     compares them);
//   - the allocation plan of a payment (`planAllocations`), the client's credit balance (`creditBalance`, derived: no credit table, L2) and the first-in,
//     first-out sources a credit is drawn from (`creditSources`), what may be released from a document (`releasable`), the status moves of a payment
//     (`canMovePayment`), and the RA-17 warning (`receiptMonthWarning`).
//
// TDS (T8, L8, L19): Settled by the lead on the safest reading, 2026-10-30 (08-C RA-30): the client picks the section and rate, the amount on its advice (later
// its Form 16A certificate) is recorded, the invoice and its GST stay at full value, and the balance treats the TDS as settled (ADM-INV-16). TDS is recorded only
// on an INR tax invoice or debit note of a client in India; no section or rate is asserted here. A one-off opinion from a CA on the section clients pick would
// still be wise (settle-08c T8).

/** The document types a payment can be put on: never a proforma (L5: it is paid through the tax invoice for the payment received) or a credit note. */
export const PAYABLE_TYPES = ["tax_invoice", "export_invoice", "debit_note"] as const;
export type PayableType = (typeof PAYABLE_TYPES)[number];
/** The document types TDS can be recorded on, in INR only (L8). */
export const TDS_TYPES = ["tax_invoice", "debit_note"] as const;
/** The statuses an issued invoice moves between as money and credit notes arrive (the twin of the SQL CASE). */
export const LEDGER_STATUSES = [
  "issued",
  "partially_paid",
  "paid",
  "partially_credited",
  "credited",
] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

export const PAYMENT_KINDS = ["payment", "tds"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const PAYMENT_STATUSES = ["pending_verification", "confirmed", "rejected", "withdrawn"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_MODES = ["neft", "rtgs", "imps", "upi", "swift"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
/** At most this many invoices one payment asks for, or is put on, in one go (the `payments_requested_allocations` CHECK holds the same number). */
export const ALLOCATIONS_MAX = 10;

// ---- safe integers in, bigint inside ------------------------------------------------------------------------------------------------------------------

const big = (n: number, what: string): bigint => {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} is not a safe integer`);
  return BigInt(n);
};
const num = (b: bigint): number => {
  const n = Number(b);
  if (!Number.isSafeInteger(n)) throw new RangeError("the result is not a safe integer");
  return n;
};
const max0 = (b: bigint): bigint => (b > 0n ? b : 0n);
const isSafe = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);

// ---- one document's ledger -------------------------------------------------------------------------------------------------------------------------

/**
 * The status an issued invoice has for these figures: the twin of the CASE the ledger recompute and the credit-note recompute write (`@techaust/db/ledger`
 * `LEDGER_STATUS_CASE`; a test compares them). What was paid and the TDS settle the invoice together (`paid + tds`, ADM-INV-16).
 */
export function ledgerStatusOf(
  totalMinor: number,
  paidMinor: number,
  creditedMinor: number,
  tdsMinor = 0,
): LedgerStatus {
  const total = big(totalMinor, "total");
  const credited = big(creditedMinor, "credited");
  const settled = big(paidMinor, "paid") + big(tdsMinor, "tds");
  if (credited >= total) return "credited";
  if (settled > 0n && total - settled - credited <= 0n) return "paid";
  if (settled > 0n) return "partially_paid";
  if (credited > 0n) return "partially_credited";
  return "issued";
}

/** What is still to pay: never below zero (paid, credited and TDS together above the total are an excess, not a negative balance). */
export const balanceOf = (
  totalMinor: number,
  paidMinor: number,
  creditedMinor: number,
  tdsMinor = 0,
): number =>
  num(
    max0(
      big(totalMinor, "total") -
        big(paidMinor, "paid") -
        big(creditedMinor, "credited") -
        big(tdsMinor, "tds"),
    ),
  );

/** The excess: paid, credited and TDS together above the total. Release moves it to the client's credit (M6.1 has no refund, M6.5). */
export const refundDueOf = (
  totalMinor: number,
  paidMinor: number,
  creditedMinor: number,
  tdsMinor = 0,
): number =>
  num(
    max0(
      big(paidMinor, "paid") +
        big(creditedMinor, "credited") +
        big(tdsMinor, "tds") -
        big(totalMinor, "total"),
    ),
  );

export type DocLedger = {
  readonly balance: number;
  readonly refundDue: number;
  readonly status: LedgerStatus;
};

/** The balance, the excess and the status of one issued document, together. */
export function docLedger(
  totalMinor: number,
  paidMinor: number,
  creditedMinor: number,
  tdsMinor: number,
): DocLedger {
  return {
    balance: balanceOf(totalMinor, paidMinor, creditedMinor, tdsMinor),
    refundDue: refundDueOf(totalMinor, paidMinor, creditedMinor, tdsMinor),
    status: ledgerStatusOf(totalMinor, paidMinor, creditedMinor, tdsMinor),
  };
}

// ---- the status moves of a payment (the twin of the trigger `payments_fixed`) --------------------------------------------------------------------------

/** Pending moves once, to confirmed or rejected; confirmed moves once, to withdrawn (L7); rejected and withdrawn are final. Staying put is not a move. */
export function canMovePayment(from: string, to: string): boolean {
  if (from === "pending_verification") return to === "confirmed" || to === "rejected";
  if (from === "confirmed") return to === "withdrawn";
  return false;
}

// ---- the allocation plan --------------------------------------------------------------------------------------------------------------------------

/** What `planAllocations` knows about a document (the columns the API reads). */
export type LedgerDoc = {
  readonly id: string;
  readonly clientId: string;
  readonly currency: string;
  readonly type: string;
  readonly status: string;
  readonly frozen: boolean;
  readonly totalMinor: number;
  readonly paidMinor: number;
  readonly creditedMinor: number;
  readonly tdsMinor: number;
};

export type LedgerPayment = {
  readonly clientId: string;
  readonly currency: string;
  readonly kind: PaymentKind;
  readonly amountMinor: number;
  /** What the payment already holds net (Σ allocate − Σ release); 0 for a new payment. */
  readonly allocatedMinor?: number;
};

export type AllocationRequest = { readonly documentId: string; readonly amountMinor: number };

export const ALLOCATION_REFUSALS = [
  "too_many",
  "invalid_amount",
  "not_payable",
  "client_mismatch",
  "currency_mismatch",
  "tds_not_allowed",
  "tds_not_whole",
  "exceeds_balance",
  "exceeds_payment",
] as const;
export type AllocationRefusal = (typeof ALLOCATION_REFUSALS)[number];

export type AllocationPlan =
  | {
      readonly ok: true;
      /** One row per document (two requests for the same document are added together), in the order first asked. */
      readonly allocations: readonly AllocationRequest[];
      /** What the payment holds unallocated after the plan: it is the client's credit (an overpayment, ADM-PAY-06). */
      readonly unallocatedMinor: number;
    }
  | { readonly ok: false; readonly code: AllocationRefusal; readonly documentId?: string };

const isIn = (xs: readonly string[], v: string) => xs.includes(v);

/**
 * The plan of a payment's allocations, checked as the trigger `payment_allocations_bounds` and the post-condition `ledger_result` check them (the database holds
 * the same rules; this explains a refusal before the batch): at most 10 documents; each a frozen, live tax invoice, export invoice or debit note of the payment's
 * client and currency; a TDS payment goes whole onto one INR tax invoice or debit note (L8); no document gets more than its balance, and the payment never gives
 * more than it has. The first refusal found is returned, in that order.
 */
export function planAllocations(
  payment: LedgerPayment,
  requested: readonly AllocationRequest[],
  docs: readonly LedgerDoc[],
): AllocationPlan {
  if (requested.length > ALLOCATIONS_MAX) return { ok: false, code: "too_many" };
  if (!isSafe(payment.amountMinor) || payment.amountMinor <= 0) return { ok: false, code: "invalid_amount" };
  const held = payment.allocatedMinor ?? 0;
  if (!isSafe(held) || held < 0) return { ok: false, code: "invalid_amount" };
  const byId = new Map(docs.map((d) => [d.id, d]));
  const sums = new Map<string, bigint>();
  for (const r of requested) {
    if (!isSafe(r.amountMinor) || r.amountMinor <= 0)
      return { ok: false, code: "invalid_amount", documentId: r.documentId };
    const d = byId.get(r.documentId);
    if (!d?.frozen || !isIn(PAYABLE_TYPES, d.type) || !isIn(LEDGER_STATUSES, d.status))
      return { ok: false, code: "not_payable", documentId: r.documentId };
    if (d.clientId !== payment.clientId) return { ok: false, code: "client_mismatch", documentId: d.id };
    if (d.currency !== payment.currency) return { ok: false, code: "currency_mismatch", documentId: d.id };
    if (payment.kind === "tds" && (!isIn(TDS_TYPES, d.type) || d.currency !== "INR"))
      return { ok: false, code: "tds_not_allowed", documentId: d.id };
    sums.set(d.id, (sums.get(d.id) ?? 0n) + BigInt(r.amountMinor));
  }
  if (payment.kind === "tds") {
    const only = [...sums.values()];
    if (held !== 0 || only.length !== 1 || only[0] !== BigInt(payment.amountMinor))
      return { ok: false, code: "tds_not_whole" };
  }
  let total = 0n;
  for (const [id, amount] of sums) {
    const d = byId.get(id) as LedgerDoc;
    if (amount > BigInt(balanceOf(d.totalMinor, d.paidMinor, d.creditedMinor, d.tdsMinor)))
      return { ok: false, code: "exceeds_balance", documentId: id };
    total += amount;
  }
  const left = BigInt(payment.amountMinor) - BigInt(held) - total;
  if (left < 0n) return { ok: false, code: "exceeds_payment" };
  return {
    ok: true,
    allocations: [...sums].map(([documentId, amount]) => ({ documentId, amountMinor: num(amount) })),
    unallocatedMinor: num(left),
  };
}

// ---- the client's credit (derived, L2) ---------------------------------------------------------------------------------------------------------------

/** A payment as the credit helpers read it (one client, one currency). */
export type CreditPayment = {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly receivedOn: string;
  readonly amountMinor: number;
  /** Σ allocate − Σ release of this payment. */
  readonly netAllocatedMinor: number;
};

const unallocated = (p: CreditPayment): bigint =>
  p.status === "confirmed" && p.kind === "payment"
    ? big(p.amountMinor, "amount") - big(p.netAllocatedMinor, "allocated")
    : 0n;

/** The client's credit in one currency: what its confirmed payments hold unallocated (a TDS row is always allocated whole, so it adds nothing). Never below zero. */
export const creditBalance = (payments: readonly CreditPayment[]): number =>
  num(max0(payments.reduce((s, p) => s + unallocated(p), 0n)));

export type CreditSources =
  | {
      readonly ok: true;
      readonly sources: readonly { readonly paymentId: string; readonly amountMinor: number }[];
    }
  | { readonly ok: false; readonly code: "invalid_amount" | "exceeds_credit" };

/**
 * Where `amountMinor` of credit is drawn from: first in, first out by the day the money arrived, then by id (stable), each payment giving at most what it holds
 * unallocated. Never over-draws: a request above the credit balance is `exceeds_credit`.
 */
export function creditSources(payments: readonly CreditPayment[], amountMinor: number): CreditSources {
  if (!isSafe(amountMinor) || amountMinor <= 0) return { ok: false, code: "invalid_amount" };
  const order = [...payments]
    .filter((p) => unallocated(p) > 0n)
    .sort((a, b) =>
      a.receivedOn < b.receivedOn
        ? -1
        : a.receivedOn > b.receivedOn
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0,
    );
  let need = BigInt(amountMinor);
  const sources: { paymentId: string; amountMinor: number }[] = [];
  for (const p of order) {
    if (need === 0n) break;
    const has = unallocated(p);
    const take = has < need ? has : need;
    sources.push({ paymentId: p.id, amountMinor: num(take) });
    need -= take;
  }
  return need > 0n ? { ok: false, code: "exceeds_credit" } : { ok: true, sources };
}

/**
 * What one payment may release from a document: at most the document's excess (paid + credited + TDS − total) and at most what the payment holds on it. A TDS
 * payment is never released (it stays whole on its invoice, L8).
 */
export function releasable(doc: LedgerDoc, paymentKind: string, heldOnDocMinor: number): number {
  if (paymentKind !== "payment") return 0;
  const excess = BigInt(refundDueOf(doc.totalMinor, doc.paidMinor, doc.creditedMinor, doc.tdsMinor));
  const held = max0(big(heldOnDocMinor, "held"));
  return num(excess < held ? excess : held);
}

// ---- RA-17 (L13) ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * The warning shown when money received in an earlier calendar month than the invoice's issue month is put on it (a payment, or credit held from an
 * overpayment): GST on a services advance is due in the month it is received, with interest under s.50 when it is paid later (Researched 2026-10-28, s.13(2) and
 * s.31 CGST Act, Rules 50 and 51 (08-C RA-17)). L13, Settled by the lead on the safest reading, 2026-10-31: credit held from an overpayment and later used on
 * another supply is treated as an advance under s.13(2), so the warning is shown and nothing is blocked. Both dates are ISO IST days; `null` when no warning.
 */
export function receiptMonthWarning(
  receivedOn: string,
  issueDate: string,
): "received_in_earlier_month" | null {
  return receivedOn.slice(0, 7) < issueDate.slice(0, 7) ? "received_in_earlier_month" : null;
}
