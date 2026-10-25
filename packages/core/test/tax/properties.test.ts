// Property tests of the tax engine [ADM-INV-05, ADM-INV-08, ADM-INV-09; docs/05 §10]: sums are exact, nothing is negative,
// allocations conserve, the engine is repeatable, and the supply follows the place of supply. 300 runs each.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { StateCode } from "../../src/gstin.ts";
import {
  type ComputedDocument,
  computeDocument,
  type Discount,
  determineSupply,
  type LineInput,
} from "../../src/tax/index.ts";
import {
  DATE,
  GSTIN_29,
  good,
  makeCtx,
  OVERSEAS_US,
  REG_MH,
  REG_WB,
  registered,
  unregistered,
} from "./fixtures.ts";

const RUNS = { numRuns: 300 } as const;

// ---- generators: valid documents (every generated input must compute) ----
const rawLine = fc.record({
  rate: fc.integer({ min: 0, max: 200_000_000 }),
  qty: fc.integer({ min: 1, max: 20_000 }),
  bp: fc.constantFrom<number | undefined>(undefined, 0, 500, 1200, 1800, 2800, 10_000),
  kind: fc.constantFrom("none", "percent", "fixed"),
  val: fc.integer({ min: 0, max: 10_000 }),
});

/** gross = qty x rate / 1,000 rounded half up (numbers are safe here: at most 4 x 10^12). */
const grossOf = (qty: number, rate: number) => Math.floor((qty * rate + 500) / 1000);
const halfUp = (n: number, bp: number) => Math.floor((n * bp + 5000) / 10_000);

function makeLine(raw: { rate: number; qty: number; bp: number | undefined; kind: string; val: number }): {
  line: LineInput;
  net: number;
} {
  const gross = grossOf(raw.qty, raw.rate);
  const discount: Discount | null =
    raw.kind === "percent"
      ? { kind: "percent", bp: raw.val }
      : raw.kind === "fixed"
        ? { kind: "fixed", minor: Math.floor((gross * raw.val) / 10_000) }
        : null;
  const lineDiscount =
    discount === null ? 0 : discount.kind === "percent" ? halfUp(gross, discount.bp) : discount.minor;
  return {
    line: { sac: "998314", qtyMilli: raw.qty, rateMinor: raw.rate, gstRateBp: raw.bp, discount },
    net: gross - lineDiscount,
  };
}

const recipients = [
  REG_WB,
  REG_MH,
  registered(GSTIN_29),
  unregistered("19"),
  unregistered("33"),
  unregistered("97"),
  OVERSEAS_US,
];

const scenario = fc.record({
  supplier: fc.constantFrom<StateCode>("19", "27", "29"),
  recipient: fc.constantFrom(...recipients),
  currency: fc.constantFrom<"INR" | "USD">("INR", "USD"),
  mode: fc.constantFrom<"lut" | "igst_paid">("lut", "igst_paid"),
  lines: fc.array(rawLine, { minLength: 1, maxLength: 8 }),
  docKind: fc.constantFrom("none", "percent", "fixed"),
  docVal: fc.integer({ min: 0, max: 10_000 }),
  fx: fc.integer({ min: 1, max: 200_000_000 }),
  withFx: fc.boolean(),
});
type Scenario = {
  supplier: StateCode;
  recipient: (typeof recipients)[number];
  currency: "INR" | "USD";
  mode: "lut" | "igst_paid";
  lines: Parameters<typeof makeLine>[0][];
  docKind: string;
  docVal: number;
  fx: number;
  withFx: boolean;
};

function build(s: Scenario) {
  const made = s.lines.map(makeLine);
  const subtotalNet = made.reduce((a, m) => a + m.net, 0);
  const documentDiscount: Discount | null =
    s.docKind === "percent"
      ? { kind: "percent", bp: s.docVal }
      : s.docKind === "fixed"
        ? { kind: "fixed", minor: Math.floor((subtotalNet * s.docVal) / 10_000) }
        : null;
  const ctx = makeCtx({ supplier: s.supplier, tax: { exportMode: s.mode } });
  const input = {
    currency: s.currency,
    documentDate: DATE,
    recipient: s.recipient,
    lines: made.map((m) => m.line),
    documentDiscount,
    fx: s.currency === "USD" && s.withFx ? { rateMicros: s.fx } : null,
  } as const;
  const d = good(computeDocument(input, ctx));
  return { d, input, ctx, nets: made.map((m) => m.net), documentDiscount };
}

const sumOf = (d: ComputedDocument, pick: (l: ComputedDocument["lines"][number]) => number) =>
  d.lines.reduce((a, l) => a + pick(l), 0);

describe("property: sums are exact", () => {
  it("subtotal - discount = taxable; taxable + taxes + round-off = total; lines add up to the totals", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { d } = build(s);
        expect(d.subtotalMinor - d.discountMinor).toBe(d.taxableMinor);
        expect(d.taxableMinor + d.cgstMinor + d.sgstMinor + d.igstMinor + d.roundOffMinor).toBe(d.totalMinor);
        expect(sumOf(d, (l) => l.grossMinor)).toBe(d.subtotalMinor);
        expect(sumOf(d, (l) => l.discountMinor)).toBe(d.discountMinor);
        expect(sumOf(d, (l) => l.taxableMinor)).toBe(d.taxableMinor);
        expect(sumOf(d, (l) => l.cgstMinor)).toBe(d.cgstMinor);
        expect(sumOf(d, (l) => l.sgstMinor)).toBe(d.sgstMinor);
        expect(sumOf(d, (l) => l.igstMinor)).toBe(d.igstMinor);
        expect(sumOf(d, (l) => l.lineTotalMinor)).toBe(
          d.taxableMinor + d.cgstMinor + d.sgstMinor + d.igstMinor,
        );
        for (const l of d.lines) {
          expect(l.grossMinor - l.discountMinor).toBe(l.taxableMinor);
          expect(l.lineDiscountMinor + l.documentDiscountMinor).toBe(l.discountMinor);
        }
        // the tax summary adds up to the document too
        expect(d.summary.reduce((a, r) => a + r.taxableMinor, 0)).toBe(d.taxableMinor);
        expect(d.summary.reduce((a, r) => a + r.igstMinor, 0)).toBe(d.igstMinor);
        expect(d.summary.reduce((a, r) => a + r.cgstMinor + r.sgstMinor, 0)).toBe(d.cgstMinor + d.sgstMinor);
      }),
      RUNS,
    );
  });
});

describe("property: nothing is negative and no head is above the exact tax rounded up", () => {
  it("amounts are >= 0; each head <= ceil(taxable x rate / divisor)", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { d } = build(s);
        for (const l of d.lines) {
          for (const v of [
            l.grossMinor,
            l.discountMinor,
            l.taxableMinor,
            l.cgstMinor,
            l.sgstMinor,
            l.igstMinor,
            l.lineTotalMinor,
          ]) {
            expect(v).toBeGreaterThanOrEqual(0);
          }
          const divisor = d.supply.type === "intra" ? 20_000n : 10_000n;
          const exactCeil = (BigInt(l.taxableMinor) * BigInt(l.effectiveRateBp) + divisor - 1n) / divisor;
          for (const head of [l.cgstMinor, l.sgstMinor, l.igstMinor])
            expect(BigInt(head)).toBeLessThanOrEqual(exactCeil);
        }
        expect(d.totalMinor).toBeGreaterThanOrEqual(0);
      }),
      RUNS,
    );
  });
});

describe("property: the document discount is allocated without losing or inventing a paisa", () => {
  it("the shares add up to the discount, each is within 1 minor unit of exact and between 0 and the line's net", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { d, nets, documentDiscount } = build(s);
        const subtotalNet = nets.reduce((a, n) => a + n, 0);
        const expected =
          documentDiscount === null
            ? 0
            : documentDiscount.kind === "fixed"
              ? documentDiscount.minor
              : halfUp(subtotalNet, documentDiscount.bp);
        const shares = d.lines.map((l) => l.documentDiscountMinor);
        expect(shares.reduce((a, v) => a + v, 0)).toBe(expected);
        shares.forEach((share, i) => {
          const net = nets[i] as number;
          expect(share).toBeGreaterThanOrEqual(0);
          expect(share).toBeLessThanOrEqual(net);
          // |share - expected x net / subtotalNet| < 1, kept in integers: |share x subtotalNet - expected x net| < subtotalNet
          const diff = BigInt(share) * BigInt(subtotalNet) - BigInt(expected) * BigInt(net);
          expect((diff < 0n ? -diff : diff) < BigInt(Math.max(subtotalNet, 1))).toBe(true);
        });
      }),
      RUNS,
    );
  });
});

describe("property: the engine is repeatable", () => {
  it("the same input gives the same output, and the output re-fed as plain lines gives the same taxes and total", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { d, input, ctx } = build(s);
        expect(good(computeDocument(input, ctx))).toEqual(d);
        const refed = good(
          computeDocument(
            {
              currency: d.currency,
              documentDate: DATE,
              supply: d.supply,
              lines: d.lines.map((l) => ({
                sac: l.sac,
                qtyMilli: 1000,
                rateMinor: l.taxableMinor,
                gstRateBp: l.gstRateBp,
              })),
              fx: d.fxRateMicros === null ? null : { rateMicros: d.fxRateMicros },
            },
            ctx,
          ),
        );
        expect(refed.lines.map((l) => [l.taxableMinor, l.cgstMinor, l.sgstMinor, l.igstMinor])).toEqual(
          d.lines.map((l) => [l.taxableMinor, l.cgstMinor, l.sgstMinor, l.igstMinor]),
        );
        expect([
          refed.taxableMinor,
          refed.cgstMinor,
          refed.sgstMinor,
          refed.igstMinor,
          refed.roundOffMinor,
          refed.totalMinor,
        ]).toEqual([d.taxableMinor, d.cgstMinor, d.sgstMinor, d.igstMinor, d.roundOffMinor, d.totalMinor]);
        expect(refed.inr).toEqual(d.inr);
        // rounding the total again changes nothing
        if (d.currency === "INR") expect(d.totalMinor % 100).toBe(0);
      }),
      RUNS,
    );
  });
});

describe("property: heads and round-off", () => {
  it("intra: CGST = SGST on every line and no IGST; otherwise no CGST/SGST; LUT charges nothing", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { d } = build(s);
        for (const l of d.lines) {
          if (d.supply.type === "intra") {
            expect(l.cgstMinor).toBe(l.sgstMinor);
            expect(l.igstMinor).toBe(0);
          } else {
            expect(l.cgstMinor).toBe(0);
            expect(l.sgstMinor).toBe(0);
          }
          if (d.supply.type === "export_lut") {
            expect(l.effectiveRateBp).toBe(0);
            expect(l.igstMinor).toBe(0);
          }
        }
      }),
      RUNS,
    );
  });

  it("INR round-off is -49 to +50 paise and the total a whole rupee; USD has no round-off", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { d } = build(s);
        if (d.currency === "INR") {
          expect(d.roundOffMinor).toBeGreaterThanOrEqual(-49);
          expect(d.roundOffMinor).toBeLessThanOrEqual(50);
          expect(d.totalMinor % 100).toBe(0);
        } else {
          expect(d.roundOffMinor).toBe(0);
        }
      }),
      RUNS,
    );
  });
});

describe("property: the supply follows the place of supply", () => {
  it("intra exactly when the place of supply is the supplier's state; export exactly when the recipient is overseas", () => {
    fc.assert(
      fc.property(scenario, ({ supplier, recipient, mode }) => {
        const ctx = makeCtx({ supplier, tax: { exportMode: mode } });
        const supply = good(determineSupply(recipient, ctx, { documentDate: DATE, currency: "USD" }));
        const overseas = recipient.gstStatus === "overseas";
        expect(supply.type.startsWith("export")).toBe(overseas);
        expect(supply.supplierStateCode).toBe(supplier);
        if (overseas) {
          expect(supply.placeOfSupplyCode).toBe("96");
          expect(supply.type).toBe(mode === "lut" ? "export_lut" : "export_igst");
        } else {
          expect(supply.type === "intra").toBe(supply.placeOfSupplyCode === supplier);
          // a registered recipient's place of supply is its GSTIN's state
          if (recipient.gstStatus === "registered")
            expect(supply.placeOfSupplyCode).toBe((recipient.gstin as string).slice(0, 2));
        }
      }),
      RUNS,
    );
  });
});

describe("property: the INR view of a USD document", () => {
  it("the line INR taxable values add up to the USD taxable converted at the captured rate, half up", () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { d } = build({ ...s, currency: "USD", withFx: true });
        const exact = (BigInt(d.taxableMinor) * BigInt(d.fxRateMicros as number) + 500_000n) / 1_000_000n;
        expect(BigInt(d.inr?.taxableMinor as number)).toBe(exact);
        expect(d.lines.reduce((a, l) => a + (l.inr?.taxableMinor as number), 0)).toBe(Number(exact));
        const inr = d.inr as NonNullable<typeof d.inr>;
        expect(inr.taxableMinor + inr.cgstMinor + inr.sgstMinor + inr.igstMinor + inr.roundOffMinor).toBe(
          inr.totalMinor,
        );
        expect(d.lines.reduce((a, l) => a + (l.inr?.igstMinor as number), 0)).toBe(inr.igstMinor);
      }),
      RUNS,
    );
  });
});
