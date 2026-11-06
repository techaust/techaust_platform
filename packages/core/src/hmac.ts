// HMAC-SHA256 helpers shared by the gateway webhook verifiers (M6.2 Razorpay, M6.3 Stripe; JOB-HOOK-01) and the digest's one-click token (M7.2, jobs
// `unsubscribe.ts`; subpath `@techaust/core/hmac`). Pure Web Crypto, no zod, no `fetch`: the jobs hook imports it. Comparisons are always `crypto.subtle.verify` (constant time), never a string comparison of two hex texts.

type HmacKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

const enc = new TextEncoder();
const HEX64 = /^[0-9a-fA-F]{64}$/;

/**
 * The imported HMAC keys, per isolate, by secret (M6.2 CPU diagnosis, lead decision 5: a key is imported once, not per webhook). At most a handful of entries (the
 * current and the previous webhook secret of each gateway, the one-click key's signing and verifying entries, plus a warm-up's made-up one); the map is cleared if
 * it ever grows past 8, so a rotated secret never pins memory. Keyed by usage too, so a signing key never stands in for a verifying one.
 */
const keys = new Map<string, Promise<HmacKey>>();

function keyOf(secret: string, usage: "sign" | "verify"): Promise<HmacKey> {
  const id = `${usage}:${secret}`;
  let k = keys.get(id);
  if (!k) {
    if (keys.size >= 8) keys.clear();
    k = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
    // A failed import is not kept (the next call tries again).
    k.catch(() => keys.delete(id));
    keys.set(id, k);
  }
  return k;
}

/** The verifying key of `secret` (its UTF-8 bytes, exactly as given). */
export const hmacVerifyKey = (secret: string): Promise<HmacKey> => keyOf(secret, "verify");

/** The signing key of `secret` (tests, local simulators and the digest's one-click token, M7.2). */
export const hmacSignKey = (secret: string): Promise<HmacKey> => keyOf(secret, "sign");

/** A hex string of exactly 64 characters to its 32 bytes, else null (decoded first, so a malformed candidate never reaches the comparison). */
export function hex32(sig: string): Uint8Array<ArrayBuffer> | null {
  if (!HEX64.test(sig)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(sig.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Bytes to lower-case hex. */
export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * M7.4 (A.3, A.6; run file docs/runs/m7.4-data-protection.md L23, L24): the keyed hash of an address, HMAC-SHA256(`ERASURE_HASH_KEY`, lower-cased address),
 * as 64 lower-case hex characters. It is what an erasure keeps (the `h:` stop row, `erased_hash`, the consent receipts' `subject_hash`), never the address:
 * Settled by the lead on the safest reading, 2026-11-06 (08-C RB-46). The key is imported once per isolate (`keyOf`). The admin API and the jobs Worker hold
 * the same secret, so both reach the same hash. A key shorter than 32 characters is refused (a missing or truncated secret never hashes).
 */
export async function addressHash(secret: string, email: string): Promise<string> {
  if (typeof secret !== "string" || secret.length < 32)
    throw new RangeError("ERASURE_HASH_KEY is missing or shorter than 32 characters");
  const key = await hmacSignKey(secret);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(email.trim().toLowerCase()));
  return toHex(new Uint8Array(mac));
}

/** The stop row's key of a hash (`email_suppressions.email`). */
export const erasedStopKey = (hash: string): string => `h:${hash}`;
