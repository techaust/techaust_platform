// The weekly digest's RFC 8058 one-click unsubscribe (M7.2; FRM-05's mechanism for non-transactional mail; run file docs/runs/m7.2-notifications.md C.5, L8).
// Tier A ground: a public hook (Access bypass on path `u`, H1) that changes a staff member's switch.
//   token  `<mac>.<userId>`, MAC = HMAC-SHA256(UNSUBSCRIBE_KEY, `digest.weekly|<userId>`), base64url (43 characters); checked with `crypto.subtle.verify`
//          (constant time). It switches off ONE member's digest and nothing else, so it is the documented exception to "tokens only in request bodies" (RFC
//          8058 needs a URL); Workers Logs redact the query string on staging and production (`redact_query_string`, `check-worker-config.mjs`), and this code
//          never logs it.
//   POST /u?t=   a valid token: `digest_weekly = 0`, `digest_off_via = 'one_click'` (upsert; trigger `staff_notification_prefs_values`), one audit row (actor
//                `system`) only when the switch moved, then 200 text/plain. A bad or missing token: 400, counted under `unsub:<window start>` (`hook_failures`,
//                capped at 50; never per address: OPEN (08-C RB-12)).
//   GET /u       200 text/plain with S5's one line and NEVER a change (a link scanner that opens the URL can't unsubscribe anyone).
import { UNSUBSCRIBE_DONE_LINE, UNSUBSCRIBE_GET_LINE } from "@techaust/core/copy-zq";
import { uuidv7 } from "@techaust/core/ids";
import { auditStmt } from "@techaust/db/log";
import { logEvent } from "./log.ts";

const enc = new TextEncoder();

/** The MAC's message for a member. */
const macInput = (userId: string) => enc.encode(`digest.weekly|${userId}`);
/** A staff user id as the token carries it (a lower-case UUID; the transport's URL check pins the same shape). */
const USER_ID = /^[0-9a-f-]{36}$/;
const MAC = /^[A-Za-z0-9_-]{43}$/;

const keys = new Map<string, Promise<CryptoKey>>();
function keyOf(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    if (keys.size >= 4) keys.clear();
    k = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
    k.catch(() => keys.delete(secret));
    keys.set(secret, k);
  }
  return k;
}

const b64url = (bytes: ArrayBuffer): string => {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** A member's one-click token. */
export async function unsubscribeToken(secret: string, userId: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await keyOf(secret), macInput(userId));
  return `${b64url(mac)}.${userId}`;
}

/** The member a token names when its MAC is right, else null (shape first, then `crypto.subtle.verify`). */
export async function verifyUnsubscribe(
  secret: string,
  token: string | null | undefined,
): Promise<string | null> {
  if (typeof token !== "string" || token.length > 100) return null;
  const dot = token.indexOf(".");
  const mac = token.slice(0, dot);
  const userId = token.slice(dot + 1);
  if (dot < 1 || !MAC.test(mac) || !USER_ID.test(userId)) return null;
  try {
    return (await crypto.subtle.verify("HMAC", await keyOf(secret), fromB64url(mac), macInput(userId)))
      ? userId
      : null;
  } catch {
    return null;
  }
}

/** The member's one-click link (`PUBLIC_HOOKS_URL` ends with "/"; the transport's `unsubscribeHeaders` accepts exactly this shape). */
export const unsubscribeUrl = (hooksUrl: string, token: string): string => `${hooksUrl}u?t=${token}`;

/** One refused token per clock-hour window. */
export const UNSUB_WINDOW_MS = 3_600_000;
export const unsubFailureKey = (now: number): string => `unsub:${now - (now % UNSUB_WINDOW_MS)}`;

const text = (status: number, line: string) =>
  new Response(`${line}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

/** `GET /u`: one line, nothing read or written. */
export const unsubscribeGet = (): Response => text(200, UNSUBSCRIBE_GET_LINE);

type UnsubEnv = { DB: D1Database; UNSUBSCRIBE_KEY?: string };

/** `POST /u?t=…`. `now` for tests. The body (RFC 8058's `List-Unsubscribe=One-Click`) is not read. */
export async function unsubscribePost(req: Request, env: UnsubEnv, now = Date.now()): Promise<Response> {
  const secret =
    typeof env.UNSUBSCRIBE_KEY === "string" && env.UNSUBSCRIBE_KEY !== "" ? env.UNSUBSCRIBE_KEY : null;
  if (!secret) {
    logEvent("unsub.unconfigured");
    return text(503, UNSUBSCRIBE_GET_LINE);
  }
  const token = new URL(req.url).searchParams.get("t");
  const userId = await verifyUnsubscribe(secret, token);
  if (!userId) {
    try {
      await env.DB.prepare(
        `INSERT INTO hook_failures (key, window_start, count) VALUES (?1, ?2, 1)
         ON CONFLICT (key) DO UPDATE SET count = count + 1 WHERE count < 50`,
      )
        .bind(unsubFailureKey(now), now - (now % UNSUB_WINDOW_MS))
        .run();
    } catch {
      // a failed count never changes the answer
    }
    logEvent("unsub.invalid");
    return text(400, UNSUBSCRIBE_GET_LINE);
  }
  const auditId = uuidv7();
  await env.DB.batch(unsubscribeStatements(env.DB, userId, auditId, now));
  logEvent("unsub.done");
  return text(200, UNSUBSCRIBE_DONE_LINE);
}

/**
 * The switch moved and its audit row, in one batch: the upsert writes only for an existing member whose digest is on (a repeat changes nothing), and the audit
 * row (`notification.unsubscribe`, actor `system`) only when the upsert changed a row (`changes() = 1`, read before any other statement).
 */
export function unsubscribeStatements(
  db: Pick<D1Database, "prepare">,
  userId: string,
  auditId: string,
  now: number,
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO staff_notification_prefs (user_id, digest_weekly, digest_off_via, updated_at)
         SELECT ?1, 0, 'one_click', ?2 WHERE EXISTS (SELECT 1 FROM staff_users WHERE id = ?1)
         ON CONFLICT (user_id) DO UPDATE SET digest_weekly = 0, digest_off_via = 'one_click', updated_at = ?2 WHERE digest_weekly = 1`,
      )
      .bind(userId, now),
    auditStmt(
      db as D1Database,
      {
        id: auditId,
        actorType: "system",
        actorId: null,
        role: null,
        action: "notification.unsubscribe",
        entityType: "staff_user",
        entityId: userId,
        summary: { digestWeekly: false, via: "one_click" },
        ip: null,
        ua: null,
        requestId: null,
      },
      "changes",
    ),
  ];
}
