// Recurring care invoices, pure [ADM-CARE-02, ADM-CARE-03, LD58, LD59, LD66]: when a plan is due, the lines, and whether the job may issue the draft itself.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planPeriodOf } from "../src/care.ts";
import {
  AUTO_ISSUE_REASONS,
  autoIssueEligibility,
  billingPeriodOf,
  CARE_LINE_WORDS,
  type CareCatalogue,
  careDue,
  careLines,
  hasPlaceholder,
} from "../src/care-billing.ts";
import { fromIst } from "../src/dates.ts";
import { proformaWarnAt, unbilledCutoff } from "../src/export-invoice.ts";

const plan = (billingDay: number, startDate: string) => ({ billingDay, startDate });
const catalogue: CareCatalogue = {
  S16: { sac: "998313", gstRateBp: 1800 },
  S17: { sac: "998314", gstRateBp: null },
  S18: { sac: "998315", gstRateBp: 1800 },
};
const words = {
  plan: (t: string, p: { start: string }) => `Care ${t} ${p.start}`,
  aiOps: (p: { start: string }) => `AI ${p.start}`,
  overage: (p: { start: string }) => `Extra ${p.start}`,
};

describe("careDue: the plan's current period, once", () => {
  it("is the plan's period that contains today; none before the start", () => {
    expect(billingPeriodOf("2026-11-05", plan(5, "2026-01-01"))).toEqual({
      start: "2026-11-05",
      end: "2026-12-04",
    });
    expect(billingPeriodOf("2026-11-04", plan(5, "2026-01-01"))).toEqual({
      start: "2026-10-05",
      end: "2026-11-04",
    });
    expect(billingPeriodOf("2026-11-04", plan(5, "2026-12-01"))).toBeNull();
    expect(careDue("2026-11-04", plan(5, "2026-12-01"), null, "active")).toEqual({
      due: false,
      reason: "not_started",
    });
  });
  it("the first period starts on the start date and is billed in full (clamped, no proration)", () => {
    const d = careDue("2026-11-12", plan(5, "2026-11-12"), null, "active");
    expect(d).toEqual({
      due: true,
      period: { start: "2026-11-12", end: "2026-12-04" },
      missedEarlier: false,
    });
  });
  it("on the billing day, and the catch-up on any later day of the period (day 2, day 20)", () => {
    for (const day of ["2026-11-05", "2026-11-06", "2026-11-25", "2026-12-04"]) {
      const d = careDue(day, plan(5, "2026-01-01"), "2026-10-05", "active");
      expect(d.due, day).toBe(day <= "2026-12-04");
    }
    expect(careDue("2026-11-06", plan(5, "2026-01-01"), "2026-10-05", "active")).toMatchObject({
      due: true,
      period: { start: "2026-11-05" },
      missedEarlier: false,
    });
  });
  it("idempotent: once last billed has reached the period start, it is not due (the same day, the next day, the rest of the period)", () => {
    for (const today of ["2026-11-05", "2026-11-06", "2026-12-04"])
      expect(careDue(today, plan(5, "2026-01-01"), "2026-11-05", "active")).toEqual({
        due: false,
        reason: "already_billed",
      });
    // a later period is due again
    expect(careDue("2026-12-05", plan(5, "2026-01-01"), "2026-11-05", "active").due).toBe(true);
  });
  it("a plan that was paused or cancelled at the period start is not billed for it", () => {
    expect(careDue("2026-11-05", plan(5, "2026-01-01"), "2026-10-05", "paused")).toEqual({
      due: false,
      reason: "not_active",
    });
    expect(careDue("2026-11-05", plan(5, "2026-01-01"), "2026-10-05", "cancelled")).toEqual({
      due: false,
      reason: "not_active",
    });
    expect(careDue("2026-11-05", plan(5, "2026-01-01"), "2026-10-05", null)).toEqual({
      due: false,
      reason: "not_active",
    });
  });
  it("a gap of a whole period is reported, never billed (Q51): the current period is still the one", () => {
    const d = careDue("2026-12-05", plan(5, "2026-01-01"), "2026-10-05", "active");
    expect(d).toMatchObject({ due: true, period: { start: "2026-12-05" }, missedEarlier: true });
    // last billed one period back: no gap
    expect(careDue("2026-12-05", plan(5, "2026-01-01"), "2026-11-05", "active")).toMatchObject({
      missedEarlier: false,
    });
    // never billed: nothing is known to be missed (earlier invoices may have been made by hand)
    expect(careDue("2026-12-05", plan(5, "2026-01-01"), null, "active")).toMatchObject({
      missedEarlier: false,
    });
  });
  it("month ends: billing day 28 in February 2027 and February 2028 (a leap year), and the year end", () => {
    expect(billingPeriodOf("2027-02-28", plan(28, "2026-01-01"))).toEqual({
      start: "2027-02-28",
      end: "2027-03-27",
    });
    expect(billingPeriodOf("2027-02-27", plan(28, "2026-01-01"))).toEqual({
      start: "2027-01-28",
      end: "2027-02-27",
    });
    expect(billingPeriodOf("2028-02-28", plan(28, "2026-01-01"))).toEqual({
      start: "2028-02-28",
      end: "2028-03-27",
    });
    expect(billingPeriodOf("2028-02-29", plan(28, "2026-01-01"))).toEqual({
      start: "2028-02-28",
      end: "2028-03-27",
    });
    expect(billingPeriodOf("2027-01-01", plan(28, "2026-01-01"))).toEqual({
      start: "2026-12-28",
      end: "2027-01-27",
    });
    expect(billingPeriodOf("2027-03-31", plan(1, "2026-01-01"))).toEqual({
      start: "2027-03-01",
      end: "2027-03-31",
    });
    expect(billingPeriodOf("2027-04-01", plan(1, "2026-01-01"))).toEqual({
      start: "2027-04-01",
      end: "2027-04-30",
    });
  });
  it("is the plan's own period function (no second rule)", () => {
    for (const d of ["2026-11-05", "2027-03-31", "2028-02-29"])
      expect(billingPeriodOf(d, plan(17, "2026-01-01"))).toEqual(planPeriodOf(d, plan(17, "2026-01-01")));
  });
});

describe("careLines", () => {
  const period = { start: "2026-11-05", end: "2026-12-04" };
  it("the plan fee: one month at the terms' price as the taxable amount, from S16, with its SAC and rate", () => {
    const r = careLines({
      tier: "growth",
      terms: { priceMinor: 500_000, aiOpsMinor: null },
      period,
      catalogue,
      overage: null,
      words,
    });
    expect(r).toEqual({
      ok: true,
      overage: null,
      lines: [
        {
          kind: "plan",
          code: "S16",
          description: "Care Growth 2026-11-05",
          sac: "998313",
          qtyMilli: 1000,
          unit: "month",
          rateMinor: 500_000,
          gstRateBp: 1800,
        },
      ],
    });
  });
  it("a Dev Subscription is S18", () => {
    const r = careLines({
      tier: "dev_subscription",
      terms: { priceMinor: 100, aiOpsMinor: null },
      period,
      catalogue,
      overage: null,
      words,
    });
    expect(r.ok && r.lines[0]?.code).toBe("S18");
  });
  it("AI Ops is its own line from S17 (its rate may come from the settings: null)", () => {
    const r = careLines({
      tier: "essential",
      terms: { priceMinor: 100, aiOpsMinor: 40 },
      period,
      catalogue,
      overage: null,
      words,
    });
    expect(r.ok && r.lines.map((l) => [l.kind, l.code, l.rateMinor, l.gstRateBp])).toEqual([
      ["plan", "S16", 100, 1800],
      ["ai_ops", "S17", 40, null],
    ]);
    // zero AI Ops makes no line
    const z = careLines({
      tier: "essential",
      terms: { priceMinor: 100, aiOpsMinor: 0 },
      period,
      catalogue,
      overage: null,
      words,
    });
    expect(z.ok && z.lines).toHaveLength(1);
  });
  it("overage: one line in hours at the terms' rate (15-minute steps are exact), from the previous period", () => {
    const r = careLines({
      tier: "essential",
      terms: { priceMinor: 100, aiOpsMinor: null },
      period,
      catalogue,
      overage: { period: { start: "2026-10-05", end: "2026-11-04" }, minutes: 135, rateMinor: 120_000 },
      words,
    });
    expect(r.ok && r.overage).toEqual({ minutes: 135, priced: true });
    expect(r.ok && r.lines[1]).toMatchObject({
      kind: "overage",
      unit: "hour",
      qtyMilli: 2250,
      rateMinor: 120_000,
      description: "Extra 2026-10-05",
    });
  });
  it("overage with no rate: no line, and it says so; no overage: nothing", () => {
    const r = careLines({
      tier: "essential",
      terms: { priceMinor: 100, aiOpsMinor: null },
      period,
      catalogue,
      overage: { period, minutes: 30, rateMinor: null },
      words,
    });
    expect(r.ok && r.lines).toHaveLength(1);
    expect(r.ok && r.overage).toEqual({ minutes: 30, priced: false });
    const none = careLines({
      tier: "essential",
      terms: { priceMinor: 100, aiOpsMinor: null },
      period,
      catalogue,
      overage: { period, minutes: 0, rateMinor: 5 },
      words,
    });
    expect(none.ok && none.overage).toBeNull();
  });
  it("overage minutes that are not a 15-minute step throw (the quantity would not be exact)", () => {
    expect(() =>
      careLines({
        tier: "essential",
        terms: { priceMinor: 100, aiOpsMinor: null },
        period,
        catalogue,
        overage: { period, minutes: 10, rateMinor: 5 },
        words,
      }),
    ).toThrow(RangeError);
  });
  it("a missing catalogue service is an error, not a made-up line", () => {
    expect(
      careLines({
        tier: "essential",
        terms: { priceMinor: 1, aiOpsMinor: null },
        period,
        catalogue: {},
        overage: null,
        words,
      }),
    ).toEqual({ ok: false, error: "service_missing", code: "S16" });
    expect(
      careLines({
        tier: "dev_subscription",
        terms: { priceMinor: 1, aiOpsMinor: null },
        period,
        catalogue: { S16: catalogue.S16 as { sac: string | null; gstRateBp: number | null } },
        overage: null,
        words,
      }),
    ).toEqual({ ok: false, error: "service_missing", code: "S18" });
    expect(
      careLines({
        tier: "essential",
        terms: { priceMinor: 1, aiOpsMinor: 5 },
        period,
        catalogue: { S16: catalogue.S16 as { sac: string | null; gstRateBp: number | null } },
        overage: null,
        words,
      }),
    ).toEqual({ ok: false, error: "service_missing", code: "S17" });
  });
  it("the default words are a marked placeholder until 07-U (so an automatic issue refuses them)", () => {
    expect(hasPlaceholder(CARE_LINE_WORDS.plan("Growth", period))).toBe(true);
    expect(hasPlaceholder(CARE_LINE_WORDS.aiOps(period))).toBe(true);
    expect(hasPlaceholder(CARE_LINE_WORDS.overage(period))).toBe(true);
    expect(hasPlaceholder("Care plan, Growth")).toBe(false);
    expect(CARE_LINE_WORDS.plan("Growth", period)).toContain("05 Nov 2026");
  });
});

describe("unbilledCutoff [ADM-INV-19: IST day 25]", () => {
  const at = (y: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0) =>
    fromIst({ year: y, month: m, day: d }, h, mi, s) + ms;
  it("is quiet at 23:59:59.999 on IST day 24 after delivery and warns at 00:00 on day 25", () => {
    const delivered = at(2026, 10, 1, 14, 30); // IST day 1 October
    expect(delivered <= unbilledCutoff(at(2026, 10, 25, 23, 59, 59, 999), 25)).toBe(false);
    expect(delivered <= unbilledCutoff(at(2026, 10, 26, 0), 25)).toBe(true);
    // delivered at 00:00:00.000 and at 23:59:59.999 of the same IST day warn together
    for (const d of [at(2026, 10, 1, 0), at(2026, 10, 1, 23, 59, 59, 999)]) {
      expect(d <= unbilledCutoff(at(2026, 10, 26, 0), 25)).toBe(true);
      expect(d <= unbilledCutoff(at(2026, 10, 25, 23, 59, 59, 999), 25)).toBe(false);
    }
  });
  it("agrees with proformaWarnAt for any delivery and any moment (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2029, 0, 1) }),
        fc.integer({ min: 0, max: 60 * 86_400_000 }),
        fc.integer({ min: 1, max: 30 }),
        (delivered, later, days) => {
          const now = delivered + later;
          expect(delivered <= unbilledCutoff(now, days)).toBe(proformaWarnAt(delivered, days) <= now);
        },
      ),
    );
  });
});

describe("autoIssueEligibility [LD58, LD66]", () => {
  const good = {
    toggleOn: true,
    toggleByOwner: true,
    termsByOwner: true,
    currency: "INR",
    overageMinutes: null as number | null,
    blockerCodes: [] as string[],
    recipients: 2,
  };
  it("issues only when every condition holds", () => {
    expect(autoIssueEligibility(good)).toEqual({ ok: true, notEmailed: false });
  });
  it("no recipient is not a refusal: it issues and says it will not be emailed", () => {
    expect(autoIssueEligibility({ ...good, recipients: 0 })).toEqual({ ok: true, notEmailed: true });
  });
  const refused: [string, Partial<typeof good>, string[]][] = [
    ["the toggle is off", { toggleOn: false }, ["toggle_off"]],
    ["the toggle was set by Staff (nobody named)", { toggleByOwner: false }, ["toggle_not_owner"]],
    ["Staff wrote the terms", { termsByOwner: false }, ["terms_not_owner"]],
    ["a USD client always gets a draft (the rate is typed by hand)", { currency: "USD" }, ["usd_needs_fx"]],
    ["overage is on the draft", { overageMinutes: 45 }, ["overage_present"]],
    ["the draft has blockers", { blockerCodes: ["bank_missing"] }, ["blockers"]],
    [
      "several at once, in a stable order",
      { toggleOn: false, termsByOwner: false, currency: "USD", overageMinutes: 15, blockerCodes: ["x"] },
      ["toggle_off", "terms_not_owner", "usd_needs_fx", "overage_present", "blockers"],
    ],
  ];
  for (const [name, over, reasons] of refused)
    it(`refuses when ${name}`, () =>
      expect(autoIssueEligibility({ ...good, ...over })).toEqual({ ok: false, reasons }));
  it("the reason list is closed", () => {
    expect([...AUTO_ISSUE_REASONS]).toEqual([
      "toggle_off",
      "toggle_not_owner",
      "terms_not_owner",
      "usd_needs_fx",
      "overage_present",
      "blockers",
      "no_recipient",
    ]);
  });
});
