// M7.2 the weekly digest in core [JOB-CRON-03, ADM-DASH-02; run file B, I "Core", L7]: the IST week across the FY and year boundaries, the queue message (a
// Monday only, extra keys refused), and the figures turned into strings through money.ts (per currency, never added across currencies).
import { describe, expect, it } from "vitest";
import { fromIst } from "../src/dates.ts";
import {
  type DigestFigures,
  digestDataOf,
  digestMessage,
  digestMessageOf,
  digestWeekOf,
  isDigestKind,
  previousMonday,
} from "../src/digest.ts";

const at = (y: number, m: number, d: number, h = 9) => fromIst({ year: y, month: m, day: d }, h);

describe("digestWeekOf", () => {
  it("the IST Monday of the week, at 09:00 IST on a Monday and late on a Sunday", () => {
    expect(digestWeekOf(at(2026, 11, 2))).toEqual({
      weekStart: "2026-11-02",
      weekEnd: "2026-11-08",
      label: "02 Nov 2026",
    });
    expect(digestWeekOf(at(2026, 11, 8, 23)).weekStart).toBe("2026-11-02");
    // 23:59 IST on Sunday is 18:29 UTC: still that week; 00:10 IST on Monday is Sunday 18:40 UTC: the new week.
    expect(digestWeekOf(fromIst({ year: 2026, month: 11, day: 8 }, 23, 59)).weekStart).toBe("2026-11-02");
    expect(digestWeekOf(fromIst({ year: 2026, month: 11, day: 9 }, 0, 10)).weekStart).toBe("2026-11-09");
  });

  it("across the financial year (31 March to 1 April) and the calendar year", () => {
    // 1 April 2027 is a Thursday: its week starts on Monday 29 March 2027, in the previous FY.
    expect(digestWeekOf(at(2027, 4, 1)).weekStart).toBe("2027-03-29");
    expect(digestWeekOf(at(2027, 4, 5)).weekStart).toBe("2027-04-05");
    // 1 January 2027 is a Friday: its week starts on Monday 28 December 2026.
    expect(digestWeekOf(at(2027, 1, 1))).toMatchObject({ weekStart: "2026-12-28", weekEnd: "2027-01-03" });
    expect(previousMonday("2027-01-04")).toBe("2026-12-28");
    expect(() => previousMonday("nope")).toThrow(RangeError);
  });
});

describe("digestMessage", () => {
  it("carries the version, the kind and a Monday; anything else is refused", () => {
    const m = digestMessageOf(at(2026, 11, 2));
    expect(m).toEqual({ v: 1, kind: "digest.weekly", weekStart: "2026-11-02" });
    expect(digestMessage.safeParse(m).success).toBe(true);
    expect(digestMessage.safeParse({ ...m, weekStart: "2026-11-03" }).success).toBe(false);
    expect(digestMessage.safeParse({ ...m, weekStart: "2026-13-02" }).success).toBe(false);
    expect(digestMessage.safeParse({ ...m, weekStart: "2 Nov" }).success).toBe(false);
    expect(digestMessage.safeParse({ ...m, v: 2 }).success).toBe(false);
    expect(digestMessage.safeParse({ ...m, userId: "x" }).success).toBe(false);
    expect(isDigestKind(m)).toBe(true);
    expect(isDigestKind({ kind: "staff.notify" })).toBe(false);
    expect(isDigestKind(null)).toBe(false);
  });
});

describe("digestDataOf", () => {
  const empty: DigestFigures = {
    pipeline: [],
    invoicedMonth: [],
    collectedMonth: [],
    overdue: [],
    newLeads: 0,
    remindersDue: 0,
  };

  it("every figure as a string, per currency in INR then USD order, with its count", () => {
    const d = digestDataOf(
      {
        pipeline: [
          { currency: "USD", count: 1, amountMinor: 250_000 },
          { currency: "INR", count: 3, amountMinor: 12_345_600 },
        ],
        invoicedMonth: [{ currency: "INR", count: 2, amountMinor: 11_800_000 }],
        collectedMonth: [{ currency: "USD", count: 1, amountMinor: -5_000 }],
        overdue: [{ currency: "INR", count: 1, amountMinor: 59_000 }],
        newLeads: 4,
        remindersDue: 2,
      },
      { label: "02 Nov 2026" },
    );
    expect(d).toEqual({
      week_label: "02 Nov 2026",
      pipeline: "₹1,23,456.00 (3); $2,500.00 (1)",
      invoiced: "₹1,18,000.00 (2)",
      collected: "−$50.00 (1)",
      overdue: "₹590.00 (1)",
      new_leads: "4",
      reminders_due: "2",
    });
    for (const v of Object.values(d)) expect(typeof v).toBe("string");
  });

  it("no figure reads as the INR zero, never blank", () => {
    expect(digestDataOf(empty, { label: "x" })).toMatchObject({
      pipeline: "₹0.00 (0)",
      collected: "₹0.00 (0)",
      new_leads: "0",
    });
  });
});
