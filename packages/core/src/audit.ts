// What an audit row says about a change [ADM-G-06, ADM-AUD-01]: only the fields that changed, and sensitive ones
// masked, so the audit log never becomes a second copy of secrets or personal data. Pure; the Worker stores the
// result as the `summary` JSON of an `audit_log` row (after, never before, an UPDATE trigger would refuse it).

/**
 * The audit actions the accountant may read (`audit.readFinance`, ADM-AUD-02, docs/04 section 9): changes to the money
 * and tax settings, and the finance events of later milestones. ONE list, here; the audit API filters with it
 * (`action IN (...)`), and a test pins it. The owner (`audit.read`) sees everything.
 */
export const FINANCE_AUDIT_ACTIONS = [
  "settings.tax.update",
  "settings.numbering.update",
  "settings.payment_terms.update",
  "settings.bank.update",
  "settings.gateways.update",
  "document.issue",
  // M4.3: an accepted estimate becomes an invoice draft or a care plan (the money side of an offer).
  "document.convert",
  "document.void",
  // M5.1 to M5.3 (the lead's answer, 2026-10-27): only the invoice events that move money or tax are finance events: an issue (a note's issue
  // included), a void, a proforma's invoice for money received, and the client's IMS answer. Drafts, edits, deletes, the service date and the
  // PDF re-request are not finance events (no role's activity list holds them today). Summaries hold ids, numbers, amounts and codes only.
  "invoice.issue",
  "invoice.void",
  // ADM-INV-10: a delivered proforma withdrawn (a void of it through its own route; owner, 2026-10-30, docs/13).
  "invoice.withdraw",
  "invoice.advance_issue",
  "invoice.ims_status",
  "payment.record",
  "payment.verify",
  // M6.1 (run file C): the other ledger moves: a confirmed entry withdrawn (L7), credit used or an excess moved to credit (L2, L13), a TDS certificate
  // (L19) and the AD bank's FEMA extension (Q60, L14). Attaching a proof file moves no money and is not a finance event.
  "payment.withdraw",
  "payment.credit_apply",
  "payment.credit_release",
  "payment.tds_certificate",
  "invoice.realisation_extend",
  "refund.issue",
  "export.gst",
  // M5.5b (LD86): a page of the GST and CA register (rows and range only, never row contents) and a client's statement PDF (the range, currency and the
  // number of lines). Both are finance events; neither is in the Recent activity feed.
  "report.export",
  "client.statement_pdf",
  // M3.3: a client's billing fields (tax identity, currency, terms); Sales does not see these in a client's activity.
  "client.billing_update",
  // M3.5: a care plan's price, hours and overage rate are what the monthly and overage invoices are made from.
  "care_plan.terms",
] as const;

/** What replaces the value of a sensitive field, on both sides of the change. */
export const MASKED = "[masked]";

export type AuditChange = { before: unknown; after: unknown };
export type AuditSummary = Record<string, AuditChange>;

/** Same value, compared structurally for the plain data an audit sees (JSON values, dates as numbers). */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) => Object.hasOwn(b, k) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * The fields that differ between `before` and `after` (a missing record counts as no fields: a create lists every
 * field of `after` with `before: undefined`, a delete the other way round). Fields named in `sensitive` appear
 * as changed when they are, but their values are replaced by "[masked]". Keys are sorted so the JSON is stable.
 */
export function auditSummary(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  sensitive: readonly string[] = [],
): AuditSummary {
  const b = before ?? {};
  const a = after ?? {};
  const hidden = new Set(sensitive);
  const out: AuditSummary = {};
  for (const key of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
    const had = Object.hasOwn(b, key);
    const has = Object.hasOwn(a, key);
    if (had && has && same(b[key], a[key])) continue;
    out[key] = hidden.has(key)
      ? { before: had ? MASKED : undefined, after: has ? MASKED : undefined }
      : { before: b[key], after: a[key] };
  }
  return out;
}
