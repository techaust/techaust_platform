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
  type LedgerDoc,
  planAllocations,
  receiptMonthWarning,
} from "@techaust/core/ledger";
import {
  paymentsListQuery,
  proofMeta,
  recordPaymentBody,
  tdsCertificateBody,
  verifyPaymentBody,
  withdrawPaymentBody,
} from "@techaust/core/payment-schemas";
import { decide } from "@techaust/core/permissions";
import {
  type AllocationRow,
  allocationStatements,
  decideApprovalStatements,
  ledgerResultStatement,
  PAYMENT_REFERENCE_SEEN_SQL,
  paymentApprovalStatements,
  proofStatement,
  recomputeStatement,
  recordPaymentStatement,
  tdsCertificateStatement,
  verifyPaymentStatement,
  withdrawPaymentStatement,
} from "@techaust/db/ledger";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type AppEnv, actor, BAD_REQUEST, type Ctx, err, mutate, NOT_FOUND } from "./context.ts";
import { docDownload, dropDoc, extOfMime, streamToDocs, uploadHead } from "./docs-upload.ts";
import { body, idParam, param, query, refusedWith, STALE_VERSION } from "./http.ts";
import { decodeCursor, encodeCursor } from "./keyset.ts";
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
  PROOF_ALREADY_SET,
  paymentLink,
  RECEIVED_ON_FUTURE,
  REFERENCE_INVALID,
  REJECT_REASON_REQUIRED,
  referenceSeen,
  TDS_NOT_ALLOWED,
  TDS_NOT_WHOLE,
  TOO_MANY,
  USE_ADVANCE_INVOICE,
} from "./payment-messages.ts";
import { CLIENT_GONE } from "./quote-model.ts";

// ---- reads ----------------------------------------------------------------------------------------------------------------------------------------------

const PAYMENT_COLS = `p.id, p.client_id, c.code AS client_code, c.display_name AS client_name, (c.anonymised_at IS NOT NULL) AS client_gone, p.kind, p.provider, p.status,
  p.currency, p.amount_minor, p.charges_minor, p.received_on, p.mode, p.reference_norm, p.inr_received_minor, p.requested_allocations, p.tds_section, p.tds_rate_bp,
  p.tds_certificate_no, p.tds_certificate_on, p.proof_kind, p.proof_ref, p.proof_r2_key, p.proof_sha256, p.proof_mime, p.advance_receipt_id, p.note,
  p.recorded_by, (SELECT name FROM staff_users WHERE id = p.recorded_by) AS recorded_by_name, p.recorded_at, p.verified_by,
  (SELECT name FROM staff_users WHERE id = p.verified_by) AS verified_by_name, p.verified_at, p.decision_note, p.withdrawn_by, p.withdrawn_at, p.withdraw_reason`;

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
};

/** One payment by id, with its client. */
export const PAYMENT_READ_SQL = `SELECT ${PAYMENT_COLS} FROM payments p JOIN clients c ON c.id = p.client_id WHERE p.id = ?1`;
/** The allocation rows of one payment, with each document's number (the entry's detail). */
export const PAYMENT_ALLOCATIONS_SQL = `SELECT a.id, a.document_id, d.number_display, d.type, a.kind, a.amount_minor, a.created_at
   FROM payment_allocations a INDEXED BY payment_allocations_payment JOIN documents d ON d.id = a.document_id WHERE a.payment_id = ?1 ORDER BY a.created_at, a.id`;
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
}): { sql: string; key: "received_on" | "recorded_at" | "rowid" } {
  const where: string[] = [];
  let at = 1;
  const next = () => `?${at++}`;
  let key: "received_on" | "recorded_at" | "rowid";
  let from: string;
  let order: string;
  let cursor = "";
  if (f.client) {
    from = "payments p INDEXED BY payments_client";
    where.push(`p.client_id = ${next()}`);
    key = "received_on";
  } else if (f.status === "pending_verification") {
    from = "payments p INDEXED BY payments_pending";
    key = "recorded_at";
  } else if (f.status === "confirmed") {
    from = "payments p INDEXED BY payments_confirmed";
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
      const balance = d ? Math.max(0, d.total_minor - d.paid_minor - d.credited_minor - d.tds_minor) : 0;
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

/** The session state behind a refused batch, read once: signed out (401), no fresh code (403), else null. */
async function sessionRefusal(c: Ctx, needsStepUp: boolean): Promise<Response | null> {
  const u = actor(c);
  const t = Date.now();
  const s = await c.env.DB.prepare(
    "SELECT (idle_expires_at > ?2 AND abs_expires_at > ?2) AS live, step_up_until FROM staff_sessions WHERE id = ?1 AND revoked_at IS NULL",
  )
    .bind(u.sessionId, t)
    .first<{ live: number; step_up_until: number | null }>();
  if (s?.live !== 1) return err(c, { code: "unauthenticated", message: "Sign in" }, 401);
  if (needsStepUp && (s.step_up_until === null || s.step_up_until <= t))
    return err(
      c,
      { code: "step_up_required", message: "Confirm with a fresh code from your authenticator first" },
      403,
    );
  return null;
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
    const [p, a] = await c.env.DB.batch([
      c.env.DB.prepare(PAYMENT_READ_SQL).bind(id),
      c.env.DB.prepare(PAYMENT_ALLOCATIONS_SQL).bind(id),
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
    return c.json({ payment: paymentView(row), allocations });
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
    const [clientR, existsR, seenR, docsR] = await db.batch([
      db
        .prepare(
          "SELECT id, display_name, currency, country, gst_status, anonymised_at FROM clients WHERE id = ?1",
        )
        .bind(f.clientId),
      db.prepare("SELECT 1 AS x FROM payments WHERE id = ?1").bind(f.id),
      db.prepare(PAYMENT_REFERENCE_SEEN_SQL).bind(referenceNorm ?? ""),
      db.prepare(LEDGER_DOCS_SQL).bind(JSON.stringify(requested.map((r) => r.documentId))),
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
        },
        status: 201,
        side: (g) =>
          confirmed
            ? [
                ...allocationStatements(db, rows, u.id, now, g),
                recomputeStatement(db, { paymentIds: [f.id] }, now, g),
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
              ),
      });
    } catch (e) {
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
    return c.json(
      {
        ok: true,
        id: f.id,
        status: confirmed ? "confirmed" : "pending_verification",
        allocations: confirmed ? plan.allocations : [],
        requestedAllocations: confirmed ? [] : requested,
        /** 07-ZH line 9: what the invoices do not take is kept as the client's credit (ADM-PAY-06). */
        unallocatedMinor: confirmed ? plan.unallocatedMinor : null,
        ...(confirmed ? {} : { approvalId }),
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
    if (decision === "rejected" && f.note === undefined) return err(c, REJECT_REASON_REQUIRED, 400);
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
      return (await sessionRefusal(c, true)) ?? err(c, STALE_VERSION, 409);
    }
    return c.json({
      ok: true,
      id,
      status: decision,
      allocations: rows.map((r) => ({ documentId: r.documentId, amountMinor: r.amountMinor })),
      unallocatedMinor,
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
    db
      .prepare(
        "SELECT coalesce(sum(CASE kind WHEN 'allocate' THEN amount_minor ELSE -amount_minor END), 0) AS net FROM payment_allocations WHERE payment_id = ?1",
      )
      .bind(p.id),
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
