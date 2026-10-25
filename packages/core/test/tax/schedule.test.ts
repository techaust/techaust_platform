// Payment schedules [ADM-PROP-03, Q-P3-6]: the cases the golden table does not name.
import { describe, expect, it } from "vitest";
import { computeSchedule, MAX_SCHEDULE_STEPS, type ScheduleStep } from "../../src/tax/index.ts";
import { DEFAULTS, errorsOf, good, makeCtx } from "./fixtures.ts";

const pct = (
  label: string,
  pctBp: number,
  trigger: "on_accept" | "milestone" | "delivery" | "monthly" = "milestone",
): ScheduleStep => ({
  label,
  trigger,
  pctBp,
});

describe("computeSchedule: shape", () => {
  it("needs 1 to 24 steps", () => {
    expect(errorsOf(computeSchedule(100_000, "INR", [], DEFAULTS))).toEqual(["schedule_empty@steps"]);
    const tooMany = Array.from({ length: MAX_SCHEDULE_STEPS + 1 }, (_, i) => pct(`Step ${i}`, 400));
    expect(errorsOf(computeSchedule(100_000, "INR", tooMany, DEFAULTS))).toEqual(["schedule_too_many@steps"]);
  });

  it("24 steps compute, adding up to the total", () => {
    // 23 steps of 4 % and one of 8 %; total Rs 10,000.00 = 1,000,000: each 4 % is 40,000 (a whole rupee), the last the rest
    const steps = [...Array.from({ length: 23 }, (_, i) => pct(`Step ${i}`, 400)), pct("Last", 800)];
    const out = good(computeSchedule(1_000_000, "INR", steps, DEFAULTS));
    expect(out).toHaveLength(24);
    expect(out.slice(0, 23).every((i) => i.amountMinor === 40_000)).toBe(true);
    expect(out[23]?.amountMinor).toBe(80_000);
    expect(out.reduce((a, i) => a + i.amountMinor, 0)).toBe(1_000_000);
  });

  it("a total must be a non-negative whole number; the currency must be known", () => {
    for (const total of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(errorsOf(computeSchedule(total, "INR", [pct("All", 10_000)], DEFAULTS))).toEqual([
        "total_invalid@totalMinor",
      ]);
    }
    expect(errorsOf(computeSchedule(100, "EUR" as unknown as "INR", [pct("All", 10_000)], DEFAULTS))).toEqual(
      ["currency_invalid@currency"],
    );
  });

  it("rejects an empty or very long label, an unknown trigger and a bad share, naming the step", () => {
    const ok = pct("On delivery", 10_000, "delivery");
    expect(errorsOf(computeSchedule(100, "INR", [{ ...ok, label: "   " }], DEFAULTS))).toEqual([
      "schedule_step_invalid@steps.0",
    ]);
    expect(errorsOf(computeSchedule(100, "INR", [{ ...ok, label: "x".repeat(201) }], DEFAULTS))).toEqual([
      "schedule_step_invalid@steps.0",
    ]);
    expect(good(computeSchedule(100, "INR", [{ ...ok, label: "x".repeat(200) }], DEFAULTS))).toHaveLength(1);
    expect(
      errorsOf(computeSchedule(100, "INR", [{ ...ok, trigger: "later" as unknown as "delivery" }], DEFAULTS)),
    ).toEqual(["schedule_step_invalid@steps.0"]);
    for (const pctBp of [-1, 10_001, 0.5, Number.NaN]) {
      expect(errorsOf(computeSchedule(100, "INR", [{ ...ok, pctBp }], DEFAULTS))).toEqual([
        "schedule_step_invalid@steps.0",
      ]);
    }
  });

  it("amount steps: all but the last need an amount of 0 or more", () => {
    const last: ScheduleStep = { label: "On delivery", trigger: "delivery" };
    for (const amountMinor of [undefined, -100, 150.5, Number.NaN]) {
      expect(
        errorsOf(
          computeSchedule(
            1_000_000,
            "INR",
            [{ label: "On acceptance", trigger: "on_accept", amountMinor }, last],
            DEFAULTS,
          ),
        ),
      ).toEqual(["schedule_step_invalid@steps.0"]);
    }
  });

  it("a mixed schedule is one error, not an error per step", () => {
    expect(
      errorsOf(
        computeSchedule(
          100,
          "INR",
          [pct("A", 5000), { label: "B", trigger: "delivery", amountMinor: 50 }],
          DEFAULTS,
        ),
      ),
    ).toEqual(["schedule_mixed_kinds@steps"]);
  });
});

describe("computeSchedule: percent steps", () => {
  it("a single step of 100 % is the whole total", () => {
    const out = good(computeSchedule(10_000_450, "INR", [pct("Upfront", 10_000, "on_accept")], DEFAULTS));
    expect(out).toEqual([{ label: "Upfront", trigger: "on_accept", pctBp: 10_000, amountMinor: 10_000_450 }]);
  });

  it("the shares must add up to 100 %", () => {
    expect(errorsOf(computeSchedule(100, "INR", [pct("A", 5000), pct("B", 5001)], DEFAULTS))).toEqual([
      "schedule_pct_sum@steps",
    ]);
  });

  it("a total that is not a whole rupee: the last instalment keeps the paise", () => {
    // 10,000,450: 50 % = 5,000,225 -> 5,000,200; the last 5,000,250
    const out = good(computeSchedule(10_000_450, "INR", [pct("A", 5000), pct("B", 5000)], DEFAULTS));
    expect(out.map((i) => i.amountMinor)).toEqual([5_000_200, 5_000_250]);
  });

  it("a total of 0 gives zero instalments, each with a warning", () => {
    const r = computeSchedule(0, "INR", [pct("A", 5000), pct("B", 5000)], DEFAULTS);
    expect(good(r).map((i) => i.amountMinor)).toEqual([0, 0]);
    expect(r.ok && r.warnings.map((w) => w.path.join("."))).toEqual(["steps.0", "steps.1"]);
  });

  it("keeps the labels and triggers as given", () => {
    const out = good(
      computeSchedule(
        100_000,
        "USD",
        [pct("Kick-off", 6000, "on_accept"), pct("Go-live", 4000, "delivery")],
        DEFAULTS,
      ),
    );
    expect(out.map((i) => [i.label, i.trigger, i.pctBp, i.amountMinor])).toEqual([
      ["Kick-off", "on_accept", 6000, 60_000],
      ["Go-live", "delivery", 4000, 40_000],
    ]);
  });
});

describe("computeSchedule: amount steps", () => {
  const step = (label: string, amountMinor?: number): ScheduleStep => ({
    label,
    trigger: "milestone",
    amountMinor,
  });

  it("shows cumulative percentages that add up to exactly 100 %", () => {
    // Total Rs 300.00 in three of Rs 100.00: 1/3 = 33.33 % -> 3,333; 2/3 = 66.67 % -> 6,667 so the second shows 3,334; the last 3,333.
    // (Rounding each on its own would show 3,333, 3,333, 3,334.)
    const out = good(
      computeSchedule(30_000, "INR", [step("A", 10_000), step("B", 10_000), step("C")], DEFAULTS),
    );
    expect(out.map((i) => i.pctBp)).toEqual([3333, 3334, 3333]);
    expect(out.map((i) => i.amountMinor)).toEqual([10_000, 10_000, 10_000]);
  });

  it("amounts that leave nothing give a last instalment of 0 with a warning", () => {
    const r = computeSchedule(30_000, "INR", [step("A", 10_000), step("B", 20_000), step("C")], DEFAULTS);
    expect(good(r).map((i) => i.amountMinor)).toEqual([10_000, 20_000, 0]);
    expect(r.ok && r.warnings).toEqual([{ code: "schedule_zero_instalment", path: ["steps", 2] }]);
  });

  it("a total of 0 with typed amounts of 0 shows 0 %, 0 % and 100 % on the last", () => {
    expect(good(computeSchedule(0, "INR", [step("A", 0), step("B")], DEFAULTS)).map((i) => i.pctBp)).toEqual([
      0, 10_000,
    ]);
  });

  it("USD amounts are any number of cents", () => {
    const out = good(computeSchedule(100_001, "USD", [step("A", 33_333), step("B")], DEFAULTS));
    expect(out.map((i) => i.amountMinor)).toEqual([33_333, 66_668]);
  });

  it("all the non-whole-rupee amounts are reported, not just the first", () => {
    expect(
      errorsOf(
        computeSchedule(
          1_000_000,
          "INR",
          [step("A", 150), step("B", 200), step("C", 250), step("D")],
          DEFAULTS,
        ),
      ),
    ).toEqual([
      "schedule_amount_not_whole_unit@steps.0.amountMinor",
      "schedule_amount_not_whole_unit@steps.2.amountMinor",
    ]);
  });

  it("when the settings no longer round INR totals, any paise amount is allowed", () => {
    const off = makeCtx({
      tax: { rounding: { lineTax: "half_up", totalInr: "none" as "nearest_rupee", totalUsd: "none" } },
    });
    expect(
      good(computeSchedule(10_000, "INR", [step("A", 5_050), step("B")], off)).map((i) => i.amountMinor),
    ).toEqual([5_050, 4_950]);
  });
});
