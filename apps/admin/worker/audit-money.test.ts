// M6–M7 audit, AF1's routes and gateway paths (run file docs/runs/full-audit-m6-m7.md, lead's triage AU1 to AU7, AU16) [ADM-PAY-02, -03, -04, -08, -09, -10,
// ADM-INV-17, JOB-HOOK-01]: a Stripe refund that came back after `succeeded` (re-fetched before anything is said; reversed once; the money credit again; one
// item and one bell); a payment partly refunded before we settle it (pending, `refunded_outside`, no ledger move) on Razorpay, including the refund event that
// arrives first; the withdraw refused while linked; idempotent ticks and reductions; the failure paths of cancel, the tick and the reduction; the gateway
// clients' redirect and size guards; the `GET /payments/:id` flags; the recon lists' rows read at 2,000 and 5,000 payments. Invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { issueFyOf } from "@techaust/core/invoices";
import { defaultFormat, maxNumber } from "@techaust/core/numbering";
import { RECEIPTS_DUE_SQL } from "@techaust/db/receipts";
import { type CreditHeldScanRow, creditHeldPage } from "@techaust/db/refunds";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GATEWAY_ANSWER_MAX_BYTES, readJsonCapped } from "./gateway/answer.ts";
import { setStubTransport, stubFetch } from "./gateway/config.ts";
import { processEvent } from "./gateway/events.ts";
import { razorpayApi } from "./gateway/razorpay.ts";
import { issueReceipt, RECEIPT_SERIES_FULL_BELL } from "./receipt-issue.ts";
import { GATEWAY_UNSETTLED_SQL, MANUAL_UNTICKED_SQL, RECON_SCAN } from "./recon.ts";
import { issued, linkFor, stub } from "./test-gateway.ts";
import { call, one, rows, sessionFor } from "./test-helpers.ts";
import { putSwiftBank, putTax, todayIso } from "./test-invoice-types.ts";
import { type J, json, putBank, putCompany } from "./test-invoices.ts";
import { recordBody, recorded } from "./test-payments.ts";
import { addDoc, mkReportClient } from "./test-reports.ts";
import { jsonResponse, liveSession, piOf, stripeEventRow, stripeStub } from "./test-stripe.ts";

const owner = () => sessionFor("owner", { stepUp: true });
beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({});
  stub();
});
afterEach(() => {
  setStubTransport(null);
});

const activeOwners = async () =>
  (
    await rows<{ n: number }>(
      "SELECT count(*) AS n FROM staff_users WHERE role = 'owner' AND status = 'active'",
    )
  )[0]?.n;

// ---- AU1: a Stripe refund that succeeded, then came back -----------------------------------------------------------------------------------------------

let seq = 0;
/** A refund recorded as made outside (`succeeded`, with the gateway's id) of payment `paymentId`, by an Owner. */
async function outsideRefund(
  p: { id: string; client_id: string; currency: string },
  provider: "razorpay" | "stripe",
  amountMinor: number,
) {
  const o = await owner();
  const refundId = uuidv7();
  const ref = provider === "razorpay" ? `rfnd_AU1${Date.now()}${++seq}` : `re_AU1${Date.now()}${++seq}`;
  await env.DB.prepare(
    `INSERT INTO payment_refunds (id, payment_id, client_id, provider, origin, status, paid_to, reason_code, currency, amount_minor, provider_refund_id,
       requested_by, requested_at, settled_at, settled_on, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'outside', 'succeeded', 'original', 'duplicate', ?5, ?6, ?7, ?8, ?9, ?9, ?10, ?9)`,
  )
    .bind(refundId, p.id, p.client_id, provider, p.currency, amountMinor, ref, o.id, Date.now(), todayIso())
    .run();
  return { refundId, ref };
}

/** A confirmed Razorpay payment of ₹500 with nothing allocated (all credit), and a refund of ₹50 of it recorded as made outside. */
async function rzpRefunded() {
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
    .bind(ck, `plink_AU1${T}`, T + 1)
    .run();
  const id = uuidv7();
  const pi = `pay_AU1${T}`;
  await env.DB.prepare(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, fee_tax_minor, received_on, mode, reference_norm, recorded_at, provider_payment_id, checkout_id, refetched_at)
     VALUES (?1, ?2, 'payment', 'razorpay', 'pending_verification', 'INR', 50000, 0, 0, ?3, 'upi', ?4, ?5, ?4, ?6, ?5)`,
  )
    .bind(id, clientId, todayIso(), pi, T, ck)
    .run();
  await env.DB.prepare(
    "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
  )
    .bind(id, o.id, T + 5)
    .run();
  const r = await outsideRefund({ id, client_id: clientId, currency: "INR" }, "razorpay", 5_000);
  return { pi, paymentId: id, clientId, refundId: r.refundId, reId: r.ref };
}

/** A USD proforma paid by card (pending: Q1 A's `fx_rate_needed`), refunded in full outside the admin (L33's pending source). */
async function stripeRefunded() {
  stripeStub();
  const s = await liveSession({ type: "proforma" });
  await processEvent(env, await stripeEventRow(s.sessionId, s.checkoutId));
  const pi = piOf(s.sessionId);
  const payment = (await one<{ id: string; client_id: string; amount_minor: number }>(
    "SELECT id, client_id, amount_minor FROM payments WHERE provider = 'stripe' AND provider_payment_id = ?1",
    pi,
  )) as { id: string; client_id: string; amount_minor: number };
  const r = await outsideRefund({ ...payment, currency: "USD" }, "stripe", payment.amount_minor);
  return {
    pi,
    paymentId: payment.id,
    clientId: payment.client_id,
    refundId: r.refundId,
    reId: r.ref,
    amount: payment.amount_minor,
  };
}

const rzpRefundJson = (reId: string, pi: string, status: string, amount = 5_000) => ({
  id: reId,
  entity: "refund",
  amount,
  currency: "INR",
  payment_id: pi,
  status,
});
const rzpRefundEvent = async (r: { reId: string; pi: string }, type: string) => {
  const id = uuidv7();
  await env.DB.prepare(
    "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, facts) VALUES (?1, 'razorpay', ?2, ?3, ?4, 'received', ?5)",
  )
    .bind(
      id,
      `evt_${id.slice(-12)}`,
      type,
      Date.now(),
      JSON.stringify({
        event: type,
        object: "refund",
        refundId: r.reId,
        paymentId: r.pi,
        amountMinor: 5_000,
        currency: "INR",
      }),
    )
    .run();
  return id;
};

const refundJson = (reId: string, pi: string, status: string, amount: number) => ({
  id: reId,
  object: "refund",
  amount,
  currency: "usd",
  payment_intent: pi,
  status,
  ...(status === "failed" ? { failure_reason: "expired_or_canceled_card" } : {}),
  metadata: {},
});

const refundEvent = (r: { reId: string; pi: string; amount: number }, type: string, status: string) =>
  stripeEventRow("", "", type, {
    event: type,
    object: "refund",
    refundId: r.reId,
    paymentId: r.pi,
    amountMinor: r.amount,
    currency: "USD",
    status,
    livemode: 0,
  });

const freeOf = async (paymentId: string) =>
  (
    await one<{ free: number }>(
      `SELECT p.amount_minor - coalesce((SELECT sum(CASE a.kind WHEN 'allocate' THEN a.amount_minor ELSE -a.amount_minor END) FROM payment_allocations a WHERE a.payment_id = p.id), 0)
         - coalesce((SELECT sum(r.amount_minor) FROM payment_refunds r WHERE r.payment_id = p.id AND r.status <> 'failed'), 0) AS free FROM payments p WHERE p.id = ?1`,
      paymentId,
    )
  )?.free;

describe("AU1 (B0 1): a Stripe refund that failed after `succeeded`", () => {
  it("the event re-fetches first: still succeeded → settled quietly; failed → reversed once, credit back, one refund_reversed item and one bell per owner, the client's email asked for", async () => {
    const r = await rzpRefunded();
    let answer = rzpRefundJson(r.reId, r.pi, "processed");
    stub((path, method) =>
      method === "GET" && path === `/v1/refunds/${r.reId}` ? jsonResponse(200, answer) : null,
    );
    const before = await freeOf(r.paymentId);
    expect(before).toBe(45_000);
    // still made at Razorpay: nothing moves
    expect(await processEvent(env, await rzpRefundEvent(r, "refund.processed"))).toEqual({
      result: "processed",
    });
    expect(
      (await one<{ status: string }>("SELECT status FROM payment_refunds WHERE id = ?1", r.refundId))?.status,
    ).toBe("succeeded");
    // the bank returned it: reversed
    answer = rzpRefundJson(r.reId, r.pi, "failed");
    const ev = await rzpRefundEvent(r, "refund.failed");
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review", refundReversed: r.refundId });
    expect(
      await one(
        "SELECT status, failure_code, reversed_at IS NOT NULL AS reversed, settled_on IS NOT NULL AS kept FROM payment_refunds WHERE id = ?1",
        r.refundId,
      ),
    ).toEqual({ status: "failed", failure_code: "razorpay_failed", reversed: 1, kept: 1 });
    expect(await freeOf(r.paymentId)).toBe((before ?? 0) + 5_000);
    const items = await rows<{ id: string }>(
      "SELECT id FROM review_items WHERE payment_id = ?1 AND kind = 'refund_reversed'",
      r.paymentId,
    );
    expect(items).toHaveLength(1);
    expect(
      (
        await rows<{ n: number }>(
          "SELECT count(*) AS n FROM notifications WHERE entity_id = ?1",
          items[0]?.id,
        )
      )[0]?.n,
    ).toBe(await activeOwners());
    expect(await one("SELECT status, outcome FROM webhook_events WHERE id = ?1", ev)).toEqual({
      status: "needs_review",
      outcome: "refund_reversed",
    });
    // a later event of the same refund: nothing more (no second item, no second reversal)
    expect(await processEvent(env, await rzpRefundEvent(r, "refund.failed"))).toEqual({
      result: "processed",
    });
    expect(
      await rows(
        "SELECT id FROM review_items WHERE payment_id = ?1 AND kind = 'refund_reversed'",
        r.paymentId,
      ),
    ).toHaveLength(1);
  });

  it("Stripe's `requires_action` after success reverses it too; an answer that isn't this refund (another amount) moves nothing", async () => {
    const r = await stripeRefunded();
    let answer = refundJson(r.reId, r.pi, "requires_action", r.amount - 1);
    stripeStub((path, method) =>
      method === "GET" && path === `/v1/refunds/${r.reId}` ? jsonResponse(200, answer) : null,
    );
    expect(await processEvent(env, await refundEvent(r, "refund.updated", "pending"))).toEqual({
      result: "processed",
    });
    expect(
      (await one<{ status: string }>("SELECT status FROM payment_refunds WHERE id = ?1", r.refundId))?.status,
    ).toBe("succeeded");
    answer = refundJson(r.reId, r.pi, "requires_action", r.amount);
    expect(await processEvent(env, await refundEvent(r, "refund.updated", "pending"))).toEqual({
      result: "needs_review",
      refundReversed: r.refundId,
    });
    expect(await one("SELECT status, failure_code FROM payment_refunds WHERE id = ?1", r.refundId)).toEqual({
      status: "failed",
      failure_code: "stripe_requires_action",
    });
  });

  it("Razorpay unreachable during the re-fetch: retry, nothing written", async () => {
    const r = await rzpRefunded();
    stub((path, method) =>
      method === "GET" && path === `/v1/refunds/${r.reId}` ? jsonResponse(503, {}) : null,
    );
    expect(await processEvent(env, await rzpRefundEvent(r, "refund.failed"))).toEqual({
      result: "retry",
    });
    expect(
      (await one<{ status: string }>("SELECT status FROM payment_refunds WHERE id = ?1", r.refundId))?.status,
    ).toBe("succeeded");
  });
});

// ---- AU6: Razorpay, a payment partly refunded before we settle it ---------------------------------------------------------------------------------------

describe("AU6 (B1 M1): a Razorpay payment partly refunded before we first settle it", () => {
  it("the refund event first is not ours (no payment yet); then payment_link.paid: pending, a refunded_outside item with the refunded amount, no ledger move", async () => {
    const o = await owner();
    const doc = await issued(o);
    const link = await linkFor(o, doc);
    const linkId = link.linkId;
    const payRef = link.paymentId;
    const refunded = 10_000;
    // the simulator's own answers, with Razorpay's `amount_refunded` and `refund_status` added to the payment
    setStubTransport(async (input, init) => {
      const res = await stubFetch(input, init);
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname !== `/v1/payments/${payRef}`) return res;
      const body = (await res.json()) as Record<string, unknown>;
      return jsonResponse(200, { ...body, amount_refunded: refunded, refund_status: "partial" });
    });
    const ev = async (type: string, facts: Record<string, unknown>) => {
      const id = uuidv7();
      await env.DB.prepare(
        "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, facts) VALUES (?1, 'razorpay', ?2, ?3, ?4, 'received', ?5)",
      )
        .bind(id, `evt_${id.slice(-12)}`, type, Date.now(), JSON.stringify({ event: type, ...facts }))
        .run();
      return id;
    };
    const first = await ev("refund.processed", {
      object: "refund",
      refundId: `rfnd_AU6${Date.now()}`,
      paymentId: payRef,
      amountMinor: refunded,
      currency: "INR",
    });
    expect(await processEvent(env, first)).toEqual({ result: "ignored" });
    const paid = await ev("payment_link.paid", { linkId, paymentId: payRef });
    expect(await processEvent(env, paid)).toEqual({ result: "needs_review" });
    const p = await one<{ id: string; status: string; amount_minor: number }>(
      "SELECT id, status, amount_minor FROM payments WHERE provider = 'razorpay' AND provider_payment_id = ?1",
      payRef,
    );
    expect(p).toMatchObject({ status: "pending_verification", amount_minor: doc.total });
    expect(
      await one<{ refunded: number }>(
        "SELECT json_extract(facts, '$.refundedMinor') AS refunded FROM review_items WHERE payment_id = ?1 AND kind = 'refunded_outside'",
        p?.id,
      ),
    ).toEqual({ refunded });
    expect(
      (await one<{ balance_minor: number }>("SELECT balance_minor FROM documents WHERE id = ?1", doc.id))
        ?.balance_minor,
    ).toBe(doc.total);
    expect(await rows("SELECT id FROM payment_allocations WHERE payment_id = ?1", p?.id)).toEqual([]);
  });
});

// ---- AU4, AU16: the withdraw refused while linked; the payment's flags ---------------------------------------------------------------------------------

describe("AU4 and AU16 (B0 9, B2 4): withdraw and the payment's flags", () => {
  it("an active bank tick: GET says bankTicked, the withdraw is 409 payment_linked and nothing changes; after the tick is removed it goes through", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await recorded(o, recordBody(clientId, 5_000));
    const tickId = uuidv7();
    const tick = await call("/reconciliation/bank-matches", {
      cookie: o.cookie,
      body: { id: tickId, target: { kind: "payment", id: p.id }, statementOn: todayIso() },
    });
    expect(tick.status).toBe(200);
    const view = (await json(await call(`/payments/${p.id}`, { cookie: o.cookie }))) as J;
    expect(view).toMatchObject({ hasLiveRefund: false, bankTicked: true });
    const w = await call(`/payments/${p.id}/withdraw`, {
      cookie: o.cookie,
      body: { reason: "entered twice" },
    });
    expect(w.status).toBe(409);
    expect(((await json(w)) as J).error).toMatchObject({ code: "payment_linked" });
    expect((await one<{ status: string }>("SELECT status FROM payments WHERE id = ?1", p.id))?.status).toBe(
      "confirmed",
    );
    expect(
      (
        await call(`/reconciliation/bank-matches/${tickId}/remove`, {
          cookie: o.cookie,
          body: { reason: "wrong line" },
        })
      ).status,
    ).toBe(200);
    const again = await call(`/payments/${p.id}/withdraw`, {
      cookie: o.cookie,
      body: { reason: "entered twice" },
    });
    expect(again.status, await again.clone().text()).toBe(200);
  });
});

// ---- AU3, AU5: idempotent ticks and reductions, and the failure paths ---------------------------------------------------------------------------------

describe("AU3 and AU5 (B0 6, 10): the same tick twice; failure paths", () => {
  it("the same tick sent twice answers 200 both times with one row; the same id with another target is 409 match_exists; a second tick of the payment is 409", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await recorded(o, recordBody(clientId, 5_000));
    const other = await recorded(o, recordBody(clientId, 6_000));
    const body = {
      id: uuidv7(),
      target: { kind: "payment", id: p.id },
      statementOn: todayIso(),
      statementRef: "ST/AU3",
    };
    expect((await call("/reconciliation/bank-matches", { cookie: o.cookie, body })).status).toBe(200);
    expect((await call("/reconciliation/bank-matches", { cookie: o.cookie, body })).status).toBe(200);
    expect(await rows("SELECT id FROM bank_matches WHERE id = ?1", body.id)).toHaveLength(1);
    const clash = await call("/reconciliation/bank-matches", {
      cookie: o.cookie,
      body: { ...body, target: { kind: "payment", id: other.id } },
    });
    expect(clash.status).toBe(409);
    expect(((await json(clash)) as J).error).toMatchObject({ code: "match_exists" });
    const second = await call("/reconciliation/bank-matches", {
      cookie: o.cookie,
      body: { ...body, id: uuidv7() },
    });
    expect(second.status).toBe(409);
    expect(((await json(second)) as J).error).toMatchObject({ code: "match_exists" });
  });

  it("cancel: a refund that already went out is 409 not_cancellable; an unknown one 404", async () => {
    const r = await stripeRefunded();
    const o = await owner();
    const res = await call(`/refunds/${r.refundId}/cancel`, { cookie: o.cookie, body: {} });
    expect(res.status).toBe(409);
    expect(((await json(res)) as J).error).toMatchObject({ code: "not_cancellable" });
    expect((await call(`/refunds/${uuidv7()}/cancel`, { cookie: o.cookie, body: {} })).status).toBe(404);
  });

  it("a reduction on an invoice that isn't an export invoice is 404; above what is left of the total is 409 reduction_refused; the same reduction twice is 200 then 200", async () => {
    const o = await owner();
    const usd = await mkReportClient("USD");
    const exp = await addDoc({ clientId: usd, currency: "USD", issueDate: todayIso() });
    const body = {
      id: uuidv7(),
      amountMinor: 1_000,
      approvedOn: todayIso(),
      bankRef: "ADB/AU5",
      declaration: false,
    };
    const first = await call(`/invoices/${exp.id}/realisation-reductions`, { cookie: o.cookie, body });
    expect(first.status, await first.clone().text()).toBe(200);
    const inr = await addDoc({ clientId: await mkReportClient("INR"), issueDate: todayIso() });
    expect(
      (
        await call(`/invoices/${inr.id}/realisation-reductions`, {
          cookie: o.cookie,
          body: { ...body, id: uuidv7() },
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(`/invoices/${exp.id}/realisation-reductions`, { cookie: o.cookie, body })).status,
    ).toBe(200);
    expect(await rows("SELECT id FROM realisation_reductions WHERE id = ?1", body.id)).toHaveLength(1);
    const over = await call(`/invoices/${exp.id}/realisation-reductions`, {
      cookie: o.cookie,
      body: { ...body, id: uuidv7(), amountMinor: 999_999_999 },
    });
    expect(over.status).toBe(409);
    expect(((await json(over)) as J).error).toMatchObject({ code: "reduction_refused" });
    const changed = await call(`/invoices/${exp.id}/realisation-reductions`, {
      cookie: o.cookie,
      body: { ...body, bankRef: "ADB/OTHER" },
    });
    expect(changed.status).toBe(409);
    expect(((await json(changed)) as J).error).toMatchObject({ code: "reduction_exists" });
  });
});

describe("AU5 (B0 10): cancel finds the refund at the gateway", () => {
  it("a requested refund the gateway already holds (its answer was lost): the row follows the gateway, 409 refund_found", async () => {
    const r = await rzpRefunded();
    const o = await owner();
    const id = uuidv7();
    // a requested Razorpay refund of ₹10 from credit, made well before the idle period
    await env.DB.prepare(
      `INSERT INTO payment_refunds (id, payment_id, client_id, provider, origin, status, paid_to, reason_code, currency, amount_minor, requested_by, requested_at, updated_at)
       VALUES (?1, ?2, ?3, 'razorpay', 'owner', 'requested', 'original', 'overpayment', 'INR', 1000, ?4, ?5, ?5)`,
    )
      .bind(id, r.paymentId, r.clientId, o.id, Date.now() - 60 * 60_000)
      .run();
    stub((path, method) =>
      method === "GET" && path === `/v1/payments/${r.pi}/refunds`
        ? jsonResponse(200, {
            entity: "collection",
            count: 1,
            items: [{ ...rzpRefundJson(`rfnd_AU5${Date.now()}`, r.pi, "processed", 1_000), receipt: id }],
          })
        : null,
    );
    const res = await call(`/refunds/${id}/cancel`, { cookie: o.cookie, body: {} });
    expect(res.status).toBe(409);
    expect(((await json(res)) as J).error).toMatchObject({ code: "refund_found" });
    expect(
      (await one<{ status: string }>("SELECT status FROM payment_refunds WHERE id = ?1", id))?.status,
    ).toBe("succeeded");
  });
});

describe("AU3 (B0 7): a receipt that can't be numbered", () => {
  it("a full series: not_eligible series_full, counted; after three tries the payment is left out of the sweep with one owners' bell", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await recorded(o, recordBody(clientId, 7_000));
    const fy = issueFyOf(Date.now());
    const full = maxNumber(defaultFormat("receipt")) + 1;
    // (counters only move forward: this file's later tests issue no receipt)
    await env.DB.prepare(
      "INSERT INTO doc_counters (series, fy, next_no) VALUES ('receipt', ?1, ?2) ON CONFLICT (series, fy) DO UPDATE SET next_no = max(next_no, ?2)",
    )
      .bind(fy, full)
      .run();
    for (let i = 0; i < 3; i++)
      expect(await issueReceipt(env, p.id as string, Date.now() + i)).toEqual({
        result: "not_eligible",
        why: "series_full",
      });
    expect(
      await one("SELECT receipt_failures, receipt_fail_reason FROM payments WHERE id = ?1", p.id),
    ).toEqual({ receipt_failures: 3, receipt_fail_reason: "series_full" });
    const due = (
      await rows<{ id: string }>(
        RECEIPTS_DUE_SQL.replace("LIMIT 20", "LIMIT 100000"),
        Number.MAX_SAFE_INTEGER,
      )
    ).map((x) => x.id);
    expect(due).not.toContain(p.id);
    expect(
      (
        await rows<{ n: number; t: string }>(
          "SELECT count(*) AS n, max(title) AS t FROM notifications WHERE kind = 'receipt.blocked' AND entity_id = ?1",
          p.id,
        )
      )[0],
    ).toEqual({ n: await activeOwners(), t: RECEIPT_SERIES_FULL_BELL });
  });
});

// ---- AU7 L2, L3: the gateway clients' guards ----------------------------------------------------------------------------------------------------------

describe("AU7 L2 and L3 (B1): a redirect is never followed with our key; an answer over the cap is a bad answer", () => {
  it("a 3xx from Razorpay is bad_answer, and the call asked not to follow it", async () => {
    let seen: string | undefined;
    const fake = async (input: RequestInfo | URL, init?: RequestInit) => {
      seen = new Request(input, init).redirect;
      return new Response(null, { status: 302, headers: { Location: "https://elsewhere.example.test/" } });
    };
    const api = razorpayApi({
      keyId: "rzp_test_AU7redirect",
      keySecret: "made-up-test-secret",
      settingsMode: "test",
      liveFlag: "false",
      fetch: fake as typeof fetch,
    });
    const r = await api.fetchPayment("pay_AU7");
    expect(r).toMatchObject({ ok: false, code: "bad_answer" });
    expect(seen).toBe("manual");
  });

  it("readJsonCapped: JSON under the cap is read; over it (declared or streamed) or not JSON is refused", async () => {
    expect(await readJsonCapped(new Response(JSON.stringify({ a: 1 })))).toEqual({
      ok: true,
      value: { a: 1 },
    });
    expect(await readJsonCapped(new Response("not json"))).toEqual({ ok: false });
    const big = JSON.stringify({ a: "x".repeat(GATEWAY_ANSWER_MAX_BYTES) });
    expect(await readJsonCapped(new Response(big))).toEqual({ ok: false });
    expect(
      await readJsonCapped(
        new Response("{}", { headers: { "content-length": String(GATEWAY_ANSWER_MAX_BYTES + 1) } }),
      ),
    ).toEqual({ ok: false });
  });
});

// ---- AU2: the recon lists' rows read --------------------------------------------------------------------------------------------------------------------

describe("AU2 (B0 2): the recon lists read one provider's range of payments_confirmed_provider", () => {
  it("at 2,000 and then 5,000 confirmed payments of other providers and none unsettled, each first page reads well under 9,000 rows", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    // confirmed bank payments, all ticked (none on the Unticked list), and confirmed Stripe-like rows are not needed: the bank rows alone are the other provider
    const seed = async (from: number, to: number) => {
      const seq = `WITH RECURSIVE n(i) AS (SELECT ${from} UNION ALL SELECT i + 1 FROM n WHERE i < ${to})`;
      await env.DB.prepare(
        `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at, verified_by, verified_at)
         ${seq} SELECT 'au2-pay-' || printf('%05d', i), ?1, 'payment', 'manual', 'confirmed', 'INR', 1000, date('2026-09-01', '+' || (i % 30) || ' days'),
           'neft', ?2, 1, ?2, 1 FROM n`,
      )
        .bind(clientId, o.id)
        .run();
      await env.DB.prepare(
        `INSERT INTO bank_matches (id, target_kind, payment_id, statement_on, matched_by, matched_at)
         ${seq} SELECT 'au2-bm-' || i, 'payment', 'au2-pay-' || printf('%05d', i), '2026-10-01', ?1, 2 FROM n`,
      )
        .bind(o.id)
        .run();
    };
    /** Every page of the manual list (the route's paging), the most rows one page read, and what it listed of this test's payments. */
    const pages = async () => {
      let most = 0;
      let n = 0;
      const ids: string[] = [];
      for (let k = "", id = ""; n < 100; ) {
        const r = await env.DB.prepare(MANUAL_UNTICKED_SQL)
          .bind(Number.MAX_SAFE_INTEGER, k, id)
          .all<CreditHeldScanRow>();
        n++;
        most = Math.max(most, r.meta.rows_read as number);
        const p = creditHeldPage(r.results, RECON_SCAN);
        ids.push(...p.items.map((x) => x.id).filter((x) => x.startsWith("au2-")));
        if (!p.next) break;
        k = p.next.k;
        id = p.next.id;
      }
      return { most, n, ids };
    };
    const gatewayRead = async () =>
      (await env.DB.prepare(GATEWAY_UNSETTLED_SQL).bind("9999-12-31", "", "").all()).meta.rows_read as number;
    await seed(1, 2_000);
    // two bank payments with no tick: on the list wherever their window falls
    await env.DB.prepare(
      "UPDATE bank_matches SET removed_by = ?1, removed_at = 3, remove_reason = 'test' WHERE id IN ('au2-bm-7', 'au2-bm-1500')",
    )
      .bind(o.id)
      .run();
    const at2 = await pages();
    const g2 = await gatewayRead();
    await seed(2_001, 5_000);
    const at5 = await pages();
    const g5 = await gatewayRead();
    // the gateway list never reads the bank's payments: the same small read at both sizes
    expect(g5).toBe(g2);
    expect(g5).toBeLessThan(1_000);
    // the manual list: every page within the 9,000-row target at both sizes (unbounded it read 10,000 at 5,000), and exactly the two unticked payments
    expect(at2.most).toBeLessThanOrEqual(9_000);
    expect(at5.most).toBeLessThanOrEqual(9_000);
    expect(at2.ids.sort()).toEqual(["au2-pay-00007", "au2-pay-01500"]);
    expect(at5.ids.sort()).toEqual(["au2-pay-00007", "au2-pay-01500"]);
    expect(at5.n).toBeGreaterThan(1);
    // the route: the window's own columns never leave it, and a full window hands on a cursor
    const page = (await json(await call("/reconciliation/unmatched?tab=manual", { cookie: o.cookie }))) as {
      items: J[];
      next: string | null;
    };
    for (const it of page.items) expect(Object.keys(it)).not.toContain("scan_on");
    expect(page.next).not.toBeNull();
    const plan = (
      await env.DB.prepare(`EXPLAIN QUERY PLAN ${GATEWAY_UNSETTLED_SQL}`)
        .bind("9999-12-31", "", "")
        .all<{ detail: string }>()
    ).results
      .map((r) => r.detail)
      .join(" | ");
    expect(plan).toContain("payments_confirmed_provider");
  });
});
