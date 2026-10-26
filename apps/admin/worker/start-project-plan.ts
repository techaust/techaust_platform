// What "Start project" makes from an accepted proposal (M4.5; ADM-PRJ-01, ADM-PROP-09): pure, so the route and the document page's preview
// of the dialog (stage B) work it out with the SAME function and the figures shown are the figures written. No I/O, no clock.
//
//   - one milestone per payment-schedule step: the title is the step's label, the amount is the step's amount EXACTLY (a fixed amount,
//     no percentage, so "the created amounts equal the schedule" holds to the paisa), the due date is the step's target date;
//   - the project's budget is the proposal's total (tax included). VERIFY WITH CA/LEGAL / lead: tax-inclusive, not taxable.
//   - a first-instalment draft only when step 1 is paid on acceptance and is more than nothing: the step's amount, tax included, split back
//     into lines by the inclusive split (core), with the supply of the client's CURRENT record (as the estimate's convert does). More than
//     10 (SAC, rate) groups are merged by rate (a merged group keeps its SAC only when every member has the same one).
//     VERIFY WITH CA/LEGAL: the draft's type in each advance mode, the place of supply, and merging SACs on a document that may become a
//     tax invoice (Rule 46).
//   - nothing comes from the request. The draft is never issued here (M5).
import type { CalendarDate } from "@techaust/core/dates";
import {
  type ComputedDocument,
  determineSupply,
  groupsOf,
  type InclusiveGroup,
  type InclusiveSplit,
  MAX_GROUPS,
  type Supply,
  splitInclusive,
  type TaxIssue,
  type TaxWarning,
} from "@techaust/core/tax";
import { invoiceTypeFor } from "./document-convert.ts";
import { type ClientRow, type QuoteSettings, taxContext, taxInputOf } from "./quote-model.ts";

export type StepFacts = {
  label: string;
  trigger: string;
  pct_bp: number;
  amount_minor: number;
  target_date: string | null;
};

export type ProposalFacts = {
  currency: "INR" | "USD";
  total_minor: number;
  export_mode: string | null;
  computed: ComputedDocument | null;
};

export type MilestonePlan = { title: string; amountMinor: number; dueDate: string | null };

export type InstalmentPlan = {
  type: "proforma" | "tax_invoice" | "export_invoice";
  amountMinor: number;
  pctBp: number;
  trigger: string;
  label: string;
  supply: Supply;
  split: InclusiveSplit;
  /** (SAC, rate) groups after any merge; the draft has one line per group. */
  groups: InclusiveGroup[];
  warnings: TaxWarning[];
};

export type StartPlan =
  | {
      ok: true;
      milestones: MilestonePlan[];
      budgetMinor: number;
      firstInstalment: InstalmentPlan | null;
      /** Why there is no first instalment. */
      reason?: "no_advance_step";
      warnings: { code: string }[];
    }
  | {
      ok: false;
      code: "not_computed" | "instalment_failed";
      issues: TaxIssue[];
      /** The client-record fields that are empty and that the first instalment's tax needs (M4.5 fix L11); may be empty when the cause is elsewhere. */
      missing: ClientField[];
    };

/** The client-record fields a first instalment's tax can lack. */
export type ClientField = "country" | "gstin" | "state_code";

const FIELD_OF_ISSUE: Record<string, ClientField> = {
  country_mismatch: "country",
  gstin_invalid: "gstin",
  gstin_not_allowed: "gstin",
  state_required: "state_code",
  state_invalid: "state_code",
  state_not_allowed: "state_code",
};

/**
 * Which of the client's own fields the tax engine could not use, from its error codes (country that does not fit the GST status, a GSTIN that is
 * missing or wrong, a state that is missing or unknown). Empty when the cause is elsewhere (the amounts, the date).
 */
export function missingClientFields(issues: readonly TaxIssue[]): ClientField[] {
  const out = new Set<ClientField>();
  for (const i of issues) {
    const field = FIELD_OF_ISSUE[i.code];
    if (field) out.add(field);
  }
  return [...out];
}

/** Merges groups that share a GST rate, keeping a SAC only when every member has the same one. */
export function mergeByRate(groups: readonly InclusiveGroup[]): {
  groups: InclusiveGroup[];
  sacMerged: boolean;
} {
  const by = new Map<number, InclusiveGroup>();
  let sacMerged = false;
  for (const g of groups) {
    const have = by.get(g.gstRateBp);
    if (!have) {
      by.set(g.gstRateBp, g);
      continue;
    }
    if (have.sac !== g.sac) sacMerged = true;
    by.set(g.gstRateBp, {
      sac: have.sac === g.sac ? have.sac : null,
      gstRateBp: g.gstRateBp,
      weightMinor: have.weightMinor + g.weightMinor,
    });
  }
  return { groups: [...by.values()], sacMerged };
}

export function planStartProject(input: {
  proposal: ProposalFacts;
  schedule: readonly StepFacts[];
  client: ClientRow;
  settings: QuoteSettings;
  today: CalendarDate;
}): StartPlan {
  const { proposal, schedule, client, settings, today } = input;
  const milestones = schedule.map((s) => ({
    title: s.label,
    amountMinor: s.amount_minor,
    dueDate: s.target_date,
  }));
  const done = (extra: {
    firstInstalment: InstalmentPlan | null;
    reason?: "no_advance_step";
    warnings?: { code: string }[];
  }) =>
    ({
      ok: true,
      milestones,
      budgetMinor: proposal.total_minor,
      warnings: [],
      ...extra,
    }) satisfies StartPlan;

  const first = schedule[0];
  if (first?.trigger !== "on_accept" || first.amount_minor <= 0)
    return done({ firstInstalment: null, reason: "no_advance_step" });
  if (!proposal.computed) return { ok: false, code: "not_computed", issues: [], missing: [] };

  const ctx = taxContext(settings);
  const supplyResult = determineSupply(taxInputOf(client), ctx, {
    documentDate: today,
    currency: proposal.currency,
    exportMode:
      proposal.export_mode === "lut" || proposal.export_mode === "igst_paid"
        ? proposal.export_mode
        : undefined,
  });
  if (!supplyResult.ok)
    return {
      ok: false,
      code: "instalment_failed",
      issues: supplyResult.errors,
      missing: missingClientFields(supplyResult.errors),
    };

  const warnings: { code: string }[] = [];
  let groups = groupsOf(proposal.computed.summary);
  if (groups.length > MAX_GROUPS) {
    const merged = mergeByRate(groups);
    groups = merged.groups;
    if (merged.sacMerged) warnings.push({ code: "instalment_sac_merged" });
  }
  const split = splitInclusive(first.amount_minor, groups, supplyResult.value, proposal.currency, null, ctx, {
    documentDate: today,
    recipientStatus: client.gst_status,
  });
  if (!split.ok)
    return {
      ok: false,
      code: "instalment_failed",
      issues: split.errors,
      missing: missingClientFields(split.errors),
    };

  return done({
    warnings,
    firstInstalment: {
      type: invoiceTypeFor(settings.tax.advanceMode, client.gst_status === "overseas"),
      amountMinor: first.amount_minor,
      pctBp: first.pct_bp,
      trigger: first.trigger,
      label: first.label,
      supply: supplyResult.value,
      split: split.value,
      groups,
      warnings: [...supplyResult.warnings, ...split.warnings],
    },
  });
}
