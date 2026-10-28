// Totals, round-off and the INR view of a USD document: the one assembly shared by documents, inclusive splits and credit
// notes [ADM-INV-05, ADM-INV-08, docs/05 §10, docs/08 G-9, G-10]. Researched 2026-10-28, rule by rule in 08-C section 1:
// - totals are the sums of the lines; the round-off makes the INR total a whole rupee (-49 to +50 paise, half up); USD is
//   never rounded;
// - a target total (inclusive splits, final credit notes) sets the round-off to the difference, within +-99.99 (the
//   e-invoice portal's band);
// - USD with FX (Rule 34(2) CGST Rules): the INR taxable value is the USD one converted at the captured rate, allocated to
//   the lines, and the INR tax is computed on it at each line's rate.

import { allocate, type Currency, divRoundHalfUp, money } from "../money.ts";
import { amountInWords } from "../words.ts";
import { type CalcLine, type Heads, headsFor } from "./lines.ts";
import {
  type ComputedDocument,
  type ComputedInr,
  type ComputedLine,
  type ComputedLineInr,
  clamp,
  fail,
  isInt,
  issue,
  MAX_TOTAL_MINOR,
  MICROS,
  num,
  ok,
  type SummaryRow,
  type Supply,
  type TaxContext,
  type TaxIssue,
  type TaxResult,
  type TaxWarning,
  warn,
} from "./types.ts";

/** The IRP's round-off band, in minor units (+-99.99). */
export const ROUND_OFF_BAND = 9999n;

/** 100 (a whole rupee) for an INR document when the settings round the total, else 1. */
export const roundingUnit = (currency: Currency, ctx: TaxContext): bigint =>
  currency === "INR" && ctx.tax.rounding.totalInr === "nearest_rupee" ? 100n : 1n;

export type AssembleInput = {
  readonly currency: Currency;
  readonly supply: Supply;
  readonly lines: readonly CalcLine[];
  /** INR micros per USD; null on INR documents and on USD documents without a rate. */
  readonly fxRateMicros: number | null;
  /** Set the total instead of rounding (inclusive splits and final credit notes only). */
  readonly targetTotalMinor?: number | undefined;
  /** The recipient is unregistered (a B2C document): the details warning applies. */
  readonly unregisteredRecipient: boolean;
  /** The INR view worked out by the caller (credit notes), instead of converting this document's own taxable value. */
  readonly inrPlan?: InrPlan | undefined;
};

/** One line's INR taxable value and tax. */
export type InrLineParts = Heads & { readonly taxable: bigint };

/**
 * The INR view of a credit note of a USD invoice: the lines are worked out against what is left of the original's INR
 * figures; `totalLeft` is the original's INR total minus the INR totals of the earlier notes. The final note takes exactly
 * that; any other note stays within it.
 */
export type InrPlan = {
  readonly lines: readonly InrLineParts[];
  readonly totalLeft: bigint;
  readonly final: boolean;
};

/** The INR document figures from its lines and round-off (the lines' INR taxable values and heads are given). */
function inrDocument(
  parts: readonly InrLineParts[],
  roundOff: bigint,
): { perLine: ComputedLineInr[]; document: ComputedInr } {
  const sum = (pick: (p: InrLineParts) => bigint) => parts.reduce((a, p) => a + pick(p), 0n);
  const taxable = sum((p) => p.taxable);
  const cgst = sum((p) => p.cgst);
  const sgst = sum((p) => p.sgst);
  const igst = sum((p) => p.igst);
  return {
    perLine: parts.map((p) => ({
      taxableMinor: num(p.taxable),
      cgstMinor: num(p.cgst),
      sgstMinor: num(p.sgst),
      igstMinor: num(p.igst),
      lineTotalMinor: num(p.taxable + p.cgst + p.sgst + p.igst),
    })),
    document: {
      taxableMinor: num(taxable),
      cgstMinor: num(cgst),
      sgstMinor: num(sgst),
      igstMinor: num(igst),
      roundOffMinor: num(roundOff),
      totalMinor: num(taxable + cgst + sgst + igst + roundOff),
    },
  };
}

/** The INR view of a USD document: each line's INR taxable value and tax, and the document's. */
function inrParts(
  lines: readonly CalcLine[],
  rate: bigint,
  supply: Supply,
  taxable: bigint,
  roundOff: bigint,
  plan: InrPlan | undefined,
): { perLine: ComputedLineInr[]; document: ComputedInr } {
  if (plan !== undefined) {
    // A credit note: the lines are given. The final note's INR total is exactly what is left; the others follow the USD
    // round-off but never go above what is left (or below 0).
    const sum = plan.lines.reduce((a, p) => a + p.taxable + p.cgst + p.sgst + p.igst, 0n);
    const total = plan.final
      ? plan.totalLeft
      : clamp(sum + divRoundHalfUp(roundOff * rate, MICROS), 0n, plan.totalLeft);
    return inrDocument(plan.lines, total - sum);
  }
  const inrTaxable = divRoundHalfUp(taxable * rate, MICROS);
  // "INR" is the label `allocate` wants; weights are the lines' taxable values in the document currency.
  const shares =
    inrTaxable > 0n
      ? allocate(
          money(num(inrTaxable), "INR"),
          lines.map((l) => num(l.taxable)),
        ).map((m) => BigInt(m.amount))
      : lines.map(() => 0n);
  const parts = lines.map((l, i) => ({
    taxable: shares[i] as bigint,
    ...headsFor(shares[i] as bigint, l.effectiveRateBp, supply.type),
  }));
  return inrDocument(parts, divRoundHalfUp(roundOff * rate, MICROS));
}

/** The tax summary grouped by (SAC, rate) in order of first appearance: the PDF's tax table and the GSTR-1 HSN lines. */
function summarise(lines: readonly CalcLine[]): SummaryRow[] {
  const groups = new Map<
    string,
    { sac: string | null; gstRateBp: number; effective: number; t: bigint; c: bigint; s: bigint; i: bigint }
  >();
  for (const l of lines) {
    const key = `${String(l.sac)}|${l.gstRateBp}`;
    const g = groups.get(key) ?? {
      sac: l.sac,
      gstRateBp: l.gstRateBp,
      effective: l.effectiveRateBp,
      t: 0n,
      c: 0n,
      s: 0n,
      i: 0n,
    };
    g.t += l.taxable;
    g.c += l.cgst;
    g.s += l.sgst;
    g.i += l.igst;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({
    sac: g.sac,
    gstRateBp: g.gstRateBp,
    effectiveRateBp: g.effective,
    taxableMinor: num(g.t),
    cgstMinor: num(g.c),
    sgstMinor: num(g.s),
    igstMinor: num(g.i),
  }));
}

/** Sums the lines, rounds off (or hits the target), writes the words and the INR view. */
export function assemble(input: AssembleInput, ctx: TaxContext): TaxResult<ComputedDocument> {
  const { currency, supply, lines } = input;
  const sum = (pick: (l: CalcLine) => bigint) => lines.reduce((a, l) => a + pick(l), 0n);
  const subtotal = sum((l) => l.gross);
  const discount = sum((l) => l.lineDiscount + l.docDiscount);
  const taxable = sum((l) => l.taxable);
  const cgst = sum((l) => l.cgst);
  const sgst = sum((l) => l.sgst);
  const igst = sum((l) => l.igst);
  const preRound = taxable + cgst + sgst + igst;
  const unit = roundingUnit(currency, ctx);

  let total: bigint;
  if (input.targetTotalMinor === undefined) {
    total = divRoundHalfUp(preRound, unit) * unit;
  } else {
    const errors: TaxIssue[] = [];
    const target = input.targetTotalMinor;
    if (!isInt(target) || target < 0) {
      return fail([issue("target_out_of_band", "targetTotalMinor")]);
    }
    const gap = BigInt(target) - preRound;
    if (gap > ROUND_OFF_BAND || gap < -ROUND_OFF_BAND) {
      errors.push(issue("target_out_of_band", "targetTotalMinor"));
    }
    if (BigInt(target) % unit !== 0n) errors.push(issue("target_not_whole_unit", "targetTotalMinor"));
    if (errors.length > 0) return fail(errors);
    total = BigInt(target);
  }
  if (total > MAX_TOTAL_MINOR) return fail([issue("total_too_large", "totalMinor")]);
  const roundOff = total - preRound;

  const inr =
    input.fxRateMicros === null
      ? null
      : inrParts(lines, BigInt(input.fxRateMicros), supply, taxable, roundOff, input.inrPlan);
  const computedLines: ComputedLine[] = lines.map((l, i) => ({
    index: l.index,
    sac: l.sac,
    grossMinor: num(l.gross),
    lineDiscountMinor: num(l.lineDiscount),
    documentDiscountMinor: num(l.docDiscount),
    discountMinor: num(l.lineDiscount + l.docDiscount),
    taxableMinor: num(l.taxable),
    gstRateBp: l.gstRateBp,
    effectiveRateBp: l.effectiveRateBp,
    cgstMinor: num(l.cgst),
    sgstMinor: num(l.sgst),
    igstMinor: num(l.igst),
    lineTotalMinor: num(l.taxable + l.cgst + l.sgst + l.igst),
    inr: inr ? (inr.perLine[i] as ComputedLineInr) : null,
  }));

  const warnings: TaxWarning[] = [];
  if (
    input.unregisteredRecipient &&
    currency === "INR" &&
    total >= BigInt(ctx.tax.b2cDetailsThresholdInrMinor)
  ) {
    warnings.push(warn("b2c_details_required", "recipient"));
  }
  return ok(
    {
      currency,
      supply,
      fxRateMicros: input.fxRateMicros,
      lines: computedLines,
      summary: summarise(lines),
      subtotalMinor: num(subtotal),
      discountMinor: num(discount),
      taxableMinor: num(taxable),
      cgstMinor: num(cgst),
      sgstMinor: num(sgst),
      igstMinor: num(igst),
      roundOffMinor: num(roundOff),
      totalMinor: num(total),
      words: amountInWords(money(num(total), currency)),
      inr: inr ? inr.document : null,
    },
    warnings,
  );
}
