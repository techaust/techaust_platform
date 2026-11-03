// The refund and dispute events of the three gateways (M6.5; JOB-HOOK-01..03, ADM-PAY-08; run file C "GatewayEvents.processEvent, refund branches", L7, L36),
// reached from `processEvent` before any provider's own path (so PayPal's `PAYMENT.CAPTURE.REFUNDED` of one of OUR refunds is never a `refunded_outside` item:
// Step 0 point 4). The stored row holds whitelisted facts only (L8; 08-C RB-40); every move re-fetches the refund from the gateway first:
//   - a refund of ours (found by the gateway's id, by our own id echoed back, or as the payment's one open refund of that amount still without a gateway id):
//     our row follows the gateway's answer (`applyGatewayRefund`: ≤ 4 statements with the event's own move);
//   - a refund nobody made here (the gateway's dashboard) or a dispute: a review item (`refunded_outside`, `dispute_opened`, `dispute_closed`) and a bell, NO
//     ledger move (L7): the Owner records it through the refund route, which holds every ledger rule;
//   - not ours (another business on the shared Stripe account, M6.3 L5; a payment we never recorded): `ignored`, nothing else written.
import type { ProcessEventResult } from "@techaust/core/gateway-rpc";
import { uuidv7 } from "@techaust/core/ids";
import { reviewBellStatement, reviewItemStatement, webhookEventMoveStatement } from "@techaust/db/gateway";
import { REFUND_BY_PROVIDER_REF_SQL, refundItemOnceGuard } from "@techaust/db/refunds";
import { applyGatewayRefund, openRefundItem, type RefundRow, readRefund } from "../refund-flow.ts";
import { mutateSystem } from "../system.ts";
import { REVIEW_LINK } from "./consts.ts";
import { bellNeedsReview, reviewReason } from "./messages.ts";
import { refundGwOf } from "./refund-gw.ts";

type EventRow = { id: string; provider: string; event_type: string; facts: string | null };

const text = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 255 ? v : null);
const factsOf = (raw: string | null): Record<string, unknown> => {
  try {
    const v = JSON.parse(raw ?? "{}") as unknown;
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const OUR_PAYMENT_SQL = `SELECT p.id, p.client_id, p.status, p.amount_minor, p.currency,
     (SELECT cs.document_id FROM checkout_sessions cs WHERE cs.id = p.checkout_id) AS document_id
   FROM payments p INDEXED BY payments_provider_ref WHERE p.provider = ?1 AND p.provider_payment_id = ?2`;
/** The payment's one open refund of this amount that has no gateway id yet (its create answer was lost). */
const OPEN_UNLINKED_SQL = `SELECT r.id FROM payment_refunds r INDEXED BY payment_refunds_payment
   WHERE r.payment_id = ?1 AND r.status IN ('requested', 'processing') AND r.provider_refund_id IS NULL AND r.amount_minor = ?2`;

type OurPayment = {
  id: string;
  client_id: string;
  status: string;
  amount_minor: number;
  currency: "INR" | "USD";
  document_id: string | null;
};

/** One refund or dispute event (`row.status` is `received`); null: not one of our refunds on PayPal, which M6.4's path handles. */
export async function processRefundEvent(
  env: { DB: D1Database },
  row: EventRow,
  now = Date.now(),
): Promise<ProcessEventResult | null> {
  const db = env.DB;
  const f = factsOf(row.facts);
  const provider = row.provider === "stripe" || row.provider === "paypal" ? row.provider : "razorpay";
  const quiet = async (status: "processed" | "ignored", outcome: string): Promise<ProcessEventResult> => {
    await webhookEventMoveStatement(db, { id: row.id, status, outcome, now }).run();
    return { result: status === "ignored" ? "ignored" : "processed" };
  };
  const refundRef = text(f.refundId);
  const paymentRef = text(f.paymentId);
  // Early check 2, finding 3: PayPal stores our refund id (the refund's `custom_id`) as `checkoutId` (core `payPalEventFacts`).
  const ourId = text(f.ourRefundId) ?? (provider === "paypal" ? text(f.checkoutId) : null);
  const isDispute = f.object === "dispute";
  // Ours first: by the gateway's id, then by our own id (the payment's provider must agree).
  let ours: RefundRow | null = null;
  if (!isDispute && refundRef) {
    const byRef = await db
      .prepare(REFUND_BY_PROVIDER_REF_SQL)
      .bind(provider, refundRef)
      .first<{ id: string }>();
    ours = byRef ? await readRefund(db, byRef.id) : null;
  }
  if (!isDispute && !ours && ourId) {
    const r = await readRefund(db, ourId);
    ours = r && r.provider === provider ? r : null;
  }
  const payment = paymentRef
    ? ((await db.prepare(OUR_PAYMENT_SQL).bind(provider, paymentRef).first<OurPayment>()) ?? null)
    : null;
  // The payment's one open refund of this amount with no gateway id yet is only a CANDIDATE (finding 3): adopted only when the gateway's refund carries our id;
  // a refund of the same amount made in the gateway's dashboard is `refunded_outside` below.
  let candidate = false;
  if (!isDispute && !ours && payment && typeof f.amountMinor === "number") {
    const open = await db.prepare(OPEN_UNLINKED_SQL).bind(payment.id, f.amountMinor).first<{ id: string }>();
    if (open) {
      ours = await readRefund(db, open.id);
      candidate = ours !== null;
    }
  }
  if (ours?.status === "succeeded") return quiet("processed", "refund_settled");
  if (ours) {
    const gw = await refundGwOf(env, provider);
    if (!gw || gw.blocked) return { result: "retry" };
    const found = await gw.find({
      paymentRef: ours.provider_payment_id ?? paymentRef ?? "",
      refundId: ours.id,
      refundRef: ours.provider_refund_id ?? refundRef,
    });
    if (!found.ok) return { result: "retry" };
    const g = found.value === null || found.value === "unknown" ? null : found.value;
    if (candidate && g?.ourId !== ours.id) ours = null;
    else if (g === null || g.amountMinor !== ours.amount_minor || (g.ourId !== null && g.ourId !== ours.id))
      return quiet("processed", ours.status === "failed" ? "refund_settled" : "refund_not_found");
    else if (ours.status !== "failed") {
      await applyGatewayRefund(env, ours, g, now, "webhook");
      return quiet("processed", "refund_moved");
    } else if (g.state === "failed") return quiet("processed", "refund_settled");
    else {
      // L43 (finding 1c): a refund we marked failed that the gateway shows as made or on its way: a review item and the owners' bell, never a quiet "settled".
      const failed = ours;
      const opened = await openRefundItem(env, failed, "refund_after_failed", now, {
        actor: "webhook",
        webhookEventId: row.id,
        summary: { gatewayState: g.state, eventId: row.id },
        after: (gs) => [
          webhookEventMoveStatement(
            db,
            { id: row.id, status: "needs_review", outcome: "refund_after_failed", now },
            gs,
          ),
        ],
      });
      return opened ? { result: "needs_review" } : quiet("processed", "refund_after_failed_known");
    }
  }
  // PayPal's refund of nobody's refund here keeps M6.4's own path (`processPayPalEvent`: the payment by its capture, the invoice tail check, the item).
  if (provider === "paypal") return null;
  if (!payment) return quiet("ignored", "not_ours");
  // Stripe's `charge.refunded` names no refund and carries the charge's running total (`amount_refunded`): it never opens an item (second review, M3). A refund
  // of ours moves by its own `refund.*` events; a refund made in Stripe's dashboard arrives as `refund.created`/`refund.updated` (H3 subscribes them) with its
  // id and its own amount, and becomes the item below. Only logged.
  if (!isDispute && !refundRef) return quiet("processed", "charge_refunded_logged");
  // A refund recorded here already (an outside refund the Owner recorded, a lost dispute): nothing more to say.
  if (refundRef) {
    const known = await db
      .prepare(
        "SELECT 1 FROM payment_refunds INDEXED BY payment_refunds_provider_ref WHERE provider = ?1 AND provider_refund_id = ?2",
      )
      .bind(provider, refundRef)
      .first();
    if (known) return quiet("processed", "refund_recorded");
  }
  const kind = isDispute
    ? row.event_type.endsWith(".closed")
      ? "dispute_closed"
      : "dispute_opened"
    : "refunded_outside";
  const amount =
    typeof f.amountMinor === "number" && f.amountMinor > 0 ? f.amountMinor : payment.amount_minor;
  const reviewId = uuidv7();
  // Second review, M3: one item per (provider, the gateway's refund or dispute id) and kind, open or resolved: a dashboard refund sends `refund.created` then
  // `refund.processed` (Razorpay) or `refund.created` then `refund.updated` (Stripe), each its own event. The payment is the provider's own row, so the payment
  // and the id name one refund. A later event of a known one writes nothing (no item, no bell) and is marked processed.
  const opened = await mutateSystem(env, {
    actorType: "webhook",
    main: reviewItemStatement(
      db,
      {
        id: reviewId,
        source: "webhook",
        provider,
        kind,
        webhookEventId: row.id,
        paymentId: payment.id,
        documentId: payment.document_id,
        clientId: payment.client_id,
        amountMinor: amount,
        currency: payment.currency,
        facts: {
          linkId: "",
          paymentId: paymentRef ?? "",
          ...(refundRef ? { refundId: refundRef } : {}),
          ...(text(f.status) ? { status: text(f.status) as string } : {}),
        },
        now,
      },
      refundRef ? refundItemOnceGuard({ paymentId: payment.id, kind, refundId: refundRef }) : undefined,
    ),
    action: "payment.gateway_review",
    entityType: "webhook_event",
    entityId: row.id,
    summary: { kind, reviewId, eventId: row.id, paymentId: payment.id },
    side: (g) => [
      reviewBellStatement(
        db,
        {
          reviewId,
          title: bellNeedsReview(
            reviewReason(kind, { provider, currency: payment.currency, paidMinor: amount }),
          ),
          link: REVIEW_LINK,
        },
        g,
      ),
      webhookEventMoveStatement(db, { id: row.id, status: "needs_review", outcome: kind, now }, g),
    ],
  });
  return opened ? { result: "needs_review" } : quiet("processed", `${kind}_known`);
}
