// M6.4 PayPal, the fix round after review part 1 [ADM-PAY-01, -03, -04, -07, ADM-INV-17; run file "Review part 1, code" and its triage]: a capture PayPal reports
// as not final is recorded pending with its own review kind (finding 1); the sweep's and "Check now"'s capture only for an order PayPal shows approved (finding 2,
// the optional low); a refund's `invoice_id` reaches the finance Worker (finding 4); the advices' period, count and keyset (findings 5 to 7); the provider
// adapter's `createCheckout` (finding 9); the token's Basic auth (finding 10). PayPal is never called: the stub transport answers. All names and amounts are
// invented test data.
import { env } from "cloudflare:workers";
import { checkProviderContract } from "@techaust/core/payments";
import { parsePayPalEvent, payPalEventFacts } from "@techaust/core/paypal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStubTransport } from "./gateway/config.ts";
import { processEvent } from "./gateway/events.ts";
import { refreshCheckoutById, refreshForClient } from "./gateway/links.ts";
import { reviewReason } from "./gateway/messages.ts";
import { payPalProvider } from "./gateway/paypal.ts";
import { payPalToken } from "./gateway/paypal-token.ts";
import { owner } from "./test-gateway.ts";
import { call, one, rows } from "./test-helpers.ts";
import { currentFy, lutOf, putSwiftBank, putTax } from "./test-invoice-types.ts";
import { json, putBank, putCompany } from "./test-invoices.ts";
import {
  adviceBodyOf,
  apiCalls,
  capOf,
  liveOrder,
  orderAnswer,
  paidPayPal,
  payPalEventRow,
  paypalStub,
  ppCheckout,
  ppPaymentOf,
  signedInReturn,
} from "./test-paypal.ts";

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
  paypalStub();
});
afterEach(() => setStubTransport(null));

type J = Record<string, unknown>;
const reviewKinds = async (column: string, id: string) =>
  (
    await rows<{ kind: string }>(
      `SELECT kind FROM review_items WHERE ${column} = ?1 ORDER BY created_at, id`,
      id,
    )
  ).map((r) => r.kind);
const ledger = (id: string) =>
  one<{ status: string; paid_minor: number; balance_minor: number }>(
    "SELECT status, paid_minor, balance_minor FROM documents WHERE id = ?1",
    id,
  );
const captures = () => apiCalls().filter((c) => c.method === "POST" && c.path.endsWith("/capture"));

describe("a capture PayPal reports as not final [finding 1; ADM-PAY-04, run file C steps 8 and 9]", () => {
  it("final_capture false: recorded pending with a not_final item and its bell, the claim ended, the ledger unchanged; a second return asks nothing", async () => {
    await owner();
    const o = await liveOrder();
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/capture")
        ? orderAnswer(
            o.orderId,
            (x) => {
              const u = (x.purchase_units as { payments: { captures: J[] } }[])[0];
              (u?.payments.captures[0] as J).final_capture = false;
            },
            true,
            201,
          )
        : null,
    );
    // Money with the Owner: "Checking your payment…" (07-ZN line 4).
    expect(await signedInReturn(o)).toEqual({ state: "processing" });
    expect(await ppPaymentOf(capOf(o.orderId))).toMatchObject({
      status: "pending_verification",
      amount_minor: 50_000,
      checkout_id: o.checkoutId,
    });
    expect(await reviewKinds("document_id", o.documentId)).toEqual(["not_final"]);
    expect(
      await one<{ title: string }>(
        "SELECT title FROM notifications WHERE kind = 'payment.review' AND entity_id = (SELECT id FROM review_items WHERE document_id = ?1)",
        o.documentId,
      ),
    ).toMatchObject({ title: expect.stringContaining(reviewReason("not_final")) });
    // The claim ended with the money: the row is paid by this capture, so no poll, event or sweep captures this order again.
    expect(await ppCheckout(o.checkoutId)).toMatchObject({
      status: "paid",
      provider_capture_id: capOf(o.orderId),
      paid_payment_id: `ppl_${capOf(o.orderId)}`,
    });
    expect(await ledger(o.documentId)).toMatchObject({ paid_minor: 0, balance_minor: 50_000 });
    expect(captures()).toHaveLength(1);
    paypalStub();
    expect(await signedInReturn(o)).toEqual({ state: "paid" });
    expect(apiCalls()).toEqual([]);
    expect(await reviewKinds("document_id", o.documentId)).toEqual(["not_final"]);
  });
});

describe("a refresh never POSTs a capture on an order PayPal doesn't show approved [finding 2, the optional low; L14]", () => {
  /** PayPal's order of `orderId` as it stands before the client approves it (no capture, status CREATED). */
  const notApproved = (orderId: string) => (path: string, method: string) =>
    method === "GET" && path === `/v2/checkout/orders/${orderId}`
      ? orderAnswer(
          orderId,
          (x) => {
            x.status = "CREATED";
          },
          false,
        )
      : null;

  it("the sweep, the portal's poll and Check now read the order first: not approved → no capture call, the row stays live", async () => {
    const o = await owner();
    const a = await liveOrder();
    paypalStub(notApproved(a.orderId));
    const now = Date.now();
    expect(await refreshCheckoutById(env, a.checkoutId, now)).toEqual({ result: "unchanged" });
    expect(apiCalls().map((c) => `${c.method} ${c.path}`)).toEqual([`GET /v2/checkout/orders/${a.orderId}`]);
    expect(await ppCheckout(a.checkoutId)).toMatchObject({ status: "live", capture_started_at: null });
    // The portal's poll (no checkout named) a minute later: the same read, no capture.
    paypalStub(notApproved(a.orderId));
    await env.DB.prepare("UPDATE checkout_sessions SET last_refresh_at = ?2 WHERE id = ?1")
      .bind(a.checkoutId, now - 120_000)
      .run();
    expect(await refreshForClient(env, { clientId: a.clientId, documentId: a.documentId })).toEqual({
      result: "unchanged",
    });
    expect(captures()).toEqual([]);
    // Check now, the same.
    await env.DB.prepare("UPDATE checkout_sessions SET last_refresh_at = ?2 WHERE id = ?1")
      .bind(a.checkoutId, now - 120_000)
      .run();
    paypalStub(notApproved(a.orderId));
    const res = await call(`/payments/links/${a.checkoutId}/refresh`, { cookie: o.cookie, body: {} });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, result: "unchanged" });
    expect(captures()).toEqual([]);
    expect(await ppCheckout(a.checkoutId)).toMatchObject({ status: "live", capture_started_at: null });
  });

  it("an approved order is captured by the refresh; one PayPal already captured is settled with no capture call; the client's own return captures at once", async () => {
    const approved = await liveOrder();
    paypalStub((path, method) =>
      method === "GET" && path === `/v2/checkout/orders/${approved.orderId}`
        ? orderAnswer(approved.orderId, () => undefined, false)
        : null,
    );
    expect(await refreshCheckoutById(env, approved.checkoutId)).toEqual({ result: "processed" });
    expect(apiCalls().map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET /v2/checkout/orders/${approved.orderId}`,
      `POST /v2/checkout/orders/${approved.orderId}/capture`,
    ]);
    expect((await ppPaymentOf(capOf(approved.orderId)))?.status).toBe("confirmed");
    const done = await liveOrder();
    paypalStub((path, method) =>
      method === "GET" && path === `/v2/checkout/orders/${done.orderId}` ? orderAnswer(done.orderId) : null,
    );
    expect(await refreshCheckoutById(env, done.checkoutId)).toEqual({ result: "processed" });
    expect(captures()).toEqual([]);
    expect((await ppPaymentOf(capOf(done.orderId)))?.status).toBe("confirmed");
    const back = await liveOrder();
    paypalStub();
    expect(await signedInReturn(back)).toEqual({ state: "paid" });
    expect(apiCalls().map((c) => c.method)).toEqual(["POST"]);
  });
});

describe("a refund's invoice_id reaches the finance Worker [finding 4; L3, re-check N3]", () => {
  /** A PAYMENT.CAPTURE.REFUNDED event as PayPal sends it, stored as the jobs hook stores it (core `payPalEventFacts`, the whitelist). */
  async function refundEvent(captureId: string, invoiceId: string): Promise<string> {
    const parsed = parsePayPalEvent({
      id: `WH-${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      create_time: "2026-11-03T10:00:00Z",
      resource: {
        id: `R${captureId.slice(1, 17)}`,
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "500.00" },
        invoice_id: invoiceId,
        links: [
          {
            rel: "up",
            href: `https://api.sandbox.paypal.com/v2/payments/captures/${captureId}`,
            method: "GET",
          },
        ],
      },
    });
    if (!parsed.ok) throw new Error("not an event");
    const { event: _name, ...facts } = payPalEventFacts(parsed.value);
    return payPalEventRow("PAYMENT.CAPTURE.REFUNDED", facts);
  }
  const itemFacts = async (eventId: string) =>
    JSON.parse(
      (await one<{ facts: string }>("SELECT facts FROM review_items WHERE webhook_event_id = ?1", eventId))
        ?.facts ?? "{}",
    ) as J;

  it("an invoice_id ending in another checkout's tail is flagged invoice_mismatch; our own tail is not; the payment is found by its capture either way", async () => {
    await owner();
    const a = await liveOrder();
    expect(await signedInReturn(a)).toEqual({ state: "paid" });
    const ours = await refundEvent(capOf(a.orderId), `TH/EX/2627/7-${a.checkoutId.slice(-12)}`);
    expect(await processEvent(env, ours)).toEqual({ result: "needs_review" });
    expect(await reviewKinds("webhook_event_id", ours)).toEqual(["refunded_outside"]);
    expect(await itemFacts(ours)).not.toHaveProperty("reason");
    const b = await liveOrder();
    expect(await signedInReturn(b)).toEqual({ state: "paid" });
    const other = await refundEvent(capOf(b.orderId), "TH/EX/2627/9-0123456789ab");
    expect(await processEvent(env, other)).toEqual({ result: "needs_review" });
    expect(await reviewKinds("webhook_event_id", other)).toEqual(["refunded_outside"]);
    expect(await itemFacts(other)).toMatchObject({ reason: "invoice_mismatch" });
  });
});

describe("the provider adapter and the token [findings 9, 10; ADM-PAY-01]", () => {
  it("createCheckout never makes an order (unsupported, no call; live still answers live_not_allowed); the contract still holds", async () => {
    const calls: string[] = [];
    const cfg = (settingsMode: "test" | "live") =>
      payPalProvider({
        clientId: "id",
        clientSecret: "secret",
        settingsMode,
        liveFlag: "false",
        fetch: async (i) => {
          calls.push(String(i));
          return new Response("{}", { status: 200 });
        },
      });
    const req = {
      checkoutId: "01900000-0000-7000-8000-000000000001",
      clientId: "c",
      documentId: "d",
      currency: "USD" as const,
      amountMinor: 50_000,
      description: "Invoice TH/EX/2627/7",
      expiresAt: Date.now() + 3_600_000,
      callbackUrl: "https://example.invalid/return",
    };
    expect(await cfg("test").createCheckout(req)).toEqual({ ok: false, code: "unsupported" });
    expect(await cfg("live").createCheckout(req)).toEqual({ ok: false, code: "live_not_allowed" });
    expect(await checkProviderContract(cfg("test"), { liveAllowed: "false" })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("keys Basic auth can't encode are unconfigured, with no call (never thrown, never a network fault)", async () => {
    const calls: string[] = [];
    const f = (async (i: RequestInfo | URL) => {
      calls.push(String(i));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    expect(
      await payPalToken(
        { origin: "https://api-m.sandbox.paypal.com", clientId: "id\u0438", clientSecret: "s" },
        f,
      ),
    ).toEqual({ ok: false, code: "unconfigured" });
    expect(calls).toEqual([]);
  });
});

describe("remittance advices [findings 5 and 6; L12, ADM-INV-17]", () => {
  it("a period that ends before it starts is a 400 (never the CHECK's 500), and nothing is written", async () => {
    const o = await owner();
    const before = await rows("SELECT id FROM realisation_advices");
    const res = await call("/payments/advices", {
      cookie: o.cookie,
      body: { ...adviceBodyOf(), periodFrom: "2026-11-08", periodTo: "2026-11-02" },
    });
    expect(res.status, await res.clone().text()).toBe(400);
    expect(await rows("SELECT id FROM realisation_advices")).toHaveLength(before.length);
    // One day, or no period at all, is fine.
    for (const period of [
      { periodFrom: "2026-11-02", periodTo: "2026-11-02" },
      { periodFrom: null, periodTo: null },
      { periodFrom: "2026-11-02", periodTo: null },
    ]) {
      const ok = await call("/payments/advices", {
        cookie: o.cookie,
        body: { ...adviceBodyOf(), ...period },
      });
      expect(ok.status, JSON.stringify(period)).toBe(201);
    }
  });

  it("Without advice: the count is of the same currency as the list", async () => {
    const o = await owner();
    await paidPayPal();
    const usd = await json(
      await call("/payments/without-advice?provider=paypal&currency=USD", { cookie: o.cookie }),
    );
    const any = await json(await call("/payments/without-advice?provider=paypal", { cookie: o.cookie }));
    const inr = await json(
      await call("/payments/without-advice?provider=paypal&currency=INR", { cookie: o.cookie }),
    );
    expect(usd.count).toBeGreaterThanOrEqual(1);
    expect(usd.count).toBe(any.count);
    expect(inr).toMatchObject({ items: [], count: 0 });
  });
});
