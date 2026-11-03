// The gateway's configuration in the admin finance Worker (M6.2, L1, L16; M6.3 L3; run file F). The Razorpay key pair and the Stripe restricted key are finance-only
// Worker secrets (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `STRIPE_SECRET_KEY`; names only in `.dev.vars.example`), the transport a var: `GATEWAY_TRANSPORT` "api"
// calls each gateway's own API (staging; M6.2's "razorpay" is still read and means Razorpay's API only), "stub" answers locally with a deterministic simulator and
// is refused anywhere but `ENVIRONMENT` "local" (like `PDF_RENDERER`). The three admin Workers share one generated `Env`
// (from the front's config), so these names are read at run time by name, each checked to be a string, never cast.
import type { RpcGateway } from "@techaust/core/gateway-rpc";
import { cachedSetting } from "../settings-cache.ts";
import { type PayPalApi, payPalApi, payPalStubFetch } from "./paypal.ts";
import { type RazorpayApi, razorpayApi } from "./razorpay.ts";
import { type StripeApi, stripeApi, stripeStubFetch } from "./stripe.ts";

/** A Worker var or secret by name: its text, or undefined when it is not set (or not a string). */
export const envText = (env: object, name: string): string | undefined => {
  const v: unknown = Reflect.get(env, name);
  return typeof v === "string" && v !== "" ? v : undefined;
};

/** The secret names the finance Worker holds per gateway (L1, L15: the webhook secret is the jobs Worker's, never here). */
export const FINANCE_GATEWAY_SECRETS = {
  razorpay: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
  stripe: ["STRIPE_SECRET_KEY"],
  paypal: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"],
} as const;

export type GatewayTransport = "api" | "stub" | "unset";

/**
 * The transport this Worker may use for `provider` (M6.3: per provider): "stub" only locally (every gateway answers from the simulator); "api" calls each gateway's
 * own API (staging, M6.3 on); "razorpay" (M6.2's staging value, still read) calls Razorpay's API only, so Stripe stays "unset" under it; anything else is "unset"
 * (503 `gateway_unavailable`). M6.4: every gateway by name (L23); "razorpay" keeps meaning Razorpay's API only.
 */
export function transportOf(env: object, provider: RpcGateway = "razorpay"): GatewayTransport {
  const t = envText(env, "GATEWAY_TRANSPORT");
  if (t === "api") return "api";
  if (t === "razorpay" && provider === "razorpay") return "api";
  if (t === "stub" && envText(env, "ENVIRONMENT") === "local") return "stub";
  return "unset";
}

// ---- the local simulator (L16) ---------------------------------------------------------------------------------------------------------------------------
// Stateless and deterministic, so `scripts/pay-simulate.mjs` and the tests agree with it without storage: a link's id carries its amount and our reference
// (`plink_A<amount>R<reference without dashes>`), a payment's id the same (`pay_A<amount>R<...>`). Every fetched link is paid by that one payment, captured.

const hexToUuid = (h: string) =>
  `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;

/** The simulator's ids for a checkout (its id is a UUIDv7) and amount. */
export const stubIdsOf = (checkoutId: string, amountMinor: number) => {
  const ref = checkoutId.replaceAll("-", "");
  return { linkId: `plink_A${amountMinor}R${ref}`, paymentId: `pay_A${amountMinor}R${ref}` };
};
const STUB_ID = /^(?:plink|pay)_A(\d{1,12})R([0-9a-f]{32})$/;

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * A `fetch` that answers Razorpay's four calls the way Razorpay's documentation shows them (test mode), and (M6.3) Stripe's Checkout calls through
 * `stripeStubFetch`. Locally only.
 */
export const stubFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "api.stripe.com") return stripeStubFetch(input, init);
  if (url.hostname === "api-m.sandbox.paypal.com") return payPalStubFetch(input, init);
  const method = init?.method ?? "GET";
  const now = Math.floor(Date.now() / 1000);
  const link = (id: string, amount: number, ref: string, status = "paid") => ({
    id,
    status,
    currency: "INR",
    amount,
    amount_paid: status === "paid" ? amount : 0,
    reference_id: hexToUuid(ref),
    short_url: `https://rzp.io/i/${ref.slice(0, 10)}`,
    expire_by: now + 7 * 86_400,
    payments:
      status === "paid" ? [{ payment_id: `pay_A${amount}R${ref}`, amount, status: "captured" }] : null,
  });
  if (method === "POST" && url.pathname === "/v1/payment_links") {
    const body = JSON.parse(String(init?.body ?? "{}")) as { amount: number; reference_id: string };
    const ids = stubIdsOf(body.reference_id, body.amount);
    return jsonResponse(200, link(ids.linkId, body.amount, body.reference_id.replaceAll("-", ""), "created"));
  }
  if (url.pathname === "/v1/payment_links" && url.searchParams.has("reference_id"))
    return jsonResponse(200, { payment_links: [] });
  // M6.5: refunds (processed at once; the id carries the amount and our refund id, so a fetch answers the same) and an empty settlement recon day.
  const rf = /^\/v1\/payments\/(pay_[A-Za-z0-9]+)\/(refund|refunds)$/.exec(url.pathname);
  if (rf && method === "POST" && rf[2] === "refund") {
    const body = JSON.parse(String(init?.body ?? "{}")) as { amount: number; receipt: string };
    return jsonResponse(
      200,
      stubRefund(`rfnd_A${body.amount}R${body.receipt.replaceAll("-", "")}`, rf[1] as string),
    );
  }
  if (rf && rf[2] === "refunds") return jsonResponse(200, { entity: "collection", count: 0, items: [] });
  const one = /^\/v1\/refunds\/(rfnd_A\d{1,12}R[0-9a-f]{32})$/.exec(url.pathname);
  if (one) return jsonResponse(200, stubRefund(one[1] as string, null));
  if (url.pathname === "/v1/settlements/recon/combined")
    return jsonResponse(200, { entity: "collection", count: 0, items: [] });
  const m = /^\/v1\/(payment_links|payments)\/([^/]+)(\/cancel)?$/.exec(url.pathname);
  const id = m?.[2] ?? "";
  const parts = STUB_ID.exec(id);
  if (!m || !parts) return jsonResponse(404, { error: { code: "BAD_REQUEST_ERROR" } });
  const amount = Number(parts[1]);
  const ref = parts[2] as string;
  if (m[1] === "payments")
    return jsonResponse(200, {
      id,
      amount,
      currency: "INR",
      status: "captured",
      captured: true,
      method: "upi",
      fee: 0,
      tax: 0,
      created_at: now,
    });
  return jsonResponse(200, link(id, amount, ref, m[3] ? "cancelled" : "paid"));
};

/** The simulator's refund (M6.5): `rfnd_A<amount>R<our refund id without dashes>`, processed. */
function stubRefund(id: string, paymentId: string | null) {
  const m = /^rfnd_A(\d{1,12})R([0-9a-f]{32})$/.exec(id);
  return {
    id,
    entity: "refund",
    amount: Number(m?.[1] ?? 0),
    currency: "INR",
    payment_id: paymentId,
    receipt: m ? hexToUuid(m[2] as string) : null,
    status: "processed",
    created_at: Math.floor(Date.now() / 1000),
  };
}

/** Test-only: the `fetch` the "stub" transport uses (tests swap in their own Razorpay answers; never reached on staging or production). */
let stubTransport: typeof fetch = stubFetch;
export function setStubTransport(f: typeof fetch | null): void {
  stubTransport = f ?? stubFetch;
}

/** Settings › Gateways, read through the per-isolate cache (one statement for every gateway's mode; review part 1, finding 16). */
async function gatewaySettingsOf(db: D1Database) {
  const row = await db
    .prepare("SELECT value, version FROM settings WHERE key = 'gateways'")
    .first<{ value: string; version: number }>();
  return cachedSetting("gateways", row ?? undefined);
}

/** Settings › Gateways (the mode only), read through the per-isolate cache. */
export async function gatewayModeOf(db: D1Database): Promise<"test" | "live"> {
  return (await gatewaySettingsOf(db)).razorpay.mode;
}

/** Settings › Gateways, Stripe's mode (M6.3), read through the per-isolate cache. */
export async function stripeModeOfSettings(db: D1Database): Promise<"test" | "live"> {
  return (await gatewaySettingsOf(db)).stripe.mode;
}

/** Settings › Gateways, PayPal's mode (M6.4: the mode picks PayPal's host), read through the per-isolate cache. */
export async function payPalModeOfSettings(db: D1Database): Promise<"test" | "live"> {
  return (await gatewaySettingsOf(db)).paypal.mode;
}

/**
 * M6.4 (L31, early check 2 finding 4): the start-up dry run's made-up PayPal transport (`warm-rpc.ts`), carried on its made-up env under this symbol. No real
 * env can carry it (a Worker's bindings and vars are string-keyed), so a deployed request never reaches it; only the dry run's env has it.
 */
export const WARM_PAYPAL_TRANSPORT: unique symbol = Symbol("warm-paypal-transport");

/** The PayPal client for this request (M6.4), or null when this Worker has no transport for PayPal (503 `gateway_unavailable`). */
export function payPalOf(env: object, settingsMode: "test" | "live"): PayPalApi | null {
  const warm: unknown = Reflect.get(env, WARM_PAYPAL_TRANSPORT);
  const transport = typeof warm === "function" ? "warm" : transportOf(env, "paypal");
  if (transport === "unset") return null;
  return payPalApi({
    clientId: envText(env, "PAYPAL_CLIENT_ID"),
    clientSecret: envText(env, "PAYPAL_CLIENT_SECRET"),
    settingsMode,
    liveFlag: envText(env, "PAYMENTS_LIVE_ALLOWED"),
    fetch:
      transport === "warm"
        ? (warm as typeof fetch)
        : transport === "stub"
          ? (i, o) => stubTransport(i, o)
          : (i, o) => fetch(i, o),
    // The dry run's made-up transport only: global scope refuses timers.
    ...(transport === "warm" ? { timeouts: false } : {}),
  });
}

/** The Stripe client for this request (M6.3), or null when this Worker has no transport for Stripe (503 `gateway_unavailable`). */
export function stripeOf(env: object, settingsMode: "test" | "live"): StripeApi | null {
  const transport = transportOf(env, "stripe");
  if (transport === "unset") return null;
  return stripeApi({
    key: envText(env, "STRIPE_SECRET_KEY"),
    settingsMode,
    liveFlag: envText(env, "PAYMENTS_LIVE_ALLOWED"),
    fetch: transport === "stub" ? (i, o) => stubTransport(i, o) : (i, o) => fetch(i, o),
  });
}

/** The Razorpay client for this request, or null when this Worker has no transport (503 `gateway_unavailable`). */
export function razorpayOf(env: object, settingsMode: "test" | "live"): RazorpayApi | null {
  const transport = transportOf(env, "razorpay");
  if (transport === "unset") return null;
  return razorpayApi({
    keyId: envText(env, "RAZORPAY_KEY_ID"),
    keySecret: envText(env, "RAZORPAY_KEY_SECRET"),
    settingsMode,
    liveFlag: envText(env, "PAYMENTS_LIVE_ALLOWED"),
    fetch: transport === "stub" ? (i, o) => stubTransport(i, o) : (i, o) => fetch(i, o),
  });
}

/** The portal's base URL (ends with `/`), for Razorpay's `callback_url`; null when unset. */
export function portalUrlOf(env: object): string | null {
  const u = envText(env, "PORTAL_URL");
  return u ? (u.endsWith("/") ? u : `${u}/`) : null;
}
