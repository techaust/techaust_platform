// The admin finance Worker entry (M6.1 stage A, ADM-PAY-01; the third admin Worker). Since the fourth admin Worker (2026-11-03, ADM-G-02) it is the payments
// side: every route of ROUTES marked `on: "finance"` (payments and TDS, the ledger panels, credit, remittance advices, payment links, "Needs review", the
// gateways' status). Reached only through the front Worker's `ADMIN_FINANCE` binding (no public URL). It runs the same middleware chain and guard as the API
// Worker and re-authenticates from the session cookie the front forwards untouched. It holds the gateway keys (wrangler.finance.jsonc).
//
// The invoice side (invoices and notes, statements, reports, approvals, the dashboard) and the `BillingJobs` entrypoint moved to the invoices Worker
// (invoicing.ts) word for word; so did the automatic tax invoice of a proforma paid online (`GatewayAdvance`), which this Worker reaches only for the Owner's
// "Try again" through its own `ADMIN_ADVANCE` binding (gateway/advance-rpc.ts).
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  type CapturePayPalReturnArgs,
  type CapturePayPalReturnResult,
  type CreateLinkArgs,
  type CreateLinkResult,
  type GatewayEventsApi,
  isCapturePayPalReturnArgs,
  isCreateLinkArgs,
  type PortalPaymentsApi,
  type ProcessEventResult,
  type RefreshResult,
} from "@techaust/core/gateway-rpc";
import { createApp } from "./app.ts";
import { processEvent } from "./gateway/events.ts";
import { createLinkFor, refreshCheckoutById, refreshForClient } from "./gateway/links.ts";
import { capturePayPalReturn } from "./gateway/paypal-capture.ts";
import { ROUTES } from "./guard.ts";
import { mountFinance } from "./routes-finance.ts";
import { rpcId, rpcLog } from "./rpc.ts";
import { FINANCE_WARM } from "./warm-fixtures/finance.ts";
import { FINANCE_RPC_WARM } from "./warm-fixtures/finance-rpc.ts";
import { warmRouter } from "./warm-router.ts";
import { ownCalls, warmAtStartup } from "./warm-routes.ts";
import { warmRpcAtStartup } from "./warm-rpc.ts";

const app = createApp(mountFinance);
// M6.2 CPU diagnosis (lead decision 1): the rows this Worker answers, matched while the module loads (not exported: a named export of an entry is an entrypoint).
warmRouter(
  app,
  ROUTES.filter((r) => r.on === "finance"),
);
// CPU warm-up (b)1: the hot routes dry-run on made-up rows while the module loads (warm-routes.ts); never throws, stores and logs nothing. The fourth admin
// Worker: only the fixture's calls this Worker answers (`ownCalls`, matched on this app's router; the invoice calls run in the invoices Worker).
void warmAtStartup(() => createApp(mountFinance, undefined, { warm: true }), ownCalls(app, FINANCE_WARM));
// M6.4 (L31, early check 2 finding 4): the gateway RPC entrypoints' code dry-run too (the PayPal capture, a PayPal event, the sweep's refresh, a new order;
// warm-rpc.ts), on made-up rows and the simulator's made-up answers; never throws, stores, sends or logs anything.
void warmRpcAtStartup(FINANCE_RPC_WARM);
export default app satisfies ExportedHandler<Env>;

/**
 * M6.2 (run file C; CPU diagnosis lead decision 5): the webhook events, called by the jobs Worker ONLY (`ADMIN_GATEWAY`, entrypoint `GatewayEvents`). Plain
 * `WorkerEntrypoint` methods, never through Hono; exactly these two public methods (M6.3 adds `refreshCheckout`; the fourth admin Worker moves
 * `issueGatewayAdvance` to the invoices Worker's `GatewayAdvance`; split.test.ts); every id 1 to 64 characters; one id-only log line each.
 */
export class GatewayEvents extends WorkerEntrypoint<Env> implements GatewayEventsApi {
  async processEvent(args: { eventId: string }): Promise<ProcessEventResult> {
    const eventId = rpcId(args?.eventId, "GatewayEvents");
    const answer = await processEvent(this.env, eventId);
    rpcLog("processEvent", answer.result);
    return answer;
  }

  /** M6.3 (L13): the hourly sweep's `gateway.refresh {checkoutId}`. */
  async refreshCheckout(args: { checkoutId: string }): Promise<RefreshResult> {
    const checkoutId = rpcId(args?.checkoutId, "GatewayEvents");
    const answer = await refreshCheckoutById(this.env, checkoutId);
    rpcLog("refreshCheckout", answer.result);
    return answer;
  }
}

/** M6.2: the portal's Pay now, called by the portal Worker ONLY (`ADMIN_PAY`, entrypoint `PortalPayments`). Exactly these three public methods. */
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
    return { ok: true, url: r.url, expiresAt: r.expiresAt, reused: r.reused };
  }

  /** M6.4 (early check 2 finding 3): `checkoutId`, the signed-in page's PayPal return (bound to the client and the document there). */
  async refreshForClient(args: {
    clientId: string;
    documentId: string;
    checkoutId?: string;
  }): Promise<RefreshResult> {
    const clientId = rpcId(args?.clientId, "PortalPayments");
    const documentId = rpcId(args?.documentId, "PortalPayments");
    const checkoutId = args?.checkoutId === undefined ? undefined : rpcId(args.checkoutId, "PortalPayments");
    const answer = await refreshForClient(this.env, {
      clientId,
      documentId,
      ...(checkoutId === undefined ? {} : { checkoutId }),
    });
    rpcLog("refreshForClient", answer.result);
    return answer;
  }

  /**
   * M6.4 (L2, L19): the client came back from PayPal's page: the order is captured on the server now (`paypal-capture.ts`). The answer is a state (and, for a
   * decline, PayPal's own approval page for the same order); never an amount, a name or a document id.
   */
  async capturePayPalReturn(args: CapturePayPalReturnArgs): Promise<CapturePayPalReturnResult> {
    if (!isCapturePayPalReturnArgs(args))
      throw new TypeError("PortalPayments: malformed capturePayPalReturn arguments");
    const answer = await capturePayPalReturn(this.env, { checkoutId: args.checkoutId, token: args.token });
    rpcLog("capturePayPalReturn", answer.state);
    return answer;
  }
}
