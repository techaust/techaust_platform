// Recurring care invoices, pure [ADM-CARE-02, ADM-CARE-03, LD58, LD59, LD66]: when a plan is due, the lines, and whether the job may issue the draft itself.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planPeriodOf } from "../src/care.ts";
import {
  AUTO_ISSUE_REASONS,
  autoIssueEligibility,
  billingPeriodOf,
  CARE_LINE_WORDS,
  CARE_SCAN_HOUR_IST,
  CARE_SCAN_LAST_HOUR_IST,
  CARE_SCAN_REPEAT_HOURS,
  type CareCatalogue,
  careDue,
  careLines,
  firstMissedPeriod,
  hoursText,
  nextBillingDayOf,
  periodWords,
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

describe("nextBillingDayOf: the day the job next drafts the plan", () => {
  const active = [{ id: "a", effectiveOn: "2026-01-01", createdAt: 1, status: "active" as const }];
  it("start date before the plan starts; today when the period is due; the next period's first day once billed; null when cancelled", () => {
    expect(nextBillingDayOf("2026-11-04", plan(5, "2026-12-01"), "active", null, active)).toBe("2026-12-01");
    expect(nextBillingDayOf("2026-11-06", plan(5, "2026-01-01"), "active", "2026-10-05", active)).toBe(
      "2026-11-06",
    );
    expect(nextBillingDayOf("2026-11-06", plan(5, "2026-01-01"), "active", "2026-11-05", active)).toBe(
      "2026-12-05",
    );
    expect(
      nextBillingDayOf("2026-11-06", plan(5, "2026-01-01"), "cancelled", "2026-11-05", active),
    ).toBeNull();
  });
  it("a period due and unbilled is today until the day's last scan (08:00 IST) has begun and tomorrow from then on; billed, paused or not started, the hour changes nothing (finding 11, FX-3)", () => {
    const p = plan(5, "2026-01-01");
    expect(CARE_SCAN_HOUR_IST).toBe(6);
    // FX-1 repeats the scan at 07:00 and 08:00 IST (jobs `hourlyMessages`): the last scan of the day begins at 08:00
    expect(CARE_SCAN_REPEAT_HOURS).toBe(2);
    expect(CARE_SCAN_LAST_HOUR_IST).toBe(8);
    // before the 08:00 scan (the 06:00 and 07:00 ones included): today, as without the hour
    for (const h of [0, 5, 6, 7]) {
      expect(nextBillingDayOf("2026-11-06", p, "active", "2026-10-05", active, h)).toBe("2026-11-06");
    }
    expect(nextBillingDayOf("2026-11-06", p, "active", "2026-10-05", active)).toBe("2026-11-06");
    // from 08:00 on: tomorrow, across a month end and a year end too
    for (const h of [8, 9, 15, 23]) {
      expect(nextBillingDayOf("2026-11-06", p, "active", "2026-10-05", active, h)).toBe("2026-11-07");
    }
    expect(nextBillingDayOf("2026-11-30", p, "active", "2026-10-05", active, 10)).toBe("2026-12-01");
    expect(nextBillingDayOf("2026-12-31", plan(5, "2026-01-01"), "active", "2026-11-05", active, 10)).toBe(
      "2027-01-01",
    );
    // the billing day itself, never billed: due today until 08:00, tomorrow after (a catch-up)
    expect(nextBillingDayOf("2026-11-05", p, "active", null, active, 5)).toBe("2026-11-05");
    expect(nextBillingDayOf("2026-11-05", p, "active", null, active, 7)).toBe("2026-11-05");
    expect(nextBillingDayOf("2026-11-05", p, "active", null, active, 8)).toBe("2026-11-06");
    // already billed: the next period's first day, whatever the hour
    expect(nextBillingDayOf("2026-11-06", p, "active", "2026-11-05", active, 20)).toBe("2026-12-05");
    // not started: the start date; cancelled: none
    expect(nextBillingDayOf("2026-11-04", plan(5, "2026-12-01"), "active", null, active, 20)).toBe(
      "2026-12-01",
    );
    expect(nextBillingDayOf("2026-11-06", p, "cancelled", "2026-11-05", active, 20)).toBeNull();
  });
  it("a plan that was paused on the period's first day is not due: the next period", () => {
    const paused = [
      { id: "a", effectiveOn: "2026-01-01", createdAt: 1, status: "active" as const },
      { id: "b", effectiveOn: "2026-11-01", createdAt: 2, status: "paused" as const },
    ];
    expect(nextBillingDayOf("2026-11-06", plan(5, "2026-01-01"), "paused", "2026-10-05", paused)).toBe(
      "2026-12-05",
    );
  });
});

describe("firstMissedPeriod and periodWords (the bells' {period})", () => {
  const active = [{ id: "a", effectiveOn: "2026-01-01", createdAt: 1, status: "active" as const }];
  const current = { start: "2026-11-05", end: "2026-12-04" };
  it("is the OLDEST active period after the last one billed; null when none or never billed", () => {
    expect(firstMissedPeriod(plan(5, "2026-01-01"), "2026-08-05", current, active)).toEqual({
      start: "2026-09-05",
      end: "2026-10-04",
    });
    expect(firstMissedPeriod(plan(5, "2026-01-01"), "2026-10-05", current, active)).toBeNull();
    expect(firstMissedPeriod(plan(5, "2026-01-01"), null, current, active)).toBeNull();
  });
  it("a period the plan was paused on its first day is not missed", () => {
    const paused = [
      ...active,
      { id: "b", effectiveOn: "2026-09-01", createdAt: 2, status: "paused" as const },
      { id: "c", effectiveOn: "2026-10-01", createdAt: 3, status: "active" as const },
    ];
    expect(firstMissedPeriod(plan(5, "2026-08-05"), "2026-08-05", current, paused)).toEqual({
      start: "2026-10-05",
      end: "2026-11-04",
    });
  });
  it("periodWords prints both ends in the house date format", () => {
    expect(periodWords(current)).toBe("05 Nov 2026 to 04 Dec 2026");
  });
});

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
  it("with the status history, a period the plan was paused over is not 'missed' (early check finding 6); one it was active over is", () => {
    const row = (id: string, effectiveOn: string, status: "active" | "paused" | "cancelled") => ({
      id,
      effectiveOn,
      createdAt: 1,
      status,
    });
    const p = plan(5, "2026-01-01");
    // active, paused 2026-10-01 to 2026-11-30, active again from 2026-12-01 (the paused periods start 10-05 and 11-05)
    const history = [
      row("a", "2026-01-01", "active"),
      row("b", "2026-10-01", "paused"),
      row("c", "2026-12-01", "active"),
    ];
    // last billed 09-05; periods 10-05 and 11-05 were skipped, both paused: nothing is missed
    expect(careDue("2026-12-05", p, "2026-09-05", "active", history)).toMatchObject({
      due: true,
      missedEarlier: false,
    });
    // the same gap with no history given keeps the plain rule
    expect(careDue("2026-12-05", p, "2026-09-05", "active")).toMatchObject({ missedEarlier: true });
    // last billed 08-05: the period 09-05 was active and skipped: missed
    expect(careDue("2026-12-05", p, "2026-08-05", "active", history)).toMatchObject({ missedEarlier: true });
    // always active: the plain gap
    expect(
      careDue("2026-12-05", p, "2026-10-05", "active", [row("a", "2026-01-01", "active")]),
    ).toMatchObject({
      missedEarlier: true,
    });
    expect(careDue("2026-12-05", p, "2026-11-05", "active", history)).toMatchObject({ missedEarlier: false });
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
  it("the default words are 07-U §6 word for word, with no placeholder mark (approved by the lead 2026-10-28), so the automatic issue works for the plan and AI Ops lines", () => {
    expect(CARE_LINE_WORDS.plan("Growth", period)).toBe("Growth care plan, 05 Nov 2026 to 04 Dec 2026");
    expect(CARE_LINE_WORDS.aiOps(period)).toBe("AI Ops, 05 Nov 2026 to 04 Dec 2026");
    expect(CARE_LINE_WORDS.overage(period, "2.25", "₹1,200.00")).toBe(
      "Extra hours above the plan, 05 Nov 2026 to 04 Dec 2026 (2.25 h at ₹1,200.00 per hour)",
    );
    for (const line of [
      CARE_LINE_WORDS.plan("Growth", period),
      CARE_LINE_WORDS.aiOps(period),
      CARE_LINE_WORDS.overage(period, "1", "₹1.00"),
    ])
      expect(line).not.toContain("[Placeholder");
  });
  it("the extra-hours line names the hours and the rate from the real overage (15-minute steps), in the client's currency", () => {
    const r = careLines({
      tier: "essential",
      terms: { priceMinor: 100_000, aiOpsMinor: null },
      period,
      catalogue,
      overage: { period: { start: "2026-10-05", end: "2026-11-04" }, minutes: 135, rateMinor: 120_000 },
    });
    expect(r.ok && r.lines.at(-1)?.description).toBe(
      "Extra hours above the plan, 05 Oct 2026 to 04 Nov 2026 (2.25 h at ₹1,200.00 per hour)",
    );
    const usd = careLines({
      tier: "essential",
      terms: { priceMinor: 100_000, aiOpsMinor: null },
      period,
      catalogue,
      overage: { period: { start: "2026-10-05", end: "2026-11-04" }, minutes: 60, rateMinor: 5_000 },
      currency: "USD",
    });
    expect(usd.ok && usd.lines.at(-1)?.description).toContain("(1 h at $50.00 per hour)");
  });
  it("hoursText prints whole 15-minute steps as a decimal without trailing zeros", () => {
    expect([15, 30, 45, 60, 75, 90, 120, 135, 600].map(hoursText)).toEqual([
      "0.25",
      "0.5",
      "0.75",
      "1",
      "1.25",
      "1.5",
      "2",
      "2.25",
      "10",
    ]);
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
