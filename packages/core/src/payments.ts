// Payment providers, pure (M6.1; ADM-PAY-01, ADR 0008). Types, one guard and the manual provider only: no gateway code and no `fetch` (the gateways come in M6.2 to
// M6.4, each implementing `PaymentProvider` and passing `checkProviderContract`). Sandbox only until the owner's go-live (`PAYMENTS_LIVE_ALLOWED=false`, CLAUDE.md
// rule 7): `liveModeAllowed` refuses a live mode while the flag is not exactly true. Nothing is ever marked paid on a redirect: a checkout's return proves
// nothing, only a verified webhook or a status fetch does (ADR 0008), and the ledger moves only through a confirmed payment row.

/** The modes of a gateway account: its test (sandbox) keys or its live keys. */
export const PROVIDER_MODES = ["test", "live"] as const;
export type ProviderMode = (typeof PROVIDER_MODES)[number];
export const isProviderMode = (v: unknown): v is ProviderMode => v === "test" || v === "live";

/**
 * Whether a provider may run in `mode`: a test mode always; a live mode only while the go-live flag is exactly `true` (or the text "true", as a Worker var
 * arrives). Anything else (missing, "false", "TRUE ", 1) keeps live mode off: the safe side.
 */
export function liveModeAllowed(mode: ProviderMode, liveAllowedFlag: unknown): boolean {
  if (mode === "test") return true;
  return mode === "live" && (liveAllowedFlag === true || liveAllowedFlag === "true");
}

export const PROVIDER_ERROR_CODES = [
  "unsupported",
  "live_not_allowed",
  "invalid_signature",
  "invalid_event",
  "provider_error",
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];
/** Every provider method answers with this, never by throwing (a contract the helper below checks). */
export type ProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ProviderErrorCode };

export type CheckoutRequest = {
  /** The payment row's id (a UUIDv7): the provider's idempotency key and the reference its events carry back. */
  readonly paymentId: string;
  readonly clientId: string;
  readonly documentId: string;
  readonly currency: "INR" | "USD";
  readonly amountMinor: number;
  /** Where the browser returns to; reaching it proves nothing (ADR 0008). */
  readonly returnUrl: string;
};
export type Checkout = {
  readonly providerRef: string;
  readonly redirectUrl: string;
  readonly expiresAt: number;
};

/** A webhook exactly as it arrived: the raw body (signatures are checked on it, never on parsed JSON) and the headers, lower-cased. */
export type WebhookInput = { readonly rawBody: string; readonly headers: Readonly<Record<string, string>> };

export const PROVIDER_EVENT_TYPES = [
  "payment.captured",
  "payment.failed",
  "refund.processed",
  "other",
] as const;
export type ProviderEventType = (typeof PROVIDER_EVENT_TYPES)[number];
export type ProviderEvent = {
  /** The provider's event id: the idempotency key of `webhook_events` (M6.2). */
  readonly id: string;
  readonly type: ProviderEventType;
  readonly providerRef: string;
  readonly currency: "INR" | "USD";
  readonly amountMinor: number;
  readonly occurredAt: number;
};

export type ProviderPaymentState = "pending" | "captured" | "failed" | "refunded";
export type PaymentStatusReport = {
  readonly providerRef: string;
  readonly state: ProviderPaymentState;
  readonly currency: "INR" | "USD";
  readonly amountMinor: number;
};

export type RefundRequest = {
  readonly providerRef: string;
  readonly currency: "INR" | "USD";
  readonly amountMinor: number;
  readonly reason: string;
};

/** The interface every payment provider implements (ADM-PAY-01). `mode` is null for the manual provider, which has no keys. */
export interface PaymentProvider {
  readonly name: string;
  readonly mode: ProviderMode | null;
  createCheckout(req: CheckoutRequest): Promise<ProviderResult<Checkout>>;
  /** Checks the signature on the raw body; `ok: true` with `true` only when it matches. */
  verifyWebhook(input: WebhookInput): Promise<ProviderResult<true>>;
  /** Reads a VERIFIED webhook's event; a body it does not understand is `invalid_event`. */
  parseEvent(input: WebhookInput): ProviderResult<ProviderEvent>;
  fetchStatus(providerRef: string): Promise<ProviderResult<PaymentStatusReport>>;
  refund(req: RefundRequest): Promise<ProviderResult<{ readonly refundRef: string }>>;
}

const UNSUPPORTED = Object.freeze({ ok: false, code: "unsupported" } as const);

/**
 * Manual and bank-transfer entries (ADM-PAY-05): recorded by a person, confirmed by the Owner. It has no gateway, so every gateway method answers `unsupported`.
 */
export const manualProvider: PaymentProvider = Object.freeze({
  name: "manual",
  mode: null,
  createCheckout: async () => UNSUPPORTED,
  verifyWebhook: async () => UNSUPPORTED,
  parseEvent: () => UNSUPPORTED,
  fetchStatus: async () => UNSUPPORTED,
  refund: async () => UNSUPPORTED,
});

// ---- the contract every provider passes (M6.2 to M6.4 reuse it in their tests) ------------------------------------------------------------------------

const isResult = (r: unknown): boolean => {
  if (r === null || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  if (o.ok === true) return "value" in o;
  return (
    o.ok === false &&
    typeof o.code === "string" &&
    (PROVIDER_ERROR_CODES as readonly string[]).includes(o.code)
  );
};

export type ContractOptions = {
  /** The go-live flag the provider runs under (the tests pass false, as staging does). */
  readonly liveAllowed: unknown;
  /** A webhook the provider must accept (signed with its test secret), if it takes webhooks. */
  readonly validWebhook?: WebhookInput;
};

/**
 * The provider contract, as a list of failures (empty: it passes): a name; a known mode or none; a live mode only where `liveModeAllowed` lets it; every
 * method answers a `ProviderResult` and never throws; a webhook with no body and no headers never verifies and never parses; a provider that verifies
 * `validWebhook` parses it into an event with a safe, positive amount; and while live mode is not allowed, a live provider refuses a checkout.
 */
export async function checkProviderContract(p: PaymentProvider, opts: ContractOptions): Promise<string[]> {
  const out: string[] = [];
  if (typeof p.name !== "string" || p.name === "") out.push("name");
  if (p.mode !== null && !isProviderMode(p.mode)) out.push("mode");
  const call = async (what: string, f: () => unknown): Promise<unknown> => {
    try {
      const r = await f();
      if (!isResult(r)) out.push(`${what}: not a ProviderResult`);
      return r;
    } catch {
      out.push(`${what}: threw`);
      return null;
    }
  };
  const empty: WebhookInput = { rawBody: "", headers: {} };
  const sample: CheckoutRequest = {
    paymentId: "00000000-0000-7000-8000-000000000000",
    clientId: "contract-client",
    documentId: "contract-document",
    currency: "INR",
    amountMinor: 100,
    returnUrl: "https://example.invalid/return",
  };
  const checkout = (await call("createCheckout", () =>
    p.createCheckout(sample),
  )) as ProviderResult<Checkout> | null;
  if (p.mode === "live" && !liveModeAllowed("live", opts.liveAllowed) && checkout?.ok === true)
    out.push("createCheckout: live mode ran while it is not allowed");
  const verified = (await call("verifyWebhook(empty)", () =>
    p.verifyWebhook(empty),
  )) as ProviderResult<true> | null;
  if (verified?.ok === true) out.push("verifyWebhook(empty): verified an empty webhook");
  const parsed = (await call("parseEvent(empty)", () =>
    p.parseEvent(empty),
  )) as ProviderResult<ProviderEvent> | null;
  if (parsed?.ok === true) out.push("parseEvent(empty): parsed an empty webhook");
  await call("fetchStatus", () => p.fetchStatus("contract-ref"));
  await call("refund", () =>
    p.refund({ providerRef: "contract-ref", currency: "INR", amountMinor: 100, reason: "contract" }),
  );
  if (opts.validWebhook) {
    const hook = opts.validWebhook;
    const ok = (await call("verifyWebhook(valid)", () =>
      p.verifyWebhook(hook),
    )) as ProviderResult<true> | null;
    if (ok?.ok !== true) out.push("verifyWebhook(valid): refused the valid webhook");
    const ev = (await call("parseEvent(valid)", () =>
      p.parseEvent(hook),
    )) as ProviderResult<ProviderEvent> | null;
    if (ev?.ok === true) {
      if (!Number.isSafeInteger(ev.value.amountMinor) || ev.value.amountMinor <= 0)
        out.push("parseEvent(valid): amount");
      if (!(PROVIDER_EVENT_TYPES as readonly string[]).includes(ev.value.type))
        out.push("parseEvent(valid): type");
    } else out.push("parseEvent(valid): did not parse the valid webhook");
  }
  return out;
}
