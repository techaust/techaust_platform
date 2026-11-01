// `GatewayEvents.processEvent({eventId})` (M6.2; JOB-HOOK-01..03, ADM-PAY-02, -07; run file C steps 1 to 8): one stored, verified webhook event, dispatched by the
// row's own `provider` (Razorpay only in M6.2; M6.3 and M6.4 add theirs here). The jobs Worker's queue consumer calls it; each call is one unit of work. The
// event row holds only whitelisted facts (L8; 08-C RB-40): the link and payment ids are read from there, everything else is re-fetched from Razorpay.
import type { ProcessEventResult } from "@techaust/core/gateway-rpc";
import {
  checkoutEndStatement,
  EVENT_ADVANCE_WAITING_SQL,
  WEBHOOK_EVENT_READ_SQL,
  webhookEventAttemptStatement,
  webhookEventMoveStatement,
} from "@techaust/db/gateway";
import { gatewayModeOf, razorpayOf } from "./config.ts";
import type { RazorpayApi } from "./razorpay.ts";
import {
  type CheckoutRow,
  checkoutForLink,
  endCheckout,
  type GatewayEnv,
  reviewOnly,
  settlePayment,
} from "./settle.ts";

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
 * link stays `stale`; if it is paid later the money is recorded pending with a `document_not_payable` item for the Owner: L4 as amended by the lead, 2026-11-01).
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

/**
 * A `next` met inside the finance Worker (the portal's refresh, the admin refresh, "Try again"; early check 2, finding 2): `gateway.advance` goes on the leads
 * queue (the producer binding `LEADS_QUEUE`, finance's own: wrangler.finance.jsonc), one unit of work per message as from the jobs consumer. Running the advance
 * here would put two RPCs' statements in one invocation. A missing binding or a failed send is logged by code only: the hourly sweep finds the payment
 * (`STUCK_ADVANCES_SQL`). Answers whether the message was sent.
 */
export async function sendNext(env: object, next: ProcessEventResult["next"]): Promise<boolean> {
  if (!next) return false;
  const queue: unknown = Reflect.get(env, "LEADS_QUEUE");
  const send: unknown = typeof queue === "object" && queue !== null ? Reflect.get(queue, "send") : undefined;
  if (typeof send !== "function") {
    console.log(JSON.stringify({ ev: "gw", m: "next_not_sent", code: "no_queue" }));
    return false;
  }
  try {
    await Reflect.apply(send, queue, [{ kind: "gateway.advance", paymentId: next.paymentId }]);
    return true;
  } catch {
    console.log(JSON.stringify({ ev: "gw", m: "next_not_sent", code: "send_failed" }));
    return false;
  }
}

/** One event. Answers `duplicate` for an event no longer waiting, `retry` for a transient failure (the consumer retries with backoff). */
export async function processEvent(
  env: GatewayEnv,
  eventId: string,
  now = Date.now(),
): Promise<ProcessEventResult> {
  const db = env.DB;
  const [, read, waiting] = await db.batch([
    webhookEventAttemptStatement(db, eventId),
    db.prepare(WEBHOOK_EVENT_READ_SQL).bind(eventId),
    db.prepare(EVENT_ADVANCE_WAITING_SQL).bind(eventId),
  ]);
  const row = read?.results[0] as EventRow | undefined;
  // (1) a redelivered or already handled event; when its proforma payment still waits for the tax invoice (a lost `next`, a failed send), `next` again
  // (early check 2, finding 2).
  if (row?.status !== "received") {
    const w = waiting?.results[0] as { id: string } | undefined;
    return w
      ? { result: "duplicate", next: { kind: "gateway.advance", paymentId: w.id } }
      : { result: "duplicate" };
  }
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
  // Early check 2, finding 3: a verified event of a handled type whose link id couldn't be read (the hook kept it from a lenient read) is never dropped: a
  // review item names it, with the event name only.
  if (!linkId)
    return reviewOnly(
      env,
      { cause: { kind: "event", eventId: row.id }, now, linkId: null },
      "unreadable_event",
      { documentId: null, clientId: null, amountMinor: null },
      { event: row.event_type },
    );
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
