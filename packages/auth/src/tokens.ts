// Opaque tokens and short-lived signed challenges. Tokens are 32 random bytes; only their SHA-256 is stored.
import { b64url, enc, fromB64url, hex, hmacSha256, randomBytes, sha256, timingSafeEqual } from "./crypto.ts";

export const newToken = () => b64url(randomBytes(32));
export const tokenHash = async (token: string) => hex(await sha256(enc.encode(token)));
export const isToken = (s: string) => /^[A-Za-z0-9_-]{43}$/.test(s);

/**
 * `ak` is the lockout key (`acct:<32 hex>`) of a `login_totp` challenge; it is covered by the signature. `jti` (M7.2, Q3 A) is the challenge's own id, 16 random
 * bytes as base64url, also signed: the key of its `staff_signin_pending` row, which the finished sign-in deletes (an older challenge without one deletes nothing).
 */
export type Challenge = {
  purpose: "login_totp" | "enrol_totp";
  sub: string;
  exp: number;
  /**
   * M7.5 (A1 F4, L4): when the challenge was issued (ms), signed with the rest. A login challenge is single use: the code step's session batch is guarded on
   * `last_login_at IS NULL OR last_login_at < iat`, and a finished sign-in moves `last_login_at` past it. A challenge signed before `iat` existed is read as
   * issued at `exp - TTL` (`issuedAtOf`), which is exactly when it was made.
   */
  iat?: number;
  ak?: string;
  jti?: string;
};

/** When a challenge was issued: its signed `iat`, else `exp - ttlMs` (a challenge signed before M7.5). */
export const issuedAtOf = (c: Challenge, ttlMs: number): number =>
  typeof c.iat === "number" && Number.isFinite(c.iat) ? c.iat : c.exp - ttlMs;

/** A new challenge id (M7.2): 16 random bytes, base64url (22 characters). */
export const newChallengeId = () => b64url(randomBytes(16));
/** The shape of a challenge id. */
export const isChallengeId = (s: unknown): s is string =>
  typeof s === "string" && /^[A-Za-z0-9_-]{22}$/.test(s);

/** The shape of a lockout key: a hash of the email, never the email itself. */
export const isAttemptKey = (s: unknown): s is string =>
  typeof s === "string" && /^acct:[0-9a-f]{32}$/.test(s);

/**
 * A signed, short-lived pre-auth challenge: `base64url(json).base64url(hmac)`. It grants nothing on its
 * own; the next step still needs a valid TOTP code, and the TOTP replay guard makes each code single-use.
 */
export async function signChallenge(key: string, c: Challenge): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(c)));
  return `${body}.${b64url(await hmacSha256(key, enc.encode(`challenge.${body}`)))}`;
}

export async function verifyChallenge(
  key: string,
  token: string,
  purpose: Challenge["purpose"],
  nowMs: number,
): Promise<Challenge | null> {
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  let expected: Uint8Array;
  let given: Uint8Array;
  try {
    expected = await hmacSha256(key, enc.encode(`challenge.${body}`));
    given = fromB64url(mac);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, given)) return null;
  const c = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Challenge;
  return c.purpose === purpose && typeof c.exp === "number" && c.exp > nowMs ? c : null;
}
