// The admin API Worker entry (M5.0): every route of ROUTES not marked `on: "front"`. Reached only through the front Worker's `ADMIN_API`
// binding (no public URL). It runs the same middleware chain and guard as before and re-authenticates from the session cookie.
//
// M5.4 (LD57): the same Worker also exports the named entrypoint `BillingJobs`, called over a service binding by the jobs Worker ONLY (`ADMIN_JOBS` in apps/jobs/wrangler.jsonc, stage B).
// It is not reachable from the front or from the internet: no `ROUTES` row, no HTTP path, and the front's `ADMIN_API` binding names the default entrypoint. Both methods use their own
// clock; neither takes a time, a period or an amount from the caller (a message can only say WHICH plan or draft).
import { WorkerEntrypoint } from "cloudflare:workers";
import type { BillingJobsApi, DraftCareResult, IssueCareResult } from "@techaust/core/care-billing";
import { createApp } from "./app.ts";
import { draftCarePlan, issueCareDraft } from "./care-billing.ts";
import { mountApi } from "./routes-api.ts";

export default createApp(mountApi) satisfies ExportedHandler<Env>;

const id = (v: unknown): string => {
  if (typeof v !== "string" || v.length === 0 || v.length > 64)
    throw new TypeError("BillingJobs: an id is a string of 1 to 64 characters");
  return v;
};

/** The recurring care invoices (M5.4). Public methods are the RPC surface: keep them to exactly these two. */
export class BillingJobs extends WorkerEntrypoint<Env> implements BillingJobsApi {
  async draftCarePlan(args: { planId: string }): Promise<DraftCareResult> {
    const planId = id(args?.planId);
    const answer = await draftCarePlan(this.env, { planId });
    // One id-only line per call (stage B watch (a)): which method, the result code, no name, no amount. `n` and `iso` tell a cold isolate from a warm one in the staging cpuTimeMs reading.
    rpcLog("draftCarePlan", answer.result);
    return answer;
  }

  async issueCareDraft(args: { documentId: string }): Promise<IssueCareResult> {
    const documentId = id(args?.documentId);
    const answer = await issueCareDraft(this.env, { documentId });
    rpcLog("issueCareDraft", answer.result);
    return answer;
  }
}

let isolateCalls = 0;
function rpcLog(method: string, result: string): void {
  isolateCalls++;
  console.log(JSON.stringify({ ev: "rpc", m: method, r: result, n: isolateCalls }));
}
