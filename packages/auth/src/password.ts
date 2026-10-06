// Staff passwords (docs/05 §6.1, ADM-AUTH-02). The browser runs Argon2id; the server only ever sees the
// client hash and stores HMAC-SHA-256(PASSWORD_PEPPER, salt ‖ clientHash). Unknown emails get a deterministic
// fake salt so responses don't reveal which accounts exist.
import { b64url, concat, enc, fromB64url, hmacSha256, randomBytes, timingSafeEqual } from "./crypto.ts";

/** Argon2id parameters, stored per user so they can be raised later. m in KiB. */
export type ArgonParams = { v: number; m: number; t: number; p: number };

/** OWASP minimum (m = 19 MiB, t = 2, p = 1); calibrated on a mid-range Android phone in M1.4. */
export const DEFAULT_PARAMS: ArgonParams = { v: 1, m: 19_456, t: 2, p: 1 };

export const SALT_BYTES = 16;
export const CLIENT_HASH_BYTES = 32;

export const newSalt = () => b64url(randomBytes(SALT_BYTES));

/** The salt shown for an email that has no account: stable per email, indistinguishable from a real one. */
export async function fakeSalt(saltPepper: string, email: string): Promise<string> {
  const mac = await hmacSha256(saltPepper, enc.encode(`salt:${email.trim().toLowerCase()}`));
  return b64url(mac.slice(0, SALT_BYTES));
}

/** What the database stores for a password. */
export async function passwordHmac(pepper: string, salt: string, clientHash: string): Promise<string> {
  return b64url(await hmacSha256(pepper, concat(fromB64url(salt), fromB64url(clientHash))));
}

/**
 * Check a client hash. Always does the same work, even for unknown users (pass `stored: null`), so the
 * response time doesn't reveal whether the account exists.
 */
export async function verifyPassword(
  pepper: string,
  salt: string,
  clientHash: string,
  stored: string | null,
): Promise<boolean> {
  const actual = fromB64url(await passwordHmac(pepper, salt, clientHash));
  const expected = stored ? fromB64url(stored) : new Uint8Array(actual.length);
  return timingSafeEqual(actual, expected) && stored !== null;
}

export const isClientHash = (s: string) => /^[A-Za-z0-9_-]{43}$/.test(s);
