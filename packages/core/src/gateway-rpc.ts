// The RPC contracts of the admin finance Worker's gateway entrypoints (M6.2; ADM-PAY-02, -07, ADM-INV-10, JOB-HOOK-02, POR-06; run file docs/runs/m6.2-razorpay.md B,
// C): `GatewayEvents` (bound by the jobs Worker as `ADMIN_GATEWAY`) and `PortalPayments` (bound by the portal as `ADMIN_PAY`). The classes `implements` these
// interfaces, so the two sides cannot drift; an answer that crossed a service binding is not trusted by its type alone, so each has a runtime guard (the
// `care-billing` pattern, `isDraftCareResult`). Every id argument is 1 to 64 characters (`isRpcId`); nothing here carries a clock or an amount the callee
// would trust without its own SQL checks.

/** An id that may cross an RPC boundary: a string of 1 to 64 characters. */
export const isRpcId = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= 64;

/**
 * The gateways the entrypoints know (lead, 2026-11-01, M6.3/M6.4 briefs session: generic names, so M6.3 and M6.4 extend instead of copying). M6.2 implements
 * Razorpay only; Stripe and PayPal join this list in their own milestones.
 */
export const RPC_GATEWAYS = ["razorpay"] as const;
export type RpcGateway = (typeof RPC_GATEWAYS)[number];
export const isRpcGateway = (v: unknown): v is RpcGateway => (RPC_GATEWAYS as readonly unknown[]).includes(v);

// ---- GatewayEvents (jobs → finance) -------------------------------------------------------------------------------------------------------------------

export const PROCESS_EVENT_RESULTS = ["processed", "ignored", "needs_review", "duplicate", "retry"] as const;
export type ProcessEventResult = {
  readonly result: (typeof PROCESS_EVENT_RESULTS)[number];
  /** A proforma paid online: the jobs Worker enqueues `gateway.advance` for this payment (its own message: one unit of work each). */
  readonly next?: { readonly kind: "gateway.advance"; readonly paymentId: string };
};

export const ISSUE_ADVANCE_RESULTS = ["issued", "already_issued", "blocked", "not_pending"] as const;
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
  issueGatewayAdvance(args: { paymentId: string }): Promise<IssueAdvanceResult>;
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
] as const;
export type CreateLinkError = (typeof CREATE_LINK_ERRORS)[number];

export type CreateLinkResult =
  | { readonly ok: true; readonly shortUrl: string; readonly expiresAt: number; readonly reused: boolean }
  | {
      readonly ok: false;
      readonly error: CreateLinkError;
      readonly minimumMinor?: number;
      readonly balanceMinor?: number;
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
}

const optNumber = (v: unknown) =>
  v === undefined || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0);

export function isCreateLinkResult(v: unknown): v is CreateLinkResult {
  if (!isObj(v)) return false;
  if (v.ok === true)
    return (
      typeof v.shortUrl === "string" &&
      typeof v.expiresAt === "number" &&
      Number.isSafeInteger(v.expiresAt) &&
      typeof v.reused === "boolean"
    );
  return (
    v.ok === false &&
    (CREATE_LINK_ERRORS as readonly unknown[]).includes(v.error) &&
    optNumber(v.minimumMinor) &&
    optNumber(v.balanceMinor) &&
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

/** The hosts each gateway's hosted page may be on (Razorpay: the same list as `RAZORPAY_LINK_HOSTS` in `@techaust/core/razorpay`; a test compares them). */
export const GATEWAY_LINK_HOSTS: Readonly<Record<RpcGateway, readonly string[]>> = {
  razorpay: ["rzp.io", "razorpay.com"],
};
/** The longest link URL a checkout row holds (`CHECKOUT_SHORT_URL_MAX` in the db schema). */
export const GATEWAY_LINK_URL_MAX = 5000;

/**
 * Whether `v` is an https URL on one of `provider`'s own hosts (or a subdomain), with no credentials: the portal answers 502 for anything else, so a wrong
 * answer can never send a client's browser to another site. Kept here (not in `@techaust/core/razorpay`) so the portal carries only this small check.
 */
export function isGatewayLinkUrl(provider: RpcGateway, v: unknown): boolean {
  if (typeof v !== "string" || v.length > GATEWAY_LINK_URL_MAX) return false;
  const hosts = GATEWAY_LINK_HOSTS[provider];
  if (!hosts) return false;
  try {
    const u = new URL(v);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
    );
  } catch {
    return false;
  }
}
