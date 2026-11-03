// M6.4 PayPal, the fix round after early check 2 [ADM-PAY-01, -03, -04, -07, ADM-INV-10, JOB-HOOK-02, POR-06; run file "Early check 2" findings 3, 5 and 8, and
// "Fix round must carry"]: the signed-in page's return names its checkout and reads its state back (bound to the client and the document), the refusal names
// the gateway that holds the money, the approved staff lines, and the cases the analyst listed: an approval reversed (captured after all, claimed, unclaimed), a
// refund on a pending payment, the event path's failed re-fetch and a capture of another order, a manual payment confirmed during a claim (overpaid credit), the
// provider switch both ways while money waits, a capture PayPal holds (no new link; void and withdraw refused through the routes), the review item's retry,
// and PayPal's fee in rupees. PayPal and Stripe are never called: the stub transports answer. All names and amounts are invented test data.
import { env } from "cloudflare:workers";
import { PAYPAL_CLAIM_STALE_MS } from "@techaust/core/paypal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStubTransport } from "./gateway/config.ts";
import { processEvent } from "./gateway/events.ts";
import { refreshForClient } from "./gateway/links.ts";
import { bellAdvicesMissing, reviewReason } from "./gateway/messages.ts";
import { owner } from "./test-gateway.ts";
import { call, one, rows } from "./test-helpers.ts";
import { currentFy, lutOf, mkProforma, putSwiftBank, putTax } from "./test-invoice-types.ts";
import { issueInvoice, json, putBank, putCompany, voidInvoice } from "./test-invoices.ts";
import { record, recordBody, verify } from "./test-payments.ts";
import {
  apiCalls,
  capOf,
  captureAnswer,
  liveOrder,
  orderAnswer,
  payPalEventRow,
  payPalLink,
  paypalCalls,
  paypalStub,
  ppCheckout,
  ppError,
  ppPaymentOf,
  signedInReturn,
} from "./test-paypal.ts";
import { jsonResponse, liveSession, stripeCalls, stripeLink, stripeStub, usdClient } from "./test-stripe.ts";

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
const eventOf = (id: string) =>
  one<{ status: string; outcome: string | null }>(
    "SELECT status, outcome FROM webhook_events WHERE id = ?1",
    id,
  );
const ledger = (id: string) =>
  one<{ status: string; paid_minor: number; balance_minor: number }>(
    "SELECT status, paid_minor, balance_minor FROM documents WHERE id = ?1",
    id,
  );
const captures = () => apiCalls().filter((c) => c.method === "POST" && c.path.endsWith("/capture"));
/** PayPal holds the capture of `orderId` (PENDING, PENDING_REVIEW) in the capture call's answer. */
const heldCapture = (orderId: string) => (path: string, method: string) =>
  method === "POST" && path.endsWith("/capture")
    ? orderAnswer(
        orderId,
        (x) => {
          const u = (x.purchase_units as { payments: { captures: J[] } }[])[0];
          const c = u?.payments.captures[0] as J;
          c.status = "PENDING";
          c.status_details = { reason: "PENDING_REVIEW" };
          c.seller_receivable_breakdown = undefined;
        },
        true,
        201,
      )
    : null;

describe("the signed-in page's PayPal return names its checkout [finding 3; L19, POR-06]", () => {
  it("answers the capture's state (declined with PayPal's own page for the same order); another client's or document's checkout is no_open_link, nothing asked", async () => {
    const o = await liveOrder();
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/capture")
        ? ppError(422, "UNPROCESSABLE_ENTITY", "INSTRUMENT_DECLINED")
        : null,
    );
    expect(
      await refreshForClient(env, {
        clientId: o.clientId,
        documentId: o.documentId,
        checkoutId: o.checkoutId,
      }),
    ).toEqual({ result: "processed", payPalReturn: { state: "declined", retryUrl: o.url } });
    const other = await liveOrder();
    paypalStub();
    expect(
      await refreshForClient(env, {
        clientId: other.clientId,
        documentId: other.documentId,
        checkoutId: o.checkoutId,
      }),
    ).toEqual({ result: "no_open_link" });
    expect(
      await refreshForClient(env, {
        clientId: o.clientId,
        documentId: other.documentId,
        checkoutId: o.checkoutId,
      }),
    ).toEqual({ result: "no_open_link" });
    expect(paypalCalls).toEqual([]);
    // Then paid on the next press of "Try again on PayPal" and its return.
    expect(await signedInReturn(o)).toEqual({ state: "paid" });
  });

  it("the page can show Changed, Expired and Not completed: each from the capture path, no capture where none may be made", async () => {
    const changed = await liveOrder();
    await env.DB.prepare(
      "UPDATE documents SET status = 'void', voided_at = 5, void_reason = 'x' WHERE id = ?1",
    )
      .bind(changed.documentId)
      .run();
    paypalStub();
    expect(await signedInReturn(changed)).toEqual({ state: "changed" });
    const late = await liveOrder();
    const row = await ppCheckout(late.checkoutId);
    expect(await signedInReturn(late, (row?.expires_at ?? 0) + 31 * 60_000)).toEqual({ state: "expired" });
    const left = await liveOrder();
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/capture")
        ? ppError(422, "UNPROCESSABLE_ENTITY", "ORDER_NOT_APPROVED")
        : null,
    );
    expect(await signedInReturn(left)).toEqual({ state: "not_completed" });
    expect(captures()).toHaveLength(1);
    // A held capture reads Pending (07-ZN line 10) on the next return too, with no new capture.
    const held = await liveOrder();
    paypalStub(heldCapture(held.orderId));
    expect(await signedInReturn(held)).toEqual({ state: "pending" });
  });
});

describe("the refusal names the gateway holding the money [finding 5]", () => {
  it("PayPal after a paid Stripe session: 409 payment_processing, provider stripe; and while Stripe's payment is being settled", async () => {
    const s = await liveSession();
    // One transport answers both gateways here: Stripe refuses the expire (the session completed), the simulator answers the rest.
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/expire")
        ? jsonResponse(400, { error: { type: "invalid_request_error" } })
        : null,
    );
    expect(await payPalLink(s, s.documentId, 20_000)).toEqual({
      ok: false,
      error: "payment_processing",
      provider: "stripe",
    });
    expect(paypalCalls).toEqual([]);
    paypalStub();
    // Settled and paid: no new order, whichever gateway.
    expect((await payPalLink(s, s.documentId, 20_000)).ok).toBe(false);
  });

  it("Stripe after a claimed PayPal order, or one PayPal holds: 409 payment_processing, provider paypal; Stripe is never called", async () => {
    const o = await liveOrder();
    await env.DB.prepare("UPDATE checkout_sessions SET capture_started_at = ?2 WHERE id = ?1")
      .bind(o.checkoutId, Date.now())
      .run();
    stripeStub();
    expect(await stripeLink(o, o.documentId, 50_000)).toEqual({
      ok: false,
      error: "payment_processing",
      provider: "paypal",
    });
    expect(stripeCalls).toEqual([]);
    const h = await liveOrder();
    paypalStub(heldCapture(h.orderId));
    expect(await signedInReturn(h)).toEqual({ state: "pending" });
    stripeStub();
    expect(await stripeLink(h, h.documentId, 50_000)).toEqual({
      ok: false,
      error: "payment_processing",
      provider: "paypal",
    });
    paypalStub();
    expect(await payPalLink(h, h.documentId, 50_000)).toEqual({
      ok: false,
      error: "payment_processing",
      provider: "paypal",
    });
    expect([...stripeCalls, ...paypalCalls]).toEqual([]);
  });
});

describe("PayPal events the analyst listed [JOB-HOOK-02, ADR 0008; Fix round must carry]", () => {
  it("CHECKOUT.PAYMENT-APPROVAL.REVERSED: captured after all → settled; claimed → retry (the row untouched); unclaimed → failed", async () => {
    const a = await liveOrder();
    const evA = await payPalEventRow("CHECKOUT.PAYMENT-APPROVAL.REVERSED", {
      linkId: a.orderId,
      checkoutId: a.checkoutId,
    });
    paypalStub();
    expect(await processEvent(env, evA)).toEqual({ result: "processed" });
    expect((await ppPaymentOf(capOf(a.orderId)))?.status).toBe("confirmed");
    expect(await ledger(a.documentId)).toMatchObject({ status: "paid", balance_minor: 0 });
    const b = await liveOrder();
    const now = Date.now();
    await env.DB.prepare("UPDATE checkout_sessions SET capture_started_at = ?2 WHERE id = ?1")
      .bind(b.checkoutId, now)
      .run();
    const evB = await payPalEventRow("CHECKOUT.PAYMENT-APPROVAL.REVERSED", {
      linkId: b.orderId,
      checkoutId: b.checkoutId,
    });
    paypalStub((path, method) =>
      method === "GET" && path.startsWith("/v2/checkout/orders/")
        ? orderAnswer(b.orderId, () => undefined, false)
        : null,
    );
    expect(await processEvent(env, evB, now)).toEqual({ result: "retry" });
    expect(await ppCheckout(b.checkoutId)).toMatchObject({ status: "live", capture_started_at: now });
    const c = await liveOrder();
    const evC = await payPalEventRow("CHECKOUT.PAYMENT-APPROVAL.REVERSED", {
      linkId: c.orderId,
      checkoutId: c.checkoutId,
    });
    paypalStub((path, method) =>
      method === "GET" && path.startsWith("/v2/checkout/orders/")
        ? orderAnswer(c.orderId, () => undefined, false)
        : null,
    );
    expect(await processEvent(env, evC)).toEqual({ result: "processed" });
    expect((await ppCheckout(c.checkoutId))?.status).toBe("failed");
    expect(await eventOf(evC)).toEqual({ status: "processed", outcome: "approval_reversed" });
    expect(captures()).toEqual([]);
  });

  it("PAYMENT.CAPTURE.REFUNDED on a PENDING payment: a refunded_outside item and a bell, no ledger move", async () => {
    await owner();
    const o = await liveOrder();
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/capture")
        ? orderAnswer(
            o.orderId,
            (x) => {
              x.payer = { address: { country_code: "IN" } };
            },
            true,
            201,
          )
        : null,
    );
    expect(await signedInReturn(o)).toEqual({ state: "processing" });
    const p = await ppPaymentOf(capOf(o.orderId));
    expect(p?.status).toBe("pending_verification");
    const before = await ledger(o.documentId);
    const ev = await payPalEventRow("PAYMENT.CAPTURE.REFUNDED", {
      linkId: o.orderId,
      paymentId: capOf(o.orderId),
      refundId: "REFUND00000000001",
    });
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    expect(await reviewKinds("webhook_event_id", ev)).toEqual(["refunded_outside"]);
    expect(await ledger(o.documentId)).toEqual(before);
    expect((await ppPaymentOf(capOf(o.orderId)))?.status).toBe("pending_verification");
    expect(
      await one<{ title: string }>(
        "SELECT title FROM notifications WHERE kind = 'payment.review' AND entity_id = (SELECT id FROM review_items WHERE webhook_event_id = ?1)",
        ev,
      ),
    ).toMatchObject({ title: expect.stringContaining("The invoice's balance hasn't changed.") });
  });

  it("the event path's re-fetch: a capture PayPal answers 404 for is refetch_failed; the item's retry captures the order as the member", async () => {
    const o = await liveOrder();
    const ev = await payPalEventRow("PAYMENT.CAPTURE.COMPLETED", {
      linkId: o.orderId,
      paymentId: capOf(o.orderId),
      checkoutId: o.checkoutId,
    });
    paypalStub((path, method) =>
      method === "GET" && path.startsWith("/v2/payments/captures/")
        ? ppError(404, "RESOURCE_NOT_FOUND")
        : null,
    );
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    expect(await reviewKinds("webhook_event_id", ev)).toEqual(["refetch_failed"]);
    expect(await rows("SELECT id FROM payments WHERE checkout_id = ?1", o.checkoutId)).toEqual([]);
    // The `/payments/review/:id/retry` PayPal branch: the order is captured as the member, the item resolved once the payment is confirmed.
    const s = await owner();
    const item = await one<{ id: string }>("SELECT id FROM review_items WHERE webhook_event_id = ?1", ev);
    paypalStub();
    const res = await call(`/payments/review/${item?.id}/retry`, { cookie: s.cookie, body: {} });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await json(res)).toEqual({ ok: true, result: "processed" });
    expect((await ppPaymentOf(capOf(o.orderId)))?.status).toBe("confirmed");
    expect(
      await one<{ status: string; resolution: string }>(
        "SELECT status, resolution FROM review_items WHERE id = ?1",
        item?.id,
      ),
    ).toMatchObject({ status: "resolved", resolution: "confirmed" });
    const audit = await one<{ actor_type: string; actor_id: string }>(
      "SELECT actor_type, actor_id FROM audit_log WHERE action = 'payment.gateway_confirm' AND entity_id = ?1",
      `ppl_${capOf(o.orderId)}`,
    );
    expect(audit).toMatchObject({ actor_type: "staff", actor_id: s.id });
  });

  it("a capture event whose capture belongs to another order: recorded pending with a reference_mismatch item, the ledger unchanged", async () => {
    const o = await liveOrder();
    const ev = await payPalEventRow("PAYMENT.CAPTURE.COMPLETED", {
      linkId: o.orderId,
      paymentId: capOf(o.orderId),
      checkoutId: o.checkoutId,
    });
    paypalStub((path, method) =>
      method === "GET" && path.startsWith("/v2/payments/captures/")
        ? captureAnswer(o.orderId, (c) => {
            c.supplementary_data = { related_ids: { order_id: "9OTHERORDER0000001" } };
          })
        : null,
    );
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    expect(await reviewKinds("webhook_event_id", ev)).toEqual(["reference_mismatch"]);
    expect((await ppPaymentOf(capOf(o.orderId)))?.status).toBe("pending_verification");
    expect(await ledger(o.documentId)).toMatchObject({ balance_minor: 50_000 });
  });
});

describe("money that moved while a capture was claimed [Fix round must carry]", () => {
  /** Inside PayPal's capture call (the claim held), the Owner records a bank transfer of `amountMinor` on the invoice and confirms it. */
  const manualDuring =
    (
      s: Awaited<ReturnType<typeof owner>>,
      o: { clientId: string; documentId: string },
      amountMinor: number,
      seen: string[],
    ) =>
    async (path: string, method: string) => {
      if (method === "POST" && path.endsWith("/capture")) {
        const entry = recordBody(o.clientId, amountMinor, [{ documentId: o.documentId, amountMinor }], {
          currency: "USD",
          mode: "swift",
        });
        const made = await record(s, entry);
        seen.push(`record ${made.status}`);
        const row = await one<{ status: string }>("SELECT status FROM payments WHERE id = ?1", entry.id);
        if (row?.status === "pending_verification")
          seen.push(`verify ${(await verify(s, entry.id, "confirm")).status}`);
        seen.push(`balance ${(await ledger(o.documentId))?.balance_minor}`);
      }
      return null;
    };
  const unallocated = async (paymentId: string) =>
    (
      await one<{ n: number }>(
        `SELECT p.amount_minor - coalesce((SELECT sum(CASE a.kind WHEN 'allocate' THEN a.amount_minor ELSE -a.amount_minor END) FROM payment_allocations a
           WHERE a.payment_id = p.id), 0) AS n FROM payments p WHERE p.id = ?1`,
        paymentId,
      )
    )?.n;

  it("part paid by hand during the claim: the capture confirms the rest, the excess held as overpaid credit with the Owner's item", async () => {
    const s = await owner();
    const o = await liveOrder();
    const seen: string[] = [];
    paypalStub(manualDuring(s, o, 30_000, seen));
    expect(await signedInReturn(o)).toEqual({ state: "paid" });
    expect(seen.at(-1)).toBe("balance 20000");
    const p = await ppPaymentOf(capOf(o.orderId));
    expect(p?.status).toBe("confirmed");
    expect(await ledger(o.documentId)).toMatchObject({ status: "paid", balance_minor: 0 });
    expect(await reviewKinds("payment_id", p?.id as string)).toEqual(["overpaid"]);
    expect(await unallocated(p?.id as string)).toBe(30_000);
  });

  it("paid in full by hand during the claim: PayPal's money is never dropped: recorded pending with a document_not_payable item, nothing allocated", async () => {
    const s = await owner();
    const o = await liveOrder();
    const seen: string[] = [];
    paypalStub(manualDuring(s, o, 50_000, seen));
    expect(await signedInReturn(o)).toEqual({ state: "processing" });
    expect(seen.at(-1)).toBe("balance 0");
    const p = await ppPaymentOf(capOf(o.orderId));
    expect(p?.status).toBe("pending_verification");
    expect(await reviewKinds("payment_id", p?.id as string)).toEqual(["document_not_payable"]);
    expect(await unallocated(p?.id as string)).toBe(50_000);
    expect((await ppCheckout(o.checkoutId))?.status).toBe("paid");
  });
});

describe("a capture PayPal holds blocks pay, void and withdraw [L6, L24; Fix round must carry]", () => {
  it("createLink is 409 (both gateways); the admin void of the invoice is 409 with payment_pending_capture through the route", async () => {
    const s = await owner();
    const o = await liveOrder();
    paypalStub(heldCapture(o.orderId));
    expect(await signedInReturn(o)).toEqual({ state: "pending" });
    paypalStub();
    expect(await payPalLink(o, o.documentId, 50_000)).toMatchObject({
      ok: false,
      error: "payment_processing",
    });
    const refused = await voidInvoice(s, o.documentId);
    expect(refused.status).toBe(409);
    expect(((await json(refused)) as { reasons: string[] }).reasons).toContain("payment_pending_capture");
    const view = (await json(await call(`/invoices/${o.documentId}`, { cookie: s.cookie }))) as {
      void: { blockers: string[] };
    };
    expect(view.void.blockers).toContain("payment_pending_capture");
  });

  it("a delivered USD proforma with a held capture: the withdraw is 409 payment_pending_capture through the route", async () => {
    const s = await owner();
    const made = await mkProforma(s, { client: usdClient, price: 1_000_000 });
    expect((await issueInvoice(s, made.id)).status).toBe(200);
    const pf = await one<{ total_minor: number }>("SELECT total_minor FROM documents WHERE id = ?1", made.id);
    const r = await payPalLink(
      { clientId: made.clientId, contactId: made.contactId },
      made.id,
      pf?.total_minor,
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const orderId = new URL((r as { url: string }).url).searchParams.get("token") as string;
    paypalStub(heldCapture(orderId));
    expect(await signedInReturn({ checkoutId: (r as { checkoutId: string }).checkoutId })).toEqual({
      state: "pending",
    });
    await env.DB.prepare("UPDATE documents SET viewed_at = ?2 WHERE id = ?1 AND viewed_at IS NULL")
      .bind(made.id, Date.now())
      .run();
    const stamp = await one<{ updated_at: number }>(
      "SELECT updated_at FROM documents WHERE id = ?1",
      made.id,
    );
    const w = await call(`/invoices/${made.id}/withdraw`, {
      cookie: s.cookie,
      body: { expectedUpdatedAt: stamp?.updated_at, reason: "Sent to the wrong client" },
    });
    expect(w.status, await w.clone().text()).toBe(409);
    const body = (await json(w)) as { error: { code: string }; reasons: string[] };
    expect(body.error.code).toBe("payment_pending_capture");
    expect(body.reasons).toEqual(["payment_pending_capture"]);
  });
});

describe("PayPal's fee in rupees [L8, L29; 08-C RA-29]", () => {
  it("an INR paypal_fee lands in gateway_fee_inr_minor (never charges_minor), the INR receivable in inr_received_minor", async () => {
    const o = await liveOrder();
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/capture")
        ? orderAnswer(
            o.orderId,
            (x) => {
              const u = (x.purchase_units as { payments: { captures: J[] } }[])[0];
              (u?.payments.captures[0] as J).seller_receivable_breakdown = {
                gross_amount: { currency_code: "USD", value: "500.00" },
                paypal_fee: { currency_code: "INR", value: "1234.56" },
                net_amount: { currency_code: "USD", value: "485.00" },
                receivable_amount: { currency_code: "INR", value: "40321.00" },
                exchange_rate: { source_currency: "USD", target_currency: "INR", value: "83.1" },
              };
            },
            true,
            201,
          )
        : null,
    );
    expect(await signedInReturn(o)).toEqual({ state: "paid" });
    expect(await ppPaymentOf(capOf(o.orderId))).toMatchObject({
      status: "confirmed",
      charges_minor: 0,
      gateway_fee_inr_minor: 123_456,
      inr_received_minor: 4_032_100,
    });
  });
});

describe("the staff lines approved in the triage [finding 8]", () => {
  it("S3 with and without PayPal's code, S5, S6, S7 and S9's singular", () => {
    expect(reviewReason("capture_pending", { provider: "paypal" })).toBe(
      "PayPal is holding this payment. It counts once PayPal completes it.",
    );
    expect(reviewReason("capture_pending", { provider: "paypal", code: "PENDING_REVIEW" })).toBe(
      "PayPal is holding this payment (reason: PENDING_REVIEW). It counts once PayPal completes it.",
    );
    expect(reviewReason("capture_refused", { provider: "paypal", code: "TRANSACTION_REFUSED" })).toBe(
      "PayPal refused to take this payment (TRANSACTION_REFUSED). Nothing was received. The client can start again or pay another way.",
    );
    expect(
      reviewReason("reversed_after_confirm", { provider: "paypal", currency: "USD", paidMinor: 50_000 }),
    ).toBe(
      "PayPal reversed $500.00 that was already counted. Check the case in PayPal. The invoice's balance hasn't changed.",
    );
    expect(reviewReason("refunded_outside", { provider: "paypal" })).toBe(
      "This payment was refunded in PayPal, outside the admin. The invoice's balance hasn't changed until you record the refund.",
    );
    expect(bellAdvicesMissing(1, "October 2026")).toBe(
      "1 PayPal payment from October 2026 has no remittance advice yet.",
    );
    expect(bellAdvicesMissing(2, "October 2026")).toBe(
      "2 PayPal payments from October 2026 have no remittance advice yet.",
    );
  });

  it("a held capture's item carries PayPal's code into the bell", async () => {
    await owner();
    const o = await liveOrder();
    paypalStub(heldCapture(o.orderId));
    expect(await signedInReturn(o)).toEqual({ state: "pending" });
    const bell = await one<{ title: string }>(
      "SELECT n.title FROM notifications n JOIN review_items r ON r.id = n.entity_id WHERE r.document_id = ?1 AND r.kind = 'capture_pending'",
      o.documentId,
    );
    expect(bell?.title).toContain("PayPal is holding this payment (reason: PENDING_REVIEW).");
  });

  it("a stale claim past 2 minutes is taken again by the signed-in return (the capture path runs once more)", async () => {
    const o = await liveOrder();
    const now = Date.now();
    await env.DB.prepare("UPDATE checkout_sessions SET capture_started_at = ?2 WHERE id = ?1")
      .bind(o.checkoutId, now - PAYPAL_CLAIM_STALE_MS - 1)
      .run();
    paypalStub();
    expect(await signedInReturn(o, now)).toEqual({ state: "paid" });
    expect(captures()).toHaveLength(1);
  });
});
