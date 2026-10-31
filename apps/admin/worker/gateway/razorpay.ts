// The Razorpay client of the admin finance Worker (M6.2; ADM-PAY-01, -02, -07, -11, -12; run file docs/runs/m6.2-razorpay.md C). The only code that calls
// Razorpay's API. Rules:
//   - one host only (`api.razorpay.com`), Basic auth with the key id and secret (finance-only Worker secrets, L1), never logged;
//   - the live guard runs BEFORE any fetch (CLAUDE.md rule 7, ADM-PAY-11 for Razorpay): a `rzp_live_` key while `PAYMENTS_LIVE_ALLOWED` is not exactly "true", or a
//     key whose mode is not the one Settings › Gateways names, makes no call at all (`live_not_allowed`);
//   - every call has its own timeout (`AbortSignal.timeout(8000)`), and answers a typed result, never throws: `network` (no answer, the timeout, a 5xx: try again),
//     `not_found` (404), `refused` (another 4xx), `bad_answer` (an answer we cannot read), with only the code and status kept (never the body: it can carry payer data);
//   - what comes back is read through core's whitelisting readers (`readRazorpayLink`, `readRazorpayPayment`; L8, 08-C RB-40).
// Tests never reach Razorpay: they pass a stub `fetch` (`GATEWAY_TRANSPORT` "stub" locally, refused everywhere else).
// Razorpay's API as read for this file (2026-11-01, Context7 /razorpay/razorpay-node documents/paymentLink.md): create `POST /v1/payment_links`, fetch
// `GET /v1/payment_links/{id}`, fetch all with `?reference_id=` (the list's field name is not shown there: `payment_links` is read, as Razorpay's API reference
// shows it, else nothing is adopted), cancel `POST /v1/payment_links/{id}/cancel`; a payment `GET /v1/payments/{id}`.
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
  keyModeOf,
  parseRazorpayEvent,
  RAZORPAY_API_ORIGIN,
  type RazorpayLink,
  type RazorpayLinkRequest,
  razorpayAllowed,
  razorpayEventIdOf,
  readRazorpayLink,
  readRazorpayPayment,
  verifyRazorpaySignature,
} from "@techaust/core/razorpay";

export const RAZORPAY_TIMEOUT_MS = 8_000;

export type RzpFailure =
  | "live_not_allowed"
  | "unconfigured"
  | "network"
  | "not_found"
  | "refused"
  | "bad_answer";
export type RzpResult<T> = { ok: true; value: T } | { ok: false; code: RzpFailure; status?: number };

export type RazorpayConfig = {
  keyId: string | undefined;
  keySecret: string | undefined;
  /** Settings › Gateways `razorpay.mode`. */
  settingsMode: unknown;
  /** `PAYMENTS_LIVE_ALLOWED` as the Worker var arrives. */
  liveFlag: unknown;
  /** The transport: the platform's `fetch`, or a test stub. */
  fetch: typeof fetch;
};

export type RazorpayApi = {
  readonly mode: "test" | "live" | null;
  createLink(body: RazorpayLinkRequest): Promise<RzpResult<RazorpayLink>>;
  fetchLink(linkId: string): Promise<RzpResult<RazorpayLink>>;
  /** The links made with our `reference_id` (a checkout id): at most one, as Razorpay keeps the reference unique. */
  findLinkByReference(referenceId: string): Promise<RzpResult<RazorpayLink | null>>;
  cancelLink(linkId: string): Promise<RzpResult<RazorpayLink | null>>;
  fetchPayment(paymentId: string): Promise<RzpResult<PaymentStatusReport>>;
};

const LINK_ID = /^plink_[A-Za-z0-9]{1,58}$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9]{1,60}$/;
const REFERENCE = /^[A-Za-z0-9_.-]{1,40}$/;

/** Basic auth for the key pair (btoa of ASCII: key ids and secrets are ASCII). */
const basic = (id: string, secret: string) => `Basic ${btoa(`${id}:${secret}`)}`;

/** The Razorpay API client, or a client whose every call answers `live_not_allowed` / `unconfigured` with no fetch. */
export function razorpayApi(cfg: RazorpayConfig): RazorpayApi {
  const mode = keyModeOf(cfg.keyId);
  const gate = (): RzpFailure | null => {
    if (!cfg.keyId || !cfg.keySecret) return "unconfigured";
    return razorpayAllowed(cfg.keyId, cfg.settingsMode, cfg.liveFlag) ? null : "live_not_allowed";
  };
  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<RzpResult<unknown>> {
    const blocked = gate();
    if (blocked) return { ok: false, code: blocked };
    let res: Response;
    try {
      res = await cfg.fetch(`${RAZORPAY_API_ORIGIN}${path}`, {
        method,
        headers: {
          Authorization: basic(cfg.keyId as string, cfg.keySecret as string),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(RAZORPAY_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, code: "network" };
    }
    if (res.status >= 500) {
      await res.body?.cancel();
      return { ok: false, code: "network", status: res.status };
    }
    if (res.status === 404) {
      await res.body?.cancel();
      return { ok: false, code: "not_found", status: 404 };
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { ok: false, code: "bad_answer", status: res.status };
    }
    if (res.status >= 400) return { ok: false, code: "refused", status: res.status };
    return { ok: true, value: json };
  }
  const asLink = (r: RzpResult<unknown>): RzpResult<RazorpayLink> => {
    if (!r.ok) return r;
    const link = readRazorpayLink(r.value);
    return link ? { ok: true, value: link } : { ok: false, code: "bad_answer" };
  };
  return {
    mode,
    async createLink(body) {
      return asLink(await call("POST", "/v1/payment_links", body));
    },
    async fetchLink(linkId) {
      if (!LINK_ID.test(linkId)) return { ok: false, code: "not_found" };
      return asLink(await call("GET", `/v1/payment_links/${linkId}`));
    },
    async findLinkByReference(referenceId) {
      if (!REFERENCE.test(referenceId)) return { ok: true, value: null };
      const r = await call("GET", `/v1/payment_links?reference_id=${encodeURIComponent(referenceId)}`);
      if (!r.ok) return r;
      const list = (r.value as { payment_links?: unknown })?.payment_links;
      if (!Array.isArray(list) || list.length === 0) return { ok: true, value: null };
      const link = readRazorpayLink(list[0]);
      return link && link.referenceId === referenceId ? { ok: true, value: link } : { ok: true, value: null };
    },
    async cancelLink(linkId) {
      if (!LINK_ID.test(linkId)) return { ok: false, code: "not_found" };
      const r = await call("POST", `/v1/payment_links/${linkId}/cancel`, {});
      if (!r.ok) return r;
      return { ok: true, value: readRazorpayLink(r.value) };
    },
    async fetchPayment(paymentId) {
      if (!PAYMENT_ID.test(paymentId)) return { ok: false, code: "not_found" };
      const r = await call("GET", `/v1/payments/${paymentId}`);
      if (!r.ok) return r;
      const p = readRazorpayPayment(r.value);
      return p ? { ok: true, value: p } : { ok: false, code: "bad_answer" };
    },
  };
}

/** The provider contract's error code for one of ours. */
const providerCode = (code: RzpFailure): "live_not_allowed" | "provider_error" =>
  code === "live_not_allowed" ? "live_not_allowed" : "provider_error";
const fail = <T>(code: RzpFailure): ProviderResult<T> => ({ ok: false, code: providerCode(code) });

/**
 * The same client as a `PaymentProvider` (ADM-PAY-01): the shape M6.3 and M6.4 implement too, held to `checkProviderContract` by a test. The webhook side checks
 * the signature with the secret given here (the jobs Worker holds the real one; the finance Worker never verifies webhooks itself).
 */
export function razorpayProvider(
  cfg: RazorpayConfig & { webhookSecrets?: readonly string[] },
): PaymentProvider {
  const api = razorpayApi(cfg);
  return {
    name: "razorpay",
    mode: api.mode,
    async createCheckout(req: CheckoutRequest): Promise<ProviderResult<Checkout>> {
      if (req.currency !== "INR") return { ok: false, code: "unsupported" };
      const r = await api.createLink({
        amount: req.amountMinor,
        currency: "INR",
        accept_partial: false,
        description: req.description,
        reference_id: req.checkoutId,
        expire_by: Math.trunc(req.expiresAt / 1000),
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: { document_id: req.documentId, checkout_id: req.checkoutId },
        callback_url: req.callbackUrl,
        callback_method: "get",
      });
      if (!r.ok) return fail(r.code);
      if (!r.value.shortUrl) return { ok: false, code: "provider_error" };
      return {
        ok: true,
        value: {
          providerRef: r.value.providerRef,
          redirectUrl: r.value.shortUrl,
          expiresAt: r.value.expiresAt ?? req.expiresAt,
        },
      };
    },
    async verifyWebhook(input: WebhookInput): Promise<ProviderResult<true>> {
      const ok = await verifyRazorpaySignature(
        input.rawBody,
        input.headers["x-razorpay-signature"] ?? "",
        cfg.webhookSecrets ?? [],
      );
      return ok ? { ok: true, value: true } : { ok: false, code: "invalid_signature" };
    },
    parseEvent(input: WebhookInput): ProviderResult<ProviderEvent> {
      let obj: unknown;
      try {
        obj = JSON.parse(input.rawBody);
      } catch {
        return { ok: false, code: "invalid_event" };
      }
      const id = razorpayEventIdOf(input.headers["x-razorpay-event-id"]);
      if (!id) return { ok: false, code: "invalid_event" };
      const r = parseRazorpayEvent(obj, id);
      return r.ok ? { ok: true, value: r.value } : { ok: false, code: "invalid_event" };
    },
    async fetchStatus(ref: string): Promise<ProviderResult<PaymentStatusReport>> {
      const r = await api.fetchPayment(ref);
      return r.ok ? r : fail(r.code);
    },
    async fetchCheckout(ref: string): Promise<ProviderResult<CheckoutStatusReport>> {
      const r = await api.fetchLink(ref);
      return r.ok ? r : fail(r.code);
    },
    async cancelCheckout(ref: string): Promise<ProviderResult<true>> {
      const r = await api.cancelLink(ref);
      return r.ok ? { ok: true, value: true } : fail(r.code);
    },
    // Refunds are M6.5: before any fetch, the live guard still answers first.
    async refund() {
      if (api.mode === "live" && !razorpayAllowed(cfg.keyId, cfg.settingsMode, cfg.liveFlag))
        return { ok: false, code: "live_not_allowed" };
      return { ok: false, code: "unsupported" };
    },
  };
}
