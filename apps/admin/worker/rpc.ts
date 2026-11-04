// The RPC entrypoints' shared helpers (the fourth admin Worker, 2026-11-03, ADM-G-02; moved word for word from finance.ts): the id checks and the one id-only log
// line per call. The finance entry (`GatewayEvents`, `PortalPayments`) and the invoices entry (`BillingJobs`, `GatewayAdvance`) import them; each isolate keeps
// its own call counter. No top-level work beyond the counter.

import { firstRun } from "@techaust/auth";
import { isRpcId } from "@techaust/core/gateway-rpc";

/** `BillingJobs`' id check (M5.4): a string of 1 to 64 characters, else a TypeError before anything is read or written. */
export const id = (v: unknown): string => {
  if (typeof v !== "string" || v.length === 0 || v.length > 64)
    throw new TypeError("BillingJobs: an id is a string of 1 to 64 characters");
  return v;
};

/** The gateway entrypoints' id check (M6.2): `who` names the entrypoint in the TypeError. */
export const rpcId = (v: unknown, who: string): string => {
  if (!isRpcId(v)) throw new TypeError(`${who}: an id is a string of 1 to 64 characters`);
  return v;
};

let isolateCalls = 0;
/** One id-only line per RPC call: the method, the result code, this isolate's call count and (M6.2, CPU diagnosis lead decision 4) `f: 1` on the method's first call here. */
export function rpcLog(method: string, result: string): void {
  isolateCalls++;
  console.log(
    JSON.stringify({ ev: "rpc", m: method, r: result, n: isolateCalls, f: firstRun(`rpc ${method}`) }),
  );
}
