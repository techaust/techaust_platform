// The PayPal webhook (M6.4; JOB-HOOK-01..03, ADM-PAY-01; run file docs/runs/m6.4-paypal.md D, L1, L13, L15, L16, L20; early check 1 "B2 must carry" 4, 5).
// `POST /paypal` only. PayPal's signature is checked OFFLINE here (L1: no postback, so this internet-facing Worker holds no PayPal API key, only the webhook's id,
// which is not a credential). In order, each refusal before any D1 write unless said:
//   1. a JSON content type (any charset), else 415; a body of at most 64 KiB, read as a stream, else 413;
//   2. `PAYPAL_WEBHOOK_ID` set (and never the simulator's literal `WEBHOOK_ID`: Step 0.4 row 21), else 503 `hook_unconfigured` (nothing written);
//   3. the five `PAYPAL-*` headers present and well formed, the certificate URL on PayPal's own API host (`isPayPalCertUrl`; the local simulator's only while
//      `ENVIRONMENT` is "local"), else 400 `signature_missing` (NOT counted: anyone can send no header);
//   4. the certificate's key from this isolate's cache (at most 4 entries, each kept until the certificate's `notAfter` or 6 hours, whichever is sooner, and
//      checked again on every hit), a failed URL remembered for 10 minutes, at most 2 certificate fetches a minute; a miss fetches the allow-listed URL (5 s,
//      at most 16 KiB, a PEM certificate valid now, its RSA key read by core's pure DER reader: Step 0.3, L20). No key → 503 `cert_unavailable`, no D1 (PayPal
//      retries for 3 days);
//   5. RSASSA-PKCS1-v1_5 / SHA-256 over `<transmission id>|<time>|<webhook id>|<CRC32 of the RAW bytes>` (core `verifyPayPalSignature`, `crypto.subtle.verify`):
//      a failure is 400 and counts one in the clock-hour window (`paypal:sig:<hour>`, capped at 50; one owners' bell at 5; never per address);
//   6. only then UTF-8 and `JSON.parse`, then core `parsePayPalEvent`; a body it can't read is 400 `invalid_event`, not counted;
//   7. OURS OR NOT (L13, reviewer X3): an event whose `custom_id` isn't one of our checkout ids (a UUIDv7) is answered 200 with NO D1 write, no queue, no review
//      and no bell (another use of the same PayPal account), except a refund or reversal that names its capture (re-check N3: kept, and the finance Worker
//      finds the payment by the capture or ignores it);
//   8. ours: `INSERT ... ON CONFLICT (provider, event_id) DO NOTHING` with the whitelisted facts (the event id `WH-…`, else the body's SHA-256: L15), the row's
//      state read in the same batch; a new row, or one still `received`, is queued as `gateway.event`; 200 `{ok: true}`. A queue failure is a 500 with the row
//      kept (PayPal retries; the sweep too).
// No transmission-time tolerance (L16: a replay is idempotent; the payment is one row per capture). Never logged: the body, a header, the signature, the
// certificate, the webhook id, or anything personal (Settled by the lead on the safest reading, 2026-11-01 (08-C RB-40)). CPU (JOB-HOOK-03, ≤ 5 ms p99): one
// CRC32 over at most 64 KiB, one parse, one native RSA verify, two D1 statements, one send; the certificate fetch is wall time, once per isolate.
import { uuidv7 } from "@techaust/core/ids";
import {
  importPayPalCertKey,
  isPayPalCertUrl,
  PAYPAL_CERT_MAX_BYTES,
  type PayPalCertKey,
  parsePayPalEvent,
  payPalEventFacts,
  payPalEventOwnership,
  verifyPayPalSignature,
} from "@techaust/core/paypal";
import { fallbackEventId } from "@techaust/core/razorpay";
import {
  HOOK_FAILURE_WINDOW_MS,
  hookFailureKey,
  hookFailureStatements,
  WEBHOOK_EVENT_INSERT_SQL,
  WEBHOOK_EVENT_STATE_SQL,
} from "@techaust/db/gateway";
import { logEvent } from "../log.ts";
import { answer, HOOK_MAX_BYTES, isJsonType, readCapped, refuse, secretOf, strictUtf8 } from "./shared.ts";

/** S10: the owners' bell at the fifth failure in a window (staff words; the finance Worker keeps the same words in gateway/messages.ts). */
export const BELL_SIGNATURES_PAYPAL =
  "PayPal webhook signatures failed 5 times in an hour. Check the webhook ID.";

/** The certificate cache's bounds ("B2 must carry" 4). */
export const CERT_CACHE_MAX = 4;
export const CERT_TTL_MS = 6 * 3_600_000;
export const CERT_NEGATIVE_MS = 10 * 60_000;
export const CERT_FETCHES_PER_MINUTE = 2;
const CERT_TIMEOUT_MS = 5_000;

// Per isolate, never request state: the verifying keys PayPal's certificates hold, by URL; the URLs that failed lately; the fetches of the current minute.
const certs = new Map<string, { key: PayPalCertKey["key"]; until: number }>();
const failed = new Map<string, number>();
let window = { start: 0, n: 0 };

/** Test-only: forget every cached certificate and the fetch count. */
export function resetPayPalCertCache(): void {
  certs.clear();
  failed.clear();
  window = { start: 0, n: 0 };
}

/** The certificate's PEM, read as a capped stream; null on any failure. */
async function fetchPem(url: string, f: typeof fetch): Promise<string | null> {
  let res: Response;
  try {
    res = await f(url, { method: "GET", signal: AbortSignal.timeout(CERT_TIMEOUT_MS), redirect: "error" });
  } catch {
    return null;
  }
  if (res.status !== 200) {
    await res.body?.cancel();
    return null;
  }
  const bytes = await readCapped(res, PAYPAL_CERT_MAX_BYTES).catch(() => null);
  if (!bytes) return null;
  try {
    return strictUtf8.decode(bytes);
  } catch {
    return null;
  }
}

/**
 * The verifying key of an allow-listed certificate URL, from the cache or one fetch ("B2 must carry" 4): null when the URL failed in the last 10 minutes, when this
 * isolate already fetched twice this minute, or when the fetch or the certificate fails (then remembered as failed).
 */
export async function certKeyFor(
  url: string,
  now: number,
  f: typeof fetch = fetch,
): Promise<CryptoKey | null> {
  const hit = certs.get(url);
  if (hit && hit.until > now) return hit.key;
  if (hit) certs.delete(url);
  const bad = failed.get(url);
  if (bad !== undefined && bad > now) return null;
  if (now - window.start >= 60_000) window = { start: now, n: 0 };
  if (window.n >= CERT_FETCHES_PER_MINUTE) return null;
  window.n++;
  const pem = await fetchPem(url, f);
  const got = pem ? await importPayPalCertKey(pem, now) : null;
  if (!got) {
    if (failed.size >= 16) failed.clear();
    failed.set(url, now + CERT_NEGATIVE_MS);
    return null;
  }
  failed.delete(url);
  if (certs.size >= CERT_CACHE_MAX) {
    const oldest = certs.keys().next().value;
    if (oldest !== undefined) certs.delete(oldest);
  }
  certs.set(url, { key: got.key, until: Math.min(got.notAfter, now + CERT_TTL_MS) });
  return got.key;
}

type HookEnv = { DB: D1Database; LEADS_QUEUE: Queue };

/** Whether this isolate answered a PayPal webhook yet (the `f: 1` first-run marker of the staging CPU reading). */
let answeredOnce = false;

/** `POST /paypal`. `now` and `f` (the certificate fetch) for tests. One log line per call: `{ev: "hook", p: "paypal", s, o?, f?}`. */
export async function payPalHook(
  req: Request,
  env: HookEnv,
  now = Date.now(),
  f: typeof fetch = fetch,
): Promise<Response> {
  const first = answeredOnce ? undefined : 1;
  answeredOnce = true;
  let status = 500;
  const out: { o?: string } = {};
  try {
    const res = await handleHook(req, env, now, f, out);
    status = res.status;
    return res;
  } finally {
    console.log(
      JSON.stringify({
        ev: "hook",
        p: "paypal",
        s: status,
        ...(out.o ? { o: out.o } : {}),
        ...(first ? { f: first } : {}),
      }),
    );
  }
}

async function handleHook(
  req: Request,
  env: HookEnv,
  now: number,
  f: typeof fetch,
  out: { o?: string },
): Promise<Response> {
  if (!isJsonType(req.headers.get("content-type"))) return refuse(415, "unsupported_media_type");
  const raw = await readCapped(req, HOOK_MAX_BYTES);
  if (raw === null) return refuse(413, "payload_too_large");
  const local = secretOf(env, "ENVIRONMENT") === "local";
  const headers: Record<string, string | null> = {
    "paypal-transmission-id": req.headers.get("paypal-transmission-id"),
    "paypal-transmission-time": req.headers.get("paypal-transmission-time"),
    "paypal-transmission-sig": req.headers.get("paypal-transmission-sig"),
    "paypal-cert-url": req.headers.get("paypal-cert-url"),
    "paypal-auth-algo": req.headers.get("paypal-auth-algo"),
  };

  const verdict = await verifyPayPalSignature({
    bytes: raw,
    headers,
    webhookId: secretOf(env, "PAYPAL_WEBHOOK_ID"),
    keyFor: async (url) => {
      // `isPayPalCertUrl` already passed inside the verifier; checked again here so no other URL can ever be fetched.
      if (!isPayPalCertUrl(url, { local })) return null;
      return certKeyFor(url, now, f);
    },
    local,
  });
  if (verdict === "webhook_id_invalid") return refuse(503, "hook_unconfigured");
  if (verdict === "signature_missing") return refuse(400, "signature_missing");
  if (verdict === "cert_unavailable") {
    logEvent("hook.cert_unavailable", { provider: "paypal" });
    return refuse(503, "cert_unavailable");
  }
  if (verdict !== "ok") {
    try {
      await env.DB.batch(
        hookFailureStatements(env.DB, {
          key: hookFailureKey("paypal", now),
          windowStart: now - (now % HOOK_FAILURE_WINDOW_MS),
          bellTitle: BELL_SIGNATURES_PAYPAL,
          bellLink: "/settings/gateways",
        }),
      );
    } catch {
      // A failed count never changes the answer.
    }
    logEvent("hook.signature_invalid", { provider: "paypal", code: verdict });
    return refuse(400, "signature_invalid");
  }
  let text: string;
  let obj: unknown;
  try {
    text = strictUtf8.decode(raw);
    obj = JSON.parse(text);
  } catch {
    out.o = "invalid_event";
    return refuse(400, "invalid_event");
  }
  const parsed = parsePayPalEvent(obj);
  if (!parsed.ok) {
    out.o = "invalid_event";
    return refuse(400, "invalid_event");
  }
  const e = parsed.value;
  // (7) ours or not: no D1 write for anything that isn't ours.
  if (payPalEventOwnership(e) === "not_ours") {
    out.o = "not_ours";
    return answer(200, { ok: true });
  }
  const eventId = e.id ?? (await fallbackEventId(text));
  const [, state] = await env.DB.batch([
    env.DB.prepare(WEBHOOK_EVENT_INSERT_SQL).bind(
      uuidv7(),
      "paypal",
      eventId,
      e.name,
      now,
      e.type === "other" ? "ignored" : "received",
      JSON.stringify(payPalEventFacts(e)),
    ),
    env.DB.prepare(WEBHOOK_EVENT_STATE_SQL).bind("paypal", eventId),
  ]);
  const row = state?.results[0] as { id: string; status: string } | undefined;
  if (row?.status !== "received") {
    out.o = row ? "duplicate" : "not_recorded";
    return answer(200, { ok: true });
  }
  try {
    await env.LEADS_QUEUE.send({ kind: "gateway.event", eventId: row.id });
  } catch {
    logEvent("hook.enqueue_failed", { provider: "paypal" });
    return refuse(500, "enqueue_failed");
  }
  return answer(200, { ok: true });
}
