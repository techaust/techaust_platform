// M7.3 (ADM-REP-01, -02, -03, -05): the pure report rules. The SQL twins are held equal to these in packages/db/test/reports-v2.test.ts.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays, parseIsoDate, toIsoDate } from "../src/dates.ts";
import {
  AGEING_BUCKETS,
  ageingBucket,
  carePeriodDay,
  fyBounds,
  fyMonths,
  LEADS_TREND_DAYS,
  monthBounds,
  pipelineEarliest,
  pipelineRange,
  previousMonthOf,
  rate,
  revenueKind,
  SOURCE_PATH_MAX,
  sourcePath,
} from "../src/reports.ts";

const shift = (iso: string, days: number) => toIsoDate(addDays(parseIsoDate(iso) as never, days));

describe("ageingBucket [ADM-REP-02, L7]", () => {
  it("puts the edges where the copy says: 0 not due, 1-30, 31-60, 61-90, 91 and over", () => {
    const today = "2026-10-15";
    const cases: [number, string][] = [
      [-5, "not_due"],
      [0, "not_due"],
      [1, "d1_30"],
      [30, "d1_30"],
      [31, "d31_60"],
      [60, "d31_60"],
      [61, "d61_90"],
      [90, "d61_90"],
      [91, "d90_plus"],
      [400, "d90_plus"],
    ];
    for (const [past, bucket] of cases)
      expect(ageingBucket(shift(today, -past), today), String(past)).toBe(bucket);
    expect(ageingBucket(null, today)).toBe("not_due");
  });

  it("counts whole days across a leap day and a year end", () => {
    expect(ageingBucket("2028-02-28", "2028-03-30")).toBe("d31_60"); // 31 days: 29 Feb counted
    expect(ageingBucket("2028-02-29", "2028-03-30")).toBe("d1_30"); // 30 days
    expect(ageingBucket("2026-12-31", "2027-03-31")).toBe("d61_90"); // 90 days
    expect(ageingBucket("2026-12-31", "2027-04-01")).toBe("d90_plus"); // 91 days
  });

  it("is a bucket of the list for any due day and today (property)", () => {
    const day = fc.integer({ min: 0, max: 3_000 }).map((n) => shift("2025-01-01", n));
    fc.assert(
      fc.property(day, day, (due, today) => {
        const b = ageingBucket(due, today);
        expect(AGEING_BUCKETS).toContain(b);
        if (due >= today) expect(b).toBe("not_due");
        else expect(b).not.toBe("not_due");
      }),
    );
  });

  it("refuses a malformed date", () => {
    expect(() => ageingBucket("2026-02-30", "2026-10-15")).toThrow(RangeError);
    expect(() => ageingBucket(null, "today")).toThrow(RangeError);
  });
});

describe("rate [ADM-REP-03]", () => {
  it("is whole basis points, half up, and null for a zero denominator", () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(5, 0)).toBeNull();
    expect(rate(1, 3)).toBe(3_333);
    expect(rate(2, 3)).toBe(6_667);
    expect(rate(1, 8)).toBe(1_250);
    expect(rate(1, 20_000)).toBe(1); // 0.5 bp rounds up
    expect(rate(3, 3)).toBe(10_000);
    expect(rate(0, 7)).toBe(0);
  });

  it("refuses anything but counts", () => {
    expect(() => rate(-1, 3)).toThrow(RangeError);
    expect(() => rate(1, 0.5)).toThrow(RangeError);
    expect(() => rate(Number.MAX_SAFE_INTEGER + 1, 3)).toThrow(RangeError);
  });

  it("never gives NaN or Infinity, and stays within 0..10,000 when the numerator is a part (property)", () => {
    fc.assert(
      fc.property(fc.nat(1_000_000), fc.nat(1_000_000), (a, b) => {
        const [n, d] = a <= b ? [a, b] : [b, a];
        const r = rate(n, d);
        if (d === 0) expect(r).toBeNull();
        else {
          expect(Number.isInteger(r)).toBe(true);
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(10_000);
        }
      }),
    );
  });
});

describe("revenueKind [L9]", () => {
  it("care plan (own or parent's) first, then a project, else other", () => {
    expect(revenueKind({ carePlanId: "c", parentCarePlanId: null, projectId: "p" })).toBe("recurring");
    expect(revenueKind({ carePlanId: null, parentCarePlanId: "c", projectId: "p" })).toBe("recurring");
    expect(revenueKind({ carePlanId: null, parentCarePlanId: null, projectId: "p" })).toBe("project");
    expect(revenueKind({ carePlanId: null, parentCarePlanId: null, projectId: null })).toBe("other");
  });
});

describe("sourcePath [C3, DPDP minimisation]", () => {
  it("cuts the query string and the fragment, whichever comes first", () => {
    expect(sourcePath(null)).toBeNull();
    expect(sourcePath("/services/web")).toBe("/services/web");
    expect(sourcePath("/contact?email=a@b.c")).toBe("/contact");
    expect(sourcePath("/contact#form")).toBe("/contact");
    expect(sourcePath("/a#x?y")).toBe("/a");
    expect(sourcePath("/a?x#y")).toBe("/a");
    expect(sourcePath("?only")).toBe("");
  });

  it("keeps at most SOURCE_PATH_MAX characters, counted as code points (early check 8)", () => {
    expect(SOURCE_PATH_MAX).toBe(120);
    expect(sourcePath(`/${"a".repeat(119)}`)).toHaveLength(120);
    expect(sourcePath(`/${"a".repeat(200)}?x=1`)).toBe(`/${"a".repeat(119)}`);
    const emoji = `/${"\u{1F600}".repeat(130)}`;
    expect(Array.from(sourcePath(emoji) as string)).toHaveLength(120);
  });

  it("never keeps a ? or a # (property)", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const p = sourcePath(s) as string;
        expect(p.includes("?") || p.includes("#")).toBe(false);
        expect(s.startsWith(p)).toBe(true);
        expect(Array.from(p).length).toBeLessThanOrEqual(SOURCE_PATH_MAX);
      }),
    );
  });
});

describe("periods", () => {
  it("an FY token gives its bounds; a bad token none", () => {
    expect(fyBounds("2627")).toEqual({ from: "2026-04-01", to: "2027-03-31", startYear: 2026 });
    expect(fyBounds("9900")).toEqual({ from: "2099-04-01", to: "2100-03-31", startYear: 2099 });
    expect(fyBounds("2628")).toBeNull();
    expect(fyBounds("26-27")).toBeNull();
  });

  it("the twelve months of an FY, April first", () => {
    expect(fyMonths(2026)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
    ]);
  });

  it("a month's bounds", () => {
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthBounds("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(monthBounds("2026-13")).toBeNull();
    expect(monthBounds("0000-01")).toBeNull();
  });
});

describe("pipelineRange [C3, Q3 A, RB-10]", () => {
  it("reaches back 12 months at most (29 February to 1 March)", () => {
    expect(pipelineEarliest("2026-11-06")).toBe("2025-11-06");
    expect(pipelineEarliest("2028-02-29")).toBe("2027-03-01");
    expect(() => pipelineEarliest("x")).toThrow(RangeError);
  });

  it("checks the range and gives its instants", () => {
    const r = pipelineRange("2026-04-01", "2026-04-30", "2026-11-06");
    expect(r).toEqual({
      from: "2026-04-01",
      to: "2026-04-30",
      fromMs: Date.parse("2026-03-31T18:30:00.000Z"),
      toMs: Date.parse("2026-04-30T18:30:00.000Z"),
    });
    expect(pipelineRange("2026-05-01", "2026-04-30", "2026-11-06")).toBe("range_invalid");
    expect(pipelineRange("2026-02-30", "2026-04-30", "2026-11-06")).toBe("range_invalid");
    expect(pipelineRange("2025-11-06", "2026-11-07", "2026-11-06")).toBe("range_too_long");
    expect(pipelineRange("2025-11-06", "2026-11-06", "2026-11-06")).not.toBeTypeOf("string");
    expect(pipelineRange("2025-11-05", "2026-01-01", "2026-11-06")).toBe("range_too_old");
  });
});

describe("carePeriodDay [C4, L13]", () => {
  it("the billing day of the month, or a later start date in the month", () => {
    expect(carePeriodDay("2026-10", 5, "2026-01-01")).toBe("2026-10-05");
    expect(carePeriodDay("2026-10", 5, "2026-10-02")).toBe("2026-10-05");
    expect(carePeriodDay("2026-10", 5, "2026-10-20")).toBe("2026-10-20");
    expect(carePeriodDay("2026-10", 28, "2026-10-31")).toBe("2026-10-31");
    expect(carePeriodDay("2026-10", 5, "2026-11-01")).toBeNull();
  });

  it("refuses a bad month or billing day", () => {
    expect(() => carePeriodDay("2026-13", 5, "2026-01-01")).toThrow(RangeError);
    expect(() => carePeriodDay("2026-10", 29, "2026-01-01")).toThrow(RangeError);
  });
});

describe("previousMonthOf [C5 (b)]", () => {
  it("the IST month before today's: in April it is March of the previous FY; January gives December", () => {
    expect(previousMonthOf("2026-11-06")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(previousMonthOf("2026-04-01")).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(previousMonthOf("2027-01-31")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(previousMonthOf("2028-03-15")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(() => previousMonthOf("2026-02-30")).toThrow(RangeError);
  });

  it("always ends the day before today's month starts (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20_000 }), (n) => {
        const today = toIsoDate(addDays({ year: 2000, month: 1, day: 1 }, n));
        const p = previousMonthOf(today);
        expect(toIsoDate(addDays(parseIsoDate(p.to) as never, 1))).toBe(`${today.slice(0, 7)}-01`);
        expect(p.from.slice(8)).toBe("01");
        expect(p.from.slice(0, 7)).toBe(p.to.slice(0, 7));
      }),
    );
  });

  it("the trend covers 30 days", () => {
    expect(LEADS_TREND_DAYS).toBe(30);
  });
});
