// The Razorpay webhook (M6.2; JOB-HOOK-01..03, ADM-PAY-02; run file D, L8, L9, L14): `POST /razorpay` only. In order, each refusal before any D1 write unless said:
//   1. a JSON content type, else 415; a body of at most 64 KiB, read as a stream, else 413;
//   2. the secret set, else 503 `hook_unconfigured` (nothing written);
//   3. a signature header of 64 hex characters, else 400 `signature_missing` (NOT counted: anyone can send no header);
//   4. HMAC-SHA256 over the RAW bytes received with the current secret, then the previous one (`verifyRazorpaySignature`, constant time); a failure is 400
//      `signature_invalid` and counts one failure in the clock-hour window (capped at 50; one owners' bell at 5; never per address: RB-12 OPEN);
//   5. the event id: Razorpay's `x-razorpay-event-id` header (1 to 64 of `A-Z a-z 0-9 _`), else `sha256:` of the body (the header is not signed, so the real
//      idempotency is the payment row `rzp_<id>` and the unique `provider_payment_id`);
//   6. one parse; a type we do not handle is stored `ignored` (200); otherwise `INSERT ... ON CONFLICT DO NOTHING` and the row's state read in the same batch;
//      a new row, or one still `received`, is queued as `gateway.event` on the leads queue (L9: no new hosted queue); 200 `{ok: true}`. A queue failure is a 500
//      with the row kept (Razorpay retries; the sweep is the safety net).
// Never logged: the body, the signature, the secret, or anything personal; the row keeps whitelisted facts only (L8; Settled by the lead on the safest reading,
// 2026-11-01 (08-C RB-40)). CPU (JOB-HOOK-03, ≤ 5 ms p99): one HMAC over at most 64 KiB, one parse, two D1 statements, one send; the key is imported once per
// isolate and the code warmed at start-up (`warmRazorpayHook`).

import { uuidv7 } from "@techaust/core/ids";
import {
  eventFacts,
  fallbackEventId,
  parseRazorpayEvent,
  RAZORPAY_EVENT_TYPES,
  razorpayEventIdOf,
  verifyRazorpaySignature,
} from "@techaust/core/razorpay";
import {
  hookFailureKey,
  hookFailureStatements,
  WEBHOOK_EVENT_INSERT_SQL,
  WEBHOOK_EVENT_STATE_SQL,
} from "@techaust/db/gateway";
import { logEvent } from "../log.ts";

/** The body cap (run file D): Razorpay's link events are a few KiB. */
export const HOOK_MAX_BYTES = 64 * 1024;
const SIG = /^[0-9a-fA-F]{64}$/;
/** The owners' bell at the fifth failure in a window (07-ZI S22; staff words approved by the lead under the owner's delegation). */
export const BELL_SIGNATURES =
  "Razorpay webhook signatures failed 5 times in an hour. Check the webhook secret.";

type HookEnv = { DB: D1Database; LEADS_QUEUE: Queue };

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const refuse = (status: number, code: string) => answer(status, { error: { code } });

/** A secret by name: its text, or undefined when unset (the previous secret is optional, so it is read by name, never typed). */
const secretOf = (env: object, name: string): string | undefined => {
  const v: unknown = Reflect.get(env, name);
  return typeof v === "string" && v !== "" ? v : undefined;
};

/** The body as raw bytes, streamed and cut at `max` (null: too large). A declared length above the cap is refused before reading. */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length") ?? Number.NaN);
  if (declared > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** `POST /razorpay`. `now` for tests. */
export async function razorpayHook(req: Request, env: HookEnv, now = Date.now()): Promise<Response> {
  const type = req.headers.get("content-type") ?? "";
  if (!/^application\/json(\s*;|$)/i.test(type)) return refuse(415, "unsupported_media_type");
  const raw = await readCapped(req, HOOK_MAX_BYTES);
  if (raw === null) return refuse(413, "payload_too_large");
  const secret = secretOf(env, "RAZORPAY_WEBHOOK_SECRET");
  if (!secret) return refuse(503, "hook_unconfigured");
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  if (!SIG.test(sig)) return refuse(400, "signature_missing");
  if (
    !(await verifyRazorpaySignature(raw, sig, [secret, secretOf(env, "RAZORPAY_WEBHOOK_SECRET_PREVIOUS")]))
  ) {
    const key = hookFailureKey("razorpay", now);
    try {
      await env.DB.batch(
        hookFailureStatements(env.DB, {
          key,
          windowStart: now - (now % 3_600_000),
          bellTitle: BELL_SIGNATURES,
          bellLink: "/settings/gateways",
        }),
      );
    } catch {
      // A failed count never changes the answer.
    }
    logEvent("hook.signature_invalid", { provider: "razorpay" });
    return refuse(400, "signature_invalid");
  }
  let text: string;
  let obj: unknown;
  try {
    text = decoder.decode(raw);
    obj = JSON.parse(text);
  } catch {
    // Signed but not JSON: nothing to store; Razorpay is told it arrived (a retry would not help).
    logEvent("hook.invalid_body", { provider: "razorpay" });
    return answer(200, { ok: true });
  }
  const header = razorpayEventIdOf(req.headers.get("x-razorpay-event-id"));
  const eventId = header ?? (await fallbackEventId(text));
  if (!header) logEvent("hook.event_id_fallback", { provider: "razorpay" });
  const parsed = parseRazorpayEvent(obj, eventId);
  if (!parsed.ok) {
    logEvent("hook.invalid_event", { provider: "razorpay" });
    return answer(200, { ok: true });
  }
  const e = parsed.value;
  const handled = Object.hasOwn(RAZORPAY_EVENT_TYPES, e.name);
  const rowId = uuidv7();
  const [, state] = await env.DB.batch([
    env.DB.prepare(WEBHOOK_EVENT_INSERT_SQL).bind(
      rowId,
      "razorpay",
      eventId,
      e.name,
      now,
      handled ? "received" : "ignored",
      JSON.stringify(eventFacts(e)),
    ),
    env.DB.prepare(WEBHOOK_EVENT_STATE_SQL).bind("razorpay", eventId),
  ]);
  const row = state?.results[0] as { id: string; status: string } | undefined;
  if (!handled || !row || row.status !== "received") return answer(200, { ok: true });
  try {
    await env.LEADS_QUEUE.send({ kind: "gateway.event", eventId: row.id });
  } catch {
    logEvent("hook.enqueue_failed", { provider: "razorpay" });
    return refuse(500, "enqueue_failed");
  }
  return answer(200, { ok: true });
}
