// Credit notes [ADM-INV-11, docs/05 §10, docs/08 G-11]. VERIFY WITH CA/LEGAL (s.34 CGST Act):
// - a credit note reverses tax per line, never more than what is left of that line's taxable value and of each tax head;
// - the supply (and the FX rate of a USD invoice) are always the original's;
// - a line credited in full takes exactly the tax that is left, so the credit notes of a line add up to the original line;
// - the final credit note (nothing is left on any line) takes the total that is left, so the credit notes add up to the
//   original total exactly (the round-off absorbs the difference, within the +-99.99 band).
// A debit note is `computeDocument` with `supply: original.supply` (its FX is M5.3's).
import { allocate, money } from "../money.ts";
import { type CalcLine, type Heads, headsFor } from "./lines.ts";
import { assemble } from "./totals.ts";
import {
  type ComputedDocument,
  fail,
  guard,
  isInt,
  issue,
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

/** What the issued credit notes of an invoice took so far: per original line, and the totals' sum. */
export type CreditedSoFar = {
  readonly lines: readonly CreditedLine[];
  readonly creditedTotalMinor: number;
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
      if (valid) {
        seen.add(l.line);
        take[l.line] = l.taxableMinor;
      } else {
        errors.push(issue("credit_line_invalid", "request", "lines", i));
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

const cap = (value: bigint, left: number): bigint => (value > BigInt(left) ? BigInt(left) : value);

/**
 * A credit note for part or all of an invoice. `credited` is what the earlier credit notes took (per original line, and the
 * sum of their totals). The result is the credit note as a computed document: only the lines credited now, with the
 * original line numbers in `index`.
 */
export function creditNote(
  original: ComputedDocument,
  credited: CreditedSoFar,
  request: CreditRequest,
  ctx: TaxContext,
): TaxResult<ComputedDocument> {
  return guard(() => {
    if (credited.lines.length !== original.lines.length) {
      return fail([issue("credit_shape_mismatch", "credited", "lines")]);
    }
    const errors: TaxIssue[] = [];
    const remaining: Remaining[] = [];
    original.lines.forEach((l, i) => {
      const c = credited.lines[i] as CreditedLine;
      const pairs = [
        [l.taxableMinor, c.taxableMinor],
        [l.cgstMinor, c.cgstMinor],
        [l.sgstMinor, c.sgstMinor],
        [l.igstMinor, c.igstMinor],
      ] as const;
      // Credited more than the original line, or not whole numbers: the stored figures are inconsistent.
      if (pairs.every(([o, d]) => isInt(o) && isInt(d) && d >= 0 && d <= o)) {
        remaining.push({
          taxable: l.taxableMinor - c.taxableMinor,
          cgst: l.cgstMinor - c.cgstMinor,
          sgst: l.sgstMinor - c.sgstMinor,
          igst: l.igstMinor - c.igstMinor,
        });
      } else {
        errors.push(issue("credit_shape_mismatch", "credited", "lines", i));
      }
    });
    const so = credited.creditedTotalMinor;
    if (!isInt(so) || so < 0 || so > original.totalMinor) {
      errors.push(issue("credit_shape_mismatch", "credited", "creditedTotalMinor"));
    }
    if (errors.length > 0) return fail(errors);

    const { take, errors: requestErrors } = takeFor(request, remaining);
    errors.push(...requestErrors);
    take.forEach((t, i) => {
      if (t > (remaining[i] as Remaining).taxable) {
        errors.push(issue("exceeds_creditable", "request", "lines", i));
      }
    });
    if (errors.length === 0 && take.every((t) => t === 0)) errors.push(issue("credit_empty", "request"));
    if (errors.length > 0) return fail(errors);

    const lines: CalcLine[] = [];
    original.lines.forEach((l, i) => {
      const t = take[i] as number;
      const left = remaining[i] as Remaining;
      if (t === 0) return;
      // Credited in full: exactly the tax that is left. Otherwise the line rate, never above what is left of each head.
      const rated = headsFor(BigInt(t), l.effectiveRateBp, original.supply.type);
      const heads: Heads =
        t === left.taxable
          ? { cgst: BigInt(left.cgst), sgst: BigInt(left.sgst), igst: BigInt(left.igst) }
          : {
              cgst: cap(rated.cgst, left.cgst),
              sgst: cap(rated.sgst, left.sgst),
              igst: cap(rated.igst, left.igst),
            };
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
    });
    const final = take.every((t, i) => t === (remaining[i] as Remaining).taxable);
    return assemble(
      {
        currency: original.currency,
        supply: original.supply,
        lines,
        fxRateMicros: original.fxRateMicros,
        targetTotalMinor: final ? original.totalMinor - so : undefined,
        unregisteredRecipient: false,
      },
      ctx,
    );
  });
}
