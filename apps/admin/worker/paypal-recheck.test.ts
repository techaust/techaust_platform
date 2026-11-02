// M6.4 PayPal, the last fix round after review part 2 [ADM-PAY-01, -03; run file "Review part 2, re-check and visual", findings 3 and 4]: a refresh that reads the
// order before claiming (the sweep, the portal's poll, "Check now") answers `retry` when PayPal can't be reached (nothing claimed, so nothing "in flight"), and
// ends an unclaimed row whose document can no longer take its amount even when PayPal's order isn't approved. PayPal is never called: the stub transport answers.
// All names and amounts are invented test data.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStubTransport } from "./gateway/config.ts";
import { refreshCheckoutById } from "./gateway/links.ts";
import { owner } from "./test-gateway.ts";
import { call, one } from "./test-helpers.ts";
import { currentFy, lutOf, putSwiftBank, putTax } from "./test-invoice-types.ts";
import { json, putBank, putCompany } from "./test-invoices.ts";
import { apiCalls, liveOrder, orderAnswer, paypalStub, ppCheckout, ppError } from "./test-paypal.ts";

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
  paypalStub();
});
afterEach(() => setStubTransport(null));

const captures = () => apiCalls().filter((c) => c.method === "POST" && c.path.endsWith("/capture"));
const orderGet = (orderId: string) => `GET /v2/checkout/orders/${orderId}`;
const calls = () => apiCalls().map((c) => `${c.method} ${c.path}`);
/** PayPal's order of `orderId` before the client approves it (no capture, status CREATED). */
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
const allowRefresh = (checkoutId: string) =>
  env.DB.prepare("UPDATE checkout_sessions SET last_refresh_at = ?2 WHERE id = ?1")
    .bind(checkoutId, Date.now() - 120_000)
    .run();

describe("an unreachable order read is a retry, never a capture in flight [review part 2, finding 3; L14]", () => {
  it("the sweep and Check now answer retry with nothing claimed (never a capture in flight); no such order: unchanged", async () => {
    const o = await owner();
    const a = await liveOrder();
    const down = (path: string, method: string) =>
      method === "GET" && path === `/v2/checkout/orders/${a.orderId}`
        ? ppError(503, "SERVICE_UNAVAILABLE")
        : null;
    paypalStub(down);
    expect(await refreshCheckoutById(env, a.checkoutId)).toEqual({ result: "retry" });
    expect(calls()).toEqual([orderGet(a.orderId)]);
    expect(captures()).toEqual([]);
    expect(await ppCheckout(a.checkoutId)).toMatchObject({ status: "live", capture_started_at: null });
    // "Check now" a minute later: the same read; the member is told PayPal can't be reached, never "a capture is in progress".
    await allowRefresh(a.checkoutId);
    paypalStub(down);
    const res = await call(`/payments/links/${a.checkoutId}/refresh`, { cookie: o.cookie, body: {} });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await json(res)).toEqual({ ok: true, result: "retry" });
    expect(captures()).toEqual([]);
    expect(await ppCheckout(a.checkoutId)).toMatchObject({ status: "live", capture_started_at: null });
    // No such order at PayPal (404): not completed, the row left to expire at its grace; no capture call.
    await allowRefresh(a.checkoutId);
    paypalStub((path, method) =>
      method === "GET" && path === `/v2/checkout/orders/${a.orderId}`
        ? ppError(404, "RESOURCE_NOT_FOUND")
        : null,
    );
    expect(await refreshCheckoutById(env, a.checkoutId)).toEqual({ result: "unchanged" });
    expect(captures()).toEqual([]);
    expect(await ppCheckout(a.checkoutId)).toMatchObject({ status: "live", capture_started_at: null });
  });
});

describe("a not-approved order of a changed document ends its row [review part 2, finding 4; run file C step 2]", () => {
  it("the document voided: the sweep ends the unclaimed row cancelled (changed) with an audit row, after one order read and no capture call", async () => {
    const a = await liveOrder();
    await env.DB.prepare(
      "UPDATE documents SET status = 'void', voided_at = 5, void_reason = 'x' WHERE id = ?1",
    )
      .bind(a.documentId)
      .run();
    paypalStub(notApproved(a.orderId));
    expect(await refreshCheckoutById(env, a.checkoutId)).toEqual({ result: "processed" });
    expect(calls()).toEqual([orderGet(a.orderId)]);
    expect(captures()).toEqual([]);
    expect(await ppCheckout(a.checkoutId)).toMatchObject({ status: "cancelled", capture_started_at: null });
    expect(
      await one<{ n: number }>(
        "SELECT count(*) AS n FROM audit_log WHERE action = 'payment.link_end' AND entity_id = ?1 AND json_extract(summary, '$.reason') = 'changed'",
        a.checkoutId,
      ),
    ).toEqual({ n: 1 });
    // A second sweep: no open link, no call.
    paypalStub(notApproved(a.orderId));
    await allowRefresh(a.checkoutId);
    expect(await refreshCheckoutById(env, a.checkoutId)).toEqual({ result: "no_open_link" });
    expect(apiCalls()).toEqual([]);
  });

  it("the document unchanged: a not-approved order leaves the row live (unchanged), as before", async () => {
    const a = await liveOrder();
    paypalStub(notApproved(a.orderId));
    expect(await refreshCheckoutById(env, a.checkoutId)).toEqual({ result: "unchanged" });
    expect(captures()).toEqual([]);
    expect(await ppCheckout(a.checkoutId)).toMatchObject({ status: "live", capture_started_at: null });
  });
});
