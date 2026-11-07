// How the gateway clients read an answer (M6–M7 audit AU7 L2, L3; run file docs/runs/full-audit-m6-m7.md B1): every call that carries our credentials is sent
// with `redirect: "manual"` (a 3xx is never followed to another host with the Authorization header; it reads as `bad_answer`), and the body is read as JSON
// only up to `GATEWAY_ANSWER_MAX_BYTES`, streamed, so an unexpectedly large answer can't fill the isolate's memory.
import { readTextCapped } from "@techaust/core/body";

/** The most bytes of one gateway answer we read (256 KiB: Razorpay's, Stripe's and PayPal's largest objects we fetch are a few KiB). */
export const GATEWAY_ANSWER_MAX_BYTES = 256 * 1024;

/** A 3xx: the answer is never followed (the callers map it to `bad_answer`). */
export const isRedirect = (res: Response): boolean => res.status >= 300 && res.status < 400;

/**
 * The answer's body as JSON, read through a byte cap: `{ ok: true, value }`, or `{ ok: false }` when it is not JSON or longer than `max` (the rest is
 * cancelled). An answer with no body is not JSON.
 */
export async function readJsonCapped(
  res: Response,
  max: number = GATEWAY_ANSWER_MAX_BYTES,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  // No stream to read: the start-up dry run's Response-shaped answers (global scope refuses a Response with a body: warm-rpc.ts) keep their small body in
  // memory behind `json()`; a real Response with no body fails `json()`, which reads as not JSON. A declared length over the cap is refused first.
  if (!res.body) {
    const declared = Number(res.headers?.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > max) return { ok: false };
    try {
      return { ok: true, value: (await res.json()) as unknown };
    } catch {
      return { ok: false };
    }
  }
  // AU61 (review L7): the one capped reader shared with the SES client and the Turnstile check (core `readTextCapped`).
  const text = await readTextCapped(res, max);
  if (text === null) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}
