// M6.4 PayPal, the fix round after review part 1 [ADM-PAY-01, -03, -04, -07, ADM-INV-17; run file "Review part 1, code" and its triage]: a capture PayPal reports
// as not final is recorded pending with its own review kind (finding 1); the sweep's and "Check now"'s capture only for an order PayPal shows approved (finding 2,
// the optional low); a refund's `invoice_id` reaches the finance Worker (finding 4); the advices' period, count and keyset (findings 5 to 7); the provider
// adapter's `createCheckout` (finding 9); the token's Basic auth (finding 10). PayPal is never called: the stub transport answers. All names and amounts are
// invented test data.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStubTransport } from "./gateway/config.ts";
import { refreshCheckoutById, refreshForClient } from "./gateway/links.ts";
import { reviewReason } from "./gateway/messages.ts";
import { owner } from "./test-gateway.ts";
import { call, one, rows } from "./test-helpers.ts";
import { currentFy, lutOf, putSwiftBank, putTax } from "./test-invoice-types.ts";
import { json, putBank, putCompany } from "./test-invoices.ts";
import {
  apiCalls,
  capOf,
  liveOrder,
  orderAnswer,
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
