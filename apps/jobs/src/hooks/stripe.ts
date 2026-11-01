// The Stripe webhook (M6.3; JOB-HOOK-01..03, ADM-PAY-01; run file docs/runs/m6.3-stripe.md D, L2, L5): `POST /stripe` only. In order, each refusal before any D1
// write unless said:
//   1. a JSON content type (any charset), else 415; a body of at most 64 KiB, read as a stream, else 413;
//   2. `STRIPE_WEBHOOK_SECRET` set, else 503 `hook_unconfigured` (nothing written);
//   3. a `Stripe-Signature` header, else 400 `signature_missing` (NOT counted: anyone can send no header);
//   4. the signature over the RAW bytes received, with the current secret and then `STRIPE_WEBHOOK_SECRET_PREVIOUS` (core `verifyStripeSignature`: stripe-node's
//      algorithm, compared with `crypto.subtle.verify`, never as text); any failure, a timestamp more than 300 s away included (a replay), is 400 and counts one
//      failure in the clock-hour window (`stripe:sig:<hour>`, capped at 50; one owners' bell at 5; never per address);
//   5. only then `JSON.parse` and core `parseStripeEvent`; a body it can't read is 400 `invalid_event`, not counted;
//   6. OURS OR NOT (L5, reviewer L12): the shared Stripe account sends this endpoint the other business's `checkout.session.*` events too (an endpoint filters by
//      event type only, V8). An event in the other mode (`livemode` true while `PAYMENTS_LIVE_ALLOWED` is not "true"), without our marks, or of another of our
//      environments (`techaust_env` ≠ `ENVIRONMENT`) is answered 200 with NO D1 write, no queue, no review and no bell: one log line with the outcome code only;
//   7. ours: `INSERT ... ON CONFLICT (provider, event_id) DO NOTHING` with the whitelisted facts (the event id `evt_…` is inside the signed body, so it is the
//      idempotency key here; the payment row's unique `provider_payment_id` is the second line), the row's state read in the same batch; a new row, or one still
//      `received`, is queued as `gateway.event` on the leads queue; 200 `{ok: true}`. A queue failure is a 500 with the row kept (Stripe retries; the sweep too).
// Never logged: the body, the header, the secret, or anything personal; the row keeps whitelisted facts only (Settled by the lead on the safest reading, 2026-11-02
// (08-C RB-41)). CPU (JOB-HOOK-03, ≤ 5 ms p99): one HMAC over at most 64 KiB (the key imported once per isolate), one parse, two D1 statements, one send; a
// foreign event costs the HMAC and the parse only.
import { uuidv7 } from "@techaust/core/ids";
import { parseStripeEvent, stripeEventFacts, verifyStripeSignature } from "@techaust/core/stripe";
import {
  HOOK_FAILURE_WINDOW_MS,
  hookFailureKey,
  hookFailureStatements,
  WEBHOOK_EVENT_INSERT_SQL,
  WEBHOOK_EVENT_STATE_SQL,
} from "@techaust/db/gateway";
import { logEvent } from "../log.ts";
import { answer, HOOK_MAX_BYTES, isJsonType, readCapped, refuse, secretOf, strictUtf8 } from "./shared.ts";

/** The owners' bell at the fifth failure in a window (07-ZM S17; staff words, lead under the owner's delegation; the finance Worker's copy is held equal by a test). */
export const BELL_SIGNATURES_STRIPE =
  "Stripe webhook signatures failed 5 times in an hour. Check the webhook secret.";

type HookEnv = { DB: D1Database; LEADS_QUEUE: Queue };

/** Whether this isolate answered a Stripe webhook yet (the `f: 1` first-run marker of the staging CPU reading). */
let answeredOnce = false;

/** `POST /stripe`. `now` for tests. One log line per call: `{ev: "hook", p: "stripe", s: <status>, o?: <outcome code>, f: 1 on this isolate's first}`. */
export async function stripeHook(req: Request, env: HookEnv, now = Date.now()): Promise<Response> {
  const f = answeredOnce ? undefined : 1;
  answeredOnce = true;
  let status = 500;
  const out: { o?: string } = {};
  try {
    const res = await handleHook(req, env, now, out);
    status = res.status;
    return res;
  } finally {
    console.log(
      JSON.stringify({
        ev: "hook",
        p: "stripe",
        s: status,
        ...(out.o ? { o: out.o } : {}),
        ...(f ? { f } : {}),
      }),
    );
  }
}

async function handleHook(req: Request, env: HookEnv, now: number, out: { o?: string }): Promise<Response> {
  if (!isJsonType(req.headers.get("content-type"))) return refuse(415, "unsupported_media_type");
  const raw = await readCapped(req, HOOK_MAX_BYTES);
  if (raw === null) return refuse(413, "payload_too_large");
  const secret = secretOf(env, "STRIPE_WEBHOOK_SECRET");
  if (!secret) return refuse(503, "hook_unconfigured");
  const header = req.headers.get("stripe-signature");
  if (!header) return refuse(400, "signature_missing");
  const verdict = await verifyStripeSignature(
    raw,
    header,
    [secret, secretOf(env, "STRIPE_WEBHOOK_SECRET_PREVIOUS")],
    now,
  );
  if (verdict !== "ok") {
    const key = hookFailureKey("stripe", now);
    try {
      await env.DB.batch(
        hookFailureStatements(env.DB, {
          key,
          windowStart: now - (now % HOOK_FAILURE_WINDOW_MS),
          bellTitle: BELL_SIGNATURES_STRIPE,
          bellLink: "/settings/gateways",
        }),
      );
    } catch {
      // A failed count never changes the answer.
    }
    logEvent("hook.signature_invalid", { provider: "stripe", code: verdict });
    return refuse(400, "signature_invalid");
  }
  let obj: unknown;
  try {
    obj = JSON.parse(strictUtf8.decode(raw));
  } catch {
    out.o = "invalid_event";
    return refuse(400, "invalid_event");
  }
  const parsed = parseStripeEvent(obj);
  if (!parsed.ok) {
    out.o = "invalid_event";
    return refuse(400, "invalid_event");
  }
  const e = parsed.value;
  // (6) ours or not: no D1 write for anything that isn't exactly ours.
  const liveExpected = secretOf(env, "PAYMENTS_LIVE_ALLOWED") === "true";
  const foreign =
    e.livemode !== liveExpected
      ? "livemode_mismatch"
      : !e.techaust
        ? "not_techaust"
        : e.techaust.env !== secretOf(env, "ENVIRONMENT")
          ? "other_env"
          : null;
  if (foreign) {
    out.o = foreign;
    return answer(200, { ok: true });
  }
  // (7) ours. Only the four session events carry our marks, so an event here is one we handle (an unknown type never reaches this line).
  const [, state] = await env.DB.batch([
    env.DB.prepare(WEBHOOK_EVENT_INSERT_SQL).bind(
      uuidv7(),
      "stripe",
      e.id,
      e.name,
      now,
      e.type === "other" ? "ignored" : "received",
      JSON.stringify(stripeEventFacts(e)),
    ),
    env.DB.prepare(WEBHOOK_EVENT_STATE_SQL).bind("stripe", e.id),
  ]);
  const row = state?.results[0] as { id: string; status: string } | undefined;
  if (row?.status !== "received") {
    out.o = "duplicate";
    return answer(200, { ok: true });
  }
  try {
    await env.LEADS_QUEUE.send({ kind: "gateway.event", eventId: row.id });
  } catch {
    logEvent("hook.enqueue_failed", { provider: "stripe" });
    return refuse(500, "enqueue_failed");
  }
  return answer(200, { ok: true });
}
