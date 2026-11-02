// Payment receipts, pure (M6.5; ADM-PAY-09, ADM-SET-04, JOB-PDF-01; run file docs/runs/m6.5-receipts-refunds.md A, B, L3 to L5, L39). No I/O, no zod, no floats.
//
// A receipt is a `documents` row of type `receipt`, id `rct_` + the payment's id (the primary key makes it one per payment), series `receipt` (`TH/RCT/{FY}/{N}`),
// numbered at issue from the gap-free counter like every document, with `header_extras.receiptOf` frozen and sealed. It is NOT a GST document and is never titled a
// voucher: no tax rate, no tax amount, no place of supply, outside GSTR-1 (Researched 2026-11-03, s.31(3)(d) CGST Act and Rule 50 CGST Rules as quoted in the
// GST Council flyer ch. 6 (08-C RA-39)). It makes no stamp or signature claim either way (OPEN (08-C RB-21): is an emailed, computer-generated payment receipt
// above ₹5,000 chargeable under Schedule I Art. 53 Indian Stamp Act 1899, and must a stamped receipt be given on demand under s.30?). No words here: the PDF's and
// email's lines are 07-ZO's (the owner's).

import { canonicalJson, sha256Hex } from "./hash.ts";
import { amountInWords } from "./words.ts";

/** The layout version of the receipt PDF (the M5.5a rule: a layout version is never edited; a new layout is a new id). */
export const RECEIPT_LAYOUT_ID = "receipt-1";
/** The receipt's id prefix (`rct_` + the payment's id). */
export const RECEIPT_ID_PREFIX = "rct_";
/** The numbering series of a receipt (core `SERIES.receipt`, `gst: false`). */
export const RECEIPT_SERIES = "receipt";
/** The most "applied to" lines a receipt prints (a payment is put on at most 10 invoices per request; credit used later may add more). */
export const RECEIPT_APPLIED_MAX = 50;

/** The receipt of payment `paymentId`. Throws on an id the RPC boundary would refuse (1 to 64 characters with the prefix). */
export function receiptIdOf(paymentId: string): string {
  if (
    typeof paymentId !== "string" ||
    paymentId.length < 1 ||
    paymentId.length + RECEIPT_ID_PREFIX.length > 64
  )
    throw new RangeError("a receipt id is 1 to 64 characters");
  return `${RECEIPT_ID_PREFIX}${paymentId}`;
}

/** The payment a receipt id names, or null. */
export const paymentIdOfReceipt = (receiptId: string): string | null =>
  typeof receiptId === "string" &&
  receiptId.startsWith(RECEIPT_ID_PREFIX) &&
  receiptId.length > RECEIPT_ID_PREFIX.length
    ? receiptId.slice(RECEIPT_ID_PREFIX.length)
    : null;

/** The payment as the issue reads it (confirmed money received; L5: never TDS). */
export type ReceiptPayment = {
  readonly id: string;
  readonly currency: "INR" | "USD";
  readonly amountMinor: number;
  /** ISO IST day the money arrived ("Received on"). */
  readonly receivedOn: string;
  readonly provider: string;
  /** The payment mode as stored (neft, upi, card, wallet, ...), or null. */
  readonly mode: string | null;
  /** The normalised bank or gateway reference, or null. */
  readonly referenceNorm: string | null;
  /** Σ its refunds that have not failed (M6.5 L35), so "held as credit" never names money already returned. */
  readonly refundedMinor: number;
};

/** One net allocation of the payment at issue: the document it is on, its printed number and type, and what the payment holds there (Σ allocate − Σ release). */
export type ReceiptAllocation = {
  readonly documentId: string;
  readonly number: string;
  readonly type: string;
  readonly amountMinor: number;
};

/** "Received from": the client as the receipt prints it (its legal name, or its display name), frozen at issue. */
export type ReceiptClient = { readonly name: string; readonly gstin: string | null };

/** The supplier block a receipt prints (from Settings › Company at issue); no signature (L4) and no tax fields. */
export type ReceiptIssuer = {
  readonly tradeName: string;
  readonly legalName: string | null;
  readonly address: string | null;
  readonly gstin: string | null;
  readonly email: string | null;
};

/** `header_extras.receiptOf`: everything the receipt prints but its number (assigned in the batch, outside the seal, as an invoice's is). */
export type ReceiptOf = {
  readonly v: 1;
  readonly layout: typeof RECEIPT_LAYOUT_ID;
  readonly paymentId: string;
  readonly issuedOn: string;
  readonly receivedOn: string;
  readonly currency: "INR" | "USD";
  readonly amountMinor: number;
  readonly amountWords: string;
  readonly provider: string;
  readonly mode: string | null;
  readonly reference: string | null;
  readonly receivedFrom: ReceiptClient;
  readonly issuer: ReceiptIssuer;
  /** The invoices the money is on at issue, by number, at most `RECEIPT_APPLIED_MAX`; `appliedMore` counts the ones left out. */
  readonly appliedTo: readonly ReceiptAllocation[];
  readonly appliedMore: number;
  /** What the payment leaves as credit at issue: amount − Σ applied − refunds not failed, never below zero. */
  readonly heldAsCreditMinor: number;
};

export type ReceiptHeaderResult =
  | { readonly ok: true; readonly value: ReceiptOf }
  | {
      readonly ok: false;
      readonly code: "amount_invalid" | "date_invalid" | "allocation_invalid" | "over_applied";
    };

const isSafe = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);
const isIsoDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * The frozen header of the receipt of `payment` (`header_extras.receiptOf`): the amount in words (`amountInWords`, both currencies), the "applied to" lines (each
 * document once, positive holdings only, by number then id), and "held as credit" = amount − Σ applied − refunds not failed at issue. Refuses a non-positive or
 * unsafe amount, a bad day, a bad allocation, or allocations above the amount (`over_applied`: the ledger never allows it, so it means a stale read).
 */
export function receiptHeaderOf(a: {
  readonly payment: ReceiptPayment;
  readonly allocations: readonly ReceiptAllocation[];
  readonly client: ReceiptClient;
  readonly issuer: ReceiptIssuer;
  /** The receipt date: the IST day of the issue (L4). */
  readonly issuedOn: string;
}): ReceiptHeaderResult {
  const p = a.payment;
  if (!isSafe(p.amountMinor) || p.amountMinor <= 0 || !isSafe(p.refundedMinor) || p.refundedMinor < 0)
    return { ok: false, code: "amount_invalid" };
  if (!isIsoDay(p.receivedOn) || !isIsoDay(a.issuedOn)) return { ok: false, code: "date_invalid" };
  const byDoc = new Map<string, ReceiptAllocation>();
  for (const l of a.allocations) {
    if (!isSafe(l.amountMinor) || typeof l.documentId !== "string" || typeof l.number !== "string")
      return { ok: false, code: "allocation_invalid" };
    const had = byDoc.get(l.documentId);
    byDoc.set(l.documentId, { ...l, amountMinor: (had?.amountMinor ?? 0) + l.amountMinor });
  }
  const lines = [...byDoc.values()]
    .filter((l) => l.amountMinor > 0)
    .sort((x, y) =>
      x.number < y.number ? -1 : x.number > y.number ? 1 : x.documentId < y.documentId ? -1 : 1,
    );
  const applied = lines.reduce((s, l) => s + BigInt(l.amountMinor), 0n);
  const held = BigInt(p.amountMinor) - applied - BigInt(p.refundedMinor);
  if (applied > BigInt(p.amountMinor)) return { ok: false, code: "over_applied" };
  return {
    ok: true,
    value: {
      v: 1,
      layout: RECEIPT_LAYOUT_ID,
      paymentId: p.id,
      issuedOn: a.issuedOn,
      receivedOn: p.receivedOn,
      currency: p.currency,
      amountMinor: p.amountMinor,
      amountWords: amountInWords({ amount: p.amountMinor, currency: p.currency }),
      provider: p.provider,
      mode: p.mode,
      reference: p.referenceNorm,
      receivedFrom: { name: a.client.name, gstin: a.client.gstin },
      issuer: a.issuer,
      appliedTo: lines.slice(0, RECEIPT_APPLIED_MAX),
      appliedMore: Math.max(0, lines.length - RECEIPT_APPLIED_MAX),
      heldAsCreditMinor: held > 0n ? Number(held) : 0,
    },
  };
}

/** The receipt's seal: SHA-256 of the canonical JSON of its `receiptOf` (the number is outside it). The jobs Worker refuses a PDF whose seal does not match. */
export const receiptSealOf = (r: ReceiptOf): Promise<string> => sha256Hex(canonicalJson(r));

/**
 * L5: a receipt is emailed only for a payment confirmed at most this long before its receipt issues (the staging back-catalogue gets its receipts, never a pile of
 * old emails).
 */
export const RECEIPT_EMAIL_WINDOW_MS = 3 * 86_400_000;
export const receiptEmailDue = (confirmedAt: number, issuedAt: number): boolean =>
  isSafe(confirmedAt) && isSafe(issuedAt) && issuedAt - confirmedAt <= RECEIPT_EMAIL_WINDOW_MS;
