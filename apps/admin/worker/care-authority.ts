// What the care-plan billing reads share (M5.4; ADM-CARE-02, ADM-INV-12): the Owner's choices that decide the automatic issue, the invoice view's care part and the plan page's billing part.
// Kept apart from care-billing.ts so that care.ts can import it without a cycle (care-billing.ts pulls in the whole invoice model).
import type { CareStatus, StatusRow } from "@techaust/core/care";
import { autoIssueEligibility, nextBillingDayOf } from "@techaust/core/care-billing";

export const CARE_AUTHORITY_COLUMNS = `k.care_auto_issue AS toggle, k.care_auto_issue_by AS toggle_by, k.reminder_policy,
    EXISTS (SELECT 1 FROM staff_users o WHERE o.id = k.care_auto_issue_by AND o.role = 'owner' AND o.status = 'active') AS toggle_by_owner,
    EXISTS (SELECT 1 FROM care_plan_terms t JOIN staff_users u ON u.id = t.created_by WHERE t.id = ci.terms_id AND u.role = 'owner') AS terms_by_owner,
    (SELECT count(*) FROM contacts c WHERE c.client_id = k.id AND c.is_billing = 1 AND c.portal_access = 1 AND c.anonymised_at IS NULL) AS recipients`;
/**
 * The plan page's billing read (M5.4 API gaps): `last_billed_period`, the record and draft of that last period (left joins: a plan never billed has neither) and the Owner's choices that
 * decide whether the system may issue the draft. One statement on the primary keys. `?1` plan id.
 */
export const CARE_BILLING_READ_SQL = `SELECT p.last_billed_period, ci.period_start, ci.period_end, ci.terms_id, ci.overage_minutes, d.id AS doc_id, d.number_display AS doc_number, d.status AS doc_status,
    d.frozen_at AS doc_frozen_at, d.currency AS doc_currency, ${CARE_AUTHORITY_COLUMNS}
  FROM care_plans p JOIN clients k ON k.id = p.client_id
    LEFT JOIN care_invoices ci ON ci.care_plan_id = p.id AND ci.period_start = p.last_billed_period
    LEFT JOIN documents d ON d.id = ci.document_id AND d.care_plan_id = ci.care_plan_id
  WHERE p.id = ?1`;

export type CareBillingRow = Omit<CareOf, "care_plan_id" | "period_start" | "period_end" | "terms_id"> & {
  last_billed_period: string | null;
  period_start: string | null;
  terms_id: string | null;
  doc_id: string | null;
  doc_number: string | null;
  doc_status: string | null;
  doc_frozen_at: number | null;
  doc_currency: string | null;
};

/**
 * The `billing` part of `GET /care-plans/:id` (finance roles only; the route decides): the last period billed, the day the job next bills, the draft of that period (null when there is none, or
 * it was deleted) and, for a draft not yet issued, whether the Owner's choices let the system issue it (`careView`'s own decision). The invoice's blockers need the whole draft computed, so they are NOT
 * judged here (`blockersChecked: false`: the draft's own page carries them); `eligible` therefore says only that the Owner's choices allow it.
 */
export function careBillingView(
  row: CareBillingRow | undefined,
  plan: { startDate: string; billingDay: number; status: CareStatus },
  statuses: readonly StatusRow[],
  today: string,
) {
  const lastBilled = row?.last_billed_period ?? null;
  const draftOpen = row?.doc_id && row.doc_status === "draft" && row.doc_frozen_at === null;
  const auto =
    row && draftOpen && row.period_start
      ? careView(
          {
            care_plan_id: "",
            period_start: row.period_start,
            period_end: "",
            terms_id: row.terms_id ?? "",
            overage_minutes: row.overage_minutes,
            toggle: row.toggle,
            toggle_by: row.toggle_by,
            reminder_policy: row.reminder_policy,
            toggle_by_owner: row.toggle_by_owner,
            terms_by_owner: row.terms_by_owner,
            recipients: row.recipients,
          },
          { frozen: false, blockerCodes: [], currency: row.doc_currency ?? "INR" },
        )?.auto
      : null;
  return {
    lastBilledPeriod: lastBilled,
    nextBillingDay: nextBillingDayOf(today, plan, plan.status, lastBilled, statuses),
    draft:
      row?.doc_id && row.doc_status
        ? { id: row.doc_id, number: row.doc_number, status: row.doc_status }
        : null,
    auto: auto ? { ...auto, blockersChecked: false as const } : null,
  };
}

export type CareOf = {
  care_plan_id: string;
  period_start: string;
  period_end: string;
  terms_id: string;
  overage_minutes: number | null;
  toggle: number;
  toggle_by: string | null;
  reminder_policy: string | null;
  toggle_by_owner: number;
  terms_by_owner: number;
  recipients: number;
};
// ---- what the invoice view shows about a care invoice ------------------------------------------------------------------------------------------------------

/** The care part of the invoice JSON: the plan and period it bills and, on a draft, whether the system will issue it and why not. null for any other invoice. */
export function careView(
  care: CareOf | undefined,
  a: { frozen: boolean; blockerCodes: readonly string[]; currency: string },
) {
  if (!care) return null;
  const e = autoIssueEligibility({
    toggleOn: care.toggle === 1,
    toggleByOwner: care.toggle_by_owner === 1,
    termsByOwner: care.terms_by_owner === 1,
    currency: a.currency,
    overageMinutes: care.overage_minutes,
    blockerCodes: a.blockerCodes,
    recipients: care.recipients,
  });
  return {
    planId: care.care_plan_id,
    periodStart: care.period_start,
    periodEnd: care.period_end,
    overageMinutes: care.overage_minutes,
    auto: a.frozen ? null : { eligible: e.ok, reasons: e.ok ? [] : [...e.reasons] },
  };
}
