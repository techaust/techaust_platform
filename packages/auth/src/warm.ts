// Start-up warm-up of the portal sign-in path (CPU tuning 3, 2026-10-23). The first `POST /api/v1/auth/magic` in a fresh isolate
// pays, inside the request, for the first parse of a zod schema (about 4 ms in Node), the first Web Crypto key import and
// HMAC (about 1.5 ms) and the first regular expressions. Run from the Worker's module top level, that cost is paid while the
// isolate starts, not inside the request the Free plan's 10 ms CPU limit applies to (shown in local workerd; confirmed on
// staging by the first `/magic`'s `cpuTimeMs`).
// Pure of `env`: the key is a made-up constant, never a secret (the pepper only exists inside a request). Nothing is sent,
// stored or logged; every error is swallowed (a warm-up must never stop a Worker from starting). `crypto.getRandomValues`,
// `new Request` and timers are refused in a Worker's global scope, so none is used here (`newToken` is not warmed).
import { b64url, enc, hex, sha256 } from "./crypto.ts";
import { addressOf, portalFailKey, portalMailKey, portalReqKey, readPortalCookie } from "./portal.ts";
import { docTokenRequest, magicRequest, magicVerifyRequest } from "./schemas.ts";
import { isToken } from "./tokens.ts";

/**
 * The warm-up's made-up HMAC key (32 bytes, base64 of "warm-up-key-not-a-secret-0000000"), only ever used with made-up
 * values. A literal, not a `btoa()` call, so bundlers can drop it from Workers that never call the warm-up.
 */
const WARM_PEPPER = "d2FybS11cC1rZXktbm90LWEtc2VjcmV0LTAwMDAwMDA=";

/**
 * Parses one made-up body through each portal schema, reads the shared address and cookie parsers once, and runs one HMAC and
 * one SHA-256, then the pieces of a known address's branch that need no randomness (CPU tuning 4: the token's base64url encoder
 * and shape check, the request URL parser). Resolves the number of steps that worked (3 schemas + 1 address + 1 cookie + 3 keys
 * + 1 digest + 1 token encoding + 1 URL = 11), so a test
 * notices a step that silently stopped working.
 */
export async function warmPortalAuth(): Promise<number> {
  let done = 0;
  const step = async (f: () => unknown) => {
    try {
      await f();
      done++;
    } catch {
      // never stop a Worker from starting
    }
  };
  const turnstile = "0".repeat(32);
  await step(() => magicRequest.safeParse({ email: "Warm.Up@Example.invalid", turnstile }).success || fail());
  await step(() => magicVerifyRequest.safeParse({ token: "warm-up" }).success || fail());
  await step(() => docTokenRequest.safeParse({ token: "warm-up" }).success || fail());
  await step(() => {
    addressOf("203.0.113.9");
    addressOf("2001:db8:0:1::5");
  });
  await step(() => readPortalCookie("a=b; __Host-ta_portal=warm-up"));
  await step(() => portalReqKey(WARM_PEPPER, "203.0.113.9"));
  await step(() => portalMailKey(WARM_PEPPER, "warm-up@example.invalid"));
  await step(() => portalFailKey(WARM_PEPPER, "203.0.113.9"));
  await step(async () => hex(await sha256(enc.encode("warm-up"))));
  // `newToken` itself needs `getRandomValues` (refused at start-up); its other half, the base64url encoder, and the shape check
  // run here on a constant, so the first real token costs only the random bytes.
  await step(() => isToken(b64url(new Uint8Array(32))) || fail());
  // `new URL(request.url).origin` builds the link's origin in the known-address branch
  await step(() => new URL("https://warm-up.invalid/api/v1/auth/magic").origin);
  return done;
}

const fail = (): never => {
  throw new Error("warm-up sample did not parse");
};
