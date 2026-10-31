// The admin finance Worker entry (M6.1 stage A, ADM-PAY-01; the third admin Worker): every route of ROUTES marked `on: "finance"` (invoices and
// notes, a client's invoices and statement, reports, the approval queue and decision, the dashboard). Reached only through the front Worker's
// `ADMIN_FINANCE` binding (no public URL). It runs the same middleware chain and guard as the API Worker and re-authenticates from the session
// cookie the front forwards untouched.
//
// M5.4 (LD57): the same Worker also exports the named entrypoint `BillingJobs` (moved here from api.ts in M6.1 stage A, word for word), called over a
// service binding by the jobs Worker ONLY (`ADMIN_JOBS` in apps/jobs/wrangler.jsonc). It is not reachable from the front or from the internet: no
// `ROUTES` row, no HTTP path, and the front's `ADMIN_FINANCE` binding names the default entrypoint. Both methods use their own clock; neither takes
// a time, a period or an amount from the caller (a message can only say WHICH plan or draft).
import { WorkerEntrypoint } from "cloudflare:workers";
import type { BillingJobsApi, DraftCareResult, IssueCareResult } from "@techaust/core/care-billing";
import {
  type CreateLinkArgs,
  type CreateLinkResult,
  type GatewayEventsApi,
  type IssueAdvanceResult,
  isCreateLinkArgs,
  isRpcId,
  type PortalPaymentsApi,
  type ProcessEventResult,
  type RefreshResult,
} from "@techaust/core/gateway-rpc";
import { createApp, firstRun } from "./app.ts";
import { draftCarePlan, issueCareDraft } from "./care-billing.ts";
import { issueGatewayAdvance } from "./gateway/advance.ts";
import { processEvent } from "./gateway/events.ts";
import { createLinkFor, refreshForClient } from "./gateway/links.ts";
import { ROUTES } from "./guard.ts";
import { mountFinance } from "./routes-finance.ts";
import { warmRouter } from "./warm-router.ts";

const app = createApp(mountFinance);
// M6.2 CPU diagnosis (lead decision 1): the rows this Worker answers, matched while the module loads (not exported: a named export of an entry is an entrypoint).
warmRouter(
  app,
  ROUTES.filter((r) => r.on === "finance"),
);
export default app satisfies ExportedHandler<Env>;

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

/**
 * M6.2 (run file C; CPU diagnosis lead decision 5): the webhook events, called by the jobs Worker ONLY (`ADMIN_GATEWAY`, entrypoint `GatewayEvents`). Plain
 * `WorkerEntrypoint` methods, never through Hono; exactly these two public methods (split.test.ts); every id 1 to 64 characters; one id-only log line each.
 */
export class GatewayEvents extends WorkerEntrypoint<Env> implements GatewayEventsApi {
  async processEvent(args: { eventId: string }): Promise<ProcessEventResult> {
    const eventId = rpcId(args?.eventId, "GatewayEvents");
    const answer = await processEvent(this.env, eventId);
    rpcLog("processEvent", answer.result);
    return answer;
  }

  async issueGatewayAdvance(args: { paymentId: string }): Promise<IssueAdvanceResult> {
    const paymentId = rpcId(args?.paymentId, "GatewayEvents");
    const answer = await issueGatewayAdvance(this.env, paymentId);
    rpcLog("issueGatewayAdvance", answer.result);
    return answer;
  }
}

/** M6.2: the portal's Pay now, called by the portal Worker ONLY (`ADMIN_PAY`, entrypoint `PortalPayments`). Exactly these two public methods. */
export class PortalPayments extends WorkerEntrypoint<Env> implements PortalPaymentsApi {
  async createLink(args: CreateLinkArgs): Promise<CreateLinkResult> {
    if (!isCreateLinkArgs(args)) throw new TypeError("PortalPayments: malformed createLink arguments");
    const r = await createLinkFor(this.env, args);
    rpcLog("createLink", r.ok ? (r.reused ? "reused" : "created") : r.error);
    // The answer carries only what the portal shows: never the checkout id or a Razorpay id.
    if (!r.ok) {
      const { stale: _stale, ...refusal } = r;
      return refusal;
    }
    return { ok: true, shortUrl: r.shortUrl, expiresAt: r.expiresAt, reused: r.reused };
  }

  async refreshForClient(args: { clientId: string; documentId: string }): Promise<RefreshResult> {
    const clientId = rpcId(args?.clientId, "PortalPayments");
    const documentId = rpcId(args?.documentId, "PortalPayments");
    const answer = await refreshForClient(this.env, { clientId, documentId });
    rpcLog("refreshForClient", answer.result);
    return answer;
  }
}

const rpcId = (v: unknown, who: string): string => {
  if (!isRpcId(v)) throw new TypeError(`${who}: an id is a string of 1 to 64 characters`);
  return v;
};

let isolateCalls = 0;
/** One id-only line per RPC call: the method, the result code, this isolate's call count and (M6.2, CPU diagnosis lead decision 4) `f: 1` on the method's first call here. */
function rpcLog(method: string, result: string): void {
  isolateCalls++;
  console.log(
    JSON.stringify({ ev: "rpc", m: method, r: result, n: isolateCalls, f: firstRun(`rpc ${method}`) }),
  );
}
