// The gateway's configuration in the admin finance Worker (M6.2, L1, L16; run file F). The Razorpay key pair is a finance-only Worker secret (`RAZORPAY_KEY_ID`,
// `RAZORPAY_KEY_SECRET`; names only in `.dev.vars.example`), the transport a var: `GATEWAY_TRANSPORT` "razorpay" calls Razorpay's API (staging), "stub" answers
// locally with a deterministic simulator and is refused anywhere but `ENVIRONMENT` "local" (like `PDF_RENDERER`). The three admin Workers share one generated `Env`
// (from the front's config), so these names are read at run time by name, each checked to be a string, never cast.
import { cachedSetting } from "../settings-cache.ts";
import { type RazorpayApi, razorpayApi } from "./razorpay.ts";

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

export type GatewayTransport = "razorpay" | "stub" | "unset";

/** The transport this Worker may use: "stub" only locally; anything else unknown is "unset" (503 `gateway_unavailable`). */
export function transportOf(env: object): GatewayTransport {
  const t = envText(env, "GATEWAY_TRANSPORT");
  if (t === "razorpay") return "razorpay";
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

/** A `fetch` that answers Razorpay's four calls the way Razorpay's documentation shows them (test mode). Locally only. */
export const stubFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
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

/** Test-only: the `fetch` the "stub" transport uses (tests swap in their own Razorpay answers; never reached on staging or production). */
let stubTransport: typeof fetch = stubFetch;
export function setStubTransport(f: typeof fetch | null): void {
  stubTransport = f ?? stubFetch;
}

/** Settings › Gateways (the mode only), read through the per-isolate cache. */
export async function gatewayModeOf(db: D1Database): Promise<"test" | "live"> {
  const row = await db
    .prepare("SELECT value, version FROM settings WHERE key = 'gateways'")
    .first<{ value: string; version: number }>();
  return cachedSetting("gateways", row ?? undefined).razorpay.mode;
}

/** The Razorpay client for this request, or null when this Worker has no transport (503 `gateway_unavailable`). */
export function razorpayOf(env: object, settingsMode: "test" | "live"): RazorpayApi | null {
  const transport = transportOf(env);
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
