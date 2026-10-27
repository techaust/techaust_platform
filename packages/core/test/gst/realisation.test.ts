// Realisation dates and stages [ADM-REP-07, docs/08-A §8; VERIFY WITH CA/LEGAL]: FEMA 9 months (12 in INR), GST 12 months plus
// 15 days, both "last allowed day"; boundaries day by day, month-end clamping, extensions, and the ordering properties.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays, type CalendarDate, daysBetween, isValidDate, toIsoDate } from "../../src/dates.ts";
import {
  DEFAULT_REALISATION_RULES,
  type RealisationRules,
  type RealisationStage,
  realisationDates,
  realisationRows,
  realisationRulesOf,
  realisationStatus,
  stageOf,
} from "../../src/gst/index.ts";
import { d, rate, row } from "./fixtures.ts";

const dates = (
  invoiceDate: CalendarDate,
  currency: "USD" | "INR",
  extension?: { femaDue?: CalendarDate },
  rules = DEFAULT_REALISATION_RULES,
) => {
  const r = realisationDates({ invoiceDate, currency, supplyType: "export_lut", extension }, rules);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};
const stage = (
  invoiceDate: CalendarDate,
  currency: "USD" | "INR",
  today: CalendarDate,
  outstandingMinor = 100,
  extension?: { femaDue?: CalendarDate },
) => {
  const r = realisationStatus(
    { invoiceDate, currency, supplyType: "export_lut", outstandingMinor, extension },
    today,
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.value.stage;
};
const iso = toIsoDate;

describe("the rules", () => {
  it("default to FEMA 9 and 12 months, GST 12 months plus 15 days, 30 days of warning, rules from 1 October 2026", () => {
    expect(DEFAULT_REALISATION_RULES).toEqual({
      femaMonthsForeign: 9,
      femaMonthsInr: 12,
      gstMonths: 12,
      gstExtraDays: 15,
      approachingDays: 30,
      rulesFrom: d(2026, 10, 1),
    });
    expect(Object.isFrozen(DEFAULT_REALISATION_RULES)).toBe(true);
    expect(Object.isFrozen(DEFAULT_REALISATION_RULES.rulesFrom)).toBe(true);
  });
  it("come from the settings: warnMonths is the FEMA period, escalateMonths and escalateExtraDays the GST one", () => {
    const r = realisationRulesOf({ warnMonths: 6, escalateMonths: 10, escalateExtraDays: 7 });
    expect(r).toEqual({
      ok: true,
      value: { ...DEFAULT_REALISATION_RULES, femaMonthsForeign: 6, gstMonths: 10, gstExtraDays: 7 },
      warnings: [],
    });
    const s = realisationRulesOf({ warnMonths: 9, escalateMonths: 12, escalateExtraDays: 15 });
    expect(s.ok && s.value).toEqual(DEFAULT_REALISATION_RULES);
  });
});

describe("the due dates (last allowed day)", () => {
  it("USD: FEMA 9 months, GST 12 months plus 15 days", () => {
    const r = dates(d(2026, 11, 3), "USD");
    expect(r.value).toEqual({ femaDue: d(2027, 8, 3), gstDue: d(2027, 11, 18) });
    expect(r.warnings).toEqual([]);
  });
  it("INR: FEMA 12 months, so GST is the same 12 months plus 15 days", () => {
    expect(dates(d(2026, 11, 3), "INR").value).toEqual({ femaDue: d(2027, 11, 3), gstDue: d(2027, 11, 18) });
  });
  it("clamps to the end of a short month: 31 May, 31 Aug, 29 Feb", () => {
    // 31 May 2027 + 9 months = 29 February 2028 (a leap year); GST: 31 May 2028 + 15 days
    expect(dates(d(2027, 5, 31), "USD").value).toEqual({ femaDue: d(2028, 2, 29), gstDue: d(2028, 6, 15) });
    // 31 Aug 2027 + 9 months = 31 May 2028; + 12 months = 31 Aug 2028, + 15 days = 15 Sep 2028
    expect(dates(d(2027, 8, 31), "USD").value).toEqual({ femaDue: d(2028, 5, 31), gstDue: d(2028, 9, 15) });
    // 31 Aug 2026 + 9 months = 31 May 2027
    expect(dates(d(2026, 8, 31), "USD").value.femaDue).toEqual(d(2027, 5, 31));
    // 29 Feb 2028: + 9 months = 29 Nov 2028; + 12 months = 28 Feb 2029, + 15 days = 15 Mar 2029
    expect(dates(d(2028, 2, 29), "USD").value).toEqual({ femaDue: d(2028, 11, 29), gstDue: d(2029, 3, 15) });
    // INR: 29 Feb 2028 + 12 months = 28 Feb 2029
    expect(dates(d(2028, 2, 29), "INR").value.femaDue).toEqual(d(2029, 2, 28));
    // 30 Nov 2026 + 9 months = 30 Aug 2027; 30 May + 9 = 28 Feb 2027 is the short case in a normal year
    expect(dates(d(2026, 5, 31), "USD").value.femaDue).toEqual(d(2027, 2, 28));
  });
  it("an invoice before 1 October 2026 carries the warning before_fema_2026 (docs/08 U-2)", () => {
    expect(dates(d(2026, 9, 30), "USD").warnings).toEqual([{ code: "before_fema_2026", path: [] }]);
    expect(dates(d(2026, 10, 1), "USD").warnings).toEqual([]);
  });
  it("an extension replaces the FEMA date, and GST follows whichever is later", () => {
    // extended past 12 months: GST = extension + 15 days
    expect(dates(d(2026, 11, 3), "USD", { femaDue: d(2028, 6, 30) }).value).toEqual({
      femaDue: d(2028, 6, 30),
      gstDue: d(2028, 7, 15),
    });
    // extended to before the 12 months: the 12 months still decide GST
    expect(dates(d(2026, 11, 3), "USD", { femaDue: d(2027, 1, 1) }).value).toEqual({
      femaDue: d(2027, 1, 1),
      gstDue: d(2027, 11, 18),
    });
    // an empty extension changes nothing
    expect(dates(d(2026, 11, 3), "USD", {}).value).toEqual(dates(d(2026, 11, 3), "USD").value);
  });
  it("uses the rules it is given", () => {
    const rules: RealisationRules = {
      ...DEFAULT_REALISATION_RULES,
      femaMonthsForeign: 6,
      gstMonths: 3,
      gstExtraDays: 0,
    };
    // GST base 3 months is before FEMA 6 months, so the later one (FEMA) plus 0 days
    expect(dates(d(2026, 11, 3), "USD", undefined, rules).value).toEqual({
      femaDue: d(2027, 5, 3),
      gstDue: d(2027, 5, 3),
    });
  });
});

describe("the stage, day by day (USD invoice of 3 November 2026: FEMA due 3 Aug 2027, GST due 18 Nov 2027)", () => {
  const inv = d(2026, 11, 3);
  const at = (day: CalendarDate) => stage(inv, "USD", day);
  it("walks through every boundary", () => {
    expect(at(d(2026, 11, 3))).toBe("ok");
    expect(at(d(2027, 7, 3))).toBe("ok"); // the day before the approaching window opens
    expect(at(d(2027, 7, 4))).toBe("fema_approaching"); // 30 days before the FEMA due date
    expect(at(d(2027, 8, 2))).toBe("fema_approaching");
    expect(at(d(2027, 8, 3))).toBe("fema_approaching"); // the last allowed day is not overdue
    expect(at(d(2027, 8, 4))).toBe("fema_overdue");
    expect(at(d(2027, 10, 18))).toBe("fema_overdue");
    expect(at(d(2027, 10, 19))).toBe("gst_approaching"); // 30 days before the GST due date
    expect(at(d(2027, 11, 17))).toBe("gst_approaching");
    expect(at(d(2027, 11, 18))).toBe("gst_approaching"); // the last allowed day
    expect(at(d(2027, 11, 19))).toBe("gst_overdue");
    expect(at(d(2030, 1, 1))).toBe("gst_overdue");
  });
  it("an INR invoice (FEMA 12 months): ok, FEMA approaching, then the GST stages take over", () => {
    const at2 = (day: CalendarDate) => stage(inv, "INR", day);
    expect(at2(d(2027, 10, 3))).toBe("ok");
    expect(at2(d(2027, 10, 4))).toBe("fema_approaching");
    expect(at2(d(2027, 10, 18))).toBe("fema_approaching");
    expect(at2(d(2027, 10, 19))).toBe("gst_approaching");
    expect(at2(d(2027, 11, 18))).toBe("gst_approaching");
    expect(at2(d(2027, 11, 19))).toBe("gst_overdue");
  });
  it("nothing outstanding is realised, whatever the date", () => {
    for (const day of [d(2026, 11, 3), d(2027, 8, 4), d(2035, 1, 1)]) {
      expect(stage(inv, "USD", day, 0)).toBe("realised");
      expect(stage(inv, "USD", day, -500)).toBe("realised");
    }
  });
  it("an extension moves the stages", () => {
    expect(stage(inv, "USD", d(2027, 9, 1), 100, { femaDue: d(2028, 6, 30) })).toBe("ok");
    expect(stage(inv, "USD", d(2028, 7, 15), 100, { femaDue: d(2028, 6, 30) })).toBe("gst_approaching");
    expect(stage(inv, "USD", d(2028, 7, 16), 100, { femaDue: d(2028, 6, 30) })).toBe("gst_overdue");
  });
  it("realisationStatus returns the dates with the stage and passes the warning on", () => {
    const r = realisationStatus(
      { invoiceDate: d(2026, 9, 1), currency: "USD", supplyType: "export_lut", outstandingMinor: 1 },
      d(2027, 1, 1),
    );
    expect(r).toEqual({
      ok: true,
      value: { femaDue: d(2027, 6, 1), gstDue: d(2027, 9, 16), stage: "ok" },
      warnings: [{ code: "before_fema_2026", path: [] }],
    });
  });
  it("stageOf alone", () => {
    expect(stageOf({ femaDue: d(2027, 1, 10), gstDue: d(2027, 4, 1) }, 5, d(2027, 1, 11), 10)).toBe(
      "fema_overdue",
    );
    expect(stageOf({ femaDue: d(2027, 1, 10), gstDue: d(2027, 4, 1) }, 5, d(2027, 1, 9), 0)).toBe("ok");
  });
});

describe("properties", () => {
  const dateArb = fc
    .record({
      year: fc.integer({ min: 2024, max: 2035 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 31 }),
    })
    .filter(isValidDate);
  const rulesArb: fc.Arbitrary<RealisationRules> = fc.record({
    femaMonthsForeign: fc.integer({ min: 1, max: 24 }),
    femaMonthsInr: fc.integer({ min: 1, max: 24 }),
    gstMonths: fc.integer({ min: 1, max: 24 }),
    gstExtraDays: fc.integer({ min: 0, max: 60 }),
    approachingDays: fc.integer({ min: 0, max: 400 }),
    rulesFrom: fc.constant(d(2026, 10, 1)),
  });
  const RANK: Record<RealisationStage, number> = {
    realised: -1,
    ok: 0,
    fema_approaching: 1,
    fema_overdue: 2,
    gst_approaching: 3,
    gst_overdue: 4,
  };

  it("the GST date is at least the FEMA date plus the extra days, extension or not", () => {
    fc.assert(
      fc.property(
        dateArb,
        rulesArb,
        fc.constantFrom("USD", "INR"),
        fc.option(dateArb, { nil: undefined }),
        (invoice, rules, currency, ext) => {
          const r = dates(invoice, currency, ext === undefined ? undefined : { femaDue: ext }, rules).value;
          expect(daysBetween(r.femaDue, r.gstDue)).toBeGreaterThanOrEqual(rules.gstExtraDays);
          expect(iso(r.femaDue) >= iso(invoice) || ext !== undefined).toBe(true);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("the stage never goes backwards as today grows, and nothing outstanding is always realised", () => {
    fc.assert(
      fc.property(
        dateArb,
        rulesArb,
        fc.constantFrom("USD", "INR"),
        fc.integer({ min: 1, max: 100_000 }),
        (invoice, rules, currency, outstanding) => {
          let last = -1;
          let day = invoice;
          for (let i = 0; i < 900; i += 3) {
            day = addDays(invoice, i);
            const r = realisationStatus(
              { invoiceDate: invoice, currency, supplyType: "export_lut", outstandingMinor: outstanding },
              day,
              rules,
            );
            if (!r.ok) throw new Error("unexpected");
            expect(RANK[r.value.stage]).toBeGreaterThanOrEqual(last);
            last = RANK[r.value.stage];
            const done = realisationStatus(
              { invoiceDate: invoice, currency, supplyType: "export_lut", outstandingMinor: 0 },
              day,
              rules,
            );
            expect(done.ok && done.value.stage).toBe("realised");
          }
          expect(last).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 80 },
    );
  });

  it("the warning appears exactly before the rules start", () => {
    fc.assert(
      fc.property(dateArb, (invoice) => {
        const r = dates(invoice, "USD");
        expect(r.warnings.length === 1).toBe(iso(invoice) < "2026-10-01");
      }),
    );
  });
});

describe("realisationRows", () => {
  const exp = (
    id: string,
    date: CalendarDate,
    over: Parameters<typeof row>[0]["override"] = {},
    voided = false,
  ) =>
    row({
      id,
      number: `E-${id}`,
      kind: "export_invoice",
      supply: "export_lut",
      date,
      voided,
      name: `Client ${id}`,
      rates: [rate("998314", 1800, 1000, "export_lut")],
      override: over,
    });
  const today = d(2027, 8, 10);

  it("lists non-voided export invoices only, oldest first, with their stage", () => {
    const register = [
      exp("b", d(2026, 12, 1), { currency: "USD", outstandingMinor: 500 }),
      exp("a", d(2026, 11, 3), { currency: "USD", outstandingMinor: 1000 }),
      exp("c", d(2026, 11, 3), { currency: "INR", outstandingMinor: 0 }),
      exp("v", d(2026, 11, 3), {}, true),
      row({ id: "t", kind: "tax_invoice" }),
      row({ id: "n", kind: "credit_note", noteOf: null }),
    ];
    const r = realisationRows(register, today);
    expect(r.ok && r.value.map((x) => [x.id, x.stage, x.femaDue, x.gstDue])).toEqual([
      ["a", "fema_overdue", d(2027, 8, 3), d(2027, 11, 18)],
      ["c", "realised", d(2027, 11, 3), d(2027, 11, 18)],
      ["b", "fema_approaching", d(2027, 9, 1), d(2027, 12, 16)],
    ]);
    expect(r.ok && r.value[0]).toEqual({
      id: "a",
      number: "E-a",
      issueDate: d(2026, 11, 3),
      clientName: "Client a",
      currency: "USD",
      outstandingMinor: 1000,
      femaDue: d(2027, 8, 3),
      gstDue: d(2027, 11, 18),
      stage: "fema_overdue",
    });
  });

  it("uses the extension of a document, by id", () => {
    const register = [exp("a", d(2026, 11, 3), { currency: "USD", outstandingMinor: 1000 })];
    const r = realisationRows(register, today, DEFAULT_REALISATION_RULES, { a: { femaDue: d(2028, 6, 30) } });
    expect(r.ok && r.value[0]?.stage).toBe("ok");
    expect(r.ok && r.value[0]?.gstDue).toEqual(d(2028, 7, 15));
    const other = realisationRows(register, today, DEFAULT_REALISATION_RULES, {
      zzz: { femaDue: d(2028, 6, 30) },
    });
    expect(other.ok && other.value[0]?.stage).toBe("fema_overdue");
    const proto = realisationRows(register, today, DEFAULT_REALISATION_RULES, {});
    expect(proto.ok && proto.value[0]?.stage).toBe("fema_overdue");
  });

  it("carries the before-2026 warning with the invoice's id", () => {
    const r = realisationRows([exp("old", d(2026, 5, 31), { currency: "USD" })], today);
    expect(r.ok && r.warnings).toEqual([{ code: "before_fema_2026", path: ["old"] }]);
    expect(r.ok && r.value[0]?.femaDue).toEqual(d(2027, 2, 28));
  });

  it("orders by date, then number", () => {
    const r = realisationRows(
      [exp("z", d(2026, 11, 3)), exp("y", d(2026, 11, 3)), exp("x", d(2026, 11, 2))],
      today,
    );
    expect(r.ok && r.value.map((x) => x.id)).toEqual(["x", "y", "z"]);
  });
});
