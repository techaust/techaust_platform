// The RPC contracts of the admin finance Worker's gateway entrypoints (M6.2; ADM-PAY-02, -07, ADM-INV-10, JOB-HOOK-02, POR-06; run file docs/runs/m6.2-razorpay.md B,
// C): `GatewayEvents` (bound by the jobs Worker as `ADMIN_GATEWAY`) and `PortalPayments` (bound by the portal as `ADMIN_PAY`). The classes `implements` these
// interfaces, so the two sides cannot drift; an answer that crossed a service binding is not trusted by its type alone, so each has a runtime guard (the
// `care-billing` pattern, `isDraftCareResult`). Every id argument is 1 to 64 characters (`isRpcId`); nothing here carries a clock or an amount the callee
// would trust without its own SQL checks.

/** An id that may cross an RPC boundary: a string of 1 to 64 characters. */
export const isRpcId = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= 64;

/**
 * The gateways the entrypoints know (lead, 2026-11-01, M6.3/M6.4 briefs session: generic names, so M6.3 and M6.4 extend instead of copying). M6.2 Razorpay; M6.3
 * Stripe (B2, together with the finance Worker's Stripe branch of `createLink`); M6.4 PayPal (the finance Worker dispatches every method exhaustively by provider,
 * L23: `=== "razorpay"`, never a two-way default).
 */
export const RPC_GATEWAYS = ["razorpay", "stripe", "paypal"] as const;
export type RpcGateway = (typeof RPC_GATEWAYS)[number];
export const isRpcGateway = (v: unknown): v is RpcGateway => (RPC_GATEWAYS as readonly unknown[]).includes(v);

// ---- GatewayEvents (jobs → finance) -------------------------------------------------------------------------------------------------------------------

export const PROCESS_EVENT_RESULTS = ["processed", "ignored", "needs_review", "duplicate", "retry"] as const;
export type ProcessEventResult = {
  readonly result: (typeof PROCESS_EVENT_RESULTS)[number];
  /** A proforma paid online: the jobs Worker enqueues `gateway.advance` for this payment (its own message: one unit of work each). */
  readonly next?: { readonly kind: "gateway.advance"; readonly paymentId: string };
};

/**
 * `retry` (early check 2, finding 1): the proforma changed between the read and the freeze. The finance Worker never tries twice in one invocation (the D1 budget);
 * the jobs consumer retries the message once and then asks with `lastTry`, when a second change is `blocked` (`freeze_refused`); the admin route answers 409.
 */
export const ISSUE_ADVANCE_RESULTS = ["issued", "already_issued", "blocked", "not_pending", "retry"] as const;
export type IssueAdvanceResult = {
  readonly result: (typeof ISSUE_ADVANCE_RESULTS)[number];
  /** The new tax invoice's number when issued. */
  readonly number?: string;
  /** Why the automatic issue was refused (`blocked`): issue blocker codes. */
  readonly blockers?: readonly string[];
};

export interface GatewayEventsApi {
  /** One stored, verified webhook event (`webhook_events.id`), dispatched by the row's own `provider` (Razorpay only in M6.2). */
  processEvent(args: { eventId: string }): Promise<ProcessEventResult>;
  /** `lastTry`: the message's last try (the jobs consumer's second delivery): a proforma changed again is `blocked`, never `retry`. */
  issueGatewayAdvance(args: { paymentId: string; lastTry?: boolean }): Promise<IssueAdvanceResult>;
  /**
   * M6.3 (L13, L14): one checkout's status re-fetched from its gateway and processed as its webhook would be (source `refresh`), for the hourly sweep's
   * `gateway.refresh {checkoutId}`. Only the gateway's word ends a row, never our clock (L6).
   */
  refreshCheckout(args: { checkoutId: string }): Promise<RefreshResult>;
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function isProcessEventResult(v: unknown): v is ProcessEventResult {
  if (!isObj(v) || !(PROCESS_EVENT_RESULTS as readonly unknown[]).includes(v.result)) return false;
  if (v.next === undefined) return true;
  return isObj(v.next) && v.next.kind === "gateway.advance" && isRpcId(v.next.paymentId);
}

export function isIssueAdvanceResult(v: unknown): v is IssueAdvanceResult {
  return (
    isObj(v) &&
    (ISSUE_ADVANCE_RESULTS as readonly unknown[]).includes(v.result) &&
    (v.number === undefined || typeof v.number === "string") &&
    (v.blockers === undefined || isStrings(v.blockers))
  );
}

// ---- PortalPayments (portal → finance) ----------------------------------------------------------------------------------------------------------------

/** Where Razorpay sends the browser back (never with a token): the signed-in invoice page, or the static return page of an emailed link. */
export const PAY_RETURN_TO = ["invoice", "pay_return"] as const;
export type PayReturnTo = (typeof PAY_RETURN_TO)[number];

export type CreateLinkArgs = {
  /** The gateway to make the link with (Razorpay only in M6.2). */
  readonly provider: RpcGateway;
  readonly clientId: string;
  /** The signed-in contact (portal session), or null for an emailed document link. */
  readonly contactId: string | null;
  /** The emailed link's token hash (never the token), or null when signed in. Exactly one of the two is set. */
  readonly tokenHash: string | null;
  readonly documentId: string;
  readonly amountMinor: number;
  readonly returnTo: PayReturnTo;
};

/** The error codes `createLink` answers with (run file C). */
export const CREATE_LINK_ERRORS = [
  "not_found",
  "amount_below_minimum",
  "amount_above_balance",
  "amount_not_whole_rupee",
  "not_payable_online",
  "link_in_progress",
  "too_many_links",
  "gateway_unavailable",
  "live_not_allowed",
  "gateway_error",
  "client_gone",
  // M6.3: a gateway payment is already waiting on the document (core `payableOnline`'s `payment_pending`, or a Stripe session found complete when the old one was
  // expired): 409, "no need to pay again" (C4); and an amount above the online maximum (`maximumMinor`, L9).
  "payment_processing",
  "amount_above_maximum",
] as const;
export type CreateLinkError = (typeof CREATE_LINK_ERRORS)[number];

/**
 * M6.3: `url` (M6.2's `shortUrl`, renamed) is the gateway's hosted page: a Razorpay short link, or a Stripe Checkout URL (up to 5000 characters). The portal
 * checks it against the provider's own hosts (`isGatewayLinkUrl`) before the browser leaves.
 */
export type CreateLinkResult =
  | { readonly ok: true; readonly url: string; readonly expiresAt: number; readonly reused: boolean }
  | {
      readonly ok: false;
      readonly error: CreateLinkError;
      readonly minimumMinor?: number;
      readonly balanceMinor?: number;
      /** M6.3: `amount_above_maximum`'s limit (minor units). */
      readonly maximumMinor?: number;
      readonly reason?: string;
    };

export const REFRESH_RESULTS = [
  "processed",
  "unchanged",
  "too_soon",
  "no_open_link",
  "needs_review",
  "retry",
] as const;
export type RefreshResult = { readonly result: (typeof REFRESH_RESULTS)[number] };

export interface PortalPaymentsApi {
  createLink(args: CreateLinkArgs): Promise<CreateLinkResult>;
  refreshForClient(args: { clientId: string; documentId: string }): Promise<RefreshResult>;
  /**
   * M6.4 (L2, L19): the client came back from PayPal's page: capture checkout `checkoutId` on the server now (ADR 0008: the return itself proves nothing; only
   * PayPal's capture answer moves money). No session is needed (the capture only ever takes what the client approved, for a document that can still take it);
   * `token`, PayPal's order id appended to the return URL, must equal the stored order id when present. The answer is a state only.
   */
  capturePayPalReturn(args: CapturePayPalReturnArgs): Promise<CapturePayPalReturnResult>;
}

// ---- PayPal's return (M6.4) -------------------------------------------------------------------------------------------------------------------------------

export type CapturePayPalReturnArgs = {
  /** Our checkout id, carried in the return URL (`c`, L19). */
  readonly checkoutId: string;
  /** PayPal's `token` on the return URL (its order id), or null when absent. */
  readonly token: string | null;
};

/**
 * What the portal shows after PayPal's return (07-ZN lines 4 to 11): `paid` (line 5 or 6), `processing` (a capture already in flight: line 4 and polling),
 * `pending` (PayPal holds it: line 10), `declined` (line 8, with `retryUrl` back to PayPal's page), `not_completed` (line 7), `expired` (line 9), `changed` (the
 * amount due changed: line 11, nothing captured), `not_found` (no such checkout, or the token isn't its order).
 */
export const CAPTURE_RETURN_STATES = [
  "paid",
  "processing",
  "pending",
  "declined",
  "not_completed",
  "expired",
  "changed",
  "not_found",
] as const;
export type CaptureReturnState = (typeof CAPTURE_RETURN_STATES)[number];
/** No amount, name or document id ever crosses back (L2): a state, and for `declined` the stored PayPal approval URL. */
export type CapturePayPalReturnResult = { readonly state: CaptureReturnState; readonly retryUrl?: string };

/** The arguments of `capturePayPalReturn` are well formed: an RPC id, and a token that is null or a PayPal order id (`^[A-Z0-9]{1,36}$`). */
export function isCapturePayPalReturnArgs(v: unknown): v is CapturePayPalReturnArgs {
  return (
    isObj(v) &&
    isRpcId(v.checkoutId) &&
    (v.token === null || (typeof v.token === "string" && /^[A-Z0-9]{1,36}$/.test(v.token)))
  );
}

/** The answer's runtime guard: a known state and nothing else; `retryUrl` only with `declined`, and only on PayPal's own hosts (`isGatewayLinkUrl("paypal", …)`). */
export function isCapturePayPalReturnResult(v: unknown): v is CapturePayPalReturnResult {
  if (!isObj(v) || !(CAPTURE_RETURN_STATES as readonly unknown[]).includes(v.state)) return false;
  if (Object.keys(v).some((k) => k !== "state" && k !== "retryUrl")) return false;
  if (v.retryUrl === undefined) return true;
  return v.state === "declined" && isGatewayLinkUrl("paypal", v.retryUrl);
}

const optNumber = (v: unknown) =>
  v === undefined || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0);

export function isCreateLinkResult(v: unknown): v is CreateLinkResult {
  if (!isObj(v)) return false;
  if (v.ok === true)
    return (
      typeof v.url === "string" &&
      typeof v.expiresAt === "number" &&
      Number.isSafeInteger(v.expiresAt) &&
      typeof v.reused === "boolean"
    );
  return (
    v.ok === false &&
    (CREATE_LINK_ERRORS as readonly unknown[]).includes(v.error) &&
    optNumber(v.minimumMinor) &&
    optNumber(v.balanceMinor) &&
    optNumber(v.maximumMinor) &&
    (v.reason === undefined || typeof v.reason === "string")
  );
}

export function isRefreshResult(v: unknown): v is RefreshResult {
  return isObj(v) && (REFRESH_RESULTS as readonly unknown[]).includes(v.result);
}

/** The arguments of `createLink` are well formed (a known gateway, ids, a positive safe amount, exactly one of contact or token, a known return page). */
export function isCreateLinkArgs(v: unknown): v is CreateLinkArgs {
  if (!isObj(v)) return false;
  const contact = v.contactId === null ? null : isRpcId(v.contactId) ? v.contactId : undefined;
  const token = v.tokenHash === null ? null : isRpcId(v.tokenHash) ? v.tokenHash : undefined;
  return (
    isRpcGateway(v.provider) &&
    isRpcId(v.clientId) &&
    isRpcId(v.documentId) &&
    contact !== undefined &&
    token !== undefined &&
    (contact === null) !== (token === null) &&
    typeof v.amountMinor === "number" &&
    Number.isSafeInteger(v.amountMinor) &&
    v.amountMinor > 0 &&
    (PAY_RETURN_TO as readonly unknown[]).includes(v.returnTo)
  );
}

// ---- the link URL the portal sends the browser to ------------------------------------------------------------------------------------------------------

/**
 * The hosts each gateway's hosted page may be on (Razorpay: the same list as `RAZORPAY_LINK_HOSTS` in `@techaust/core/razorpay`; a test compares them). Stripe
 * (M6.3 run file E): Checkout's `checkout.stripe.com` only. PayPal (M6.4, Step 0 item 7): exactly `www.paypal.com` and `www.sandbox.paypal.com`, never the bare
 * `paypal.com` and never a subdomain of these (`EXACT_HOSTS`); `isPayPalApproveUrl` in `@techaust/core/paypal` also holds the path and the order's token.
 */
export const GATEWAY_LINK_HOSTS: Readonly<Record<"razorpay" | "stripe" | "paypal", readonly string[]>> = {
  razorpay: ["rzp.io", "razorpay.com"],
  stripe: ["checkout.stripe.com"],
  paypal: ["www.paypal.com", "www.sandbox.paypal.com"],
};
/** The gateways whose page must be on exactly one of its hosts (no subdomain). */
const EXACT_HOSTS: readonly string[] = ["paypal"];
export type LinkHostGateway = keyof typeof GATEWAY_LINK_HOSTS;
/** The longest link URL a checkout row holds (`CHECKOUT_SHORT_URL_MAX` in the db schema). */
export const GATEWAY_LINK_URL_MAX = 5000;

/**
 * Whether `v` is an https URL on one of `provider`'s own hosts (or a subdomain), with no credentials: the portal answers 502 for anything else, so a wrong
 * answer can never send a client's browser to another site. Kept here (not in `@techaust/core/razorpay`) so the portal carries only this small check.
 */
export function isGatewayLinkUrl(provider: LinkHostGateway, v: unknown): boolean {
  if (typeof v !== "string" || v.length > GATEWAY_LINK_URL_MAX) return false;
  const hosts = Object.hasOwn(GATEWAY_LINK_HOSTS, provider) ? GATEWAY_LINK_HOSTS[provider] : undefined;
  if (!hosts) return false;
  try {
    const u = new URL(v);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      hosts.some((h) => u.hostname === h || (!EXACT_HOSTS.includes(provider) && u.hostname.endsWith(`.${h}`)))
    );
  } catch {
    return false;
  }
}
