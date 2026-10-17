// Opaque tokens and short-lived signed challenges. Tokens are 32 random bytes; only their SHA-256 is stored.
import { b64url, enc, fromB64url, hex, hmacSha256, randomBytes, sha256, timingSafeEqual } from "./crypto.ts";

export const newToken = () => b64url(randomBytes(32));
export const tokenHash = async (token: string) => hex(await sha256(enc.encode(token)));
export const isToken = (s: string) => /^[A-Za-z0-9_-]{43}$/.test(s);

export type Challenge = { purpose: "login_totp" | "enrol_totp"; sub: string; exp: number };

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
