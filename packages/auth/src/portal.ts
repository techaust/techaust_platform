// Client-portal auth pieces (M1.6; POR-01, POR-02, POR-06): magic-link and client-session constants, the session and
// cookie helpers, the counter keys, and single-document tokens. Admin's session.ts is untouched: the two realms share
// no cookie name, no table and no secret (a test proves a staff token is no portal token and the reverse).
//
// Everything here is a pure function or builds a value; the portal Worker runs the SQL.
import { enc, hex, hmacSha256 } from "./crypto.ts";
import { readCookie } from "./session.ts";
import { newToken, tokenHash } from "./tokens.ts";

/** The portal session cookie. `__Host-` forces Secure, Path=/ and no Domain. */
export const PORTAL_COOKIE = "__Host-ta_portal";
/** A session ends after 30 days without use [POR-02]... */
export const PORTAL_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** ...and 90 days after sign-in whatever the activity. */
export const PORTAL_ABS_MS = 90 * 24 * 60 * 60 * 1000;
/** A sign-in link works once, for 15 minutes [POR-01]. */
export const MAGIC_TTL_MS = 15 * 60 * 1000;

// Quotas, all in `auth_attempts` (one place; shared offices and mobile networks may need them revisited with M2.4's
// Turnstile). "Limit" is the count that sets the lock: the request that reaches it is still served, the next is not.
/** Link requests per address: 10 an hour; a 11th within the hour is refused for the rest of that hour. */
export const MAGIC_IP_LIMIT = 10;
export const MAGIC_IP_WINDOW_MS = 60 * 60 * 1000;
export const MAGIC_IP_LOCK_MS = 60 * 60 * 1000;
/** Link requests per email address: 3 in 15 minutes; a 4th is refused until 15 minutes after the 3rd. */
export const MAGIC_MAIL_LIMIT = 3;
export const MAGIC_MAIL_WINDOW_MS = 15 * 60 * 1000;
export const MAGIC_MAIL_LOCK_MS = 15 * 60 * 1000;
/** Failed link or document-link checks per address: 20 an hour block the address for 15 minutes. */
export const PORTAL_FAIL_LIMIT = 20;
export const PORTAL_FAIL_WINDOW_MS = 60 * 60 * 1000;
export const PORTAL_FAIL_LOCK_MS = 15 * 60 * 1000;

/** A new portal session: the cookie holds the token, the database keeps its SHA-256 as the row id. */
export async function newPortalSession(nowMs: number) {
  const token = newToken();
  return {
    token,
    id: await tokenHash(token),
    lastSeenAt: nowMs,
    idleExpiresAt: nowMs + PORTAL_IDLE_MS,
    absExpiresAt: nowMs + PORTAL_ABS_MS,
  };
}

/** `Max-Age` is the full 90 days; the server-side idle and absolute limits are what end a session. */
export const portalSessionCookie = (token: string, maxAgeS = PORTAL_ABS_MS / 1000) =>
  `${PORTAL_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeS}`;
export const clearPortalCookie = () => `${PORTAL_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export const readPortalCookie = (header: string | null | undefined) => readCookie(header, PORTAL_COOKIE);

// Counter keys: HMACs under the one portal secret (`PORTAL_KEY_PEPPER`), so the counter table holds neither a raw
// address nor an email. A different prefix per counter keeps the three apart.
const counterKey = async (prefix: string, pepper: string, tag: string, value: string) =>
  `${prefix}:${hex(await hmacSha256(pepper, enc.encode(`${tag}:${value}`))).slice(0, 32)}`;

/** Link requests per address (`p:req:`). */
export const portalReqKey = (pepper: string, ip: string) => counterKey("p:req", pepper, "req", ip);
/** Link requests per email (`p:mail:`); `email` is already trimmed and lower-cased. */
export const portalMailKey = (pepper: string, email: string) => counterKey("p:mail", pepper, "mail", email);
/** Failed link / document-link checks per address (`p:fail:`). */
export const portalFailKey = (pepper: string, ip: string) => counterKey("p:fail", pepper, "fail", ip);

// ---- single-document tokens [POR-06] -------------------------------------------------------------------------------

export const DOC_TOKEN_PURPOSES = ["view_pay"] as const;
export type DocTokenPurpose = (typeof DOC_TOKEN_PURPOSES)[number];

/** A new document token: 32 random bytes, base64url (the link is `portal.../t#<token>`; it never goes in a path or query). */
export const newDocToken = () => newToken();

/** The least a D1 database must offer: `prepare(sql).bind(...)` gives the statement the caller batches. */
type Preparer<S> = { prepare(sql: string): { bind(...values: unknown[]): S } };

/**
 * A document token and the statement that stores it (only its SHA-256), for the caller's own `db.batch()`: the send
 * flows of M5/M6 mint one when they email a proforma or invoice. Nothing is run here.
 */
export async function docTokenStmt<S>(
  db: Preparer<S>,
  o: { documentId: string; purpose: DocTokenPurpose; expiresAt: number },
): Promise<{ token: string; stmt: S }> {
  const token = newDocToken();
  const stmt = db
    .prepare(
      "INSERT INTO doc_access_tokens (token_hash, document_id, purpose, expires_at) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(await tokenHash(token), o.documentId, o.purpose, o.expiresAt);
  return { token, stmt };
}
