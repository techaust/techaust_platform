// Pay now (M6.2; POR-06, ADM-PAY-02, -12; run file E): the portal asks the admin finance Worker's `PortalPayments.createLink` for a Razorpay payment link over the
// `ADMIN_PAY` service binding and sends the browser there. The portal holds no gateway key and decides nothing: the finance Worker re-checks every rule from the
// ids (the contact or the emailed link, the document, the amount). The answer is checked twice here: by the core runtime guard (an RPC answer is not trusted by
// its type alone) and by the link's host (`rzp.io` or `razorpay.com` over https, else 502), so a wrong answer can never send a client's browser elsewhere. No card
// or bank field exists anywhere in the portal (ADM-PAY-12). Client words: 07-ZI lines 5 to 7 and 14 (owner-approved 2026-11-01), word for word.
import {
  type CreateLinkArgs,
  type CreateLinkResult,
  isCreateLinkResult,
  isGatewayLinkUrl,
  isRefreshResult,
  type RefreshResult,
} from "@techaust/core/gateway-rpc";
import { formatMoney, money } from "@techaust/core/money";
import * as z from "zod/mini";
import type { ApiError, Ctx } from "./context.ts";

/**
 * `{amountMinor}` (the signed-in route) and `{token, amountMinor}` (the emailed link; the token only ever in the body). M6.3 (run file E): an optional `provider`;
 * missing, the gateway the document's currency allows (`providerOf`: Stripe for USD, Razorpay for INR). The finance Worker re-checks it against the document.
 */
const PROVIDERS = ["razorpay", "stripe"] as const;
export type PayProvider = (typeof PROVIDERS)[number];
export const payBody = z.object({
  amountMinor: z.int().check(z.gte(1), z.lte(10_000_000_000)),
  provider: z.optional(z.enum(PROVIDERS)),
});
export const payTokenBody = z.object({
  token: z.string().check(z.maxLength(256)),
  amountMinor: z.int().check(z.gte(1), z.lte(10_000_000_000)),
  provider: z.optional(z.enum(PROVIDERS)),
});

/** The gateway of a document's currency (M6.3: USD documents are paid by card through Stripe; INR through Razorpay). */
export const providerOf = (currency: string | null | undefined, asked?: PayProvider): PayProvider =>
  asked ?? (currency === "USD" ? "stripe" : "razorpay");

type Call = (arg: unknown) => unknown;
const methodOf = (binding: object, name: string): Call | undefined => {
  const f: unknown = Reflect.get(binding, name);
  return typeof f === "function" ? (arg) => Reflect.apply(f, binding, [arg]) : undefined;
};
const bindingOf = (env: object): object | null => {
  const b: unknown = Reflect.get(env, "ADMIN_PAY");
  return typeof b === "object" && b !== null ? b : null;
};

/** `createLink` over the binding, the answer checked; null when the binding is missing or answers wrongly (503 / 502 below). */
export async function createLink(
  env: object,
  args: CreateLinkArgs,
): Promise<CreateLinkResult | "unavailable" | "bad"> {
  const b = bindingOf(env);
  const call = b ? methodOf(b, "createLink") : undefined;
  if (!call) return "unavailable";
  try {
    const r = await call(args);
    return isCreateLinkResult(r) ? r : "bad";
  } catch {
    // The finance Worker threw or could not be reached: a 502 with the client's words, never the error's text.
    return "bad";
  }
}

/** `refreshForClient` over the binding (best effort: any failure is `retry`, and the page simply shows what it has). */
export async function refreshForClient(
  env: object,
  args: { clientId: string; documentId: string },
): Promise<RefreshResult> {
  try {
    const b = bindingOf(env);
    const call = b ? methodOf(b, "refreshForClient") : undefined;
    if (!call) return { result: "retry" };
    const r = await call(args);
    return isRefreshResult(r) ? r : { result: "retry" };
  } catch {
    return { result: "retry" };
  }
}

const moneyOf = (m: number | undefined, provider: PayProvider) =>
  formatMoney(money(m ?? 0, provider === "stripe" ? "USD" : "INR"));
const e = (code: string, message: string): ApiError => ({ code, message });
/** 07-ZI line 14: what the client reads whenever online payment can't go ahead (the bank details are on the invoice). */
export const UNAVAILABLE_LINE =
  "Online payment isn't available right now. You can pay by bank transfer using the details on the invoice.";
/** 07-ZI line 13 (Razorpay) and 07-ZM C4 (Stripe), owner-approved, word for word: a payment already waits; "no need to pay again". */
export const PROCESSING_LINE: Record<PayProvider, string> = {
  razorpay:
    "We haven't had confirmation from Razorpay yet. If money left your account, it will show here once Razorpay confirms it. There's no need to pay again.",
  stripe:
    "We haven't had confirmation from Stripe yet. If your card was charged, the payment will show here once Stripe confirms it. There's no need to pay again.",
};
/** 07-ZM C6 (owner-approved, provider-neutral): an amount above the online maximum. */
export const maximumLine = (maximum: string) =>
  `Online payments are limited to ${maximum} at a time. Pay part now and the rest later, or pay by bank transfer.`;

const answer = (
  c: Ctx,
  status: 400 | 404 | 409 | 429 | 502 | 503,
  x: ApiError,
  details?: Record<string, number | string>,
) =>
  c.json(
    { error: { code: x.code, message: x.message, ...(details ? { details } : {}) }, request_id: c.var.rid },
    status,
  );

/**
 * The portal's answer for a `createLink` result. M6.3: the gateway's hosted page must be on THAT gateway's own hosts (`checkout.stripe.com` for Stripe; Razorpay's
 * for Razorpay), else 502; amounts in the document's currency (en-US for USD). The answer carries `url` (M6.2's `shortUrl` alias was dropped once the screens
 * read `url`, M6.3 run file G).
 */
export function payAnswer(
  c: Ctx,
  r: CreateLinkResult | "unavailable" | "bad",
  provider: PayProvider = "razorpay",
): Response {
  if (r === "unavailable") return answer(c, 503, e("gateway_unavailable", UNAVAILABLE_LINE));
  if (r === "bad") return answer(c, 502, e("gateway_error", UNAVAILABLE_LINE));
  if (r.ok) {
    if (!isGatewayLinkUrl(provider, r.url)) return answer(c, 502, e("gateway_error", UNAVAILABLE_LINE));
    return c.json({
      ok: true,
      provider,
      url: r.url,
      expiresAt: r.expiresAt,
      reused: r.reused,
    });
  }
  switch (r.error) {
    case "not_found":
      return answer(c, 404, e("not_found", "Not found"));
    case "amount_below_minimum":
      return answer(c, 400, e(r.error, `Enter an amount of at least ${moneyOf(r.minimumMinor, provider)}.`), {
        minimumMinor: r.minimumMinor ?? 0,
      });
    case "amount_above_balance":
      return answer(
        c,
        400,
        e(r.error, `That's more than the amount due (${moneyOf(r.balanceMinor, provider)}).`),
        { balanceMinor: r.balanceMinor ?? 0 },
      );
    case "amount_above_maximum":
      return answer(c, 400, e(r.error, maximumLine(moneyOf(r.maximumMinor, provider))), {
        maximumMinor: r.maximumMinor ?? 0,
      });
    case "payment_processing":
      return answer(c, 409, e(r.error, PROCESSING_LINE[provider]));
    case "amount_not_whole_rupee":
      return answer(c, 400, e(r.error, "Enter a whole number of rupees."));
    case "link_in_progress":
    case "not_payable_online":
    case "client_gone":
      return answer(c, 409, e(r.error, UNAVAILABLE_LINE), r.reason ? { reason: r.reason } : undefined);
    case "too_many_links":
      return answer(c, 429, e(r.error, UNAVAILABLE_LINE));
    case "gateway_unavailable":
    case "live_not_allowed":
      return answer(c, 503, e(r.error, UNAVAILABLE_LINE));
    default:
      return answer(c, 502, e("gateway_error", UNAVAILABLE_LINE));
  }
}
