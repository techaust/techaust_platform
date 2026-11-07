// M6–M7 audit, AF1's fix leg after the early check (run file docs/runs/full-audit-m6-m7.md, lead's triage AU33 to AU36) [ADM-PAY-02, ADM-PAY-08, ADM-PAY-11]:
// a reversed refund of a rejected payment is no client credit (AU33); the Needs-review order of 07-ZT line 2 works end to end (AU34); the failure paths the
// early check found untested (AU35: `live_not_allowed` retried, `isOurs` on the first refund answer, PayPal's `partly_refunded`); Stripe's `requires_action`
// after success is an item, never a reversal (AU36). No test reaches a gateway: the stubs answer. Invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStubTransport, stubFetch } from "./gateway/config.ts";
import { processEvent } from "./gateway/events.ts";
import { issued, linkFor, stub } from "./test-gateway.ts";
import { call, one, rows, sessionFor, withEnv } from "./test-helpers.ts";
import { currentFy, lutOf, putSwiftBank, putTax, todayIso } from "./test-invoice-types.ts";
import { type J, json, putBank, putCompany } from "./test-invoices.ts";
import { verify } from "./test-payments.ts";
import { capOf, liveOrder, orderAnswer, paypalStub, ppPaymentOf, signedInReturn } from "./test-paypal.ts";
import { addDoc, mkReportClient } from "./test-reports.ts";
import { jsonResponse, liveSession, piOf, stripeEventRow, stripeStub } from "./test-stripe.ts";

const owner = () => sessionFor("owner", { stepUp: true });
beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
  stub();
});
afterEach(() => setStubTransport(null));

const activeOwners = async () =>
  (
    await rows<{ n: number }>(
      "SELECT count(*) AS n FROM staff_users WHERE role = 'owner' AND status = 'active'",
    )
  )[0]?.n;
const items = (paymentId: string, kind: string) =>
  rows<{ id: string; stage: string | null; reason: string | null }>(
    `SELECT id, json_extract(facts, '$.stage') AS stage, json_extract(facts, '$.reason') AS reason FROM review_items
     WHERE payment_id = ?1 AND kind = ?2 ORDER BY created_at, id`,
    paymentId,
    kind,
  );
const bellsOf = (itemId: string | undefined) =>
  rows<{ title: string }>("SELECT title FROM notifications WHERE entity_id = ?1", itemId);
const webhookRow = async (provider: string, type: string, facts: Record<string, unknown>) => {
  const id = uuidv7();
  await env.DB.prepare(
    "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, facts) VALUES (?1, ?2, ?3, ?4, ?5, 'received', ?6)",
  )
    .bind(id, provider, `evt_${id.slice(-12)}`, type, Date.now(), JSON.stringify({ event: type, ...facts }))
    .run();
  return id;
};

let seq = 0;

// ---- AU33 and AU36: Stripe, a refund of a pending card payment refunded in full (L33: the payment rejected), then requires_action, then failed --------

/** A USD proforma paid by card (pending), refunded in full outside the admin and rejected by the system as L33 does: the refund's facts. */
async function stripeRejectedRefunded() {
  stripeStub();
  const s = await liveSession({ type: "proforma" });
  await processEvent(env, await stripeEventRow(s.sessionId, s.checkoutId));
  const pi = piOf(s.sessionId);
  const p = (await one<{ id: string; client_id: string; amount_minor: number }>(
    "SELECT id, client_id, amount_minor FROM payments WHERE provider = 'stripe' AND provider_payment_id = ?1",
    pi,
  )) as { id: string; client_id: string; amount_minor: number };
  const o = await owner();
  const refundId = uuidv7();
  const reId = `re_AF1B${Date.now()}${++seq}`;
  const T = Date.now();
  await env.DB.prepare(
    `INSERT INTO payment_refunds (id, payment_id, client_id, provider, origin, status, paid_to, reason_code, currency, amount_minor, provider_refund_id,
       requested_by, requested_at, settled_at, settled_on, updated_at)
     VALUES (?1, ?2, ?3, 'stripe', 'outside', 'succeeded', 'original', 'duplicate', 'USD', ?4, ?5, ?6, ?7, ?7, ?8, ?7)`,
  )
    .bind(refundId, p.id, p.client_id, p.amount_minor, reId, o.id, T, todayIso())
    .run();
  // L33: the system's one allowed move (0070 `payments_status_flow`), as `pendingRefundedRejectStatement` makes it
  await env.DB.prepare("UPDATE payments SET status = 'rejected', verified_at = ?2 WHERE id = ?1")
    .bind(p.id, T + 1)
    .run();
  return { pi, paymentId: p.id, refundId, reId, amount: p.amount_minor };
}

const stripeRefundJson = (reId: string, pi: string, status: string, amount: number) => ({
  id: reId,
  object: "refund",
  amount,
  currency: "usd",
  payment_intent: pi,
  status,
  ...(status === "failed" ? { failure_reason: "expired_or_canceled_card" } : {}),
  metadata: {},
});
const stripeRefundEvent = (r: { reId: string; pi: string; amount: number }, status: string) =>
  stripeEventRow("", "", "refund.updated", {
    event: "refund.updated",
    object: "refund",
    refundId: r.reId,
    paymentId: r.pi,
    amountMinor: r.amount,
    currency: "USD",
    status,
    livemode: 0,
  });

describe("AU36 (L1) and AU33 (M1): Stripe's requires_action after success, then a real failure, on a rejected payment's refund", () => {
  it("requires_action: one item at stage requires_action with the owners' bell, nothing reversed, a second answer only logs; failed: reversed with its own item, the rejected-payment line, no client email", async () => {
    const r = await stripeRejectedRefunded();
    let answer = stripeRefundJson(r.reId, r.pi, "requires_action", r.amount);
    stripeStub((path, method) =>
      method === "GET" && path === `/v1/refunds/${r.reId}` ? jsonResponse(200, answer) : null,
    );
    const ev = await stripeRefundEvent(r, "pending");
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    expect(await one("SELECT status, reversed_at FROM payment_refunds WHERE id = ?1", r.refundId)).toEqual({
      status: "succeeded",
      reversed_at: null,
    });
    const first = await items(r.paymentId, "refund_reversed");
    expect(first).toEqual([{ id: expect.any(String), stage: "requires_action", reason: null }]);
    const bells = await bellsOf(first[0]?.id);
    expect(bells).toHaveLength(await activeOwners());
    expect(bells[0]?.title).toMatch(
      /Stripe needs the client to act before the refund of \$[\d,.]+ can reach them/,
    );
    expect(await one("SELECT status, outcome FROM webhook_events WHERE id = ?1", ev)).toEqual({
      status: "needs_review",
      outcome: "refund_requires_action",
    });
    // the same answer again: logged only (no second item, no second bell)
    const again = await stripeRefundEvent(r, "pending");
    expect(await processEvent(env, again)).toEqual({ result: "processed" });
    expect(await items(r.paymentId, "refund_reversed")).toHaveLength(1);
    expect(await one("SELECT outcome FROM webhook_events WHERE id = ?1", again)).toEqual({
      outcome: "refund_requires_action_known",
    });
    // the bank returns it: reversed, its own item (no stage) saying the payment was rejected; no `refundReversed` (the client gets no email: AU33)
    answer = stripeRefundJson(r.reId, r.pi, "failed", r.amount);
    expect(await processEvent(env, await stripeRefundEvent(r, "failed"))).toEqual({ result: "needs_review" });
    expect(
      await one(
        "SELECT status, reversed_at IS NOT NULL AS reversed FROM payment_refunds WHERE id = ?1",
        r.refundId,
      ),
    ).toEqual({ status: "failed", reversed: 1 });
    const both = await items(r.paymentId, "refund_reversed");
    expect(both.map((x) => [x.stage, x.reason])).toEqual([
      ["requires_action", null],
      [null, "payment_rejected"],
    ]);
    expect((await bellsOf(both[1]?.id))[0]?.title).toBe(
      `A payment needs review: Stripe's refund of $${(r.amount / 100).toFixed(2)} came back after it was made. The payment was rejected when this refund was made, so the money isn't counted here. Record it as a payment.`,
    );
    // the payment stays rejected: no money is counted without the Owner (AU30)
    expect(
      (await one<{ status: string }>("SELECT status FROM payments WHERE id = ?1", r.paymentId))?.status,
    ).toBe("rejected");
  });
});

// ---- AU34: a Razorpay payment first seen partly refunded, confirmed from Needs review, then the refund recorded from credit ---------------------------------

describe("AU34 (M2): 07-ZT line 2's order works end to end", () => {
  it("confirm with only what was kept on the invoice (the refunded part stays credit), then record the outside refund from credit with Razorpay's id", async () => {
    const o = await owner();
    const doc = await issued(o);
    const link = await linkFor(o, doc);
    const payRef = link.paymentId;
    const refunded = 10_000;
    const rfnd = `rfnd_AUB${Date.now()}${++seq}`;
    setStubTransport(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === `/v1/refunds/${rfnd}`)
        return jsonResponse(200, {
          id: rfnd,
          entity: "refund",
          amount: refunded,
          currency: "INR",
          payment_id: payRef,
          status: "processed",
        });
      const res = await stubFetch(input, init);
      if (url.pathname !== `/v1/payments/${payRef}`) return res;
      const body = (await res.json()) as Record<string, unknown>;
      return jsonResponse(200, { ...body, amount_refunded: refunded, refund_status: "partial" });
    });
    const paid = await webhookRow("razorpay", "payment_link.paid", {
      linkId: link.linkId,
      paymentId: payRef,
    });
    expect(await processEvent(env, paid)).toEqual({ result: "needs_review" });
    const p = (await one<{ id: string; status: string }>(
      "SELECT id, status FROM payments WHERE provider = 'razorpay' AND provider_payment_id = ?1",
      payRef,
    )) as { id: string; status: string };
    expect(p.status).toBe("pending_verification");
    const item = await one<{ id: string }>(
      "SELECT id FROM review_items WHERE payment_id = ?1 AND kind = 'refunded_outside' AND status = 'open'",
      p.id,
    );
    expect(item).not.toBeNull();
    // 1. Confirm, putting only what was kept on the invoice
    const kept = doc.total - refunded;
    const res = await verify(o, p.id, "confirm", {
      allocations: [{ documentId: doc.id, amountMinor: kept }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await json(res)) as J).unallocatedMinor).toBe(refunded);
    expect(await one("SELECT status, resolution FROM review_items WHERE id = ?1", item?.id)).toEqual({
      status: "resolved",
      resolution: "confirmed",
    });
    // 2. Record the refund from credit with Razorpay's refund id (checked at Razorpay: the same payment, amount, processed)
    const body = {
      id: uuidv7(),
      amountMinor: refunded,
      from: "credit",
      reasonCode: "duplicate",
      outside: { providerRefundId: rfnd, origin: "outside", settledOn: todayIso() },
    };
    const r = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body });
    expect(r.status, await r.clone().text()).toBe(200);
    expect(
      await one("SELECT status, provider_refund_id FROM payment_refunds WHERE id = ?1", body.id),
    ).toEqual({
      status: "succeeded",
      provider_refund_id: rfnd,
    });
    // the invoice still owes the refunded part; the payment holds no credit any more
    expect(await one("SELECT paid_minor, balance_minor FROM documents WHERE id = ?1", doc.id)).toMatchObject({
      paid_minor: kept,
      balance_minor: refunded,
    });
    const credit = ((await json(await call(`/clients/${doc.clientId}/credit`, { cookie: o.cookie }))) as J)
      .credits as J[];
    expect(credit.filter((c) => c.currency === "INR" && (c.creditMinor as number) > 0)).toEqual([]);
  });
});

// ---- AU35: the failure paths ---------------------------------------------------------------------------------------------------------------------------

/** A confirmed Razorpay payment of ₹500 with nothing allocated (all credit). */
async function rzpCredit() {
  const o = await owner();
  const clientId = await mkReportClient("INR");
  const doc = await addDoc({ clientId, issueDate: todayIso() });
  const T = Date.now() + ++seq;
  const ck = uuidv7();
  await env.DB.prepare(
    `INSERT INTO checkout_sessions (id, provider, document_id, client_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at)
     VALUES (?1, 'razorpay', ?2, ?3, ?4, 'staff', 'INR', 50000, 'creating', ?5, ?6, ?6)`,
  )
    .bind(ck, doc.id, clientId, o.id, T + 86_400_000, T)
    .run();
  await env.DB.prepare(
    "UPDATE checkout_sessions SET status = 'live', provider_link_id = ?2, short_url = 'https://rzp.io/i/x', updated_at = ?3 WHERE id = ?1",
  )
    .bind(ck, `plink_AFB${T}`, T + 1)
    .run();
  const id = uuidv7();
  const ref = `pay_AFB${T}`;
  await env.DB.prepare(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, fee_tax_minor, received_on, mode, reference_norm, recorded_at, provider_payment_id, checkout_id, refetched_at)
     VALUES (?1, ?2, 'payment', 'razorpay', 'pending_verification', 'INR', 50000, 0, 0, ?3, 'upi', ?4, ?5, ?4, ?6, ?5)`,
  )
    .bind(id, clientId, todayIso(), ref, T, ck)
    .run();
  await env.DB.prepare(
    "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
  )
    .bind(id, o.id, T + 5)
    .run();
  return { o, id, ref };
}

describe("AU35 (M3): the failure paths", () => {
  it("Razorpay with a live key while live payments are off: payment_link.paid and payment_link.expired are retried (settle.ts, events.ts), nothing written; with the test key the paid event settles", async () => {
    const o = await owner();
    const doc = await issued(o);
    const link = await linkFor(o, doc);
    const live = withEnv(env, { RAZORPAY_KEY_ID: "rzp_live_LIVEKEY00001" });
    const paid = await webhookRow("razorpay", "payment_link.paid", {
      linkId: link.linkId,
      paymentId: link.paymentId,
    });
    expect(await processEvent(live, paid)).toEqual({ result: "retry" });
    const expired = await webhookRow("razorpay", "payment_link.expired", { linkId: link.linkId });
    expect(await processEvent(live, expired)).toEqual({ result: "retry" });
    expect(await rows("SELECT id FROM payments WHERE provider_payment_id = ?1", link.paymentId)).toEqual([]);
    expect(await rows("SELECT id FROM review_items WHERE document_id = ?1", doc.id)).toEqual([]);
    expect(
      (await one<{ status: string }>("SELECT status FROM checkout_sessions WHERE id = ?1", link.checkoutId))
        ?.status,
    ).toBe("live");
    expect(await one("SELECT status FROM webhook_events WHERE id = ?1", paid)).toEqual({
      status: "received",
    });
    expect(await processEvent(env, paid)).toEqual({ result: "processed" });
    expect(
      (
        await one<{ status: string }>(
          "SELECT status FROM payments WHERE provider_payment_id = ?1",
          link.paymentId,
        )
      )?.status,
    ).toBe("confirmed");
  });

  it("Stripe with a live key while live payments are off: the session's event is retried (stripe-settle.ts), nothing written; with the test key it settles", async () => {
    stripeStub();
    const s = await liveSession();
    const ev = await stripeEventRow(s.sessionId, s.checkoutId);
    const live = withEnv(env, { STRIPE_SECRET_KEY: ["rk", "live", "madeup"].join("_") });
    expect(await processEvent(live, ev)).toEqual({ result: "retry" });
    expect(
      await rows(
        "SELECT id FROM payments WHERE provider = 'stripe' AND provider_payment_id = ?1",
        piOf(s.sessionId),
      ),
    ).toEqual([]);
    expect(await rows("SELECT id FROM review_items WHERE document_id = ?1", s.documentId)).toEqual([]);
    expect(await processEvent(env, ev)).toEqual({ result: "processed" });
    expect(
      (
        await one<{ status: string }>(
          "SELECT status FROM payments WHERE provider = 'stripe' AND provider_payment_id = ?1",
          piOf(s.sessionId),
        )
      )?.status,
    ).toBe("confirmed");
  });

  it("isOurs on the route's first answer: Razorpay answers a refund of another amount, or with another id of ours: 202 requested, the row unchanged", async () => {
    for (const edit of [{ amount: 9_999 }, { receipt: uuidv7() }]) {
      const p = await rzpCredit();
      stub((path, method, b) =>
        method === "POST" && path === `/v1/payments/${p.ref}/refund`
          ? jsonResponse(200, {
              id: `rfnd_NOTOURS${++seq}`,
              entity: "refund",
              amount: 10_000,
              currency: "INR",
              payment_id: p.ref,
              receipt: (b as { receipt?: string } | null)?.receipt,
              status: "processed",
              ...edit,
            })
          : null,
      );
      const body = { id: uuidv7(), amountMinor: 10_000, from: "credit", reasonCode: "overpayment" };
      const res = await call(`/payments/${p.id}/refunds`, { cookie: p.o.cookie, body });
      expect(res.status, JSON.stringify(edit)).toBe(202);
      expect(((await json(res)) as J).status).toBe("requested");
      expect(
        await one(
          "SELECT status, provider_refund_id, settled_on, failure_code FROM payment_refunds WHERE id = ?1",
          body.id,
        ),
      ).toEqual({ status: "requested", provider_refund_id: null, settled_on: null, failure_code: null });
    }
  });

  it("PayPal's PARTIALLY_REFUNDED capture first seen: recorded pending with a refunded_outside item (reason partly_refunded), the balance unchanged", async () => {
    paypalStub();
    const o = await liveOrder();
    paypalStub((path, method) =>
      method === "POST" && path.endsWith("/capture")
        ? orderAnswer(
            o.orderId,
            (x) => {
              const u = (x.purchase_units as { payments: { captures: Record<string, unknown>[] } }[])[0];
              (u?.payments.captures[0] as Record<string, unknown>).status = "PARTIALLY_REFUNDED";
            },
            true,
            201,
          )
        : null,
    );
    await signedInReturn(o);
    const p = await ppPaymentOf(capOf(o.orderId));
    expect(p?.status).toBe("pending_verification");
    expect(
      await rows<{ kind: string; reason: string | null }>(
        "SELECT kind, json_extract(facts, '$.reason') AS reason FROM review_items WHERE document_id = ?1",
        o.documentId,
      ),
    ).toEqual([{ kind: "refunded_outside", reason: "partly_refunded" }]);
    expect(await rows("SELECT id FROM payment_allocations WHERE payment_id = ?1", p?.id)).toEqual([]);
    expect(
      (
        await one<{ balance_minor: number }>(
          "SELECT balance_minor FROM documents WHERE id = ?1",
          o.documentId,
        )
      )?.balance_minor,
    ).toBe(50_000);
  });
});
