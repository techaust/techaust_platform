// Lines: gross, discounts and tax per line per head [ADM-INV-05, ADM-INV-09, docs/05 §10, docs/08 G-10]. VERIFY WITH CA/LEGAL:
// - a line's gross is quantity (milli-units) × rate, rounded half up to the minor unit;
// - a document discount is taken on the net after line discounts and allocated to lines by largest remainder, so the
//   line taxable values sum exactly; discounts are before tax (s.15(3)(a) CGST Act);
// - each tax head is rounded half up on its own, per line (CGST and SGST are each half the rate, never 18 % then split);
// - the totals are the sums of the lines.
import { allocate, divRoundHalfUp, money } from "../money.ts";
import {
  BP,
  type Discount,
  fail,
  isInt,
  isIntBetween,
  issue,
  type LineInput,
  num,
  ok,
  type SupplyType,
  type TaxContext,
  type TaxIssue,
  type TaxResult,
  type TaxWarning,
  warn,
} from "./types.ts";

export const MAX_LINES = 100;
const SAC = /^\d{6}$/;

/** A line before tax: amounts in bigint (nothing overflows until the end). */
export type PreLine = {
  readonly index: number;
  readonly sac: string | null;
  readonly gross: bigint;
  readonly lineDiscount: bigint;
  readonly docDiscount: bigint;
  readonly taxable: bigint;
  readonly gstRateBp: number;
};

export type Heads = { readonly cgst: bigint; readonly sgst: bigint; readonly igst: bigint };

export type CalcLine = PreLine & Heads & { readonly effectiveRateBp: number };

/** The rate that is applied: 0 under LUT, else the line's. */
export const effectiveRateBp = (rateBp: number, type: SupplyType): number =>
  type === "export_lut" ? 0 : rateBp;

/**
 * Tax per head on a taxable value at an effective rate. Intra-state: CGST and SGST are each `taxable × rate / 20,000`
 * rounded half up; otherwise IGST is `taxable × rate / 10,000` (a zero rate gives zero).
 */
export function headsFor(taxable: bigint, effectiveRate: number, type: SupplyType): Heads {
  const rate = BigInt(effectiveRate);
  if (type === "intra") {
    const half = divRoundHalfUp(taxable * rate, 2n * BP);
    return { cgst: half, sgst: half, igst: 0n };
  }
  return { cgst: 0n, sgst: 0n, igst: divRoundHalfUp(taxable * rate, BP) };
}

function discountIssue(d: Discount | null | undefined, ...path: (string | number)[]): TaxIssue | null {
  if (d === null || d === undefined) return null;
  const good =
    d.kind === "fixed"
      ? isInt(d.minor) && d.minor >= 0
      : d.kind === "percent" && isIntBetween(d.bp, 0, 10000);
  return good ? null : issue("discount_invalid", ...path);
}

/** The amount of a discount on a base. */
function discountOf(d: Discount | null | undefined, base: bigint): bigint {
  if (d === null || d === undefined) return 0n;
  return d.kind === "fixed" ? BigInt(d.minor) : divRoundHalfUp(base * BigInt(d.bp), BP);
}

/**
 * Validates every line and the document discount (all errors collected before any maths), then computes gross, line
 * discount, the document discount's share and the taxable value of each line. The rate of a line without one is the
 * default rate from the settings.
 */
export function prepareLines(
  lines: readonly LineInput[],
  documentDiscount: Discount | null | undefined,
  ctx: TaxContext,
): TaxResult<PreLine[]> {
  if (lines.length === 0) return fail([issue("no_lines", "lines")]);
  if (lines.length > MAX_LINES) return fail([issue("too_many_lines", "lines")]);
  const errors: TaxIssue[] = [];
  const warnings: TaxWarning[] = [];
  const rates: number[] = [];
  lines.forEach((l, i) => {
    if (!isInt(l.qtyMilli) || l.qtyMilli < 1) errors.push(issue("qty_invalid", "lines", i, "qtyMilli"));
    if (!isInt(l.rateMinor) || l.rateMinor < 0) errors.push(issue("rate_invalid", "lines", i, "rateMinor"));
    let rate = ctx.tax.defaultRateBp;
    if (l.gstRateBp !== undefined) {
      if (!isIntBetween(l.gstRateBp, 0, 10000)) {
        errors.push(issue("gst_rate_invalid", "lines", i, "gstRateBp"));
      } else if (!ctx.tax.allowLineOverride && l.gstRateBp !== rate) {
        errors.push(issue("rate_override_not_allowed", "lines", i, "gstRateBp"));
      } else {
        rate = l.gstRateBp;
      }
    }
    rates.push(rate);
    if (l.sac === null) warnings.push(warn("sac_missing", "lines", i, "sac"));
    else if (!SAC.test(l.sac)) errors.push(issue("sac_invalid", "lines", i, "sac"));
    const bad = discountIssue(l.discount, "lines", i, "discount");
    if (bad) errors.push(bad);
  });
  const badDocument = discountIssue(documentDiscount, "documentDiscount");
  if (badDocument) errors.push(badDocument);
  if (errors.length > 0) return fail(errors);

  const grosses = lines.map((l) => divRoundHalfUp(BigInt(l.qtyMilli) * BigInt(l.rateMinor), 1000n));
  const lineDiscounts = lines.map((l, i) => discountOf(l.discount, grosses[i] as bigint));
  lineDiscounts.forEach((d, i) => {
    if (d > (grosses[i] as bigint)) errors.push(issue("discount_exceeds_line", "lines", i, "discount"));
  });
  // A line discount over its line makes the nets meaningless, so the document discount is judged only once the lines are right.
  if (errors.length > 0) return fail(errors);
  const nets = grosses.map((g, i) => g - (lineDiscounts[i] as bigint));
  const subtotalNet = nets.reduce((a, n) => a + n, 0n);
  const d = discountOf(documentDiscount, subtotalNet);
  if (d > subtotalNet) errors.push(issue("document_discount_exceeds_subtotal", "documentDiscount"));
  if (errors.length > 0) return fail(errors);

  // "INR" is only the label `allocate` wants; the shares are minor units of the document's currency.
  const shares =
    d === 0n
      ? nets.map(() => 0n)
      : allocate(money(num(d), "INR"), nets.map(num)).map((m) => BigInt(m.amount));
  return ok(
    lines.map((l, index) => ({
      index,
      sac: l.sac,
      gross: grosses[index] as bigint,
      lineDiscount: lineDiscounts[index] as bigint,
      docDiscount: shares[index] as bigint,
      taxable: (nets[index] as bigint) - (shares[index] as bigint),
      gstRateBp: rates[index] as number,
    })),
    warnings,
  );
}

/** Applies the tax to prepared lines for a supply type. */
export function taxLines(lines: readonly PreLine[], type: SupplyType): CalcLine[] {
  return lines.map((l) => {
    const effective = effectiveRateBp(l.gstRateBp, type);
    return { ...l, effectiveRateBp: effective, ...headsFor(l.taxable, effective, type) };
  });
}
