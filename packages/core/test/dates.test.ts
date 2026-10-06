import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  financialYear,
  formatDate,
  formatIstDateTime,
  fromIst,
  fyOf,
  fyOfDate,
  istDate,
  isValidDate,
  parseIsoDate,
  toIsoDate,
  toIst,
} from "../src/dates.ts";

const utc = (iso: string) => Date.parse(iso);

describe("IST conversion [ADM-G-08]", () => {
  it("is UTC+05:30 all year (no daylight saving)", () => {
    expect(toIst(utc("2026-10-06T08:35:10Z"))).toEqual({
      year: 2026,
      month: 10,
      day: 6,
      hour: 14,
      minute: 5,
      second: 10,
    });
    expect(toIst(utc("2026-01-15T20:00:00Z"))).toMatchObject({
      year: 2026,
      month: 1,
      day: 16,
      hour: 1,
      minute: 30,
    });
    expect(fromIst({ year: 2026, month: 10, day: 6 }, 14, 5)).toBe(utc("2026-10-06T08:35:00Z"));
    expect(() => toIst(1.5)).toThrow(RangeError);
    expect(() => fromIst({ year: 2026, month: 2, day: 30 })).toThrow(RangeError);
  });

  it("property: fromIst(toIst(t)) === t to the second", () => {
    fc.assert(
      fc.property(fc.integer({ min: utc("1990-01-01T00:00:00Z"), max: utc("2100-01-01T00:00:00Z") }), (t) => {
        const s = t - (t % 1000);
        const x = toIst(s);
        expect(fromIst(x, x.hour, x.minute, x.second)).toBe(s);
      }),
    );
  });

  it("validates calendar dates, including leap years", () => {
    expect(isValidDate({ year: 2028, month: 2, day: 29 })).toBe(true);
    expect(isValidDate({ year: 2027, month: 2, day: 29 })).toBe(false);
    expect(isValidDate({ year: 2026, month: 13, day: 1 })).toBe(false);
    expect(isValidDate({ year: 2026, month: 1, day: 1.5 })).toBe(false);
    expect(isValidDate({ year: 0, month: 1, day: 1 })).toBe(false);
  });

  it("adds days across month and year ends", () => {
    expect(addDays({ year: 2027, month: 3, day: 15 }, 30)).toEqual({ year: 2027, month: 4, day: 14 });
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 });
    expect(addDays({ year: 2028, month: 3, day: 1 }, -1)).toEqual({ year: 2028, month: 2, day: 29 });
    expect(daysBetween({ year: 2026, month: 10, day: 6 }, { year: 2026, month: 11, day: 5 })).toBe(30);
    expect(() => addDays({ year: 2026, month: 1, day: 1 }, 0.5)).toThrow(RangeError);
  });

  it("reads and writes ISO dates and display formats", () => {
    expect(toIsoDate({ year: 2026, month: 4, day: 1 })).toBe("2026-04-01");
    expect(parseIsoDate("2026-04-01")).toEqual({ year: 2026, month: 4, day: 1 });
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("2026-4-1")).toBeNull();
    expect(formatDate({ year: 2026, month: 10, day: 6 })).toBe("06 Oct 2026");
    expect(formatIstDateTime(utc("2026-10-06T08:35:00Z"))).toBe("06 Oct 2026, 14:05 IST");
    expect(istDate(utc("2026-03-31T18:30:00Z"))).toEqual({ year: 2026, month: 4, day: 1 });
  });
});

describe("financial year (1 April – 31 March)", () => {
  it("names the year and its document token", () => {
    const fy = financialYear(2026);
    expect(fy.label).toBe("2026-27");
    expect(fy.token).toBe("2627");
    expect(financialYear(2099).token).toBe("9900");
    expect(financialYear(2009).label).toBe("2009-10");
    expect(() => financialYear(2026.5)).toThrow(RangeError);
    expect(() => financialYear(9999)).toThrow(RangeError);
  });

  it("boundary: 31 Mar 23:59:59 IST is the old FY, 1 Apr 00:00 IST the new one", () => {
    const lastSecond = fromIst({ year: 2027, month: 3, day: 31 }, 23, 59, 59);
    const firstInstant = fromIst({ year: 2027, month: 4, day: 1 });
    expect(fyOf(lastSecond).label).toBe("2026-27");
    expect(fyOf(firstInstant).label).toBe("2027-28");
    expect(fyOf(firstInstant - 1).label).toBe("2026-27");
    // 1 Apr 00:00 IST is still 31 March in UTC: the IST date decides.
    expect(new Date(firstInstant).toISOString()).toBe("2027-03-31T18:30:00.000Z");
    expect(financialYear(2026).endMs).toBe(firstInstant);
    expect(financialYear(2027).startMs).toBe(firstInstant);
  });

  it("FY of a calendar date", () => {
    expect(fyOfDate({ year: 2027, month: 1, day: 10 }).startYear).toBe(2026);
    expect(fyOfDate({ year: 2026, month: 4, day: 1 }).startYear).toBe(2026);
    expect(fyOfDate({ year: 2026, month: 3, day: 31 }).startYear).toBe(2025);
  });

  it("property: every instant lies inside the FY it is assigned to", () => {
    fc.assert(
      fc.property(fc.integer({ min: utc("2000-01-01T00:00:00Z"), max: utc("2099-01-01T00:00:00Z") }), (t) => {
        const fy = fyOf(t);
        expect(t >= fy.startMs && t < fy.endMs).toBe(true);
      }),
      { numRuns: 2_000 },
    );
  });
});
