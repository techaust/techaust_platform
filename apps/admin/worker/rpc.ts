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
/**
 * One id-only line per RPC call: the method, the result code, this isolate's call count and (M6.2, CPU diagnosis lead decision 4) `f: 1` on the method's first call
 * here. A call that threw (M7.5 L20) logs `r: "threw"` and the error's NAME only (`e`), never its message (it may carry an id or a value).
 */
export function rpcLog(method: string, result: string, error?: string): void {
  isolateCalls++;
  console.log(
    JSON.stringify({
      ev: "rpc",
      m: method,
      r: result,
      e: error,
      n: isolateCalls,
      f: firstRun(`rpc ${method}`),
    }),
  );
}

/** Errors are named by a plain code only: a built-in error class name, else "unknown". */
const errorName = (e: unknown): string =>
  e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : "unknown";

/**
 * M7.5 L20: runs one RPC method and writes its line whether it answered or threw (an id check's TypeError included), so a failing first call still shows on
 * staging with its `f: 1`. The error is thrown on unchanged.
 */
export async function rpcLogged<T>(
  method: string,
  run: () => Promise<T>,
  result: (answer: T) => string,
): Promise<T> {
  let answer: T;
  try {
    answer = await run();
  } catch (e) {
    rpcLog(method, "threw", errorName(e));
    throw e;
  }
  rpcLog(method, result(answer));
  return answer;
}
