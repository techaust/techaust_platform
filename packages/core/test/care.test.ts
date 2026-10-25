// Care-plan periods, history lookups and the overage amount [ADM-CARE-01, ADM-CARE-03]. The overage cases are the analyst's table
// (docs/runs/m3.5-care-time.md), computed by hand: rate 150,000 paise an hour unless stated.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CARE_STATUSES,
  CARE_TRANSITIONS,
  type CareStatus,
  type CareTier,
  type CareUsageInput,
  canMoveCare,
  carePeriodUsage,
  careSourcesOf,
  hasAllowance,
  lastPeriods,
  MAX_OVERAGE_RATE_MINOR,
  nextPeriodStart,
  overageAmount,
  overageQuantityMilli,
  periodOf,
  periodStartSql,
  planPeriodOf,
  previousPeriod,
  type RolloverRule,
  type StatusRow,
  statusEffectiveOn,
  statusOn,
  type TermsRow,
  termsEffectiveFrom,
  termsOn,
  usageKey,
} from "../src/care.ts";
import { addDays, toIsoDate } from "../src/dates.ts";

const RATE = 150_000;
let seq = 0;
const terms = (from: string, over: Partial<TermsRow> & { included?: number } = {}): TermsRow => ({
  id: `t${String(++seq).padStart(6, "0")}`,
  effectiveFrom: from,
  createdAt: 1_000 + seq,
  tier: "growth" as CareTier,
  priceMinor: 1_000_000,
  includedMinutes: over.included ?? 600,
  aiOpsMinor: null,
  overageRateMinor: RATE,
  rollover: "none" as RolloverRule,
  ...over,
});
const status = (on: string, s: CareStatus = "active"): StatusRow => ({
  id: `s${String(++seq).padStart(6, "0")}`,
  effectiveOn: on,
  createdAt: 1_000 + seq,
  status: s,
});
/** Usage by the natural period start. */
const usage = (entries: Record<string, number | [number, number]>) =>
  new Map(
    Object.entries(entries).map(([k, v]) => [
      k,
      Array.isArray(v) ? { billable: v[0], nonBillable: v[1] } : { billable: v, nonBillable: 0 },
    ]),
  );

const run = (over: Partial<CareUsageInput> & Pick<CareUsageInput, "date">) =>
  carePeriodUsage({
    plan: { billingDay: 1, startDate: "2026-01-01" },
    terms: [terms("2026-01-01")],
    statuses: [status("2026-01-01")],
    usage: usage({}),
    ...over,
  });

describe("billing periods [ADM-CARE-01]", () => {
  it("runs from the billing day to the day before the next one", () => {
    expect(periodOf("2027-03-10", 28)).toEqual({ start: "2027-02-28", end: "2027-03-27" });
    expect(periodOf("2027-02-27", 28)).toEqual({ start: "2027-01-28", end: "2027-02-27" });
    expect(periodOf("2028-02-29", 28)).toEqual({ start: "2028-02-28", end: "2028-03-27" });
    expect(periodOf("2027-03-31", 1)).toEqual({ start: "2027-03-01", end: "2027-03-31" });
    expect(periodOf("2027-04-01", 1)).toEqual({ start: "2027-04-01", end: "2027-04-30" });
    expect(periodOf("2027-01-05", 10)).toEqual({ start: "2026-12-10", end: "2027-01-09" }); // across a year end
  });

  it("refuses a billing day outside 1 to 28 and a date that is not one", () => {
    expect(() => periodOf("2027-03-10", 0)).toThrow(RangeError);
    expect(() => periodOf("2027-03-10", 29)).toThrow(RangeError);
    expect(() => periodOf("2027-03-10", 1.5 as number)).toThrow(RangeError);
    expect(() => periodOf("2027-02-30", 1)).toThrow(RangeError);
  });

  it("clamps the first period to the start date, and has none before it", () => {
    const plan = { billingDay: 1, startDate: "2026-11-10" };
    expect(planPeriodOf("2026-11-10", plan)).toEqual({ start: "2026-11-10", end: "2026-11-30" });
    expect(planPeriodOf("2026-11-30", plan)).toEqual({ start: "2026-11-10", end: "2026-11-30" });
    expect(planPeriodOf("2026-12-01", plan)).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(planPeriodOf("2026-11-09", plan)).toBeNull();
  });

  it("previous period, next start and the last periods", () => {
    expect(previousPeriod({ start: "2026-12-05", end: "2027-01-04" }, 5)).toEqual({
      start: "2026-11-05",
      end: "2026-12-04",
    });
    expect(nextPeriodStart("2026-11-20", 5)).toBe("2026-12-05");
    expect(nextPeriodStart("2026-11-04", 5)).toBe("2026-11-05");
    expect(nextPeriodStart("2026-11-05", 5)).toBe("2026-12-05");
    const plan = { billingDay: 1, startDate: "2026-11-10" };
    expect(lastPeriods("2027-01-15", plan, 12).map((p) => p.start)).toEqual([
      "2027-01-01",
      "2026-12-01",
      "2026-11-10",
    ]);
    expect(lastPeriods("2027-01-15", plan, 2).map((p) => p.start)).toEqual(["2027-01-01", "2026-12-01"]);
    expect(lastPeriods("2026-11-01", plan, 3)).toEqual([]);
    expect(() => lastPeriods("2027-01-15", plan, 13)).toThrow(RangeError);
    expect(() => lastPeriods("2027-01-15", plan, 0)).toThrow(RangeError);
  });

  it("periods partition the dates (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 0, max: 365 * 5 }),
        (billingDay, offset) => {
          const date = toIsoDate(addDays({ year: 2025, month: 1, day: 1 }, offset));
          const p = periodOf(date, billingDay);
          expect(p.start <= date && date <= p.end).toBe(true);
          expect(Number(p.start.slice(8))).toBe(billingDay);
          // the next period starts the day after this one ends, and the day before the start belongs to the previous one
          const next = periodOf(
            toIsoDate(
              addDays({ year: +p.end.slice(0, 4), month: +p.end.slice(5, 7), day: +p.end.slice(8) }, 1),
            ),
            billingDay,
          );
          expect(next.start > p.end).toBe(true);
          expect(previousPeriod(p, billingDay).end < p.start).toBe(true);
          expect(periodOf(p.start, billingDay)).toEqual(p);
          expect(periodOf(p.end, billingDay)).toEqual(p);
        },
      ),
    );
  });

  it("writes the same rule as SQL text that takes the date and the day as expressions", () => {
    const sql = periodStartSql("t.work_date", "p.billing_day");
    expect(sql).toContain("strftime('%d', t.work_date)");
    expect(sql.match(/p\.billing_day/g)?.length).toBe(3);
    expect(usageKey({ start: "2026-11-10", end: "2026-11-30" }, 1)).toBe("2026-11-01");
    expect(usageKey({ start: "2026-12-01", end: "2026-12-31" }, 1)).toBe("2026-12-01");
  });
});

describe("history lookups", () => {
  it("terms on a date: the newest row at or before it; ties go to the later row", () => {
    const a = terms("2026-01-01", { included: 600 });
    const b = terms("2026-12-05", { included: 900 });
    const c = terms("2026-12-05", { included: 840 }); // changed again the same day: later createdAt wins
    expect(termsOn([a, b, c], "2026-12-04")?.includedMinutes).toBe(600);
    expect(termsOn([c, a, b], "2026-12-05")?.includedMinutes).toBe(840);
    expect(termsOn([a, b, c], "2025-12-31")).toBeUndefined();
    // the same createdAt: the larger id wins
    const x = { ...a, effectiveFrom: "2026-02-01", createdAt: 5, id: "a" };
    const y = { ...a, effectiveFrom: "2026-02-01", createdAt: 5, id: "b", includedMinutes: 15 };
    expect(termsOn([x, y], "2026-02-01")?.id).toBe("b");
    expect(termsOn([y, x], "2026-02-01")?.id).toBe("b");
  });

  it("status on a date, and pause and resume the same day leave that day active", () => {
    const log = [status("2026-01-01"), status("2026-03-10", "paused"), status("2026-03-10", "active")];
    expect(statusOn(log, "2026-03-09")?.status).toBe("active");
    expect(statusOn(log, "2026-03-10")?.status).toBe("active");
    const paused = [status("2026-01-01"), status("2026-03-10", "paused")];
    expect(statusOn(paused, "2026-03-10")?.status).toBe("paused");
    expect(statusOn(paused, "2025-01-01")).toBeUndefined();
    expect(hasAllowance(paused, { start: "2026-03-01", end: "2026-03-31" })).toBe(true);
    expect(hasAllowance(paused, { start: "2026-04-01", end: "2026-04-30" })).toBe(false);
    expect(hasAllowance([], { start: "2026-04-01", end: "2026-04-30" })).toBe(false);
  });
});

describe("status moves [ADM-CARE-01]", () => {
  it("allows exactly the listed moves; cancelled is terminal", () => {
    const allowed = ["active>paused", "active>cancelled", "paused>active", "paused>cancelled"];
    for (const from of CARE_STATUSES)
      for (const to of CARE_STATUSES)
        expect(canMoveCare(from, to), `${from}>${to}`).toBe(allowed.includes(`${from}>${to}`));
    expect(CARE_TRANSITIONS.cancelled).toEqual([]);
    expect(careSourcesOf("paused")).toEqual(["active"]);
    expect(careSourcesOf("active")).toEqual(["paused"]);
    expect(careSourcesOf("cancelled")).toEqual(["active", "paused"]);
  });

  it("a change takes effect today, or on the start date if that is later (status), or from the next period (terms)", () => {
    const plan = { billingDay: 5, startDate: "2026-11-01" };
    expect(statusEffectiveOn("2026-11-20", plan)).toBe("2026-11-20");
    expect(statusEffectiveOn("2026-10-20", plan)).toBe("2026-11-01");
    expect(statusEffectiveOn("2026-11-01", plan)).toBe("2026-11-01");
    expect(termsEffectiveFrom("2026-10-20", plan)).toBe("2026-11-01");
    expect(termsEffectiveFrom("2026-11-20", plan)).toBe("2026-12-05");
    expect(termsEffectiveFrom("2026-11-01", plan)).toBe("2026-11-05");
  });
});

describe("overage [ADM-CARE-03]: the analyst's cases, by hand", () => {
  it("1. rollover: 120 carried, 780 used of 600 + 120 -> 60 min over -> 150,000", () => {
    const u = run({
      plan: { billingDay: 1, startDate: "2026-01-01" },
      terms: [terms("2026-01-01", { rollover: "one_month" })],
      usage: usage({ "2026-10-01": 480, "2026-11-01": 780 }),
      date: "2026-11-15",
    });
    expect(u).toMatchObject({
      included: 600,
      rolloverIn: 120,
      available: 720,
      used: 780,
      overageMinutes: 60,
      overageMinor: 150_000,
      burnBp: 10_833,
      flag: "reached",
      remaining: 0,
    });
    expect(u?.period).toEqual({ start: "2026-11-01", end: "2026-11-30" });
  });

  it("2. Essential, rate 125,000: 165 of 120 -> 45 min -> 93,750 (no rollover)", () => {
    const u = run({
      terms: [terms("2026-01-01", { included: 120, overageRateMinor: 125_000, tier: "essential" })],
      usage: usage({ "2026-10-01": 0, "2026-11-01": 165 }),
      date: "2026-11-15",
    });
    expect(u).toMatchObject({ rolloverIn: 0, available: 120, overageMinutes: 45, overageMinor: 93_750 });
  });

  it("3. no compounding: two unused periods carry 600, not 1,200 -> 300 min over -> 750,000", () => {
    const u = run({
      terms: [terms("2026-01-01", { rollover: "one_month" })],
      usage: usage({ "2026-09-01": 0, "2026-10-01": 0, "2026-11-01": 1500 }),
      date: "2026-11-15",
    });
    expect(u).toMatchObject({ rolloverIn: 600, available: 1200, overageMinutes: 300, overageMinor: 750_000 });
  });

  it("3b. the previous period overspent: nothing carries -> 150,000", () => {
    const u = run({
      terms: [terms("2026-01-01", { rollover: "one_month" })],
      usage: usage({ "2026-10-01": 900, "2026-11-01": 660 }),
      date: "2026-11-15",
    });
    expect(u).toMatchObject({ rolloverIn: 0, overageMinutes: 60, overageMinor: 150_000 });
  });

  it("4. change mid-period: it takes effect next period; a second change the same day wins", () => {
    const plan = { billingDay: 5, startDate: "2026-01-05" };
    const first = terms("2026-01-05", { included: 600, overageRateMinor: RATE });
    const change1 = terms(termsEffectiveFrom("2026-11-20", plan), {
      included: 900,
      overageRateMinor: 200_000,
    });
    expect(change1.effectiveFrom).toBe("2026-12-05");
    const base = {
      plan,
      statuses: [status("2026-01-05")],
      usage: usage({ "2026-11-05": 660, "2026-12-05": 960 }),
    };
    const p = carePeriodUsage({ ...base, terms: [first, change1], date: "2026-11-20" });
    expect(p).toMatchObject({
      period: { start: "2026-11-05", end: "2026-12-04" },
      overageMinutes: 60,
      overageMinor: 150_000,
    });
    const p1 = carePeriodUsage({ ...base, terms: [first, change1], date: "2026-12-10" });
    expect(p1).toMatchObject({ included: 900, overageMinutes: 60, overageMinor: 200_000 });
    const change2 = terms(termsEffectiveFrom("2026-11-25", plan), {
      included: 840,
      overageRateMinor: 200_000,
    });
    const p2 = carePeriodUsage({ ...base, terms: [first, change1, change2], date: "2026-12-10" });
    expect(p2).toMatchObject({ included: 840, overageMinutes: 120, overageMinor: 400_000 });
  });

  it("5. paused on the billing day: no hours that period, no carry; after a resume it is all overage", () => {
    const common = {
      terms: [terms("2026-01-01", { rollover: "one_month" })],
      statuses: [status("2026-01-01"), status("2026-11-12", "paused"), status("2026-12-28", "active")],
    };
    const jan = carePeriodUsage({
      plan: { billingDay: 1, startDate: "2026-01-01" },
      ...common,
      usage: usage({ "2026-11-01": 300, "2027-01-01": 700 }),
      date: "2027-01-10",
    });
    expect(jan).toMatchObject({ included: 600, rolloverIn: 0, overageMinutes: 100, overageMinor: 250_000 });
    const dec = carePeriodUsage({
      plan: { billingDay: 1, startDate: "2026-01-01" },
      ...common,
      usage: usage({ "2026-11-01": 300, "2026-12-01": 120 }),
      date: "2026-12-30",
    });
    expect(dec).toMatchObject({
      included: 0,
      rolloverIn: 0,
      available: 0,
      overageMinutes: 120,
      overageMinor: 300_000,
      flag: "reached", // overage with no hours available still counts as reached (review fix 4)
      burnBp: null,
    });
  });

  it("6. flags at 80 % and 100 % of the hours available", () => {
    const at = (used: number, carried = 0) =>
      run({
        terms: [terms("2026-01-01", { rollover: carried ? "one_month" : "none" })],
        usage: usage({ "2026-10-01": 600 - carried, "2026-11-01": used }),
        date: "2026-11-15",
      });
    expect(at(465)).toMatchObject({ burnBp: 7_750, flag: "none" });
    expect(at(480)).toMatchObject({ burnBp: 8_000, flag: "near" });
    expect(at(585)).toMatchObject({ flag: "near" });
    expect(at(600)).toMatchObject({ flag: "reached", overageMinutes: 0, overageMinor: 0 });
    expect(at(615)).toMatchObject({ flag: "reached", overageMinutes: 15, overageMinor: 37_500 });
    expect(at(570, 120)).toMatchObject({ available: 720, flag: "none" });
    expect(at(585, 120)).toMatchObject({ burnBp: 8_125, flag: "near" });
    const none = run({
      terms: [terms("2026-01-01", { included: 0 })],
      usage: usage({ "2026-11-01": 60 }),
      date: "2026-11-15",
    });
    expect(none).toMatchObject({ flag: "none", burnBp: null, overageMinutes: 60, overageMinor: 150_000 });
  });

  it("7. half up on a quarter hour", () => {
    const over = (rate: number) => overageAmount(15, rate);
    expect(over(199_999)).toBe(50_000);
    expect(over(199_998)).toBe(50_000);
    expect(over(199_997)).toBe(49_999);
    expect(over(1)).toBe(0);
  });

  it("7b. throws rather than returning a wrong number when the amount is not a safe integer; the capped rate never does", () => {
    expect(() => overageAmount(1_440_000_000_000, 1_000_000_000)).toThrow(RangeError);
    expect(() => overageAmount(Number.MAX_SAFE_INTEGER, 1_000_000_000)).toThrow(RangeError);
    expect(() => overageAmount(1.5, 100)).toThrow(RangeError); // BigInt of a fraction
    // the cap, with a whole period of minutes (a year of 24-hour days is 525,600 minutes): far below 2^53
    expect(overageAmount(525_600, MAX_OVERAGE_RATE_MINOR)).toBe(8_760_000_000_000);
    expect(overageAmount(15, MAX_OVERAGE_RATE_MINOR)).toBe(250_000_000);
  });

  it("8. USD Scale: 1,500 included at 7,500 cents an hour, 1,545 used -> 5,625", () => {
    const u = run({
      terms: [terms("2026-01-01", { included: 1_500, overageRateMinor: 7_500, tier: "scale" })],
      usage: usage({ "2026-11-01": 1_545 }),
      date: "2026-11-15",
    });
    expect(u).toMatchObject({ overageMinutes: 45, overageMinor: 5_625 });
  });

  it("9. no rate: the minutes are reported, the amount is not made up", () => {
    const u = run({
      terms: [terms("2026-01-01", { overageRateMinor: null })],
      usage: usage({ "2026-11-01": 660 }),
      date: "2026-11-15",
    });
    expect(u).toMatchObject({
      overageMinutes: 60,
      overageMinor: null,
      rateMissing: true,
      flag: "reached",
      rateMinor: null,
    });
    const within = run({
      terms: [terms("2026-01-01", { overageRateMinor: null })],
      usage: usage({ "2026-11-01": 300 }),
      date: "2026-11-15",
    });
    expect(within).toMatchObject({ overageMinutes: 0, overageMinor: 0, rateMissing: false });
  });

  it("10. non-billable time never uses the included hours", () => {
    const u = run({ usage: usage({ "2026-11-01": [600, 120] }), date: "2026-11-15" });
    expect(u).toMatchObject({ used: 600, nonBillable: 120, overageMinutes: 0, remaining: 0 });
  });

  it("11. the first partial period has the full hours; its unused hours carry into the second", () => {
    const plan = { billingDay: 1, startDate: "2026-11-10" };
    const t = [terms("2026-11-10", { rollover: "one_month" })];
    const s = [status("2026-11-10")];
    const p1 = carePeriodUsage({
      plan,
      terms: t,
      statuses: s,
      usage: usage({ "2026-11-01": 645 }),
      date: "2026-11-20",
    });
    expect(p1).toMatchObject({
      period: { start: "2026-11-10", end: "2026-11-30" },
      included: 600,
      overageMinutes: 45,
      overageMinor: 112_500,
    });
    const p2 = carePeriodUsage({
      plan,
      terms: t,
      statuses: s,
      usage: usage({ "2026-11-01": 645 }),
      date: "2026-12-05",
    });
    expect(p2?.rolloverIn).toBe(0);
    const p2b = carePeriodUsage({
      plan,
      terms: t,
      statuses: s,
      usage: usage({ "2026-11-01": 100 }),
      date: "2026-12-05",
    });
    expect(p2b?.rolloverIn).toBe(500);
    // the period before the first one is not a plan period
    const p1b = carePeriodUsage({ plan, terms: t, statuses: s, usage: usage({}), date: "2026-11-10" });
    expect(p1b?.rolloverIn).toBe(0);
  });

  it("is null before the plan starts, and a missing terms row gives no hours", () => {
    expect(run({ plan: { billingDay: 1, startDate: "2026-12-01" }, date: "2026-11-30" })).toBeNull();
    const u = run({ terms: [], usage: usage({ "2026-11-01": 30 }), date: "2026-11-15" });
    expect(u).toMatchObject({ included: 0, overageMinutes: 30, overageMinor: null, rateMissing: true });
  });

  it("is monotonic in the minutes used, and zero while used is within the hours available (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_440 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 400_000 }),
        fc.integer({ min: 0, max: 96 }),
        (included15, extra15, rate, used15) => {
          const included = included15 * 15 > 1_440 ? 1_440 : included15 * 15;
          const mk = (used: number) =>
            run({
              terms: [terms("2026-01-01", { included, overageRateMinor: rate })],
              usage: usage({ "2026-11-01": used }),
              date: "2026-11-15",
            });
          const used = used15 * 15;
          const a = mk(used);
          const b = mk(used + extra15 * 15);
          expect(b?.overageMinutes ?? 0).toBeGreaterThanOrEqual(a?.overageMinutes ?? 0);
          expect(b?.overageMinor ?? 0).toBeGreaterThanOrEqual(a?.overageMinor ?? 0);
          if (used <= included) expect(a?.overageMinutes).toBe(0);
          if (used <= included) expect(a?.overageMinor).toBe(0);
        },
      ),
    );
  });

  it("the invoice quantity is exact in 15-minute steps, so quantity x rate equals the amount (property)", () => {
    expect(overageQuantityMilli(15)).toBe(250);
    expect(overageQuantityMilli(60)).toBe(1_000);
    expect(overageQuantityMilli(0)).toBe(0);
    for (const bad of [10, 1, 1.5, -15, Number.NaN])
      expect(() => overageQuantityMilli(bad)).toThrow(RangeError);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: 10_000_000 }),
        (steps, rate) => {
          const minutes = steps * 15;
          const viaQuantity = Number((BigInt(overageQuantityMilli(minutes)) * BigInt(rate) + 500n) / 1000n);
          expect(viaQuantity).toBe(overageAmount(minutes, rate));
        },
      ),
    );
  });
});
