// `GatewayEvents.processEvent({eventId})` (M6.2; JOB-HOOK-01..03, ADM-PAY-02, -07; run file C steps 1 to 8): one stored, verified webhook event, dispatched by the
// row's own `provider` (Razorpay only in M6.2; M6.3 and M6.4 add theirs here). The jobs Worker's queue consumer calls it; each call is one unit of work. The
// event row holds only whitelisted facts (L8; 08-C RB-40): the link and payment ids are read from there, everything else is re-fetched from Razorpay.
import type { ProcessEventResult } from "@techaust/core/gateway-rpc";
import {
  checkoutEndStatement,
  WEBHOOK_EVENT_READ_SQL,
  webhookEventAttemptStatement,
  webhookEventMoveStatement,
} from "@techaust/db/gateway";
import { gatewayModeOf, razorpayOf } from "./config.ts";
import type { RazorpayApi } from "./razorpay.ts";
import { type CheckoutRow, checkoutForLink, endCheckout, type GatewayEnv, settlePayment } from "./settle.ts";

type EventRow = {
  id: string;
  provider: string;
  event_id: string;
  event_type: string;
  status: string;
  attempts: number;
  facts: string | null;
  received_at: number;
};

const factsOf = (raw: string | null): Record<string, unknown> => {
  try {
    const v = JSON.parse(raw ?? "{}") as unknown;
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const text = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 255 ? v : null);

/**
 * The stale links of a document paid through another link are cancelled at Razorpay after the batch (best effort: a failure is logged by code only, and the
 * link stays `stale`; if it is paid later the money becomes credit, L4).
 */
export function staleCanceller(env: GatewayEnv, api: RazorpayApi, now: number) {
  return async (links: readonly { id: string; linkId: string }[]) => {
    for (const l of links) {
      const r = await api.cancelLink(l.linkId);
      if (r.ok) await checkoutEndStatement(env.DB, { id: l.id, status: "cancelled", now }).run();
      else console.log(JSON.stringify({ ev: "gw", m: "stale_cancel_failed", code: r.code }));
    }
  };
}

/** One event. Answers `duplicate` for an event no longer waiting, `retry` for a transient failure (the consumer retries with backoff). */
export async function processEvent(
  env: GatewayEnv,
  eventId: string,
  now = Date.now(),
): Promise<ProcessEventResult> {
  const db = env.DB;
  const [row] = (
    await db.batch([
      webhookEventAttemptStatement(db, eventId),
      db.prepare(WEBHOOK_EVENT_READ_SQL).bind(eventId),
    ])
  )
    .slice(1)
    .map((r) => r.results[0] as EventRow | undefined);
  // (1) a redelivered or already handled event
  if (row?.status !== "received") return { result: "duplicate" };
  if (row.provider !== "razorpay") {
    await webhookEventMoveStatement(db, {
      id: row.id,
      status: "ignored",
      outcome: "unknown_provider",
      now,
    }).run();
    return { result: "ignored" };
  }
  const facts = factsOf(row.facts);
  const linkId = text(facts.linkId);
  const paymentId = text(facts.paymentId);
  const type = row.event_type;
  if (!linkId) {
    await webhookEventMoveStatement(db, { id: row.id, status: "ignored", outcome: "no_link", now }).run();
    return { result: "ignored" };
  }
  const api = razorpayOf(env, await gatewayModeOf(db));
  if (!api) return { result: "retry" };
  const cause = { kind: "event", eventId: row.id } as const;
  // (2) a link expired or cancelled at Razorpay: our checkout follows (guarded). The link is re-fetched so a forged-looking event cannot end a live link.
  if (type === "payment_link.expired" || type === "payment_link.cancelled") {
    const linkR = await api.fetchLink(linkId);
    if (!linkR.ok)
      return linkR.code === "network" || linkR.code === "unconfigured"
        ? { result: "retry" }
        : endCheckout(env, { cause, checkout: null, status: "expired", now });
    const want = type === "payment_link.expired" ? "expired" : "cancelled";
    const checkout: CheckoutRow | null =
      linkR.value.state === want ? await checkoutForLink(env, linkR.value, now) : null;
    return endCheckout(env, { cause, checkout, status: want, now });
  }
  if (type === "payment_link.paid" || type === "payment_link.partially_paid") {
    return settlePayment(env, { api, linkId, paymentId, cause, now }, staleCanceller(env, api, now));
  }
  await webhookEventMoveStatement(db, { id: row.id, status: "ignored", outcome: "other", now }).run();
  return { result: "ignored" };
}
