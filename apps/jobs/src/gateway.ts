// The M6.2 gateway family on the leads queue (run file D, L9): routed from queue.ts BEFORE the lead fall-through, so a body of this family (valid or not) can never
// become a lead. One unit of work per message:
//   - `gateway.event {eventId}`: the finance Worker's `GatewayEvents.processEvent`; `retry` comes back with a growing delay, `next` queues `gateway.advance`;
//   - `gateway.advance {paymentId}`: `issueGatewayAdvance` (its own message, L6); a blocker is the finance Worker's review item, so it is acknowledged;
//   - `gateway.sweep {asOf}` (one per hourly tick): up to 20 events still `received` 15 minutes after they arrived, fewer than 10 tries, queued again.
// A message that runs out of tries on the dead-letter queue writes `gatewayDeadLetterStatements`: the event `failed` with a `dead_letter` item, or a `dead_letter`
// item for the pending payment, and the owners' bell.
import { gatewayAdvanceMessage, gatewayEventMessage, gatewaySweepMessage } from "@techaust/core";
import { uuidv7 } from "@techaust/core/ids";
import { gatewayDeadLetterStatements, STUCK_EVENTS_SQL, SWEEP_AFTER_MS } from "@techaust/db/gateway";
import { adminGateway } from "./gateway-rpc.ts";
import { logEvent } from "./log.ts";

/** The bell of a dead-lettered gateway message (07-ZI S20 and S22: "A payment needs review: {reason}."; staff words, lead under the owner's delegation). */
export const DEAD_LETTER_BELL =
  "A payment needs review: Razorpay couldn't be reached to confirm this payment. Try again.";
export const REVIEW_LINK = "/payments?tab=review";

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
      const r = await adminGateway(env).issueGatewayAdvance({ paymentId: m.data.paymentId });
      logEvent("gateway.advance", { r: r.result });
      return "ack";
    }
    default: {
      const m = gatewaySweepMessage.safeParse(body);
      if (!m.success) return skip(body.kind);
      const { results } = await env.DB.prepare(STUCK_EVENTS_SQL)
        .bind(now - SWEEP_AFTER_MS)
        .all<{ id: string }>();
      if (results.length > 0)
        await env.LEADS_QUEUE.sendBatch(
          results.map((r) => ({ body: { kind: "gateway.event", eventId: r.id } })),
        );
      logEvent("gateway.sweep", { count: results.length });
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
    if (m.success)
      await env.DB.batch(
        gatewayDeadLetterStatements(env.DB, {
          kind: "event",
          eventId: m.data.eventId,
          reviewId: uuidv7(),
          now,
          bell,
        }),
      );
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
