// M6.4 PayPal's admin routes [ADM-PAY-01, -07, ADM-INV-17, docs/04 §9; run file C "Routes" and the advice table, L12, L30; early check 1 "B2 must carry" 8]: "Cancel"
// on a PayPal order (ended here, never while its capture is claimed), "Check now" (the capture as the member), Settings › Gateways' last verified PayPal webhook,
// and the remittance advices: add one (Owner, Staff), its file once, link confirmed payments (all or none, the reasons in words), the Owner's "Remove link"
// with a reason, the "Without advice" list with its count, and every role refused where docs/04 §9 says so. PayPal is never called: the stub transport answers.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { schema } from "@techaust/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADVICE_KINDS, ADVICE_PROVIDERS } from "./advices.ts";
import { setStubTransport } from "./gateway/config.ts";
import { capturePayPalReturn } from "./gateway/paypal-capture.ts";
import { owner } from "./test-gateway.ts";
import { call, one, rows, sessionFor } from "./test-helpers.ts";
import { currentFy, lutOf, putSwiftBank, putTax } from "./test-invoice-types.ts";
import { json, putBank, putCompany } from "./test-invoices.ts";
import { putDoc } from "./test-payments.ts";
import { capOf, liveOrder, paypalCalls, paypalStub, ppCheckout } from "./test-paypal.ts";
import { PDF_BYTES } from "./test-projects.ts";

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
  paypalStub();
});
afterEach(() => setStubTransport(null));

/** A paid PayPal order: its confirmed payment's id. */
async function paidOrder() {
  const o = await liveOrder();
  expect(await capturePayPalReturn(env, { checkoutId: o.checkoutId, token: o.orderId })).toEqual({
    state: "paid",
  });
  return { ...o, paymentId: `ppl_${capOf(o.orderId)}` };
}

const advice = (cookie: string, over: Record<string, unknown> = {}) =>
  call("/payments/advices", {
    cookie,
    body: {
      provider: "paypal",
      kind: "efira",
      adviceRef: `FIRA-${uuidv7().slice(-8)}`,
      issuedOn: "2026-11-09",
      periodFrom: "2026-11-02",
      periodTo: "2026-11-08",
      inrTotalMinor: 4_150_000,
      note: null,
      ...over,
    },
  });

describe("Cancel and Check now on a PayPal order [L4, L14; B2 must carry 8]", () => {
  it("Cancel ends the order here with no PayPal call; a claimed one is 409 payment_processing", async () => {
    const o = await owner();
    const a = await liveOrder();
    paypalStub();
    const res = await call(`/invoices/${a.documentId}/payment-link/cancel`, {
      cookie: o.cookie,
      body: { checkoutId: a.checkoutId },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(paypalCalls).toEqual([]);
    expect((await ppCheckout(a.checkoutId))?.status).toBe("cancelled");
    const b = await liveOrder();
    await env.DB.prepare("UPDATE checkout_sessions SET capture_started_at = ?2 WHERE id = ?1")
      .bind(b.checkoutId, Date.now())
      .run();
    const busy = await call(`/invoices/${b.documentId}/payment-link/cancel`, {
      cookie: o.cookie,
      body: { checkoutId: b.checkoutId },
    });
    expect(busy.status).toBe(409);
    expect((await json(busy)).error).toMatchObject({ code: "payment_processing" });
    expect((await ppCheckout(b.checkoutId))?.status).toBe("live");
  });

  it("Check now captures the order as the member (the audit row's actor)", async () => {
    const o = await owner();
    const a = await liveOrder();
    paypalStub();
    const res = await call(`/payments/links/${a.checkoutId}/refresh`, { cookie: o.cookie, body: {} });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await json(res)).toMatchObject({ ok: true, result: "processed" });
    const audit = await one<{ actor_type: string; actor_id: string }>(
      "SELECT actor_type, actor_id FROM audit_log WHERE action = 'payment.gateway_confirm' AND entity_id = ?1",
      `ppl_${capOf(a.orderId)}`,
    );
    expect(audit).toEqual({ actor_type: "staff", actor_id: o.id });
  });

  it("Settings › Gateways: PayPal's keys configured and its last verified webhook", async () => {
    const o = await owner();
    await env.DB.prepare(
      "INSERT INTO webhook_events (id, provider, event_id, event_type, received_at, status, attempts, facts) VALUES (?1, 'paypal', ?2, 'CHECKOUT.ORDER.APPROVED', 1234, 'ignored', 0, '{}')",
    )
      .bind(uuidv7(), `WH-${uuidv7().replaceAll("-", "").slice(0, 20)}`)
      .run();
    const res = await call("/payments/gateways", { cookie: o.cookie });
    expect(res.status).toBe(200);
    const g = (await json(res)).gateways as Record<
      string,
      { keys: { configured: boolean }; lastVerifiedWebhookAt: number | null }
    >;
    expect(g.paypal?.keys.configured).toBe(true);
    expect(g.paypal?.lastVerifiedWebhookAt).toBeGreaterThanOrEqual(1234);
  });
});

describe("remittance advices [ADM-INV-17, L12, L30; 08-C RB-05]", () => {
  it("the route's lists are the schema's", () => {
    expect([...ADVICE_PROVIDERS]).toEqual([...schema.ADVICE_PROVIDERS]);
    expect([...ADVICE_KINDS]).toEqual([...schema.ADVICE_KINDS]);
  });

  it("Staff and the Owner add advices; one per provider, kind and reference; Sales and the Accountant can't (the Accountant may read)", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const r = await advice(staff.cookie, { adviceRef: "FIRA-W45" });
    expect(r.status, await r.clone().text()).toBe(201);
    const again = await advice(o.cookie, { adviceRef: "FIRA-W45" });
    expect(again.status).toBe(409);
    expect((await json(again)).error).toMatchObject({ code: "advice_ref_exists" });
    for (const role of ["sales", "accountant"] as const) {
      const s = await sessionFor(role);
      expect((await advice(s.cookie)).status, role).toBe(403);
    }
    const acc = await sessionFor("accountant");
    const list = await call("/payments/advices", { cookie: acc.cookie });
    expect(list.status).toBe(200);
    expect(
      ((await json(list)).items as { advice_ref: string }[]).some((x) => x.advice_ref === "FIRA-W45"),
    ).toBe(true);
    // The audit row never carries the reference (it may name a remitter).
    const id = (await json(r)).id as string;
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'payment.advice_create' AND entity_id = ?1",
      id,
    );
    expect(audit?.summary).not.toContain("FIRA-W45");
  });

  it("the file once, write-once in DOCS; read back as an attachment", async () => {
    const o = await owner();
    const id = (await json(await advice(o.cookie))).id as string;
    const put = await putDoc(`/payments/advices/${id}/file`, PDF_BYTES, {
      cookie: o.cookie,
      name: "fira.pdf",
    });
    expect(put.status, await put.clone().text()).toBe(200);
    const row = await one<{ file_r2_key: string; file_mime: string }>(
      "SELECT file_r2_key, file_mime FROM realisation_advices WHERE id = ?1",
      id,
    );
    expect(row?.file_r2_key).toMatch(new RegExp(`^advices/${id}/file-[0-9a-f]{64}$`));
    expect(row?.file_mime).toBe("application/pdf");
    const twice = await putDoc(`/payments/advices/${id}/file`, PDF_BYTES, {
      cookie: o.cookie,
      name: "fira.pdf",
    });
    expect(twice.status).toBe(409);
    expect((await json(twice)).error).toMatchObject({ code: "file_already_set" });
    const get = await call(`/payments/advices/${id}/file`, { cookie: o.cookie });
    expect(get.status).toBe(200);
    expect(get.headers.get("Content-Disposition")).toMatch(/attachment/);
  });

  it("link: confirmed PayPal payments, all or none, the reason in words; the Owner alone removes one, with a reason; it may go back on the same advice", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const p1 = await paidOrder();
    const p2 = await paidOrder();
    const id = (await json(await advice(staff.cookie))).id as string;
    const stripeAdvice = (await json(await advice(staff.cookie, { provider: "stripe" }))).id as string;
    const wrong = await call(`/payments/advices/${stripeAdvice}/payments`, {
      cookie: staff.cookie,
      body: { paymentIds: [p1.paymentId] },
    });
    expect(wrong.status).toBe(409);
    expect((await json(wrong)).error).toMatchObject({ code: "wrong_provider" });
    const ok = await call(`/payments/advices/${id}/payments`, {
      cookie: staff.cookie,
      body: { paymentIds: [p1.paymentId, p2.paymentId] },
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const dup = await call(`/payments/advices/${id}/payments`, {
      cookie: staff.cookie,
      body: { paymentIds: [p1.paymentId] },
    });
    expect((await json(dup)).error).toMatchObject({ code: "already_linked" });
    const detail = await json(await call(`/payments/advices/${id}`, { cookie: staff.cookie }));
    expect((detail.payments as { payment_id: string }[]).map((x) => x.payment_id).sort()).toEqual(
      [p1.paymentId, p2.paymentId].sort(),
    );
    // Staff can't remove; the Owner can, once, with a reason.
    const path = `/payments/advices/${id}/payments/${p1.paymentId}/remove`;
    expect((await call(path, { cookie: staff.cookie, body: { reason: "Wrong week" } })).status).toBe(403);
    expect((await call(path, { cookie: o.cookie, body: { reason: "Wrong week" } })).status).toBe(200);
    expect((await call(path, { cookie: o.cookie, body: { reason: "Wrong week" } })).status).toBe(409);
    expect(
      (
        await call(`/payments/advices/${id}/payments`, {
          cookie: staff.cookie,
          body: { paymentIds: [p1.paymentId] },
        })
      ).status,
    ).toBe(200);
    expect(
      await rows(
        "SELECT id FROM realisation_advice_payments WHERE advice_id = ?1 AND payment_id = ?2",
        id,
        p1.paymentId,
      ),
    ).toHaveLength(2);
  });

  it("Without advice: a gateway's confirmed payments on no advice, with the count; a bad provider is 400", async () => {
    const o = await owner();
    const p = await paidOrder();
    const res = await call("/payments/without-advice?provider=paypal", { cookie: o.cookie });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect((body.items as { id: string }[]).some((x) => x.id === p.paymentId)).toBe(true);
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect((await call("/payments/without-advice?provider=razorpay", { cookie: o.cookie })).status).toBe(400);
    const sales = await sessionFor("sales");
    expect((await call("/payments/without-advice?provider=paypal", { cookie: sales.cookie })).status).toBe(
      403,
    );
  });
});
