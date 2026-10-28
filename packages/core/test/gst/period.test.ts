// Return periods and month arithmetic [ADM-REP-04]: every date in exactly one month and one quarter, quarters inside the FY.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fyOfDate, isValidDate, toIsoDate } from "../../src/dates.ts";
import { addMonthsClamped, gstPeriod, inPeriod, lastDayOfMonth } from "../../src/gst/index.ts";
import { d } from "./fixtures.ts";

const range = (p: Parameters<typeof gstPeriod>[0]) => {
  const r = gstPeriod(p);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value;
};

const dateArb = fc
  .record({
    year: fc.integer({ min: 2000, max: 2100 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 31 }),
  })
  .filter(isValidDate);

describe("lastDayOfMonth", () => {
  it("knows the lengths and leap years", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => lastDayOfMonth(2026, m))).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
    expect(lastDayOfMonth(2028, 2)).toBe(29);
    expect(lastDayOfMonth(2100, 2)).toBe(28);
    expect(lastDayOfMonth(2000, 2)).toBe(29);
  });
  it("matches the Date object for every month of 1900 to 2200", () => {
    for (let y = 1900; y <= 2200; y += 1) {
      for (let m = 1; m <= 12; m += 1) {
        expect(lastDayOfMonth(y, m)).toBe(new Date(Date.UTC(y, m, 0)).getUTCDate());
      }
    }
  });
  it("refuses a month that does not exist", () => {
    expect(() => lastDayOfMonth(2026, 13)).toThrow(RangeError);
    expect(() => lastDayOfMonth(0, 1)).toThrow(RangeError);
  });
});

describe("addMonthsClamped", () => {
  it("clamps to the end of the month [Researched 2026-10-28, GSTN advisories of June 2025 (08-C RA-23)]", () => {
    expect(addMonthsClamped(d(2027, 5, 31), 9)).toEqual(d(2028, 2, 29));
    expect(addMonthsClamped(d(2026, 5, 31), 9)).toEqual(d(2027, 2, 28));
    expect(addMonthsClamped(d(2028, 2, 29), 12)).toEqual(d(2029, 2, 28));
    expect(addMonthsClamped(d(2026, 8, 31), 1)).toEqual(d(2026, 9, 30));
    expect(addMonthsClamped(d(2026, 10, 15), 9)).toEqual(d(2027, 7, 15));
    expect(addMonthsClamped(d(2026, 10, 15), 0)).toEqual(d(2026, 10, 15));
  });
  it("crosses years forwards and backwards", () => {
    expect(addMonthsClamped(d(2026, 12, 15), 1)).toEqual(d(2027, 1, 15));
    expect(addMonthsClamped(d(2026, 1, 15), -1)).toEqual(d(2025, 12, 15));
    expect(addMonthsClamped(d(2026, 3, 31), -1)).toEqual(d(2026, 2, 28));
    expect(addMonthsClamped(d(2026, 1, 31), -12)).toEqual(d(2025, 1, 31));
    expect(addMonthsClamped(d(2026, 1, 31), 24)).toEqual(d(2028, 1, 31));
  });
  it("always gives a valid date, never earlier for a positive count", () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: 0, max: 60 }), (date, n) => {
        const out = addMonthsClamped(date, n);
        expect(isValidDate(out)).toBe(true);
        expect(toIsoDate(out) >= toIsoDate(date)).toBe(true);
        expect(out.day).toBeLessThanOrEqual(date.day);
      }),
    );
  });
  it("refuses a fraction of a month", () => {
    expect(() => addMonthsClamped(d(2026, 1, 1), 1.5)).toThrow(RangeError);
  });
});

describe("gstPeriod", () => {
  it("a month runs from the 1st to its last day", () => {
    expect(range({ kind: "month", year: 2026, month: 2 })).toEqual({
      from: d(2026, 2, 1),
      to: d(2026, 2, 28),
    });
    expect(range({ kind: "month", year: 2028, month: 2 })).toEqual({
      from: d(2028, 2, 1),
      to: d(2028, 2, 29),
    });
    expect(range({ kind: "month", year: 2026, month: 12 })).toEqual({
      from: d(2026, 12, 1),
      to: d(2026, 12, 31),
    });
  });
  it("the four QRMP quarters of FY 2026-27", () => {
    expect(range({ kind: "quarter", fyStartYear: 2026, quarter: 1 })).toEqual({
      from: d(2026, 4, 1),
      to: d(2026, 6, 30),
    });
    expect(range({ kind: "quarter", fyStartYear: 2026, quarter: 2 })).toEqual({
      from: d(2026, 7, 1),
      to: d(2026, 9, 30),
    });
    expect(range({ kind: "quarter", fyStartYear: 2026, quarter: 3 })).toEqual({
      from: d(2026, 10, 1),
      to: d(2026, 12, 31),
    });
    expect(range({ kind: "quarter", fyStartYear: 2026, quarter: 4 })).toEqual({
      from: d(2027, 1, 1),
      to: d(2027, 3, 31),
    });
  });
  it("every date is in exactly one month and exactly one quarter", () => {
    fc.assert(
      fc.property(dateArb, (date) => {
        const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((month) =>
          inPeriod(date, range({ kind: "month", year: date.year, month })),
        );
        expect(months).toEqual([date.month]);
        const fy = fyOfDate(date).startYear;
        const quarters = ([1, 2, 3, 4] as const).filter((quarter) =>
          inPeriod(date, range({ kind: "quarter", fyStartYear: fy, quarter })),
        );
        expect(quarters).toHaveLength(1);
        // and in none of the neighbouring years' months
        expect(inPeriod(date, range({ kind: "month", year: date.year + 1, month: date.month }))).toBe(false);
      }),
      { numRuns: 500 },
    );
  });
  it("a quarter's months all belong to its own financial year", () => {
    for (const fy of [2025, 2026, 2027, 2099]) {
      for (const quarter of [1, 2, 3, 4] as const) {
        const r = range({ kind: "quarter", fyStartYear: fy, quarter });
        expect(fyOfDate(r.from).startYear).toBe(fy);
        expect(fyOfDate(r.to).startYear).toBe(fy);
      }
    }
  });
  it("month 13, quarter 5, year 0 and other nonsense are period_invalid", () => {
    const bad: unknown[] = [
      { kind: "month", year: 2026, month: 13 },
      { kind: "month", year: 2026, month: 0 },
      { kind: "month", year: 0, month: 1 },
      { kind: "month", year: 2026.5, month: 1 },
      { kind: "quarter", fyStartYear: 2026, quarter: 5 },
      { kind: "quarter", fyStartYear: 2026, quarter: 0 },
      { kind: "quarter", fyStartYear: 0, quarter: 1 },
      { kind: "quarter", fyStartYear: 9999, quarter: 1 },
      { kind: "week" },
    ];
    for (const p of bad) {
      const r = gstPeriod(p as Parameters<typeof gstPeriod>[0]);
      expect(r).toEqual({ ok: false, errors: [{ code: "period_invalid", path: ["period"] }] });
    }
  });
});
