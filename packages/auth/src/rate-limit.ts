// In-Worker Rate Limiting (M7.5 C2, L2, L5; ASVS 5.0 2.4.1), shared by the admin front and the portal. A Workers Rate Limiting binding is free, counted per
// Cloudflare location and not exact (Cloudflare docs, read 2026-11-07): it is a cheap first filter that keeps a flood off D1 (the Free plan's 100,000 rows
// written a day) and off Turnstile's siteverify, never the rule itself. The exact D1 counters (`auth_attempts`: lockouts, link quotas, failures) stay
// behind it unchanged.
//
// Keys: an HMAC under the Worker's own secret, so neither a raw address nor a session id ever reaches the limiter; a purpose tag keeps each counter apart
// (`rl:<purpose>:<value>`). A binding's period is 10 or 60 seconds (docs).
//
// Failure: a limiter that throws lets the request through and logs one line with no value in it, as the web forms' `RL_FORMS` does (a recorded deviation,
// docs/08): refusing every sign-in because the limiter is down would be worse than the flood it guards against, and the exact counters still hold. A Worker
// with no binding (the admin API, finance and invoices Workers, reached only through the front, which already counted the request) skips the check; the
// config guard (`scripts/check-worker-config.mjs`) requires the binding in every scope of the front and the portal.
import { enc, hex, hmacSha256 } from "./crypto.ts";

/** The part of a Workers Rate Limiting binding this uses (`env.RL_*`). */
export type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

/** The seconds a refused caller is told to wait (`Retry-After`): one period of the 60-second bindings. */
export const RATE_LIMIT_RETRY_S = 60;

/** The limiter key of `value` (an address, a session id) for one purpose: `<purpose>:<32 hex>`, an HMAC under `secret`. */
export const rateLimitKey = async (secret: string, purpose: string, value: string) =>
  `${purpose}:${hex(await hmacSha256(secret, enc.encode(`rl:${purpose}:${value}`))).slice(0, 32)}`;

/**
 * True when the request may go on: no binding (a Worker behind the front), the limiter's yes, or a limiter that failed (logged, let through). False only on
 * the limiter's no.
 */
export async function underLimit(limiter: Limiter | undefined, key: string, what: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch (e) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "rate limiter failed",
        what,
        cause: e instanceof Error ? e.name : "unknown",
      }),
    );
    return true;
  }
}
