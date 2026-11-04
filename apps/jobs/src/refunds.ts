// M6.5 refunds and reconciliation on the leads queue (ADM-PAY-08, ADM-PAY-10; run file D, L11, L37): routed before the lead fall-through, one unit of work each.
//   `refund.check {refundId}`  → the finance Worker's `GatewayEvents.checkRefund` (ADMIN_GATEWAY; checked lazily: a finance Worker older than M6.5 has none);
//   `refund.sweep {asOf}`      → up to 20 `refund.check` for refunds open and idle for 15 minutes (`REFUNDS_IDLE_SQL`, its partial index);
//   `recon.fetch {…, skip}`    → `GatewayEvents.fetchSettlements`; a full page queues the next one (`next.skip`).
// A dead `refund.check` becomes a `refund_stuck` review item with the owners' bell (once: the item's unique open kind per refund); the sweep and the fetch
// only log (the next tick lists them again). Crons only enqueue; nothing here reads a gateway itself.
import {
  REFUND_SWEEP_IDLE_MS,
  reconFetchMessage,
  refundCheckMessage,
  refundSweepMessage,
} from "@techaust/core";
import { uuidv7 } from "@techaust/core/ids";
import { refundNotify } from "@techaust/core/notifications";
import { reviewBellStatement, reviewItemStatement } from "@techaust/db/gateway";
import { REFUNDS_IDLE_SQL, refundItemOnceGuard } from "@techaust/db/refunds";
import { type GatewayVerdict, gatewayRetryDelay, REVIEW_LINK } from "./gateway.ts";
import { adminGateway } from "./gateway-rpc.ts";
import { logEvent } from "./log.ts";

const skip = (kind: string): GatewayVerdict => {
  logEvent("refund.invalid_message", { kind });
  return "ack";
};

/** One body of the refund family (`isRefundKind` already said so). */
export async function processRefundFamily(
  env: Pick<Env, "DB" | "LEADS_QUEUE" | "EMAIL_QUEUE">,
  body: { kind: string },
  attempts: number,
): Promise<GatewayVerdict> {
  if (body.kind === "refund.check") {
    const m = refundCheckMessage.safeParse(body);
    if (!m.success) return skip(body.kind);
    const r = await adminGateway(env).checkRefund?.({ refundId: m.data.refundId });
    // M7.2 (Q4 A, producer 4): the sweep's check moved the refund to succeeded: the client's email (its consumer re-checks every rule in SQL).
    if (r?.result === "succeeded") await env.EMAIL_QUEUE.send(refundNotify(m.data.refundId));
    logEvent("refund.check", { r: r?.result ?? "none" });
    return r?.result === "retry" ? { retry: gatewayRetryDelay(attempts) } : "ack";
  }
  if (body.kind === "refund.sweep") {
    const m = refundSweepMessage.safeParse(body);
    if (!m.success) return skip(body.kind);
    const rows = (
      await env.DB.prepare(REFUNDS_IDLE_SQL)
        .bind(m.data.asOf - REFUND_SWEEP_IDLE_MS)
        .all<{ id: string }>()
    ).results;
    if (rows.length > 0)
      await env.LEADS_QUEUE.sendBatch(rows.map((r) => ({ body: { kind: "refund.check", refundId: r.id } })));
    logEvent("refund.sweep", { count: rows.length });
    return "ack";
  }
  const m = reconFetchMessage.safeParse(body);
  if (!m.success) return skip(body.kind);
  const r = await adminGateway(env).fetchSettlements?.({
    provider: m.data.provider,
    day: m.data.day,
    skip: m.data.skip,
  });
  logEvent("recon.fetch", { r: r?.result ?? "none" });
  if (r?.result === "retry") return { retry: gatewayRetryDelay(attempts) };
  if (r?.next)
    await env.LEADS_QUEUE.send({
      kind: "recon.fetch",
      provider: m.data.provider,
      day: m.data.day,
      skip: r.next.skip,
    });
  return "ack";
}

/** The owners' bell of a refund the checks gave up on (staff words, builder's draft for the lead; the finance Worker's `refund_stuck` line in short). */
export const REFUND_STUCK_BELL =
  "A payment needs review: a refund wasn't confirmed by the gateway. Check it in the gateway's dashboard, then try again.";

const REFUND_ROW_SQL = `SELECT r.id, r.payment_id, r.client_id, r.document_id, r.provider, r.amount_minor, r.currency, r.status FROM payment_refunds r WHERE r.id = ?1`;

/** A refund message that ran out of tries: `refund.check` opens a `refund_stuck` item (still open refunds only); the others only log. */
export async function processRefundDeadLetter(
  env: Pick<Env, "DB">,
  body: { kind: string },
  now = Date.now(),
): Promise<void> {
  if (body.kind === "refund.check") {
    const m = refundCheckMessage.safeParse(body);
    const row = m.success
      ? await env.DB.prepare(REFUND_ROW_SQL).bind(m.data.refundId).first<{
          id: string;
          payment_id: string;
          client_id: string;
          document_id: string | null;
          provider: string;
          amount_minor: number;
          currency: "INR" | "USD";
          status: string;
        }>()
      : null;
    if (row && (row.status === "requested" || row.status === "processing") && row.provider !== "manual") {
      const reviewId = uuidv7();
      // Early check 2, finding 2: once per refund (the item's own guard, shared with the finance Worker's tenth check and L42); the bell only with a new item.
      await env.DB.batch([
        reviewItemStatement(
          env.DB,
          {
            id: reviewId,
            source: "dlq",
            provider: row.provider as "razorpay" | "stripe" | "paypal",
            kind: "refund_stuck",
            webhookEventId: null,
            paymentId: row.payment_id,
            documentId: row.document_id,
            clientId: row.client_id,
            amountMinor: row.amount_minor,
            currency: row.currency,
            facts: { linkId: "", refundId: row.id },
            now,
          },
          refundItemOnceGuard({ paymentId: row.payment_id, refundId: row.id, kind: "refund_stuck" }),
        ),
        reviewBellStatement(env.DB, { reviewId, title: REFUND_STUCK_BELL, link: REVIEW_LINK }),
      ]);
    }
  }
  logEvent("refund.dead_letter", { kind: body.kind });
}
