// The one typed way the jobs Worker calls the admin finance Worker's `GatewayEvents` entrypoint (M6.2; the `billing-rpc.ts` pattern): the binding is checked to
// have the two methods, and every ANSWER is checked by the runtime guards of `@techaust/core/gateway-rpc` (an RPC answer is not trusted by its type alone).
// Anything else throws, and the queue retries the message (both calls are idempotent: a payment is one row, a tax invoice is issued once).
import {
  type GatewayEventsApi,
  type IssueAdvanceResult,
  isIssueAdvanceResult,
  isProcessEventResult,
  type ProcessEventResult,
} from "@techaust/core/gateway-rpc";

type Call = (arg: unknown) => unknown;

const methodOf = (binding: object, name: string): Call | undefined => {
  const f: unknown = Reflect.get(binding, name);
  return typeof f === "function" ? (arg) => Reflect.apply(f, binding, [arg]) : undefined;
};

/** A failed call to the finance Worker's gateway entrypoint: the code only, never an id or an amount. */
export class GatewayRpcError extends Error {
  constructor(readonly code: "rpc_unavailable" | "rpc_bad_result") {
    super(code);
    this.name = "GatewayRpcError";
  }
}

/** `ADMIN_GATEWAY`, typed through the contract and checked at run time. Throws `GatewayRpcError` when the binding is missing (production has none until Phase 7). */
export function adminGateway(env: object): GatewayEventsApi {
  const binding: unknown = Reflect.get(env, "ADMIN_GATEWAY");
  const isObj = typeof binding === "object" && binding !== null;
  const process = isObj ? methodOf(binding, "processEvent") : undefined;
  const advance = isObj ? methodOf(binding, "issueGatewayAdvance") : undefined;
  if (!process || !advance) throw new GatewayRpcError("rpc_unavailable");
  return {
    async processEvent(args): Promise<ProcessEventResult> {
      const answer = await process(args);
      if (!isProcessEventResult(answer)) throw new GatewayRpcError("rpc_bad_result");
      return answer;
    },
    async issueGatewayAdvance(args): Promise<IssueAdvanceResult> {
      const answer = await advance(args);
      if (!isIssueAdvanceResult(answer)) throw new GatewayRpcError("rpc_bad_result");
      return answer;
    },
  };
}
