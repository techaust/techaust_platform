// A refund's life after its first batch (M6.5; ADM-PAY-08, ADM-PAY-11; run file C steps 3 and 4, D, L8, L33, L36, L37, L42 to L44): the gateway's word applied
// to our row (batch 2), the check that finds a refund whose answer was lost and adopts it (`checkRefund`: the hourly sweep's `refund.check` through
// `GatewayEvents`, the Owner's "Try again"), and the `refund_stuck` / `refund_failed` / `refund_after_failed` review items. Shared by the refund routes
// (refunds.ts), the RPC entrypoint (finance.ts) and the refund events (gateway/refund-events.ts). Nothing is ever marked refunded on a redirect: every move here
// follows the gateway's own answer.
//
// Early check 2, finding 1 (money out twice): a refused RE-POST never marks a refund failed (the first request may still complete: Stripe answers 409 while its
// idempotency key is in progress, Razorpay 400 for a used `receipt`); the gateway is asked once more and the refund adopted if found, else one more check is
// counted. A re-post (and a cancel, refunds.ts) runs only once the refund is idle (`refundIdleAt`, L44); a PayPal refund is posted again only while its first
// request is under an hour old (L42); a refund we marked failed that the gateway shows as made opens `refund_after_failed` (L43).
//
// Review part 1, finding 1 (a refund paid out twice when Cancel races a re-post): a re-post first CLAIMS the row (`refundRepostClaimStatement`: one more attempt
// and `last_attempt_at` = now, compare-and-set on the `last_attempt_at` it read) and posts only when that one row changed; Cancel binds the `last_attempt_at` it
// read, so a claim in between leaves it with nothing to write (409 `too_soon`); and a move that writes nothing because the row was failed meanwhile, while the
// gateway shows the refund made or on its way, opens `refund_after_failed` (L43) instead of passing silently.
import { istDate, toIsoDate } from "@techaust/core/dates";
import {
  type CheckRefundResult,
  PAYPAL_REPOST_MAX_AGE_MS,
  REFUND_CHECK_MAX_ATTEMPTS,
  REFUND_SWEEP_IDLE_MS,
} from "@techaust/core/gateway-rpc";
import { uuidv7 } from "@techaust/core/ids";
import type { GatewayRefund } from "@techaust/core/refund-gateways";
import { reviewBellStatement, reviewItemStatement } from "@techaust/db/gateway";
import {
  type GuardSql,
  pendingRefundedRejectStatement,
  REFUND_READ_SQL,
  refundAttemptStatement,
  refundItemOnceGuard,
  refundMoveStatement,
  refundRepostClaimStatement,
} from "@techaust/db/refunds";
import { REVIEW_LINK } from "./gateway/consts.ts";
import { bellNeedsReview, reviewReason } from "./gateway/messages.ts";
import { type RefundGw, refundGwOf } from "./gateway/refund-gw.ts";
import { mutateSystem } from "./system.ts";

/** What a check found (the routes read `status`; the RPC answers `toCheckRefundResult`). */
export type RefundCheck = {
  readonly result:
    | "not_found"
    | "not_open"
    | "unavailable"
    | "live_not_allowed"
    | "retry"
    | "stuck"
    | "moved"
    // Early check 2, finding 2: the gateway still holds the refund as it was (one more check counted, no move).
    | "unchanged"
    // L44: a re-post was due but the refund isn't idle yet (`refundIdleAt`); nothing was sent.
    | "too_soon";
  readonly status?: string;
};

/** The RPC answer of a check (core `CHECK_REFUND_RESULTS`): a move says where the refund went; a blocked or unset gateway is left for the next sweep. */
export const toCheckRefundResult = (r: RefundCheck): CheckRefundResult =>
  r.result === "moved"
    ? { result: r.status === "succeeded" ? "succeeded" : r.status === "failed" ? "failed" : "unchanged" }
    : r.result === "unavailable" || r.result === "live_not_allowed" || r.result === "too_soon"
      ? { result: "unchanged" }
      : { result: r.result };

/** After this many checks with no final answer, the refund becomes a `refund_stuck` review item (C, `checkRefund`). */
export const REFUND_STUCK_ATTEMPTS = REFUND_CHECK_MAX_ATTEMPTS;

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

/**
 * L44 (early check 2, finding 1b): the first instant a refund may be posted to its gateway again or cancelled: `REFUND_SWEEP_IDLE_MS` after BOTH its request and
 * its last check, so an answer still on its way (a 202, a webhook) is never overtaken. Before it the routes answer 409 `too_soon` with `retryAfterS`.
 */
export const refundIdleAt = (r: Pick<RefundRow, "requested_at" | "last_attempt_at">): number =>
  Math.max(r.requested_at, r.last_attempt_at ?? r.requested_at) + REFUND_SWEEP_IDLE_MS;

/** Whole seconds until `refundIdleAt` (at least 1), for 409 `too_soon`. */
export const retryAfterSeconds = (r: Pick<RefundRow, "requested_at" | "last_attempt_at">, now: number) =>
  Math.max(1, Math.ceil((refundIdleAt(r) - now) / 1000));

const istDay = (now: number) => toIsoDate(istDate(now));
const toStatus = (r: GatewayRefund): "processing" | "succeeded" | "failed" =>
  r.state === "processed" ? "succeeded" : r.state === "failed" ? "failed" : "processing";
const providerOf = (p: string): "razorpay" | "stripe" | "paypal" =>
  p === "stripe" || p === "paypal" ? p : "razorpay";

type ReviewRow = Pick<
  RefundRow,
  "id" | "payment_id" | "client_id" | "document_id" | "provider" | "amount_minor" | "currency"
>;
type RefundItemKind = "refund_failed" | "refund_stuck" | "refund_after_failed";

/**
 * A refund review item (`refund_failed`, `refund_stuck`, `refund_after_failed`) and its owners' bell: the item once per refund and kind
 * (`refundItemOnceGuard`), the bell only when the item was written. Guarded on the batch's guard when `g` is given.
 */
export function refundReview(
  db: D1Database,
  row: ReviewRow,
  kind: RefundItemKind,
  reviewId: string,
  now: number,
  g?: GuardSql,
  extra: { webhookEventId?: string | null; source?: "refresh" | "webhook" | "dlq" } = {},
): D1PreparedStatement[] {
  const provider = providerOf(row.provider);
  return [
    reviewItemStatement(
      db,
      {
        id: reviewId,
        source: extra.source ?? "refresh",
        provider,
        kind,
        webhookEventId: extra.webhookEventId ?? null,
        paymentId: row.payment_id,
        documentId: row.document_id,
        clientId: row.client_id,
        amountMinor: row.amount_minor,
        currency: row.currency,
        facts: { linkId: "", refundId: row.id },
        now,
      },
      refundItemOnceGuard({ paymentId: row.payment_id, refundId: row.id, kind }, g),
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

/**
 * Opens a refund review item in its own batch (the item first, so the audit row and the bell are written only when the item was new: early check 2, finding 2,
 * no item and no bell every hour). `before` runs first and unguarded (one more check counted); `after` is guarded on the audit row (an event's own move). True
 * when the item was opened.
 */
export async function openRefundItem(
  env: { DB: D1Database },
  row: ReviewRow,
  kind: RefundItemKind,
  now: number,
  o: {
    before?: D1PreparedStatement[];
    after?: (g: GuardSql) => D1PreparedStatement[];
    actor?: "system" | "webhook";
    webhookEventId?: string | null;
    summary?: Record<string, unknown>;
  } = {},
): Promise<boolean> {
  const db = env.DB;
  const reviewId = uuidv7();
  const [item, bell] = refundReview(db, row, kind, reviewId, now, undefined, {
    webhookEventId: o.webhookEventId ?? null,
    source: o.actor === "webhook" ? "webhook" : "refresh",
  }) as [D1PreparedStatement, D1PreparedStatement];
  return mutateSystem(env, {
    actorType: o.actor ?? "system",
    main: [...(o.before ?? []), item],
    action: "payment.gateway_review",
    entityType: "refund",
    entityId: row.id,
    summary: { kind, reviewId, refundId: row.id, paymentId: row.payment_id, ...(o.summary ?? {}) },
    side: (g) => [bell, ...(o.after?.(g) ?? [])],
  });
}

/**
 * Batch 2 (C step 3; 2 statements, 3 when a pending payment's full refund succeeded): the refund moves by the gateway's answer, with an audit row by the system;
 * a pending payment refunded in full is rejected in the same batch (L33, early check 1 "part 2 must carry" 1); a failure leaves the money as credit (L8) and raises
 * a `refund_failed` review item with a bell. Zero rows (already moved, a replay) writes nothing. A refund we marked `failed` that the gateway shows as made or on its
 * way never moves (its money is credit again): it opens `refund_after_failed` with the owners' bell (L43). Answers the status the row now has.
 */
export async function applyGatewayRefund(
  env: { DB: D1Database },
  row: RefundRow,
  g: GatewayRefund,
  now: number,
  actor: "system" | "webhook" = "system",
  webhookEventId: string | null = null,
): Promise<string> {
  const to = toStatus(g);
  const db = env.DB;
  const afterFailed = async (failed: RefundRow) => {
    await openRefundItem(env, failed, "refund_after_failed", now, {
      actor,
      webhookEventId,
      summary: { gatewayState: g.state },
    });
    return failed.status;
  };
  if (row.status === "failed" && to !== "failed") return afterFailed(row);
  if (row.status === to || row.status === "succeeded" || row.status === "failed") return row.status;
  if (row.status === "processing" && to === "processing") return row.status;
  const reviewId = uuidv7();
  const pendingSource = row.document_id === null && row.payment_status === "pending_verification";
  const moved = await mutateSystem(env, {
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
  const fresh = await readRefund(db, row.id);
  // Review part 1, finding 1c: `row` was read before the gateway answered; if the refund was failed meanwhile (a cancel, the first post's refusal) and the gateway
  // shows it made or on its way, the move wrote nothing: the Owner must look (L43), never a silent pass.
  if (!moved && fresh?.status === "failed" && to !== "failed") return afterFailed(fresh);
  return fresh?.status ?? row.status;
}

/**
 * One more check counted with no answer; from the tenth on, a `refund_stuck` item and a bell, once per refund (C `checkRefund`; early check 2, finding 2: the
 * item's own guard, so every later check, the dead-letter queue and L42 never add a second).
 */
async function countAttempt(
  env: { DB: D1Database },
  row: RefundRow,
  now: number,
  /** The re-post's claim already counted this attempt (review part 1, finding 1a): no second count. */
  claimed = false,
): Promise<RefundCheck> {
  const db = env.DB;
  const attempt = claimed ? [] : [refundAttemptStatement(db, { refundId: row.id, now })];
  if (row.attempts + 1 < REFUND_STUCK_ATTEMPTS) {
    for (const s of attempt) await s.run();
    return { result: "retry" };
  }
  await openRefundItem(env, row, "refund_stuck", now, { before: attempt });
  return { result: "stuck" };
}

/** L42: a PayPal refund whose first request is an hour old or more is never posted again blind: one more check counted and `refund_stuck` (once). */
async function stuckNow(env: { DB: D1Database }, row: RefundRow, now: number): Promise<RefundCheck> {
  await openRefundItem(env, row, "refund_stuck", now, {
    before: [refundAttemptStatement(env.DB, { refundId: row.id, now })],
    summary: { paypalRepostCutOff: true },
  });
  return { result: "stuck" };
}

/** The gateway's refund is this one: the same amount, and our id when the gateway echoes one. */
const isOurs = (row: RefundRow, g: GatewayRefund) =>
  g.amountMinor === row.amount_minor && (g.ourId === null || g.ourId === row.id);

/**
 * `checkRefund` (C; L37): the refund as the gateway holds it, by its id or by ours; found → our row follows it (`applyGatewayRefund`); still as it was → one more
 * check counted, `unchanged` (finding 2); not there and still `requested` with no gateway id → posted again with the same idempotency key when `repost` (the
 * Owner's "Try again" and the sweep: the gateway showed none, so a second refund can't follow), only once the refund is idle (L44) and, on PayPal, only while the
 * first request is under an hour old (L42). A refused re-post is never read as a failure (finding 1a): the gateway is asked once more and the refund adopted if
 * found, else one more check is counted. A network failure or no answer → one more attempt counted (from the tenth, `refund_stuck`). Every fetch passes the live
 * guard first: a blocked gateway is never called (`live_not_allowed`).
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
  const lookup = {
    paymentRef: row.provider_payment_id,
    refundId: row.id,
    refundRef: row.provider_refund_id,
  };
  const found = await gw.find(lookup);
  if (!found.ok) return countAttempt(env, row, now);
  let answer: GatewayRefund | null = found.value === "unknown" ? null : found.value;
  let claimed = false;
  if (answer === null && opts.repost && row.status === "requested" && row.provider_refund_id === null) {
    if (now < refundIdleAt(row)) return { result: "too_soon" };
    if (found.value === "unknown" && now - row.requested_at >= PAYPAL_REPOST_MAX_AGE_MS)
      return stuckNow(env, row, now);
    // Review part 1, finding 1a: claim the row before sending (compare-and-set on the `last_attempt_at` read above). Zero rows: a cancel, another re-post or
    // the gateway's word got there first, so nothing is sent (`too_soon`: the RPC acknowledges, the route answers 409).
    const claim = await refundRepostClaimStatement(env.DB, {
      refundId: row.id,
      now,
      seen: row.last_attempt_at,
    }).run();
    if (claim.meta.changes !== 1) return { result: "too_soon" };
    claimed = true;
    const created = await gw.create({
      paymentRef: row.provider_payment_id,
      amountMinor: row.amount_minor,
      refundId: row.id,
      paymentId: row.payment_id,
    });
    if (!created.ok) {
      // Finding 1a: a refusal of a SECOND post is not a failure of the refund (the first may be in progress or done): look once more, adopt it if there.
      if (created.code !== "refused" && created.code !== "not_found")
        return countAttempt(env, row, now, true);
      const again = await gw.find(lookup);
      if (!again.ok || again.value === null || again.value === "unknown")
        return countAttempt(env, row, now, true);
      answer = again.value;
    } else answer = created.value;
  }
  if (answer === null || !isOurs(row, answer)) return countAttempt(env, row, now, claimed);
  if (toStatus(answer) === row.status) {
    // Finding 2: still as it was (a Stripe `pending`, a Razorpay refund in progress): one more check counted (the sweep's idle clock restarts), acknowledged.
    await refundAttemptStatement(env.DB, { refundId: row.id, now }).run();
    return { result: "unchanged", status: row.status };
  }
  const status = await applyGatewayRefund(env, row, answer, now);
  return { result: status === row.status ? "unchanged" : "moved", status };
}
