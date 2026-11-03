// The admin invoices Worker entry (the fourth admin Worker, 2026-11-03, ADM-G-02, ADM-PAY-01; docs/runs/admin-split-plan.md, cut B1): every route of ROUTES
// marked `on: "invoices"` (invoices and notes, a client's invoices and statement, reports, the approval queue and decision, the dashboard). Reached only through
// the front Worker's `ADMIN_INVOICES` binding (no public URL). It runs the same middleware chain and guard as the API and finance Workers and re-authenticates
// from the session cookie the front forwards untouched. No secrets, no sign-in code and no gateway client code (the GATEWAY_CODE budget marker).
//
// It also exports two named entrypoints, neither reachable from the front or the internet (no `ROUTES` row, no HTTP path; the front's binding names the default
// entrypoint):
//  - `BillingJobs` (M5.4, LD57; moved here from finance.ts word for word): the recurring care invoices, bound by the jobs Worker ONLY as `ADMIN_JOBS`. Both
//    methods use their own clock; neither takes a time, a period or an amount from the caller (a message can only say WHICH plan or draft).
//  - `GatewayAdvance` (moved from the finance Worker's `GatewayEvents` with the same arguments and answers): the automatic tax invoice of a proforma paid
//    online, bound as `ADMIN_ADVANCE` by the jobs Worker (`gateway.advance`) and by the finance Worker (the Owner's "Try again"). It reads only DB and PDF_QUEUE
//    and makes no gateway call.
import { WorkerEntrypoint } from "cloudflare:workers";
import type {
  BillingJobsApi,
  DraftCareResult,
  IssueCareResult,
  IssueReceiptResult,
} from "@techaust/core/care-billing";
import type { GatewayAdvanceApi, IssueAdvanceResult } from "@techaust/core/gateway-rpc";
import { createApp } from "./app.ts";
import { draftCarePlan, issueCareDraft } from "./care-billing.ts";
import { issueGatewayAdvance } from "./gateway/advance.ts";
import { ROUTES } from "./guard.ts";
import { issueReceipt } from "./receipt-issue.ts";
import { mountInvoices } from "./routes-invoices.ts";
import { id, rpcId, rpcLog } from "./rpc.ts";
import { warmAdvanceAtStartup } from "./warm-advance.ts";
import { INVOICES_WARM } from "./warm-fixtures/invoices.ts";
import { INVOICES_RPC_WARM } from "./warm-fixtures/invoices-rpc.ts";
import { warmRouter } from "./warm-router.ts";
import { warmAtStartup } from "./warm-routes.ts";

const app = createApp(mountInvoices);
// M6.2 CPU diagnosis (lead decision 1): the rows this Worker answers, matched while the module loads (not exported: a named export of an entry is an entrypoint).
warmRouter(
  app,
  ROUTES.filter((r) => r.on === "invoices"),
);
// CPU warm-up (b)1: the hot routes dry-run on made-up rows while the module loads (warm-routes.ts; this Worker's own fixture, warm-fixtures/invoices.ts: the
// issue, an invoice, the dashboard, the list and the approvals); never throws, stores and logs nothing.
void warmAtStartup(() => createApp(mountInvoices, undefined, { warm: true }), INVOICES_WARM);
// Brief D.7 (early check finding 7): the automatic tax invoice of a proforma paid online (`GatewayAdvance.issueGatewayAdvance`) dry-run too, on made-up rows
// and counter ids (warm-advance.ts); never throws, stores, sends or logs anything.
void warmAdvanceAtStartup(INVOICES_RPC_WARM);
export default app satisfies ExportedHandler<Env>;

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

  /** M6.5 (L3, L34): one payment's receipt, its own batch (jobs' `receipt.issue`). The id is 1 to 60 characters (`rct_` + it stays within 64). */
  async issueReceipt(args: { paymentId: string }): Promise<IssueReceiptResult> {
    const paymentId = id(args?.paymentId);
    if (paymentId.length > 60) throw new TypeError("BillingJobs: a payment id is 1 to 60 characters");
    const answer = await issueReceipt(this.env, paymentId);
    rpcLog("issueReceipt", answer.result);
    return answer;
  }
}

/**
 * The automatic tax invoice of a proforma paid online (M6.2 L6, L17; moved from `GatewayEvents` by the fourth admin Worker). Exactly this one public method
 * (split.test.ts). The id is 1 to 64 characters, else a TypeError with nothing read or written; `lastTry` is taken only when it is strictly `true`. One try per
 * invocation, guarded in SQL (advance.ts), so a redelivery after a lost answer can only get `already_issued`.
 */
export class GatewayAdvance extends WorkerEntrypoint<Env> implements GatewayAdvanceApi {
  async issueGatewayAdvance(args: { paymentId: string; lastTry?: boolean }): Promise<IssueAdvanceResult> {
    const paymentId = rpcId(args?.paymentId, "GatewayAdvance");
    const answer = await issueGatewayAdvance(this.env, paymentId, { lastTry: args?.lastTry === true });
    rpcLog("issueGatewayAdvance", answer.result);
    return answer;
  }
}
