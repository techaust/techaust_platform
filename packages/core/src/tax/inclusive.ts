// The inclusive split [ADM-PROP-09, ADM-INV-10, docs/05 §10]: from a gross amount that already includes tax (an
// instalment, a payment received) back to lines and tax, as a tax invoice for the amount received. VERIFY WITH CA/LEGAL:
// - the gross is allocated to the source's (SAC, rate) groups by their weights, by largest remainder;
// - per group the taxable value is the largest one whose taxable value plus its own tax does not exceed the group's gross,
//   so the tax is never more than what the client paid;
// - what is left over (a few minor units) is the round-off, so the total is exactly the gross; on USD it is shown as a
//   residual.
import { allocate, type Currency, isCurrency, money } from "../money.ts";
import { computeCore, fxIssues } from "./document.ts";
import { effectiveRateBp, headsFor } from "./lines.ts";
import { supplyIssues } from "./supply.ts";
import { roundingUnit } from "./totals.ts";
import {
  BP,
  type ComputedDocument,
  type Fx,
  fail,
  floorDiv,
  guard,
  isInt,
  isIntBetween,
  issue,
  type LineInput,
  num,
  ok,
  type SummaryRow,
  type Supply,
  type TaxContext,
  type TaxIssue,
  type TaxResult,
  warn,
} from "./types.ts";

export const MAX_GROUPS = 10;

/** A (SAC, rate) group of the source document; the weight is normally its taxable value plus its taxes. */
export type InclusiveGroup = {
  readonly sac: string | null;
  readonly gstRateBp: number;
  readonly weightMinor: number;
};

/** The groups of a computed document's tax summary, weighted by taxable value plus tax (the M4.5 first-instalment draft). */
export function groupsOf(summary: readonly SummaryRow[]): InclusiveGroup[] {
  return summary.map((row) => ({
    sac: row.sac,
    gstRateBp: row.gstRateBp,
    weightMinor: row.taxableMinor + row.cgstMinor + row.sgstMinor + row.igstMinor,
  }));
}

export type InclusiveSplit = {
  /** One line per group (quantity 1, no discount): feed them to `computeDocument` to get the same document again. */
  readonly lines: LineInput[];
  readonly document: ComputedDocument;
};

/** The largest taxable value `t` with `t + tax(t) <= gross` for one group. Tax never shrinks as `t` grows, so this steps down. */
function taxableFor(gross: bigint, rateBp: number, supply: Supply): bigint {
  const effective = effectiveRateBp(rateBp, supply.type);
  const fits = (t: bigint) => {
    const h = headsFor(t, effective, supply.type);
    return t + h.cgst + h.sgst + h.igst <= gross;
  };
  // The estimate is at most 2 above the answer; the loop stops at 0, which always fits.
  let t = floorDiv(gross * BP, BP + BigInt(effective)) + 3n;
  while (!fits(t)) t -= 1n;
  return t;
}

/**
 * Splits `grossMinor` (tax included) over the groups. Returns one line per group and the computed document, whose total is
 * exactly `grossMinor` (on INR the gross must be a whole rupee when the settings round the total).
 */
export function splitInclusive(
  grossMinor: number,
  groups: readonly InclusiveGroup[],
  supply: Supply,
  currency: Currency,
  fx: Fx | null | undefined,
  ctx: TaxContext,
): TaxResult<InclusiveSplit> {
  return guard(() => {
    if (groups.length === 0) return fail([issue("no_groups", "groups")]);
    if (groups.length > MAX_GROUPS) return fail([issue("too_many_groups", "groups")]);
    const errors: TaxIssue[] = supplyIssues(supply, "supply");
    const grossOk = isInt(grossMinor) && grossMinor >= 0;
    if (!grossOk) errors.push(issue("gross_invalid", "grossMinor"));
    if (!isCurrency(currency)) errors.push(issue("currency_invalid", "currency"));
    errors.push(...fxIssues(currency, fx));
    if (grossOk && BigInt(grossMinor) % roundingUnit(currency, ctx) !== 0n) {
      errors.push(issue("gross_not_whole_unit", "grossMinor"));
    }
    groups.forEach((g, i) => {
      if (!isInt(g.weightMinor) || g.weightMinor < 0) {
        errors.push(issue("group_weight_invalid", "groups", i, "weightMinor"));
      }
      if (!isIntBetween(g.gstRateBp, 0, 10000)) {
        errors.push(issue("gst_rate_invalid", "groups", i, "gstRateBp"));
      }
    });
    if (errors.length === 0 && groups.every((g) => g.weightMinor === 0)) {
      errors.push(issue("group_weight_invalid", "groups"));
    }
    if (errors.length > 0) return fail(errors);

    // "INR" is only the label `allocate` wants.
    const shares = allocate(
      money(grossMinor, "INR"),
      groups.map((g) => g.weightMinor),
    );
    const lines: LineInput[] = groups.map((g, i) => ({
      sac: g.sac,
      qtyMilli: 1000,
      rateMinor: num(taxableFor(BigInt((shares[i] as { amount: number }).amount), g.gstRateBp, supply)),
      gstRateBp: g.gstRateBp,
      discount: null,
    }));
    const computed = computeCore(
      {
        currency,
        supply,
        lines,
        fx,
        targetTotalMinor: grossMinor,
        unregisteredRecipient: false,
        priorErrors: [],
        priorWarnings: [],
        // The rates are the source document's: today's override switch must not refuse them.
        trustRates: true,
      },
      ctx,
    );
    if (!computed.ok) return computed;
    const warnings = computed.warnings;
    if (currency === "USD" && computed.value.roundOffMinor !== 0)
      warnings.push(warn("inclusive_residual", "roundOffMinor"));
    return ok({ lines, document: computed.value }, warnings);
  });
}
