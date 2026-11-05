// Manual payments and TDS (M6.1; ADM-PAY-01, ADM-PAY-05, ADM-PAY-06, ADM-INV-16, ADM-INV-17, ADM-APR-01; run file C, L2 to L19), in the finance Worker:
//   GET  /payments, /payments/:id                       the list (keyset, at most 50) and one entry with its allocations;
//   POST /payments                                      record: the Owner's entry is confirmed in the same batch (a fresh code at the guard, Q2), a Staff
//                                                       member's waits as `pending_verification` with an approval row and a bell for each Owner (L6, L16);
//   POST /payments/:id/verify                           the Owner confirms (with the allocations, which may differ from what Staff asked) or rejects;
//   POST /payments/:id/withdraw                         the Owner withdraws a confirmed entry made in error (L7), with a reason;
//   PUT  /payments/:id/proof, GET                       the proof file, write-once in DOCS (L10, L11);
//   POST /payments/:id/tds-certificate                  the Form 16A number and date, set once (L19).
// Every change is ONE `mutate` batch built from `@techaust/db/ledger` in its order: the main statement (every guard in its WHERE, the authority in SQL), the
// audit row, the side statements guarded on it, then `ledger_result` last and unguarded. A read before the batch only explains a refusal in a person's terms;
// the batch decides. Money is integer minor units; amounts and ids only in the audit summaries, never a reference's text.
//
// TDS (T8): Settled by the lead on the safest reading, 2026-10-30 (08-C RA-30): the client's section, rate and certificate amount are recorded as given; the
// invoice and its GST stay at full value; the balance treats TDS as settled (ADM-INV-16, L19). Only INR tax invoices and debit notes of clients in India (L8).
import { sha256Hex } from "@techaust/core/catalogue";
import { uuidv7 } from "@techaust/core/ids";
import { issueDateOf, normaliseReference } from "@techaust/core/invoices";
import {
  type AllocationRequest,
  balanceOf,
  type LedgerDoc,
  planAllocations,
  receiptMonthWarning,
} from "@techaust/core/ledger";
import { staffNotify } from "@techaust/core/notifications";
import {
  paymentsListQuery,
  proofMeta,
  recordPaymentBody,
  tdsCertificateBody,
  verifyPaymentBody,
  withdrawPaymentBody,
} from "@techaust/core/payment-schemas";
import { decide } from "@techaust/core/permissions";
import { PAYMENT_ADVICE_SQL, paymentHasAdviceSql } from "@techaust/db/advices";
import { deedDraftStatements } from "@techaust/db/deeds";
import {
  type AllocationRow,
  allocationStatements,
  decideApprovalStatements,
  ledgerResultStatement,
  PAYMENT_REFERENCE_SEEN_SQL,
  paymentApprovalStatements,
  paymentNetSql,
  paymentProformaSql,
  paymentRefundedSql,
  paymentWaitsRefundSql,
  proofStatement,
  recomputeStatement,
  recordPaymentStatement,
  tdsCertificateStatement,
  verifyPaymentStatement,
  withdrawPaymentStatement,
} from "@techaust/db/ledger";
import { receiptVoidStatement } from "@techaust/db/refunds";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { CLIENT_GONE } from "./anonymised.ts";
import { type AppEnv, actor, BAD_REQUEST, type Ctx, err, mutate, NOT_FOUND } from "./context.ts";
import { docDownload, dropDoc, extOfMime, streamToDocs, uploadHead } from "./docs-upload.ts";
import { gatewayPaymentOf, refundNeededOf } from "./gateway/messages.ts";
import { body, idParam, isUnique, param, query, refusedWith, STALE_VERSION } from "./http.ts";
import { decodeCursor, encodeCursor } from "./keyset.ts";
import { queueNotify } from "./mail.ts";
import {
  ALREADY_RECORDED,
  allocationExceedsBalance,
  bellDecided,
  bellRecorded,
  CERTIFICATE_ALREADY_SET,
  CLIENT_MISMATCH,
  CURRENCY_MISMATCH,
  EXCEEDS_PAYMENT,
  LEDGER_CHANGED,
  NOT_PAYABLE,
  NOT_TDS,
  PAYMENT_ADVANCE_BACKED,
  PAYMENT_CLOSED,
  PAYMENT_NOT_CONFIRMED,
  PAYMENT_NOT_PENDING,
  PROFORMA_ASK_WHOLE,
  PROOF_ALREADY_SET,
  paymentLink,
  RECEIVED_ON_FUTURE,
  REFERENCE_INVALID,
  REFUND_IN_PROGRESS,
  REFUNDS_EXIST,
  REJECT_REASON_REQUIRED,
  referenceSeen,
  TDS_NOT_ALLOWED,
  TDS_NOT_WHOLE,
  TOO_MANY,
  USE_ADVANCE_INVOICE,
} from "./payment-messages.ts";
import { enqueueReceipt } from "./receipt-enqueue.ts";
import { ra41OnConfirm } from "./refund-facts.ts";
import { sessionRefusal } from "./session-refusal.ts";

/**
 * M7.1 (L10, L23): a notice named by `noticeId` that is not this client's, in this currency, or that is gone; or (early check 2, finding 1) whose document is
 * not among the payment's requested allocations (`details.reason: "document"`), so a notice is never closed by money put elsewhere or kept as credit.
 */
const NOTICE_MISMATCH = {
  code: "notice_mismatch",
  message: "That notice is not for this client and currency",
} as const;
const NOTICE_OTHER_DOCUMENT = {
  code: "notice_mismatch",
  message: "That notice is about a document this payment is not put on",
} as const;
const NOTICE_CLOSED = { code: "notice_closed", message: "This notice is already closed" } as const;
/**
 * M7.1 (L10, L23): the recording batch moves the client's "I've paid" notice to `recorded` with this payment, guarded on the payment's audit row (so a refused
 * record moves nothing) and on the notice still open and of this client (the trigger `payment_notices_status_flow` also needs the payment of its client and
 * currency). One notice per payment record. Early check 2, finding 1: the notice's document must be among the documents the payment is put on (`?6`, a JSON
 * array of the requested allocations' document ids), the batch twin of the handler's `notice_mismatch` with `reason: "document"`. `?1` notice, `?2` payment,
 * `?3` who, `?4` now, `?5` client, `?6` the documents, then the guard.
 */
export const noticeRecordStatement = (
  db: D1Database,
  a: {
    noticeId: string;
    paymentId: string;
    by: string;
    now: number;
    clientId: string;
    documentIds: readonly string[];
  },
  g: { sql: (at: number) => string; params: readonly unknown[] },
) =>
  db
    .prepare(
      `UPDATE payment_notices SET status = 'recorded', payment_id = ?2, closed_by = ?3, closed_at = ?4
       WHERE id = ?1 AND status = 'open' AND client_id = ?5
         AND document_id IN (SELECT value FROM json_each(?6)) AND ${g.sql(7)}`,
    )
    .bind(a.noticeId, a.paymentId, a.by, a.now, a.clientId, JSON.stringify(a.documentIds), ...g.params);

/** M6.5: a refund of payment `id` that has not failed (the confirm and withdraw refusals). */
const liveRefundOf = (db: D1Database, id: string) =>
  db
    .prepare(
      "SELECT 1 FROM payment_refunds INDEXED BY payment_refunds_payment WHERE payment_id = ?1 AND status <> 'failed'",
    )
    .bind(id)
    .first();

// ---- reads ----------------------------------------------------------------------------------------------------------------------------------------------

const PAYMENT_COLS = `p.id, p.client_id, c.code AS client_code, c.display_name AS client_name, (c.anonymised_at IS NOT NULL) AS client_gone, p.kind, p.provider, p.status,
  p.currency, p.amount_minor, p.charges_minor, p.received_on, p.mode, p.reference_norm, p.inr_received_minor, p.requested_allocations, p.tds_section, p.tds_rate_bp,
  p.tds_certificate_no, p.tds_certificate_on, p.proof_kind, p.proof_ref, p.proof_r2_key, p.proof_sha256, p.proof_mime, p.advance_receipt_id, p.note,
  p.recorded_by, (SELECT name FROM staff_users WHERE id = p.recorded_by) AS recorded_by_name, p.recorded_at, p.verified_by,
  (SELECT name FROM staff_users WHERE id = p.verified_by) AS verified_by_name, p.verified_at, p.decision_note, p.withdrawn_by, p.withdrawn_at, p.withdraw_reason,
  p.provider_payment_id, CASE WHEN p.status = 'pending_verification' THEN ${paymentProformaSql("p")} END AS proforma_id,
  (p.status = 'pending_verification' AND ${paymentWaitsRefundSql("p")}) AS waits_refund`;

export type PaymentRow = {
  id: string;
  client_id: string;
  client_code: string;
  client_name: string;
  client_gone: number;
  kind: "payment" | "tds";
  provider: string;
  status: "pending_verification" | "confirmed" | "rejected" | "withdrawn";
  currency: "INR" | "USD";
  amount_minor: number;
  charges_minor: number;
  received_on: string;
  mode: string | null;
  reference_norm: string | null;
  inr_received_minor: number | null;
  requested_allocations: string | null;
  tds_section: string | null;
  tds_rate_bp: number | null;
  tds_certificate_no: string | null;
  tds_certificate_on: string | null;
  proof_kind: string | null;
  proof_ref: string | null;
  proof_r2_key: string | null;
  proof_sha256: string | null;
  proof_mime: string | null;
  advance_receipt_id: string | null;
  note: string | null;
  recorded_by: string | null;
  recorded_by_name: string | null;
  recorded_at: number;
  verified_by: string | null;
  verified_by_name: string | null;
  verified_at: number | null;
  decision_note: string | null;
  withdrawn_by: string | null;
  withdrawn_at: number | null;
  withdraw_reason: string | null;
  /** The gateway's own payment id (Razorpay's `pay_…`, Stripe's `pi_…`), null for a manual entry. */
  provider_payment_id: string | null;
  /** M6.3 staging fix 2 (L5): while pending, the proforma this entry asks for, by its request or its checkout (`paymentProformaSql`), else null. */
  proforma_id: string | null;
  /** M6.3 staging fixes, review M3: 1 while pending and above the balance of the issued proforma it asks for (`paymentWaitsRefundSql`). */
  waits_refund: number;
};

/** One payment by id, with its client. */
export const PAYMENT_READ_SQL = `SELECT ${PAYMENT_COLS} FROM payments p JOIN clients c ON c.id = p.client_id WHERE p.id = ?1`;
/** The allocation rows of one payment, with each document's number (the entry's detail). */
export const PAYMENT_ALLOCATIONS_SQL = `SELECT a.id, a.document_id, d.number_display, d.type, a.kind, a.amount_minor, a.created_at
   FROM payment_allocations a INDEXED BY payment_allocations_payment JOIN documents d ON d.id = a.document_id WHERE a.payment_id = ?1 ORDER BY a.created_at, a.id`;
/** M7.1 review 1, M5: the notice a payment was recorded from (at most one: `POST /payments` takes one `noticeId`), by `payment_notices_payment`. */
export const PAYMENT_NOTICE_SQL = `SELECT n.id, n.via, n.created_at FROM payment_notices n INDEXED BY payment_notices_payment
   WHERE n.payment_id = ?1 ORDER BY n.id LIMIT 1`;
/** The documents a payment asks for or is put on (`?1` a JSON list of ids): what `planAllocations` needs, and the issue date for the RA-17 warning. */
export const LEDGER_DOCS_SQL = `SELECT id, client_id, currency, type, status, frozen_at, total_minor, paid_minor, credited_minor, tds_minor, balance_minor, issue_date, number_display
   FROM documents WHERE id IN (SELECT value FROM json_each(?1))`;

type DocRow = {
  id: string;
  client_id: string;
  currency: string;
  type: string;
  status: string;
  frozen_at: number | null;
  total_minor: number;
  paid_minor: number;
  credited_minor: number;
  tds_minor: number;
  balance_minor: number;
  issue_date: string | null;
  number_display: string | null;
};

const ledgerDocOf = (d: DocRow): LedgerDoc => ({
  id: d.id,
  clientId: d.client_id,
  currency: d.currency,
  type: d.type,
  status: d.status,
  frozen: d.frozen_at !== null,
  totalMinor: d.total_minor,
  paidMinor: d.paid_minor,
  creditedMinor: d.credited_minor,
  tdsMinor: d.tds_minor,
});

const parseRequested = (text: string | null): AllocationRequest[] => {
  if (text === null) return [];
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v)
      ? v.flatMap((x) =>
          x &&
          typeof x === "object" &&
          typeof x.documentId === "string" &&
          Number.isSafeInteger(x.amountMinor)
            ? [{ documentId: x.documentId as string, amountMinor: x.amountMinor as number }]
            : [],
        )
      : [];
  } catch {
    return [];
  }
};

/** The shape sent to the screens: never the R2 key. */
export const paymentView = (r: PaymentRow) => ({
  id: r.id,
  clientId: r.client_id,
  clientCode: r.client_code,
  clientName: r.client_name,
  clientGone: r.client_gone === 1,
  kind: r.kind,
  provider: r.provider,
  status: r.status,
  currency: r.currency,
  amountMinor: r.amount_minor,
  chargesMinor: r.charges_minor,
  receivedOn: r.received_on,
  mode: r.mode,
  reference: r.reference_norm,
  inrReceivedMinor: r.inr_received_minor,
  requestedAllocations: parseRequested(r.requested_allocations),
  tds:
    r.kind === "tds"
      ? {
          section: r.tds_section,
          rateBp: r.tds_rate_bp,
          certificateNo: r.tds_certificate_no,
          certificateOn: r.tds_certificate_on,
          /** 07-ZH line 8 "Certificate awaited" while the Form 16A number is not entered (L19). */
          certificateAwaited: r.tds_certificate_no === null,
        }
      : null,
  proof:
    r.proof_kind !== null || r.proof_r2_key !== null
      ? {
          kind: r.proof_kind,
          ref: r.proof_ref,
          hasFile: r.proof_r2_key !== null,
          mime: r.proof_mime,
          sha256: r.proof_sha256,
        }
      : null,
  advanceReceiptId: r.advance_receipt_id,
  note: r.note,
  recordedBy: r.recorded_by,
  recordedByName: r.recorded_by_name,
  recordedAt: r.recorded_at,
  verifiedBy: r.verified_by,
  verifiedByName: r.verified_by_name,
  verifiedAt: r.verified_at,
  decisionNote: r.decision_note,
  withdrawnBy: r.withdrawn_by,
  withdrawnAt: r.withdrawn_at,
  withdrawReason: r.withdraw_reason,
  /** M6.3 staging fix 1: the gateway's own payment id, for its line beside the reference when the advance dialog takes this entry. */
  providerPaymentId: r.provider_payment_id,
  /**
   * M6.3 staging fix 2 (L5): while pending, the proforma this entry asks for (its request, or the proforma its online checkout was for), else null. The screens
   * then offer only "Confirm by issuing the tax invoice" on that proforma, never the plain Confirm (the verify route refuses it: `use_advance_invoice`).
   */
  proformaId: r.proforma_id,
  /**
   * M6.3 staging fixes, review M3: with `proformaId`, true when this money is above that issued proforma's balance (`paymentWaitsRefundSql`): no tax invoice can
   * take it, so the screens offer no "Confirm by issuing the tax invoice" (refused as `advance_exceeds_balance`); an online payment shows the 07-ZM line 1(c).
   */
  waitsRefund: r.waits_refund === 1,
});
export type PaymentView = ReturnType<typeof paymentView>;

// ---- the list -------------------------------------------------------------------------------------------------------------------------------------------

const PAGE = 50;
const listQuery = z.extend(paymentsListQuery, { after: z.optional(z.string().check(z.maxLength(400))) });

/**
 * One page of the list, each variant read through an index (docs/05 rule: index every filter): a client's entries through `payments_client` (newest received
 * first); the pending ones through `payments_pending` (oldest recorded first: the Owner's "Payments to check", 07-ZH line 4); the confirmed ones through
 * `payments_confirmed` (newest received first); anything else in the table's own order, newest written first (rejected and withdrawn entries are rare).
 * Returns the SQL and the name of its sort key, for the cursor.
 */
export function paymentListSql(f: {
  client: boolean;
  status: string | undefined;
  from: boolean;
  to: boolean;
  cursor: boolean;
  /** M6.3 (L11): card and PayPal payments with no proof yet ("Proof awaited"), through `payments_proof_awaited`. */
  proof?: boolean;
}): { sql: string; key: "received_on" | "recorded_at" | "rowid" } {
  const where: string[] = [];
  let at = 1;
  const next = () => `?${at++}`;
  let key: "received_on" | "recorded_at" | "rowid";
  let from: string;
  let order: string;
  let cursor = "";
  // The partial index's own WHERE, stated as literals so it can be used (and kept as a filter on every other variant).
  // M6.4 (Step 0.2 item 6): "Proof awaited" is no proof AND no remittance advice link (one seek of `realisation_advice_payments_active` per row).
  if (f.proof)
    where.push(
      "p.provider IN ('stripe', 'paypal') AND p.proof_r2_key IS NULL AND p.status IN ('pending_verification', 'confirmed')",
      `NOT ${paymentHasAdviceSql("p")}`,
    );
  if (f.proof && !f.client) {
    from = "payments p INDEXED BY payments_proof_awaited";
    key = "received_on";
  } else if (f.client) {
    from = "payments p INDEXED BY payments_client";
    where.push(`p.client_id = ${next()}`);
    key = "received_on";
  } else if (f.status === "pending_verification") {
    from = "payments p INDEXED BY payments_pending";
    // A partial index is usable only when the query states its WHERE as a literal; the bound `p.status = ?` below stays as well.
    where.push("p.status = 'pending_verification'");
    key = "recorded_at";
  } else if (f.status === "confirmed") {
    from = "payments p INDEXED BY payments_confirmed";
    where.push("p.status = 'confirmed'");
    key = "received_on";
  } else {
    from = "payments p";
    key = "rowid";
  }
  if (f.status !== undefined) where.push(`p.status = ${next()}`);
  if (f.from) where.push(`p.received_on >= ${next()}`);
  if (f.to) where.push(`p.received_on <= ${next()}`);
  if (key === "recorded_at") {
    order = "p.recorded_at, p.id";
    if (f.cursor) {
      const a = next();
      const b = next();
      cursor = `(p.recorded_at > ${a} OR (p.recorded_at = ${a} AND p.id > ${b}))`;
    }
  } else if (key === "received_on") {
    order = "p.received_on DESC, p.id DESC";
    if (f.cursor) {
      const a = next();
      const b = next();
      cursor = `(p.received_on < ${a} OR (p.received_on = ${a} AND p.id < ${b}))`;
    }
  } else {
    order = "p.rowid DESC";
    if (f.cursor) cursor = `p.rowid < ${next()}`;
  }
  if (cursor) where.push(cursor);
  return {
    sql: `SELECT ${PAYMENT_COLS}, p.rowid AS rid FROM ${from} JOIN clients c ON c.id = p.client_id${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ${PAGE + 1}`,
    key,
  };
}

// ---- refusals -------------------------------------------------------------------------------------------------------------------------------------------

/** What the allocation plan's refusal means to a person (07-ZH line 13 where it has a line). */
function planRefusal(
  c: Ctx,
  code: string,
  documentId: string | undefined,
  docs: readonly DocRow[],
): Response {
  const d = docs.find((x) => x.id === documentId);
  switch (code) {
    case "too_many":
      return err(c, TOO_MANY, 400);
    case "not_payable":
      if (!d) return err(c, NOT_PAYABLE, 409, documentId ? { documentId } : undefined);
      // L5: money on a proforma is confirmed only by issuing the tax invoice for the payment received.
      return d.type === "proforma"
        ? err(c, USE_ADVANCE_INVOICE, 409, { documentId: d.id })
        : err(c, NOT_PAYABLE, 409, { documentId: d.id });
    case "client_mismatch":
      return err(c, CLIENT_MISMATCH, 409, documentId ? { documentId } : undefined);
    case "currency_mismatch":
      return err(c, CURRENCY_MISMATCH, 409, documentId ? { documentId } : undefined);
    case "tds_not_allowed":
      return err(c, TDS_NOT_ALLOWED, 409, documentId ? { documentId } : undefined);
    case "tds_not_whole":
      return err(c, TDS_NOT_WHOLE, 400);
    case "exceeds_balance": {
      const balance = d ? balanceOf(d.total_minor, d.paid_minor, d.credited_minor, d.tds_minor) : 0;
      return err(c, allocationExceedsBalance(balance, d?.currency ?? "INR"), 409, {
        documentId: documentId ?? null,
        balanceMinor: balance,
      });
    }
    case "exceeds_payment":
      return err(c, EXCEEDS_PAYMENT, 409);
    default:
      return err(c, BAD_REQUEST, 400);
  }
}

/** A trigger or the post-condition refused the batch: the payment's sums no longer fit the documents (another change landed between the read and the write). */
export const LEDGER_REFUSED =
  /payment_allocations_bounds|ledger_result_check|payments_status_flow|payments_fixed|documents_ledger_identity|documents_tds_bounds|payments_tds_rules/;

/** RA-17 (L13): money that arrived in a month before the invoice's month was an advance; its GST was due in that month's return (a warning, never a block). */
function receiptWarnings(receivedOn: string, docs: readonly DocRow[], ids: readonly string[]) {
  return docs
    .filter((d) => ids.includes(d.id) && d.issue_date !== null)
    .flatMap((d) =>
      receiptMonthWarning(receivedOn, d.issue_date as string) === null
        ? []
        : [{ code: "received_in_earlier_month" as const, documentId: d.id, month: receivedOn.slice(0, 7) }],
    );
}

const contentOf = (p: {
  id: string;
  clientId: string;
  kind: string;
  currency: string;
  amountMinor: number;
  receivedOn: string;
  requested: readonly AllocationRequest[];
}) => sha256Hex(JSON.stringify(p));

// ---- the router -----------------------------------------------------------------------------------------------------------------------------------------

export const payments = new Hono<AppEnv>()
  .get("/", query(listQuery), async (c) => {
    const q = c.req.valid("query");
    const variant = paymentListSql({
      client: q.client !== undefined,
      status: q.status,
      from: q.from !== undefined,
      to: q.to !== undefined,
      cursor: q.after !== undefined,
      proof: q.proof === "awaited",
    });
    let cursorBinds: unknown[] = [];
    if (q.after !== undefined) {
      const cur = decodeCursor(q.after);
      if (!cur) return err(c, BAD_REQUEST, 400);
      if (variant.key === "rowid") {
        if (typeof cur.k !== "number") return err(c, BAD_REQUEST, 400);
        cursorBinds = [cur.k];
      } else if (variant.key === "recorded_at") {
        if (typeof cur.k !== "number") return err(c, BAD_REQUEST, 400);
        cursorBinds = [cur.k, cur.id];
      } else {
        if (typeof cur.k !== "string") return err(c, BAD_REQUEST, 400);
        cursorBinds = [cur.k, cur.id];
      }
    }
    const { results } = await c.env.DB.prepare(variant.sql)
      .bind(
        ...(q.client !== undefined ? [q.client] : []),
        ...(q.status !== undefined ? [q.status] : []),
        ...(q.from !== undefined ? [q.from] : []),
        ...(q.to !== undefined ? [q.to] : []),
        ...cursorBinds,
      )
      .all<PaymentRow & { rid: number }>();
    const page = results.slice(0, PAGE);
    const last = page.at(-1);
    const next =
      results.length > PAGE && last
        ? encodeCursor({
            k:
              variant.key === "rowid"
                ? last.rid
                : variant.key === "recorded_at"
                  ? last.recorded_at
                  : last.received_on,
            id: last.id,
          })
        : null;
    return c.json({ payments: page.map(paymentView), next });
  })

  .get("/:id", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    // M6.4 (the designer's admin round): the advice the payment is on now, from the active link only (a link taken off is null).
    const [p, a, adv, nt] = await c.env.DB.batch([
      c.env.DB.prepare(PAYMENT_READ_SQL).bind(id),
      c.env.DB.prepare(PAYMENT_ALLOCATIONS_SQL).bind(id),
      c.env.DB.prepare(PAYMENT_ADVICE_SQL).bind(id),
      c.env.DB.prepare(PAYMENT_NOTICE_SQL).bind(id),
    ]);
    const row = p?.results[0] as PaymentRow | undefined;
    if (!row) return err(c, NOT_FOUND, 404);
    const allocations = (
      (a?.results ?? []) as {
        id: string;
        document_id: string;
        number_display: string | null;
        type: string;
        kind: string;
        amount_minor: number;
        created_at: number;
      }[]
    ).map((r) => ({
      id: r.id,
      documentId: r.document_id,
      number: r.number_display,
      type: r.type,
      kind: r.kind,
      amountMinor: r.amount_minor,
      createdAt: r.created_at,
    }));
    const on = adv?.results[0] as
      | { id: string; provider: string; kind: string; advice_ref: string; issued_on: string }
      | undefined;
    const notice = nt?.results[0] as { id: string; via: string; created_at: number } | undefined;
    return c.json({
      payment: paymentView(row),
      allocations,
      /**
       * Review 1, M5: the client's "I've paid" notice this entry was recorded from (L23), else null. The reject and withdraw dialogs say so; the notice stays
       * `recorded` whatever the entry's later status (the Notices tab's Recorded list shows the entry's status).
       */
      fromNotice: notice ? { id: notice.id, via: notice.via, createdAt: notice.created_at } : null,
      advice: on
        ? {
            id: on.id,
            provider: on.provider,
            kind: on.kind,
            adviceRef: on.advice_ref,
            issuedOn: on.issued_on,
          }
        : null,
    });
  })

  // ---- record ----
  .post("/", body(recordPaymentBody), async (c) => {
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    // The guard let the Owner through with a fresh code (step-up) and Staff as "approval"; anyone else never gets here.
    const confirmed = decide(u.role, "payments.record") === "step-up";
    const now = Date.now();
    if (f.receivedOn > issueDateOf(now)) return err(c, RECEIVED_ON_FUTURE, 400);
    let referenceNorm: string | null = null;
    if (f.reference !== undefined) {
      referenceNorm = normaliseReference(f.reference);
      if (referenceNorm === null) return err(c, REFERENCE_INVALID, 400);
    }
    const requested = f.allocations ?? [];
    const [clientR, existsR, seenR, docsR, noticeR] = await db.batch([
      db
        .prepare(
          "SELECT id, display_name, currency, country, gst_status, anonymised_at FROM clients WHERE id = ?1",
        )
        .bind(f.clientId),
      db.prepare("SELECT 1 AS x FROM payments WHERE id = ?1").bind(f.id),
      db.prepare(PAYMENT_REFERENCE_SEEN_SQL).bind(referenceNorm ?? ""),
      db.prepare(LEDGER_DOCS_SQL).bind(JSON.stringify(requested.map((r) => r.documentId))),
      // M7.1 (L23): the notice this payment is recorded from, if any.
      db
        .prepare("SELECT client_id, document_id, currency, status FROM payment_notices WHERE id = ?1")
        .bind(f.noticeId ?? ""),
    ]);
    if (existsR?.results[0]) return err(c, ALREADY_RECORDED, 409);
    const client = clientR?.results[0] as
      | {
          id: string;
          display_name: string;
          currency: string;
          country: string;
          gst_status: string;
          anonymised_at: number | null;
        }
      | undefined;
    if (!client) return err(c, NOT_FOUND, 404);
    if (client.anonymised_at !== null) return err(c, CLIENT_GONE, 409);
    // L23.4: a payment is in the client's currency.
    if (client.currency !== f.currency) return err(c, CURRENCY_MISMATCH, 409);
    if (f.noticeId !== undefined) {
      const n = noticeR?.results[0] as
        | { client_id: string; document_id: string; currency: string; status: string }
        | undefined;
      if (!n || n.client_id !== f.clientId || n.currency !== f.currency) return err(c, NOTICE_MISMATCH, 409);
      if (n.status !== "open") return err(c, NOTICE_CLOSED, 409);
      // Early check 2, finding 1: the payment must be put on the notice's document (a proforma notice: Staff's whole-amount proforma ask; L25).
      if (!requested.some((r) => r.documentId === n.document_id))
        return err(c, NOTICE_OTHER_DOCUMENT, 409, { reason: "document", documentId: n.document_id });
    }
    // L8, L23.5: TDS only for a client in India.
    if (f.kind === "tds" && (client.country !== "IN" || client.gst_status === "overseas"))
      return err(c, TDS_NOT_ALLOWED, 409);
    const seen = seenR?.results[0] as
      | { received_on: string; client_name: string; client_code: string }
      | undefined;
    if (referenceNorm !== null && seen && f.confirmDuplicate !== true)
      return err(c, referenceSeen(seen.received_on, seen.client_name), 409, {
        receivedOn: seen.received_on,
        clientCode: seen.client_code,
        clientName: seen.client_name,
      });
    const docs = (docsR?.results ?? []) as DocRow[];
    // The plan, checked as the trigger and the post-condition check it (the batch holds the same rules). Staff may ask for a proforma (L5: the Owner then
    // confirms by issuing the tax invoice for the payment received); the Owner's entry may not.
    const proformaAsks = requested.filter(
      (r) => docs.find((d) => d.id === r.documentId)?.type === "proforma",
    );
    if (proformaAsks.length > 0 && (confirmed || f.kind === "tds")) {
      const first = proformaAsks[0] as AllocationRequest;
      return f.kind === "tds"
        ? err(c, TDS_NOT_ALLOWED, 409, { documentId: first.documentId })
        : err(c, USE_ADVANCE_INVOICE, 409, { documentId: first.documentId });
    }
    // Early check 2, finding 3: a proforma ask is the whole payment on that one proforma. The Owner confirms it only by issuing the tax invoice for the
    // payment received, for exactly the payment's amount (L5), so a split between a proforma and invoices (or two proformas) could never be confirmed.
    if (
      proformaAsks.length > 0 &&
      (requested.length !== 1 || (proformaAsks[0] as AllocationRequest).amountMinor !== f.amountMinor)
    )
      return err(c, PROFORMA_ASK_WHOLE, 409, {
        documentId: (proformaAsks[0] as AllocationRequest).documentId,
      });
    for (const r of proformaAsks) {
      const d = docs.find((x) => x.id === r.documentId) as DocRow;
      if (d.client_id !== f.clientId) return err(c, CLIENT_MISMATCH, 409, { documentId: d.id });
      if (d.currency !== f.currency) return err(c, CURRENCY_MISMATCH, 409, { documentId: d.id });
      if (d.frozen_at === null || (d.status !== "issued" && d.status !== "converted"))
        return err(c, NOT_PAYABLE, 409, { documentId: d.id });
      if (r.amountMinor > d.balance_minor)
        return err(c, allocationExceedsBalance(d.balance_minor, d.currency), 409, {
          documentId: d.id,
          balanceMinor: d.balance_minor,
        });
    }
    const onInvoices = requested.filter((r) => !proformaAsks.includes(r));
    const leftForInvoices = f.amountMinor - proformaAsks.reduce((s, r) => s + r.amountMinor, 0);
    if (leftForInvoices < 0 || (leftForInvoices === 0 && onInvoices.length > 0))
      return err(c, EXCEEDS_PAYMENT, 409);
    const plan =
      leftForInvoices === 0
        ? ({ ok: true, allocations: [], unallocatedMinor: 0 } as const)
        : planAllocations(
            { clientId: f.clientId, currency: f.currency, kind: f.kind, amountMinor: leftForInvoices },
            onInvoices,
            docs.map(ledgerDocOf),
          );
    if (!plan.ok) return planRefusal(c, plan.code, plan.documentId, docs);
    const rows: AllocationRow[] = confirmed
      ? plan.allocations.map((a) => ({
          id: uuidv7(),
          paymentId: f.id,
          documentId: a.documentId,
          amountMinor: a.amountMinor,
          kind: "allocate" as const,
        }))
      : [];
    const tds = f.tds
      ? {
          section: f.tds.section,
          rateBp: f.tds.rateBp,
          certificateNo: f.tds.certificateNo ?? null,
          certificateOn: f.tds.certificateOn ?? null,
        }
      : null;
    const main = recordPaymentStatement(db, {
      id: f.id,
      clientId: f.clientId,
      kind: f.kind,
      status: confirmed ? "confirmed" : "pending_verification",
      currency: f.currency,
      amountMinor: f.amountMinor,
      chargesMinor: f.chargesMinor ?? 0,
      receivedOn: f.receivedOn,
      mode: f.mode ?? null,
      referenceNorm,
      inrReceivedMinor: f.inrReceivedMinor ?? null,
      requestedAllocations: !confirmed && requested.length > 0 ? JSON.stringify(requested) : null,
      tds,
      note: f.note ?? null,
      recordedBy: u.id,
      sessionId: u.sessionId,
      now,
      confirmDuplicate: f.confirmDuplicate === true,
    });
    const approvalId = uuidv7();
    const contentSha256 = confirmed
      ? ""
      : await contentOf({
          id: f.id,
          clientId: f.clientId,
          kind: f.kind,
          currency: f.currency,
          amountMinor: f.amountMinor,
          receivedOn: f.receivedOn,
          requested,
        });
    let done = false;
    let noticeRecorded = false;
    try {
      done = await mutate(c, {
        main,
        action: "payment.record",
        entityType: "payment",
        entityId: f.id,
        // Ids, codes and amounts only (never the reference's text or the note).
        summary: {
          paymentId: f.id,
          clientId: f.clientId,
          kind: f.kind,
          status: confirmed ? "confirmed" : "pending_verification",
          currency: f.currency,
          amountMinor: f.amountMinor,
          receivedOn: f.receivedOn,
          allocations: (confirmed ? plan.allocations : requested).map((a) => ({
            documentId: a.documentId,
            amountMinor: a.amountMinor,
          })),
          ...(f.confirmDuplicate === true ? { confirmDuplicate: true } : {}),
          ...(f.noticeId !== undefined ? { noticeId: f.noticeId } : {}),
        },
        status: 201,
        // M7.1 (L23): the notice statement is the first side statement, so its result follows the audit row's.
        onResults: (results, auditAt) => {
          noticeRecorded = f.noticeId !== undefined && results[auditAt + 1]?.meta.changes === 1;
        },
        side: (g) => [
          ...(f.noticeId !== undefined
            ? [
                noticeRecordStatement(
                  db,
                  {
                    noticeId: f.noticeId,
                    paymentId: f.id,
                    by: u.id,
                    now,
                    clientId: f.clientId,
                    documentIds: requested.map((r) => r.documentId),
                  },
                  g,
                ),
              ]
            : []),
          ...(confirmed
            ? [
                ...allocationStatements(db, rows, u.id, now, g),
                recomputeStatement(db, { paymentIds: [f.id] }, now, g),
                // T11 (L3; 08-C RB-38(a)): a confirmed payment can bring a completed project to "fully paid": its draft deed, after the recompute, guarded.
                ...deedDraftStatements(db, { target: { paymentIds: [f.id] }, now }, g),
                ledgerResultStatement(db, { paymentIds: [f.id] }),
              ]
            : paymentApprovalStatements(
                db,
                {
                  approvalId,
                  paymentId: f.id,
                  requestedBy: u.id,
                  contentSha256,
                  now,
                  bell: {
                    title: bellRecorded(u.name, f.amountMinor, f.currency, client.display_name),
                    link: paymentLink(f.id),
                  },
                },
                g,
              )),
        ],
      });
    } catch (e) {
      // One pending check per payment (`approvals_payment_pending`): a repeat of this id that slipped past the read is the same entry.
      if (isUnique(e, "approvals\\.payment_id") || isUnique(e, "payments\\.id"))
        return err(c, ALREADY_RECORDED, 409);
      if (!refusedWith(e, LEDGER_REFUSED)) throw e;
      return explainPlan(c, { ...f, requested: onInvoices });
    }
    if (!done) {
      const again = await db.batch([
        db.prepare("SELECT 1 AS x FROM payments WHERE id = ?1").bind(f.id),
        db.prepare("SELECT anonymised_at FROM clients WHERE id = ?1").bind(f.clientId),
        db.prepare(PAYMENT_REFERENCE_SEEN_SQL).bind(referenceNorm ?? ""),
      ]);
      if (again[0]?.results[0]) return err(c, ALREADY_RECORDED, 409);
      if ((again[1]?.results[0] as { anonymised_at: number | null } | undefined)?.anonymised_at != null)
        return err(c, CLIENT_GONE, 409);
      const late = again[2]?.results[0] as
        | { received_on: string; client_name: string; client_code: string }
        | undefined;
      if (referenceNorm !== null && late && f.confirmDuplicate !== true)
        return err(c, referenceSeen(late.received_on, late.client_name), 409, {
          receivedOn: late.received_on,
          clientCode: late.client_code,
          clientName: late.client_name,
        });
      return (await sessionRefusal(c, confirmed)) ?? err(c, STALE_VERSION, 409);
    }
    // M6.5 (L3): an Owner's entry is confirmed in its batch: its receipt follows (never TDS).
    if (confirmed && f.kind === "payment") c.executionCtx.waitUntil(enqueueReceipt(c.env, f.id));
    // M7.2 (L9, Q1 A): an entry that waits for the Owner's check rang the owners' `payment.verify` bell in this batch: its emails by the owners' switches
    // (ids only; the hourly `bells.sweep` catches a lost send).
    if (!confirmed) queueNotify(c, staffNotify("payment.verify", f.id));
    // Review part 1, finding 3 (RA-41): whether the credit this confirmation leaves may be an advance (codes only).
    const ra41 =
      confirmed && f.kind === "payment"
        ? await ra41OnConfirm(
            db,
            {
              currency: f.currency,
              amountMinor: f.amountMinor,
              unallocatedMinor: plan.unallocatedMinor,
              receivedOn: f.receivedOn,
            },
            issueDateOf(now),
          )
        : null;
    return c.json(
      {
        ok: true,
        id: f.id,
        status: confirmed ? "confirmed" : "pending_verification",
        allocations: confirmed ? plan.allocations : [],
        requestedAllocations: confirmed ? [] : requested,
        /** 07-ZH line 9: what the invoices do not take is kept as the client's credit (ADM-PAY-06). */
        unallocatedMinor: confirmed ? plan.unallocatedMinor : null,
        ra41,
        ...(confirmed ? {} : { approvalId }),
        /** M7.1 (L23): the notice this payment was recorded from, and whether it moved to `recorded` in the batch. */
        notice: f.noticeId !== undefined ? { id: f.noticeId, recorded: noticeRecorded } : null,
        warnings: confirmed
          ? receiptWarnings(
              f.receivedOn,
              docs,
              plan.allocations.map((a) => a.documentId),
            )
          : [],
      },
      201,
    );
  })

  // ---- verify (Owner, fresh code) ----
  .post("/:id/verify", param(idParam), body(verifyPaymentBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const row = await db.prepare(PAYMENT_READ_SQL).bind(id).first<PaymentRow>();
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.status !== "pending_verification") return err(c, PAYMENT_NOT_PENDING, 409);
    if (row.recorded_at !== f.expectedRecordedAt) return err(c, STALE_VERSION, 409);
    if (row.client_gone === 1) return err(c, CLIENT_GONE, 409);
    const decision = f.decision === "confirm" ? ("confirmed" as const) : ("rejected" as const);
    // M6.2 (L7): a gateway payment is never rejected here: the money is at Razorpay and goes back by a refund (M6.5).
    if (decision === "rejected" && row.provider !== "manual")
      return err(c, refundNeededOf(row.provider), 409);
    if (decision === "rejected" && f.note === undefined) return err(c, REJECT_REASON_REQUIRED, 400);
    // M6.3 staging fix 2 (L5; Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17)): an entry that asks for a proforma, by its own request
    // or (a gateway payment) by its checkout, is confirmed only by issuing the tax invoice for the payment received, WHATEVER allocations the dialog sends: the
    // dialog's own list once replaced the request and confirmed a proforma's card payment as credit beside a manual receipt (staging, 2026-11-02). The
    // statement's WHERE holds the same rule.
    if (decision === "confirmed" && row.proforma_id !== null)
      return err(c, USE_ADVANCE_INVOICE, 409, { documentId: row.proforma_id });
    // M6.5 (L33; early check 1, part 2 item 2): a pending payment being refunded is never confirmed (trigger `payments_refund_no_confirm` holds it too).
    if (decision === "confirmed" && (await liveRefundOf(db, id))) return err(c, REFUND_IN_PROGRESS, 409);
    const requested = f.allocations ?? parseRequested(row.requested_allocations);
    let rows: AllocationRow[] = [];
    let docs: DocRow[] = [];
    let unallocatedMinor: number | null = null;
    if (decision === "confirmed") {
      docs = ((
        await db
          .prepare(LEDGER_DOCS_SQL)
          .bind(JSON.stringify(requested.map((r) => r.documentId)))
          .all<DocRow>()
      ).results ?? []) as DocRow[];
      // L5: money on a proforma is confirmed only by issuing the tax invoice for the payment received (the advance dialog, prefilled from this payment).
      const proforma = requested.find((r) => docs.find((d) => d.id === r.documentId)?.type === "proforma");
      if (proforma) return err(c, USE_ADVANCE_INVOICE, 409, { documentId: proforma.documentId });
      const plan = planAllocations(
        { clientId: row.client_id, currency: row.currency, kind: row.kind, amountMinor: row.amount_minor },
        requested,
        docs.map(ledgerDocOf),
      );
      if (!plan.ok) return planRefusal(c, plan.code, plan.documentId, docs);
      unallocatedMinor = plan.unallocatedMinor;
      rows = plan.allocations.map((a) => ({
        id: uuidv7(),
        paymentId: id,
        documentId: a.documentId,
        amountMinor: a.amountMinor,
        kind: "allocate" as const,
      }));
    }
    const now = Math.max(Date.now(), row.recorded_at + 1);
    const note = f.note ?? null;
    let done = false;
    try {
      done = await mutate(c, {
        main: verifyPaymentStatement(db, {
          paymentId: id,
          decision,
          now,
          sessionId: u.sessionId,
          note,
          expectedRecordedAt: f.expectedRecordedAt,
        }),
        action: "payment.verify",
        entityType: "payment",
        entityId: id,
        summary: {
          paymentId: id,
          clientId: row.client_id,
          decision,
          currency: row.currency,
          amountMinor: row.amount_minor,
          allocations: rows.map((r) => ({ documentId: r.documentId, amountMinor: r.amountMinor })),
        },
        side: (g) => [
          ...(decision === "confirmed"
            ? [
                ...allocationStatements(db, rows, u.id, now, g),
                recomputeStatement(db, { paymentIds: [id] }, now, g),
                // T11 (L3): the confirmed payment can complete a project's full payment.
                ...deedDraftStatements(db, { target: { paymentIds: [id] }, now }, g),
                // M6.2: a Razorpay payment the Owner confirms here (a mismatch it accepted) settles its open review items.
                ...(row.provider !== "manual"
                  ? [
                      db
                        .prepare(
                          `UPDATE review_items SET status = 'resolved', resolved_by = ?2, resolved_at = ?3, resolution = 'confirmed' WHERE payment_id = ?1 AND status = 'open' AND ${g.sql(4)}`,
                        )
                        .bind(id, u.id, now, ...g.params),
                    ]
                  : []),
              ]
            : []),
          ...decideApprovalStatements(
            db,
            {
              paymentId: id,
              decidedBy: u.id,
              now,
              note,
              bell: {
                title: bellDecided(decision, row.amount_minor, row.currency, row.client_name, note ?? ""),
                link: paymentLink(id),
              },
            },
            g,
          ),
          ...(decision === "confirmed" ? [ledgerResultStatement(db, { paymentIds: [id] })] : []),
        ],
      });
    } catch (e) {
      // A refund started between the read and the batch (trigger `payments_refund_no_confirm`).
      if (refusedWith(e, /payments_refund_no_confirm/)) return err(c, REFUND_IN_PROGRESS, 409);
      if (!refusedWith(e, LEDGER_REFUSED)) throw e;
      return explainPlan(c, {
        id,
        clientId: row.client_id,
        currency: row.currency,
        kind: row.kind,
        amountMinor: row.amount_minor,
        requested,
      });
    }
    if (!done) {
      const again = await db.prepare(PAYMENT_READ_SQL).bind(id).first<PaymentRow>();
      if (!again) return err(c, NOT_FOUND, 404);
      if (again.status !== "pending_verification") return err(c, PAYMENT_NOT_PENDING, 409);
      if (again.client_gone === 1) return err(c, CLIENT_GONE, 409);
      if (again.recorded_at !== f.expectedRecordedAt) return err(c, STALE_VERSION, 409);
      if (decision === "confirmed" && again.proforma_id !== null)
        return err(c, USE_ADVANCE_INVOICE, 409, { documentId: again.proforma_id });
      return (await sessionRefusal(c, true)) ?? err(c, STALE_VERSION, 409);
    }
    // M6.5 (L3): the confirmed payment's receipt, in its own batch on the invoices Worker (after the answer).
    if (decision === "confirmed" && row.kind === "payment")
      c.executionCtx.waitUntil(enqueueReceipt(c.env, id));
    // Review part 1, finding 3 (RA-41): whether the credit this confirmation leaves may be an advance (codes only).
    const ra41 =
      decision === "confirmed" && row.kind === "payment" && unallocatedMinor !== null
        ? await ra41OnConfirm(
            db,
            {
              currency: row.currency,
              amountMinor: row.amount_minor,
              unallocatedMinor,
              receivedOn: row.received_on,
            },
            issueDateOf(now),
          )
        : null;
    return c.json({
      ok: true,
      id,
      status: decision,
      allocations: rows.map((r) => ({ documentId: r.documentId, amountMinor: r.amountMinor })),
      unallocatedMinor,
      ra41,
      warnings:
        decision === "confirmed"
          ? receiptWarnings(
              row.received_on,
              docs,
              rows.map((r) => r.documentId),
            )
          : [],
    });
  })

  // ---- withdraw (Owner, fresh code; L7) ----
  .post("/:id/withdraw", param(idParam), body(withdrawPaymentBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const row = await db.prepare(PAYMENT_READ_SQL).bind(id).first<PaymentRow>();
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.status !== "confirmed") return err(c, PAYMENT_NOT_CONFIRMED, 409);
    // M6.2 (L7): a gateway payment is never withdrawn (refunds are M6.5).
    if (row.provider !== "manual") return err(c, gatewayPaymentOf(row.provider), 409);
    // L23.2: a payment that stands for an M5.2 advance receipt has a tax invoice issued on it; a credit note is the correction.
    if (row.advance_receipt_id !== null) return err(c, PAYMENT_ADVANCE_BACKED, 409);
    if (row.client_gone === 1) return err(c, CLIENT_GONE, 409);
    const now = Date.now();
    let done = false;
    try {
      done = await mutate(c, {
        main: withdrawPaymentStatement(db, { paymentId: id, now, sessionId: u.sessionId, reason: f.reason }),
        action: "payment.withdraw",
        entityType: "payment",
        entityId: id,
        // The reason's text is the owner's own words and stays in the payment row; the audit row holds only its length.
        summary: {
          paymentId: id,
          clientId: row.client_id,
          kind: row.kind,
          currency: row.currency,
          amountMinor: row.amount_minor,
          reasonLength: f.reason.length,
        },
        side: (g) => [
          recomputeStatement(db, { paymentIds: [id] }, now, g),
          // M6.5 (L10): the payment's receipt, if it has one, is voided in the same batch (reason `payment_withdrawn`; no client email).
          receiptVoidStatement(db, { paymentId: id, now }, g),
          ledgerResultStatement(db, { paymentIds: [id] }),
        ],
      });
    } catch (e) {
      if (!refusedWith(e, LEDGER_REFUSED)) throw e;
      return err(c, LEDGER_CHANGED, 409);
    }
    if (!done) {
      const again = await db.prepare(PAYMENT_READ_SQL).bind(id).first<PaymentRow>();
      if (!again) return err(c, NOT_FOUND, 404);
      if (again.status !== "confirmed") return err(c, PAYMENT_NOT_CONFIRMED, 409);
      if (again.client_gone === 1) return err(c, CLIENT_GONE, 409);
      // M6.5 (L10, review fix 2): a payment with a refund that has not failed is never withdrawn (the WHERE's `NO_LIVE_REFUND_SQL`).
      if (await liveRefundOf(db, id)) return err(c, REFUNDS_EXIST, 409);
      return (await sessionRefusal(c, true)) ?? err(c, STALE_VERSION, 409);
    }
    return c.json({ ok: true, id, status: "withdrawn" });
  })

  // ---- the proof (L10, L11; OPEN (08-C RB-05): which document proves a services export was realised: free-text type plus the file) ----
  .put("/:id/proof", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const u = actor(c);
    const head = uploadHead(c);
    if (head instanceof Response) return head;
    let meta: { kind: string; ref?: string | undefined };
    try {
      const kind = c.req.header("X-Proof-Kind");
      const ref = c.req.header("X-Proof-Ref");
      const parsed = proofMeta.safeParse({
        kind: kind === undefined ? undefined : decodeURIComponent(kind),
        ...(ref === undefined ? {} : { ref: decodeURIComponent(ref) }),
      });
      if (!parsed.success) return err(c, BAD_REQUEST, 400);
      meta = parsed.data;
    } catch {
      return err(c, BAD_REQUEST, 400);
    }
    const row = await c.env.DB.prepare(PAYMENT_READ_SQL).bind(id).first<PaymentRow>();
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.client_gone === 1) return err(c, CLIENT_GONE, 409);
    if (row.proof_r2_key !== null) return err(c, PROOF_ALREADY_SET, 409);
    if (row.status !== "pending_verification" && row.status !== "confirmed")
      return err(c, PAYMENT_CLOSED, 409);
    const stored = await streamToDocs(c, head, `payments/${id}/proof`);
    if (stored instanceof Response) return stored;
    const now = Date.now();
    let done = false;
    try {
      done = await mutate(c, {
        main: proofStatement(c.env.DB, {
          paymentId: id,
          kind: meta.kind,
          ref: meta.ref ?? null,
          r2Key: stored.key,
          sha256: head.sha,
          mime: stored.mime,
          sessionId: u.sessionId,
          now,
        }),
        action: "payment.proof",
        entityType: "payment",
        entityId: id,
        summary: { paymentId: id, clientId: row.client_id, size: head.len, mime: stored.mime },
      });
    } catch (e) {
      if (stored.created) await dropDoc(c.env, stored.key, "row not written");
      throw e;
    }
    if (!done) {
      const again = await c.env.DB.prepare(PAYMENT_READ_SQL).bind(id).first<PaymentRow>();
      // Never remove the object a row points at (the same bytes land on the same key).
      if (stored.created && again?.proof_r2_key !== stored.key)
        await dropDoc(c.env, stored.key, "row not written");
      if (!again) return err(c, NOT_FOUND, 404);
      if (again.client_gone === 1) return err(c, CLIENT_GONE, 409);
      if (again.proof_r2_key !== null) return err(c, PROOF_ALREADY_SET, 409);
      if (again.status !== "pending_verification" && again.status !== "confirmed")
        return err(c, PAYMENT_CLOSED, 409);
      return (await sessionRefusal(c, false)) ?? err(c, STALE_VERSION, 409);
    }
    return c.json({
      ok: true,
      id,
      proof: { kind: meta.kind, ref: meta.ref ?? null, mime: stored.mime, sha256: head.sha },
    });
  })

  .get("/:id/proof", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const row = await c.env.DB.prepare("SELECT proof_r2_key, proof_mime FROM payments WHERE id = ?1")
      .bind(id)
      .first<{ proof_r2_key: string | null; proof_mime: string | null }>();
    if (!row?.proof_r2_key || !row.proof_mime) return err(c, NOT_FOUND, 404);
    const res = await docDownload(
      c,
      row.proof_r2_key,
      row.proof_mime,
      `proof-${id}.${extOfMime(row.proof_mime)}`,
    );
    return res ?? err(c, NOT_FOUND, 404);
  })

  // ---- the TDS certificate (L19: set once; "Certificate awaited" until then) ----
  .post("/:id/tds-certificate", param(idParam), body(tdsCertificateBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const row = await c.env.DB.prepare(PAYMENT_READ_SQL).bind(id).first<PaymentRow>();
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.kind !== "tds") return err(c, NOT_TDS, 409);
    if (row.tds_certificate_no !== null) return err(c, CERTIFICATE_ALREADY_SET, 409);
    if (row.status !== "pending_verification" && row.status !== "confirmed")
      return err(c, PAYMENT_CLOSED, 409);
    if (row.client_gone === 1) return err(c, CLIENT_GONE, 409);
    if (f.certificateOn > issueDateOf(Date.now())) return err(c, BAD_REQUEST, 400);
    const done = await mutate(c, {
      main: tdsCertificateStatement(c.env.DB, {
        paymentId: id,
        certificateNo: f.certificateNo,
        certificateOn: f.certificateOn,
        sessionId: u.sessionId,
        now: Date.now(),
      }),
      action: "payment.tds_certificate",
      entityType: "payment",
      entityId: id,
      summary: { paymentId: id, clientId: row.client_id, certificateOn: f.certificateOn },
    });
    if (!done) {
      const again = await c.env.DB.prepare(PAYMENT_READ_SQL).bind(id).first<PaymentRow>();
      if (!again) return err(c, NOT_FOUND, 404);
      if (again.tds_certificate_no !== null) return err(c, CERTIFICATE_ALREADY_SET, 409);
      if (again.client_gone === 1) return err(c, CLIENT_GONE, 409);
      if (again.status !== "pending_verification" && again.status !== "confirmed")
        return err(c, PAYMENT_CLOSED, 409);
      return (await sessionRefusal(c, false)) ?? err(c, STALE_VERSION, 409);
    }
    return c.json({ ok: true, id, certificateNo: f.certificateNo, certificateOn: f.certificateOn });
  });

/**
 * The batch was refused by the allocation bound or the post-condition (another payment, credit or note landed between the read and the write): the plan is
 * worked out again on what is stored now, so the answer says which invoice no longer takes the amount; when it now fits, the ledger moved under it.
 */
async function explainPlan(
  c: Ctx,
  p: {
    id: string;
    clientId: string;
    currency: string;
    kind: "payment" | "tds";
    amountMinor: number;
    requested: readonly AllocationRequest[];
  },
): Promise<Response> {
  const db = c.env.DB;
  const [docsR, netR] = await db.batch([
    db.prepare(LEDGER_DOCS_SQL).bind(JSON.stringify(p.requested.map((r) => r.documentId))),
    // What the payment already uses: held net on documents plus its refunds not failed (M6.5 L35; the plan's `allocatedMinor`).
    db.prepare(`SELECT ${paymentNetSql("?1")} + ${paymentRefundedSql("?1")} AS net`).bind(p.id),
  ]);
  const docs = (docsR?.results ?? []) as DocRow[];
  const plan = planAllocations(
    {
      clientId: p.clientId,
      currency: p.currency,
      kind: p.kind,
      amountMinor: p.amountMinor,
      allocatedMinor: (netR?.results[0] as { net: number } | undefined)?.net ?? 0,
    },
    p.requested,
    docs.map(ledgerDocOf),
  );
  return plan.ok ? err(c, LEDGER_CHANGED, 409) : planRefusal(c, plan.code, plan.documentId, docs);
}
