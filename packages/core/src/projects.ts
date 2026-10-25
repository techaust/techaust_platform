// Projects and milestones: the status rules and the milestone total [ADM-PRJ-01, ADM-PRJ-02]. Pure; the API enforces the same
// rules in SQL (a conditional UPDATE on the current status), so these are the single list both sides read.
import { divRoundHalfUp } from "./money.ts";

export const PROJECT_STATUSES = ["planned", "active", "on_hold", "completed", "cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** The moves a person may make (ADM-PRJ-01). Completed and cancelled are terminal. */
export const PROJECT_TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  planned: ["active", "cancelled"],
  active: ["on_hold", "completed", "cancelled"],
  on_hold: ["active", "cancelled"],
  completed: [],
  cancelled: [],
};

export const canMoveProject = (from: ProjectStatus, to: ProjectStatus) =>
  PROJECT_TRANSITIONS[from].includes(to);

export const MILESTONE_STATUSES = ["pending", "ready_to_bill", "invoiced", "paid"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

/**
 * What the milestone route may do: pending and ready to bill, both ways. Invoiced and paid are set only by invoicing (M4.x), which
 * is why the route refuses them.
 */
export const MILESTONE_API_TRANSITIONS: Readonly<Record<MilestoneStatus, readonly MilestoneStatus[]>> = {
  pending: ["ready_to_bill"],
  ready_to_bill: ["pending"],
  invoiced: [],
  paid: [],
};

export const canMoveMilestone = (from: MilestoneStatus, to: MilestoneStatus) =>
  MILESTONE_API_TRANSITIONS[from].includes(to);

export type MilestoneAmount = { amountMinor: number | null; pctBp: number | null };

/**
 * The sum of the milestone lines in minor units. A fixed amount counts as it is; a percentage line is `budget * pct / 10000`
 * rounded half up to the minor unit. With no budget the percentage lines count as 0 (there is nothing to take a share of) and
 * `mismatch` is false. `mismatch` is true when there is a budget and the lines do not add up to it exactly: a warning for the
 * screen, never an error.
 */
export function milestoneTotals(
  budgetMinor: number | null,
  milestones: readonly MilestoneAmount[],
): { totalMinor: number; mismatch: boolean } {
  const budget = budgetMinor === null ? null : BigInt(budgetMinor);
  let total = 0n;
  for (const m of milestones) {
    if (m.amountMinor !== null) total += BigInt(m.amountMinor);
    else if (m.pctBp !== null && budget !== null) total += divRoundHalfUp(budget * BigInt(m.pctBp), 10_000n);
  }
  return { totalMinor: Number(total), mismatch: budget !== null && total !== budget };
}
