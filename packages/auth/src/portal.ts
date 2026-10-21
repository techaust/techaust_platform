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

const HEXTET = /^[0-9a-f]{1,4}$/;

/**
 * The address a quota counts: an IPv4 address as it is, an IPv6 address as its /64 prefix (`2001:db8:0:1::/64`),
 * because one household or phone holds a whole /64 and can change addresses inside it at will; counting single IPv6
 * addresses would make every quota free to dodge. Accepts compressed and expanded forms, brackets, a zone id and an
 * IPv4-mapped form (`::ffff:1.2.3.4` counts as that IPv4 address). Anything it cannot parse is returned as given
 * (lower-cased): still one stable bucket, never a crash.
 */
export function addressOf(ip: string): string {
  const s = (
    ip
      .trim()
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .split("%")[0] ?? ""
  ).trim();
  if (!s.includes(":")) return s;
  const mapped = /^(?:(?:0{1,4}:){5}|::)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) return mapped[1] as string;
  // An embedded IPv4 tail (`::1.2.3.4`) is two more hextets.
  const v4tail = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  let text = s;
  if (v4tail) {
    const b = [v4tail[2], v4tail[3], v4tail[4], v4tail[5]].map(Number);
    if (b.some((n) => n > 255)) return s;
    const hex2 = (hi: number, lo: number) => ((hi << 8) | lo).toString(16);
    text = `${v4tail[1]}${hex2(b[0] as number, b[1] as number)}:${hex2(b[2] as number, b[3] as number)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return s;
  const part = (x: string | undefined) => (x ? x.split(":") : []);
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return s;
  const all = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (all.length !== 8 || !all.every((h) => HEXTET.test(h))) return s;
  return `${all
    .slice(0, 4)
    .map((h) => Number.parseInt(h, 16).toString(16))
    .join(":")}::/64`;
}

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
