import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays, fromIst, toIsoDate } from "../src/dates.ts";
import {
  authorLocked,
  DAY_CAP,
  DAY_MS,
  entryDateCheck,
  LOCK_DAYS,
  TIME_STEP,
  validMinutes,
  weekOf,
} from "../src/time.ts";

describe("minutes [ADM-TIME-01]", () => {
  it("are whole quarter hours, 15 to 1,440", () => {
    expect([TIME_STEP, DAY_CAP, LOCK_DAYS]).toEqual([15, 1_440, 7]);
    for (const ok of [15, 30, 45, 60, 1_425, 1_440]) expect(validMinutes(ok), String(ok)).toBe(true);
    for (const bad of [0, -15, 10, 1_445, 1_455, 7.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(validMinutes(bad), String(bad)).toBe(false);
  });
});

describe("the date of an entry [ADM-TIME-03]", () => {
  const today = "2026-11-30";
  const check = (workDate: string, canWriteAny = false) => entryDateCheck({ today, workDate, canWriteAny });

  it("allows today and up to seven days back; eight days back is the owner's", () => {
    expect(check("2026-11-30")).toBe("ok");
    expect(check("2026-11-23")).toBe("ok");
    expect(check("2026-11-22")).toBe("owner_only_date");
    expect(check("2026-11-22", true)).toBe("ok");
    expect(check("2020-01-01", true)).toBe("ok");
  });

  it("refuses a future date for everyone, the owner included", () => {
    expect(check("2026-12-01")).toBe("future");
    expect(check("2026-12-01", true)).toBe("future");
  });

  it("crosses a month and a year boundary", () => {
    const at = (workDate: string, canWriteAny = false) =>
      entryDateCheck({ today: "2027-01-03", workDate, canWriteAny });
    expect(at("2026-12-27")).toBe("ok"); // exactly seven days back
    expect(at("2026-12-26")).toBe("owner_only_date");
    expect(at("2026-12-26", true)).toBe("ok");
  });

  it("refuses a date that is not one", () => {
    expect(() => entryDateCheck({ today: "2026-02-30", workDate: "2026-01-01", canWriteAny: false })).toThrow(
      RangeError,
    );
  });
});

describe("the author's lock [ADM-TIME-03]", () => {
  it("opens one millisecond before seven days and locks at exactly seven days", () => {
    const created = 1_700_000_000_000;
    expect(authorLocked(created, created)).toBe(false);
    expect(authorLocked(created, created + 7 * DAY_MS - 1)).toBe(false);
    expect(authorLocked(created, created + 7 * DAY_MS)).toBe(true);
  });
});

describe("the timesheet week", () => {
  it("runs Monday to Sunday", () => {
    expect(weekOf("2026-11-30")).toEqual({ start: "2026-11-30", end: "2026-12-06" }); // a Monday
    expect(weekOf("2026-12-06")).toEqual({ start: "2026-11-30", end: "2026-12-06" }); // the Sunday
    expect(weekOf("2026-12-07")).toEqual({ start: "2026-12-07", end: "2026-12-13" });
    expect(weekOf("2027-01-01")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(() => weekOf("2026-02-30")).toThrow(RangeError);
  });

  it("every date is in exactly one week, a Monday to a Sunday (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_000 }), (n) => {
        const day = toIsoDate(addDays({ year: 2024, month: 1, day: 1 }, n));
        const w = weekOf(day);
        expect(w.start <= day && day <= w.end).toBe(true);
        expect(weekOf(w.start)).toEqual(w);
        expect(weekOf(w.end)).toEqual(w);
        // IST midnight of the start is a Monday
        const [y, m, d] = w.start.split("-").map(Number) as [number, number, number];
        expect(new Date(fromIst({ year: y, month: m, day: d }) + 19_800_000).getUTCDay()).toBe(1);
      }),
    );
  });
});
