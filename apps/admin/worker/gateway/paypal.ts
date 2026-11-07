// The PayPal client of the admin finance Worker (M6.4; ADM-PAY-01, -04, -07, -11, -12; run file docs/runs/m6.4-paypal.md C, "Step 0 results" 0.4, L1 to L5, L19).
// The only code that calls PayPal's Orders v2 API, with plain `fetch` (no SDK). Rules:
//   - two origins only (`api-m.sandbox.paypal.com`, and `api-m.paypal.com` once Phase 7 allows it): PayPal's credentials carry no test or live prefix, so
//     Settings › Gateways' PayPal mode picks the host (core `paypalOriginFor`); a live mode while `PAYMENTS_LIVE_ALLOWED` is not exactly "true" is
//     `live_not_allowed` BEFORE any fetch (CLAUDE.md rule 7, ADM-PAY-11): zero calls, the token's included;
//   - the access token (`paypal-token.ts`) is minted with Basic auth of `PAYPAL_CLIENT_ID:PAYPAL_CLIENT_SECRET` (finance-only Worker secrets; names only in
//     `.dev.vars.example`), cached per isolate and dropped on a 401 (the call is tried once more); neither is ever logged;
//   - every call has its own timeout (`AbortSignal.timeout(8000)`) and answers a typed result, never throws: `network` (no answer, the timeout, a 5xx or 429),
//     `not_found` (404), `forbidden` (401 or 403 after the re-mint), `refused` (another 4xx), `bad_answer`; the capture call keeps PayPal's error name and issue
//     only (core `captureErrorOf`), never the body (it can carry the payer's name, email and address: L7);
//   - what comes back is read through core's whitelisting readers (`readPayPalOrder`, `readPayPalCapture`): only ids, statuses, our marks, amounts and the
//     two-letter country codes (08-C RA-38), never a payer's personal field (ADM-PAY-12; Settled by the lead on the safest reading, 2026-11-01 (08-C RB-40)).
// PayPal's API as re-read for this file (run file "Step 0 results" 0.4, 2026-11-02): `POST /v1/oauth2/token`; `POST /v2/checkout/orders` (`PayPal-Request-Id`,
// `Prefer: return=minimal`; the `payer-action` link); `GET /v2/checkout/orders/{id}`; `POST /v2/checkout/orders/{id}/capture` (`PayPal-Request-Id`, `Prefer:
// return=representation`); `GET /v2/payments/captures/{id}`. Request ids are kept 6 hours; a duplicate returns the earlier request's latest status.
// Tests never reach PayPal: the "stub" transport answers locally (`payPalStubFetch`), and the tests pass their own `fetch`.
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
  type CaptureError,
  captureErrorOf,
  isPayPalApproveUrl,
  PAYPAL_API_ORIGINS,
  PAYPAL_CAPTURE_ID,
  PAYPAL_ORDER_ID,
  type PayPalCapture,
  type PayPalOrder,
  type PayPalOrderBody,
  parsePayPalEvent,
  payPalCustomIdOf,
  payPalModeOfOrigin,
  paypalOriginFor,
  readPayPalCapture,
  readPayPalOrder,
  usdMinorToValue,
} from "@techaust/core/paypal";
import { type GatewayRefund, readPayPalRefund } from "@techaust/core/refund-gateways";
import { isRedirect, readJsonCapped } from "./answer.ts";
import { dropPayPalToken, payPalToken } from "./paypal-token.ts";

export const PAYPAL_TIMEOUT_MS = 8_000;

export type PayPalFailure =
  | "live_not_allowed"
  | "unconfigured"
  | "network"
  | "not_found"
  | "forbidden"
  | "refused"
  | "bad_answer";
export type PayPalResult<T> = { ok: true; value: T } | { ok: false; code: PayPalFailure; status?: number };

/** What a capture call answers: the order as captured (`return=representation`), or core's reading of PayPal's error, or a gate failure (no call made). */
export type CaptureAnswer =
  | { ok: true; order: PayPalOrder }
  | { ok: false; error: CaptureError }
  | { ok: false; error: null; code: "live_not_allowed" | "unconfigured" | "bad_answer" };

export type PayPalConfig = {
  clientId: string | undefined;
  clientSecret: string | undefined;
  /** Settings › Gateways `paypal.mode`. */
  settingsMode: unknown;
  /** `PAYMENTS_LIVE_ALLOWED` as the Worker var arrives. */
  liveFlag: unknown;
  fetch: typeof fetch;
  /**
   * M6.4 (L31, early check 2 finding 4): false only for the start-up dry run's made-up transport (`warm-rpc.ts`): global scope refuses timers, so the calls
   * go without `AbortSignal.timeout`. Every real client keeps its timeouts.
   */
  timeouts?: boolean;
};

export type PayPalApi = {
  /** The mode of the origin this client calls, or null when it may call none (live blocked, or an unknown mode). */
  readonly mode: "test" | "live" | null;
  /** Why no call can be made at all (checked before any fetch), or null. */
  readonly blocked: "live_not_allowed" | "unconfigured" | null;
  createOrder(body: PayPalOrderBody, requestId: string): Promise<PayPalResult<PayPalOrder>>;
  getOrder(orderId: string): Promise<PayPalResult<PayPalOrder>>;
  captureOrder(orderId: string, requestId: string): Promise<CaptureAnswer>;
  getCapture(captureId: string): Promise<PayPalResult<PayPalCapture>>;
  /**
   * M6.5 (P1): `POST /v2/payments/captures/{id}/refund` with the amount, our refund id as `custom_id` and as `PayPal-Request-Id` (the same request again answers
   * the same refund; P2's retention UNCONFIRMED), `Prefer: return=representation`.
   */
  refundCapture(
    captureId: string,
    amountMinor: number,
    refundId: string,
  ): Promise<PayPalResult<GatewayRefund>>;
  /** M6.5: one refund (`GET /v2/payments/refunds/{id}`). */
  getRefund(refundId: string): Promise<PayPalResult<GatewayRefund>>;
};

type Raw = { status: number; body: unknown };

/** The PayPal API client, or a client whose every call answers `live_not_allowed` / `unconfigured` with no fetch. */
export function payPalApi(cfg: PayPalConfig): PayPalApi {
  const origin = paypalOriginFor(cfg.settingsMode, cfg.liveFlag);
  const blocked: PayPalApi["blocked"] =
    cfg.settingsMode === "live" && origin === null
      ? "live_not_allowed"
      : !origin || !cfg.clientId || !cfg.clientSecret
        ? "unconfigured"
        : null;
  /** One authorised call; the token is minted (or reused), and on a 401 dropped and minted once more. Never throws. */
  async function raw(
    method: "GET" | "POST",
    path: string,
    o: { body?: string; requestId?: string; prefer?: string } = {},
  ): Promise<Raw | { status: 0; body: null } | { gate: PayPalFailure }> {
    if (blocked || !origin) return { gate: blocked ?? "unconfigured" };
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await payPalToken(
        { origin, clientId: cfg.clientId as string, clientSecret: cfg.clientSecret as string },
        cfg.fetch,
        undefined,
        cfg.timeouts !== false,
      );
      if (!token.ok) return token.code === "network" ? { status: 0, body: null } : { gate: token.code };
      let res: Response;
      try {
        res = await cfg.fetch(`${origin}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token.token}`,
            Accept: "application/json",
            ...(o.body === undefined ? {} : { "Content-Type": "application/json" }),
            ...(o.requestId ? { "PayPal-Request-Id": o.requestId } : {}),
            ...(o.prefer ? { Prefer: o.prefer } : {}),
          },
          ...(o.body === undefined ? {} : { body: o.body }),
          ...(cfg.timeouts === false ? {} : { signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS) }),
          // M6–M7 audit AU7 L2: never follow a redirect with our token (a 3xx reads as `bad_answer` below: no body).
          redirect: "manual",
        });
      } catch {
        return { status: 0, body: null };
      }
      if (isRedirect(res)) {
        await res.body?.cancel();
        return { status: res.status, body: null };
      }
      if (res.status === 401 && attempt === 0) {
        await res.body?.cancel();
        dropPayPalToken();
        continue;
      }
      // Bodies are small JSON objects (an order, a capture, an error); one that isn't JSON, or is over the cap (AU7 L3), reads as null.
      let body: unknown = null;
      if (res.status === 204) await res.body?.cancel();
      else {
        const read = await readJsonCapped(res);
        body = read.ok ? read.value : null;
      }
      return { status: res.status, body };
    }
    return { gate: "forbidden" };
  }
  /** The plain result of a call (anything but the capture). */
  async function call(
    method: "GET" | "POST",
    path: string,
    o: { body?: string; requestId?: string; prefer?: string } = {},
  ): Promise<PayPalResult<unknown>> {
    const r = await raw(method, path, o);
    if ("gate" in r) return { ok: false, code: r.gate };
    if (r.status === 0 || r.status >= 500 || r.status === 429)
      return { ok: false, code: "network", status: r.status };
    if (r.status === 404) return { ok: false, code: "not_found", status: 404 };
    if (r.status === 401 || r.status === 403) return { ok: false, code: "forbidden", status: r.status };
    if (r.status >= 400) return { ok: false, code: "refused", status: r.status };
    return r.body === null
      ? { ok: false, code: "bad_answer", status: r.status }
      : { ok: true, value: r.body };
  }
  // P7 A2.1: an approval link is read only on this client's own mode's host (sandbox in test, live in live).
  const hostMode = origin ? (payPalModeOfOrigin(origin) ?? undefined) : undefined;
  return {
    mode: origin ? payPalModeOfOrigin(origin) : null,
    blocked,
    async createOrder(body, requestId) {
      const r = await call("POST", "/v2/checkout/orders", {
        body: JSON.stringify(body),
        requestId,
        prefer: "return=minimal",
      });
      if (!r.ok) return r;
      const o = readPayPalOrder(r.value, hostMode);
      return o ? { ok: true, value: o } : { ok: false, code: "bad_answer" };
    },
    async getOrder(orderId) {
      if (!PAYPAL_ORDER_ID.test(orderId)) return { ok: false, code: "not_found" };
      const r = await call("GET", `/v2/checkout/orders/${orderId}`);
      if (!r.ok) return r;
      const o = readPayPalOrder(r.value, hostMode);
      return o && o.id === orderId ? { ok: true, value: o } : { ok: false, code: "bad_answer" };
    },
    async captureOrder(orderId, requestId) {
      if (!PAYPAL_ORDER_ID.test(orderId)) return { ok: false, error: { kind: "not_found", issue: null } };
      const r = await raw("POST", `/v2/checkout/orders/${orderId}/capture`, {
        body: "{}",
        requestId,
        prefer: "return=representation",
      });
      if ("gate" in r)
        return r.gate === "live_not_allowed" || r.gate === "unconfigured"
          ? { ok: false, error: null, code: r.gate }
          : { ok: false, error: { kind: "refused", issue: r.gate === "forbidden" ? "FORBIDDEN" : null } };
      const e = captureErrorOf(r.status, r.body);
      if (e) return { ok: false, error: e };
      const o = readPayPalOrder(r.body, hostMode);
      return o && o.id === orderId ? { ok: true, order: o } : { ok: false, error: null, code: "bad_answer" };
    },
    async refundCapture(captureId, amountMinor, refundId) {
      if (!PAYPAL_CAPTURE_ID.test(captureId)) return { ok: false, code: "not_found" };
      const value = usdMinorToValue(amountMinor);
      if (value === null) return { ok: false, code: "refused" };
      const r = await call("POST", `/v2/payments/captures/${captureId}/refund`, {
        body: JSON.stringify({ amount: { value, currency_code: "USD" }, custom_id: refundId }),
        requestId: `rfd-${refundId}`,
        prefer: "return=representation",
      });
      if (!r.ok) return r;
      const f = readPayPalRefund(r.value);
      return f ? { ok: true, value: { ...f, paymentRef: captureId } } : { ok: false, code: "bad_answer" };
    },
    async getRefund(refundId) {
      if (!/^[A-Z0-9]{1,64}$/.test(refundId)) return { ok: false, code: "not_found" };
      const r = await call("GET", `/v2/payments/refunds/${refundId}`);
      if (!r.ok) return r;
      const f = readPayPalRefund(r.value);
      return f ? { ok: true, value: f } : { ok: false, code: "bad_answer" };
    },
    async getCapture(captureId) {
      if (!PAYPAL_CAPTURE_ID.test(captureId)) return { ok: false, code: "not_found" };
      const r = await call("GET", `/v2/payments/captures/${captureId}`);
      if (!r.ok) return r;
      const c = readPayPalCapture(r.value);
      return c && c.id === captureId ? { ok: true, value: c } : { ok: false, code: "bad_answer" };
    },
  };
}

// ---- the provider contract (ADM-PAY-01) ---------------------------------------------------------------------------------------------------------------------

const fail = <T>(code: PayPalFailure): ProviderResult<T> => ({
  ok: false,
  code: code === "live_not_allowed" ? "live_not_allowed" : "provider_error",
});

/**
 * The same client as a `PaymentProvider`, held to `checkProviderContract` by a test (0 fetches while live is blocked). The finance Worker never verifies PayPal's
 * webhooks (the jobs Worker does, offline: L1), so `verifyWebhook` refuses everything here. `cancelCheckout` makes no call (an order is ended by never capturing
 * it, L4), but still answers `live_not_allowed` while live is blocked; refunds are M6.5.
 */
export function payPalProvider(cfg: PayPalConfig): PaymentProvider {
  const api = payPalApi(cfg);
  const mode = cfg.settingsMode === "live" ? "live" : cfg.settingsMode === "test" ? "test" : null;
  const gate = <T>(): ProviderResult<T> | null =>
    api.blocked === "live_not_allowed" ? fail("live_not_allowed") : null;
  return {
    name: "paypal",
    mode,
    // Review part 1, finding 9: a PayPal order is made only by `makePayPalLink` (gateway/paypal-links.ts), which has what the generic request lacks: the
    // document's own type and number, and separate return and cancel pages carrying our checkout id (L19). So the adapter never makes one: `unsupported`
    // (after the live gate, so a blocked live mode still answers `live_not_allowed` with no call).
    async createCheckout(_req: CheckoutRequest): Promise<ProviderResult<Checkout>> {
      return gate<Checkout>() ?? { ok: false, code: "unsupported" };
    },
    async verifyWebhook(_input: WebhookInput): Promise<ProviderResult<true>> {
      return { ok: false, code: "invalid_signature" };
    },
    parseEvent(input: WebhookInput): ProviderResult<ProviderEvent> {
      let obj: unknown;
      try {
        obj = JSON.parse(input.rawBody);
      } catch {
        return { ok: false, code: "invalid_event" };
      }
      const r = parsePayPalEvent(obj);
      if (!r.ok || !r.value.id) return { ok: false, code: "invalid_event" };
      const e = r.value;
      return {
        ok: true,
        value: {
          id: e.id as string,
          type: e.type,
          providerRef: e.captureRef ?? e.orderRef ?? (e.id as string),
          checkoutRef: e.orderRef,
          paymentRef: e.captureRef,
          currency: e.currency === "INR" ? "INR" : "USD",
          amountMinor: e.amountMinor ?? 0,
          occurredAt: e.occurredAt ?? 0,
        },
      };
    },
    async fetchStatus(ref: string): Promise<ProviderResult<PaymentStatusReport>> {
      const g = gate<PaymentStatusReport>();
      if (g) return g;
      const r = await api.getCapture(ref);
      if (!r.ok) return fail(r.code);
      const c = r.value;
      if (c.amountMinor === null || (c.currency !== "USD" && c.currency !== "INR")) return fail("bad_answer");
      return {
        ok: true,
        value: {
          providerRef: c.id,
          state:
            c.status === "COMPLETED"
              ? "captured"
              : c.status === "PENDING"
                ? "pending"
                : c.status === "DECLINED" || c.status === "FAILED"
                  ? "failed"
                  : "refunded",
          currency: c.currency,
          amountMinor: c.amountMinor,
          method: null,
          feeMinor: c.fee?.currency === c.currency ? c.fee.minor : null,
          feeTaxMinor: null,
          createdAt: c.createdAt,
          orderRef: c.orderId,
        },
      };
    },
    async fetchCheckout(ref: string): Promise<ProviderResult<CheckoutStatusReport>> {
      const g = gate<CheckoutStatusReport>();
      if (g) return g;
      const r = await api.getOrder(ref);
      if (!r.ok) return fail(r.code);
      const o = r.value;
      const paid = o.captures.filter((c) => c.status === "COMPLETED" && c.amountMinor !== null);
      const paidMinor = paid.reduce((s, c) => s + (c.amountMinor as number), 0);
      return {
        ok: true,
        value: {
          providerRef: o.id,
          referenceId: o.customId,
          state: o.status === "COMPLETED" ? "paid" : o.status === "VOIDED" ? "cancelled" : "created",
          currency: o.currency === "INR" ? "INR" : "USD",
          amountMinor: o.amountMinor ?? 0,
          amountPaidMinor: paidMinor,
          orderRef: o.id,
          payments: o.captures.map((c) => ({
            paymentRef: c.id,
            amountMinor: c.amountMinor ?? 0,
            status: c.status,
          })),
        },
      };
    },
    async cancelCheckout(_ref: string): Promise<ProviderResult<true>> {
      return gate<true>() ?? { ok: true, value: true };
    },
    async refund() {
      return gate<{ refundRef: string }>() ?? { ok: false, code: "unsupported" };
    },
  };
}

// ---- the local simulator (run file D "Local only", F) ---------------------------------------------------------------------------------------------------------
// Stateless and deterministic, so `scripts/pay-simulate.mjs --paypal` and the tests agree with it without storage: an order's id is the checkout id in base32 (26
// characters, A-Z and 2-7) followed by the amount in cents (decimal), at most 36 characters; its one capture is `C` and the same. Every order the simulator is asked
// for is approved and, once captured, completed, paid from a PayPal account in the US (made-up figures, a 3 % fee in USD). Locally only.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** The 16 bytes of a UUID as 26 base32 characters (the last 2 bits zero), or null. */
function uuidToB32(uuid: string): string | null {
  const h = uuid.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/.test(h)) return null;
  let bits = 0;
  let acc = 0;
  let out = "";
  for (let i = 0; i < 32; i += 2) {
    acc = (acc << 8) | Number.parseInt(h.slice(i, i + 2), 16);
    bits += 8;
    while (bits >= 5) {
      out += B32[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  return out + B32[(acc << (5 - bits)) & 31];
}

/** The UUID back from 26 base32 characters, or null. */
function b32ToUuid(s: string): string | null {
  if (!/^[A-Z2-7]{26}$/.test(s)) return null;
  let bits = 0;
  let acc = 0;
  let hex = "";
  for (const ch of s) {
    acc = (acc << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      hex += ((acc >>> (bits - 8)) & 255).toString(16).padStart(2, "0");
      bits -= 8;
      acc &= (1 << bits) - 1;
    }
  }
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** The simulator's order id for a checkout and amount (cents), or null when it doesn't fit PayPal's 36 characters. */
export function stubOrderIdOf(checkoutId: string, amountMinor: number): string | null {
  const b = uuidToB32(checkoutId);
  if (!b || !Number.isSafeInteger(amountMinor) || amountMinor < 1) return null;
  const id = `${b}${amountMinor}`;
  return id.length <= 36 ? id : null;
}

/** The checkout and amount an id of the simulator carries (an order id, or a capture id with its leading `C`), or null. */
function stubParts(id: string): { checkoutId: string; amountMinor: number } | null {
  const m = /^C?([A-Z2-7]{26})(\d{1,10})$/.exec(id);
  const checkoutId = m ? b32ToUuid(m[1] as string) : null;
  return m && checkoutId ? { checkoutId, amountMinor: Number(m[2]) } : null;
}

const usd = (minor: number) => `${(minor - (minor % 100)) / 100}.${String(minor % 100).padStart(2, "0")}`;

/** The capture object the simulator answers for an order id. */
export function stubCapture(
  orderId: string,
  o: { status?: string; now?: number } = {},
): Record<string, unknown> | null {
  const p = stubParts(orderId);
  if (!p) return null;
  const fee = (p.amountMinor * 3 - ((p.amountMinor * 3) % 100)) / 100;
  const at = new Date(o.now ?? Date.now()).toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    id: `C${orderId}`,
    status: o.status ?? "COMPLETED",
    amount: { currency_code: "USD", value: usd(p.amountMinor) },
    final_capture: true,
    seller_protection: { status: "ELIGIBLE" },
    seller_receivable_breakdown: {
      gross_amount: { currency_code: "USD", value: usd(p.amountMinor) },
      paypal_fee: { currency_code: "USD", value: usd(fee) },
      net_amount: { currency_code: "USD", value: usd(p.amountMinor - fee) },
    },
    // P7: marked "local" like the orders this Worker makes locally (`payPalCustomIdOf`), so every local path reads the split.
    custom_id: payPalCustomIdOf(p.checkoutId, "local"),
    create_time: at,
    update_time: at,
    supplementary_data: { related_ids: { order_id: orderId } },
  };
}

/** The order object the simulator answers: approved by a payer in the US, and (`captured`) completed with its one capture. */
export function stubOrder(
  orderId: string,
  o: { captured?: boolean; now?: number } = {},
): Record<string, unknown> | null {
  const p = stubParts(orderId);
  if (!p) return null;
  const capture = o.captured === false ? null : stubCapture(orderId, o);
  return {
    id: orderId,
    intent: "CAPTURE",
    status: capture ? "COMPLETED" : "APPROVED",
    payment_source: { paypal: { address: { country_code: "US" } } },
    payer: { address: { country_code: "US" } },
    purchase_units: [
      {
        reference_id: p.checkoutId,
        custom_id: payPalCustomIdOf(p.checkoutId, "local"),
        amount: { currency_code: "USD", value: usd(p.amountMinor) },
        ...(capture ? { payments: { captures: [capture] } } : {}),
      },
    ],
    links: [
      {
        href: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`,
        rel: "payer-action",
        method: "GET",
      },
    ],
  };
}

type StubAnswer = { status: number; body: unknown };
const stubJson = (status: number, body: unknown): StubAnswer => ({ status, body });

/** The simulator's answer to one PayPal call (its status and JSON body), with no Response made (the start-up dry run uses it at global scope too). */
export function payPalStubAnswer(input: RequestInfo | URL, init?: RequestInit): StubAnswer {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (`${url.protocol}//${url.host}` !== PAYPAL_API_ORIGINS.test)
    return stubJson(404, { name: "RESOURCE_NOT_FOUND" });
  const method = init?.method ?? "GET";
  if (method === "POST" && url.pathname === "/v1/oauth2/token")
    return stubJson(200, { access_token: "A21AA-local-simulator", token_type: "Bearer", expires_in: 32_400 });
  // M6.5: a capture's refund, completed at once (the request id carries our refund id, so a repeat answers the same refund).
  const refundOf = /^\/v2\/payments\/captures\/([A-Z0-9]+)\/refund$/.exec(url.pathname);
  if (method === "POST" && refundOf) {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      amount?: { value?: string };
      custom_id?: string;
    };
    const ours = String(body.custom_id ?? "");
    return stubJson(201, {
      id: `R${ours.replaceAll("-", "").slice(0, 20).toUpperCase()}`,
      status: "COMPLETED",
      amount: { value: body.amount?.value ?? "0.00", currency_code: "USD" },
      custom_id: ours,
    });
  }
  if (method === "POST" && url.pathname === "/v2/checkout/orders") {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      purchase_units?: { reference_id?: string; amount?: { value?: string } }[];
    };
    const unit = body.purchase_units?.[0];
    const [units, cents = "00"] = String(unit?.amount?.value ?? "").split(".");
    // P7: `reference_id` is the bare checkout id (`custom_id` carries the environment mark after it).
    const id = stubOrderIdOf(
      String(unit?.reference_id ?? ""),
      Number(units) * 100 + Number(cents.padEnd(2, "0")),
    );
    if (!id)
      return stubJson(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INVALID_PARAMETER_VALUE" }] });
    return stubJson(200, {
      id,
      status: "PAYER_ACTION_REQUIRED",
      links: [
        {
          href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`,
          rel: "payer-action",
          method: "GET",
        },
      ],
    });
  }
  const capture = /^\/v2\/checkout\/orders\/([A-Z0-9]+)\/capture$/.exec(url.pathname);
  if (method === "POST" && capture) {
    const o = stubOrder(capture[1] as string);
    return o
      ? stubJson(201, o)
      : stubJson(404, { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] });
  }
  const order = /^\/v2\/checkout\/orders\/([A-Z0-9]+)$/.exec(url.pathname);
  if (order) {
    const o = stubOrder(order[1] as string);
    return o ? stubJson(200, o) : stubJson(404, { name: "RESOURCE_NOT_FOUND" });
  }
  const cap = /^\/v2\/payments\/captures\/C([A-Z0-9]+)$/.exec(url.pathname);
  if (cap) {
    const c = stubCapture(cap[1] as string);
    return c ? stubJson(200, c) : stubJson(404, { name: "RESOURCE_NOT_FOUND" });
  }
  return stubJson(404, { name: "RESOURCE_NOT_FOUND" });
}

/** A `fetch` that answers PayPal's five calls as the Orders v2 reference shows them (sandbox). Locally only. */
export const payPalStubFetch: typeof fetch = async (input, init) => {
  const a = payPalStubAnswer(input, init);
  return new Response(JSON.stringify(a.body), {
    status: a.status,
    headers: { "Content-Type": "application/json" },
  });
};

/** Whether a stored approval URL may be handed back to the client (`retryUrl`, 07-ZN line 8): PayPal's page for this very order only. */
export const retryUrlOf = (shortUrl: string | null, orderId: string | null): string | undefined =>
  shortUrl && orderId && isPayPalApproveUrl(shortUrl, orderId) ? shortUrl : undefined;
