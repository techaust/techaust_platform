// The one typed way the jobs Worker calls the admin gateway entrypoints (M6.2; the `billing-rpc.ts` pattern): the admin finance Worker's `GatewayEvents`
// (`ADMIN_GATEWAY`) and, since the fourth admin Worker (2026-11-03, ADM-G-02), the admin invoices Worker's `GatewayAdvance` (`ADMIN_ADVANCE`). Each binding is
// checked to have its methods, and every ANSWER is checked by the runtime guards of `@techaust/core/gateway-rpc` (an RPC answer is not trusted by its type
// alone). Anything else throws, and the queue retries the message, then dead-letters it (a `dead_letter` review item and the Owner's bell): a binding failure is
// never read as a result. Every call is idempotent: a payment is one row, a tax invoice is issued once.
import {
  type CheckRefundResult,
  type FetchSettlementsResult,
  type GatewayAdvanceApi,
  type GatewayEventsApi,
  type IssueAdvanceResult,
  isCheckRefundResult,
  isFetchSettlementsResult,
  isIssueAdvanceResult,
  isProcessEventResult,
  isRefreshResult,
  type ProcessEventResult,
  type RefreshResult,
} from "@techaust/core/gateway-rpc";

type Call = (arg: unknown) => unknown;

const methodOf = (binding: object, name: string): Call | undefined => {
  const f: unknown = Reflect.get(binding, name);
  return typeof f === "function" ? (arg) => Reflect.apply(f, binding, [arg]) : undefined;
};

/** The method `name` of the binding `bindingName` in `env`, or undefined when the binding or the method is missing. */
const boundMethod = (env: object, bindingName: string, name: string): Call | undefined => {
  const binding: unknown = Reflect.get(env, bindingName);
  return typeof binding === "object" && binding !== null ? methodOf(binding, name) : undefined;
};

/** A failed call to an admin gateway entrypoint: the code only, never an id or an amount. */
export class GatewayRpcError extends Error {
  constructor(readonly code: "rpc_unavailable" | "rpc_bad_result") {
    super(code);
    this.name = "GatewayRpcError";
  }
}

/** `ADMIN_GATEWAY`, typed through the contract and checked at run time. Throws `GatewayRpcError` when the binding is missing (production has none until Phase 7). */
export function adminGateway(env: object): GatewayEventsApi {
  const process = boundMethod(env, "ADMIN_GATEWAY", "processEvent");
  const refresh = boundMethod(env, "ADMIN_GATEWAY", "refreshCheckout");
  const check = boundMethod(env, "ADMIN_GATEWAY", "checkRefund");
  const fetchSettlements = boundMethod(env, "ADMIN_GATEWAY", "fetchSettlements");
  if (!process) throw new GatewayRpcError("rpc_unavailable");
  return {
    // M6.5 (L37): the sweep's re-check of one open refund; checked lazily (a finance Worker older than M6.5 has none).
    async checkRefund(args): Promise<CheckRefundResult> {
      if (!check) throw new GatewayRpcError("rpc_unavailable");
      const answer = await check(args);
      if (!isCheckRefundResult(answer)) throw new GatewayRpcError("rpc_bad_result");
      return answer;
    },
    // M6.5 (L11): one page of Razorpay's settlement recon.
    async fetchSettlements(args): Promise<FetchSettlementsResult> {
      if (!fetchSettlements) throw new GatewayRpcError("rpc_unavailable");
      const answer = await fetchSettlements(args);
      if (!isFetchSettlementsResult(answer)) throw new GatewayRpcError("rpc_bad_result");
      return answer;
    },
    async processEvent(args): Promise<ProcessEventResult> {
      const answer = await process(args);
      if (!isProcessEventResult(answer)) throw new GatewayRpcError("rpc_bad_result");
      return answer;
    },
    // M6.3 (L13): the sweep's refresh of one checkout.
    async refreshCheckout(args): Promise<RefreshResult> {
      if (!refresh) throw new GatewayRpcError("rpc_unavailable");
      const answer = await refresh(args);
      if (!isRefreshResult(answer)) throw new GatewayRpcError("rpc_bad_result");
      return answer;
    },
  };
}

/**
 * `ADMIN_ADVANCE` (the fourth admin Worker, brief B.3), typed through the contract and checked at run time: a missing binding or method throws
 * `rpc_unavailable`, a malformed answer `rpc_bad_result`. Both propagate to the queue consumer, exactly as a thrown error did when the call went to finance.
 */
export function adminAdvance(env: object): GatewayAdvanceApi {
  const advance = boundMethod(env, "ADMIN_ADVANCE", "issueGatewayAdvance");
  if (!advance) throw new GatewayRpcError("rpc_unavailable");
  return {
    async issueGatewayAdvance(args): Promise<IssueAdvanceResult> {
      const answer = await advance(args);
      if (!isIssueAdvanceResult(answer)) throw new GatewayRpcError("rpc_bad_result");
      return answer;
    },
  };
}
