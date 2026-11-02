// Shared helpers of the M6.4 PayPal tests (paypal-gateway.test.ts, paypal-routes.test.ts): the PayPal stub with a record of every call (method, path, JSON body,
// request id, Prefer), a PayPal order made through the portal's path, a stored PayPal webhook event, and readers of the rows. PayPal is never called: the "stub"
// transport answers (worker/gateway/paypal.ts `payPalStubFetch`), swapped per test where PayPal must answer otherwise. All names and amounts are invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { setStubTransport, stubFetch } from "./gateway/config.ts";
import { createLinkFor } from "./gateway/links.ts";
import { stubCapture, stubOrder } from "./gateway/paypal.ts";
import { dropPayPalToken } from "./gateway/paypal-token.ts";
import { one } from "./test-helpers.ts";
import type { J } from "./test-invoices.ts";
import { usdClient, usdDoc } from "./test-stripe.ts";

export type PayPalCall = {
  method: string;
  path: string;
  body: J | null;
  requestId: string | null;
  prefer: string | null;
  auth: string | null;
};

/** Every PayPal call the stub saw (the token's included). */
export const paypalCalls: PayPalCall[] = [];
/** The calls to PayPal's API proper (no token call). */
export const apiCalls = () => paypalCalls.filter((c) => c.path !== "/v1/oauth2/token");

/** Answers PayPal's calls with the simulator, except where `over` answers (a non-null Response). The token cache is dropped first. */
export function paypalStub(
  over?: (path: string, method: string, body: J | null) => Response | null | Promise<Response | null>,
) {
  paypalCalls.length = 0;
  dropPayPalToken();
  setStubTransport(async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    let body: J | null = null;
    if (typeof init?.body === "string" && init.body.startsWith("{")) body = JSON.parse(init.body) as J;
    if (url.hostname === "api-m.sandbox.paypal.com")
      paypalCalls.push({
        method,
        path: url.pathname,
        body,
        requestId: headers.get("PayPal-Request-Id"),
        prefer: headers.get("Prefer"),
        auth: headers.get("Authorization"),
      });
    return (await over?.(url.pathname, method, body)) ?? stubFetch(input, init);
  });
}

export const ppJson = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** PayPal's error answer: `name` and one `details[0].issue`. */
export const ppError = (status: number, name: string, issue?: string) =>
  ppJson(status, { name, message: "x", debug_id: "d1", details: issue ? [{ issue, description: "y" }] : [] });

/** The simulator's order `id` changed by `edit`, as PayPal would answer (`captured`: with its completed capture). */
export function orderAnswer(
  id: string,
  edit: (o: J) => void = () => undefined,
  captured = true,
  status = 200,
): Response {
  const o = stubOrder(id, { captured }) as J;
  edit(o);
  return ppJson(status, o);
}

/** The simulator's capture of order `id` changed by `edit`. */
export function captureAnswer(id: string, edit: (c: J) => void = () => undefined): Response {
  const c = stubCapture(id) as J;
  edit(c);
  return ppJson(200, c);
}

/** A PayPal order made through the portal's path (signed-in contact unless `token`). */
export async function payPalLink(
  c: { clientId: string; contactId: string },
  documentId: string,
  amountMinor = 50_000,
  e: Env = env,
) {
  return createLinkFor(e, {
    provider: "paypal",
    clientId: c.clientId,
    contactId: c.contactId,
    tokenHash: null,
    documentId,
    amountMinor,
    returnTo: "invoice",
  });
}

/** A live PayPal order of an issued USD export invoice of an overseas client (USD 500 unless told). */
export async function liveOrder(o: { type?: string; amount?: number; total?: number } = {}) {
  const c = await usdClient();
  const documentId = await usdDoc(c.clientId, { type: o.type, total: o.total });
  const r = await payPalLink(c, documentId, o.amount ?? 50_000);
  if (!r.ok) throw new Error(`no order: ${JSON.stringify(r)}`);
  const orderId = new URL(r.url).searchParams.get("token") as string;
  return { ...c, documentId, checkoutId: r.checkoutId, orderId, url: r.url };
}

/** The checkout row of a PayPal checkout. */
export const ppCheckout = (id: string) =>
  one<{
    id: string;
    status: string;
    provider_link_id: string | null;
    provider_capture_id: string | null;
    capture_started_at: number | null;
    paid_payment_id: string | null;
    last_refresh_at: number | null;
    short_url: string | null;
    expires_at: number;
  }>(
    "SELECT id, status, provider_link_id, provider_capture_id, capture_started_at, paid_payment_id, last_refresh_at, short_url, expires_at FROM checkout_sessions WHERE id = ?1",
    id,
  );

/** The webhook row the jobs hook would have written for one of our orders (whitelisted facts only, core `payPalEventFacts`). */
export async function payPalEventRow(name: string, facts: Record<string, unknown>): Promise<string> {
  const id = uuidv7();
  await env.DB.prepare(
    "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, attempts, facts) VALUES (?1, 'paypal', ?2, ?3, ?4, 'received', 0, ?5)",
  )
    .bind(
      id,
      `WH-${id.replaceAll("-", "").slice(0, 30)}`,
      name,
      Date.now(),
      JSON.stringify({ event: name, ...facts }),
    )
    .run();
  return id;
}

/** A PayPal payment row by its capture id. */
export const ppPaymentOf = (captureId: string) =>
  one<{
    id: string;
    status: string;
    amount_minor: number;
    currency: string;
    mode: string;
    charges_minor: number;
    fee_tax_minor: number | null;
    inr_received_minor: number | null;
    gateway_fee_inr_minor: number | null;
    reference_norm: string;
    received_on: string;
    requested_allocations: string | null;
    checkout_id: string | null;
  }>(
    `SELECT id, status, amount_minor, currency, mode, charges_minor, fee_tax_minor, inr_received_minor, gateway_fee_inr_minor, reference_norm, received_on,
       requested_allocations, checkout_id FROM payments WHERE provider = 'paypal' AND provider_payment_id = ?1`,
    captureId,
  );

/** The simulator's capture id of an order. */
export const capOf = (orderId: string) => `C${orderId}`;
