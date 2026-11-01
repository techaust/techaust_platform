// M6.3 fix round after early check 2, finding 1 [ADM-PAY-01, -03, -06, -07, ADM-INV-10, -17, POR-06; run file "Early check 2"]: the paths B2 built without a test.
//   (a) a Razorpay proforma waiting for its automatic tax invoice takes no second link (409 `payment_processing`), staff or portal;
//   (b) a Stripe proforma's pending payment never reaches the automatic path: not the sweep's `STUCK_ADVANCES_SQL`, not `EVENT_ADVANCE_WAITING_SQL`, never a
//       duplicate `next`, and "Try again" on its `advance_blocked` item is 409 `not_retryable` (Q1 A: only the Owner issues it, with the day's rate);
//   (c) Stripe's "Cancel" (expire first; a refusal settled by the session's real state), Stripe's "Try again", `GET /payments?proof=awaited` through the route,
//       and the Stripe words of the verify-reject and withdraw refusals;
//   (d) the worst paths' D1 statement counts (≤ 45 per invocation): a refused confirm falling back to pending `document_not_payable`, the proforma's fallback,
//       and `createLink` whose expire Stripe refuses because the session was paid meanwhile.
// Neither gateway is ever called: the stub transport answers. All names and amounts are invented test data.
import { env } from "cloudflare:workers";
import { stripePaymentRowId, stripeReferenceNorm } from "@techaust/core/stripe";
import {
  checkoutEndStatement,
  EVENT_ADVANCE_WAITING_SQL,
  recordGatewayPaymentStatements,
  STUCK_ADVANCES_SQL,
} from "@techaust/db/gateway";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueGatewayAdvance } from "./gateway/advance.ts";
import { setStubTransport } from "./gateway/config.ts";
import { processEvent } from "./gateway/events.ts";
import { createLinkFor, refreshCheckoutById } from "./gateway/links.ts";
import {
  NOT_RETRYABLE,
  PAYMENT_PROCESSING,
  STRIPE_GATEWAY_ERROR,
  STRIPE_GATEWAY_PAYMENT,
  STRIPE_REFUND_NEEDED,
} from "./gateway/messages.ts";
import {
  calls,
  countingEnv,
  eventRow,
  issued,
  linkFor,
  owner,
  paymentOf,
  type Session,
  staffLink,
  stub,
} from "./test-gateway.ts";
import { call, one, rows } from "./test-helpers.ts";
import { currentFy, lutOf, mkProforma, putSwiftBank, putTax, todayIso } from "./test-invoice-types.ts";
import { issueInvoice, json, mkInvoiceClient, putBank, putCompany } from "./test-invoices.ts";
import { putDoc, recordBody, recorded } from "./test-payments.ts";
import { PDF_BYTES } from "./test-projects.ts";
import {
  checkoutOf,
  jsonResponse,
  liveSession,
  piOf,
  sessionAnswer,
  stripeCalls,
  stripeEventRow,
  stripeLink,
  stripePaymentOf,
  stripeStub,
  usdClient,
} from "./test-stripe.ts";

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
  stripeStub();
});
afterEach(() => setStubTransport(null));

const reviewKinds = async (column: string, id: string) =>
  (
    await rows<{ kind: string }>(
      `SELECT kind FROM review_items WHERE ${column} = ?1 ORDER BY created_at, id`,
      id,
    )
  ).map((r) => r.kind);
const balanceOf = async (id: string) =>
  (await one<{ balance_minor: number }>("SELECT balance_minor FROM documents WHERE id = ?1", id))
    ?.balance_minor;
const updatedAtOf = async (id: string) =>
  (await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?1", id))?.updated_at ?? 0;
/** The sweep's read a day from now: every payment it would hand to the automatic tax invoice. */
const stuckIds = async () =>
  (await rows<{ id: string }>(STUCK_ADVANCES_SQL, Date.now() + 86_400_000)).map((r) => r.id);

/** An issued USD proforma of an overseas client (USD 10,000) with a live Stripe session for its total. */
async function stripeProforma(o: Session) {
  const made = await mkProforma(o, { client: usdClient, price: 1_000_000 });
  const res = await issueInvoice(o, made.id);
  expect(res.status, await res.clone().text()).toBe(200);
  const total = (
    await one<{ total_minor: number }>("SELECT total_minor FROM documents WHERE id = ?1", made.id)
  )?.total_minor as number;
  const r = await stripeLink({ clientId: made.clientId, contactId: made.contactId }, made.id, total);
  if (!r.ok) throw new Error(`no link: ${JSON.stringify(r)}`);
  const sessionId = new URL(r.url).pathname.split("/").at(-1) as string;
  return {
    id: made.id,
    clientId: made.clientId,
    contactId: made.contactId,
    total,
    sessionId,
    checkoutId: r.checkoutId,
  };
}

/** A race for `countingEnv`: just before the first batch that writes a payment row, the session is ended (expired) under it. */
const endSessionBeforePaymentBatch = (checkoutId: string) => ({
  race: {
    when: (sqls: string[]) => sqls.some((q) => q.includes("INSERT INTO payments (")),
    act: async () => {
      const r = await checkoutEndStatement(env.DB, {
        id: checkoutId,
        status: "expired",
        now: Date.now(),
      }).run();
      expect(r.meta.changes).toBe(1);
    },
  },
});

describe("(a) Razorpay: a proforma waiting for its automatic tax invoice [M6.3 'What B2 must not forget' 3; POR-06]", () => {
  it("takes no second link while its payment waits: 409 payment_processing for staff and the portal; once issued, nothing is due", async () => {
    stub();
    const o = await owner();
    const pf = await issued(o, "proforma");
    const l = await linkFor(o, pf);
    const r = await processEvent(env, await eventRow(l.linkId, l.paymentId));
    expect(r).toMatchObject({ result: "processed", next: { kind: "gateway.advance" } });
    expect((await paymentOf(l.paymentId))?.status).toBe("pending_verification");
    stub();
    const res = await staffLink(o, pf.id, pf.total, await updatedAtOf(pf.id));
    expect(res.status, await res.clone().text()).toBe(409);
    expect((await json(res)).error).toMatchObject({
      code: "payment_processing",
      message: PAYMENT_PROCESSING.message,
    });
    expect(
      await createLinkFor(env, {
        provider: "razorpay",
        clientId: pf.clientId,
        contactId: pf.contactId,
        tokenHash: null,
        documentId: pf.id,
        amountMinor: pf.total,
        returnTo: "invoice",
      }),
    ).toEqual({ ok: false, error: "payment_processing" });
    // no new link was asked of Razorpay
    expect(calls.filter((x) => x.method === "POST")).toEqual([]);
    // the automatic tax invoice issues; the proforma then takes no link at all (converted, nothing due), never "processing"
    expect((await issueGatewayAdvance(env, r.next?.paymentId as string)).result).toBe("issued");
    const after = await staffLink(o, pf.id, pf.total, await updatedAtOf(pf.id));
    expect(after.status).toBe(409);
    expect((await json(after)).error.code).toBe("not_payable_online");
  });
});

describe("(b) a Stripe proforma's pending payment never takes the automatic path [Q1 A, ADM-INV-10; 08-C RA-21]", () => {
  it("not in the sweep, no next on a redelivery or a replay, no open link to refresh, and Try again on its item is 409 not_retryable", async () => {
    const o = await owner();
    const pf = await stripeProforma(o);
    const ev = await stripeEventRow(pf.sessionId, pf.checkoutId);
    expect(await processEvent(env, ev)).toEqual({ result: "processed" });
    const p = await stripePaymentOf(piOf(pf.sessionId));
    expect(p?.status).toBe("pending_verification");
    // a redelivery of the same event, and a replay under a new event id: duplicate, and never a `next`
    expect(await processEvent(env, ev)).toEqual({ result: "duplicate" });
    expect(await processEvent(env, await stripeEventRow(pf.sessionId, pf.checkoutId))).toEqual({
      result: "duplicate",
    });
    expect(await one(EVENT_ADVANCE_WAITING_SQL, ev)).toBeNull();
    // the hourly sweep never lists it, however long it waits
    expect(await stuckIds()).not.toContain(p?.id);
    // its session is paid: nothing to refresh
    expect(await refreshCheckoutById(env, pf.checkoutId)).toEqual({ result: "no_open_link" });
    // "Try again" on its fx_rate_needed item: only the Owner's own issue with the day's rate settles it
    const item = await one<{ id: string }>(
      "SELECT id FROM review_items WHERE payment_id = ?1 AND kind = 'advance_blocked'",
      p?.id,
    );
    const retry = await call(`/payments/review/${item?.id}/retry`, { cookie: o.cookie, body: {} });
    expect(retry.status).toBe(409);
    expect((await json(retry)).error).toMatchObject({
      code: "not_retryable",
      message: NOT_RETRYABLE.message,
    });
    expect(await rows("SELECT id FROM documents WHERE parent_id = ?1", pf.id)).toEqual([]);
    expect((await stripePaymentOf(piOf(pf.sessionId)))?.status).toBe("pending_verification");
  });

  it("the provider guard on its own: a Stripe proforma payment written with no review item is still never 'waiting'", async () => {
    const o = await owner();
    const pf = await stripeProforma(o);
    const pi = piOf(pf.sessionId);
    const id = stripePaymentRowId(pi);
    const now = Date.now();
    const st = recordGatewayPaymentStatements(env.DB, {
      provider: "stripe",
      providerPaymentId: pi,
      paymentId: id,
      checkoutId: pf.checkoutId,
      clientId: pf.clientId,
      documentId: pf.id,
      webhookEventId: null,
      source: "refresh",
      status: "pending_verification",
      amountMinor: pf.total,
      feeMinor: 0,
      feeTaxMinor: null,
      receivedOn: todayIso(),
      mode: "card",
      referenceNorm: (await stripeReferenceNorm(pi)) as string,
      inrReceivedMinor: null,
      gatewayFeeInrMinor: null,
      gatewayFeeTaxInrMinor: null,
      refetchedAt: now,
      now,
      allocate: null,
      requestedAllocations: [{ documentId: pf.id, amountMinor: pf.total }],
      checkoutPaid: true,
      staleOthers: false,
      event: null,
      bell: null,
    });
    await env.DB.batch([st.main, ...st.side, ...st.last]);
    expect(await one<{ status: string }>("SELECT status FROM payments WHERE id = ?1", id)).toEqual({
      status: "pending_verification",
    });
    expect(await reviewKinds("payment_id", id)).toEqual([]);
    expect(await stuckIds()).not.toContain(id);
    // an event about it, processed and then redelivered: duplicate both times, never a `next`
    const ev = await stripeEventRow(pf.sessionId, pf.checkoutId);
    expect(await processEvent(env, ev)).toEqual({ result: "duplicate" });
    expect(await processEvent(env, ev)).toEqual({ result: "duplicate" });
    expect(await one(EVENT_ADVANCE_WAITING_SQL, ev)).toBeNull();
  });
});

describe("(c) Stripe's Cancel, Try again, Proof awaited and refusal words [ADM-PAY-01, -06, -07, ADM-INV-17; L4, L6, L11]", () => {
  const cancel = (o: Session, documentId: string, checkoutId: string) =>
    call(`/invoices/${documentId}/payment-link/cancel`, { cookie: o.cookie, body: { checkoutId } });

  it("Cancel expires the session at Stripe first, then the row is cancelled", async () => {
    const o = await owner();
    const s = await liveSession();
    stripeStub();
    const res = await cancel(o, s.documentId, s.checkoutId);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await json(res)).toEqual({ ok: true, status: "cancelled" });
    expect(stripeCalls.map((x) => `${x.method} ${x.path}`)).toEqual([
      `POST /v1/checkout/sessions/${s.sessionId}/expire`,
    ]);
    expect((await checkoutOf(s.sessionId))?.status).toBe("cancelled");
    // a second cancel: the row is no longer live
    const again = await cancel(o, s.documentId, s.checkoutId);
    expect(again.status).toBe(409);
    expect((await json(again)).error.code).toBe("link_not_live");
  });

  it("Stripe refusing the expire is settled by the session's real state: paid (409, the payment confirmed), expired (ended), still open or unreachable (502, row live)", async () => {
    const o = await owner();
    const refuse = (state: "complete" | "expired" | "open", sessionId: string) =>
      stripeStub((path, method) =>
        method === "POST" && path.endsWith("/expire")
          ? jsonResponse(400, { error: { type: "invalid_request_error" } })
          : method === "GET" && path === `/v1/checkout/sessions/${sessionId}`
            ? sessionAnswer(sessionId, () => undefined, state)
            : null,
      );
    // paid at Stripe meanwhile
    const a = await liveSession();
    refuse("complete", a.sessionId);
    const paid = await cancel(o, a.documentId, a.checkoutId);
    expect(paid.status).toBe(409);
    expect((await json(paid)).error.code).toBe("link_not_live");
    expect((await stripePaymentOf(piOf(a.sessionId)))?.status).toBe("confirmed");
    expect((await checkoutOf(a.sessionId))?.status).toBe("paid");
    expect(await balanceOf(a.documentId)).toBe(0);
    // already expired at Stripe: ended on Stripe's word, the member's act audited too
    const b = await liveSession();
    refuse("expired", b.sessionId);
    const ended = await cancel(o, b.documentId, b.checkoutId);
    expect(ended.status, await ended.clone().text()).toBe(200);
    expect(await json(ended)).toEqual({ ok: true, status: "ended" });
    expect((await checkoutOf(b.sessionId))?.status).toBe("expired");
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'payment.link_cancel' AND entity_id = ?1",
      b.checkoutId,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({ endedAtStripe: true });
    // refused while Stripe still holds it open: 502 in Stripe's words, the row stays live
    const c = await liveSession();
    refuse("open", c.sessionId);
    const open = await cancel(o, c.documentId, c.checkoutId);
    expect(open.status).toBe(502);
    expect((await json(open)).error).toEqual({
      code: "gateway_error",
      message: STRIPE_GATEWAY_ERROR.message,
    });
    expect((await checkoutOf(c.sessionId))?.status).toBe("live");
    // Stripe unreachable: 502, nothing moves
    stripeStub((path, method) =>
      method === "POST" && path.endsWith("/expire") ? jsonResponse(503, {}) : null,
    );
    const down = await cancel(o, c.documentId, c.checkoutId);
    expect(down.status).toBe(502);
    expect((await json(down)).error.message).toBe(STRIPE_GATEWAY_ERROR.message);
    expect((await checkoutOf(c.sessionId))?.status).toBe("live");
    expect(await stripePaymentOf(piOf(c.sessionId))).toBeNull();
  });

  it("Try again on a Stripe item: re-fetched through the settle (Stripe down: 502 in its words; then confirmed and resolved); no checkout of ours: not_retryable", async () => {
    const o = await owner();
    const s = await liveSession();
    stripeStub((_p, method) => (method === "GET" ? jsonResponse(403, { error: {} }) : null));
    const ev = await stripeEventRow(s.sessionId, s.checkoutId);
    expect(await processEvent(env, ev)).toEqual({ result: "needs_review" });
    const item = await one<{ id: string; kind: string }>(
      "SELECT id, kind FROM review_items WHERE webhook_event_id = ?1",
      ev,
    );
    expect(item?.kind).toBe("refetch_failed");
    const path = `/payments/review/${item?.id}/retry`;
    stripeStub((_p, method) => (method === "GET" ? jsonResponse(503, {}) : null));
    const down = await call(path, { cookie: o.cookie, body: {} });
    expect(down.status).toBe(502);
    expect((await json(down)).error).toEqual({
      code: "gateway_error",
      message: STRIPE_GATEWAY_ERROR.message,
    });
    expect(await stripePaymentOf(piOf(s.sessionId))).toBeNull();
    stripeStub();
    const ok = await call(path, { cookie: o.cookie, body: {} });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await json(ok)).toEqual({ ok: true, result: "processed" });
    expect((await stripePaymentOf(piOf(s.sessionId)))?.status).toBe("confirmed");
    expect(await balanceOf(s.documentId)).toBe(0);
    expect(
      await one<{ status: string; resolution: string }>(
        "SELECT status, resolution FROM review_items WHERE id = ?1",
        item?.id,
      ),
    ).toEqual({ status: "resolved", resolution: "confirmed" });
    // a paid event for a session we never stored: unknown_link; Try again has nothing of ours to re-fetch against (L5)
    const forged = `cs_test_forged${"G".repeat(40)}`;
    const fev = await stripeEventRow(forged, s.checkoutId);
    expect(await processEvent(env, fev)).toEqual({ result: "needs_review" });
    const unknown = await one<{ id: string }>("SELECT id FROM review_items WHERE webhook_event_id = ?1", fev);
    stripeStub();
    const refused = await call(`/payments/review/${unknown?.id}/retry`, { cookie: o.cookie, body: {} });
    expect(refused.status).toBe(409);
    expect((await json(refused)).error.code).toBe("not_retryable");
    expect(stripeCalls).toEqual([]);
  });

  it("GET /payments?proof=awaited lists card payments with no proof (pending or confirmed), never a manual one; a proof takes it off", async () => {
    const o = await owner();
    const s = await liveSession();
    await processEvent(env, await stripeEventRow(s.sessionId, s.checkoutId));
    const confirmed = await stripePaymentOf(piOf(s.sessionId));
    expect(confirmed?.status).toBe("confirmed");
    // a pending one (an India-issued card, 08-C RA-38)
    const t = await liveSession();
    stripeStub((path, method) =>
      method === "GET" && path === `/v1/checkout/sessions/${t.sessionId}`
        ? sessionAnswer(t.sessionId, (x) => {
            x.payment_intent.latest_charge.payment_method_details.card.country = "IN";
          })
        : null,
    );
    await processEvent(env, await stripeEventRow(t.sessionId, t.checkoutId));
    const pending = await stripePaymentOf(piOf(t.sessionId));
    expect(pending?.status).toBe("pending_verification");
    // a manual payment of another client
    const d = await mkInvoiceClient();
    const manual = await recorded(o, recordBody(d.clientId, 1_000));
    const list = async () => {
      const res = await call("/payments?proof=awaited", { cookie: o.cookie });
      expect(res.status, await res.clone().text()).toBe(200);
      return ((await json(res)).payments as { id: string; provider: string }[]).map((x) => x.id);
    };
    const ids = await list();
    expect(ids).toContain(confirmed?.id);
    expect(ids).toContain(pending?.id);
    expect(ids).not.toContain(manual.id);
    // an unknown filter value is refused
    expect((await call("/payments?proof=attached", { cookie: o.cookie })).status).toBe(400);
    // Stripe's payment advice attached: off the list
    const put = await putDoc(`/payments/${confirmed?.id}/proof`, PDF_BYTES, {
      cookie: o.cookie,
      headers: { "X-Proof-Kind": "Stripe payment advice" },
    });
    expect(put.ok, await put.clone().text()).toBe(true);
    const after = await list();
    expect(after).not.toContain(confirmed?.id);
    expect(after).toContain(pending?.id);
  });

  it("a Stripe payment is never rejected or withdrawn here, in Stripe's words", async () => {
    const o = await owner();
    // pending (an amount that doesn't match): reject refused
    const s = await liveSession();
    stripeStub((path, method) =>
      method === "GET" && path === `/v1/checkout/sessions/${s.sessionId}`
        ? sessionAnswer(s.sessionId, (x) => {
            x.amount_total = 49_000;
            x.payment_intent.amount_received = 49_000;
          })
        : null,
    );
    await processEvent(env, await stripeEventRow(s.sessionId, s.checkoutId));
    const pending = await stripePaymentOf(piOf(s.sessionId));
    const rec = await one<{ recorded_at: number }>(
      "SELECT recorded_at FROM payments WHERE id = ?1",
      pending?.id,
    );
    const rej = await call(`/payments/${pending?.id}/verify`, {
      cookie: o.cookie,
      body: { decision: "reject", note: "Not ours", expectedRecordedAt: rec?.recorded_at },
    });
    expect(rej.status).toBe(409);
    expect((await json(rej)).error).toEqual(STRIPE_REFUND_NEEDED);
    expect((await stripePaymentOf(piOf(s.sessionId)))?.status).toBe("pending_verification");
    // confirmed: withdraw refused
    stripeStub();
    const t = await liveSession();
    await processEvent(env, await stripeEventRow(t.sessionId, t.checkoutId));
    const confirmed = await stripePaymentOf(piOf(t.sessionId));
    expect(confirmed?.status).toBe("confirmed");
    const w = await call(`/payments/${confirmed?.id}/withdraw`, {
      cookie: o.cookie,
      body: { reason: "Entered in error" },
    });
    expect(w.status).toBe(409);
    expect((await json(w)).error).toEqual(STRIPE_GATEWAY_PAYMENT);
    expect((await stripePaymentOf(piOf(t.sessionId)))?.status).toBe("confirmed");
  });
});

describe("(d) the worst paths stay within 45 D1 statements [Free plan; run file J]", () => {
  it("a confirm refused under a race falls back to pending document_not_payable, in one invocation", async () => {
    const s = await liveSession();
    const ev = await stripeEventRow(s.sessionId, s.checkoutId);
    const { env: e, counter } = countingEnv(endSessionBeforePaymentBatch(s.checkoutId));
    expect(await processEvent(e, ev)).toEqual({ result: "needs_review" });
    console.log(`D1 statements, Stripe processEvent (refused confirm, pending fallback): ${counter.n}`);
    expect(counter.n).toBeLessThanOrEqual(45);
    expect((await stripePaymentOf(piOf(s.sessionId)))?.status).toBe("pending_verification");
    expect(await reviewKinds("webhook_event_id", ev)).toEqual(["document_not_payable"]);
    expect(await balanceOf(s.documentId)).toBe(50_000);
  });

  it("the proforma's pending batch refused under a race falls back to pending document_not_payable (link_not_live)", async () => {
    const o = await owner();
    const pf = await stripeProforma(o);
    const ev = await stripeEventRow(pf.sessionId, pf.checkoutId);
    const { env: e, counter } = countingEnv(endSessionBeforePaymentBatch(pf.checkoutId));
    expect(await processEvent(e, ev)).toEqual({ result: "needs_review" });
    console.log(`D1 statements, Stripe processEvent (proforma fallback): ${counter.n}`);
    expect(counter.n).toBeLessThanOrEqual(45);
    const p = await stripePaymentOf(piOf(pf.sessionId));
    expect(p).toMatchObject({ status: "pending_verification", requested_allocations: null });
    const item = await one<{ kind: string; facts: string }>(
      "SELECT kind, facts FROM review_items WHERE webhook_event_id = ?1",
      ev,
    );
    expect(item?.kind).toBe("document_not_payable");
    expect(JSON.parse(item?.facts ?? "{}")).toMatchObject({ reason: "link_not_live" });
    expect(await rows("SELECT id FROM documents WHERE parent_id = ?1", pf.id)).toEqual([]);
  });

  it("createLink whose expire Stripe refuses because the session was paid: settled (confirmed) inside the call", async () => {
    const s = await liveSession();
    stripeStub((path, method) =>
      method === "POST" && path.endsWith("/expire")
        ? jsonResponse(400, { error: { type: "invalid_request_error" } })
        : null,
    );
    const { env: e, counter } = countingEnv();
    expect(await stripeLink(s, s.documentId, 20_000, e)).toEqual({ ok: false, error: "payment_processing" });
    console.log(`D1 statements, Stripe createLink (refused expire, settled): ${counter.n}`);
    expect(counter.n).toBeLessThanOrEqual(45);
    expect((await stripePaymentOf(piOf(s.sessionId)))?.status).toBe("confirmed");
  });
});
