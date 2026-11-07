// The PayPal webhook (M6.4; JOB-HOOK-01..03, ADM-PAY-01; run file docs/runs/m6.4-paypal.md D, L1, L13, L15, L16, L20; early check 1 "B2 must carry" 4, 5).
// `POST /paypal` only. PayPal's signature is checked OFFLINE here (L1: no postback, so this internet-facing Worker holds no PayPal API key, only the webhook's id,
// which is not a credential). In order, each refusal before any D1 write unless said:
//   1. a JSON content type (any charset), else 415; a body of at most 64 KiB, read as a stream, else 413;
//   2. `PAYPAL_WEBHOOK_ID` set (and never the simulator's literal `WEBHOOK_ID`: Step 0.4 row 21), else 503 `hook_unconfigured` (nothing written);
//   3. the five `PAYPAL-*` headers present and well formed, the certificate URL on PayPal's own API host for the mode the hook runs in (`isPayPalCertUrl` with
//      `mode`, P7 A2.1: `api.sandbox.paypal.com` in test, `api.paypal.com` in live; the mode is test while `PAYMENTS_LIVE_ALLOWED` is not "true", else Settings ›
//      Gateways' PayPal mode: `hookModeOf`; the local simulator's only while `ENVIRONMENT` is "local"), else 400 `signature_missing` (NOT counted: anyone can
//      send no header; but counted when all five are present and well formed and only the certificate URL is refused, review part 1 finding 12);
//   4. the certificate's key from this isolate's cache (at most 4 entries, each kept until the certificate's `notAfter` or 6 hours, whichever is sooner, and
//      checked again on every hit), a failed URL remembered for 10 minutes (16 at most, the oldest forgotten first), at most 2 certificate fetches a minute
//      plus 1 kept for a URL whose certificate once verified a signature (review part 1, finding 3; part 2, finding 6); a miss fetches the allow-listed URL (5 s,
//      at most 16 KiB, a PEM certificate valid now, its RSA key read by core's pure DER reader: Step 0.3, L20). No key → 503 `cert_unavailable`, no D1 (PayPal
//      retries for 3 days);
//   5. RSASSA-PKCS1-v1_5 / SHA-256 over `<transmission id>|<time>|<webhook id>|<CRC32 of the RAW bytes>` (core `verifyPayPalSignature`, `crypto.subtle.verify`):
//      a failure is 400 and counts one in the clock-hour window (`paypal:sig:<hour>`, capped at 50; one owners' bell at 5; never per address);
//   6. only then UTF-8 and `JSON.parse`, then core `parsePayPalEvent`; a body it can't read is 400 `invalid_event`, not counted;
//   7. OURS OR NOT (L13, reviewer X3): an event whose `custom_id` isn't one of our checkout ids (a UUIDv7) is answered 200 with NO D1 write, no queue, no review
//      and no bell (another use of the same PayPal account), except a refund or reversal that names its capture (re-check N3: kept, and the finance Worker
//      finds the payment by the capture or ignores it); P7 (finding 5): an event whose `custom_id` names ANOTHER environment (`<checkout id>-<env>`) is stored
//      at once as `ignored` with outcome `other_env` and the event name and mark only, never queued (no ledger write, no review, no bell; one log line); an
//      event with no mark (an order made before P7) keeps the rules above;
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
  OTHER_ENV_OUTCOME,
  WEBHOOK_EVENT_IGNORED_SQL,
  WEBHOOK_EVENT_INSERT_SQL,
  WEBHOOK_EVENT_STATE_SQL,
} from "@techaust/db/gateway";
import { logEvent } from "../log.ts";
import {
  answer,
  HOOK_MAX_BYTES,
  hookModeOf,
  isJsonType,
  readCapped,
  refuse,
  secretOf,
  strictUtf8,
} from "./shared.ts";

/** S10: the owners' bell at the fifth failure in a window (staff words; the finance Worker keeps the same words in gateway/messages.ts). */
export const BELL_SIGNATURES_PAYPAL =
  "PayPal webhook signatures failed 5 times in an hour. Check the webhook ID.";

/** The certificate cache's bounds ("B2 must carry" 4). */
export const CERT_CACHE_MAX = 4;
export const CERT_TTL_MS = 6 * 3_600_000;
export const CERT_NEGATIVE_MS = 10 * 60_000;
export const CERT_FETCHES_PER_MINUTE = 2;
/**
 * Review part 1, finding 3: one more fetch a minute kept for a URL whose certificate once verified a signature (PayPal's own, renewed when its cache entry runs
 * out; `trustPayPalCertUrl`, review part 2, finding 6), so unsigned requests naming other allow-listed paths can't spend the whole budget.
 */
export const CERT_TRUSTED_FETCHES_PER_MINUTE = 1;
/** The failed URLs remembered (the oldest is forgotten first, never all at once). */
export const CERT_FAILED_MAX = 16;
const CERT_TIMEOUT_MS = 5_000;

// Per isolate, never request state: the verifying keys PayPal's certificates hold, by URL; the URLs whose certificate once verified a signature; the URLs that failed
// lately; the fetches of the current minute (`n` any URL's, `trusted` the reserved ones).
const certs = new Map<string, { key: PayPalCertKey["key"]; until: number }>();
const trusted = new Set<string>();
const failed = new Map<string, number>();
let window = { start: 0, n: 0, trusted: 0 };

/** Test-only: forget every cached certificate, the trusted URLs and the fetch count. */
export function resetPayPalCertCache(): void {
  certs.clear();
  trusted.clear();
  failed.clear();
  window = { start: 0, n: 0, trusted: 0 };
}

/** Why a certificate fetch failed, logged once per failure (never the URL or a header): the only trace a silent 503 `cert_unavailable` leaves (review of #168). */
const certFetchFailed = (why: string): null => {
  logEvent("hook.cert_fetch_failed", { provider: "paypal", why });
  return null;
};

/** The certificate's PEM, read as a capped stream; null on any failure. */
async function fetchPem(url: string, f: typeof fetch): Promise<string | null> {
  let res: Response;
  try {
    // `manual`, never `error`: the Workers runtime refuses the redirect mode "error" with a TypeError (staging, 2026-11-03: every certificate fetch failed, so every
    // PayPal webhook was answered 503). A redirect comes back as a 3xx, which the status check below refuses.
    res = await f(url, { method: "GET", signal: AbortSignal.timeout(CERT_TIMEOUT_MS), redirect: "manual" });
  } catch {
    return certFetchFailed("network");
  }
  if (res.status !== 200) {
    await res.body?.cancel();
    return certFetchFailed(`status_${Math.floor(res.status / 100)}xx`);
  }
  const bytes = await readCapped(res, PAYPAL_CERT_MAX_BYTES).catch(() => null);
  if (!bytes) return certFetchFailed("too_large");
  try {
    return strictUtf8.decode(bytes);
  } catch {
    return certFetchFailed("not_utf8");
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
  if (now - window.start >= 60_000) window = { start: now, n: 0, trusted: 0 };
  // A trusted URL takes its reserved fetch first, then the shared ones; any other URL only the shared ones.
  if (trusted.has(url) && window.trusted < CERT_TRUSTED_FETCHES_PER_MINUTE) window.trusted++;
  else if (window.n < CERT_FETCHES_PER_MINUTE) window.n++;
  else return null;
  const pem = await fetchPem(url, f);
  const got = pem ? await importPayPalCertKey(pem, now) : null;
  if (pem && !got) certFetchFailed("cert_invalid");
  if (!got) {
    failed.delete(url);
    if (failed.size >= CERT_FAILED_MAX) {
      const oldest = failed.keys().next().value;
      if (oldest !== undefined) failed.delete(oldest);
    }
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

/**
 * Review part 2, finding 6: a certificate URL is trusted (its kept fetch a minute) only once a request whose signature verified under its key (`verifyPayPalSignature`
 * answered `ok`), never on a valid certificate alone: otherwise unsigned posts naming other allow-listed certificate paths (old PayPal certificates are valid too)
 * could push PayPal's current URL out of the 4 trusted ones. The most recently verified URL is kept; the oldest is forgotten first.
 */
export function trustPayPalCertUrl(url: string): void {
  trusted.delete(url);
  if (trusted.size >= CERT_CACHE_MAX) {
    const oldest = trusted.values().next().value;
    if (oldest !== undefined) trusted.delete(oldest);
  }
  trusted.add(url);
}

type HookEnv = { DB: D1Database; LEADS_QUEUE: Pick<Queue, "send"> };

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
  // P7 A2.1: the certificate host follows the mode PayPal runs in (no D1 read while the go-live flag is off).
  const mode = await hookModeOf(env, "paypal");
  let certUrl: string | null = null;
  const a = await payPalHookBytes(raw, req.headers, env, {
    now,
    local,
    mode,
    ids: uuidv7,
    keyFor: async (url) => {
      // `isPayPalCertUrl` already passed inside the verifier; checked again here so no other URL can ever be fetched.
      if (!isPayPalCertUrl(url, { local, mode })) return null;
      certUrl = url;
      return certKeyFor(url, now, f);
    },
    // Review part 2, finding 6: the URL whose key verified this request's signature, and only that, becomes trusted.
    verified: () => {
      if (certUrl !== null) trustPayPalCertUrl(certUrl);
    },
  });
  if (a.o) out.o = a.o;
  return answer(a.status, a.body);
}

/** What `payPalHookBytes` needs besides the body: the clock, the local flag, where new ids come from, and the certificate's key by its URL. */
export type PayPalHookDeps = {
  readonly now: number;
  readonly local: boolean;
  /** P7 A2.1: the mode the hook runs in (only that mode's certificate host); absent: either host (the start-up dry run). */
  readonly mode?: "test" | "live";
  /** `uuidv7` for every real call; the start-up dry run passes made-up ids (global scope refuses random values). */
  readonly ids: () => string;
  /**
   * The verifying key of an allow-listed certificate URL: the real hook's fetches and caches it per isolate (`certKeyFor`); the start-up dry run passes a key of
   * its own made-up certificate, never cached (L31, early check 2 finding 4).
   */
  readonly keyFor: (url: string) => Promise<CryptoKey | null>;
  /** Called once when the signature verified (`ok`), before the parse: the real hook trusts the certificate URL then (review part 2, finding 6); the dry run omits it. */
  readonly verified?: () => void;
};

/** A hook answer before it becomes a Response (the dry run reads it at global scope, where a Response with a body is refused). `o`: the log line's outcome. */
export type PayPalHookAnswer = { readonly status: number; readonly body: unknown; readonly o?: string };

const no = (status: number, code: string, o?: string): PayPalHookAnswer => ({
  status,
  body: { error: { code } },
  ...(o ? { o } : {}),
});
const okAnswer = (o?: string): PayPalHookAnswer => ({ status: 200, body: { ok: true }, ...(o ? { o } : {}) });

/**
 * Steps 2 to 8 on the RAW body bytes (the transport checks, 1, are done): the webhook id, the five headers, the certificate's key, the signature, the parse,
 * ours or not, the insert-once and the queue. Shared by `POST /paypal` and the start-up dry run (`warmPayPalHook`, apps/jobs/src/warm.ts), so V8 compiles
 * this path before the first metered webhook.
 */
export async function payPalHookBytes(
  raw: Uint8Array,
  h: Pick<Headers, "get">,
  env: HookEnv,
  d: PayPalHookDeps,
): Promise<PayPalHookAnswer> {
  const now = d.now;
  const headers: Record<string, string | null> = {
    "paypal-transmission-id": h.get("paypal-transmission-id"),
    "paypal-transmission-time": h.get("paypal-transmission-time"),
    "paypal-transmission-sig": h.get("paypal-transmission-sig"),
    "paypal-cert-url": h.get("paypal-cert-url"),
    "paypal-auth-algo": h.get("paypal-auth-algo"),
  };

  const verdict = await verifyPayPalSignature({
    bytes: raw,
    headers,
    webhookId: secretOf(env, "PAYPAL_WEBHOOK_ID"),
    keyFor: d.keyFor,
    local: d.local,
    ...(d.mode ? { mode: d.mode } : {}),
  });
  if (verdict === "webhook_id_invalid") return no(503, "hook_unconfigured");
  if (verdict === "signature_missing") return no(400, "signature_missing");
  if (verdict === "cert_unavailable") {
    logEvent("hook.cert_unavailable", { provider: "paypal" });
    return no(503, "cert_unavailable");
  }
  // Review part 1, finding 12: a signed post whose certificate URL we refuse is counted like a bad signature (the owners hear of it at 5), still answered
  // `signature_missing`. P7 A2.1: the certificate hosts follow the gateway's mode (`hookModeOf`).
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
    return no(400, verdict === "cert_url_refused" ? "signature_missing" : "signature_invalid");
  }
  d.verified?.();
  let text: string;
  let obj: unknown;
  try {
    text = strictUtf8.decode(raw);
    obj = JSON.parse(text);
  } catch {
    return no(400, "invalid_event", "invalid_event");
  }
  const parsed = parsePayPalEvent(obj);
  if (!parsed.ok) return no(400, "invalid_event", "invalid_event");
  const e = parsed.value;
  // (7) ours or not: no D1 write for anything that isn't ours.
  const owner = payPalEventOwnership(e, secretOf(env, "ENVIRONMENT") ?? "");
  if (owner === "not_ours") return okAnswer("not_ours");
  const eventId = e.id ?? (await fallbackEventId(text));
  // P7: another environment's event: kept `ignored` (so it can be traced and a redelivery is a duplicate), never queued.
  if (owner === "other_env") {
    logEvent("hook.other_env", { provider: "paypal" });
    await env.DB.prepare(WEBHOOK_EVENT_IGNORED_SQL)
      .bind(
        d.ids(),
        "paypal",
        eventId,
        e.name,
        now,
        OTHER_ENV_OUTCOME,
        JSON.stringify({ event: e.name, env: e.envMark }),
      )
      .run();
    return okAnswer(OTHER_ENV_OUTCOME);
  }
  const [inserted, state] = await env.DB.batch([
    env.DB.prepare(WEBHOOK_EVENT_INSERT_SQL).bind(
      d.ids(),
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
  // Review part 1, finding 11: a first-time event we don't act on is stored `ignored` and logged as `other`, never as a duplicate.
  if (row?.status !== "received")
    return okAnswer(!row ? "not_recorded" : inserted?.meta.changes === 1 ? "other" : "duplicate");
  try {
    await env.LEADS_QUEUE.send({ kind: "gateway.event", eventId: row.id });
  } catch {
    logEvent("hook.enqueue_failed", { provider: "paypal" });
    return no(500, "enqueue_failed");
  }
  return okAnswer();
}
