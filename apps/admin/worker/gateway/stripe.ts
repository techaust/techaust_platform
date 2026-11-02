// The Stripe client of the admin finance Worker (M6.3; ADM-PAY-01, -07, -11, -12; run file docs/runs/m6.3-stripe.md C, L2, L3). The only code that calls Stripe's
// API, with plain `fetch` (no `stripe` package, L2). Rules:
//   - one host only (`https://api.stripe.com`), form-encoded bodies, `Authorization: Bearer <restricted key>` and the pinned `Stripe-Version` on every call; the key
//     is a finance-only Worker secret (`STRIPE_SECRET_KEY`, holding the RESTRICTED `rk_test_` key, L3), never logged;
//   - the key guard runs BEFORE any fetch (CLAUDE.md rule 7, ADM-PAY-11 for Stripe): an `sk_` key or anything not `rk_` is `unconfigured`; a key whose mode is not
//     Settings › Gateways' Stripe mode, or a live key while `PAYMENTS_LIVE_ALLOWED` is not exactly "true", is `live_not_allowed`: no call at all;
//   - every call has its own timeout (`AbortSignal.timeout(8000)`) and answers a typed result, never throws: `network` (no answer, the timeout, a 5xx or 429: try
//     again), `not_found` (404), `forbidden` (401 or 403: the restricted key lacks a permission), `refused` (another 4xx), `bad_answer` (an answer we cannot read);
//     only the code and status are kept, never the body (it can carry the payer's name, email and address: 08-C RB-41);
//   - what comes back is read through core's readers (`readStripeSession`), which keep no personal field.
// Stripe's API as re-read for this file (2026-11-02, docs.stripe.com and Stripe's OpenAPI spec 2026-09-30.endive; run file "Vendor facts"): create
// `POST /v1/checkout/sessions`, retrieve `GET /v1/checkout/sessions/{id}` with `expand[]`, expire `POST /v1/checkout/sessions/{id}/expire` (only while `open`), a
// payment intent `GET /v1/payment_intents/{id}`; `Idempotency-Key` up to 255 characters, kept at least 24 hours, refused when the parameters differ.
// Tests never reach Stripe: the "stub" transport answers locally (`stripeStubFetch`), and the tests pass their own `fetch`.
import type {
  Checkout,
  CheckoutRequest,
  CheckoutStatusReport,
  PaymentProvider,
  PaymentStatusReport,
  ProviderEvent,
  ProviderResult,
  WebhookInput,
} from "@techaust/core/payments";
import {
  type FormPairs,
  formBody,
  parseStripeEvent,
  readStripeSession,
  STRIPE_API_ORIGIN,
  STRIPE_API_VERSION,
  type StripeSession,
  sessionRequestOf,
  stripeAllowed,
  stripeKeyModeOf,
  verifyStripeSignature,
} from "@techaust/core/stripe";

export const STRIPE_TIMEOUT_MS = 8_000;

export type StripeFailure =
  | "live_not_allowed"
  | "unconfigured"
  | "network"
  | "not_found"
  | "forbidden"
  | "refused"
  | "bad_answer";
export type StripeResult<T> = { ok: true; value: T } | { ok: false; code: StripeFailure; status?: number };

export type StripeConfig = {
  /** `STRIPE_SECRET_KEY` (a restricted `rk_test_` key on staging, L3). */
  key: string | undefined;
  /** Settings › Gateways `stripe.mode`. */
  settingsMode: unknown;
  /** `PAYMENTS_LIVE_ALLOWED` as the Worker var arrives. */
  liveFlag: unknown;
  /** The transport: the platform's `fetch`, or a test stub. */
  fetch: typeof fetch;
};

/** A session Stripe made for us: its id, the Checkout page and when it stops (UTC ms). */
export type CreatedSession = { readonly id: string; readonly url: string; readonly expiresAt: number };

export type StripeApi = {
  readonly mode: "test" | "live" | null;
  /** `POST /v1/checkout/sessions` with our checkout id as the `Idempotency-Key` (L4: the same request again returns the same session). */
  createSession(pairs: FormPairs, idempotencyKey: string): Promise<StripeResult<CreatedSession>>;
  /** The session with its payment intent, latest charge and balance transaction expanded (C.6). */
  fetchSession(sessionId: string): Promise<StripeResult<StripeSession>>;
  /** `POST /v1/checkout/sessions/{id}/expire`: Stripe refuses it (`refused`) once the session is complete or already expired. */
  expireSession(sessionId: string): Promise<StripeResult<true>>;
  /** A payment intent's state (the provider contract's `fetchStatus`). */
  fetchPaymentIntent(paymentIntentId: string): Promise<StripeResult<PaymentStatusReport>>;
};

const SESSION_ID = /^cs_[A-Za-z0-9_]{1,252}$/;
const PI_ID = /^pi_[A-Za-z0-9_]{1,252}$/;
const CHECKOUT_HOST = "checkout.stripe.com";
const EXPAND = `expand[]=${encodeURIComponent("payment_intent.latest_charge.balance_transaction")}`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Whether a URL is Stripe's Checkout page (https on `checkout.stripe.com` only, no credentials, ≤ 5000). */
export function isStripeCheckoutUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 5000) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname === CHECKOUT_HOST && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** The answer of a create: the id, the Checkout URL and `expires_at`, else null. */
function readCreated(v: unknown): CreatedSession | null {
  if (!isObj(v) || v.object !== "checkout.session") return null;
  const id = typeof v.id === "string" && SESSION_ID.test(v.id) ? v.id : null;
  const exp = typeof v.expires_at === "number" && Number.isSafeInteger(v.expires_at) ? v.expires_at : null;
  if (!id || exp === null || exp <= 0 || !isStripeCheckoutUrl(v.url)) return null;
  return { id, url: v.url, expiresAt: exp * 1000 };
}

/** The Stripe API client, or a client whose every call answers `live_not_allowed` / `unconfigured` with no fetch. */
export function stripeApi(cfg: StripeConfig): StripeApi {
  const mode = stripeKeyModeOf(cfg.key);
  const gate = (): StripeFailure | null => {
    // L3: no key, or anything but a restricted key (an `sk_` key can do everything on the shared account): not set up.
    if (!cfg.key || mode === null) return "unconfigured";
    return stripeAllowed(cfg.key, cfg.settingsMode, cfg.liveFlag) ? null : "live_not_allowed";
  };
  async function call(
    method: "GET" | "POST",
    path: string,
    body?: string,
    idempotencyKey?: string,
  ): Promise<StripeResult<unknown>> {
    const blocked = gate();
    if (blocked) return { ok: false, code: blocked };
    let res: Response;
    try {
      res = await cfg.fetch(`${STRIPE_API_ORIGIN}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${cfg.key as string}`,
          "Stripe-Version": STRIPE_API_VERSION,
          ...(body === undefined ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, code: "network" };
    }
    if (res.status >= 500 || res.status === 429) {
      await res.body?.cancel();
      return { ok: false, code: "network", status: res.status };
    }
    if (res.status === 404 || res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      return { ok: false, code: res.status === 404 ? "not_found" : "forbidden", status: res.status };
    }
    if (res.status >= 400) {
      await res.body?.cancel();
      return { ok: false, code: "refused", status: res.status };
    }
    try {
      return { ok: true, value: await res.json() };
    } catch {
      return { ok: false, code: "bad_answer", status: res.status };
    }
  }
  return {
    mode,
    async createSession(pairs, idempotencyKey) {
      const r = await call("POST", "/v1/checkout/sessions", formBody(pairs), idempotencyKey);
      if (!r.ok) return r;
      const s = readCreated(r.value);
      return s ? { ok: true, value: s } : { ok: false, code: "bad_answer" };
    },
    async fetchSession(sessionId) {
      if (!SESSION_ID.test(sessionId)) return { ok: false, code: "not_found" };
      const r = await call("GET", `/v1/checkout/sessions/${sessionId}?${EXPAND}`);
      if (!r.ok) return r;
      const s = readStripeSession(r.value);
      return s ? { ok: true, value: s } : { ok: false, code: "bad_answer" };
    },
    async expireSession(sessionId) {
      if (!SESSION_ID.test(sessionId)) return { ok: false, code: "not_found" };
      const r = await call("POST", `/v1/checkout/sessions/${sessionId}/expire`, "");
      return r.ok ? { ok: true, value: true } : r;
    },
    async fetchPaymentIntent(paymentIntentId) {
      if (!PI_ID.test(paymentIntentId)) return { ok: false, code: "not_found" };
      const r = await call("GET", `/v1/payment_intents/${paymentIntentId}`);
      if (!r.ok) return r;
      const p = r.value;
      if (
        !isObj(p) ||
        p.id !== paymentIntentId ||
        typeof p.status !== "string" ||
        typeof p.amount !== "number" ||
        !Number.isSafeInteger(p.amount) ||
        p.amount < 0 ||
        typeof p.created !== "number" ||
        !Number.isSafeInteger(p.created)
      )
        return { ok: false, code: "bad_answer" };
      const currency = p.currency === "usd" ? "USD" : p.currency === "inr" ? "INR" : null;
      if (!currency) return { ok: false, code: "bad_answer" };
      return {
        ok: true,
        value: {
          providerRef: paymentIntentId,
          state: p.status === "succeeded" ? "captured" : p.status === "canceled" ? "failed" : "pending",
          currency,
          amountMinor: p.amount,
          method: null,
          feeMinor: null,
          feeTaxMinor: null,
          createdAt: p.created * 1000,
          orderRef: null,
        },
      };
    },
  };
}

/** The provider contract's error code for one of ours. */
const fail = <T>(code: StripeFailure): ProviderResult<T> => ({
  ok: false,
  code: code === "live_not_allowed" ? "live_not_allowed" : "provider_error",
});

/**
 * The same client as a `PaymentProvider` (ADM-PAY-01), held to `checkProviderContract` by a test. The webhook side checks the signature with the secrets given here
 * (the jobs Worker holds the real one; the finance Worker never verifies webhooks itself). `createCheckout` takes the return page as `callbackUrl` (`?pay=return`)
 * and derives the cancel page from it (`?pay=cancel`); its line and description are the request's `description`.
 */
export function stripeProvider(
  cfg: StripeConfig & { webhookSecrets?: readonly string[]; env?: string },
): PaymentProvider {
  const api = stripeApi(cfg);
  return {
    name: "stripe",
    mode: api.mode,
    async createCheckout(req: CheckoutRequest): Promise<ProviderResult<Checkout>> {
      if (req.currency !== "USD") return { ok: false, code: "unsupported" };
      const now = Date.now();
      const body = sessionRequestOf({
        checkoutId: req.checkoutId,
        documentId: req.documentId,
        env: cfg.env ?? "local",
        amountMinor: req.amountMinor,
        documentLabel: req.description,
        description: req.description,
        expiresAt: req.expiresAt,
        successUrl: req.callbackUrl,
        cancelUrl: req.callbackUrl.replace("?pay=return", "?pay=cancel"),
        now,
      });
      if (!body.ok) {
        // The live guard still answers first for a request we would refuse anyway.
        return api.mode === "live" && !stripeAllowed(cfg.key, cfg.settingsMode, cfg.liveFlag)
          ? { ok: false, code: "live_not_allowed" }
          : { ok: false, code: "provider_error" };
      }
      const r = await api.createSession(body.pairs, req.checkoutId);
      if (!r.ok) return fail(r.code);
      return {
        ok: true,
        value: { providerRef: r.value.id, redirectUrl: r.value.url, expiresAt: r.value.expiresAt },
      };
    },
    async verifyWebhook(input: WebhookInput): Promise<ProviderResult<true>> {
      const v = await verifyStripeSignature(
        input.rawBody,
        input.headers["stripe-signature"],
        cfg.webhookSecrets ?? [],
        Date.now(),
      );
      return v === "ok" ? { ok: true, value: true } : { ok: false, code: "invalid_signature" };
    },
    parseEvent(input: WebhookInput): ProviderResult<ProviderEvent> {
      let obj: unknown;
      try {
        obj = JSON.parse(input.rawBody);
      } catch {
        return { ok: false, code: "invalid_event" };
      }
      const r = parseStripeEvent(obj);
      if (!r.ok) return { ok: false, code: "invalid_event" };
      const e = r.value;
      return {
        ok: true,
        value: {
          id: e.id,
          type: e.type,
          providerRef: e.paymentIntentId ?? e.sessionId ?? e.id,
          checkoutRef: e.sessionId,
          paymentRef: e.paymentIntentId,
          currency: e.currency === "inr" ? "INR" : "USD",
          amountMinor: e.amountTotal ?? 0,
          occurredAt: e.created,
        },
      };
    },
    async fetchStatus(ref: string): Promise<ProviderResult<PaymentStatusReport>> {
      const r = await api.fetchPaymentIntent(ref);
      return r.ok ? r : fail(r.code);
    },
    async fetchCheckout(ref: string): Promise<ProviderResult<CheckoutStatusReport>> {
      const r = await api.fetchSession(ref);
      if (!r.ok) return fail(r.code);
      const s = r.value;
      const paid = s.status === "complete" && s.paymentStatus === "paid";
      return {
        ok: true,
        value: {
          providerRef: s.id,
          referenceId: s.clientReferenceId,
          state: s.status === "expired" ? "expired" : paid ? "paid" : "created",
          currency: s.currency === "inr" ? "INR" : "USD",
          amountMinor: s.amountTotal,
          amountPaidMinor: paid ? s.amountTotal : 0,
          orderRef: null,
          payments: s.pi
            ? [{ paymentRef: s.pi.id, amountMinor: s.pi.amountReceived, status: s.pi.status }]
            : [],
        },
      };
    },
    async cancelCheckout(ref: string): Promise<ProviderResult<true>> {
      const r = await api.expireSession(ref);
      return r.ok ? { ok: true, value: true } : fail(r.code);
    },
    // Refunds are M6.5: before any fetch, the live guard still answers first.
    async refund() {
      if (api.mode === "live" && !stripeAllowed(cfg.key, cfg.settingsMode, cfg.liveFlag))
        return { ok: false, code: "live_not_allowed" };
      return { ok: false, code: "unsupported" };
    },
  };
}

// ---- the local simulator (M6.3, run file F "Local") -------------------------------------------------------------------------------------------------------------
// Stateless and deterministic, so `scripts/pay-simulate.mjs --gateway stripe` and the tests agree with it without storage: a session's id carries its amount, our
// checkout id and the document id (`cs_test_A<amount>R<checkout hex>D<document hex>`); every fetched session is complete and paid by card (a card issued in the
// US), captured, with an INR balance transaction (₹84 per USD, a 3 % fee, GST at 18 % inside it: made-up figures). Locally only.

const STUB_SESSION = /^cs_test_A(\d{1,12})R([0-9a-f]{32})D([0-9a-f]{32})$/;
const STUB_PI = /^pi_A(\d{1,12})R([0-9a-f]{32})$/;
const hexToUuid = (h: string) =>
  `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
const hex32 = (uuid: string | null) => {
  const h = (uuid ?? "").replaceAll("-", "");
  return /^[0-9a-f]{32}$/.test(h) ? h : null;
};
const stubJson = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The simulator's session id for a checkout, amount and document (both UUIDs), or null when either is not one. */
export function stubSessionIdOf(checkoutId: string, amountMinor: number, documentId: string): string | null {
  const c = hex32(checkoutId);
  const d = hex32(documentId);
  return c && d ? `cs_test_A${amountMinor}R${c}D${d}` : null;
}

/** The session object the simulator answers (complete and paid unless `status` says otherwise). */
export function stubSession(
  id: string,
  o: { status?: "open" | "complete" | "expired"; now?: number; env?: string } = {},
): Obj | null {
  const m = STUB_SESSION.exec(id);
  if (!m) return null;
  const amount = Number(m[1]);
  const checkoutId = hexToUuid(m[2] as string);
  const documentId = hexToUuid(m[3] as string);
  const status = o.status ?? "complete";
  const now = Math.trunc((o.now ?? Date.now()) / 1000);
  const marks = {
    app: "techaust",
    techaust_checkout_id: checkoutId,
    techaust_document_id: documentId,
    techaust_env: o.env ?? "local",
  };
  const inr = amount * 84;
  const fee = (inr * 3 - ((inr * 3) % 100)) / 100;
  const tax = (fee * 18 - ((fee * 18) % 118)) / 118;
  const paid = status === "complete";
  return {
    id,
    object: "checkout.session",
    status,
    payment_status: paid ? "paid" : "unpaid",
    livemode: false,
    client_reference_id: checkoutId,
    metadata: marks,
    currency: "usd",
    amount_total: amount,
    expires_at: now + 3_600,
    url: status === "open" ? `https://${CHECKOUT_HOST}/c/pay/${id}` : null,
    payment_intent: paid
      ? {
          id: `pi_A${amount}R${m[2]}`,
          object: "payment_intent",
          status: "succeeded",
          amount_received: amount,
          currency: "usd",
          metadata: marks,
          latest_charge: {
            id: `ch_A${amount}R${m[2]}`,
            object: "charge",
            created: now,
            status: "succeeded",
            captured: true,
            refunded: false,
            amount_refunded: 0,
            disputed: false,
            payment_method_details: { type: "card", card: { country: "US" } },
            balance_transaction: {
              id: `txn_A${amount}R${m[2]}`,
              object: "balance_transaction",
              amount: inr,
              currency: "inr",
              fee,
              fee_details: [
                { amount: fee - tax, currency: "inr", type: "stripe_fee" },
                { amount: tax, currency: "inr", type: "tax" },
              ],
            },
          },
        }
      : null,
  };
}

/** A `fetch` that answers Stripe's four calls as Stripe's API reference shows them (test mode). Locally only. */
export const stripeStubFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? "GET";
  if (method === "POST" && url.pathname === "/v1/checkout/sessions") {
    const f = new URLSearchParams(String(init?.body ?? ""));
    const id = stubSessionIdOf(
      f.get("client_reference_id") ?? "",
      Number(f.get("line_items[0][price_data][unit_amount]")),
      f.get("metadata[techaust_document_id]") ?? "",
    );
    if (!id) return stubJson(400, { error: { type: "invalid_request_error" } });
    const s = stubSession(id, { status: "open", env: f.get("metadata[techaust_env]") ?? "local" });
    return stubJson(200, { ...s, expires_at: Number(f.get("expires_at")) });
  }
  const pi = /^\/v1\/payment_intents\/([^/]+)$/.exec(url.pathname);
  if (pi) {
    const m = STUB_PI.exec(pi[1] ?? "");
    if (!m) return stubJson(404, { error: { type: "invalid_request_error" } });
    return stubJson(200, {
      id: pi[1],
      object: "payment_intent",
      status: "succeeded",
      amount: Number(m[1]),
      currency: "usd",
      created: Math.trunc(Date.now() / 1000),
    });
  }
  const m = /^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/.exec(url.pathname);
  const s = m ? stubSession(m[1] ?? "", { status: m[2] ? "expired" : "complete" }) : null;
  if (!s) return stubJson(404, { error: { type: "invalid_request_error" } });
  return stubJson(200, s);
};
