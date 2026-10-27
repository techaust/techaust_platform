// Recurring care-plan invoices, pure (M5.4; ADM-CARE-02, ADM-CARE-03, ADM-INV-12, LD58, LD59, LD66; VERIFY WITH CA/LEGAL for every tax rule). No I/O, no zod, no floats.
//
// A care plan is billed monthly IN ADVANCE: on its billing day (06:00 IST scan; any later day of the period is a catch-up) the job drafts ONE invoice for the plan's
// current period (the first period of a plan starts on its start date and gets the full monthly price: no proration, ADM-CARE-04). The period is recorded in
// `care_invoices` in the same batch that moves `care_plans.last_billed_period` forward, so a period is billed at most once. The amounts come from the terms row in force
// at the period start (`termsOn`, never the mirror columns of `care_plans`); the previous period's overage hours, if any, are added as one more line, and a draft
// with overage is never issued automatically. Whether the system may also ISSUE the draft is `autoIssueEligibility`; the freeze statement repeats every rule in SQL
// (`CARE_AUTO_SQL`, packages/db/src/issue.ts), so this function only explains.

import {
  type CareStatus,
  type CareTier,
  overageQuantityMilli,
  type Period,
  type PlanDates,
  planPeriodOf,
  previousPeriod,
  type StatusRow,
  statusOn,
  type TermsRow,
} from "./care.ts";
import { formatDate, parseIsoDate } from "./dates.ts";

/** The catalogue services the invoice lines come from (S16 Care Plans, S17 AI Ops, S18 Dev Subscription: `CARE_SERVICE_CODES` in care.ts). */
export type CareServiceCode = "S16" | "S17" | "S18";

/** The tier as a person reads it, for the line text. */
export const CARE_TIER_NAMES: Readonly<Record<CareTier, string>> = {
  essential: "Essential",
  growth: "Growth",
  scale: "Scale",
  dev_subscription: "Dev Subscription",
  custom: "Custom",
};

// ---- when a plan is due -------------------------------------------------------------------------------------------------------------------

/** The plan's billing period that contains `today` (the first one starts on the start date); null before the plan starts. */
export const billingPeriodOf = (today: string, plan: PlanDates): Period | null => planPeriodOf(today, plan);

export type CareDue =
  | { readonly due: false; readonly reason: "not_started" | "already_billed" | "not_active" }
  | {
      readonly due: true;
      /** The period to bill: `start` is what `care_plans.last_billed_period` and `care_invoices.period_start` hold. */
      readonly period: Period;
      /** The plan was billed before, and at least one whole period between that and this one was never billed (Q51: a bell, never a draft). */
      readonly missedEarlier: boolean;
    };

/**
 * Whether the plan's current period is due for its invoice today. `lastBilled` is `care_plans.last_billed_period` (the START of the last period billed, or null);
 * `statusAtPeriodStart` is the plan's status on the period's first day (history, never the mirror): a plan paused or cancelled then is not billed for the period.
 * Idempotent by construction: once `lastBilled` has reached the period's start the answer is `already_billed`.
 */
export function careDue(
  today: string,
  plan: PlanDates,
  lastBilled: string | null,
  statusAtPeriodStart: CareStatus | null,
  /** The plan's status history: when given, a skipped period counts as missed only if the plan was ACTIVE on its first day (a plan paused over it is owed nothing for it; early check finding 6). */
  statuses?: readonly StatusRow[],
): CareDue {
  const period = billingPeriodOf(today, plan);
  if (!period) return { due: false, reason: "not_started" };
  if (lastBilled !== null && lastBilled >= period.start) return { due: false, reason: "already_billed" };
  if (statusAtPeriodStart !== "active") return { due: false, reason: "not_active" };
  let missedEarlier = false;
  if (lastBilled !== null) {
    // Walk back over the periods after the last one billed, nearest first (at most 24).
    let p = planPeriodOf(previousPeriod(period, plan.billingDay).end, plan);
    for (let i = 0; p !== null && p.start > lastBilled && i < 24; i++) {
      if (statuses === undefined || statusOn(statuses, p.start)?.status === "active") {
        missedEarlier = true;
        break;
      }
      p = planPeriodOf(previousPeriod(p, plan.billingDay).end, plan);
    }
  }
  return { due: true, period, missedEarlier };
}

// ---- the lines ----------------------------------------------------------------------------------------------------------------------------

/**
 * The words of the three lines. [Placeholder, 07-U]: the owner has not approved the care line text yet, so the default carries a marked placeholder and
 * `hasPlaceholder` makes the automatic issue refuse until the copy exists (an invoice with "[Placeholder" in a line is never sent by the system).
 */
export type CareLineWords = {
  readonly plan: (tierName: string, period: Period) => string;
  readonly aiOps: (period: Period) => string;
  readonly overage: (period: Period) => string;
};

const day = (iso: string): string => {
  const d = parseIsoDate(iso);
  return d ? formatDate(d) : iso;
};

export const CARE_LINE_WORDS: CareLineWords = {
  plan: (tierName, p) => `[Placeholder, 07-U] Care plan ${tierName}, ${day(p.start)} to ${day(p.end)}`,
  aiOps: (p) => `[Placeholder, 07-U] AI Ops, ${day(p.start)} to ${day(p.end)}`,
  overage: (p) => `[Placeholder, 07-U] Extra hours, ${day(p.start)} to ${day(p.end)}`,
};

export const hasPlaceholder = (text: string): boolean => text.includes("[Placeholder");

export type CareCatalogue = Readonly<
  Partial<Record<CareServiceCode, { readonly sac: string | null; readonly gstRateBp: number | null }>>
>;

/** What the previous period's usage left over: minutes beyond the hours available. `rateMinor` is the terms' hourly rate (null: none set). */
export type CareOverage = {
  readonly period: Period;
  readonly minutes: number;
  readonly rateMinor: number | null;
};

export type CareLine = {
  readonly kind: "plan" | "ai_ops" | "overage";
  readonly code: CareServiceCode;
  readonly description: string;
  readonly sac: string | null;
  readonly qtyMilli: number;
  readonly unit: "month" | "hour";
  readonly rateMinor: number;
  /** null: the catalogue item has none, so the caller uses the settings' default rate. */
  readonly gstRateBp: number | null;
};

export type CareLines =
  | {
      readonly ok: true;
      readonly lines: CareLine[];
      readonly overage: { readonly minutes: number; readonly priced: boolean } | null;
    }
  | { readonly ok: false; readonly error: "service_missing"; readonly code: CareServiceCode };

/**
 * The draft's lines: the plan fee (one month at the terms' price, as the taxable amount), AI Ops when the terms have it, and the previous period's extra hours at the
 * terms' hourly rate (only when there is overage AND a rate; an overage with no rate is reported in `overage.priced: false` and left off the invoice). The plan fee
 * comes from S18 for a Dev Subscription and S16 otherwise; the extra hours use S16's SAC and rate (VERIFY WITH CA/LEGAL: the GST treatment of overage).
 */
export function careLines(input: {
  readonly tier: CareTier;
  readonly terms: Pick<TermsRow, "priceMinor" | "aiOpsMinor">;
  readonly period: Period;
  readonly catalogue: CareCatalogue;
  readonly overage: CareOverage | null;
  readonly words?: CareLineWords;
}): CareLines {
  const words = input.words ?? CARE_LINE_WORDS;
  const planCode: CareServiceCode = input.tier === "dev_subscription" ? "S18" : "S16";
  const item = (code: CareServiceCode) => input.catalogue[code];
  const lines: CareLine[] = [];
  const plan = item(planCode);
  if (!plan) return { ok: false, error: "service_missing", code: planCode };
  lines.push({
    kind: "plan",
    code: planCode,
    description: words.plan(CARE_TIER_NAMES[input.tier], input.period),
    sac: plan.sac,
    qtyMilli: 1000,
    unit: "month",
    rateMinor: input.terms.priceMinor,
    gstRateBp: plan.gstRateBp,
  });
  if (input.terms.aiOpsMinor !== null && input.terms.aiOpsMinor > 0) {
    const ai = item("S17");
    if (!ai) return { ok: false, error: "service_missing", code: "S17" };
    lines.push({
      kind: "ai_ops",
      code: "S17",
      description: words.aiOps(input.period),
      sac: ai.sac,
      qtyMilli: 1000,
      unit: "month",
      rateMinor: input.terms.aiOpsMinor,
      gstRateBp: ai.gstRateBp,
    });
  }
  let overage: { minutes: number; priced: boolean } | null = null;
  const o = input.overage;
  if (o && o.minutes > 0) {
    overage = { minutes: o.minutes, priced: o.rateMinor !== null };
    if (o.rateMinor !== null) {
      lines.push({
        kind: "overage",
        code: "S16",
        description: words.overage(o.period),
        sac: plan.sac,
        qtyMilli: overageQuantityMilli(o.minutes),
        unit: "hour",
        rateMinor: o.rateMinor,
        gstRateBp: plan.gstRateBp,
      });
    }
  }
  return { ok: true, lines, overage };
}

// ---- the contract of the admin API's `BillingJobs` entrypoint (LD57) ---------------------------------------------------------------------

/** What `draftCarePlan` answers. `autoEligible` means the jobs Worker should send `care.issue`; `reasons` are why not (`AutoIssueReason`). */
export type DraftCareResult = {
  readonly result: "drafted" | "already_billed" | "not_due" | "skipped";
  readonly documentId?: string;
  readonly autoEligible: boolean;
  readonly reasons: readonly string[];
  /** Why a plan was skipped (a code: `plan_missing`, `client_anonymised`, `service_missing`, `no_terms`). */
  readonly why?: string;
};
/** What `issueCareDraft` answers. */
export type IssueCareResult = {
  readonly result: "issued" | "refused" | "already_issued" | "not_found";
  readonly number?: string;
  readonly reasons: readonly string[];
  readonly notEmailed?: boolean;
};

/**
 * The whole RPC surface of the admin API's `BillingJobs` entrypoint (the class `implements` it, so the two cannot drift), and the shape the jobs Worker's typed wrapper
 * gives its consumers. Each method takes only an id: no clock, period or amount comes from the caller.
 */
export interface BillingJobsApi {
  draftCarePlan(args: { planId: string }): Promise<DraftCareResult>;
  issueCareDraft(args: { documentId: string }): Promise<IssueCareResult>;
}

const DRAFT_RESULTS = ["drafted", "already_billed", "not_due", "skipped"] as const;
const ISSUE_RESULTS = ["issued", "refused", "already_issued", "not_found"] as const;
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** A runtime check of what came back over the service binding (an RPC answer is not trusted by its type alone). */
export function isDraftCareResult(v: unknown): v is DraftCareResult {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    (DRAFT_RESULTS as readonly unknown[]).includes(r.result) &&
    typeof r.autoEligible === "boolean" &&
    isStrings(r.reasons) &&
    (r.documentId === undefined || typeof r.documentId === "string")
  );
}
export function isIssueCareResult(v: unknown): v is IssueCareResult {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    (ISSUE_RESULTS as readonly unknown[]).includes(r.result) &&
    isStrings(r.reasons) &&
    (r.number === undefined || typeof r.number === "string")
  );
}

// ---- may the system issue it too? ---------------------------------------------------------------------------------------------------------

export const AUTO_ISSUE_REASONS = [
  "toggle_off",
  "toggle_not_owner",
  "terms_not_owner",
  "usd_needs_fx",
  "overage_present",
  "blockers",
  "no_recipient",
] as const;
export type AutoIssueReason = (typeof AUTO_ISSUE_REASONS)[number];

export type AutoIssueFacts = {
  /** `clients.care_auto_issue`. */
  readonly toggleOn: boolean;
  /** `clients.care_auto_issue_by` names an active Owner (a toggle Staff set, or one that predates M5.4, names nobody). */
  readonly toggleByOwner: boolean;
  /** The terms row in force at the period start was written by an Owner. */
  readonly termsByOwner: boolean;
  readonly currency: string;
  /** The draft's overage minutes (`care_invoices.overage_minutes`), or null for none. */
  readonly overageMinutes: number | null;
  /** The issue blockers of the draft (`issueBlockers`) and any the caller adds (an INR export invoice needs the Owner's confirmation, a line still has placeholder text). */
  readonly blockerCodes: readonly string[];
  /** Contacts with portal access that the invoice would be sent to. */
  readonly recipients: number;
};

export type AutoIssue =
  | {
      readonly ok: true /** Issued by the system, but nobody can be emailed (07-U: "issued, not emailed"). */;
      readonly notEmailed: boolean;
    }
  | { readonly ok: false; readonly reasons: readonly AutoIssueReason[] };

/**
 * Whether the job may issue the draft itself (LD58, LD66). Every reason that applies is returned, in a stable order, so the Owner's bell can say what to do.
 * `no_recipient` is not a refusal: the invoice is still issued (the money is owed) and the answer says `notEmailed`.
 */
export function autoIssueEligibility(f: AutoIssueFacts): AutoIssue {
  const reasons: AutoIssueReason[] = [];
  if (!f.toggleOn) reasons.push("toggle_off");
  else if (!f.toggleByOwner) reasons.push("toggle_not_owner");
  if (!f.termsByOwner) reasons.push("terms_not_owner");
  if (f.currency !== "INR") reasons.push("usd_needs_fx");
  if (f.overageMinutes !== null) reasons.push("overage_present");
  if (f.blockerCodes.length > 0) reasons.push("blockers");
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, notEmailed: f.recipients === 0 };
}
