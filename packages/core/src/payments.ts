// Payment providers, pure (M6.1; ADM-PAY-01, ADR 0008). Types, one guard and the manual provider only: no gateway code and no `fetch` (the gateways come in M6.2 to
// M6.4, each implementing `PaymentProvider` and passing `checkProviderContract`; M6.2 widened the interface for Razorpay's payment links: a checkout is a link with
// its own id, it can be fetched and cancelled, and its events carry the link and the payment). Sandbox only until the owner's go-live (`PAYMENTS_LIVE_ALLOWED=false`, CLAUDE.md
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

/**
 * The mode a gateway actually runs in (P7 A2.3, the M3.1 follow-up "a live gateway reverts when the flag turns off"): live only while Settings › Gateways says live
 * AND the go-live flag is exactly true; anything else is test, so a gateway left in live mode after the flag goes back to "false" falls back to its test keys
 * and test hosts at once (the finance Worker rings the owners once per settings version: `gateway/config.ts`).
 */
export const effectiveMode = (settingsMode: unknown, liveAllowedFlag: unknown): ProviderMode =>
  settingsMode === "live" && liveModeAllowed("live", liveAllowedFlag) ? "live" : "test";

// ---- the environment mark (P7, the analyst's Phase 7 finding 5) -------------------------------------------------------------------------------------------
// Staging and production share one sandbox account per gateway, and both environments' webhooks receive every event. So each checkout we make carries this
// Worker's `ENVIRONMENT` (Stripe's `metadata.techaust_env` since M6.3 L5; Razorpay's `notes.techaust_env` and PayPal's `custom_id` suffix since P7), and an event
// whose mark names ANOTHER environment is ignored quietly: no ledger write, no review item, no bell. An event with no mark (made before P7) keeps today's path.

/** The key of the mark in Razorpay's `notes` and Stripe's `metadata`. */
export const ENV_MARK_KEY = "techaust_env";
/** An environment name as a mark (`local`, `staging`, `production`): 1 to 16 lower-case letters. */
export const ENV_MARK = /^[a-z]{1,16}$/;
export const isEnvMark = (v: unknown): v is string => typeof v === "string" && ENV_MARK.test(v);

/** What an event's mark says about it: made here (`same`), made by another environment (`other`), or made before marks existed (`unmarked`: today's path). */
export function envMarkVerdict(
  mark: string | null | undefined,
  env: string | null | undefined,
): "same" | "other" | "unmarked" {
  if (mark === null || mark === undefined) return "unmarked";
  return mark === env ? "same" : "other";
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
  /** The `checkout_sessions` row's id (a UUIDv7, M6.2 L3): the provider's reference for the checkout (Razorpay's `reference_id`, unique per link). */
  readonly checkoutId: string;
  readonly clientId: string;
  readonly documentId: string;
  readonly currency: "INR" | "USD";
  readonly amountMinor: number;
  /** What the gateway's page shows (Razorpay: "Invoice {number}"). */
  readonly description: string;
  /** When the checkout stops taking money (UTC ms). */
  readonly expiresAt: number;
  /** Where the browser returns to; reaching it proves nothing (ADR 0008), so it never carries a token. */
  readonly callbackUrl: string;
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
  // M6.2: a checkout (a Razorpay payment link) was paid, partly paid, expired or cancelled.
  "checkout.paid",
  "checkout.partially_paid",
  "checkout.expired",
  "checkout.cancelled",
  // M6.3: an asynchronous payment on a checkout failed (Stripe's `checkout.session.async_payment_failed`; generic, PayPal's declined capture can reuse it).
  "checkout.failed",
  // M6.4 (PayPal; Step 0.4 row 19): an order approved by the payer (we capture it), an approval PayPal reversed (we re-fetch the order), a capture PayPal holds,
  // and a completed capture PayPal reversed (a review item until M6.5).
  "checkout.approved",
  "checkout.approval_reversed",
  "payment.pending",
  "payment.reversed",
  // M6.5 (run file B; L36): a refund the gateway created or that failed (`refund.processed` above is the one that went out), and a dispute opened or closed. A
  // refund event is matched to OUR refund first (by the gateway's refund id, else our id: Razorpay `receipt`, Stripe `metadata.techaust_refund`, PayPal
  // `custom_id`); an unknown one is `refunded_outside` in Needs review, never a ledger move (L7).
  "refund.created",
  "refund.failed",
  "dispute.opened",
  "dispute.closed",
  "other",
] as const;
export type ProviderEventType = (typeof PROVIDER_EVENT_TYPES)[number];
export type ProviderEvent = {
  /** The provider's event id: the key of `webhook_events` (M6.2; not the real idempotency key when the provider does not sign it: the payment id is). */
  readonly id: string;
  readonly type: ProviderEventType;
  /** The payment's reference when the event names one, else the checkout's. */
  readonly providerRef: string;
  /** M6.2: the checkout (link) the event is about, or null. */
  readonly checkoutRef: string | null;
  /** M6.2: the payment the event is about, or null (an expired or cancelled checkout has none). */
  readonly paymentRef: string | null;
  readonly currency: "INR" | "USD";
  /** The payment's amount (or the checkout's, for an event with no payment); 0 only for an event type we do not handle (`other`). */
  readonly amountMinor: number;
  readonly occurredAt: number;
};

export type ProviderPaymentState = "pending" | "captured" | "failed" | "refunded";
export type PaymentStatusReport = {
  readonly providerRef: string;
  readonly state: ProviderPaymentState;
  readonly currency: "INR" | "USD";
  readonly amountMinor: number;
  /** M6.2: the payment method as the provider names it (Razorpay: upi, card, netbanking, ...), or null. */
  readonly method: string | null;
  /** M6.2: the provider's fee and the tax on it, as it reports them (absorbed, never billed: 08-C RA-29), or null when not reported. */
  readonly feeMinor: number | null;
  readonly feeTaxMinor: number | null;
  /** M6.2: when the payment was made (UTC ms). */
  readonly createdAt: number;
  /** M6.2: the provider's order the payment belongs to, or null. */
  readonly orderRef: string | null;
  /**
   * M6–M7 audit AU6 (B1 M1): how much of it the provider says was already refunded (Razorpay's `amount_refunded`), when it reports more than 0. A payment partly
   * refunded before we first settle it is never confirmed in full (the judge's `partly_refunded`).
   */
  readonly refundedMinor?: number;
};

export type CheckoutState = "created" | "partially_paid" | "paid" | "expired" | "cancelled";
/** M6.2: a checkout (payment link) as the provider reports it when fetched. */
export type CheckoutStatusReport = {
  readonly providerRef: string;
  /** Our reference the checkout was made with (the `checkout_sessions` id). */
  readonly referenceId: string | null;
  readonly state: CheckoutState;
  readonly currency: "INR" | "USD";
  readonly amountMinor: number;
  readonly amountPaidMinor: number;
  readonly orderRef: string | null;
  /** The payments made through it, as the provider lists them. */
  readonly payments: readonly {
    readonly paymentRef: string;
    readonly amountMinor: number;
    readonly status: string;
  }[];
};

export type RefundRequest = {
  /** The payment's reference at the gateway (Razorpay `pay_…`, Stripe PaymentIntent, PayPal capture id). */
  readonly providerRef: string;
  readonly currency: "INR" | "USD";
  readonly amountMinor: number;
  readonly reason: string;
  /**
   * M6.5: our `payment_refunds.id` (a UUIDv7), sent as the gateway's idempotency key (Razorpay `receipt`, Stripe `Idempotency-Key` and
   * `metadata.techaust_refund`, PayPal `PayPal-Request-Id` and `custom_id`), so a retry never refunds twice and a lost answer can be found by it (L37).
   * Optional in the type until every provider implements M6.5's refund (run file C); a refund call without it is refused by the route.
   */
  readonly refundId?: string;
  /** M6.5: the payment's own id (`payments.id`), for the gateway's notes. */
  readonly paymentRef?: string;
};

/** M6.5: where a refund stands at the gateway, mapped from its own status (Stripe `pending`/`requires_action` → pending, `failed`/`canceled` → failed). */
export const REFUND_STATES = ["pending", "processed", "failed"] as const;
export type RefundState = (typeof REFUND_STATES)[number];
/**
 * What `refund` and `fetchRefund` answer: the gateway's refund id and its state. `state` absent reads `pending` (the safe side: the sweep re-fetches it before
 * anything is settled); every M6.5 provider sets it.
 */
export type RefundAnswer = {
  readonly refundRef: string;
  readonly state?: RefundState;
  /** The gateway's failure reason code, when it gives one (≤ 64 characters). */
  readonly failureCode?: string;
};
/** M6.5 (L37): a refund looked up by the gateway's id, or by our id (`byOurId`) when the answer to the create call was lost. */
export type RefundLookup =
  | { readonly refundRef: string }
  | { readonly byOurId: string; readonly paymentRef: string };
export const refundStateOf = (a: RefundAnswer): RefundState => a.state ?? "pending";

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
  /** M6.2: the checkout as the provider holds it now (a status fetch, which ADR 0008 allows). */
  fetchCheckout(providerRef: string): Promise<ProviderResult<CheckoutStatusReport>>;
  /** M6.2: stops a checkout taking money (a replaced or stale link). */
  cancelCheckout(providerRef: string): Promise<ProviderResult<true>>;
  refund(req: RefundRequest): Promise<ProviderResult<RefundAnswer>>;
  /**
   * M6.5 (L37): a refund as the gateway holds it now (by its id, or by our id: Razorpay lists the payment's refunds and matches `receipt`, Stripe lists the
   * PaymentIntent's refunds and matches `metadata.techaust_refund`). Optional until every provider implements it (run file C); absent reads `unsupported`.
   */
  fetchRefund?(lookup: RefundLookup): Promise<ProviderResult<RefundAnswer>>;
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
  fetchCheckout: async () => UNSUPPORTED,
  cancelCheckout: async () => UNSUPPORTED,
  refund: async () => UNSUPPORTED,
  fetchRefund: async () => UNSUPPORTED,
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
 * `validWebhook` parses it into an event with a safe, positive amount; and while live mode is not allowed, a live provider refuses a checkout and (M6.2) every
 * other call that would reach its API (status, checkout fetch, cancel, refund).
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
    checkoutId: "00000000-0000-7000-8000-000000000000",
    clientId: "contract-client",
    documentId: "contract-document",
    currency: "INR",
    amountMinor: 100,
    description: "Contract",
    expiresAt: 4_102_444_800_000,
    callbackUrl: "https://example.invalid/return",
  };
  const liveBlocked = p.mode === "live" && !liveModeAllowed("live", opts.liveAllowed);
  const checkout = (await call("createCheckout", () =>
    p.createCheckout(sample),
  )) as ProviderResult<Checkout> | null;
  if (liveBlocked && checkout?.ok === true) out.push("createCheckout: live mode ran while it is not allowed");
  const verified = (await call("verifyWebhook(empty)", () =>
    p.verifyWebhook(empty),
  )) as ProviderResult<true> | null;
  if (verified?.ok === true) out.push("verifyWebhook(empty): verified an empty webhook");
  const parsed = (await call("parseEvent(empty)", () =>
    p.parseEvent(empty),
  )) as ProviderResult<ProviderEvent> | null;
  if (parsed?.ok === true) out.push("parseEvent(empty): parsed an empty webhook");
  const network: [string, () => unknown][] = [
    ["fetchStatus", () => p.fetchStatus("contract-ref")],
    ["fetchCheckout", () => p.fetchCheckout("contract-ref")],
    ["cancelCheckout", () => p.cancelCheckout("contract-ref")],
    [
      "refund",
      () =>
        p.refund({
          providerRef: "contract-ref",
          currency: "INR",
          amountMinor: 100,
          reason: "contract",
          refundId: "00000000-0000-7000-8000-000000000001",
          paymentRef: "contract-payment",
        }),
    ],
    // M6.5 (ADM-PAY-11): a live key with the go-live flag false fetches no refund either.
    ...(p.fetchRefund
      ? ([
          [
            "fetchRefund",
            () =>
              p.fetchRefund?.({
                byOurId: "00000000-0000-7000-8000-000000000001",
                paymentRef: "contract-ref",
              }),
          ],
        ] as [string, () => unknown][])
      : []),
  ];
  for (const [what, f] of network) {
    const r = (await call(what, f)) as ProviderResult<unknown> | null;
    if (liveBlocked && r?.ok === true) out.push(`${what}: live mode ran while it is not allowed`);
  }
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
