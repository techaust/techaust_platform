import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  canMoveMilestone,
  canMoveProject,
  MILESTONE_API_TRANSITIONS,
  MILESTONE_STATUSES,
  milestoneTotals,
  PROJECT_STATUSES,
  PROJECT_TRANSITIONS,
} from "../src/projects.ts";

describe("project status moves [ADM-PRJ-01]", () => {
  it("allows exactly the listed moves", () => {
    const allowed = [
      "planned>active",
      "planned>cancelled",
      "active>on_hold",
      "active>completed",
      "active>cancelled",
      "on_hold>active",
      "on_hold>cancelled",
    ];
    for (const from of PROJECT_STATUSES)
      for (const to of PROJECT_STATUSES)
        expect(canMoveProject(from, to), `${from}>${to}`).toBe(allowed.includes(`${from}>${to}`));
  });

  it("completed and cancelled are terminal", () => {
    expect(PROJECT_TRANSITIONS.completed).toEqual([]);
    expect(PROJECT_TRANSITIONS.cancelled).toEqual([]);
  });
});

describe("milestone status moves through the API [ADM-PRJ-02]", () => {
  it("pending and ready_to_bill swap; invoiced and paid are never set or left here", () => {
    for (const from of MILESTONE_STATUSES)
      for (const to of MILESTONE_STATUSES) {
        const ok =
          (from === "pending" && to === "ready_to_bill") || (from === "ready_to_bill" && to === "pending");
        expect(canMoveMilestone(from, to), `${from}>${to}`).toBe(ok);
      }
    expect(MILESTONE_API_TRANSITIONS.invoiced).toEqual([]);
    expect(MILESTONE_API_TRANSITIONS.paid).toEqual([]);
  });
});

describe("milestoneTotals", () => {
  it("adds fixed amounts and percentage lines, half up", () => {
    // 1/3 of 100 paise = 33.33 -> 33; 50 % of 5 paise = 2.5 -> 3
    expect(milestoneTotals(100, [{ amountMinor: null, pctBp: 3333 }]).totalMinor).toBe(33);
    expect(milestoneTotals(5, [{ amountMinor: null, pctBp: 5000 }]).totalMinor).toBe(3);
    expect(
      milestoneTotals(100_000, [
        { amountMinor: 25_000, pctBp: null },
        { amountMinor: null, pctBp: 7500 },
      ]),
    ).toEqual({ totalMinor: 100_000, mismatch: false });
  });

  it("flags a mismatch only when there is a budget", () => {
    expect(milestoneTotals(1000, [{ amountMinor: 999, pctBp: null }])).toEqual({
      totalMinor: 999,
      mismatch: true,
    });
    expect(
      milestoneTotals(null, [
        { amountMinor: 999, pctBp: null },
        { amountMinor: null, pctBp: 5000 },
      ]),
    ).toEqual({
      totalMinor: 999,
      mismatch: false,
    });
    expect(milestoneTotals(0, [])).toEqual({ totalMinor: 0, mismatch: false });
  });

  it("is exact for big amounts (bigint inside)", () => {
    const budget = 9_000_000_000_000; // 90 billion rupees in paise, near the safe-integer range for a product
    expect(milestoneTotals(budget, [{ amountMinor: null, pctBp: 10_000 }])).toEqual({
      totalMinor: budget,
      mismatch: false,
    });
  });

  it("property: percentage lines of any budget never exceed it and stay within half a unit per line", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 ** 12 }),
        fc.array(fc.integer({ min: 0, max: 10_000 }), { maxLength: 20 }),
        (budget, pcts) => {
          const { totalMinor } = milestoneTotals(
            budget,
            pcts.map((p) => ({ amountMinor: null, pctBp: p })),
          );
          const exactTimes10000 = BigInt(budget) * BigInt(pcts.reduce((a, b) => a + b, 0));
          const diff = BigInt(totalMinor) * 10_000n - exactTimes10000;
          expect(diff <= BigInt(pcts.length) * 5000n && -diff <= BigInt(pcts.length) * 5000n).toBe(true);
        },
      ),
    );
  });
});
