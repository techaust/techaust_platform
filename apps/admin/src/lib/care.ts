// The words and the pure rules of the M3.5 care plan screens (ADM-CARE-01, ADM-CARE-03): tier, status and rollover labels, the
// 07-M copy word for word, the error sentences by API code, hours as people read them, the hours bar, the new-plan and terms
// forms. Pure, so the copy and the rules are tested without a browser.
//
// Copy: 07-M (docs/07-content-appendix/M-m3.5-care-time-screens.md) is a DRAFT pending the owner's word-for-word approval. A
// sentence the screens need and 07-M lacks is a PLACEHOLDER: it carries a visible "[Placeholder]" tag (`pending()` from the M3.4
// words), sits in `CARE_PENDING` below, and is listed in the designer report. Labels (buttons, columns, field names) come from the
// PRD and the existing screens. Amounts are formatted only through @techaust/core; the screens never add money up themselves.

import {
  CARE_STATUSES,
  CARE_STEP_MINUTES,
  CARE_TIERS,
  CARE_TRANSITIONS,
  MAX_BILLING_DAY,
  statusEffectiveOn,
  termsEffectiveFrom,
} from "@techaust/core/care";
import { formatDate, parseIsoDate } from "@techaust/core/dates";
import type {
  CareDefaults,
  CarePlanBase,
  CareStatus,
  CareTerms,
  CareTermsInput,
  CareTier,
  CareUsage,
  Currency,
  NewCarePlanInput,
  RolloverRule,
} from "../api.ts";
import { RequestError } from "../api.ts";
import type { PillTone } from "../components/display.tsx";
import { sentence } from "./format.ts";
import { moneyText, pending } from "./projects.ts";
import { intIn, moneyFrom, moneyInput } from "./settings-form.ts";

// ---- labels ----------------------------------------------------------------------------------------------------------------

export { CARE_STATUSES, CARE_TIERS };

/** docs/04 ADM-CARE-01: Essential / Growth / Scale / Dev Subscription / custom. */
export const TIER_LABELS: Record<CareTier, string> = {
  essential: "Essential",
  growth: "Growth",
  scale: "Scale",
  dev_subscription: "Dev Subscription",
  custom: "Custom",
};
/** 07-M statuses. */
export const CARE_STATUS_LABELS: Record<CareStatus, string> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};
/** docs/04 ADM-CARE-01: none / 1 month. */
export const ROLLOVER_LABELS: Record<RolloverRule, string> = { none: "None", one_month: "1 month" };

type Pill = { tone: PillTone; icon: "send" | "clock" | "ban" | "flag" | "check" | "lock" };
/** Icon + text + colour (docs/06 §5.5), never colour alone. */
export const CARE_PILLS: Record<CareStatus, Pill> = {
  active: { tone: "info", icon: "send" },
  paused: { tone: "warning", icon: "clock" },
  cancelled: { tone: "muted", icon: "ban" },
};

// ---- 07-M copy, word for word (draft, pending the owner) -----------------------------------------------------------------

export const CARE_COPY = {
  // 07-M's empty line in two parts (the M3.4 pattern): the first sentence is the empty state's heading, the second its body.
  listEmptyTitle: "No care plans yet",
  listEmptyBody: "A care plan starts when a client signs up for monthly support.",
  listNoMatch: "Try fewer filters.",
  currencyLine: "The plan uses the client's currency.",
  includedHint: "In steps of 15 minutes. Leave empty if the plan has no included hours.",
  overageRateHint: "Charged per hour above the included hours, before GST.",
  rolloverHint: "Unused hours carry over to the next billing period only.",
  billingDayHint: "Day 1 to 28. The plan's hours count from this day to the day before it in the next month.",
  included: "Included",
  carriedOver: "Carried over",
  used: "Used",
  remaining: "Remaining",
  overage: "Overage",
  near: "Near the limit",
  reached: "Limit reached",
  noRate: "No overage rate set, so the overage can't be priced.",
  beforeGst: "Amounts are before GST.",
  addToInvoice: "Adding overage to the next invoice arrives with recurring invoices.",
  /** The client tab's line is the empty state's heading (the M3.4 pattern), without its full stop. */
  clientTabEmptyTitle: "No care plans for this client yet",
  clientAnonymised: "This client's personal details were removed, so nothing new can be added to it.",
  notStarted: "Not started",
} as const;

/** 07-M's project page figure, shown under the "Hours logged" label. */
export const hoursLoggedLine = (totalMinutes: number, billableMinutes: number) =>
  `${hoursText(totalMinutes)}, of which ${hoursText(billableMinutes)} billable`;

/** "{start} to {end}", the current period card's heading. */
export const periodText = (p: { start: string; end: string }) => `${dayText(p.start)} to ${dayText(p.end)}`;
export const pendingTermsLine = (date: string) => `New terms from ${dayText(date)}.`;
export const termsConfirm = (plan: string, date: string) =>
  `Change the terms of ${plan} from ${dayText(date)}? The current billing period keeps its terms.`;
export const pauseConfirm = (plan: string, date: string) =>
  `Pause ${plan} from ${dayText(date)}? No time can be logged to it while it's paused.`;
export const resumeConfirm = (plan: string, date: string) => `Resume ${plan} from ${dayText(date)}?`;
export const cancelPlanConfirm = (plan: string, date: string) =>
  `Cancel ${plan} from ${dayText(date)}? This can't be undone. To restart, create a new plan.`;
export const invalidCareTransition = (from: CareStatus, to: CareStatus) =>
  `A care plan can't move from ${CARE_STATUS_LABELS[from]} to ${CARE_STATUS_LABELS[to]}.`;

export const CARE_TOASTS = {
  added: "Care plan added.",
  termsChanged: (date: string) => `Terms changed from ${dayText(date)}.`,
  paused: "Care plan paused.",
  resumed: "Care plan resumed.",
  cancelled: "Care plan cancelled.",
} as const;

export const statusToast = (to: CareStatus) =>
  to === "paused" ? CARE_TOASTS.paused : to === "active" ? CARE_TOASTS.resumed : CARE_TOASTS.cancelled;

// ---- placeholders (not in 07-M; each listed in the designer report) --------------------------------------------------------

export const CARE_PENDING = {
  stalePlan: pending("Someone else changed this care plan."),
  enterBillingDay: pending("Enter a day from 1 to 28."),
  enterStartDate: pending("Enter the start date."),
  enterPrice: pending("Enter the price per month."),
  enterHours: pending("Enter whole hours, then choose the minutes."),
  noTermsChange: pending("Change at least one of the terms first."),
  clientFilterClear: pending("Show care plans of all clients"),
  /** API codes with no 07-M sentence: the server's own words, marked. */
  serverWords: (message: string) => pending(sentence(message)),
} as const;

// ---- errors by API code ------------------------------------------------------------------------------------------------------

/** 07-M errors that a care-plan or time request can return. */
export const CODE_COPY: Record<string, string> = {
  day_cap: "That would take this person over 24 hours on that day.",
  plan_not_active: "The care plan isn't active on that date.",
  project_closed: "The project is cancelled, so its time can't change.",
  time_locked: "This entry is locked. Only the owner can change it now.",
  owner_only_date: "Only the owner can log time more than 7 days back.",
  future_date: "Time can't be logged for a future date.",
  one_target: "Choose a project or a care plan, not both.",
  plan_cancelled: "This care plan is cancelled.",
  client_anonymised: "This client's personal details were removed, so nothing new can be added to it.",
  bad_user: "Choose an active member of staff.",
};

/** The sentence for a failed M3.5 request: 07-M by code, the transition line, else the server's words marked as a placeholder. */
export function careErrorText(e: unknown, move?: { from: CareStatus; to: CareStatus }): string {
  if (!(e instanceof RequestError)) return "Couldn't reach the server. Check your connection and try again.";
  if (e.code === "invalid_transition" && move) return invalidCareTransition(move.from, move.to);
  const known = CODE_COPY[e.code];
  if (known) return known;
  if (e.code === "network" || e.code === "step_up_cancelled") return e.message;
  return CARE_PENDING.serverWords(e.message);
}

// ---- hours, dates and money ------------------------------------------------------------------------------------------------

/** Minutes as people read hours: "45 min", "2 h", "2 h 15 min" (always whole minutes; the API keeps 15-minute steps). */
export function hoursText(minutes: number): string {
  const m = Math.max(0, Math.trunc(minutes));
  const h = Math.trunc(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

/** The compact form for a timesheet cell: "2:15", "0:45". */
export const clockText = (minutes: number) =>
  `${Math.trunc(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/** An IST day as the other screens show it: 05 Nov 2026 (the stored text when it can't be read). */
export function dayText(iso: string): string {
  const d = parseIsoDate(iso);
  return d ? formatDate(d) : iso;
}

export { moneyText };

/** How a plan is named in the confirmations and its page title: "the Growth plan for Riverside Clinic". */
export const planName = (tier: CareTier | null | undefined, clientName: string) =>
  `the ${tier ? TIER_LABELS[tier] : "care"} plan for ${clientName}`;
/** The page title: "Growth plan for Riverside Clinic". */
export const planTitle = (tier: CareTier | null | undefined, clientName: string) =>
  `${tier ? TIER_LABELS[tier] : "Care"} plan for ${clientName}`;

/** The moves a person may make from a status (core's list, the API's rule); cancelling is the owner's. */
export const careMoves = (from: CareStatus, canCancel: boolean): CareStatus[] =>
  CARE_TRANSITIONS[from].filter((to) => to !== "cancelled" || canCancel);

/** The date a status change takes effect: today, or the start date if that is later (core's rule, shown before asking). */
export const statusDate = (today: string, plan: Pick<CarePlanBase, "billingDay" | "startDate">) =>
  statusEffectiveOn(today, plan);
/** The date new terms take effect: the next billing period, or the start date if the plan hasn't started (owner's Q1). */
export const termsDate = (today: string, plan: Pick<CarePlanBase, "billingDay" | "startDate">) =>
  termsEffectiveFrom(today, plan);

// ---- the hours bar ---------------------------------------------------------------------------------------------------------

/**
 * The bar of one period's hours: how much of the track is filled (0 to 100, whole per cent, floor), and the tone. The track is the
 * hours available (included plus carried over); time beyond it is overage, shown in words, so the bar stops at full. With no hours
 * available the bar is empty and only the words speak.
 */
export function hoursBar(u: Pick<CareUsage, "used" | "available" | "flag">): {
  pct: number;
  tone: "calm" | "near" | "reached";
} {
  const pct = u.available > 0 ? Math.min(100, Math.floor((u.used * 100) / u.available)) : 0;
  return { pct, tone: u.flag === "reached" ? "reached" : u.flag === "near" ? "near" : "calm" };
}

/** The flag's words (07-M), or null when there is none. */
export const flagText = (flag: CareUsage["flag"]) =>
  flag === "reached" ? CARE_COPY.reached : flag === "near" ? CARE_COPY.near : null;

// ---- the plan forms ---------------------------------------------------------------------------------------------------------

/** Included hours typed as hours and a quarter: "" (no included hours) or a whole number of hours plus 0, 15, 30 or 45 minutes. */
export type DurationForm = { hours: string; minutes: string };
export const QUARTERS = ["0", "15", "30", "45"] as const;

export const durationOf = (minutes: number | null): DurationForm =>
  minutes === null || minutes === 0
    ? { hours: "", minutes: "0" }
    : { hours: String(Math.trunc(minutes / 60)), minutes: String(minutes % 60) };

/** Minutes from the two fields, or null when they don't make a whole number of 15-minute steps. Empty hours and 0 = 0 minutes. */
export function durationMinutes(f: DurationForm, maxHours: number): number | null {
  const h = f.hours.trim() === "" ? 0 : intIn(f.hours, 0, maxHours);
  const m = intIn(f.minutes, 0, 45);
  if (h === null || m === null || m % CARE_STEP_MINUTES !== 0) return null;
  const total = h * 60 + m;
  return total > maxHours * 60 ? null : total;
}

export type PlanForm = {
  tier: CareTier;
  price: string;
  included: DurationForm;
  aiOps: boolean;
  aiOpsPrice: string;
  overageRate: string;
  rollover: RolloverRule;
  startDate: string;
  billingDay: string;
};

/** The form for a new plan with the catalogue's prefill for a tier (nothing invented: an undecided value stays empty). */
export function planFormFor(
  tier: CareTier,
  d: CareDefaults,
  base?: { [K in keyof PlanForm]?: PlanForm[K] | undefined },
): PlanForm {
  const t = d.tiers[tier];
  return {
    tier,
    price: t.priceMinor === null ? "" : moneyInput(t.priceMinor, d.currency),
    included: durationOf(t.includedMinutes),
    aiOps: base?.aiOps ?? false,
    aiOpsPrice: base?.aiOpsPrice ?? (d.aiOpsMinor === null ? "" : moneyInput(d.aiOpsMinor, d.currency)),
    overageRate:
      base?.overageRate ?? (d.overageRateMinor === null ? "" : moneyInput(d.overageRateMinor, d.currency)),
    rollover: t.rollover,
    startDate: base?.startDate ?? "",
    billingDay: base?.billingDay ?? "1",
  };
}

export type PlanErrors = Partial<
  Record<"price" | "included" | "aiOpsPrice" | "overageRate" | "startDate" | "billingDay", string>
>;

const INCLUDED_MAX_HOURS = 2000;

/** The form as the API's body, or the errors to show. */
export function planInput(
  f: PlanForm,
  clientId: string,
  currency: Currency,
): { ok: true; body: NewCarePlanInput } | { ok: false; errors: PlanErrors } {
  const errors: PlanErrors = {};
  const price = f.price.trim() ? moneyFrom(f.price, currency) : null;
  if (!price) errors.price = CARE_PENDING.enterPrice;
  else if (!price.ok) errors.price = price.error;
  const included = durationMinutes(f.included, INCLUDED_MAX_HOURS);
  if (included === null) errors.included = CARE_PENDING.enterHours;
  const ai = f.aiOps ? moneyFrom(f.aiOpsPrice, currency) : null;
  if (ai && !ai.ok) errors.aiOpsPrice = ai.error;
  const rate = f.overageRate.trim() ? moneyFrom(f.overageRate, currency) : null;
  if (rate && !rate.ok) errors.overageRate = rate.error;
  if (!parseIsoDate(f.startDate)) errors.startDate = CARE_PENDING.enterStartDate;
  const day = intIn(f.billingDay, 1, MAX_BILLING_DAY);
  if (day === null) errors.billingDay = CARE_PENDING.enterBillingDay;
  if (Object.keys(errors).length || !price?.ok || included === null || day === null)
    return { ok: false, errors };
  return {
    ok: true,
    body: {
      clientId,
      tier: f.tier,
      priceMinor: price.minor,
      includedMinutes: included,
      aiOpsMinor: ai?.ok ? ai.minor : null,
      overageRateMinor: rate?.ok ? rate.minor : null,
      rollover: f.rollover,
      startDate: f.startDate,
      billingDay: day,
    },
  };
}

/** The terms form, from the newest terms (a pending change if one is booked, else the current ones). */
export type TermsForm = Omit<PlanForm, "startDate" | "billingDay">;
export const termsFormOf = (t: CareTerms, currency: Currency): TermsForm => ({
  tier: t.tier,
  price: moneyInput(t.priceMinor, currency),
  included: durationOf(t.includedMinutes),
  aiOps: t.aiOpsMinor !== null,
  aiOpsPrice: t.aiOpsMinor === null ? "" : moneyInput(t.aiOpsMinor, currency),
  overageRate: t.overageRateMinor === null ? "" : moneyInput(t.overageRateMinor, currency),
  rollover: t.rollover,
});

/** One changed term, for the confirmation's summary ("Price per month: ₹10,000.00 to ₹12,000.00"). */
export type TermChange = { field: string; from: string; to: string };

/** What a terms change sends (only the fields that differ from the newest terms) and the summary of it, or the errors. */
export function termsChange(
  f: TermsForm,
  newest: CareTerms,
  currency: Currency,
):
  | { ok: true; body: Omit<CareTermsInput, "expectedUpdatedAt">; changes: TermChange[] }
  | { ok: false; errors: PlanErrors } {
  const r = planInput({ ...f, startDate: "2000-01-01", billingDay: "1" }, "", currency);
  if (!r.ok) return r;
  const b = r.body;
  const body: Omit<CareTermsInput, "expectedUpdatedAt"> = {};
  const changes: TermChange[] = [];
  const money = (v: number | null) => (v === null ? "None" : moneyText(v, currency));
  if (b.tier !== newest.tier) {
    body.tier = b.tier;
    changes.push({ field: "Tier", from: TIER_LABELS[newest.tier], to: TIER_LABELS[b.tier] });
  }
  if (b.priceMinor !== newest.priceMinor) {
    body.priceMinor = b.priceMinor;
    changes.push({ field: "Price per month", from: money(newest.priceMinor), to: money(b.priceMinor) });
  }
  if (b.includedMinutes !== newest.includedMinutes) {
    body.includedMinutes = b.includedMinutes;
    changes.push({
      field: "Included hours",
      from: hoursText(newest.includedMinutes),
      to: hoursText(b.includedMinutes),
    });
  }
  if ((b.aiOpsMinor ?? null) !== newest.aiOpsMinor) {
    body.aiOpsMinor = b.aiOpsMinor ?? null;
    changes.push({ field: "AI Ops add-on", from: money(newest.aiOpsMinor), to: money(b.aiOpsMinor ?? null) });
  }
  if ((b.overageRateMinor ?? null) !== newest.overageRateMinor) {
    body.overageRateMinor = b.overageRateMinor ?? null;
    changes.push({
      field: "Overage rate per hour",
      from: money(newest.overageRateMinor),
      to: money(b.overageRateMinor ?? null),
    });
  }
  if (b.rollover !== newest.rollover) {
    body.rollover = b.rollover;
    changes.push({
      field: "Rollover",
      from: ROLLOVER_LABELS[newest.rollover],
      to: ROLLOVER_LABELS[b.rollover],
    });
  }
  return { ok: true, body, changes };
}

/** The terms a change is laid over (the server's rule): the newest row, i.e. the pending one when a change is booked. */
export const newestTerms = (t: { current: CareTerms | null; pending: CareTerms | null }) =>
  t.pending ?? t.current;
