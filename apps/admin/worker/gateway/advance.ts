// The automatic tax invoice for a proforma paid online (M6.2, L6, L17; ADM-INV-10, PRD Q-P3-3; run file C `issueGatewayAdvance`). The steps of M5.2's
// `POST /invoices/:id/advance-invoice` (invoice-advance.ts) for the one case the system may issue alone: a domestic INR client, a pending Razorpay payment that was
// re-fetched and matched its link, the link paid for this proforma, and a proforma issued by an Owner who is still active. The authority is `gateway_auto`
// (`GATEWAY_AUTO_SQL` in the freeze WHERE): the issuer block is the company itself ("system", the trade name; the care-billing pattern), `issued_by` is NULL, the
// receipt is recorded on behalf of the proforma's issuing Owner, the audit row is the system's with `{authority: "gateway_auto", onBehalfOf}`. The invoice is
// emailed to the billing contacts with portal and finance access the way automatic care invoices go (kind `auto`, in the 09:00-19:00 IST window; Q44, Q48, L17).
// Any blocker leaves the payment pending with an `advance_blocked` review item and a bell; the Owner then uses "Confirm by issuing the tax invoice".
// Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17): GST on an advance is due on receipt, and a tax invoice for the amount received is
// valid; OPEN (08-C RA-17): whether that invoice fully meets s.31(3)(d) so no separate receipt voucher is needed. The receipt day is the payment's own IST day
// (L11; Settled by the lead on the safest reading, 2026-11-01 (08-C RA-37)).
import type { IssueAdvanceResult } from "@techaust/core/gateway-rpc";
import { uuidv7 } from "@techaust/core/ids";
import { INVOICE_SERIES_OF, issueDateOf, issueFyOf } from "@techaust/core/invoices";
import { maxNumber, sqlPrintfPattern } from "@techaust/core/numbering";
import { deedDraftStatements } from "@techaust/db/deeds";
import { headerExtrasJson, invoiceSealOf, type TermsRef } from "@techaust/db/documents";
import { advanceIssueStatements, invoiceSendStatements } from "@techaust/db/issue";
import type { GuardSql } from "@techaust/db/log";
import { CONTACTS_OF_DOC_SQL, type ContactRow, recipientsOf } from "../care-billing.ts";
import { enqueuePdf } from "../document-events.ts";
import {
  advanceDraft,
  bankStampOf,
  blockersOf,
  computeInvoice,
  headerExtrasOf,
  type InvoiceState,
  invoiceColumns,
  issuerOf,
  proformaSupplyChanged,
  recipientOf,
  taxContext,
  todayOf,
} from "../invoice-model.ts";
import { readInvoice } from "../invoices.ts";
import { lineRows } from "../quote-model.ts";
import { mutateSystem } from "../system.ts";
import { bellNeedsReview, reviewReason } from "./messages.ts";
import { REVIEW_LINK } from "./settle.ts";

export type AdvanceEnv = { DB: D1Database; PDF_QUEUE: Queue };

type PendingRow = {
  id: string;
  provider: string;
  kind: string;
  status: string;
  client_id: string;
  currency: string;
  amount_minor: number;
  received_on: string;
  reference_norm: string | null;
  requested_allocations: string | null;
  checkout_id: string | null;
  advance_receipt_id: string | null;
  invoice_number: string | null;
};

const PENDING_SQL = `SELECT p.id, p.provider, p.kind, p.status, p.client_id, p.currency, p.amount_minor, p.received_on, p.reference_norm, p.requested_allocations,
     p.checkout_id, p.advance_receipt_id, i.number_display AS invoice_number
   FROM payments p LEFT JOIN advance_receipts r ON r.id = p.advance_receipt_id LEFT JOIN documents i ON i.id = r.invoice_id WHERE p.id = ?1`;
/** `PENDING_SQL` with the proforma's current stamp (`?2`), read once after a refused freeze. */
const AFTER_REFUSAL_SQL = PENDING_SQL.replace(
  "i.number_display AS invoice_number",
  "i.number_display AS invoice_number, (SELECT pf.updated_at FROM documents pf WHERE pf.id = ?2) AS proforma_updated_at",
);
const OWNER_ACTIVE_SQL =
  "SELECT 1 AS ok FROM staff_users WHERE id = ?1 AND role = 'owner' AND status = 'active'";

/** The issued bell (07-ZI S22 style): the number is put in by SQL, so it is the one this batch froze. An earlier-month receipt says so (RA-17 warning, staff line). */
function issuedBell(
  db: D1Database,
  a: { documentId: string; client: string; earlierMonth: string | null },
  g: GuardSql,
): D1PreparedStatement {
  const tail = `, for ${a.client}'s payment received online, was issued.${a.earlierMonth ? ` The money arrived on ${a.earlierMonth}, in an earlier month: check the return period it belongs to.` : ""}`;
  return db
    .prepare(
      `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
       SELECT 'n_' || lower(hex(randomblob(16))), o.id, 'invoice.advance_auto', 'document', ?1, substr('Tax invoice ' || coalesce((SELECT number_display FROM documents WHERE id = ?1), '') || ?2, 1, 300), ?3
       FROM staff_users o WHERE o.status = 'active' AND o.role = 'owner' AND ${g.sql(4)}`,
    )
    .bind(a.documentId, tail, `/invoices/${a.documentId}`, ...g.params);
}

/** The blocked path: one `advance_blocked` item for the payment while none is open, its bell, audited as the system. The payment stays pending. */
async function blocked(
  env: AdvanceEnv,
  p: PendingRow,
  proformaId: string | null,
  blockers: readonly string[],
): Promise<IssueAdvanceResult> {
  const reviewId = uuidv7();
  const now = Date.now();
  const reason = reviewReason("advance_blocked", { blocker: blockers.join(", ") });
  await mutateSystem(env, {
    action: "payment.gateway_advance_blocked",
    entityType: "payment",
    entityId: p.id,
    summary: { paymentId: p.id, proformaId, blockers },
    side: (g) => [
      env.DB.prepare(
        `INSERT INTO review_items (id, source, provider, kind, status, payment_id, document_id, client_id, amount_minor, currency, facts, created_at)
           SELECT ?1, 'webhook', 'razorpay', 'advance_blocked', 'open', ?2, ?3, ?4, ?5, 'INR', ?6, ?7
           WHERE NOT EXISTS (SELECT 1 FROM review_items x INDEXED BY review_items_payment WHERE x.payment_id = ?2 AND x.kind = 'advance_blocked' AND x.status = 'open') AND ${g.sql(8)}`,
      ).bind(
        reviewId,
        p.id,
        proformaId,
        p.client_id,
        p.amount_minor,
        JSON.stringify({ blockers: blockers.slice(0, 10) }),
        now,
        ...g.params,
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
           SELECT 'n_' || lower(hex(randomblob(16))), o.id, 'payment.review', 'review_item', ?1, ?2, ?3 FROM staff_users o
           WHERE o.role = 'owner' AND o.status = 'active' AND EXISTS (SELECT 1 FROM review_items r WHERE r.id = ?1) AND ${g.sql(4)}`,
      ).bind(reviewId, bellNeedsReview(reason), REVIEW_LINK, ...g.params),
    ],
  });
  return { result: "blocked", blockers };
}

const parseRequested = (raw: string | null): { documentId: string; amountMinor: number } | null => {
  try {
    const v = JSON.parse(raw ?? "null") as unknown;
    const first =
      Array.isArray(v) && v.length === 1 ? (v[0] as { documentId?: unknown; amountMinor?: unknown }) : null;
    return first && typeof first.documentId === "string" && typeof first.amountMinor === "number"
      ? { documentId: first.documentId, amountMinor: first.amountMinor }
      : null;
  } catch {
    return null;
  }
};

/**
 * `issueGatewayAdvance({paymentId, lastTry})`: ONE try per invocation (early check 2, finding 1: a second try in the same invocation would double the D1
 * statements). When the proforma changed between the read and the freeze, the answer is `retry` (the jobs consumer retries the message once; the admin route
 * answers 409 "try again"); on the message's last try a second change is `blocked` (`freeze_refused`), so the Owner hears of it.
 */
export async function issueGatewayAdvance(
  env: AdvanceEnv,
  paymentId: string,
  opts: { lastTry?: boolean } = {},
): Promise<IssueAdvanceResult> {
  return tryAdvance(env, paymentId, opts.lastTry === true);
}

async function tryAdvance(env: AdvanceEnv, paymentId: string, lastTry: boolean): Promise<IssueAdvanceResult> {
  const db = env.DB;
  const p = await db.prepare(PENDING_SQL).bind(paymentId).first<PendingRow>();
  if (p?.provider !== "razorpay" || p.kind !== "payment") return { result: "not_pending" };
  if (p.status === "confirmed" && p.advance_receipt_id)
    return { result: "already_issued", ...(p.invoice_number ? { number: p.invoice_number } : {}) };
  if (p.status !== "pending_verification" || !p.checkout_id) return { result: "not_pending" };
  const ask = parseRequested(p.requested_allocations);
  if (!ask || ask.amountMinor !== p.amount_minor)
    return blocked(env, p, ask?.documentId ?? null, ["request_invalid"]);
  const ctx = await readInvoice({ env }, ask.documentId, [
    db.prepare(CONTACTS_OF_DOC_SQL).bind(ask.documentId),
  ]);
  if (!ctx) return blocked(env, p, ask.documentId, ["not_found"]);
  const d = ctx.bundle.document;
  const proformaId = d.id;
  if (d.type !== "proforma" || d.frozen_at === null || (d.status !== "issued" && d.status !== "converted"))
    return blocked(env, p, proformaId, ["proforma_not_issued"]);
  if (ctx.client.anonymised_at !== null) return blocked(env, p, proformaId, ["client_anonymised"]);
  if (ctx.client.gst_status === "overseas" || d.currency !== "INR" || p.currency !== "INR")
    return blocked(env, p, proformaId, ["not_domestic_inr"]);
  if (proformaSupplyChanged(d.computed, ctx.client.gst_status))
    return blocked(env, p, proformaId, ["advance_supply_changed"]);
  if (p.amount_minor > d.balance_minor) return blocked(env, p, proformaId, ["advance_exceeds_balance"]);
  if (!d.issued_by || !(await db.prepare(OWNER_ACTIVE_SQL).bind(d.issued_by).first()))
    return blocked(env, p, proformaId, ["issuer_not_owner"]);
  const onBehalfOf = d.issued_by;
  const now = Math.max(Date.now(), d.updated_at + 1);
  const issueDate = issueDateOf(now);
  const fy = issueFyOf(now);
  // "For B2" 6: the row's own day; never before the proforma, never after today. An earlier month only warns (Q27 for the Owner's path; here in the bell).
  if ((d.issue_date !== null && p.received_on < d.issue_date) || p.received_on > issueDate)
    return blocked(env, p, proformaId, ["advance_date_invalid"]);
  const earlierMonth = p.received_on.slice(0, 7) < issueDate.slice(0, 7) ? p.received_on : null;
  const proformaComputed = d.computed;
  if (!proformaComputed || !d.number_display || !d.issue_date)
    return blocked(env, p, proformaId, ["proforma_not_issued"]);
  const today = todayOf(now);
  const made = advanceDraft({
    amountMinor: p.amount_minor,
    currency: "INR",
    client: ctx.client,
    settings: ctx.settings,
    proformaComputed,
    proformaNumber: d.number_display,
    exportMode: null,
    fx: null,
    today,
  });
  if (!made.ok) return blocked(env, p, proformaId, ["tax_errors"]);
  const invoiceId = uuidv7();
  const type = "tax_invoice" as const;
  const state: InvoiceState = {
    id: invoiceId,
    type,
    clientId: ctx.client.id,
    contactId: ctx.contact && ctx.contact.anonymised_at === null ? ctx.contact.id : null,
    currency: "INR",
    discountKind: null,
    discountValue: null,
    exportMode: null,
    fx: null,
    serviceCompletedOn: null,
    exportDeclarationId: null,
    lines: made.lines,
  };
  const computation = await computeInvoice(
    state,
    ctx.client,
    taxContext(ctx.settings),
    today,
    p.amount_minor,
  );
  const computed = computation.computed;
  if (!computed || computed.totalMinor !== p.amount_minor) return blocked(env, p, proformaId, ["tax_errors"]);
  const blockers = blockersOf(state, ctx.client, ctx.settings, computation, {
    bank: ctx.bank,
    issueDate,
    fy,
    fxRefDate: p.received_on,
    advance: true,
  });
  if (blockers.length > 0)
    return blocked(
      env,
      p,
      proformaId,
      blockers.map((b) => b.code),
    );
  const series = INVOICE_SERIES_OF[type];
  const format = ctx.settings.numbering[series];
  const numbering = sqlPrintfPattern(format);
  const recipient = recipientOf(ctx.client, ctx.contact);
  // The sender of an automatic invoice is the company itself (LD58, the care-billing pattern); a payment received always carries the signature (T4, rt2).
  const issuer = issuerOf(
    ctx.settings,
    ctx.bank,
    { id: "system", name: ctx.settings.company.tradeName },
    "INR",
    {
      type,
      advance: true,
    },
  );
  const terms = ctx.newestTerms as TermsRef | null;
  const receiptId = uuidv7();
  const extras = headerExtrasOf({
    state,
    settings: ctx.settings,
    client: ctx.client,
    issueFy: fy,
    mode: ctx.settings.tax.exportMode,
    declaration: null,
    advance: {
      proformaId,
      proformaNumber: d.number_display,
      proformaIssueDate: d.issue_date,
      receivedOn: p.received_on,
      receiptId,
    },
  });
  const seal = await invoiceSealOf({
    document: {
      type,
      clientId: ctx.client.id,
      currency: "INR",
      issueDate,
      dueDate: issueDate,
      contentSha256: computation.hash,
      termsRef: terms ? { id: terms.id, version: terms.version, sha256: terms.sha256 } : null,
      exportMode: null,
    },
    computed,
    recipient,
    issuer,
    ...extras,
  });
  const col = invoiceColumns(state, computation);
  const batch = advanceIssueStatements(db, {
    documentId: invoiceId,
    type,
    series,
    fy,
    pattern: numbering.pattern,
    argOrder: numbering.argOrder,
    maxNumber: maxNumber(format),
    now,
    issueDate,
    dueDate: issueDate,
    recipient,
    issuer,
    computedJson: seal.computedJson,
    snapshotSha256: seal.snapshotSha256,
    issuedBy: null,
    termsVersionId: terms?.id ?? null,
    exportDeclarationId: null,
    headerExtras: headerExtrasJson(extras),
    proformaId,
    expectedProformaUpdatedAt: d.updated_at,
    authority: { kind: "gateway_auto", paymentId: p.id, checkoutId: p.checkout_id, onBehalfOf },
    amountMinor: p.amount_minor,
    lutFy: null,
    receivedOn: p.received_on,
    referenceNorm: p.reference_norm ?? "",
    receiptId,
    paymentId: p.id,
    contentSha256: computation.hash,
    expected: {
      numberingVersion: ctx.settings.versions.numbering,
      companyVersion: ctx.settings.versions.company,
      taxVersion: ctx.settings.versions.tax,
      paymentTermsVersion: ctx.settings.versions.paymentTerms,
      bankStamp: bankStampOf(ctx.bank),
      clientUpdatedAt: ctx.client.updated_at,
      contact: recipient.contactId
        ? { id: recipient.contactId, updatedAt: ctx.contact?.updated_at ?? 0 }
        : null,
    },
    draft: {
      clientId: ctx.client.id,
      projectId: ctx.milestone?.project_id ?? null,
      contactId: state.contactId,
      currency: "INR",
      exportMode: null,
      fx: null,
      subtotalMinor: col.subtotal_minor,
      discountMinor: col.discount_minor,
      taxableMinor: col.taxable_minor,
      cgstMinor: col.cgst_minor,
      sgstMinor: col.sgst_minor,
      igstMinor: col.igst_minor,
      roundOffMinor: col.round_off_minor,
      totalMinor: col.total_minor,
      totalInrMinor: col.total_inr_minor,
      supplyType: computed.supply.type,
      placeOfSupplyCode: computed.supply.placeOfSupplyCode,
      lines: lineRows(state, computation).map((r) => ({
        id: r.id,
        position: r.position,
        description: r.description,
        detail: r.detail,
        sac: r.sac ?? "",
        qtyMilli: r.qty_milli,
        unit: r.unit,
        rateMinor: r.rate_minor,
        taxableMinor: r.taxable_minor,
        gstRateBp: r.gst_rate_bp,
        cgstMinor: r.cgst_minor,
        sgstMinor: r.sgst_minor,
        igstMinor: r.igst_minor,
        lineTotalMinor: r.line_total_minor,
      })),
    },
  });
  // L17: emailed to the billing contacts with portal and finance access, as the automatic care invoices are (kind `auto`: the window applies); paid, so no reminders.
  const recipients = recipientsOf((ctx.extra[0]?.results ?? []) as ContactRow[]);
  const sends =
    recipients.length > 0
      ? invoiceSendStatements(db, {
          documentId: invoiceId,
          rows: recipients.map((r) => ({ id: uuidv7(), contactId: r.id })),
          attachPdf: null,
          createdBy: onBehalfOf,
          kind: "auto",
          now,
          frozenAt: now,
          reminders: [],
        })
      : [];
  let issued: { number_display: string } | undefined;
  let done = false;
  const auditId = uuidv7();
  try {
    done = await mutateSystem(env, {
      auditId,
      main: batch.main,
      onResults: (results, auditAt) => {
        issued = results[auditAt - 1]?.results[0] as typeof issued;
      },
      action: "invoice.advance_issue_auto",
      entityType: "document",
      entityId: invoiceId,
      // Ids, codes, numbers and amounts only (never the reference's text).
      summary: {
        authority: "gateway_auto",
        onBehalfOf,
        documentId: invoiceId,
        proformaId,
        paymentId: p.id,
        clientId: ctx.client.id,
        totalMinor: p.amount_minor,
        receiptId,
        receivedOn: p.received_on,
        ...(earlierMonth ? { warnings: ["advance_previous_period"] } : {}),
        // The payment's open review items are resolved in this batch with `resolved_by` = the Owner this invoice is issued on behalf of (the trigger
        // `review_items_status_flow` needs an Owner; the act is the system's): said here so the log never reads as that Owner's own decision.
        reviewItemsResolvedBy: "onBehalfOf",
      },
      // T11 (L3; 08-C RB-38(a)): the money of the advance can complete a project's full payment: its draft deed is made after `batch.postAudit` (the
      // ledger part with its recompute), guarded on this batch's audit row, as "Confirm by issuing" does (invoice-advance.ts).
      side: (g) => [
        ...batch.postAudit,
        ...deedDraftStatements(db, { target: { documentIds: [invoiceId] }, now }, g),
        ...sends,
        issuedBell(db, { documentId: invoiceId, client: ctx.client.display_name, earlierMonth }, g),
        // The payment's open review items (a dead letter, an earlier block) are settled by this issue: a system act recorded under the Owner it is issued on
        // behalf of (early check 2, finding 5: kept, and named in the audit summary as `reviewItemsResolvedBy: "onBehalfOf"`).
        db
          .prepare(
            `UPDATE review_items SET status = 'resolved', resolved_by = ?2, resolved_at = ?3, resolution = 'advance_issued'
             WHERE payment_id = ?1 AND status = 'open' AND EXISTS (SELECT 1 FROM payments x WHERE x.id = ?1 AND x.status = 'confirmed') AND ${g.sql(4)}`,
          )
          .bind(p.id, onBehalfOf, now, ...g.params),
      ],
    });
  } catch (e) {
    const text = String(e) + String((e as Error)?.cause ?? "");
    if (
      !/issue did not freeze|not an issuable draft|UNIQUE constraint failed: (documents|advance_receipts)\.|documents_|advance_receipts_|payment_allocations_|ledger_result_check|payments_/.test(
        text,
      )
    )
      throw e;
  }
  if (!done) {
    // Why it was refused, in ONE statement (the payment and the proforma's stamp): every statement counts on this, the worst path (early check 2, finding 1).
    const after = await db
      .prepare(AFTER_REFUSAL_SQL)
      .bind(paymentId, proformaId)
      .first<PendingRow & { proforma_updated_at: number | null }>();
    if (after?.status === "confirmed" && after.advance_receipt_id)
      return { result: "already_issued", ...(after.invoice_number ? { number: after.invoice_number } : {}) };
    if (after && after.proforma_updated_at !== d.updated_at && !lastTry) return { result: "retry" };
    return blocked(env, p, proformaId, ["freeze_refused"]);
  }
  await enqueuePdf(env, invoiceId, "send");
  return { result: "issued", ...(issued?.number_display ? { number: issued.number_display } : {}) };
}
