// A refund's life after its first batch (M6.5; ADM-PAY-08, ADM-PAY-11; run file C steps 3 and 4, D, L8, L33, L36, L37): the gateway's word applied to our row
// (batch 2), the check that finds a refund whose answer was lost and adopts it (`checkRefund`: the hourly sweep's `refund.check` through `GatewayEvents`, the
// Owner's "Try again"), and the `refund_stuck` / `refund_failed` review items. Shared by the refund routes (refunds.ts), the RPC entrypoint (finance.ts) and the
// refund events (gateway/refund-events.ts). Nothing is ever marked refunded on a redirect: every move here follows the gateway's own answer.
import type { CheckRefundResult } from "@techaust/core/gateway-rpc";

/** What a check found (the routes read `status`; the RPC answers `toCheckRefundResult`). */
export type RefundCheck = {
  readonly result:
    | "not_found"
    | "not_open"
    | "unavailable"
    | "live_not_allowed"
    | "retry"
    | "stuck"
    | "moved";
  readonly status?: string;
};

/** The RPC answer of a check (core `CHECK_REFUND_RESULTS`): a move says where the refund went; a blocked or unset gateway is left for the next sweep. */
export const toCheckRefundResult = (r: RefundCheck): CheckRefundResult =>
  r.result === "moved"
    ? { result: r.status === "succeeded" ? "succeeded" : r.status === "failed" ? "failed" : "unchanged" }
    : r.result === "unavailable" || r.result === "live_not_allowed"
      ? { result: "unchanged" }
      : { result: r.result };

import { istDate, toIsoDate } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import type { GatewayRefund } from "@techaust/core/refund-gateways";
import { reviewBellStatement, reviewItemStatement } from "@techaust/db/gateway";
import {
  pendingRefundedRejectStatement,
  REFUND_READ_SQL,
  refundAttemptStatement,
  refundMoveStatement,
} from "@techaust/db/refunds";
import { REVIEW_LINK } from "./gateway/consts.ts";
import { bellNeedsReview, reviewReason } from "./gateway/messages.ts";
import { type RefundGw, refundGwOf } from "./gateway/refund-gw.ts";
import { mutateSystem } from "./system.ts";

/** After this many checks with no final answer, the refund becomes a `refund_stuck` review item (C, `checkRefund`). */
export const REFUND_STUCK_ATTEMPTS = 10;

export type RefundRow = {
  id: string;
  payment_id: string;
  client_id: string;
  document_id: string | null;
  credit_note_id: string | null;
  provider: string;
  origin: string;
  status: string;
  mode: string | null;
  paid_to: string | null;
  reason_code: string;
  currency: "INR" | "USD";
  amount_minor: number;
  inr_refunded_minor: number | null;
  reference_norm: string | null;
  paid_on: string | null;
  provider_refund_id: string | null;
  provider_status: string | null;
  failure_code: string | null;
  requested_by: string | null;
  requested_at: number;
  attempts: number;
  last_attempt_at: number | null;
  settled_at: number | null;
  settled_on: string | null;
  updated_at: number;
  provider_payment_id?: string | null;
  payment_status?: string;
  payment_amount_minor?: number;
};

export const readRefund = (db: D1Database, id: string) =>
  db.prepare(REFUND_READ_SQL).bind(id).first<RefundRow>();

const istDay = (now: number) => toIsoDate(istDate(now));
const toStatus = (r: GatewayRefund): "processing" | "succeeded" | "failed" =>
  r.state === "processed" ? "succeeded" : r.state === "failed" ? "failed" : "processing";

/**
 * Batch 2 (C step 3; 2 statements, 3 when a pending payment's full refund succeeded): the refund moves by the gateway's answer, with an audit row by the system;
 * a pending payment refunded in full is rejected in the same batch (L33, early check 1 "part 2 must carry" 1); a failure leaves the money as credit (L8) and raises
 * a `refund_failed` review item with a bell. Zero rows (already moved, a replay) writes nothing. Answers the status the row now has.
 */
export async function applyGatewayRefund(
  env: { DB: D1Database },
  row: RefundRow,
  g: GatewayRefund,
  now: number,
  actor: "system" | "webhook" = "system",
): Promise<string> {
  const to = toStatus(g);
  const db = env.DB;
  if (row.status === to || row.status === "succeeded" || row.status === "failed") return row.status;
  if (row.status === "processing" && to === "processing") return row.status;
  const reviewId = uuidv7();
  const pendingSource = row.document_id === null && row.payment_status === "pending_verification";
  await mutateSystem(env, {
    actorType: actor,
    main: refundMoveStatement(db, {
      refundId: row.id,
      to,
      providerRefundId: g.refundRef === "" ? null : g.refundRef,
      providerStatus: g.state,
      failureCode: to === "failed" ? (g.failureCode ?? "gateway_failed") : null,
      now,
      today: istDay(now),
    }),
    action: "refund.status",
    entityType: "refund",
    entityId: row.id,
    summary: { refundId: row.id, paymentId: row.payment_id, status: to },
    side: (gs) => [
      ...(to === "succeeded" && pendingSource
        ? [pendingRefundedRejectStatement(db, { refundId: row.id, now }, gs)]
        : []),
      ...(to === "failed" ? refundReview(db, row, "refund_failed", reviewId, now, gs) : []),
    ],
  });
  return (await readRefund(db, row.id))?.status ?? row.status;
}

/** A refund review item (`refund_failed`, `refund_stuck`) and its owners' bell, guarded on the batch's audit row. */
export function refundReview(
  db: D1Database,
  row: Pick<
    RefundRow,
    "id" | "payment_id" | "client_id" | "document_id" | "provider" | "amount_minor" | "currency"
  >,
  kind: "refund_failed" | "refund_stuck",
  reviewId: string,
  now: number,
  g: Parameters<typeof reviewItemStatement>[2],
): D1PreparedStatement[] {
  const provider = row.provider === "stripe" || row.provider === "paypal" ? row.provider : "razorpay";
  return [
    reviewItemStatement(
      db,
      {
        id: reviewId,
        source: "refresh",
        provider,
        kind,
        webhookEventId: null,
        paymentId: row.payment_id,
        documentId: row.document_id,
        clientId: row.client_id,
        amountMinor: row.amount_minor,
        currency: row.currency,
        facts: { linkId: "", refundId: row.id },
        now,
      },
      g,
    ),
    reviewBellStatement(
      db,
      {
        reviewId,
        title: bellNeedsReview(
          reviewReason(kind, { provider, currency: row.currency, paidMinor: row.amount_minor }),
        ),
        link: REVIEW_LINK,
      },
      g,
    ),
  ];
}

/** One more check counted with no move; at the tenth, a `refund_stuck` item and a bell (C `checkRefund`). */
async function countAttempt(env: { DB: D1Database }, row: RefundRow, now: number): Promise<RefundCheck> {
  const db = env.DB;
  if (row.attempts + 1 < REFUND_STUCK_ATTEMPTS) {
    await refundAttemptStatement(db, { refundId: row.id, now }).run();
    return { result: "retry" };
  }
  await mutateSystem(env, {
    main: refundAttemptStatement(db, { refundId: row.id, now }),
    action: "refund.status",
    entityType: "refund",
    entityId: row.id,
    summary: { refundId: row.id, stuck: true },
    side: (gs) =>
      row.attempts + 1 === REFUND_STUCK_ATTEMPTS
        ? refundReview(db, row, "refund_stuck", uuidv7(), now, gs)
        : [],
  });
  return { result: "stuck" };
}

/**
 * `checkRefund` (C; L37): the refund as the gateway holds it, by its id or by ours; found → our row follows it (`applyGatewayRefund`); not there and still
 * `requested` with no gateway id → posted again with the same idempotency key when `repost` (the Owner's "Try again" and the sweep: the gateway showed none, so
 * a second refund can't follow); a network failure or no answer → one more attempt counted (the tenth raises `refund_stuck`). Every fetch passes the live guard
 * first: a blocked gateway is never called (`live_not_allowed`).
 */
export async function checkRefund(
  env: { DB: D1Database },
  refundId: string,
  now = Date.now(),
  opts: { repost: boolean; gw?: RefundGw | null } = { repost: true },
): Promise<RefundCheck> {
  const row = await readRefund(env.DB, refundId);
  if (!row) return { result: "not_found" };
  if (row.status !== "requested" && row.status !== "processing")
    return { result: "not_open", status: row.status };
  if (row.provider === "manual" || !row.provider_payment_id)
    return { result: "not_open", status: row.status };
  const gw = opts.gw === undefined ? await refundGwOf(env, row.provider) : opts.gw;
  if (!gw) return { result: "unavailable" };
  if (gw.blocked) return { result: gw.blocked === "live_not_allowed" ? "live_not_allowed" : "unavailable" };
  const found = await gw.find({
    paymentRef: row.provider_payment_id,
    refundId: row.id,
    refundRef: row.provider_refund_id,
  });
  if (!found.ok) return countAttempt(env, row, now);
  let answer: GatewayRefund | null = found.value === "unknown" ? null : found.value;
  if (answer === null && opts.repost && row.status === "requested" && row.provider_refund_id === null) {
    const created = await gw.create({
      paymentRef: row.provider_payment_id,
      amountMinor: row.amount_minor,
      refundId: row.id,
      paymentId: row.payment_id,
    });
    if (!created.ok) {
      if (created.code === "refused") {
        const status = await applyGatewayRefund(
          env,
          row,
          {
            refundRef: row.provider_refund_id ?? "",
            paymentRef: null,
            amountMinor: row.amount_minor,
            currency: row.currency,
            state: "failed",
            ourId: row.id,
            failureCode: `refused_${created.status ?? 400}`,
          },
          now,
        );
        return { result: "moved", status };
      }
      return countAttempt(env, row, now);
    }
    answer = created.value;
  }
  if (
    answer === null ||
    answer.amountMinor !== row.amount_minor ||
    (answer.ourId !== null && answer.ourId !== row.id)
  )
    return countAttempt(env, row, now);
  const status = await applyGatewayRefund(env, row, answer, now);
  return { result: status === row.status ? "retry" : "moved", status };
}
