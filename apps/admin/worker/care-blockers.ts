// What the invoice view and the care billing both need and neither may import from the other (review L6: `invoices.ts` and `care-billing.ts` used to import each other): the codes that stop
// the system issuing a care draft, and the read of a draft's care record.
import { issueDateOf, issueFyOf } from "@techaust/core/invoices";
import { CARE_AUTHORITY_COLUMNS } from "./care-authority.ts";
import {
  type BankRow,
  blockersOf,
  type computeInvoice,
  type InvoiceSettings,
  type InvoiceState,
  needsInrConfirm,
} from "./invoice-model.ts";
import type { ClientRow } from "./quote-model.ts";

/** The codes that stop the system issuing a draft by itself: the checklist's blockers, an INR export invoice (the Owner's yes), and a line that still has placeholder text. */
export function blockerCodesOf(
  state: InvoiceState,
  client: ClientRow,
  settings: InvoiceSettings,
  computation: Awaited<ReturnType<typeof computeInvoice>>,
  bank: readonly BankRow[],
  now: number,
): string[] {
  const issueDate = issueDateOf(now);
  const codes: string[] = blockersOf(state, client, settings, computation, {
    bank,
    issueDate,
    fy: issueFyOf(now),
    fxRefDate: issueDate,
  }).map((b) => b.code);
  if (!computation.computed) codes.push("computed_errors");
  if (needsInrConfirm(state.type, state.currency)) codes.push("export_inr_confirm");
  return [...new Set(codes)];
}

/** The record of the period a draft belongs to and the facts of its authority. `?1` document id. */
export const CARE_OF_SQL = `SELECT ci.care_plan_id, ci.period_start, ci.period_end, ci.terms_id, ci.overage_minutes, ${CARE_AUTHORITY_COLUMNS}
  FROM care_invoices ci JOIN care_plans p ON p.id = ci.care_plan_id JOIN clients k ON k.id = p.client_id
  WHERE ci.document_id = ?1 AND EXISTS (SELECT 1 FROM documents x WHERE x.id = ci.document_id AND x.care_plan_id = ci.care_plan_id)`;
