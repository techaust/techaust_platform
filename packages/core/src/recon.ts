// Razorpay settlement reconciliation, pure (M6.5; ADM-PAY-10, L11; run file B, C `fetchSettlements`, Step 0 vendor facts R6, R7). No I/O, no floats.
//
// `GET /v1/settlements/recon/combined?year&month&day&count&skip` (vendor fact R6, CONFIRMED 2026-11-03: razorpay.com/docs/api/settlements/fetch-recon/) lists the
// day's items: payments, refunds, adjustments and transfers, each with its settlement. Only these whitelisted facts are kept (L8; Settled by the lead on the
// safest reading, 2026-11-01 (08-C RB-40)): the item's type and id, the amounts (`amount`, `fee`, `tax`, `credit`, `debit`, minor units), the currency, the
// settlement's id, UTR and time; never a card, payer, email, phone or note field. The reader runs one small top-level zod/mini schema per item (M6.2 rule 5: never a
// whole-payload parse); an item it can't read is counted, never guessed. Field names other than those in R6's list are UNCONFIRMED until B2's recorded sandbox
// payloads (R7: whether test mode makes settlements is UNCONFIRMED; a recorded fixture stands in).
import * as z from "zod/mini";

/** The most items one page asks for (R4/R6: `count` 1 to 100). */
export const RECON_PAGE_MAX = 100;

const amount = z.int().check(z.gte(0));
const id = z.string().check(z.minLength(1), z.maxLength(255));
const settlementRef = z.string().check(z.minLength(1), z.maxLength(64));

/** One item of the combined recon list, the whitelisted fields only (unknown keys are dropped by `z.object`). */
const reconItem = z.object({
  entity_id: id,
  type: z.string().check(z.minLength(1), z.maxLength(32)),
  amount,
  fee: z.optional(z.nullable(amount)),
  tax: z.optional(z.nullable(amount)),
  credit: z.optional(z.nullable(amount)),
  debit: z.optional(z.nullable(amount)),
  currency: z.optional(z.nullable(z.string().check(z.length(3)))),
  settlement_id: z.optional(z.nullable(settlementRef)),
  settlement_utr: z.optional(z.nullable(settlementRef)),
  settled_at: z.optional(z.nullable(z.int().check(z.gte(0)))),
});
const reconPage = z.object({ count: z.optional(z.int().check(z.gte(0))), items: z.array(z.unknown()) });

export const RECON_ENTITY_TYPES = ["payment", "refund", "adjustment", "transfer", "other"] as const;
export type ReconEntityType = (typeof RECON_ENTITY_TYPES)[number];

/** One item as the database stores it (`settlement_items`; the settlement's facts alongside). */
export type ReconItem = {
  readonly entityType: ReconEntityType;
  readonly entityId: string;
  readonly direction: "credit" | "debit";
  readonly amountMinor: number;
  readonly feeMinor: number;
  readonly taxMinor: number;
  readonly currency: "INR";
  readonly settlementId: string | null;
  readonly settlementUtr: string | null;
  /** Razorpay's `settled_at` in UTC ms (it reports seconds), or null while not settled. */
  readonly settledAt: number | null;
};

export type ReconPage = {
  readonly items: readonly ReconItem[];
  /** Items left out: unreadable, or not in INR. */
  readonly skipped: number;
  /** As many items as asked for came back: another page may follow. */
  readonly full: boolean;
};

const typeOf = (t: string): ReconEntityType =>
  (RECON_ENTITY_TYPES as readonly string[]).includes(t) ? (t as ReconEntityType) : "other";

/**
 * Reads one page of the combined recon list (`asked`: the `count` sent, at most `RECON_PAGE_MAX`). Direction: an item with a `debit` above zero and no `credit`
 * is money out (a refund, a fee adjustment); otherwise money in; a `refund` with neither is out. Not an object with an `items` array: null (the caller retries).
 */
export function readRazorpayRecon(page: unknown, asked: number): ReconPage | null {
  const p = reconPage.safeParse(page);
  if (!p.success) return null;
  const items: ReconItem[] = [];
  let skipped = 0;
  for (const raw of p.data.items) {
    const r = reconItem.safeParse(raw);
    if (!r.success || (r.data.currency != null && r.data.currency !== "INR")) {
      skipped++;
      continue;
    }
    const d = r.data;
    const entityType = typeOf(d.type);
    const credit = d.credit ?? 0;
    const debit = d.debit ?? 0;
    const direction =
      debit > 0 && credit === 0
        ? "debit"
        : credit > 0
          ? "credit"
          : entityType === "refund"
            ? "debit"
            : "credit";
    items.push({
      entityType,
      entityId: d.entity_id,
      direction,
      amountMinor: d.amount,
      feeMinor: d.fee ?? 0,
      taxMinor: d.tax ?? 0,
      currency: "INR",
      settlementId: d.settlement_id ?? null,
      settlementUtr: d.settlement_utr ?? null,
      settledAt: d.settled_at == null ? null : d.settled_at * 1000,
    });
  }
  return { items, skipped, full: p.data.items.length >= Math.min(Math.max(asked, 1), RECON_PAGE_MAX) };
}

/** What our row says about the payment or refund an item names. */
export type ReconTarget = {
  readonly amountMinor: number;
  /** The fee and its tax as the payment row recorded them (`charges_minor`, `fee_tax_minor`); null for a refund (Razorpay charges no fee on it). */
  readonly feeMinor: number | null;
  readonly feeTaxMinor: number | null;
};

/**
 * One item against our row: `matched`, `amount_mismatch` (the gateway's gross differs: never matched, it stays in "Unmatched"), or `fee_mismatch` (the amount
 * agrees, the fee or its tax doesn't: matched, flagged). A row without a fee on record is not compared on fees: the fee is on record when its tax is (`charges_minor`
 * is never null, 0 for a manual payment; `fee_tax_minor` is set only when the gateway reported the fee: early check 1, finding 6; the SQL twin in
 * `settlementPageStatements`).
 */
export function matchItem(
  item: Pick<ReconItem, "amountMinor" | "feeMinor" | "taxMinor">,
  target: ReconTarget,
): "matched" | "amount_mismatch" | "fee_mismatch" {
  if (item.amountMinor !== target.amountMinor) return "amount_mismatch";
  if (
    target.feeTaxMinor !== null &&
    (item.feeMinor !== target.feeMinor || item.taxMinor !== target.feeTaxMinor)
  )
    return "fee_mismatch";
  return "matched";
}

/** The `recon.fetch` page's query (year, month, day of the IST day `day`, the count and the skip), or null for a day that isn't ISO or a bad skip. */
export function reconQueryOf(
  day: string,
  skip: number,
): { year: number; month: number; day: number; count: number; skip: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m || !Number.isSafeInteger(skip) || skip < 0) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), count: RECON_PAGE_MAX, skip };
}

/** For the warm-up (J): one made-up page read. Returns the number of items read (1). */
export function warmRecon(): number {
  try {
    const r = readRazorpayRecon(
      {
        count: 1,
        items: [
          {
            entity_id: "pay_WARM0000000001",
            type: "payment",
            amount: 10000,
            fee: 236,
            tax: 36,
            credit: 9764,
            debit: 0,
            currency: "INR",
            settlement_id: "setl_WARM00000001",
            settled_at: 1,
          },
        ],
      },
      RECON_PAGE_MAX,
    );
    return r?.items.length ?? 0;
  } catch {
    return 0;
  }
}
