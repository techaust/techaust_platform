// The ledger around one client or one invoice (M6.1; ADM-PAY-06, ADM-INV-02, ADM-INV-09, ADM-INV-16, Q60; run file C, L2, L13, L14), in the finance Worker:
//   GET  /clients/:id/credit                                         the client's credit by currency and where it comes from (derived: no table, L2);
//   POST /clients/:id/credit/apply                                   "Use credit on this invoice" (07-ZH line 10): first in, first out, with the RA-17 warning;
//   POST /invoices/:id/credit/release                                "Move excess to credit" (07-ZH line 11): an invoice's excess back to the client's credit;
//   GET  /invoices/:id/payments                                      the invoice's Payments panel (07-ZH line 1): its figures, the payments on it, the ones
//                                                                    waiting, the client's credit, and on an export invoice the FEMA and GST dates and extensions;
//   POST /invoices/:id/realisation-extensions, PUT .../:eid/letter   "Bank extended the date" (07-ZH line 14; Q60, L14).
// Every change is ONE `mutate` batch from `@techaust/db/ledger`: the claim of the document (every guard in its WHERE: the stamp read, the bounds, the Owner's
// fresh code), the audit row, the allocation rows and the recompute guarded on it, `ledger_result` last and unguarded.
//
// RA-17 (L13; Settled by the lead on the safest reading, 2026-10-31 (08-C RA-17)): an overpayment held as credit and used later on another supply is treated as
// an advance under s.13(2) CGST Act, so money that arrived in a month before the invoice's month answers with the warning `received_in_earlier_month`; nothing
// is blocked.
import { addDays, istDate, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import {
  balanceOf,
  creditSources,
  type LedgerDoc,
  PAYABLE_TYPES,
  receiptMonthWarning,
  refundDueOf,
  releasable,
} from "@techaust/core/ledger";
import { creditApplyBody, creditReleaseBody, realisationExtensionBody } from "@techaust/core/payment-schemas";
import { DOCUMENT_CHECKOUTS_SQL } from "@techaust/db/gateway";
import {
  type AllocationRow,
  allocationsInsertStatement,
  CLIENT_CREDIT_SQL,
  CREDIT_DRAW_SQL,
  CREDIT_SOURCES_SQL,
  clientCreditSql,
  creditClaimStatement,
  DOCUMENT_HOLDINGS_SQL,
  extensionLetterStatement,
  ledgerResultStatement,
  realisationExtensionStatement,
  recomputeStatement,
} from "@techaust/db/ledger";
import { femaDueSql, femaStandardSql, gstDueSql, settingsBinds, stageSql } from "@techaust/db/realisation";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import { type AppEnv, actor, type Ctx, err, mutate, NOT_FOUND } from "./context.ts";
import { dropDoc, streamToDocs, uploadHead } from "./docs-upload.ts";
import { body, idParam, param, refusedWith, STALE_VERSION } from "./http.ts";
import { INVOICE_VOID } from "./invoice-model.ts";
import {
  allocationExceedsBalance,
  EXCEEDS_CREDIT,
  EXCEEDS_EXCESS,
  extensionNotLater,
  extensionTooFar,
  LEDGER_CHANGED,
  LETTER_ALREADY_SET,
  NOT_AN_EXPORT_INVOICE,
  NOT_PAYABLE,
} from "./payment-messages.ts";
import { LEDGER_REFUSED } from "./payments.ts";
import { CLIENT_GONE } from "./quote-model.ts";
import { sessionRefusal } from "./session-refusal.ts";

/**
 * L23.7: an extension is held within core's existing realisation bound, the 36,500-day upper bound of the realisation rules (`rulesAreValid` in
 * `@techaust/core/gst/realisation`, the bound `femaDueSql` and core share): at most this many days after the invoice's issue date.
 */
export const EXTENSION_MAX_DAYS = 36_500;

/** The types the Payments panel answers for: what a payment is put on (core `PAYABLE_TYPES`), plus the proforma and the credit note it shows read-only. */
const PANEL_TYPES: readonly string[] = [...PAYABLE_TYPES, "proforma", "credit_note"];

/** A document as the ledger routes read it, with its client's state and its current FEMA date when it is an export invoice. */
const DOC_SQL = `SELECT d.id, d.type, d.status, d.client_id, d.currency, d.frozen_at, d.voided_at, d.issue_date, d.number_display, d.total_minor, d.paid_minor,
     d.credited_minor, d.tds_minor, d.balance_minor, d.updated_at, d.supply_type, ${clientGoneSql("d.client_id")} AS gone,
     CASE WHEN d.type = 'export_invoice' AND d.issue_date IS NOT NULL THEN ${femaDueSql("d", settingsBinds("NULL"))} END AS fema_due
   FROM documents d WHERE d.id = ?1`;

type DocRow = {
  id: string;
  type: string;
  status: string;
  client_id: string;
  currency: string;
  frozen_at: number | null;
  voided_at: number | null;
  issue_date: string | null;
  number_display: string | null;
  total_minor: number;
  paid_minor: number;
  credited_minor: number;
  tds_minor: number;
  balance_minor: number;
  updated_at: number;
  supply_type: string | null;
  gone: number;
  fema_due: string | null;
};

const isPayable = (d: DocRow) =>
  (PAYABLE_TYPES as readonly string[]).includes(d.type) && d.frozen_at !== null && d.status !== "void";

/** The document as core's ledger rules read it. */
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

type SourceRow = { id: string; received_on: string; amount_minor: number; net: number };

/** After a refused claim: the document as it is now says why (stale, void, anonymised), else the session does. */
async function claimRefusal(c: Ctx, documentId: string, expectedUpdatedAt: number): Promise<Response> {
  const d = await c.env.DB.prepare(DOC_SQL).bind(documentId).first<DocRow>();
  if (!d) return err(c, NOT_FOUND, 404);
  if (d.updated_at !== expectedUpdatedAt) return err(c, STALE_VERSION, 409);
  if (d.status === "void") return err(c, INVOICE_VOID, 409);
  if (d.gone === 1) return err(c, CLIENT_GONE, 409);
  return (await sessionRefusal(c, true)) ?? err(c, LEDGER_CHANGED, 409);
}

/**
 * Early check 2, finding 5: the document's `updated_at` as the batch left it (the recompute moves it again after the claim, so `now` is not what is stored).
 * The screen's next save sends it as `expectedUpdatedAt`.
 */
async function storedUpdatedAt(c: Ctx, documentId: string): Promise<number | null> {
  const r = await c.env.DB.prepare("SELECT updated_at FROM documents WHERE id = ?1")
    .bind(documentId)
    .first<{ updated_at: number }>();
  return r?.updated_at ?? null;
}

const creditView = (rows: readonly { currency: string; credit: number }[]) =>
  rows.map((r) => ({ currency: r.currency, creditMinor: r.credit }));

const sourcesView = (rows: readonly SourceRow[]) =>
  rows.map((r) => ({ paymentId: r.id, receivedOn: r.received_on, availableMinor: r.amount_minor - r.net }));

// ---- /clients/:id/credit ---------------------------------------------------------------------------------------------------------------------------------

export const clientCredit = new Hono<AppEnv>()
  .get("/:id/credit", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const [clientR, creditR] = await db.batch([
      db.prepare("SELECT id, currency, anonymised_at FROM clients WHERE id = ?1").bind(id),
      db.prepare(CLIENT_CREDIT_SQL).bind(id),
    ]);
    const client = clientR?.results[0] as
      | { id: string; currency: string; anonymised_at: number | null }
      | undefined;
    if (!client) return err(c, NOT_FOUND, 404);
    const sources =
      (await db.prepare(CREDIT_SOURCES_SQL).bind(id, client.currency).all<SourceRow>()).results ?? [];
    return c.json({
      clientId: id,
      anonymised: client.anonymised_at !== null,
      /** 07-ZH line 10 "Credit held: {amount}", by currency (a client has one currency, M3.3). */
      credits: creditView((creditR?.results ?? []) as { currency: string; credit: number }[]),
      /** Where the credit comes from, first in first out (the order "Use credit" takes it in). At most 50 are listed; "Use credit" draws past them (finding 3). */
      sources: sourcesView(sources),
    });
  })

  // ---- "Use credit on this invoice" (Owner, fresh code) ----
  .post("/:id/credit/apply", param(idParam), body(creditApplyBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const d = await db.prepare(DOC_SQL).bind(f.documentId).first<DocRow>();
    // The invoice must be this client's: a document of another client is not found here.
    if (!d || d.client_id !== id) return err(c, NOT_FOUND, 404);
    if (d.status === "void") return err(c, INVOICE_VOID, 409);
    if (!isPayable(d)) return err(c, NOT_PAYABLE, 409, { documentId: d.id });
    if (d.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    if (d.gone === 1) return err(c, CLIENT_GONE, 409);
    const balance = balanceOf(d.total_minor, d.paid_minor, d.credited_minor, d.tds_minor);
    if (f.amountMinor > balance)
      return err(c, allocationExceedsBalance(balance, d.currency), 409, {
        documentId: d.id,
        balanceMinor: balance,
      });
    // Finding 3: the whole credit can be used. One read lists as many sources as cover the amount (first in first out), not only the oldest 50.
    const sources =
      (await db.prepare(CREDIT_DRAW_SQL).bind(id, d.currency, f.amountMinor).all<SourceRow>()).results ?? [];
    const picked = creditSources(
      sources.map((s) => ({
        id: s.id,
        kind: "payment",
        status: "confirmed",
        receivedOn: s.received_on,
        amountMinor: s.amount_minor,
        netAllocatedMinor: s.net,
      })),
      f.amountMinor,
    );
    if (!picked.ok) return err(c, EXCEEDS_CREDIT, 409);
    const now = Math.max(Date.now(), d.updated_at + 1);
    const rows: AllocationRow[] = picked.sources.map((s) => ({
      id: uuidv7(),
      paymentId: s.paymentId,
      documentId: d.id,
      amountMinor: s.amountMinor,
      kind: "allocate" as const,
    }));
    let done = false;
    try {
      done = await mutate(c, {
        main: creditClaimStatement(db, {
          kind: "apply",
          documentId: d.id,
          expectedUpdatedAt: f.expectedUpdatedAt,
          now,
          sessionId: u.sessionId,
          amountMinor: f.amountMinor,
        }),
        action: "payment.credit_apply",
        entityType: "document",
        entityId: d.id,
        summary: {
          documentId: d.id,
          clientId: id,
          currency: d.currency,
          amountMinor: f.amountMinor,
          sources: rows.map((r) => ({ paymentId: r.paymentId, amountMinor: r.amountMinor })),
        },
        side: (g) => [
          allocationsInsertStatement(db, rows, u.id, now, g),
          recomputeStatement(db, { documentIds: [d.id] }, now, g),
          // Early check A8: every source payment is a target too, so each one's net allocations are checked against its amount.
          ledgerResultStatement(db, { paymentIds: rows.map((r) => r.paymentId), documentIds: [d.id] }),
        ],
      });
    } catch (e) {
      if (!refusedWith(e, LEDGER_REFUSED)) throw e;
      return err(c, LEDGER_CHANGED, 409);
    }
    if (!done) return claimRefusal(c, d.id, f.expectedUpdatedAt);
    // 07-ZH line 10's warning (RA-17, L13): the oldest money used arrived in a month before the invoice's.
    const sourceDays = picked.sources
      .map((s) => sources.find((x) => x.id === s.paymentId)?.received_on)
      .filter((x): x is string => typeof x === "string")
      .sort();
    const oldest = sourceDays[0];
    const warnings =
      oldest !== undefined && d.issue_date !== null && receiptMonthWarning(oldest, d.issue_date) !== null
        ? [{ code: "received_in_earlier_month" as const, documentId: d.id, month: oldest.slice(0, 7) }]
        : [];
    return c.json({
      ok: true,
      documentId: d.id,
      updatedAt: (await storedUpdatedAt(c, d.id)) ?? now,
      allocations: rows.map((r) => ({ paymentId: r.paymentId, amountMinor: r.amountMinor })),
      warnings,
    });
  });

// ---- /invoices/:id/... --------------------------------------------------------------------------------------------------------------------------------------

type HoldingRow = {
  payment_id: string;
  kind: "payment" | "tds";
  status: string;
  received_on: string;
  mode: string | null;
  reference_norm: string | null;
  currency: string;
  amount_minor: number;
  tds_section: string | null;
  tds_rate_bp: number | null;
  tds_certificate_no: string | null;
  has_proof: number;
  held: number;
};

/**
 * What "Move excess to credit" may move (code review finding 1): core `releasable` over the confirmed `payment` holdings (never TDS, a pending or a withdrawn
 * entry), at most the excess in total. The TDS part of an excess is never released: it stays as refund due (follow-up on 08-C RA-30, decided with M6.5 refunds).
 * Holdings come oldest first; the newest money comes off first, so the oldest stays on the invoice.
 */
function releaseOrder(d: DocRow, holdings: readonly HoldingRow[]): { holding: HoldingRow; room: number }[] {
  if (!isPayable(d)) return [];
  const doc = ledgerDocOf(d);
  return holdings
    .filter((h) => h.status === "confirmed" && h.kind === "payment")
    .map((h) => ({ holding: h, room: releasable(doc, h.kind, h.held) }))
    .filter((x) => x.room > 0)
    .reverse();
}

/** The figure the panel shows and the dialog is capped at: Σ of each holding's room, at most the excess. */
function releasableOf(d: DocRow, holdings: readonly HoldingRow[]): number {
  const excess = refundDueOf(d.total_minor, d.paid_minor, d.credited_minor, d.tds_minor);
  let sum = 0;
  for (const x of releaseOrder(d, holdings)) {
    sum += x.room;
    if (sum >= excess) return excess;
  }
  return sum;
}

/** The client of the document `?1`, as a scalar subquery (the panel's client-scoped reads ride in the same batch). */
const CLIENT_OF_DOCUMENT = "(SELECT cd.client_id FROM documents cd WHERE cd.id = ?1)";

/** The client's credit by currency, for the document `?1` (`clientCreditSql` keyed by the document's client; early check 2, finding 10: no text edits). */
export const CREDIT_OF_DOCUMENT_CLIENT_SQL = clientCreditSql(CLIENT_OF_DOCUMENT);

/** The payments waiting for the Owner that ask for this document (`?1`, of its own client): what Staff recorded against it (L6). */
export const PENDING_FOR_DOCUMENT_SQL = `SELECT p.id, p.kind, p.received_on, p.mode, p.reference_norm, p.currency, p.amount_minor, p.recorded_by, p.recorded_at,
       json_extract(j.value, '$.amountMinor') AS asked_minor
   FROM payments p INDEXED BY payments_client, json_each(p.requested_allocations) j
   WHERE p.client_id = ${CLIENT_OF_DOCUMENT} AND p.status = 'pending_verification' AND p.requested_allocations IS NOT NULL AND json_extract(j.value, '$.documentId') = ?1
   ORDER BY p.recorded_at, p.id LIMIT 50`;

/** M6.2: the gateway payments that came through the links of document `?1` (newest first, at most 20). */
export const GATEWAY_PAYMENTS_OF_DOCUMENT_SQL = `SELECT p.id, p.provider, p.status, p.provider_payment_id, p.mode, p.reference_norm, p.received_on, p.amount_minor, p.charges_minor,
     p.fee_tax_minor, p.requested_allocations
   FROM checkout_sessions c INDEXED BY checkout_sessions_document JOIN payments p ON p.checkout_id = c.id
   WHERE c.document_id = ?1 ORDER BY p.recorded_at DESC, p.id DESC LIMIT 20`;
type GatewayPaymentRow = {
  id: string;
  provider: string;
  status: string;
  provider_payment_id: string | null;
  mode: string | null;
  reference_norm: string | null;
  received_on: string;
  amount_minor: number;
  charges_minor: number;
  fee_tax_minor: number | null;
  requested_allocations: string | null;
};
type LinkRow = {
  id: string;
  status: string;
  source: string;
  amount_minor: number;
  short_url: string | null;
  expires_at: number;
  created_at: number;
  paid_payment_id: string | null;
};

/** The bank's extensions of an export invoice (`?1`), oldest first. */
export const EXTENSIONS_SQL = `SELECT x.id, x.extended_to, x.bank_ref, x.letter_r2_key IS NOT NULL AS has_letter, x.letter_mime, x.recorded_by,
       (SELECT name FROM staff_users WHERE id = x.recorded_by) AS recorded_by_name, x.created_at
   FROM realisation_extensions x INDEXED BY realisation_extensions_document WHERE x.document_id = ?1 ORDER BY x.extended_to, x.id`;

/** An export invoice's realisation (`?1`, today `?2`): the standard FEMA date, with the extensions, the GST date and the stage, as the scan works them out. */
export const REALISATION_OF_SQL = `SELECT ${femaStandardSql("d", settingsBinds("?2"))} AS fema_standard, ${femaDueSql("d", settingsBinds("?2"))} AS fema_due,
       ${gstDueSql("d", settingsBinds("?2"))} AS gst_due, ${stageSql("d", settingsBinds("?2"))} AS stage
   FROM documents d WHERE d.id = ?1 AND d.type = 'export_invoice' AND d.issue_date IS NOT NULL`;

export const invoiceLedger = new Hono<AppEnv>()
  // ---- the Payments panel ----
  .get("/:id/payments", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const today = toIsoDate(istDate(Date.now()));
    const [docR, holdR, pendR, creditR, extR, realR, gwPayR, linksR, reviewR] = await db.batch([
      db.prepare(DOC_SQL).bind(id),
      db.prepare(DOCUMENT_HOLDINGS_SQL).bind(id),
      db.prepare(PENDING_FOR_DOCUMENT_SQL).bind(id),
      db.prepare(CREDIT_OF_DOCUMENT_CLIENT_SQL).bind(id),
      db.prepare(EXTENSIONS_SQL).bind(id),
      db.prepare(REALISATION_OF_SQL).bind(id, today),
      // M6.2: the Razorpay payments that came through this document's links (any status), its links, and its open review items.
      db.prepare(GATEWAY_PAYMENTS_OF_DOCUMENT_SQL).bind(id),
      db.prepare(DOCUMENT_CHECKOUTS_SQL).bind(id),
      db
        .prepare(
          "SELECT count(*) AS n FROM review_items INDEXED BY review_items_document WHERE document_id = ?1 AND status = 'open'",
        )
        .bind(id),
    ]);
    const d = docR?.results[0] as DocRow | undefined;
    if (!d || !PANEL_TYPES.includes(d.type)) return err(c, NOT_FOUND, 404);
    const real = realR?.results[0] as
      | { fema_standard: string; fema_due: string; gst_due: string; stage: string }
      | undefined;
    return c.json({
      documentId: d.id,
      type: d.type,
      status: d.status,
      currency: d.currency,
      updatedAt: d.updated_at,
      // 07-ZH line 1: total, "Paid", "TDS deducted by the client", "Credited", "Balance", "Paid above what it owes".
      totalMinor: d.total_minor,
      paidMinor: d.paid_minor,
      tdsMinor: d.tds_minor,
      creditedMinor: d.credited_minor,
      balanceMinor: d.balance_minor,
      excessMinor: refundDueOf(d.total_minor, d.paid_minor, d.credited_minor, d.tds_minor),
      /** What "Move excess to credit" may move (finding 1): the excess less its TDS part. The button shows only above 0; the dialog is capped at it. */
      releasableMinor: releasableOf(d, (holdR?.results ?? []) as HoldingRow[]),
      payments: ((holdR?.results ?? []) as HoldingRow[]).map((r) => ({
        paymentId: r.payment_id,
        kind: r.kind,
        status: r.status,
        receivedOn: r.received_on,
        mode: r.mode,
        reference: r.reference_norm,
        currency: r.currency,
        amountMinor: r.amount_minor,
        heldMinor: r.held,
        tds:
          r.kind === "tds"
            ? {
                section: r.tds_section,
                rateBp: r.tds_rate_bp,
                certificateNo: r.tds_certificate_no,
                certificateAwaited: r.tds_certificate_no === null,
              }
            : null,
        hasProof: r.has_proof === 1,
      })),
      pending: (
        (pendR?.results ?? []) as {
          id: string;
          kind: string;
          received_on: string;
          mode: string | null;
          reference_norm: string | null;
          currency: string;
          amount_minor: number;
          recorded_by: string | null;
          recorded_at: number;
          asked_minor: number;
        }[]
      ).map((r) => ({
        paymentId: r.id,
        kind: r.kind,
        receivedOn: r.received_on,
        mode: r.mode,
        reference: r.reference_norm,
        currency: r.currency,
        amountMinor: r.amount_minor,
        askedMinor: r.asked_minor,
        recordedBy: r.recorded_by,
        recordedAt: r.recorded_at,
      })),
      credits: creditView((creditR?.results ?? []) as { currency: string; credit: number }[]),
      // M6.2 (run file G1): "Paid online" rows (method, Razorpay's payment id, the fee absorbed), the payment links, and the open review items.
      gateway: {
        payments: ((gwPayR?.results ?? []) as GatewayPaymentRow[]).map((r) => ({
          paymentId: r.id,
          provider: r.provider,
          status: r.status,
          providerPaymentId: r.provider_payment_id,
          mode: r.mode,
          reference: r.reference_norm,
          receivedOn: r.received_on,
          amountMinor: r.amount_minor,
          feeMinor: r.charges_minor,
          feeTaxMinor: r.fee_tax_minor,
          proformaPending: r.status === "pending_verification" && r.requested_allocations !== null,
        })),
        links: ((linksR?.results ?? []) as LinkRow[]).map((l) => ({
          checkoutId: l.id,
          status: l.status,
          source: l.source,
          amountMinor: l.amount_minor,
          shortUrl: l.status === "live" ? l.short_url : null,
          expiresAt: l.expires_at,
          createdAt: l.created_at,
          paidPaymentId: l.paid_payment_id,
        })),
        openReviewCount: (reviewR?.results[0] as { n: number } | undefined)?.n ?? 0,
      },
      realisation:
        d.type === "export_invoice" && real
          ? {
              femaStandard: real.fema_standard,
              femaDue: real.fema_due,
              gstDue: real.gst_due,
              stage: real.stage,
              extensions: (
                (extR?.results ?? []) as {
                  id: string;
                  extended_to: string;
                  bank_ref: string;
                  has_letter: number;
                  letter_mime: string | null;
                  recorded_by: string | null;
                  recorded_by_name: string | null;
                  created_at: number;
                }[]
              ).map((x) => ({
                id: x.id,
                extendedTo: x.extended_to,
                bankRef: x.bank_ref,
                hasLetter: x.has_letter === 1,
                recordedBy: x.recorded_by,
                recordedByName: x.recorded_by_name,
                createdAt: x.created_at,
              })),
            }
          : null,
    });
  })

  // ---- "Move excess to credit" (Owner, fresh code) ----
  .post("/:id/credit/release", param(idParam), body(creditReleaseBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const [docR, holdR] = await db.batch([
      db.prepare(DOC_SQL).bind(id),
      db.prepare(DOCUMENT_HOLDINGS_SQL).bind(id),
    ]);
    const d = docR?.results[0] as DocRow | undefined;
    if (!d || !PANEL_TYPES.includes(d.type)) return err(c, NOT_FOUND, 404);
    if (d.status === "void") return err(c, INVOICE_VOID, 409);
    if (!isPayable(d)) return err(c, NOT_PAYABLE, 409, { documentId: d.id });
    if (d.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    if (d.gone === 1) return err(c, CLIENT_GONE, 409);
    const holdings = (holdR?.results ?? []) as HoldingRow[];
    const excess = refundDueOf(d.total_minor, d.paid_minor, d.credited_minor, d.tds_minor);
    // Finding 1: the cap is what the confirmed payments can give back, never the TDS part of the excess.
    const room = releasableOf(d, holdings);
    if (f.amountMinor > room)
      return err(c, EXCEEDS_EXCESS, 409, { excessMinor: excess, releasableMinor: room });
    // The newest money comes off first, so the oldest stays on the invoice (each payment gives back at most what it holds there, never TDS).
    let need = f.amountMinor;
    const rows: AllocationRow[] = [];
    for (const { holding: h, room: has } of releaseOrder(d, holdings)) {
      if (need === 0) break;
      const take = Math.min(need, has);
      rows.push({
        id: uuidv7(),
        paymentId: h.payment_id,
        documentId: d.id,
        amountMinor: take,
        kind: "release",
      });
      need -= take;
    }
    if (need > 0) return err(c, EXCEEDS_EXCESS, 409, { excessMinor: excess, releasableMinor: room });
    const now = Math.max(Date.now(), d.updated_at + 1);
    let done = false;
    try {
      done = await mutate(c, {
        main: creditClaimStatement(db, {
          kind: "release",
          documentId: d.id,
          expectedUpdatedAt: f.expectedUpdatedAt,
          now,
          sessionId: u.sessionId,
          amountMinor: f.amountMinor,
        }),
        action: "payment.credit_release",
        entityType: "document",
        entityId: d.id,
        summary: {
          documentId: d.id,
          clientId: d.client_id,
          currency: d.currency,
          amountMinor: f.amountMinor,
          sources: rows.map((r) => ({ paymentId: r.paymentId, amountMinor: r.amountMinor })),
        },
        side: (g) => [
          allocationsInsertStatement(db, rows, u.id, now, g),
          recomputeStatement(db, { documentIds: [d.id] }, now, g),
          ledgerResultStatement(db, { documentIds: [d.id] }),
        ],
      });
    } catch (e) {
      if (!refusedWith(e, LEDGER_REFUSED)) throw e;
      return err(c, LEDGER_CHANGED, 409);
    }
    if (!done) return claimRefusal(c, d.id, f.expectedUpdatedAt);
    return c.json({
      ok: true,
      documentId: d.id,
      updatedAt: (await storedUpdatedAt(c, d.id)) ?? now,
      releases: rows.map((r) => ({ paymentId: r.paymentId, amountMinor: r.amountMinor })),
    });
  })

  // ---- "Bank extended the date" (Owner; Q60, L14; Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 5(1) (08-C RB-04): only the AD bank extends) ----
  .post("/:id/realisation-extensions", param(idParam), body(realisationExtensionBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const d = await db.prepare(DOC_SQL).bind(id).first<DocRow>();
    if (!d) return err(c, NOT_FOUND, 404);
    if (d.type !== "export_invoice" || d.frozen_at === null || d.issue_date === null)
      return err(c, NOT_AN_EXPORT_INVOICE, 409);
    if (d.status === "void" || d.voided_at !== null) return err(c, INVOICE_VOID, 409);
    if (d.gone === 1) return err(c, CLIENT_GONE, 409);
    // Later than the current FEMA date (earlier extensions included), and within the bound (L23.7).
    if (d.fema_due !== null && f.extendedTo <= d.fema_due)
      return err(c, extensionNotLater(d.fema_due), 409, { femaDue: d.fema_due });
    const issued = parseIsoDate(d.issue_date) as NonNullable<ReturnType<typeof parseIsoDate>>;
    const limit = toIsoDate(addDays(issued, EXTENSION_MAX_DAYS));
    if (f.extendedTo > limit) return err(c, extensionTooFar(limit), 409, { latest: limit });
    const extensionId = uuidv7();
    const now = Date.now();
    let done = false;
    // The trigger `realisation_extensions_scope_insert` holds the same rule as the WHERE (later than any earlier extension); a race that reaches it is a 409.
    try {
      done = await mutate(c, {
        main: realisationExtensionStatement(db, {
          id: extensionId,
          documentId: id,
          extendedTo: f.extendedTo,
          bankRef: f.bankRef,
          recordedBy: u.id,
          now,
          sessionId: u.sessionId,
        }),
        action: "invoice.realisation_extend",
        entityType: "document",
        entityId: id,
        summary: { documentId: id, extensionId, extendedTo: f.extendedTo, previousFemaDue: d.fema_due },
        status: 201,
      });
    } catch (e) {
      if (!refusedWith(e, /realisation_extensions_scope_insert/)) throw e;
    }
    if (!done) {
      // Early check 2, finding 8: what changed says why (void, anonymised, a later extension landed first), then the session; a bare 401 only for the session.
      const again = await db.prepare(DOC_SQL).bind(id).first<DocRow>();
      if (!again) return err(c, NOT_FOUND, 404);
      if (again.status === "void" || again.voided_at !== null) return err(c, INVOICE_VOID, 409);
      if (again.gone === 1) return err(c, CLIENT_GONE, 409);
      if (again.fema_due !== null && f.extendedTo <= again.fema_due)
        return err(c, extensionNotLater(again.fema_due), 409, { femaDue: again.fema_due });
      return (await sessionRefusal(c, false)) ?? err(c, STALE_VERSION, 409);
    }
    return c.json({ ok: true, id: extensionId, documentId: id, extendedTo: f.extendedTo }, 201);
  })

  .put(
    "/:id/realisation-extensions/:eid/letter",
    param(
      z.object({
        id: z.string().check(z.minLength(1), z.maxLength(64)),
        eid: z.string().check(z.minLength(1), z.maxLength(64)),
      }),
    ),
    async (c) => {
      const { id, eid } = c.req.valid("param");
      const u = actor(c);
      const head = uploadHead(c);
      if (head instanceof Response) return head;
      const db = c.env.DB;
      const x = await db
        .prepare(
          `SELECT x.id, x.letter_r2_key, ${clientGoneSql("d.client_id")} AS gone FROM realisation_extensions x JOIN documents d ON d.id = x.document_id WHERE x.id = ?1 AND x.document_id = ?2`,
        )
        .bind(eid, id)
        .first<{ id: string; letter_r2_key: string | null; gone: number }>();
      if (!x) return err(c, NOT_FOUND, 404);
      if (x.letter_r2_key !== null) return err(c, LETTER_ALREADY_SET, 409);
      if (x.gone === 1) return err(c, CLIENT_GONE, 409);
      const stored = await streamToDocs(c, head, `extensions/${eid}/letter`);
      if (stored instanceof Response) return stored;
      let done = false;
      try {
        done = await mutate(c, {
          main: extensionLetterStatement(db, {
            id: eid,
            documentId: id,
            r2Key: stored.key,
            sha256: head.sha,
            mime: stored.mime,
            sessionId: u.sessionId,
            now: Date.now(),
          }),
          action: "invoice.realisation_extend",
          entityType: "document",
          entityId: id,
          summary: { documentId: id, extensionId: eid, letter: true, size: head.len, mime: stored.mime },
        });
      } catch (e) {
        if (stored.created) await dropDoc(c.env, stored.key, "row not written");
        throw e;
      }
      if (!done) {
        // Early check 2, finding 8: the letter set meanwhile or an anonymised client (the statement's own conditions) says why; then the session; else a reload.
        const again = await db
          .prepare(
            `SELECT x.letter_r2_key, ${clientGoneSql("d.client_id")} AS gone FROM realisation_extensions x JOIN documents d ON d.id = x.document_id WHERE x.id = ?1 AND x.document_id = ?2`,
          )
          .bind(eid, id)
          .first<{ letter_r2_key: string | null; gone: number }>();
        if (stored.created && again?.letter_r2_key !== stored.key)
          await dropDoc(c.env, stored.key, "row not written");
        if (!again) return err(c, NOT_FOUND, 404);
        if (again.letter_r2_key) return err(c, LETTER_ALREADY_SET, 409);
        if (again.gone === 1) return err(c, CLIENT_GONE, 409);
        return (await sessionRefusal(c, false)) ?? err(c, STALE_VERSION, 409);
      }
      return c.json({ ok: true, id: eid, documentId: id, letter: { mime: stored.mime, sha256: head.sha } });
    },
  );
