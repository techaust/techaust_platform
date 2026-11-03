// M6.5 refunds, receipts and reconciliation through the finance and invoices Workers [ADM-PAY-08, -09, -10, -11, ADM-INV-09; run file C, I, L1, L8, L10, L33,
// L36, L37]: who may refund; a manual refund from credit; the gateway's word (processed, a 4xx refusal, no answer then found by our id), the live guard with zero
// fetches; the credit note first (Q1 A); the withdraw refused with a live refund and the receipt voided; the receipt's issue (idempotent, never TDS); the refund
// events (ours moved, an outside one a review item); one settlement page. No test reaches a gateway: Razorpay answers from the stub. Invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { refundAttemptStatement } from "@techaust/db/refunds";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStubTransport } from "./gateway/config.ts";
import { processEvent } from "./gateway/events.ts";
import { issueReceipt } from "./receipt-issue.ts";
import { fetchSettlements } from "./recon.ts";
import { checkRefund } from "./refund-flow.ts";
import { mkClient, mkContact } from "./test-clients.ts";
import { calls, stub } from "./test-gateway.ts";
import { call, one, sessionFor } from "./test-helpers.ts";
import { todayIso } from "./test-invoice-types.ts";
import { type J, json, putCompany } from "./test-invoices.ts";
import { recordBody, recorded } from "./test-payments.ts";
import { addDoc, mkReportClient } from "./test-reports.ts";

const owner = () => sessionFor("owner", { stepUp: true });
beforeEach(async () => {
  await putCompany();
  stub();
});
afterEach(() => setStubTransport(null));

const manual = (amountMinor: number, o: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  amountMinor,
  from: "credit",
  reasonCode: "overpayment",
  manual: {
    mode: "neft",
    reference: `UTRM${Date.now().toString(36).toUpperCase()}`,
    paidOn: todayIso(),
    paidTo: "original",
  },
  ...o,
});
const gateway = (amountMinor: number) => ({
  id: uuidv7(),
  amountMinor,
  from: "credit",
  reasonCode: "overpayment",
});
const refundRow = (id: string) =>
  one<{
    status: string;
    failure_code: string | null;
    provider_refund_id: string | null;
    settled_on: string | null;
  }>("SELECT status, failure_code, provider_refund_id, settled_on FROM payment_refunds WHERE id = ?", id);
const creditOf = async (clientId: string, s: { cookie: string }) =>
  ((await json(await call(`/clients/${clientId}/credit`, { cookie: s.cookie }))) as J).credits as J[];

let seq = 0;
/** A confirmed Razorpay payment of `amount` paise with nothing allocated (all credit): the raw rows a settled online payment leaves. */
async function rzpPayment(
  clientId: string,
  ownerId: string,
  amount = 50_000,
): Promise<{ id: string; ref: string }> {
  const doc = await addDoc({ clientId, issueDate: "2026-10-05" });
  const staff = await sessionFor("staff");
  const T = Date.now() + ++seq;
  const ck = uuidv7();
  await env.DB.prepare(
    `INSERT INTO checkout_sessions (id, provider, document_id, client_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at)
     VALUES (?1, 'razorpay', ?2, ?3, ?4, 'staff', 'INR', ?5, 'creating', ?6, ?7, ?7)`,
  )
    .bind(ck, doc.id, clientId, staff.id, amount, T + 86_400_000, T)
    .run();
  await env.DB.prepare(
    "UPDATE checkout_sessions SET status = 'live', provider_link_id = ?2, short_url = 'https://rzp.io/i/x', updated_at = ?3 WHERE id = ?1",
  )
    .bind(ck, `plink_RF${T}`, T + 1)
    .run();
  const id = uuidv7();
  const ref = `pay_RF${T}`;
  await env.DB.prepare(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, fee_tax_minor, received_on, mode, reference_norm, recorded_at, provider_payment_id, checkout_id, refetched_at)
     VALUES (?1, ?2, 'payment', 'razorpay', 'pending_verification', 'INR', ?3, 0, 0, ?4, 'upi', ?5, ?6, ?5, ?7, ?6)`,
  )
    .bind(id, clientId, amount, todayIso(), ref, T, ck)
    .run();
  await env.DB.prepare(
    "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
  )
    .bind(id, ownerId, T + 5)
    .run();
  return { id, ref };
}
const rzpRefund = (id: string, amount: number, ours: string, paymentId: string, status = "processed") =>
  Response.json({
    id,
    entity: "refund",
    amount,
    currency: "INR",
    payment_id: paymentId,
    receipt: ours,
    status,
  });

describe("who may refund [ADM-PAY-08; docs/04 §9 Refunds]", () => {
  it("only the Owner with a fresh code; the Accountant reads; Staff can't read", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await recorded(o, recordBody(clientId, 2_000));
    for (const role of ["staff", "sales", "accountant"] as const) {
      const s = await sessionFor(role, { stepUp: true });
      expect(
        (await call(`/payments/${p.id}/refunds`, { cookie: s.cookie, body: manual(1_000) })).status,
        role,
      ).toBe(403);
    }
    const plain = await sessionFor("owner");
    const res = await call(`/payments/${p.id}/refunds`, { cookie: plain.cookie, body: manual(1_000) });
    expect(res.status).toBe(403);
    expect(((await json(res)) as J).error.code).toBe("step_up_required");
    expect(
      (await call(`/payments/${p.id}/refunds`, { cookie: (await sessionFor("accountant")).cookie })).status,
    ).toBe(200);
    expect(
      (await call(`/payments/${p.id}/refunds`, { cookie: (await sessionFor("staff")).cookie })).status,
    ).toBe(403);
  });
});

describe("a manual refund from credit [L1, L2, finding 9]", () => {
  it("up to the free money, settled on its paid-on day; above it 409 exceeds_refundable with what is left; a replay answers the same refund", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await recorded(o, recordBody(clientId, 2_000));
    const body = manual(1_500);
    const r = (await json(await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body }))) as J;
    expect(r.refund).toMatchObject({ status: "succeeded", amountMinor: 1_500, settledOn: todayIso() });
    expect(await creditOf(clientId, o)).toEqual([{ currency: "INR", creditMinor: 500 }]);
    const again = (await json(await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body }))) as J;
    expect(again.refund.id).toBe(body.id);
    const over = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: manual(501) });
    expect(over.status).toBe(409);
    expect(((await json(over)) as J).error).toMatchObject({
      code: "exceeds_refundable",
      details: { refundableMinor: 500 },
    });
    // a future paid-on day is refused before anything is written
    const future = manual(100, {
      manual: { mode: "neft", reference: "UTRFUTURE1", paidOn: "2999-01-01", paidTo: "original" },
    });
    expect((await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: future })).status).toBe(400);
  });

  it("from an invoice with no excess: 409 credit_note_needed with the excess; once credited, the refund releases exactly its amount", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const inv = await addDoc({ clientId, issueDate: "2026-10-05" });
    const total = inv.computed.totalMinor;
    const p = await recorded(o, recordBody(clientId, total, [{ documentId: inv.id, amountMinor: total }]));
    const body = manual(10_000, { from: "document", documentId: inv.id, reasonCode: "credit_note" });
    const first = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body });
    expect(first.status).toBe(409);
    expect(((await json(first)) as J).error).toMatchObject({
      code: "credit_note_needed",
      details: { excessMinor: 0 },
    });
    await env.DB.prepare(
      "UPDATE documents SET credited_minor = 10000, updated_at = updated_at + 1 WHERE id = ?",
    )
      .bind(inv.id)
      .run();
    const ok = (await json(
      await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: { ...body, id: uuidv7() } }),
    )) as J;
    expect(ok.refund.status).toBe("succeeded");
    expect(await one("SELECT paid_minor, balance_minor FROM documents WHERE id = ?", inv.id)).toEqual({
      paid_minor: total - 10_000,
      balance_minor: 0,
    });
  });
});

describe("through the gateway [C step 3, L8, L37, ADM-PAY-11]", () => {
  it("processed at once: succeeded with the gateway's id; one create call; the receipt id is our refund id", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await rzpPayment(clientId, o.id);
    const body = gateway(20_000);
    const r = (await json(await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body }))) as J;
    expect(r.refund.status).toBe("succeeded");
    expect(calls.filter((x) => x.method === "POST" && x.path.endsWith("/refund"))).toHaveLength(1);
    expect((await refundRow(body.id))?.provider_refund_id).toBe(`rfnd_A20000R${body.id.replaceAll("-", "")}`);
  });

  it("a 4xx refusal: failed with the code, 502 gateway_refused; the money stays as credit", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await rzpPayment(clientId, o.id);
    stub((path, method) =>
      method === "POST" && path.endsWith("/refund")
        ? Response.json({ error: { code: "BAD_REQUEST_ERROR" } }, { status: 400 })
        : null,
    );
    const body = gateway(20_000);
    const res = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body });
    expect(res.status).toBe(502);
    expect(((await json(res)) as J).error).toMatchObject({
      code: "gateway_refused",
      details: { code: "refused_400" },
    });
    expect(await refundRow(body.id)).toMatchObject({ status: "failed", failure_code: "refused_400" });
    expect(await creditOf(clientId, o)).toEqual(
      expect.arrayContaining([{ currency: "INR", creditMinor: 50_000 }]),
    );
  });

  it("no answer: 202 requested; the check finds it by our id (L37) and adopts it, with no second create", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await rzpPayment(clientId, o.id);
    stub((path, method) =>
      method === "POST" && path.endsWith("/refund") ? new Response("", { status: 503 }) : null,
    );
    const body = gateway(10_000);
    const res = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body });
    expect(res.status).toBe(202);
    expect((await refundRow(body.id))?.status).toBe("requested");
    stub((path) =>
      path.endsWith("/refunds")
        ? Response.json({
            entity: "collection",
            count: 1,
            items: [
              JSON.parse(
                JSON.stringify({
                  id: "rfnd_FOUND0001",
                  entity: "refund",
                  amount: 10_000,
                  currency: "INR",
                  payment_id: p.ref,
                  receipt: body.id,
                  status: "processed",
                }),
              ),
            ],
          })
        : null,
    );
    expect(await checkRefund(env, body.id)).toMatchObject({ result: "moved", status: "succeeded" });
    expect(calls.filter((x) => x.method === "POST")).toHaveLength(0);
    expect(await refundRow(body.id)).toMatchObject({
      status: "succeeded",
      provider_refund_id: "rfnd_FOUND0001",
    });
  });

  it("live mode in Settings with the flag false: 503 live_not_allowed, zero fetches, nothing written (review fix 3)", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await rzpPayment(clientId, o.id);
    const before = await one<{ value: string; version: number }>(
      "SELECT value, version FROM settings WHERE key = 'gateways'",
    );
    const value = JSON.parse(before?.value ?? "{}") as J;
    value.razorpay = { ...(value.razorpay ?? {}), mode: "live" };
    await env.DB.prepare(
      "INSERT INTO settings (key, value, version, updated_at) VALUES ('gateways', ?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = excluded.value, version = excluded.version",
    )
      .bind(JSON.stringify(value), (before?.version ?? 0) + 1000, Date.now())
      .run();
    try {
      calls.length = 0;
      const body = gateway(1_000);
      const res = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body });
      expect(res.status).toBe(503);
      expect(((await json(res)) as J).error.code).toBe("live_not_allowed");
      expect(calls).toHaveLength(0);
      expect(await refundRow(body.id)).toBeNull();
    } finally {
      if (before)
        await env.DB.prepare("UPDATE settings SET value = ?1, version = ?2 WHERE key = 'gateways'")
          .bind(before.value, before.version + 2000)
          .run();
      else await env.DB.prepare("DELETE FROM settings WHERE key = 'gateways'").run();
    }
  });
});

describe("the withdraw and the receipt [L3 to L5, L10]", () => {
  it("a receipt issues once (TH/RCT), never for TDS; a withdraw is refused while a refund stands, and voids the receipt otherwise", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await recorded(o, recordBody(clientId, 3_000));
    const first = await issueReceipt(env, p.id as string);
    expect(first.result).toBe("issued");
    expect(first.number).toMatch(/^TH\/RCT\/\d{4}\/\d{4}$/);
    expect(await issueReceipt(env, p.id as string)).toMatchObject({
      result: "already_issued",
      number: first.number,
    });
    expect(await one("SELECT receipt_document_id FROM payments WHERE id = ?", p.id)).toEqual({
      receipt_document_id: `rct_${p.id}`,
    });
    // a refund that stands blocks the withdraw
    await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: manual(1_000) });
    const refused = await call(`/payments/${p.id}/withdraw`, {
      cookie: o.cookie,
      body: { reason: "Entered twice" },
    });
    expect(refused.status).toBe(409);
    expect(((await json(refused)) as J).error.code).toBe("refunds_exist");
    // another payment with a receipt and no refund: the withdraw voids its receipt in the same batch
    const q = await recorded(o, recordBody(clientId, 2_000));
    await issueReceipt(env, q.id as string);
    expect(
      (await call(`/payments/${q.id}/withdraw`, { cookie: o.cookie, body: { reason: "Entered twice" } }))
        .status,
    ).toBe(200);
    expect(await one("SELECT status, void_reason FROM documents WHERE id = ?", `rct_${q.id}`)).toEqual({
      status: "void",
      void_reason: "payment_withdrawn",
    });
    // the receipt read on the finance Worker
    const read = (await json(await call(`/payments/${p.id}/receipt`, { cookie: o.cookie }))) as J;
    expect(read.receipt).toMatchObject({
      id: `rct_${p.id}`,
      number: first.number,
      status: "issued",
      hasPdf: false,
    });
  });
});

describe("refund events [L7, L36]", () => {
  it("Razorpay's refund.processed for our requested refund moves it; an unknown refund of our payment is a refunded_outside item with no ledger move", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await rzpPayment(clientId, o.id);
    stub((path, method) =>
      method === "POST" && path.endsWith("/refund") ? new Response("", { status: 503 }) : null,
    );
    const body = gateway(5_000);
    expect((await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body })).status).toBe(202);
    stub((path) =>
      path === "/v1/refunds/rfnd_EVT00001" ? rzpRefund("rfnd_EVT00001", 5_000, body.id, p.ref) : null,
    );
    const ev = async (facts: Record<string, unknown>) => {
      const id = uuidv7();
      await env.DB.prepare(
        "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, facts) VALUES (?1, 'razorpay', ?2, ?3, ?4, 'received', ?5)",
      )
        .bind(id, `evt_${id.slice(-12)}`, "refund.processed", Date.now(), JSON.stringify(facts))
        .run();
      return id;
    };
    const e1 = await ev({
      event: "refund.processed",
      object: "refund",
      refundId: "rfnd_EVT00001",
      paymentId: p.ref,
      amountMinor: 5_000,
      currency: "INR",
      ourRefundId: body.id,
    });
    expect(await processEvent(env, e1)).toEqual({ result: "processed" });
    expect(await refundRow(body.id)).toMatchObject({
      status: "succeeded",
      provider_refund_id: "rfnd_EVT00001",
    });
    const e2 = await ev({
      event: "refund.processed",
      object: "refund",
      refundId: "rfnd_DASH00001",
      paymentId: p.ref,
      amountMinor: 1_000,
      currency: "INR",
    });
    expect(await processEvent(env, e2)).toEqual({ result: "needs_review" });
    expect(await one("SELECT kind FROM review_items WHERE webhook_event_id = ?", e2)).toEqual({
      kind: "refunded_outside",
    });
    const e3 = await ev({
      event: "refund.processed",
      object: "refund",
      refundId: "rfnd_OTHER0001",
      paymentId: "pay_NOTOURS0001",
      amountMinor: 1_000,
      currency: "INR",
    });
    expect(await processEvent(env, e3)).toEqual({ result: "ignored" });
  });
});

describe("one settlement page [ADM-PAY-10, L11]", () => {
  it("stores the settlement once and matches our payment by its gateway id; an empty day is empty", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await rzpPayment(clientId, o.id, 12_000);
    const setl = `setl_T${Date.now()}`;
    stub((path) => {
      if (path === "/v1/settlements/recon/combined")
        return Response.json({
          count: 1,
          items: [
            {
              entity_id: p.ref,
              type: "payment",
              amount: 12_000,
              fee: 0,
              tax: 0,
              credit: 12_000,
              debit: 0,
              currency: "INR",
              settlement_id: setl,
              settled_at: 1_793_000_000,
            },
          ],
        });
      if (path === `/v1/settlements/${setl}`)
        return Response.json({
          id: setl,
          entity: "settlement",
          amount: 12_000,
          fees: 0,
          tax: 0,
          utr: "UTRSETL1",
          status: "processed",
          created_at: 1_793_000_000,
        });
      return null;
    });
    expect(await fetchSettlements(env, { provider: "razorpay", day: "2026-11-02", skip: 0 })).toEqual({
      result: "stored",
    });
    expect(await one('SELECT "match", payment_id FROM settlement_items WHERE entity_id = ?', p.ref)).toEqual({
      match: "matched",
      payment_id: p.id,
    });
    expect(await one("SELECT utr, amount_minor FROM settlements WHERE settlement_id = ?", setl)).toEqual({
      utr: "UTRSETL1",
      amount_minor: 12_000,
    });
    stub();
    expect(await fetchSettlements(env, { provider: "razorpay", day: "2026-11-03", skip: 0 })).toEqual({
      result: "empty",
    });
  });
});

describe("an anonymised client stays locked [L15]", () => {
  it("anonymising an individual's last contact while a refund to it is open is 409 refunds_pending, nothing written; a refund for an anonymised client is client_gone", async () => {
    const o = await owner();
    const clientId = await mkClient({ type: "individual" });
    const contactId = (await mkContact(clientId)).id;
    const p = await rzpPayment(clientId, o.id);
    stub((path, method) =>
      method === "POST" && path.endsWith("/refund") ? new Response("", { status: 503 }) : null,
    );
    expect((await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: gateway(1_000) })).status).toBe(
      202,
    );
    const res = await call(`/contacts/${contactId}/erase`, {
      cookie: o.cookie,
      body: { mode: "anonymise", reason: "requested" },
    });
    expect(res.status).toBe(409);
    expect(((await json(res)) as J).error.code).toBe("refunds_pending");
    expect(await one("SELECT anonymised_at FROM clients WHERE id = ?", clientId)).toEqual({
      anonymised_at: null,
    });
    // a client already anonymised takes no refund
    const other = await mkReportClient("INR");
    const q = await recorded(o, recordBody(other, 2_000));
    await env.DB.prepare("UPDATE clients SET anonymised_at = ?2 WHERE id = ?1").bind(other, Date.now()).run();
    const r = await call(`/payments/${q.id}/refunds`, { cookie: o.cookie, body: manual(100) });
    expect(r.status).toBe(409);
    // the app's existing code for an erased client (`CLIENT_GONE` in anonymised.ts), which the brief calls `client_gone`
    expect(((await json(r)) as J).error.code).toBe("client_anonymised");
  });
});

describe("B4: the refund views carry their times; the list by client [L44, L46; run file B4 items 1 and 2]", () => {
  it("GET /payments/:id/refunds and GET /refunds answer requestedAt and lastAttemptAt; ?clientId= lists one client's only, with or without a status", async () => {
    const o = await owner();
    const a = await mkReportClient("INR");
    const b = await mkReportClient("INR");
    const pa = await rzpPayment(a, o.id);
    const pb = await rzpPayment(b, o.id);
    stub((path, method) =>
      method === "POST" && path.endsWith("/refund") ? new Response("", { status: 503 }) : null,
    );
    const ra = gateway(1_000);
    const rb = gateway(2_000);
    expect((await call(`/payments/${pa.id}/refunds`, { cookie: o.cookie, body: ra })).status).toBe(202);
    expect((await call(`/payments/${pb.id}/refunds`, { cookie: o.cookie, body: rb })).status).toBe(202);
    const T = Date.now() + 60_000;
    await refundAttemptStatement(env.DB, { refundId: ra.id, now: T }).run();
    const ofPayment = (await json(await call(`/payments/${pa.id}/refunds`, { cookie: o.cookie }))) as J;
    expect(ofPayment.items[0]).toMatchObject({ id: ra.id, lastAttemptAt: T });
    expect(typeof ofPayment.items[0].requestedAt).toBe("number");
    const acc = await sessionFor("accountant");
    const byClient = (await json(await call(`/refunds?clientId=${a}`, { cookie: acc.cookie }))) as J;
    expect(byClient.items.map((r: J) => r.id)).toEqual([ra.id]);
    expect(byClient.items[0]).toMatchObject({ lastAttemptAt: T, clientId: a });
    expect(byClient.next).toBeNull();
    const open = (await json(
      await call(`/refunds?clientId=${a}&status=requested`, { cookie: acc.cookie }),
    )) as J;
    expect(open.items.map((r: J) => r.id)).toEqual([ra.id]);
    const none = (await json(
      await call(`/refunds?clientId=${a}&status=processing`, { cookie: acc.cookie }),
    )) as J;
    expect(none.items).toEqual([]);
    const all = (await json(await call("/refunds", { cookie: acc.cookie }))) as J;
    const theirs = all.items.find((r: J) => r.id === rb.id);
    expect(theirs).toMatchObject({ lastAttemptAt: null });
    expect(typeof theirs.requestedAt).toBe("number");
    // the same permission as the list: Staff can't read it
    expect(
      (await call(`/refunds?clientId=${a}`, { cookie: (await sessionFor("staff")).cookie })).status,
    ).toBe(403);
    expect((await call("/refunds?clientId=", { cookie: acc.cookie })).status).toBe(400);
  });

  it("the Payments panel's refunds carry lastAttemptAt too", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const inv = await addDoc({ clientId, issueDate: "2026-10-05" });
    const total = inv.computed.totalMinor;
    const p = await recorded(
      o,
      recordBody(clientId, total + 3_000, [{ documentId: inv.id, amountMinor: total }]),
    );
    const body = manual(1_000);
    expect((await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body })).status).toBe(200);
    const panel = (await json(await call(`/invoices/${inv.id}/payments`, { cookie: o.cookie }))) as J;
    expect(panel.refunds).toEqual([
      expect.objectContaining({ id: body.id, lastAttemptAt: null, requestedAt: expect.any(Number) }),
    ]);
  });
});

describe("B4: the refunds register [ADM-PAY-08, L9; run file B4 item 3]", () => {
  const reg = (cookie: string, q: string) => call(`/reports/refunds?${q}`, { cookie });
  const auditCount = async () =>
    (
      await one<{ n: number }>(
        "SELECT count(*) AS n FROM audit_log WHERE action = 'report.export' AND json_extract(summary, '$.report') = 'refunds'",
      )
    )?.n ?? 0;
  const paidOn = (day: string) => (amountMinor: number) =>
    manual(amountMinor, {
      manual: { mode: "neft", reference: `UTRREG${uuidv7().slice(-8)}`, paidOn: day, paidTo: "original" },
    });

  it("its own row on the invoices Worker: exports.gst, one report.export audit row per page", async () => {
    const { ROUTES } = await import("./guard.ts");
    const row = ROUTES.find((r) => r.method === "GET" && r.path === "/api/v1/reports/refunds");
    expect(row).toMatchObject({ access: "exports.gst", audit: "report.export", on: "invoices" });
  });

  it("Owner and Accountant with a fresh code; Staff and Sales 403; no code is step_up_required; a bad FY or cursor 400, nothing written", async () => {
    const got: Record<string, number> = {};
    for (const role of ["owner", "staff", "sales", "accountant"] as const)
      got[role] = (await reg((await sessionFor(role, { stepUp: true })).cookie, "fy=2627")).status;
    expect(got).toEqual({ owner: 200, staff: 403, sales: 403, accountant: 200 });
    for (const role of ["owner", "accountant"] as const) {
      const res = await reg((await sessionFor(role)).cookie, "fy=2627");
      expect(res.status, role).toBe(403);
      expect(((await json(res)) as J).error.code).toBe("step_up_required");
    }
    const o = await owner();
    const before = await auditCount();
    for (const q of ["fy=2628", "fy=26", "fy=abcd", "", "fy=2627&after=bad"])
      expect((await reg(o.cookie, q)).status, q).toBe(400);
    expect(await auditCount()).toBe(before);
  });

  it("one FY's succeeded refunds by the day they went out, oldest first, in keyset pages of 50 (one audit row each); the FY's bounds; never another FY's", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await recorded(o, recordBody(clientId, 100_000, [], { receivedOn: "2025-05-01" }));
    const lastDay = paidOn("2026-03-31")(1_000);
    expect((await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: lastDay })).status).toBe(200);
    const nextFy = paidOn("2026-04-01")(1_000);
    expect((await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: nextFy })).status).toBe(200);
    const made: string[] = [];
    for (let i = 0; i < 50; i++) {
      const b = paidOn("2025-06-01")(100);
      expect((await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: b })).status).toBe(200);
      made.push(b.id);
    }
    const before = await auditCount();
    const p1 = (await json(await reg(o.cookie, "fy=2526"))) as J;
    expect(p1).toMatchObject({ fy: "2526", from: "2025-04-01", to: "2026-03-31" });
    expect(p1.rows).toHaveLength(50);
    expect(p1.next).not.toBeNull();
    const p2 = (await json(await reg(o.cookie, `fy=2526&after=${p1.next}`))) as J;
    expect(p2.next).toBeNull();
    const ids = [...p1.rows, ...p2.rows].map((r: J) => r.id);
    expect(ids).toEqual([...[...made].sort(), lastDay.id]);
    expect(ids).not.toContain(nextFy.id);
    expect(await auditCount()).toBe(before + 2);
    const last = p2.rows.at(-1);
    expect(last).toMatchObject({
      id: lastDay.id,
      paymentId: p.id,
      provider: "manual",
      origin: "owner",
      reasonCode: "overpayment",
      refundedOn: "2026-03-31",
      currency: "INR",
      amountMinor: 1_000,
      bankReference: expect.stringMatching(/^UTRREG/),
      providerRefundId: null,
      client: { id: clientId },
      documentNumber: null,
      paymentReference: expect.stringMatching(/^UTR/),
    });
    const fy2627 = (await json(await reg(o.cookie, "fy=2627"))) as J;
    expect(fy2627.rows.map((r: J) => r.id)).toContain(nextFy.id);
  });
});
