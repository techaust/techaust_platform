// Refunds (M6.5; ADM-PAY-08, ADM-PAY-11, ADM-INV-09, ADM-INV-11; run file C, L1, L2, L6 as changed by L33, L7, L8, L15, L37, L40), in the finance Worker:
//   POST /payments/:id/refunds          the Owner (step-up, `refunds.issue`) refunds: from credit, from an invoice's excess (after its credit note, Q1 A), or a
//                                       pending gateway payment in full (L33); through the payment's gateway, by our bank transfer (manual), or recorded after
//                                       the fact (a refund made in the gateway's dashboard, or a lost dispute: L7, L40);
//   GET  /payments/:id/refunds          a payment's refunds (`refunds.read`);
//   GET  /refunds?status=&clientId=&cursor=  the Refunds tab (B4: or one client's), keyset pages of 50 (`refunds.read`);
//   POST /refunds/:id/retry             "Try again": the gateway is asked first (L37), then posted again only when it shows none;
//   POST /refunds/:id/cancel            a refund still `requested` is failed by the Owner only after the gateway shows none for our id.
// A refund, step by step (C): (1) read, then core `planRefund` (the codes the screens explain); the export tick (RB-43); the live guard BEFORE anything is written
// (review fix 3: a blocked gateway is never called and nothing is written); (2) batch 1 through `mutate`: the refund row (every guard in its WHERE), its audit
// row, the release of exactly the amount then its set-once link and the recompute (from a document), the pending payment's rejection (a pending source recorded
// after the fact), then `ledger_result` and `refund_result` unguarded; (3) the gateway's refund with our id as its idempotency key, then batch 2 by its answer;
// a 4xx failure leaves the money as credit (L8); a network failure leaves the row `requested` for the sweep (202).
// Amounts are integer minor units; ids and codes only in logs and audit summaries.
import { istDate, toIsoDate } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import { normaliseReference } from "@techaust/core/invoices";
import { refundBody, refundInrBody } from "@techaust/core/payment-schemas";
import { decide } from "@techaust/core/permissions";
import { planRefund, refundExportWarning } from "@techaust/core/refunds";
import {
  PAYMENT_REFUNDS_SQL,
  pendingRefundedRejectStatement,
  REFUNDS_LIST_BY_CLIENT_SQL,
  REFUNDS_LIST_BY_STATUS_SQL,
  REFUNDS_LIST_SQL,
  refundBatchResult,
  refundCancelStatement,
  refundInrStatement,
  refundInsertStatement,
  refundSideStatements,
} from "@techaust/db/refunds";
import { paymentNetSql, paymentRefundedSql } from "@techaust/db/sql-rules";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { CLIENT_GONE } from "./anonymised.ts";
import { type AppEnv, actor, BAD_REQUEST, err, FORBIDDEN, mutate, NOT_FOUND } from "./context.ts";
import { refundGwOf } from "./gateway/refund-gw.ts";
import { body, idParam, param, query, STALE_VERSION } from "./http.ts";
import { decodeCursor, encodeCursor } from "./keyset.ts";
import {
  creditNoteFactsOf,
  creditRefundFactsOf,
  DEADLINE_DOC_COLUMNS,
  type DeadlineDoc,
  taxOf,
} from "./refund-facts.ts";
import {
  applyGatewayRefund,
  checkRefund,
  readRefund,
  refundIdleAt,
  retryAfterSeconds,
} from "./refund-flow.ts";
import type { StoredSetting } from "./settings-cache.ts";

/** The refusals the dialog explains (staff lines in the run file; the codes are the API's). */
const E = (code: string, message: string) => ({ code, message });
const REFUSALS = {
  exceeds_refundable: E("exceeds_refundable", "That is more than this payment can give back"),
  exceeds_holding: E("exceeds_holding", "That is more than this payment holds on the invoice"),
  credit_note_needed: E("credit_note_needed", "This refund needs a credit note first"),
  payment_not_confirmed: E("payment_not_confirmed", "Only confirmed money can be refunded this way"),
  payment_not_pending: E("payment_not_pending", "This payment isn't waiting to be confirmed"),
  pending_gateway_only: E(
    "pending_gateway_only",
    "A pending online payment goes back through its own gateway",
  ),
  pending_full_only: E("pending_full_only", "A pending online payment is refunded in full"),
  refund_in_progress: E("refund_in_progress", "Another refund of this payment is still in progress"),
  not_gateway_payment: E("not_gateway_payment", "This payment didn't come through a gateway"),
  gateway_refund_window: E("gateway_refund_window", "Razorpay refunds a payment only within 6 months"),
  document_mismatch: E("document_mismatch", "That invoice can't be refunded from this payment"),
  // Review part 1, finding 9 (builder's drafts for the lead, staff-only).
  inr_already_set: E("inr_already_set", "The INR amount of this refund is already recorded"),
  inr_not_applicable: E(
    "inr_not_applicable",
    "An INR amount is recorded only for a refund in another currency once it has gone out",
  ),
  // Review part 1, finding 6 (builder's draft for the lead, staff-only).
  credit_note_mismatch: E(
    "credit_note_mismatch",
    "That credit note isn't an issued credit note of this invoice",
  ),
  currency_mismatch: E("currency_mismatch", "The invoice is in another currency"),
  not_refundable_kind: E("not_refundable_kind", "A TDS entry is never refunded"),
  invalid_amount: E("amount_invalid", "Enter an amount above zero"),
  paid_to_invalid: E(
    "paid_to_invalid",
    "A card or wallet payment is refunded by bank transfer only to another account in the payer's own name",
  ),
  day_invalid: E("day_invalid", "Pick a day that isn't in the future"),
  export_refund_unconfirmed: E(
    "export_refund_unconfirmed",
    "Confirm that the bank approved the lower amount first",
  ),
  refund_exists: E("refund_exists", "This refund was already recorded"),
  capture_pending: E(
    "capture_pending",
    "PayPal is still holding this payment. Refund it once PayPal completes it",
  ),
  gateway_unavailable: E("gateway_unavailable", "The gateway can't be reached from here"),
  live_not_allowed: E("live_not_allowed", "Live payments are switched off"),
  gateway_refused: E("gateway_refused", "The gateway refused the refund"),
  gateway_error: E("gateway_error", "The gateway didn't answer. Try again"),
  refund_found: E("refund_found", "The gateway already has this refund"),
  not_cancellable: E("not_cancellable", "Only a refund the gateway never received can be cancelled"),
  // L44 (early check 2, finding 1b; builder's draft for the lead, staff-only): the screen disables the buttons for `retryAfterS`.
  too_soon: E("too_soon", "The gateway may still be answering. Try again in a few minutes"),
  // Early check 2, finding 6 (builder's draft for the lead, staff-only): a refund recorded as made in the gateway must be there, on this payment, for this amount.
  outside_not_at_gateway: E(
    "outside_not_at_gateway",
    "The gateway shows no completed refund with that id for this payment and amount",
  ),
} as const;

const isOpen = (r: { status: string }) => r.status === "requested" || r.status === "processing";
/** 409 `too_soon` with the seconds until the refund is idle (L44). */
const tooSoon = (c: Parameters<typeof err>[0], r: Parameters<typeof retryAfterSeconds>[0], now: number) =>
  err(c, REFUSALS.too_soon, 409, { retryAfterS: retryAfterSeconds(r, now) });

/** The payment as the refund reads it (one row), with its client, what it holds net, its refunds that have not failed and whether one is open. */
const PAYMENT_SQL = `SELECT p.id, p.client_id, p.kind, p.status, p.provider, p.currency, p.amount_minor, p.received_on, p.provider_payment_id, p.checkout_id,
     k.anonymised_at, k.gst_status, ${paymentNetSql("p.id")} AS net, ${paymentRefundedSql("p.id")} AS refunded,
     EXISTS (SELECT 1 FROM payment_refunds o INDEXED BY payment_refunds_payment WHERE o.payment_id = p.id AND o.status IN ('requested', 'processing')) AS open_refund,
     (SELECT cs.status FROM checkout_sessions cs WHERE cs.id = p.checkout_id) AS checkout_status
   FROM payments p JOIN clients k ON k.id = p.client_id WHERE p.id = ?1`;
/** An invoice's issued credit notes, newest first (`documents_parent`). */
const ISSUED_NOTES_OF = (col: string) =>
  `FROM documents cn INDEXED BY documents_parent WHERE cn.parent_id = d.id AND cn.type = 'credit_note' AND cn.frozen_at IS NOT NULL ORDER BY cn.frozen_at DESC, cn.id DESC LIMIT 1) AS ${col}`;
/**
 * The invoice a refund draws on, with what THIS payment holds there (`?2`), and its newest issued credit note (review part 1, finding 6: the refund of its excess
 * is linked to it, RA-40).
 */
const DOC_SQL = `SELECT d.id, d.client_id, d.currency, d.type, d.status, d.frozen_at, d.total_minor, d.paid_minor, d.credited_minor, d.tds_minor, d.updated_at,
     json_extract(d.header_extras, '$.advance') IS NOT NULL AS is_advance, ${paymentNetSql("?2", "d.id")} AS holding, ${DEADLINE_DOC_COLUMNS},
     (SELECT cn.id ${ISSUED_NOTES_OF("note_id")}, (SELECT cn.number_display ${ISSUED_NOTES_OF("note_number")}
   FROM documents d WHERE d.id = ?1`;
/** Is `?1` an issued credit note of the invoice `?2` (the INSERT's WHERE holds it again)? */
const NOTE_OF_SQL =
  "SELECT 1 AS ok FROM documents cn WHERE cn.id = ?1 AND cn.type = 'credit_note' AND cn.parent_id = ?2 AND cn.frozen_at IS NOT NULL";
const TAX_SQL = "SELECT value, version FROM settings WHERE key = 'tax'";

type PayRow = {
  id: string;
  client_id: string;
  kind: string;
  status: string;
  provider: string;
  currency: "INR" | "USD";
  amount_minor: number;
  received_on: string;
  provider_payment_id: string | null;
  checkout_id: string | null;
  anonymised_at: number | null;
  gst_status: string;
  net: number;
  refunded: number;
  open_refund: number;
  checkout_status: string | null;
};
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
  updated_at: number;
  is_advance: number;
  holding: number;
  note_id: string | null;
  note_number: string | null;
} & DeadlineDoc;

/**
 * Lead's answer to B2 Q3: the tax facts the refund dialog shows, as codes and days (refund-facts.ts): RA-41 for a refund from credit (the credit may be an
 * advance, refunded in a later GSTR-3B period), RA-40 for an invoice whose excess a refund draws on (the credit note's last day and whether one is still possible).
 */
function refundFacts(
  p: Pick<PayRow, "currency" | "amount_minor" | "net" | "refunded" | "received_on">,
  d: DocRow | undefined,
  taxRow: StoredSetting | undefined,
  today: string,
) {
  const tax = taxOf(taxRow);
  return {
    ra41: creditRefundFactsOf(
      {
        currency: p.currency,
        freeMinor: Math.max(0, p.amount_minor - p.net - p.refunded),
        netMinor: p.net,
        receivedOn: p.received_on,
      },
      tax,
      today,
    ),
    creditNote: d ? creditNoteFactsOf(d, tax, today) : null,
    // Review part 1, finding 6: the credit note the refund of this invoice's excess is linked to (the dialog sends its id back).
    issuedCreditNote: d?.note_id ? { id: d.note_id, number: d.note_number } : null,
  };
}

const istDay = (now: number) => toIsoDate(istDate(now));
const factsQuery = z.object({ documentId: z.optional(z.string().check(z.minLength(1), z.maxLength(64))) });
const listQuery = z.object({
  status: z.optional(z.enum(["requested", "processing", "succeeded", "failed"])),
  /** B4: one client's refunds (the client Overview's "Refund in progress"), with or without `status`. */
  clientId: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
  cursor: z.optional(z.string().check(z.maxLength(200))),
});

/** The refund as the screens read it. */
const view = (r: NonNullable<Awaited<ReturnType<typeof readRefund>>>) => ({
  id: r.id,
  paymentId: r.payment_id,
  clientId: r.client_id,
  documentId: r.document_id,
  creditNoteId: r.credit_note_id,
  provider: r.provider,
  origin: r.origin,
  status: r.status,
  mode: r.mode,
  paidTo: r.paid_to,
  reasonCode: r.reason_code,
  currency: r.currency,
  amountMinor: r.amount_minor,
  // Review part 1, finding 9: the INR the bank debited for a refund in another currency (null until the Owner records it).
  inrRefundedMinor: r.inr_refunded_minor,
  referenceNorm: r.reference_norm,
  paidOn: r.paid_on,
  providerRefundId: r.provider_refund_id,
  failureCode: r.failure_code,
  requestedAt: r.requested_at,
  // B4 (designer Q1, L44, L46): the last check's instant (UTC ms, null before any), so the screens show when "Try again" and Cancel open before any press.
  lastAttemptAt: r.last_attempt_at,
  attempts: r.attempts,
  settledOn: r.settled_on,
  updatedAt: r.updated_at,
});

export const refunds = new Hono<AppEnv>()
  // A payment's refunds, and the facts the refund dialog shows (`facts`: RA-41 for its credit; RA-40 for `?documentId`, the invoice the refund would draw on).
  .get("/:id/refunds", param(idParam), query(factsQuery), async (c) => {
    const { id } = c.req.valid("param");
    const q = c.req.valid("query");
    const db = c.env.DB;
    const [refundsR, payR, docR, taxR] = await db.batch([
      db.prepare(PAYMENT_REFUNDS_SQL).bind(id),
      db.prepare(PAYMENT_SQL).bind(id),
      db.prepare(DOC_SQL).bind(q.documentId ?? "", id),
      db.prepare(TAX_SQL),
    ]);
    const p = payR?.results[0] as PayRow | undefined;
    const d = q.documentId ? (docR?.results[0] as DocRow | undefined) : undefined;
    // another client's invoice is no fact of this payment's
    const doc = d && p && d.client_id === p.client_id ? d : undefined;
    const rows = (refundsR?.results ?? []) as NonNullable<Awaited<ReturnType<typeof readRefund>>>[];
    return c.json({
      items: rows.map(view),
      facts: p
        ? refundFacts(p, doc, taxR?.results[0] as StoredSetting | undefined, istDay(Date.now()))
        : null,
    });
  })
  .post("/:id/refunds", param(idParam), body(refundBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const now = Date.now();
    const today = istDay(now);
    const [payR, docR, exR, taxR, noteR] = await db.batch([
      db.prepare(PAYMENT_SQL).bind(id),
      db.prepare(DOC_SQL).bind(f.documentId ?? "", id),
      db.prepare("SELECT id, payment_id FROM payment_refunds WHERE id = ?1").bind(f.id),
      db.prepare(TAX_SQL),
      db.prepare(NOTE_OF_SQL).bind(f.creditNoteId ?? "", f.documentId ?? ""),
    ]);
    const p = payR?.results[0] as PayRow | undefined;
    if (!p) return err(c, NOT_FOUND, 404);
    // A replay of the same dialog (its id is the idempotency key): the refund as it stands.
    const existing = exR?.results[0] as { id: string; payment_id: string } | undefined;
    if (existing) {
      if (existing.payment_id !== id) return err(c, REFUSALS.refund_exists, 409);
      const r = await readRefund(db, f.id);
      return c.json({ refund: r ? view(r) : null });
    }
    if (p.anonymised_at !== null) return err(c, CLIENT_GONE, 409);
    const d = f.documentId ? (docR?.results[0] as DocRow | undefined) : undefined;
    if (f.documentId && !d) return err(c, REFUSALS.document_mismatch, 409);
    if (d && f.expectedUpdatedAt !== undefined && f.expectedUpdatedAt !== d.updated_at)
      return err(c, STALE_VERSION, 409);
    // Review part 1, finding 6 (RA-40): a refund of an invoice's excess names the credit note that made it: the one the dialog sent (an issued credit note of
    // that invoice, held again in the INSERT's WHERE), else the invoice's newest issued one.
    if (f.creditNoteId !== undefined && !noteR?.results[0]) return err(c, REFUSALS.credit_note_mismatch, 409);
    const creditNoteId = f.from === "document" ? (f.creditNoteId ?? d?.note_id ?? null) : null;
    // B2 Q3: the RA-40 and RA-41 facts, from the payment and the invoice as read BEFORE this refund (what the dialog showed).
    const facts = refundFacts(p, d, taxR?.results[0] as StoredSetting | undefined, today);
    const way = f.manual ? "manual" : f.outside ? "outside" : "gateway";
    const plan = planRefund({
      payment: {
        id: p.id,
        clientId: p.client_id,
        currency: p.currency,
        kind: p.kind,
        status: p.status,
        provider: p.provider,
        amountMinor: p.amount_minor,
        netAllocatedMinor: p.net,
        refundedMinor: p.refunded,
        receivedOn: p.received_on,
        hasOpenRefund: p.open_refund === 1,
      },
      from: f.from,
      via: way === "manual" ? "manual" : "gateway",
      amountMinor: f.amountMinor,
      doc: d
        ? {
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
            isAdvanceInvoice: d.is_advance === 1,
          }
        : undefined,
      holdingMinor: d?.holding,
      today,
      origin: f.outside ? f.outside.origin : "owner",
      paidTo: f.manual?.paidTo,
      settledOn: f.manual?.paidOn ?? f.outside?.settledOn,
    });
    if (!plan.ok) {
      const e = REFUSALS[plan.code];
      return err(
        c,
        e,
        plan.code === "invalid_amount" || plan.code === "paid_to_invalid" || plan.code === "day_invalid"
          ? 400
          : 409,
        {
          ...(plan.refundableMinor === undefined ? {} : { refundableMinor: plan.refundableMinor }),
          ...(plan.holdingMinor === undefined ? {} : { holdingMinor: plan.holdingMinor }),
          ...(plan.excessMinor === undefined ? {} : { excessMinor: plan.excessMinor }),
          ...(plan.noteReason ? { noteReason: plan.noteReason } : {}),
          // RA-40: the credit note this refund needs first, with its last day (`open: false`: none is possible any more).
          // (`details` are flat values: the same facts as `facts.creditNote` of `GET /payments/:id/refunds?documentId=`, prefixed.)
          ...(plan.code === "credit_note_needed" && facts.creditNote
            ? {
                creditNoteLastDay: facts.creditNote.lastDay,
                creditNoteOpen: facts.creditNote.open,
                creditNoteSupplyFy: facts.creditNote.supplyFy,
                creditNoteBasis: facts.creditNote.basis,
                creditNotePeriod: facts.creditNote.period,
                creditNoteReturnBy: facts.creditNote.returnBy,
                creditNoteWarnFrom: facts.creditNote.deadlineWarnFrom,
              }
            : {}),
        },
      );
    }
    // RB-43 (Settled by the lead on the safest reading, 2026-11-03 (08-C RB-43)): money of a client outside India, or an export invoice's excess, goes back only
    // once the Owner ticks that the AD bank was asked for the Reg. 6 reduction; on every source, the pending one included (early check 1, part 2 item 5).
    if (
      refundExportWarning({ docType: d?.type ?? null, clientOverseas: p.gst_status === "overseas" }) &&
      f.confirmExport !== true
    )
      return err(c, REFUSALS.export_refund_unconfirmed, 409);
    // The live guard and the gateway, before anything is written (review fix 3): a blocked gateway is never called.
    const gw = way === "gateway" ? await refundGwOf(c.env, p.provider) : null;
    if (way === "gateway") {
      if (!gw || gw.blocked === "unconfigured") return err(c, REFUSALS.gateway_unavailable, 503);
      if (gw.blocked === "live_not_allowed") return err(c, REFUSALS.live_not_allowed, 503);
      if (!p.provider_payment_id) return err(c, REFUSALS.not_gateway_payment, 409);
      // PayPal can't refund a capture it still holds (Step 0, part 2 item 6).
      if (p.provider === "paypal" && p.checkout_status === "capture_pending")
        return err(c, REFUSALS.capture_pending, 409);
    }
    // Early check 2, finding 6: a refund recorded as made in the gateway's dashboard (origin `outside`) must be there: the same payment, the same amount,
    // completed. Checked whenever the gateway is set up and not blocked (a live key with the flag false is never called); a lost dispute (`chargeback`) is
    // recorded as entered (its id is the dispute's, not a refund's).
    if (f.outside?.origin === "outside" && p.provider !== "manual" && p.provider_payment_id) {
      const og = await refundGwOf(c.env, p.provider);
      if (og && !og.blocked) {
        const seen = await og.find({
          paymentRef: p.provider_payment_id,
          refundId: f.id,
          refundRef: f.outside.providerRefundId,
        });
        if (!seen.ok) return err(c, REFUSALS.gateway_error, 502);
        const v = seen.value === "unknown" ? null : seen.value;
        if (
          v === null ||
          v.state !== "processed" ||
          v.amountMinor !== f.amountMinor ||
          v.currency !== p.currency ||
          (v.paymentRef !== null && v.paymentRef !== p.provider_payment_id)
        )
          return err(c, REFUSALS.outside_not_at_gateway, 409);
      }
    }
    let referenceNorm: string | null = null;
    if (f.manual) {
      referenceNorm = normaliseReference(f.manual.reference);
      if (referenceNorm === null) return err(c, E("reference_invalid", "Enter the bank's reference"), 400);
    }
    const releaseId = uuidv7();
    const documentId = f.from === "document" ? (f.documentId ?? null) : null;
    const done = await mutate(c, {
      main: refundInsertStatement(db, {
        id: f.id,
        paymentId: id,
        from: f.from,
        documentId,
        creditNoteId,
        amountMinor: f.amountMinor,
        reasonCode: f.reasonCode,
        note: f.note ?? null,
        way: f.manual
          ? {
              kind: "manual",
              mode: f.manual.mode,
              referenceNorm: referenceNorm as string,
              paidOn: f.manual.paidOn,
              paidTo: f.manual.paidTo,
            }
          : f.outside
            ? {
                kind: "outside",
                origin: f.outside.origin,
                providerRefundId: f.outside.providerRefundId,
                settledOn: f.outside.settledOn,
              }
            : { kind: "gateway" },
        sessionId: u.sessionId,
        now,
        today,
      }),
      action: "refund.issue",
      entityType: "refund",
      entityId: f.id,
      summary: {
        refundId: f.id,
        paymentId: id,
        from: f.from,
        way,
        amountMinor: f.amountMinor,
        currency: p.currency,
        ...(documentId ? { documentId } : {}),
        ...(creditNoteId ? { creditNoteId } : {}),
        // Review part 1, finding 10 (RB-24): the payer's written request, recorded on the server with a refund to their own other account.
        ...(f.manual ? { paidTo: f.manual.paidTo, writtenRequest: f.manual.writtenRequest === true } : {}),
      },
      side: (g) => [
        ...refundSideStatements(
          db,
          { refundId: f.id, paymentId: id, documentId, amountMinor: f.amountMinor, releaseId, now },
          g,
        ),
        // L33: a pending payment refunded in full outside the admin is rejected in the same batch (early check 1, finding 4, part 2 item 1).
        ...(f.from === "pending" && f.outside
          ? [pendingRefundedRejectStatement(db, { refundId: f.id, now }, g)]
          : []),
        ...refundBatchResult(db, { paymentId: id, documentId, refundId: f.id }),
      ],
    });
    if (!done) {
      // Nothing was written: say why, from what is stored now.
      if (decide(u.role, "refunds.issue") === "deny") return err(c, FORBIDDEN, 403);
      const again = (await db.prepare(PAYMENT_SQL).bind(id).first<PayRow>()) as PayRow;
      if (again.anonymised_at !== null) return err(c, CLIENT_GONE, 409);
      if (again.open_refund === 1) return err(c, REFUSALS.refund_in_progress, 409);
      if (await db.prepare("SELECT 1 FROM payment_refunds WHERE id = ?1").bind(f.id).first())
        return err(c, REFUSALS.refund_exists, 409);
      return err(c, documentId ? REFUSALS.exceeds_holding : REFUSALS.exceeds_refundable, 409);
    }
    if (way !== "gateway" || !gw || !p.provider_payment_id) {
      const r = await readRefund(db, f.id);
      return c.json({ refund: r ? view(r) : null, facts });
    }
    // (3) the gateway, with our id as its idempotency key; then batch 2 by its answer.
    const answer = await gw.create({
      paymentRef: p.provider_payment_id,
      amountMinor: f.amountMinor,
      refundId: f.id,
      paymentId: id,
    });
    const row = await readRefund(db, f.id);
    if (!row) return err(c, NOT_FOUND, 404);
    if (answer.ok) {
      await applyGatewayRefund(c.env, row, answer.value, Date.now());
      const r = await readRefund(db, f.id);
      return c.json({ refund: r ? view(r) : null, facts });
    }
    if (answer.code === "refused" || answer.code === "not_found") {
      const code = `refused_${answer.status ?? 400}`;
      await applyGatewayRefund(
        c.env,
        row,
        {
          refundRef: "",
          paymentRef: null,
          amountMinor: f.amountMinor,
          currency: p.currency,
          state: "failed",
          ourId: f.id,
          failureCode: code,
        },
        Date.now(),
      );
      return err(c, REFUSALS.gateway_refused, 502, { code });
    }
    // A network failure or an unreadable answer: the row stays `requested` and the sweep (or "Try again") finds it by our id (C step 4).
    return c.json({ refund: view(row), status: "requested", facts }, 202);
  });

/** `/refunds`: the Refunds tab, "Try again" and Cancel. */
export const refundsTab = new Hono<AppEnv>()
  .get("/", query(listQuery), async (c) => {
    const q = c.req.valid("query");
    const cur = q.cursor ? decodeCursor(q.cursor) : null;
    if (q.cursor && !cur) return err(c, BAD_REQUEST, 400);
    const at = cur ? Number(cur.k) : Number.MAX_SAFE_INTEGER;
    const after = cur?.id ?? "";
    const rows = (
      await (q.clientId
        ? c.env.DB.prepare(REFUNDS_LIST_BY_CLIENT_SQL(q.status !== undefined)).bind(
            q.clientId,
            at,
            after,
            ...(q.status ? [q.status] : []),
          )
        : q.status
          ? c.env.DB.prepare(REFUNDS_LIST_BY_STATUS_SQL).bind(q.status, at, after)
          : c.env.DB.prepare(REFUNDS_LIST_SQL).bind(at, after)
      ).all<
        NonNullable<Awaited<ReturnType<typeof readRefund>>> & { client_code: string; client_name: string }
      >()
    ).results;
    const page = rows.slice(0, 50);
    const last = page.at(-1);
    return c.json({
      items: page.map((r) => ({ ...view(r), clientCode: r.client_code, clientName: r.client_name })),
      next: rows.length > 50 && last ? encodeCursor({ k: String(last.requested_at), id: last.id }) : null,
    });
  })
  .post("/:id/retry", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const before = await readRefund(c.env.DB, id);
    if (!before) return err(c, NOT_FOUND, 404);
    const now = Date.now();
    // L44 (early check 2, finding 1b): "Try again" waits until the refund is idle (its request and its last check both REFUND_SWEEP_IDLE_MS old).
    if (isOpen(before) && now < refundIdleAt(before)) return tooSoon(c, before, now);
    const checked = await checkRefund(c.env, id, now, { repost: true });
    if (checked.result === "unavailable") return err(c, REFUSALS.gateway_unavailable, 503);
    if (checked.result === "live_not_allowed") return err(c, REFUSALS.live_not_allowed, 503);
    // A re-post that lost its claim (review part 1, finding 1a: the sweep claimed the row a moment before) waits from the new attempt.
    if (checked.result === "too_soon") return tooSoon(c, (await readRefund(c.env.DB, id)) ?? before, now);
    // One audit row for the Owner's "Try again" (the move itself, if any, has the system's).
    await mutate(c, {
      action: "refund.retry",
      entityType: "refund",
      entityId: id,
      summary: { refundId: id, result: checked.result },
    });
    const r = await readRefund(c.env.DB, id);
    return c.json({ refund: r ? view(r) : null, result: checked.result });
  })
  .post("/:id/cancel", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const row = await readRefund(db, id);
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.status !== "requested" || row.provider_refund_id !== null)
      return err(c, REFUSALS.not_cancellable, 409);
    // L44 (finding 1b): a cancel waits as a re-post does, so a request still on its way is never cancelled under it.
    const now = Date.now();
    if (now < refundIdleAt(row)) return tooSoon(c, row, now);
    if (row.provider !== "manual" && row.provider_payment_id) {
      const gw = await refundGwOf(c.env, row.provider);
      if (!gw || gw.blocked === "unconfigured") return err(c, REFUSALS.gateway_unavailable, 503);
      if (gw.blocked === "live_not_allowed") return err(c, REFUSALS.live_not_allowed, 503);
      const found = await gw.find({ paymentRef: row.provider_payment_id, refundId: row.id, refundRef: null });
      if (!found.ok) return err(c, REFUSALS.gateway_error, 502);
      // PayPal can't list a capture's refunds: a cancel there is refused (the gateway may hold it); "Try again" settles it instead.
      if (found.value === "unknown") return err(c, REFUSALS.not_cancellable, 409);
      if (found.value !== null) {
        await applyGatewayRefund(c.env, row, found.value, Date.now());
        return err(c, REFUSALS.refund_found, 409);
      }
    }
    const u = actor(c);
    const done = await mutate(c, {
      // Review part 1, finding 1b: bound to the `last_attempt_at` read above, so a re-post that claimed the row since (its request may be on its way) wins.
      main: refundCancelStatement(db, {
        refundId: id,
        now: Date.now(),
        sessionId: u.sessionId,
        seen: row.last_attempt_at,
      }),
      action: "refund.cancel",
      entityType: "refund",
      entityId: id,
      summary: { refundId: id, paymentId: row.payment_id },
    });
    if (!done) {
      const after = await readRefund(db, id);
      if (
        after &&
        after.status === "requested" &&
        after.provider_refund_id === null &&
        after.last_attempt_at !== row.last_attempt_at
      )
        return tooSoon(c, after, Date.now());
      return err(c, REFUSALS.not_cancellable, 409);
    }
    const r = await readRefund(db, id);
    return c.json({ refund: r ? view(r) : null });
  })
  // Review part 1, finding 9 (L9): the INR the bank debited for a USD refund that went out, from its advice (the Owner, step-up, once), for the refunds register.
  .post("/:id/inr", param(idParam), body(refundInrBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const row = await readRefund(db, id);
    if (!row) return err(c, NOT_FOUND, 404);
    const done = await mutate(c, {
      main: refundInrStatement(db, {
        refundId: id,
        inrMinor: f.inrMinor,
        sessionId: actor(c).sessionId,
        now: Date.now(),
      }),
      action: "refund.inr",
      entityType: "refund",
      entityId: id,
      summary: { refundId: id, paymentId: row.payment_id, currency: row.currency, inrMinor: f.inrMinor },
    });
    if (!done) {
      if (row.inr_refunded_minor !== null) return err(c, REFUSALS.inr_already_set, 409);
      return err(c, REFUSALS.inr_not_applicable, 409);
    }
    const r = await readRefund(db, id);
    return c.json({ refund: r ? view(r) : null });
  });
