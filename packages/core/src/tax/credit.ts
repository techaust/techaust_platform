// Credit notes [ADM-INV-11, docs/05 §10, docs/08 G-11]. Researched 2026-10-28, s.34(2) CGST Act (08-C RA-03) (s.34 CGST Act):
// - a credit note reverses tax per line, never more than what is left of that line's taxable value and of each tax head;
// - the supply (and the FX rate of a USD invoice) are always the original's;
// - a line credited in full takes exactly the tax that is left, so the credit notes of a line add up to the original line;
// - the totals round cumulatively: a note's total is the rounded total of everything credited so far (this note included)
//   minus the totals of the earlier notes, never more than what is left of the original total, so a run of notes can never
//   add up to more than the invoice and the remainder can always be credited;
// - the final credit note (nothing is left on any line) takes the total that is left, so the credit notes add up to the
//   original total exactly (the round-off absorbs the difference, within the +-99.99 band);
// - a USD invoice's INR view follows the same rules: per line and per head caps, a line credited in full takes its exact
//   INR remainder, and the final note's INR total is the original's minus the earlier notes'.
// A debit note is `computeDocument` with `supply: original.supply` (its FX is M5.3's).
import { allocate, divRoundHalfUp, isCurrency, money } from "../money.ts";
import { type CalcLine, type Heads, headsFor } from "./lines.ts";
import { supplyIssues } from "./supply.ts";
import { assemble, type InrLineParts, type InrPlan, roundingUnit } from "./totals.ts";
import {
  type ComputedDocument,
  type ComputedLineInr,
  clamp,
  fail,
  guard,
  isInt,
  isIntBetween,
  issue,
  MICROS,
  num,
  type TaxContext,
  type TaxIssue,
  type TaxResult,
} from "./types.ts";

/** What earlier credit notes took from one original line. */
export type CreditedLine = {
  readonly taxableMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
  readonly igstMinor: number;
};

/** What earlier credit notes took of the INR view of a USD invoice: per original line, and the sum of their INR totals. */
export type CreditedInr = {
  readonly lines: readonly CreditedLine[];
  readonly totalMinor: number;
};

/**
 * What the issued credit notes of an invoice took so far: per original line, and the totals' sum. `inr` is required when
 * the original has an INR view (a USD invoice with an FX rate) and ignored otherwise.
 */
export type CreditedSoFar = {
  readonly lines: readonly CreditedLine[];
  readonly creditedTotalMinor: number;
  readonly inr?: CreditedInr | null | undefined;
};

export type CreditRequest =
  | { readonly kind: "full" }
  | {
      readonly kind: "lines";
      readonly lines: readonly { readonly line: number; readonly taxableMinor: number }[];
    }
  | { readonly kind: "amount"; readonly taxableMinor: number };

type Remaining = {
  readonly taxable: number;
  readonly cgst: number;
  readonly sgst: number;
  readonly igst: number;
};

/** The taxable value to credit on each original line, or the errors. */
function takeFor(
  request: CreditRequest,
  remaining: readonly Remaining[],
): { take: number[]; errors: TaxIssue[] } {
  const take = remaining.map(() => 0);
  const errors: TaxIssue[] = [];
  if (request.kind === "full") return { take: remaining.map((r) => r.taxable), errors };
  if (request.kind === "lines") {
    const seen = new Set<number>();
    request.lines.forEach((l, i) => {
      const valid =
        isInt(l.line) &&
        l.line >= 0 &&
        l.line < remaining.length &&
        !seen.has(l.line) &&
        isInt(l.taxableMinor) &&
        l.taxableMinor >= 0;
      if (!valid) {
        errors.push(issue("credit_line_invalid", "request", "lines", i));
        return;
      }
      seen.add(l.line);
      take[l.line] = l.taxableMinor;
      // Named by its position in the request, not by the original's line number.
      if (l.taxableMinor > (remaining[l.line] as Remaining).taxable) {
        errors.push(issue("exceeds_creditable", "request", "lines", i));
      }
    });
    return { take, errors };
  }
  if (request.kind === "amount") {
    if (!isInt(request.taxableMinor) || request.taxableMinor < 0) {
      errors.push(issue("credit_line_invalid", "request", "taxableMinor"));
    } else if (request.taxableMinor > remaining.reduce((a, r) => a + r.taxable, 0)) {
      errors.push(issue("exceeds_creditable", "request", "taxableMinor"));
    } else if (request.taxableMinor > 0) {
      // "INR" is only the label `allocate` wants.
      const shares = allocate(
        money(request.taxableMinor, "INR"),
        remaining.map((r) => r.taxable),
      );
      shares.forEach((s, i) => {
        take[i] = s.amount;
      });
    }
    return { take, errors };
  }
  return { take, errors: [issue("credit_line_invalid", "request", "kind")] };
}

const cap = (value: bigint, left: number): bigint => clamp(value, 0n, BigInt(left));

/** What is left of one line (or of its INR view) after the earlier notes, or null if the stored figures are inconsistent. */
function leftOf(original: CreditedLine, credited: CreditedLine): Remaining | null {
  const pairs = [
    [original.taxableMinor, credited.taxableMinor],
    [original.cgstMinor, credited.cgstMinor],
    [original.sgstMinor, credited.sgstMinor],
    [original.igstMinor, credited.igstMinor],
  ] as const;
  // Credited more than the original, or not whole numbers: the stored figures are inconsistent.
  if (!pairs.every(([o, c]) => isInt(o) && isInt(c) && c >= 0 && c <= o)) return null;
  return {
    taxable: original.taxableMinor - credited.taxableMinor,
    cgst: original.cgstMinor - credited.cgstMinor,
    sgst: original.sgstMinor - credited.sgstMinor,
    igst: original.igstMinor - credited.igstMinor,
  };
}

/**
 * The parts of the stored original that the maths uses beyond the per-line amounts (those `leftOf` checks): the currency, the
 * totals, the FX rate and each line's index and rates. A figure that is not a whole number, or a rate outside 0 to 100 %,
 * means the snapshot is damaged: `credit_shape_mismatch`, never a crash.
 */
function originalIssues(original: ComputedDocument): TaxIssue[] {
  const issues: TaxIssue[] = [];
  if (!isCurrency(original.currency)) issues.push(issue("credit_shape_mismatch", "original", "currency"));
  if (!isInt(original.totalMinor) || original.totalMinor < 0) {
    issues.push(issue("credit_shape_mismatch", "original", "totalMinor"));
  }
  const rate = original.fxRateMicros;
  // An INR document has no FX view; a damaged snapshot that carries one is refused.
  if (original.currency === "INR" && (rate !== null || original.inr !== null)) {
    issues.push(issue("credit_shape_mismatch", "original", "fxRateMicros"));
  }
  if (rate !== null && (!isInt(rate) || rate < 1)) {
    issues.push(issue("credit_shape_mismatch", "original", "fxRateMicros"));
  }
  if (
    rate !== null &&
    original.inr !== null &&
    (!isInt(original.inr.totalMinor) || original.inr.totalMinor < 0)
  ) {
    issues.push(issue("credit_shape_mismatch", "original", "inr", "totalMinor"));
  }
  original.lines.forEach((l, i) => {
    if (
      !isInt(l.index) ||
      !isIntBetween(l.gstRateBp, 0, 10000) ||
      !isIntBetween(l.effectiveRateBp, 0, 10000)
    ) {
      issues.push(issue("credit_shape_mismatch", "original", "lines", i));
    }
  });
  return issues;
}

const sumOf = (c: CreditedLine): bigint =>
  BigInt(c.taxableMinor) + BigInt(c.cgstMinor) + BigInt(c.sgstMinor) + BigInt(c.igstMinor);

/**
 * A credit note for part or all of an invoice. `credited` is what the earlier credit notes took (per original line, and the
 * sum of their totals; for a USD invoice with an FX rate also the INR view). The result is the credit note as a computed
 * document: only the lines credited now, with the original line numbers in `index`.
 */
export function creditNote(
  original: ComputedDocument,
  credited: CreditedSoFar,
  request: CreditRequest,
  ctx: TaxContext,
): TaxResult<ComputedDocument> {
  return guard(() => {
    const errors: TaxIssue[] = supplyIssues(original.supply, "original", "supply");
    if (credited.lines.length !== original.lines.length) {
      errors.push(issue("credit_shape_mismatch", "credited", "lines"));
    }
    errors.push(...originalIssues(original));
    if (errors.length > 0) return fail(errors);

    const remaining: Remaining[] = [];
    original.lines.forEach((l, i) => {
      const left = leftOf(l, credited.lines[i] as CreditedLine);
      if (left) remaining.push(left);
      else errors.push(issue("credit_shape_mismatch", "credited", "lines", i));
    });
    const so = credited.creditedTotalMinor;
    if (!isInt(so) || so < 0 || so > original.totalMinor) {
      errors.push(issue("credit_shape_mismatch", "credited", "creditedTotalMinor"));
    }

    // The INR view of a USD invoice with a rate: what is left of each line and of the total.
    const rate = original.fxRateMicros;
    const inrLeft: Remaining[] = [];
    let inrTotalLeft = 0n;
    if (rate !== null) {
      const originalInr = original.inr;
      const creditedInr = credited.inr;
      if (originalInr === null || original.lines.some((l) => l.inr === null)) {
        errors.push(issue("credit_shape_mismatch", "original", "inr"));
      } else if (!creditedInr || creditedInr.lines.length !== original.lines.length) {
        errors.push(issue("credit_shape_mismatch", "credited", "inr", "lines"));
      } else {
        original.lines.forEach((l, i) => {
          const o = l.inr as ComputedLineInr;
          const left = leftOf(o, creditedInr.lines[i] as CreditedLine);
          if (left) inrLeft.push(left);
          else errors.push(issue("credit_shape_mismatch", "credited", "inr", "lines", i));
        });
        if (
          !isInt(creditedInr.totalMinor) ||
          creditedInr.totalMinor < 0 ||
          creditedInr.totalMinor > originalInr.totalMinor
        ) {
          errors.push(issue("credit_shape_mismatch", "credited", "inr", "totalMinor"));
        } else {
          inrTotalLeft = BigInt(originalInr.totalMinor - creditedInr.totalMinor);
        }
      }
    }
    if (errors.length > 0) return fail(errors);

    const { take, errors: requestErrors } = takeFor(request, remaining);
    errors.push(...requestErrors);
    if (errors.length === 0 && take.every((t) => t === 0)) errors.push(issue("credit_empty", "request"));
    if (errors.length > 0) return fail(errors);

    const lines: CalcLine[] = [];
    const inrLines: InrLineParts[] = [];
    original.lines.forEach((l, i) => {
      const t = take[i] as number;
      const left = remaining[i] as Remaining;
      if (t === 0) return;
      // Credited in full: exactly the tax that is left. Otherwise the line rate, never above what is left of each head.
      const full = t === left.taxable;
      const heads: Heads = full
        ? { cgst: BigInt(left.cgst), sgst: BigInt(left.sgst), igst: BigInt(left.igst) }
        : capHeads(headsFor(BigInt(t), l.effectiveRateBp, original.supply.type), left);
      lines.push({
        index: l.index,
        sac: l.sac,
        gross: BigInt(t),
        lineDiscount: 0n,
        docDiscount: 0n,
        taxable: BigInt(t),
        gstRateBp: l.gstRateBp,
        effectiveRateBp: l.effectiveRateBp,
        ...heads,
      });
      if (rate !== null) {
        // The same rules in INR: the note's USD taxable value converted at the original's rate (never above what is left),
        // and the tax on that at the line's rate; a line credited in full takes its exact INR remainder.
        const inr = inrLeft[i] as Remaining;
        const taxable = full
          ? BigInt(inr.taxable)
          : cap(divRoundHalfUp(BigInt(t) * BigInt(rate), MICROS), inr.taxable);
        inrLines.push({
          taxable,
          ...(full
            ? { cgst: BigInt(inr.cgst), sgst: BigInt(inr.sgst), igst: BigInt(inr.igst) }
            : capHeads(headsFor(taxable, l.effectiveRateBp, original.supply.type), inr)),
        });
      }
    });

    const final = take.every((t, i) => t === (remaining[i] as Remaining).taxable);
    const left = BigInt(original.totalMinor - so);
    let target: bigint;
    if (final) {
      target = left;
    } else {
      // Everything credited so far, this note included, rounded once; this note's total is what that adds to.
      const unit = roundingUnit(original.currency, ctx);
      const everything =
        credited.lines.reduce((a, c) => a + sumOf(c), 0n) +
        lines.reduce((a, l) => a + l.taxable + l.cgst + l.sgst + l.igst, 0n);
      target = clamp(divRoundHalfUp(everything, unit) * unit - BigInt(so), 0n, left);
    }
    const inrPlan: InrPlan | undefined =
      rate === null ? undefined : { lines: inrLines, totalLeft: inrTotalLeft, final };
    return assemble(
      {
        currency: original.currency,
        supply: original.supply,
        lines,
        fxRateMicros: rate,
        targetTotalMinor: num(target),
        unregisteredRecipient: false,
        inrPlan,
      },
      ctx,
    );
  });
}

/**
 * A debit note that adds TAX ONLY ("Tax charged too low", s.34(3) CGST Act; owner 2026-10-28, Q35; Researched 2026-10-28, 08-C RA-22): the taxable value of every
 * line is zero and `taxMinor` (the total tax to add, in the original's currency, above zero) is split over the original's lines that carry tax, in proportion to
 * the tax each carries (largest remainder, so the parts add up exactly), at the original's supply and heads: an intra-state original adds CGST and SGST in equal
 * halves (so `taxMinor` must be even), an inter-state or IGST export original adds IGST. The original's index, SAC and rates are copied; a USD original's INR view
 * converts each head at the original's rate. Refused: a tax of zero or less, an odd amount on an intra-state original, an original with no tax on any line (an
 * export under LUT: nothing to correct by tax alone). There is no cap here: how much tax was missing is the Owner's figure. Never throws.
 */
export function taxOnlyDebitNote(
  original: ComputedDocument,
  taxMinor: number,
  ctx: TaxContext,
): TaxResult<ComputedDocument> {
  return guard(() => {
    const errors: TaxIssue[] = supplyIssues(original.supply, "original", "supply");
    errors.push(...originalIssues(original));
    if (errors.length > 0) return fail(errors);
    if (!isInt(taxMinor) || taxMinor < 1) return fail([issue("credit_line_invalid", "request", "taxMinor")]);
    const type = original.supply.type;
    const taxed = original.lines.filter((l) => l.cgstMinor + l.sgstMinor + l.igstMinor > 0);
    if (taxed.length === 0) return fail([issue("credit_empty", "request")]);
    const intra = type === "intra";
    if (intra && taxMinor % 2 !== 0) return fail([issue("credit_line_invalid", "request", "taxMinor")]);
    // "INR" is only the label `allocate` wants. For an intra-state original each head takes half of the amount, split over the lines by their CGST.
    const shares = allocate(
      money(intra ? Number(BigInt(taxMinor) / 2n) : taxMinor, "INR"),
      taxed.map((l) => (intra ? l.cgstMinor : l.igstMinor)),
    ).map((m) => BigInt(m.amount));
    const rate = original.fxRateMicros;
    const lines: CalcLine[] = [];
    const inrLines: InrLineParts[] = [];
    taxed.forEach((l, i) => {
      const share = shares[i] as bigint;
      const heads: Heads = intra
        ? { cgst: share, sgst: share, igst: 0n }
        : { cgst: 0n, sgst: 0n, igst: share };
      lines.push({
        index: l.index,
        sac: l.sac,
        gross: 0n,
        lineDiscount: 0n,
        docDiscount: 0n,
        taxable: 0n,
        gstRateBp: l.gstRateBp,
        effectiveRateBp: l.effectiveRateBp,
        ...heads,
      });
      if (rate !== null) {
        const inr = (h: bigint) => divRoundHalfUp(h * BigInt(rate), MICROS);
        inrLines.push({ taxable: 0n, cgst: inr(heads.cgst), sgst: inr(heads.sgst), igst: inr(heads.igst) });
      }
    });
    const inrSum = inrLines.reduce((a, p) => a + p.cgst + p.sgst + p.igst, 0n);
    return assemble(
      {
        currency: original.currency,
        supply: original.supply,
        lines,
        fxRateMicros: rate,
        unregisteredRecipient: false,
        inrPlan: rate === null ? undefined : { lines: inrLines, totalLeft: inrSum, final: false },
      },
      ctx,
    );
  });
}

/** Each head limited to what is left of it. */
function capHeads(heads: Heads, left: Remaining): Heads {
  return {
    cgst: cap(heads.cgst, left.cgst),
    sgst: cap(heads.sgst, left.sgst),
    igst: cap(heads.igst, left.igst),
  };
}
