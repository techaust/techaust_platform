// Credit notes after the early check [ADM-INV-11]: the INR view of a USD invoice, the original's supply, and error positions.
import { describe, expect, it } from "vitest";
import { type CreditedSoFar, computeDocument, creditNote } from "../../src/tax/index.ts";
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
  SUPPLIER_27,
} from "./fixtures.ts";

const zero = { taxableMinor: 0, cgstMinor: 0, sgstMinor: 0, igstMinor: 0 };
const none = (n: number): CreditedSoFar => ({
  lines: Array.from({ length: n }, () => zero),
  creditedTotalMinor: 0,
});
const zeroInr = { lines: [zero], totalMinor: 0 };

// Two lines to Maharashtra: 1,000,000 and 500,000 at 18 %: IGST 180,000 and 90,000; total 1,770,000
const invoice = () => good(inrDoc(REG_MH, [line(1_000_000), line(500_000, { sac: "998313" })]));

// A 3-cent USD invoice under LUT at 83.5 INR per USD: one line, INR taxable 251, no tax
const usdFx = () =>
  good(
    computeDocument(
      {
        currency: "USD",
        documentDate: DATE,
        recipient: OVERSEAS_US,
        lines: [line(3)],
        fx: { rateMicros: 83_500_000 },
      },
      DEFAULTS,
    ),
  );

describe("creditNote: the INR view of a USD invoice with an FX rate", () => {
  it("is required, line for line", () => {
    const original = usdFx();
    expect(errorsOf(creditNote(original, none(1), { kind: "full" }, DEFAULTS))).toEqual([
      "credit_shape_mismatch@credited.inr.lines",
    ]);
    expect(
      errorsOf(
        creditNote(
          original,
          { ...none(1), inr: { lines: [zero, zero], totalMinor: 0 } },
          { kind: "full" },
          DEFAULTS,
        ),
      ),
    ).toEqual(["credit_shape_mismatch@credited.inr.lines"]);
  });

  it("a line or the total credited beyond the original's INR is a mismatch at that place", () => {
    const original = usdFx();
    expect(
      errorsOf(
        creditNote(
          original,
          { ...none(1), inr: { lines: [{ ...zero, taxableMinor: 252 }], totalMinor: 0 } },
          { kind: "full" },
          DEFAULTS,
        ),
      ),
    ).toEqual(["credit_shape_mismatch@credited.inr.lines.0"]);
    for (const totalMinor of [-1, 252, 1.5, Number.NaN]) {
      expect(
        errorsOf(
          creditNote(
            original,
            { ...none(1), inr: { lines: [zero], totalMinor } },
            { kind: "full" },
            DEFAULTS,
          ),
        ),
      ).toEqual(["credit_shape_mismatch@credited.inr.totalMinor"]);
    }
  });

  it("an original with a rate but no INR figures is a mismatch", () => {
    const original = usdFx();
    expect(
      errorsOf(
        creditNote({ ...original, inr: null }, { ...none(1), inr: zeroInr }, { kind: "full" }, DEFAULTS),
      ),
    ).toEqual(["credit_shape_mismatch@original.inr"]);
    expect(
      errorsOf(
        creditNote(
          { ...original, lines: original.lines.map((l) => ({ ...l, inr: null })) },
          { ...none(1), inr: zeroInr },
          { kind: "full" },
          DEFAULTS,
        ),
      ),
    ).toEqual(["credit_shape_mismatch@original.inr"]);
  });

  it("is ignored when the original has no FX rate (USD without a rate)", () => {
    const noRate = good(
      computeDocument(
        { currency: "USD", documentDate: DATE, recipient: OVERSEAS_US, lines: [line(3)] },
        DEFAULTS,
      ),
    );
    const junk = { lines: [zero, zero, zero], totalMinor: 99 };
    const cn = good(creditNote(noRate, { ...none(1), inr: junk }, { kind: "full" }, DEFAULTS));
    expect(cn.inr).toBeNull();
    expect(cn.lines[0]?.inr).toBeNull();
  });

  it("a note whose conversion is above what is left of the INR takes only what is left", () => {
    // Earlier notes took 250 of the 251 INR for 1 of the 3 cents. 1 cent now converts to 84, but the line is not credited in full
    // (2 cents remain), so the INR taxable is min(84, 251 - 250 = 1) = 1; the total is capped the same way.
    const credited: CreditedSoFar = {
      lines: [{ ...zero, taxableMinor: 1 }],
      creditedTotalMinor: 1,
      inr: { lines: [{ ...zero, taxableMinor: 250 }], totalMinor: 250 },
    };
    const cn = good(creditNote(usdFx(), credited, { kind: "amount", taxableMinor: 1 }, DEFAULTS));
    expect(cn.inr).toMatchObject({ taxableMinor: 1, totalMinor: 1 });
  });

  it("caps each INR head at what is left of it", () => {
    // IGST-paid invoice, 100,000 cents at 83 INR: INR taxable 8,300,000, IGST 1,494,000. Earlier notes took INR IGST 1,493,990.
    // A note of 50,000 cents: INR taxable 4,150,000, IGST 4,150,000 x 0.18 = 747,000, capped at the 10 left.
    const original = good(
      computeDocument(
        {
          currency: "USD",
          documentDate: DATE,
          recipient: OVERSEAS_US,
          lines: [line(100_000)],
          fx: { rateMicros: 83_000_000 },
        },
        EXPORT_IGST,
      ),
    );
    const credited: CreditedSoFar = {
      lines: [{ ...zero, taxableMinor: 10_000, igstMinor: 1_800 }],
      creditedTotalMinor: 11_800,
      inr: { lines: [{ ...zero, taxableMinor: 830_000, igstMinor: 1_493_990 }], totalMinor: 2_323_990 },
    };
    const cn = good(creditNote(original, credited, { kind: "amount", taxableMinor: 50_000 }, EXPORT_IGST));
    expect(cn.lines[0]?.inr).toMatchObject({ taxableMinor: 4_150_000, igstMinor: 10 });
  });
});

describe("creditNote: the original's supply", () => {
  it("an original whose supply does not hold together is supply_invalid", () => {
    const original = invoice();
    expect(
      errorsOf(
        creditNote(
          { ...original, supply: { ...original.supply, type: "intra" } },
          none(2),
          { kind: "full" },
          DEFAULTS,
        ),
      ),
    ).toEqual(["supply_invalid@original.supply"]);
  });

  it("a note on an old invoice keeps the original's supplier state, whatever today's is", () => {
    // An invoice from a supplier in Maharashtra (27) to Maharashtra: intra. Today's settings say West Bengal.
    // 100,000 x 0.09 = 9,000 each; total 118,000
    const old = good(inrDoc(REG_MH, [line(100_000)], {}, SUPPLIER_27));
    expect(old.supply.type).toBe("intra");
    const cn = good(creditNote(old, none(1), { kind: "full" }, DEFAULTS));
    expect(cn.supply).toEqual(old.supply);
    expect(cn).toMatchObject({ cgstMinor: 9_000, sgstMinor: 9_000, totalMinor: 118_000 });
  });
});

describe("creditNote: exceeds_creditable is named by the position in the request", () => {
  it("a request that lists line 1 first reports position 0", () => {
    expect(
      errorsOf(
        creditNote(
          invoice(),
          none(2),
          {
            kind: "lines",
            lines: [
              { line: 1, taxableMinor: 500_001 },
              { line: 0, taxableMinor: 1 },
            ],
          },
          DEFAULTS,
        ),
      ),
    ).toEqual(["exceeds_creditable@request.lines.0"]);
  });

  it("the same line listed twice is still reported as a duplicate even when the first entry is too big", () => {
    expect(
      errorsOf(
        creditNote(
          invoice(),
          none(2),
          {
            kind: "lines",
            lines: [
              { line: 0, taxableMinor: 1_000_001 },
              { line: 0, taxableMinor: 1 },
            ],
          },
          DEFAULTS,
        ),
      ),
    ).toEqual(["exceeds_creditable@request.lines.0", "credit_line_invalid@request.lines.1"]);
  });

  it("an INR original carrying an FX view is a damaged snapshot (M4.2 re-check L4)", () => {
    const original = invoice();
    const damaged = { ...original, fxRateMicros: 83_000_000 };
    expect(errorsOf(creditNote(damaged, none(2), { kind: "full" }, DEFAULTS))).toContain(
      "credit_shape_mismatch@original.fxRateMicros",
    );
  });
});
