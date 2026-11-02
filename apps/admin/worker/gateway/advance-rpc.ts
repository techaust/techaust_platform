// The Owner's "Try again" on an advance review item, across the hop to the invoices Worker (the fourth admin Worker, 2026-11-03, ADM-G-02, ADM-PAY-01; brief
// B.4, review finding 1). The automatic tax invoice (`issueGatewayAdvance`, advance.ts) lives in the invoices Worker behind its `GatewayAdvance` entrypoint; the
// finance Worker binds it as `ADMIN_ADVANCE` (wrangler.finance.jsonc) and calls it here, the only finance → invoices call. No module of the finance Worker
// imports advance.ts (the ADVANCE_CODE budget marker).
//
// A failure is never swallowed: a binding error (a missing binding, a missing method, a thrown call) is not caught, and a malformed answer throws. Either ends in
// the app's standard 500 (app.ts `onError`), exactly as a D1 failure there does: nothing is written and the review item stays open. It is never read as `retry`
// (409 `advance_changed`, whose words say the proforma changed) or as a result.
import { type IssueAdvanceResult, isIssueAdvanceResult } from "@techaust/core/gateway-rpc";

/** A malformed answer from the invoices Worker: the code only, never an id or an amount. */
export class AdvanceRpcError extends Error {
  constructor(readonly code: "rpc_bad_result") {
    super(code);
    this.name = "AdvanceRpcError";
  }
}

/**
 * `ADMIN_ADVANCE.issueGatewayAdvance({ paymentId })` (one try, never `lastTry`: the Owner presses again after a `retry`). The binding is read from the env by
 * name: it is the finance Worker's own (the front's generated `Env` does not hold it, as `LEADS_QUEUE` and the gateway keys).
 */
export async function advanceViaRpc(env: object, paymentId: string): Promise<IssueAdvanceResult> {
  const binding = Reflect.get(env, "ADMIN_ADVANCE") as {
    issueGatewayAdvance(args: { paymentId: string }): Promise<unknown>;
  };
  // Not guarded: a missing binding or method throws here, and the throw propagates (the standard 500).
  const answer: unknown = await binding.issueGatewayAdvance({ paymentId });
  if (!isIssueAdvanceResult(answer)) throw new AdvanceRpcError("rpc_bad_result");
  return answer;
}
