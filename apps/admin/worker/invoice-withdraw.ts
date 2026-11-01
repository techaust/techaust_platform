// Withdraw a proforma the client has received (ADM-INV-10, ADM-INV-02, ADM-INV-13; owner, 2026-10-30, docs/13; runs/proforma-withdraw L1 to L4):
// `POST /invoices/:id/withdraw`, the Owner's action with a fresh code (`invoices.withdraw`, Q1). A withdrawal IS a void of a delivered proforma (emailed or
// opened in the portal) through its own route, permission and audit row (no new status, no new column). It keeps its number and stays in the records
// (the reason in `void_reason`, the time in `voided_at`, who in the audit row); the client sees it as withdrawn (`withdrawnSql`); its reminders and sends stop
// through the existing SQL (the reminder claim and the send consumer read `voided_at IS NULL`). Links and send rows are left alone (L3). A proforma is not
// a tax document (Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-17, RA-28)), so no credit note and no Table 13 row follow. An undelivered
// proforma is voided instead (`/void`): the two are exclusive by delivery (L2).
//
// The order of the checks (the brief's): one lean read; 404; another type is 409 `withdraw_proforma_only`; the blockers (409, the first code's words,
// every code in `reasons`); `stale_version`; `client_anonymised`; then ONE batch whose UPDATE carries every rule, the audit row (ids, number, amount, the
// reason's length and how it was delivered; never the reason's text) and the milestone's release (L4). When nothing was written, one read says why; a
// trigger refusal (0038, 0053/0056, 0060) is explained the same way, never a 500.

import { withdrawBlockers } from "@techaust/core/invoices";
import {
  PENDING_GATEWAY,
  PENDING_MANUAL,
  paymentPendingForSql,
  paymentPendingKindsSql,
} from "@techaust/db/ledger";
import { proformaDeliveredSql } from "@techaust/db/sql-rules";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import {
  type AppEnv,
  actor,
  type Ctx,
  err,
  FORBIDDEN,
  mutate,
  NOT_FOUND,
  STEP_UP_REQUIRED,
  UNAUTHENTICATED,
} from "./context.ts";
import { body, idParam, param, refusedWith, STALE_VERSION } from "./http.ts";
import { INVOICE_TYPES_SQL, WITHDRAW_ERRORS, WITHDRAW_PROFORMA_ONLY } from "./invoice-model.ts";
import { milestoneReleaseStmt, OWNER_STEP_UP_SQL, VOID_REFUSED, voidReasonIn } from "./invoice-void-rules.ts";
import { CLIENT_GONE } from "./quote-model.ts";

export const withdrawBody = z.strictObject({
  expectedUpdatedAt: z.int(),
  reason: voidReasonIn,
});

/**
 * Everything the route decides on, in ONE statement (each part one index lookup): the document (an invoice-flow type, else no row), whether its client is
 * anonymised, whether it was emailed, whether any document (draft or issued) names it as its parent, whether an advance receipt names it, and its milestone.
 * M6.1 (L37): and whether a PENDING payment of its client asks for it (a seek of `payments_client`); M6.2 (fix round 3 item 3): a manual one and a Razorpay
 * one (its own blocker: it can't be rejected) apart, in one pass (`pending_kinds`, `paymentPendingKindsSql`).
 */
const FACTS_SQL = `SELECT d.id, d.type, d.status, d.frozen_at, d.updated_at, d.paid_minor, d.credited_minor, d.viewed_at, d.number_display, d.total_minor,
     ${clientGoneSql("d.client_id")} AS gone,
     EXISTS (SELECT 1 FROM document_sends s WHERE s.document_id = d.id) AS emailed,
     EXISTS (SELECT 1 FROM documents x WHERE x.parent_id = d.id) AS child,
     EXISTS (SELECT 1 FROM advance_receipts r WHERE r.proforma_id = d.id) AS advance,
     (SELECT m.id FROM milestones m WHERE m.document_id = d.id) AS milestone_id,
     ${paymentPendingKindsSql("d.id", "d.client_id")} AS pending_kinds
   FROM documents d WHERE d.id = ?1 AND d.type IN (${INVOICE_TYPES_SQL})`;

type Facts = {
  id: string;
  type: string;
  status: string;
  frozen_at: number | null;
  updated_at: number;
  paid_minor: number;
  credited_minor: number;
  viewed_at: number | null;
  number_display: string | null;
  total_minor: number;
  gone: number;
  emailed: number;
  child: number;
  advance: number;
  milestone_id: string | null;
  pending_kinds: number;
};

const blockersOf = (f: Facts) =>
  withdrawBlockers({
    type: f.type,
    status: f.status,
    paidMinor: f.paid_minor,
    creditedMinor: f.credited_minor,
    hasChildDocument: f.child === 1,
    hasAdvanceReceipt: f.advance === 1,
    emailed: f.emailed === 1,
    viewed: f.viewed_at !== null,
    paymentPending: (f.pending_kinds & PENDING_MANUAL) !== 0,
    paymentPendingGateway: (f.pending_kinds & PENDING_GATEWAY) !== 0,
  });

/** A refused withdraw (409): the first code's words (07-ZF), every code in `reasons`. */
function withdrawRefused(c: Ctx, reasons: ReturnType<typeof withdrawBlockers>) {
  const first = reasons[0] ?? "not_issued";
  const error = WITHDRAW_ERRORS[first];
  return c.json({ error: { code: error.code, message: error.message }, reasons, request_id: c.var.rid }, 409);
}

const deliveredOf = (f: Facts): "emailed" | "viewed" | "both" =>
  f.emailed === 1 && f.viewed_at !== null ? "both" : f.emailed === 1 ? "emailed" : "viewed";

/**
 * Why the batch wrote nothing (or a trigger refused it), from one read: the session first (an ended one is a sign-in, 401), then a stale stamp, a
 * client anonymised meanwhile, the step-up and the role, then the withdraw rules on the facts as they are now (a payment, an invoice, a receipt that
 * landed in between). Anything else: the record moved (`stale_version`).
 */
async function explain(c: Ctx, id: string, expectedUpdatedAt: number, t: number) {
  const u = actor(c);
  const db = c.env.DB;
  const [factsR, sessionR] = await db.batch([
    db.prepare(FACTS_SQL).bind(id),
    db
      .prepare(
        "SELECT s.step_up_until AS step_up, (s.idle_expires_at > ?2 AND s.abs_expires_at > ?2) AS live, (o.role = 'owner' AND o.status = 'active') AS owner FROM staff_sessions s JOIN staff_users o ON o.id = s.user_id WHERE s.id = ?1 AND s.revoked_at IS NULL",
      )
      .bind(u.sessionId, t),
  ]);
  const f = factsR?.results[0] as Facts | undefined;
  const s = sessionR?.results[0] as { step_up: number | null; live: number; owner: number } | undefined;
  if (!f) return err(c, NOT_FOUND, 404);
  if (s?.live !== 1) return err(c, UNAUTHENTICATED, 401);
  if (f.updated_at !== expectedUpdatedAt) return err(c, STALE_VERSION, 409);
  if (f.gone === 1) return err(c, CLIENT_GONE, 409);
  if (s.owner !== 1) return err(c, FORBIDDEN, 403);
  if (s.step_up === null || s.step_up <= t) return err(c, STEP_UP_REQUIRED, 403);
  const reasons = blockersOf(f);
  if (reasons.length > 0) return withdrawRefused(c, reasons);
  return err(c, STALE_VERSION, 409);
}

export const invoiceWithdraw = new Hono<AppEnv>().post(
  "/:id/withdraw",
  param(idParam),
  body(withdrawBody),
  async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    // (1) one lean read
    const d = await db.prepare(FACTS_SQL).bind(id).first<Facts>();
    // (2) 404; only a proforma is withdrawn (a tax or export invoice is corrected by a credit note, a note by another note)
    if (!d) return err(c, NOT_FOUND, 404);
    if (d.type !== "proforma") return err(c, WITHDRAW_PROFORMA_ONLY, 409);
    // (3) the rules, as codes
    const reasons = blockersOf(d);
    if (reasons.length > 0) return withdrawRefused(c, reasons);
    // (4) the stamp the person saw, and a client that still exists (an anonymised client takes nothing new)
    if (d.updated_at !== f.expectedUpdatedAt) return err(c, STALE_VERSION, 409);
    if (d.gone === 1) return err(c, CLIENT_GONE, 409);
    // (5) ONE batch. Every rule is in the statement: an issued, frozen proforma of a live client, nothing paid or credited, nothing made from it (a draft
    // included), no payment received against it, no pending payment asking for it (M6.1, L37), delivered (emailed or opened), and the owner's session
    // with a live step-up. The triggers `documents_proforma_withdraw` (0056) and `documents_void_no_payment` (0060) hold the same rules for any writer.
    const t = Math.max(Date.now(), d.updated_at + 1);
    let done = false;
    try {
      done = await mutate(c, {
        main: db
          .prepare(
            `UPDATE documents SET status = 'void', voided_at = ?3, void_reason = ?4, updated_at = ?3
             WHERE id = ?1 AND updated_at = ?2 AND type = 'proforma' AND status = 'issued' AND frozen_at IS NOT NULL
               AND paid_minor = 0 AND credited_minor = 0 AND NOT ${clientGoneSql("client_id")}
               AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.parent_id = documents.id)
               AND NOT EXISTS (SELECT 1 FROM advance_receipts r WHERE r.proforma_id = documents.id)
               AND NOT ${paymentPendingForSql("documents.id", "documents.client_id")}
               AND ${proformaDeliveredSql("documents")}
               AND ${OWNER_STEP_UP_SQL}`,
          )
          .bind(id, f.expectedUpdatedAt, t, f.reason, u.sessionId),
        action: "invoice.withdraw",
        entityType: "document",
        entityId: id,
        // The reason's text is the owner's own words and stays in the document row; the audit row holds only its length.
        summary: {
          documentId: id,
          number: d.number_display,
          type: d.type,
          totalMinor: d.total_minor,
          reasonLength: f.reason.length,
          delivered: deliveredOf(d),
        },
        // L4: the milestone this proforma was made from is free for a new invoice again, as on a void (the same statement).
        side: (g) => [milestoneReleaseStmt(db, g, id, t)],
      });
    } catch (e) {
      if (!refusedWith(e, VOID_REFUSED)) throw e;
    }
    // (6, 7) nothing written, or a trigger refused it: one read says why
    if (!done) return explain(c, id, f.expectedUpdatedAt, t);
    // The milestone's new status for the toast, read after the write by the id the proforma was made from (the write cleared the link).
    const freed = d.milestone_id
      ? await db
          .prepare("SELECT id, status FROM milestones WHERE id = ?1")
          .bind(d.milestone_id)
          .first<{ id: string; status: string }>()
      : null;
    return c.json({
      ok: true,
      status: "void",
      withdrawn: true,
      number: d.number_display,
      voidedAt: t,
      updatedAt: t,
      milestone: freed ? { id: freed.id, status: freed.status } : null,
    });
  },
);
