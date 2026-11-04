// The SES events hook (M7.2; ADM-MAIL-02, JOB-HOOK-01..03; run file docs/runs/m7.2-notifications.md C.3, L1, L2, L4). Tier A ground: it writes the suppression list.
// SES → configuration set → EventBridge default bus → rule → API destination → `POST /ses`, with the connection's API-key header `x-techaust-ses-token`
// (L1; docs/05 §11.1, ADR 0007). EventBridge does not sign the body, so "verified" here is: the header token, compared in constant time BEFORE the body is
// read; then a message-id AND address match against our own `email_log` inside the batch, and our `env` message tag. In order:
//   1. any other method or path is the router's 404 (index.ts), no D1;
//   2. `SES_EVENTS_TOKEN` unset → 503 `hook_unconfigured`, nothing written (EventBridge retries 5xx: CONFIRMED, EventBridge User Guide "API destination error
//      codes"; so nothing is lost while the secret is being set);
//   3. the header missing → 401 `token_missing`, not counted (anyone can send no header);
//   4. SHA-256 of the given and of each configured token (the current, then `SES_EVENTS_TOKEN_PREVIOUS`), compared with `crypto.subtle.timingSafeEqual` (in
//      the pinned workerd's types: fixed-size digests, so no length leaks); a failure → 401 `token_invalid` and one count in the clock-hour window (capped at
//      50; one owners' bell at 5 and one `staff.notify`; never per address: OPEN (08-C RB-12)). EventBridge retries a 401 too (CONFIRMED, same page), so a
//      rotated token loses nothing for up to 24 hours;
//   5. a JSON content type, else 415 (EventBridge sends `application/json; charset=utf-8` by default: CONFIRMED, "Headers in requests to API destinations");
//   6. the body streamed and cut at 64 KiB, else 413;
//   7. `parseSesEvent`, else 400 `invalid_event` (the reason code logged, never the body; a 4xx is not retried);
//   8. not `aws.ses`, or the `env` tag is not `ENVIRONMENT` → stored `wrong_env`, 200; a type we don't handle → stored `ignored_type`, 200;
//   9. `sesEventStatements` in ONE batch, inline (L2; ≤ 6 indexed statements); an event under 15 minutes old for a message id with no `email_log` row
//      writes nothing and is answered 409 `message_not_ready` (EventBridge retries 409; early check finding 3);
//  10. 200 `{ok: true}`; a duplicate event id is 200 with no side effects. A D1 failure is a 500 (EventBridge retries).
// Never logged: the body, the token, an address or a message id. One line per call: `{ev: "hook", p: "ses", s: <status>, o: <outcome>, f: 1 on the isolate's
// first}` (the staging CPU reading tells a first run from a warm one). CPU (JOB-HOOK-03, ≤ 5 ms p99): three digests, one parse of at most 64 KiB, one batch; the
// configured tokens' digests are kept per isolate and the path is warmed at start-up (`warmSesHook`).
import { holdsUnknown, parseSesEvent, type SesEvent, sesEventDisposition } from "@techaust/core/email-events";
import { staffNotify } from "@techaust/core/notifications";
import {
  SES_TOKEN_ALERT_AT,
  sesEventRecordStatement,
  sesEventStatements,
  sesTokenFailureKey,
  sesTokenFailureStatements,
} from "@techaust/db/email-events";
import { logEvent } from "../log.ts";
import { answer, HOOK_MAX_BYTES, isJsonType, readCapped, refuse, secretOf, strictUtf8 } from "./shared.ts";

/** The connection's API-key header name (run file F, H3: the EventBridge connection is created with this name). */
export const SES_TOKEN_HEADER = "x-techaust-ses-token";

type HookEnv = { DB: D1Database; EMAIL_QUEUE: Queue; ENVIRONMENT: string };

const enc = new TextEncoder();
type Digest = ArrayBuffer;

/** The configured tokens' digests, per isolate (at most a handful: the current and the previous token, and the warm-up's made-up one). */
const tokenDigests = new Map<string, Promise<Digest>>();
function digestOfToken(token: string): Promise<Digest> {
  let d = tokenDigests.get(token);
  if (!d) {
    if (tokenDigests.size >= 8) tokenDigests.clear();
    d = crypto.subtle.digest("SHA-256", enc.encode(token));
    d.catch(() => tokenDigests.delete(token));
    tokenDigests.set(token, d);
  }
  return d;
}

/**
 * Whether `given` equals one of `tokens` (undefined entries skipped), in constant time: SHA-256 of both sides, then `timingSafeEqual` over 32 bytes each, every
 * configured token compared (no early exit), so neither the length nor which token matched shows in the timing.
 */
export async function tokenMatches(given: string, tokens: readonly (string | undefined)[]): Promise<boolean> {
  const g = await crypto.subtle.digest("SHA-256", enc.encode(given));
  let ok = false;
  for (const t of tokens) {
    if (!t) continue;
    if (crypto.subtle.timingSafeEqual(g, await digestOfToken(t))) ok = true;
  }
  return ok;
}

/** Whether this isolate answered an SES event yet (the `f: 1` first-run marker of the staging CPU gate). */
let answeredOnce = false;

/** `POST /ses`. `now` for tests. */
export async function sesHook(req: Request, env: HookEnv, now = Date.now()): Promise<Response> {
  const f = answeredOnce ? undefined : 1;
  answeredOnce = true;
  let status = 500;
  let outcome: string | undefined;
  try {
    const res = await handleHook(req, env, now, (o) => {
      outcome = o;
    });
    status = res.status;
    return res;
  } finally {
    console.log(
      JSON.stringify({
        ev: "hook",
        p: "ses",
        s: status,
        ...(outcome ? { o: outcome } : {}),
        ...(f ? { f } : {}),
      }),
    );
  }
}

async function handleHook(
  req: Request,
  env: HookEnv,
  now: number,
  seen: (o: string) => void,
): Promise<Response> {
  const token = secretOf(env, "SES_EVENTS_TOKEN");
  if (!token) return refuse(503, "hook_unconfigured");
  const given = req.headers.get(SES_TOKEN_HEADER);
  if (given === null || given === "") return refuse(401, "token_missing");
  if (!(await tokenMatches(given, [token, secretOf(env, "SES_EVENTS_TOKEN_PREVIOUS")]))) {
    await countRefusedToken(env, now);
    logEvent("hook.token_invalid", { provider: "ses" });
    return refuse(401, "token_invalid");
  }
  if (!isJsonType(req.headers.get("content-type"))) return refuse(415, "unsupported_media_type");
  const raw = await readCapped(req, HOOK_MAX_BYTES);
  if (raw === null) return refuse(413, "payload_too_large");
  let obj: unknown;
  try {
    obj = JSON.parse(strictUtf8.decode(raw));
  } catch {
    logEvent("hook.invalid_event", { provider: "ses", reason: "not_json" });
    return refuse(400, "invalid_event");
  }
  const parsed = parseSesEvent(obj);
  if (!parsed.ok) {
    logEvent("hook.invalid_event", { provider: "ses", reason: parsed.reason });
    return refuse(400, "invalid_event");
  }
  const ev: SesEvent = parsed.value;
  const disposition = sesEventDisposition(ev, env.ENVIRONMENT);
  try {
    if (disposition !== "apply") {
      await env.DB.batch([sesEventRecordStatement(env.DB, ev, disposition, now)]);
      seen(disposition);
      return answer(200, { ok: true });
    }
    const res = await env.DB.batch(
      sesEventStatements(env.DB, ev, now, { holdUnknown: holdsUnknown(ev, now) }),
    );
    const row = res.at(-1)?.results[0] as { outcome: string; fresh: number } | undefined;
    if (!row) {
      // Early check finding 3: a young event for a message id we can't match yet wrote nothing; 409 makes EventBridge retry it (for up to 24 hours).
      seen("held");
      return refuse(409, "message_not_ready");
    }
    seen(row.fresh === 1 ? row.outcome : "duplicate");
  } catch {
    logEvent("hook.store_failed", { provider: "ses" });
    return refuse(500, "store_failed");
  }
  return answer(200, { ok: true });
}

/** One refused token counted; at exactly the fifth in the window, one `staff.notify` for the owners' bell. A failed count never changes the answer. */
async function countRefusedToken(env: HookEnv, now: number): Promise<void> {
  try {
    const res = await env.DB.batch(sesTokenFailureStatements(env.DB, now));
    const count = (res.at(-1)?.results[0] as { count: number } | undefined)?.count;
    if (count === SES_TOKEN_ALERT_AT)
      await env.EMAIL_QUEUE.send(staffNotify("email.hook_token", sesTokenFailureKey(now)));
  } catch {
    logEvent("hook.count_failed", { provider: "ses" });
  }
}

/** A made-up token and envelope for the start-up warm-up (never a real secret; exported for the test). */
export const WARM_SES_TOKEN = "warm-up-ses-token-not-a-real-one";

/**
 * Start-up warm-up of the hook's first run (the M6.2 CPU lesson): the digests and the constant-time compare with a made-up token, the UTF-8 decode, one parse of a
 * sample bounce envelope, its disposition, and the statements built over a stand-in `prepare` (nothing reaches D1). Nothing is stored, sent or logged. Returns
 * the steps that succeeded (5; `ses-hook.test.ts`).
 */
export async function warmSesHook(): Promise<number> {
  let ok = 0;
  try {
    if (await tokenMatches(WARM_SES_TOKEN, [WARM_SES_TOKEN, undefined])) ok++;
    const body = JSON.stringify({
      version: "0",
      id: "00000000-0000-4000-8000-000000000000",
      "detail-type": "Email Bounced",
      source: "aws.ses",
      detail: {
        eventType: "Bounce",
        mail: { messageId: "warm-up-message-000000", tags: { env: ["warm"] } },
        bounce: {
          bounceType: "Permanent",
          bounceSubType: "General",
          bouncedRecipients: [{ emailAddress: "warm@warm-up.invalid" }],
        },
      },
    });
    const obj: unknown = JSON.parse(strictUtf8.decode(enc.encode(body)));
    ok++;
    const parsed = parseSesEvent(obj);
    if (parsed.ok) ok++;
    if (parsed.ok && sesEventDisposition(parsed.value, "warm") === "apply") ok++;
    const fake = { prepare: () => ({ bind: () => ({}) }) } as unknown as D1Database;
    if (parsed.ok && sesEventStatements(fake, parsed.value, 0).length === 6) ok++;
  } catch {
    // never stop a Worker from starting
  }
  return ok;
}
