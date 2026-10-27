// The one typed way the jobs Worker calls the admin API's `BillingJobs` entrypoint (M5.4, LD57; ADM-CARE-02). `wrangler types` types a service binding with an entrypoint as a bare `Service`
// (it only knows `fetch`), and typing it from the entrypoint class would pull the whole admin Worker into this Worker's type-check, so the contract lives in core (`BillingJobsApi`, which
// the admin class `implements`) and this wrapper does two honest things instead of a cast: it checks the BINDING has the two methods, and it checks every ANSWER with the runtime
// guards (`isDraftCareResult`, `isIssueCareResult`), because an RPC answer is not trusted by its type alone. Anything else throws, and the queue retries the message (both calls are
// idempotent: a plan's period is billed once, a draft is issued once).
import {
  type BillingJobsApi,
  type DraftCareResult,
  type IssueCareResult,
  isDraftCareResult,
  isIssueCareResult,
} from "@techaust/core/care-billing";

type Call = (arg: unknown) => unknown;

/** The method of the binding bound to it (a Workers RPC method must be called on its stub), or undefined when it is not a function. A stub answers any name with a function, so this is a presence check, not proof: the answers are checked too. */
const methodOf = (binding: object, name: string): Call | undefined => {
  const f: unknown = Reflect.get(binding, name);
  return typeof f === "function" ? (arg) => Reflect.apply(f, binding, [arg]) : undefined;
};

/** A failed call to the admin API's entrypoint: the code says which, never an id, a name or an amount. */
export class BillingRpcError extends Error {
  constructor(readonly code: "rpc_unavailable" | "rpc_bad_result") {
    super(code);
    this.name = "BillingRpcError";
  }
}

/** The entrypoint of the admin API, typed through the contract and checked at runtime. Throws `BillingRpcError` when the binding is missing (production has none until Phase 7) or answers wrongly. */
export function billingJobs(env: Pick<Env, "ADMIN_JOBS">): BillingJobsApi {
  const binding: unknown = env.ADMIN_JOBS;
  const draft =
    typeof binding === "object" && binding !== null ? methodOf(binding, "draftCarePlan") : undefined;
  const issue =
    typeof binding === "object" && binding !== null ? methodOf(binding, "issueCareDraft") : undefined;
  if (!draft || !issue) throw new BillingRpcError("rpc_unavailable");
  return {
    async draftCarePlan(args): Promise<DraftCareResult> {
      const answer = await draft(args);
      if (!isDraftCareResult(answer)) throw new BillingRpcError("rpc_bad_result");
      return answer;
    },
    async issueCareDraft(args): Promise<IssueCareResult> {
      const answer = await issue(args);
      if (!isIssueCareResult(answer)) throw new BillingRpcError("rpc_bad_result");
      return answer;
    },
  };
}
