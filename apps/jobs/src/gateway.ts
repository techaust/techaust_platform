// The M6.2 gateway family on the leads queue (run file D, L9): routed from queue.ts BEFORE the lead fall-through, so a body of this family (valid or not) can never
// become a lead. One unit of work per message:
//   - `gateway.event {eventId}`: the finance Worker's `GatewayEvents.processEvent`; `retry` comes back with a growing delay, `next` queues `gateway.advance`;
//   - `gateway.advance {paymentId}`: `issueGatewayAdvance` (its own message, L6); a blocker is the finance Worker's review item, so it is acknowledged; `retry` (the
//     proforma changed meanwhile) comes back once, then the last try (`lastTry`) turns a second change into `blocked`;
//   - `gateway.sweep {asOf}` (one per hourly tick): up to 20 events still `received` 15 minutes after they arrived, fewer than 10 tries, and up to 20 proforma
//     payments still waiting for their tax invoice 15 minutes after they were recorded, queued again.
// A message that runs out of tries on the dead-letter queue writes `gatewayDeadLetterStatements`: the event `failed` with a `dead_letter` item, or a `dead_letter`
// item for the pending payment, and the owners' bell.
import {
  gatewayAdvanceMessage,
  gatewayEventMessage,
  gatewayRefreshMessage,
  gatewaySweepMessage,
} from "@techaust/core";
import { uuidv7 } from "@techaust/core/ids";
import {
  gatewayDeadLetterStatements,
  STALE_LIVE_AFTER_MS,
  STALE_LIVE_CHECKOUTS_SQL,
  STUCK_ADVANCES_SQL,
  STUCK_EVENTS_SQL,
  SWEEP_AFTER_MS,
} from "@techaust/db/gateway";
import { adminGateway } from "./gateway-rpc.ts";
import { logEvent } from "./log.ts";

/** The bell of a dead-lettered gateway message (07-ZI S20 and S22: "A payment needs review: {reason}."; staff words, lead under the owner's delegation). */
export const DEAD_LETTER_BELL =
  "A payment needs review: Razorpay couldn't be reached to confirm this payment. Try again.";
/** M6.3: the same bell for a Stripe event (07-ZM S19). */
export const DEAD_LETTER_BELL_STRIPE =
  "A payment needs review: Stripe couldn't be reached to confirm this payment. Try again.";
export const REVIEW_LINK = "/payments?tab=review";

/** A `gateway.advance` is tried at most this many times for a proforma that changed meanwhile (early check 2, finding 1). */
export const ADVANCE_TRIES = 2;

/** How long a `retry` waits: 1 minute, doubling, at most 1 hour (Razorpay's API down, a payment it has not settled yet). */
export const gatewayRetryDelay = (attempts: number): number =>
  Math.min(3_600, 60 * 2 ** Math.max(0, attempts - 1));

export type GatewayVerdict = "ack" | { retry: number };

/** One body of the gateway family (`isGatewayKind` already said so). */
export async function processGateway(
  env: Pick<Env, "DB" | "LEADS_QUEUE">,
  body: { kind: string },
  attempts: number,
  now = Date.now(),
): Promise<GatewayVerdict> {
  switch (body.kind) {
    case "gateway.event": {
      const m = gatewayEventMessage.safeParse(body);
      if (!m.success) return skip(body.kind);
      const r = await adminGateway(env).processEvent({ eventId: m.data.eventId });
      if (r.result === "retry") return { retry: gatewayRetryDelay(attempts) };
      if (r.next) await env.LEADS_QUEUE.send({ kind: "gateway.advance", paymentId: r.next.paymentId });
      logEvent("gateway.event", { r: r.result });
      return "ack";
    }
    case "gateway.advance": {
      const m = gatewayAdvanceMessage.safeParse(body);
      if (!m.success) return skip(body.kind);
      // Early check 2, finding 1: one try per invocation; a proforma that changed meanwhile comes back once (`retry`), and the second delivery is the last try
      // (a second change is `blocked`: the Owner's review item).
      const lastTry = attempts >= ADVANCE_TRIES;
      const r = await adminGateway(env).issueGatewayAdvance({ paymentId: m.data.paymentId, lastTry });
      logEvent("gateway.advance", { r: r.result });
      if (r.result === "retry" && !lastTry) return { retry: gatewayRetryDelay(attempts) };
      return "ack";
    }
    case "gateway.refresh": {
      // M6.3 (L13, L14): one checkout past its expiry re-fetched from its gateway; only the gateway's word ends it (L6). A `retry` comes back later.
      const m = gatewayRefreshMessage.safeParse(body);
      if (!m.success) return skip(body.kind);
      const r = await adminGateway(env).refreshCheckout({ checkoutId: m.data.checkoutId });
      logEvent("gateway.refresh", { r: r.result });
      return r.result === "retry" ? { retry: gatewayRetryDelay(attempts) } : "ack";
    }
    default: {
      const m = gatewaySweepMessage.safeParse(body);
      if (!m.success) return skip(body.kind);
      // Events still `received`, and (early check 2, finding 2) proforma payments still waiting for their tax invoice: a lost `next` is found within the hour.
      // M6.3 (L13): and up to 10 live Stripe sessions 15 minutes past their expiry, each refreshed by its own `gateway.refresh` (one unit of work per message).
      const [events, advances, stale] = await env.DB.batch([
        env.DB.prepare(STUCK_EVENTS_SQL).bind(now - SWEEP_AFTER_MS),
        env.DB.prepare(STUCK_ADVANCES_SQL).bind(now - SWEEP_AFTER_MS),
        env.DB.prepare(STALE_LIVE_CHECKOUTS_SQL).bind(now - STALE_LIVE_AFTER_MS),
      ]);
      const ev = (events?.results ?? []) as { id: string }[];
      const adv = (advances?.results ?? []) as { id: string }[];
      const old = (stale?.results ?? []) as { id: string }[];
      const out = [
        ...ev.map((r) => ({ body: { kind: "gateway.event", eventId: r.id } })),
        ...adv.map((r) => ({ body: { kind: "gateway.advance", paymentId: r.id } })),
        ...old.map((r) => ({ body: { kind: "gateway.refresh", checkoutId: r.id } })),
      ];
      if (out.length > 0) await env.LEADS_QUEUE.sendBatch(out);
      logEvent("gateway.sweep", { count: ev.length, advances: adv.length, refreshes: old.length });
      return "ack";
    }
  }
}

function skip(kind: string): GatewayVerdict {
  logEvent("gateway.invalid_message", { kind });
  return "ack";
}

/** A gateway message that ran out of tries: the record and the owners' bell (a redelivery adds nothing). Sweeps only log: the next tick lists them again. */
export async function processGatewayDeadLetter(
  env: Pick<Env, "DB">,
  body: { kind: string },
  now = Date.now(),
): Promise<void> {
  const bell = { title: DEAD_LETTER_BELL, link: REVIEW_LINK };
  if (body.kind === "gateway.event") {
    const m = gatewayEventMessage.safeParse(body);
    if (m.success) {
      // M6.3: the bell names the event's own gateway (07-ZM S19: the M6.2 line with the gateway's name).
      const row = await env.DB.prepare("SELECT provider FROM webhook_events WHERE id = ?1")
        .bind(m.data.eventId)
        .first<{ provider: string }>();
      await env.DB.batch(
        gatewayDeadLetterStatements(env.DB, {
          kind: "event",
          eventId: m.data.eventId,
          reviewId: uuidv7(),
          now,
          bell: row?.provider === "stripe" ? { title: DEAD_LETTER_BELL_STRIPE, link: REVIEW_LINK } : bell,
        }),
      );
    }
  } else if (body.kind === "gateway.advance") {
    const m = gatewayAdvanceMessage.safeParse(body);
    if (m.success)
      await env.DB.batch(
        gatewayDeadLetterStatements(env.DB, {
          kind: "payment",
          paymentId: m.data.paymentId,
          reviewId: uuidv7(),
          now,
          bell,
        }),
      );
  }
  logEvent("gateway.dead_letter", { kind: body.kind });
}
