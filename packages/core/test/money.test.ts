import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  add,
  allocate,
  applyBps,
  type Currency,
  compare,
  divRoundHalfUp,
  formatMoney,
  isCurrency,
  money,
  negate,
  parseMoney,
  subtract,
  sum,
  toDecimalString,
} from "../src/money.ts";

const inr = (amount: number) => money(amount, "INR");
const usd = (amount: number) => money(amount, "USD");
const currencyArb = fc.constantFrom<Currency>("INR", "USD");
const amountArb = fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER });

describe("money values [ADM-G-07]", () => {
  it("accepts only safe integers and known currencies", () => {
    expect(inr(12345)).toEqual({ amount: 12345, currency: "INR" });
    expect(() => inr(1.5)).toThrow(RangeError);
    expect(() => inr(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => inr(Number.NaN)).toThrow(RangeError);
    expect(() => money(1, "EUR" as Currency)).toThrow(TypeError);
    expect(isCurrency("USD")).toBe(true);
    expect(isCurrency("toString")).toBe(false);
  });

  it("adds, subtracts, negates, sums and compares in the same currency only", () => {
    expect(add(inr(150), inr(250))).toEqual(inr(400));
    expect(subtract(inr(150), inr(250))).toEqual(inr(-100));
    expect(negate(inr(5))).toEqual(inr(-5));
    expect(Object.is(negate(inr(0)).amount, 0)).toBe(true);
    expect(sum([usd(1), usd(2), usd(3)], "USD")).toEqual(usd(6));
    expect(sum([], "INR")).toEqual(inr(0));
    expect([compare(inr(1), inr(2)), compare(inr(2), inr(2)), compare(inr(3), inr(2))]).toEqual([-1, 0, 1]);
    expect(() => add(inr(1), usd(1))).toThrow(TypeError);
    expect(() => add(inr(Number.MAX_SAFE_INTEGER), inr(1))).toThrow(RangeError);
  });
});

describe("rounding and percentages", () => {
  it("rounds half away from zero", () => {
    expect([5n, 15n, 25n, -5n, -15n, 4n, -4n].map((n) => divRoundHalfUp(n, 10n))).toEqual([
      1n,
      2n,
      3n,
      -1n,
      -2n,
      0n,
      0n,
    ]);
    expect(divRoundHalfUp(7n, -2n)).toBe(-4n);
    expect(() => divRoundHalfUp(1n, 0n)).toThrow(RangeError);
  });

  it("applies basis points with paise rounding (18 % of ₹0.03 is 0.54 paise → 1 paisa)", () => {
    expect(applyBps(inr(10_000_00), 1_800)).toEqual(inr(1_800_00));
    expect(applyBps(inr(3), 1_800)).toEqual(inr(1));
    expect(applyBps(inr(2), 2_500)).toEqual(inr(1)); // 0.5 paisa rounds up
    expect(applyBps(inr(-2), 2_500)).toEqual(inr(-1));
    expect(() => applyBps(inr(1), 1.5)).toThrow(RangeError);
  });

  it("never loses precision on large amounts (bigint maths)", () => {
    expect(applyBps(inr(9_007_199_254_740), 10_000)).toEqual(inr(9_007_199_254_740));
    expect(() => applyBps(inr(Number.MAX_SAFE_INTEGER), 20_000)).toThrow(RangeError);
  });
});

describe("allocate: payment schedules always add up [ADM-PROP-03]", () => {
  it("splits by weight with the leftover paise going to the largest remainders", () => {
    expect(allocate(inr(100), [1, 1, 1]).map((m) => m.amount)).toEqual([34, 33, 33]);
    expect(allocate(inr(10_000_01), [4_000, 3_000, 3_000]).map((m) => m.amount)).toEqual([
      4_000_01, 3_000_00, 3_000_00,
    ]);
    expect(allocate(inr(-100), [1, 1, 1]).map((m) => m.amount)).toEqual([-34, -33, -33]);
    expect(allocate(inr(5), [0, 1]).map((m) => m.amount)).toEqual([0, 5]);
  });

  it("rejects bad weights", () => {
    expect(() => allocate(inr(1), [])).toThrow(RangeError);
    expect(() => allocate(inr(1), [0, 0])).toThrow(RangeError);
    expect(() => allocate(inr(1), [-1, 2])).toThrow(RangeError);
    expect(() => allocate(inr(1), [0.5])).toThrow(RangeError);
  });

  it("property: parts sum exactly to the total, each within one unit of its exact share", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e12, max: 1e12 }),
        fc
          .array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 12 })
          .filter((w) => w.some((x) => x > 0)),
        (total, weights) => {
          const parts = allocate(inr(total), weights);
          expect(parts.reduce((a, p) => a + p.amount, 0)).toBe(total);
          const W = weights.reduce((a, w) => a + w, 0);
          parts.forEach((p, i) => {
            const exact = (BigInt(total) * BigInt(weights[i] as number) * 1000n) / BigInt(W);
            const diff = BigInt(p.amount) * 1000n - exact;
            expect(diff < 0n ? -diff : diff).toBeLessThan(1000n);
          });
        },
      ),
    );
  });
});

describe("formatting", () => {
  it("uses the Indian system for INR and the international one for USD", () => {
    expect(formatMoney(inr(1_23_456_50))).toBe("₹1,23,456.50");
    expect(formatMoney(inr(3_00_000_00))).toBe("₹3,00,000.00");
    expect(formatMoney(usd(123_456_50))).toBe("$123,456.50");
    expect(formatMoney(inr(5))).toBe("₹0.05");
    expect(formatMoney(inr(1_23_45_67_890_12), { symbol: false })).toBe("1,23,45,67,890.12");
  });

  it("shows negatives with a typographic minus (owner decision)", () => {
    expect(formatMoney(inr(-1_000_00))).toBe("−₹1,000.00");
    expect(formatMoney(usd(-5))).toBe("−$0.05");
  });

  it("is exact for the largest safe amount (no float conversion)", () => {
    expect(toDecimalString(inr(Number.MAX_SAFE_INTEGER))).toBe("90071992547409.91");
    expect(formatMoney(inr(Number.MAX_SAFE_INTEGER))).toBe("₹9,00,71,99,25,47,409.91");
    expect(toDecimalString(inr(-7))).toBe("-0.07");
  });
});

describe("parsing what people type", () => {
  const ok = (s: string, c: Currency = "INR") => {
    const r = parseMoney(s, c);
    if (!r.ok) throw new Error(`${s}: ${r.error}`);
    return r.value.amount;
  };
  const err = (s: string, c: Currency = "INR") => {
    const r = parseMoney(s, c);
    return r.ok ? null : r.error;
  };

  it("accepts symbols, codes, either grouping and up to 2 decimals", () => {
    expect(ok("1,23,456.5")).toBe(1_23_456_50);
    expect(ok("123,456.50")).toBe(1_23_456_50);
    expect(ok("₹ 5000")).toBe(5_000_00);
    expect(ok("Rs. 1,000.00")).toBe(1_000_00);
    expect(ok("INR 12")).toBe(12_00);
    expect(ok("  0.05 ")).toBe(5);
    expect(ok("-$12.30", "USD")).toBe(-12_30);
    expect(ok("$-12.30", "USD")).toBe(-12_30);
    expect(ok("US$ 1,000,000", "USD")).toBe(1_000_000_00);
    expect(ok("−₹1,000.00")).toBe(-1_000_00);
    expect(Object.is(ok("-0"), 0)).toBe(true);
  });

  it("rejects garbage, bad grouping, extra decimals and overflow", () => {
    expect(err("")).toBe("Enter an amount");
    expect(err("₹")).toBe("Enter an amount");
    expect(err("12.345")).toBe("Use at most 2 decimal places");
    expect(err("1,2,3")).toMatch(/Enter an amount like/);
    expect(err("12,34")).toMatch(/Enter an amount like/);
    expect(err("abc")).toMatch(/Enter an amount like/);
    expect(err("$5")).toMatch(/Enter an amount like/); // a dollar sign in a rupee field
    expect(err("1e5")).toMatch(/Enter an amount like/);
    expect(err("99999999999999999")).toBe("That amount is too large");
  });

  it("property: parse(format(x)) === x for every amount and currency", () => {
    fc.assert(
      fc.property(amountArb, currencyArb, fc.boolean(), (amount, cur, symbol) => {
        const m = money(amount, cur);
        const back = parseMoney(formatMoney(m, { symbol }), cur);
        expect(back).toEqual({ ok: true, value: m });
      }),
      { numRuns: 2_000 },
    );
  });
});
