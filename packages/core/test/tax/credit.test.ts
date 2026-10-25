// Credit notes [ADM-INV-11]: the cases the golden table does not name.
import { describe, expect, it } from "vitest";
import { type CreditedSoFar, type CreditRequest, computeDocument, creditNote } from "../../src/tax/index.ts";
import {
  DATE,
  DEFAULTS,
  EXPORT_IGST,
  errorsOf,
  good,
  inrDoc,
  line,
  OVERSEAS_US,
  REG_MH,
  REG_WB,
} from "./fixtures.ts";

const zero = { taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0 };
const none = (n: number): CreditedSoFar => ({
  lines: Array.from({ length: n }, () => zero),
  creditedTotalMinor: 0,
});

// Two lines to Maharashtra: 1,000,000 and 500,000 at 18 %: IGST 180,000 and 90,000; total 1,770,000
const invoice = () => good(inrDoc(REG_MH, [line(1_000_000), line(500_000, { sac: "998313" })]));

describe("creditNote: shape of what was credited", () => {
  it("must match the original line for line", () => {
    expect(errorsOf(creditNote(invoice(), none(1), { kind: "full" }, DEFAULTS))).toEqual([
      "credit_shape_mismatch@credited.lines",
    ]);
    expect(errorsOf(creditNote(invoice(), none(3), { kind: "full" }, DEFAULTS))).toEqual([
      "credit_shape_mismatch@credited.lines",
    ]);
  });

  it("a line credited more than the original, or by a non-whole number, is a mismatch at that line", () => {
    const over = { ...zero, igstMinor: 180_001 };
    expect(
      errorsOf(
        creditNote(invoice(), { lines: [over, zero], creditedTotalMinor: 0 }, { kind: "full" }, DEFAULTS),
      ),
    ).toEqual(["credit_shape_mismatch@credited.lines.0"]);
    for (const taxableMinor of [-1, 1.5, Number.NaN, 1_000_001]) {
      expect(
        errorsOf(
          creditNote(
            invoice(),
            { lines: [zero, { ...zero, taxableMinor }], creditedTotalMinor: 0 },
            { kind: "full" },
            DEFAULTS,
          ),
        ),
      ).toEqual(["credit_shape_mismatch@credited.lines.1"]);
    }
  });

  it("the credited total must be between 0 and the original total", () => {
    for (const creditedTotalMinor of [-1, 1.5, Number.NaN, 1_770_001]) {
      expect(
        errorsOf(
          creditNote(invoice(), { lines: [zero, zero], creditedTotalMinor }, { kind: "full" }, DEFAULTS),
        ),
      ).toEqual(["credit_shape_mismatch@credited.creditedTotalMinor"]);
    }
  });
});

describe("creditNote: requests", () => {
  const run = (request: CreditRequest, credited = none(2)) =>
    creditNote(invoice(), credited, request, DEFAULTS);

  it("lines: bad entries are named by their position in the request", () => {
    const entries = [
      { line: -1, taxableMinor: 10 },
      { line: 2, taxableMinor: 10 },
      { line: 0.5, taxableMinor: 10 },
      { line: 0, taxableMinor: -1 },
      { line: 0, taxableMinor: 1.5 },
    ];
    expect(errorsOf(run({ kind: "lines", lines: entries }))).toEqual(
      entries.map((_, i) => `credit_line_invalid@request.lines.${i}`),
    );
  });

  it("lines: the same line twice is invalid", () => {
    expect(
      errorsOf(
        run({
          kind: "lines",
          lines: [
            { line: 0, taxableMinor: 10 },
            { line: 0, taxableMinor: 20 },
          ],
        }),
      ),
    ).toEqual(["credit_line_invalid@request.lines.1"]);
  });

  it("nothing to credit is credit_empty: no lines, zero amounts, nothing left", () => {
    expect(errorsOf(run({ kind: "lines", lines: [] }))).toEqual(["credit_empty@request"]);
    expect(errorsOf(run({ kind: "lines", lines: [{ line: 0, taxableMinor: 0 }] }))).toEqual([
      "credit_empty@request",
    ]);
    expect(errorsOf(run({ kind: "amount", taxableMinor: 0 }))).toEqual(["credit_empty@request"]);
    const all = { ...zero, taxableMinor: 1_000_000, igstMinor: 180_000 };
    const rest = { ...zero, taxableMinor: 500_000, igstMinor: 90_000 };
    expect(errorsOf(run({ kind: "full" }, { lines: [all, rest], creditedTotalMinor: 1_770_000 }))).toEqual([
      "credit_empty@request",
    ]);
  });

  it("an amount must be a non-negative whole number and at most what is left", () => {
    for (const taxableMinor of [-1, 1.5, Number.NaN]) {
      expect(errorsOf(run({ kind: "amount", taxableMinor }))).toEqual([
        "credit_line_invalid@request.taxableMinor",
      ]);
    }
    expect(errorsOf(run({ kind: "amount", taxableMinor: 1_500_001 }))).toEqual([
      "exceeds_creditable@request.taxableMinor",
    ]);
  });

  it("an unknown kind is invalid", () => {
    expect(errorsOf(run({ kind: "refund" } as unknown as CreditRequest))).toEqual([
      "credit_line_invalid@request.kind",
    ]);
  });

  it("a line over what is left is exceeds_creditable at that line; the other lines are still reported", () => {
    expect(
      errorsOf(
        run({
          kind: "lines",
          lines: [
            { line: 0, taxableMinor: 1_000_001 },
            { line: 1, taxableMinor: 500_001 },
          ],
        }),
      ),
    ).toEqual(["exceeds_creditable@request.lines.0", "exceeds_creditable@request.lines.1"]);
  });
});

describe("creditNote: results", () => {
  it("an amount is shared over the lines by what is left on each", () => {
    // 300,000 over 1,000,000 : 500,000 = 200,000 and 100,000; IGST 36,000 and 18,000; preRound 354,000 (a whole rupee)
    const cn = good(creditNote(invoice(), none(2), { kind: "amount", taxableMinor: 300_000 }, DEFAULTS));
    expect(cn.lines.map((l) => [l.index, l.sac, l.taxableMinor, l.igstMinor])).toEqual([
      [0, "998314", 200_000, 36_000],
      [1, "998313", 100_000, 18_000],
    ]);
    expect(cn).toMatchObject({
      subtotalMinor: 300_000,
      discountMinor: 0,
      taxableMinor: 300_000,
      igstMinor: 54_000,
      roundOffMinor: 0,
      totalMinor: 354_000,
    });
    expect(cn.supply).toEqual(invoice().supply);
    expect(cn.lines.map((l) => [l.grossMinor, l.gstRateBp, l.effectiveRateBp])).toEqual([
      [200_000, 1800, 1800],
      [100_000, 1800, 1800],
    ]);
  });

  it("an amount equal to everything that is left is the final credit note: it takes the total that is left", () => {
    const cn = good(creditNote(invoice(), none(2), { kind: "amount", taxableMinor: 1_500_000 }, DEFAULTS));
    expect(cn).toMatchObject({
      taxableMinor: 1_500_000,
      igstMinor: 270_000,
      roundOffMinor: 0,
      totalMinor: 1_770_000,
    });
  });

  it("lines: credits only the named lines and keeps the original line numbers", () => {
    const cn = good(
      creditNote(
        invoice(),
        none(2),
        { kind: "lines", lines: [{ line: 1, taxableMinor: 500_000 }] },
        DEFAULTS,
      ),
    );
    expect(cn.lines.map((l) => l.index)).toEqual([1]);
    // line 1 is credited in full: it takes exactly its own tax, 90,000
    expect(cn).toMatchObject({ taxableMinor: 500_000, igstMinor: 90_000, totalMinor: 590_000 });
  });

  it("a credit note on an intra-state invoice keeps CGST equal to SGST", () => {
    const original = good(inrDoc(REG_WB, [line(100_050)]));
    const cn = good(creditNote(original, none(1), { kind: "amount", taxableMinor: 50_025 }, DEFAULTS));
    // 50,025 x 0.09 = 4,502.25 -> 4,502 each; preRound 59,029 -> 59,000 (590.29); RO -29
    expect(cn).toMatchObject({
      cgstMinor: 4_502,
      sgstMinor: 4_502,
      igstMinor: 0,
      roundOffMinor: -29,
      totalMinor: 59_000,
    });
  });

  it("a line with nothing taxable (a 100 % discount) is skipped by a full credit note", () => {
    const original = good(
      inrDoc(REG_MH, [line(1_000_000), line(500_000, { discount: { kind: "percent", bp: 10_000 } })]),
    );
    const cn = good(creditNote(original, none(2), { kind: "full" }, DEFAULTS));
    expect(cn.lines.map((l) => l.index)).toEqual([0]);
    expect(cn.totalMinor).toBe(original.totalMinor);
  });

  it("USD originals: no rounding to dollars, the original's FX", () => {
    // $1,000.00 = 100,000 cents with IGST paid: 18,000; total 118,000. Credit 25,001 cents: 25,001 x 0.18 = 4,500.18 -> 4,500; total 29,501
    const usd = good(
      computeDocument(
        { currency: "USD", documentDate: DATE, recipient: OVERSEAS_US, lines: [line(100_000)] },
        EXPORT_IGST,
      ),
    );
    const cn = good(creditNote(usd, none(1), { kind: "amount", taxableMinor: 25_001 }, EXPORT_IGST));
    expect(cn).toMatchObject({ currency: "USD", igstMinor: 4_500, roundOffMinor: 0, totalMinor: 29_501 });
  });
});
