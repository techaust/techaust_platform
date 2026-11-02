// PayPal's return to an emailed link's page (M6.4; POR-06, ADM-PAY-04; run file E, L2, L19): `POST /api/v1/pay/paypal/return {checkoutId, token}`. The emailed
// link's return page (`pay/return?via=paypal&c=<our checkout id>`) has no session and no token in its URL, so this route needs neither: the finance Worker's
// `PortalPayments.capturePayPalReturn` captures only what the client approved on PayPal's page, for a document that can still take it, and answers a state.
// (The signed-in page's return is its own invoice refresh, `GET /invoices/:id?refresh=1`.) Here, in order:
//   - same origin (the CSRF middleware), a JSON body of at most 1 KB: our checkout id and PayPal's `token` (its order id, which must be the checkout's);
//   - a quota per address under the portal's own HMAC'd key `p:pay:` (20 per 10 minutes), and the address's `p:fail:` lock; an unknown checkout counts toward
//     `p:fail:` like a failed link;
//   - the RPC's answer is checked by core's runtime guard; a missing binding is 503. The answer carries only `{state, retryUrl?}` (no amount, name or document):
//     the page shows 07-ZN lines 4 to 11 by the state, and `retryUrl` only on PayPal's own page for the same order.
// Reaching this route proves nothing (ADR 0008): only PayPal's answer to the server's capture moves money.
import {
  FAIL_SQL,
  IP_READ,
  PORTAL_FAIL_LIMIT,
  PORTAL_FAIL_LOCK_MS,
  PORTAL_FAIL_WINDOW_MS,
  portalFailKey,
  portalPayKey,
  RESERVE_SQL,
} from "@techaust/auth";
import { type CapturePayPalReturnResult, isCapturePayPalReturnResult } from "@techaust/core/gateway-rpc";
import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type AppEnv, BAD_REQUEST, type Ctx, callerAddress, err, rateLimited } from "./context.ts";
import { json } from "./validate.ts";

/** L2: at most this many PayPal returns per address in the window (a reload or two, a few documents), then a lock for the window. */
export const PAY_RETURN_LIMIT = 20;
export const PAY_RETURN_WINDOW_MS = 10 * 60_000;
const BODY_MAX = 1024;

export const payReturnBody = z.strictObject({
  checkoutId: z.string().check(z.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)),
  token: z.nullable(z.string().check(z.regex(/^[A-Z0-9]{1,36}$/))),
});

const UNAVAILABLE = {
  code: "gateway_unavailable",
  message: "PayPal isn't available right now. You can pay another way shown on this page.",
};

/** `capturePayPalReturn` over the `ADMIN_PAY` binding, the answer checked; "unavailable" with no binding, "bad" for a wrong answer or a failure (answered `processing`). */
async function captureReturn(
  env: object,
  args: { checkoutId: string; token: string | null },
): Promise<CapturePayPalReturnResult | "unavailable" | "bad"> {
  const b: unknown = Reflect.get(env, "ADMIN_PAY");
  const f: unknown = typeof b === "object" && b !== null ? Reflect.get(b, "capturePayPalReturn") : undefined;
  if (typeof f !== "function") return "unavailable";
  try {
    const r: unknown = await Reflect.apply(f, b, [args]);
    return isCapturePayPalReturnResult(r) ? r : "bad";
  } catch {
    return "bad";
  }
}

export const payReturn = new Hono<AppEnv>().post(
  "/paypal/return",
  bodyLimit({ maxSize: BODY_MAX, onError: (c) => err(c as Ctx, BAD_REQUEST, 413) }),
  json(payReturnBody),
  async (c) => {
    const { checkoutId, token } = c.req.valid("json");
    const db = c.env.DB;
    const t = Date.now();
    const pepper = c.env.PORTAL_KEY_PEPPER;
    const address = callerAddress(c);
    const payKey = await portalPayKey(pepper, address);
    const failKey = await portalFailKey(pepper, address);
    const [quota, failLock, payLock] = await db.batch([
      db
        .prepare(RESERVE_SQL)
        .bind(payKey, t, PAY_RETURN_WINDOW_MS, PAY_RETURN_LIMIT, PAY_RETURN_WINDOW_MS, failKey),
      db.prepare(IP_READ).bind(failKey),
      db.prepare(IP_READ).bind(payKey),
    ]);
    const until = (r: D1Result | undefined) =>
      (r?.results[0] as { locked_until: number | null } | undefined)?.locked_until ?? 0;
    // Refused: the address is locked (its returns, or its failed links): nothing is asked of PayPal.
    if (!quota?.results[0] || until(failLock) > t) {
      c.set("accessDone", true);
      return rateLimited(c, (Math.max(until(failLock), until(payLock)) - t) / 1000);
    }
    const r = await captureReturn(c.env, { checkoutId, token });
    if (r === "unavailable") return err(c, UNAVAILABLE, 503);
    // Early check 2 finding 1: the call failed or answered wrongly AFTER the finance Worker may have reached PayPal (a D1 error in the settle batch, a CPU
    // limit): PayPal may have captured, and the claim then settles it later. So never "pay another way" here: "Checking your payment…" (07-ZN line 4), the
    // page polls, and nothing is counted toward `p:fail:`.
    if (r === "bad") return c.json({ state: "processing" });
    // An unknown checkout (or a token that isn't its order) counts like a failed link.
    if (r.state === "not_found")
      await db
        .prepare(FAIL_SQL)
        .bind(failKey, t, PORTAL_FAIL_WINDOW_MS, PORTAL_FAIL_LIMIT, PORTAL_FAIL_LOCK_MS)
        .run();
    return c.json(r.retryUrl ? { state: r.state, retryUrl: r.retryUrl } : { state: r.state });
  },
);
