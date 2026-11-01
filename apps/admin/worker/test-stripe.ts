// Shared helpers of the M6.3 Stripe tests (stripe-gateway.test.ts): the Stripe stub with a record of every call (method, path, form body, Idempotency-Key and
// Stripe-Version), an overseas USD client whose contact may pay online, an issued USD export invoice written straight in, a Stripe Checkout link made through the
// portal's path, and a stored Stripe webhook event. Stripe is never called: the "stub" transport answers (worker/gateway/stripe.ts `stripeStubFetch`), swapped
// per test where Stripe must answer otherwise. All names and amounts are invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { setStubTransport, stubFetch } from "./gateway/config.ts";
import { createLinkFor } from "./gateway/links.ts";
import { stubSession } from "./gateway/stripe.ts";
import { one } from "./test-helpers.ts";
import { type J, mkOverseasClient } from "./test-invoices.ts";

export type StripeCall = {
  method: string;
  path: string;
  body: URLSearchParams | null;
  idempotencyKey: string | null;
  version: string | null;
  auth: string | null;
};

/** Every Stripe call the stub saw. */
export const stripeCalls: StripeCall[] = [];

/** Answers Stripe's calls with the simulator, except where `over` answers (a non-null Response). */
export function stripeStub(
  over?: (path: string, method: string, body: URLSearchParams | null) => Response | null,
) {
  stripeCalls.length = 0;
  setStubTransport(async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? new URLSearchParams(init.body) : null;
    stripeCalls.push({
      method,
      path: url.pathname + url.search,
      body,
      idempotencyKey: headers.get("Idempotency-Key"),
      version: headers.get("Stripe-Version"),
      auth: headers.get("Authorization"),
    });
    return over?.(url.pathname, method, body) ?? stubFetch(input, init);
  });
}

export const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The simulator's session `id`, changed by `edit` (the session, its intent and charge), as Stripe would answer a GET. */
export function sessionAnswer(
  id: string,
  edit: (s: J) => void = () => undefined,
  status: "open" | "complete" | "expired" = "complete",
): Response {
  const s = stubSession(id, { status }) as J;
  edit(s);
  return jsonResponse(200, s);
}

/** An overseas USD client whose primary contact has portal and finance access. */
export async function usdClient() {
  const c = await mkOverseasClient();
  await env.DB.prepare(
    "UPDATE contacts SET portal_access = 1, can_see_finance = 1, is_billing = 1 WHERE id = ?1",
  )
    .bind(c.contactId)
    .run();
  return c;
}

let seq = Math.floor(Date.now() / 1000) % 100_000;

/** An issued USD document written straight in (export invoice by default), USD 500 with its balance. */
export async function usdDoc(
  clientId: string,
  o: { type?: string | undefined; currency?: "USD" | "INR"; total?: number; balance?: number } = {},
): Promise<string> {
  const id = uuidv7();
  const n = ++seq;
  const total = o.total ?? 50_000;
  await env.DB.prepare(
    `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor, content_sha256, updated_at)
     VALUES (?1, ?2, 'issued', ?3, ?4, 'stp-a', '9999', ?5, ?6, 1000, '2026-10-28', '2026-11-04', ?7, ?7, ?7, ?8, ?9, 7000)`,
  )
    .bind(
      id,
      o.type ?? "export_invoice",
      clientId,
      o.currency ?? "USD",
      n,
      `EXP/${n}`,
      total,
      o.balance ?? total,
      "h".repeat(64),
    )
    .run();
  return id;
}

/** A Stripe Checkout link made through the portal's path (signed-in contact). */
export async function stripeLink(
  c: { clientId: string; contactId: string },
  documentId: string,
  amountMinor = 50_000,
  e: Env = env,
) {
  return createLinkFor(e, {
    provider: "stripe",
    clientId: c.clientId,
    contactId: c.contactId,
    tokenHash: null,
    documentId,
    amountMinor,
    returnTo: "invoice",
  });
}

/** The checkout row of a session. */
export const checkoutOf = (sessionId: string) =>
  one<{
    id: string;
    status: string;
    document_id: string;
    amount_minor: number;
    last_refresh_at: number | null;
  }>(
    "SELECT id, status, document_id, amount_minor, last_refresh_at FROM checkout_sessions WHERE provider = 'stripe' AND provider_link_id = ?1",
    sessionId,
  );

/** The webhook row the jobs hook would have written for one of our sessions (whitelisted facts only). */
export async function stripeEventRow(
  sessionId: string,
  checkoutId: string,
  type = "checkout.session.completed",
  facts?: Record<string, unknown>,
): Promise<string> {
  const id = uuidv7();
  await env.DB.prepare(
    "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, attempts, facts) VALUES (?1, 'stripe', ?2, ?3, ?4, 'received', 0, ?5)",
  )
    .bind(
      id,
      `evt_${id.replaceAll("-", "")}`,
      type,
      Date.now(),
      JSON.stringify(facts ?? { event: type, linkId: sessionId, checkoutId, livemode: 0 }),
    )
    .run();
  return id;
}

/** A Stripe payment row by its payment intent. */
export const stripePaymentOf = (pi: string) =>
  one<{
    id: string;
    status: string;
    amount_minor: number;
    currency: string;
    mode: string;
    received_on: string;
    reference_norm: string;
    charges_minor: number;
    fee_tax_minor: number | null;
    inr_received_minor: number | null;
    gateway_fee_inr_minor: number | null;
    gateway_fee_tax_inr_minor: number | null;
    requested_allocations: string | null;
    verified_by: string | null;
  }>(
    `SELECT id, status, amount_minor, currency, mode, received_on, reference_norm, charges_minor, fee_tax_minor, inr_received_minor, gateway_fee_inr_minor,
       gateway_fee_tax_inr_minor, requested_allocations, verified_by FROM payments WHERE provider = 'stripe' AND provider_payment_id = ?1`,
    pi,
  );

/** The simulator's payment intent of a session id (`cs_test_A<amount>R<checkout>D<document>` → `pi_A<amount>R<checkout>`). */
export const piOf = (sessionId: string) =>
  sessionId.replace(/^cs_test_/, "pi_").replace(/D[0-9a-f]{32}$/, "");
