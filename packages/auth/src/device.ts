// Known devices [ADM-AUTH-09]: a long-lived `__Host-ta_device` cookie holds a random token; only its SHA-256 is stored
// (`staff_known_devices`). A sign-in from a browser without a known token raises `alert.new_device`. The cookie
// carries no identity: stolen, it only tells the server "this browser was seen before for the user who signs in".
import { newToken, tokenHash } from "./tokens.ts";

export const DEVICE_COOKIE = "__Host-ta_device";
/** 400 days, the longest a browser keeps a cookie. */
export const DEVICE_MAX_AGE_S = 34_560_000;

export const deviceCookie = (token: string) =>
  `${DEVICE_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${DEVICE_MAX_AGE_S}`;

/** The token to keep (a well-formed one the browser sent) or a new one, with the hash to store. */
export async function deviceFor(cookieToken: string | null) {
  const token = cookieToken && /^[A-Za-z0-9_-]{43}$/.test(cookieToken) ? cookieToken : newToken();
  return { token, hash: await tokenHash(token) };
}
