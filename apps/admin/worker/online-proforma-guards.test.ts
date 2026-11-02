// M6.3 staging fixes, part 1 [ADM-PAY-01, ADM-PAY-03, ADM-INV-10; L5, L12; Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17)]: a
// proforma's online payment is counted once. On staging (2026-11-02) a Stripe payment waiting for a USD proforma's tax invoice was counted twice: the Owner
// issued the tax invoice for a payment received WITHOUT that payment (a new manual receipt), then confirmed the card payment through the ordinary decision,
// whose dialog allocations replaced its request (credit held). Here, for a Razorpay payment on an INR proforma and a Stripe payment on a USD proforma:
//   (1) `POST /invoices/:id/advance-invoice` without `paymentId` is 409 `online_payment_waiting` (with `details.paymentId`) while the payment waits, also with
//       `confirmDuplicate`; a payment landing between the read and the batch refuses the freeze itself (nothing written), and the explain names it;
//   (2) `POST /payments/:id/verify` confirming an entry that asks for a proforma (its request, or its checkout when it has no request) is 409
//       `use_advance_invoice` whatever the dialog sends (nothing, an invoice of the client, another client's document), and the statement's WHERE refuses it too;
//   (3) "Confirm by issuing the tax invoice" (the advance WITH `paymentId`) still works and resolves the payment's review items; ordinary invoice payments are
//       unchanged; the review item routes move no money.
// Neither gateway is ever called: the stub transports answer. All names, references and amounts are invented test data.
import { env } from "cloudflare:workers";
import { razorpayPaymentRowId, razorpayReferenceNorm } from "@techaust/core/razorpay";
import { stripePaymentRowId, stripeReferenceNorm } from "@techaust/core/stripe";
import { recordGatewayPaymentStatements } from "@techaust/db/gateway";
import { verifyPaymentStatement, WAITING_PAYMENT_SQL } from "@techaust/db/ledger";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStubTransport } from "./gateway/config.ts";
import { processEvent } from "./gateway/events.ts";
import { createLinkFor } from "./gateway/links.ts";
import { reviewReason } from "./gateway/reasons.ts";
import { ONLINE_PAYMENT_WAITING, PAYMENT_WAITING, USE_ADVANCE_INVOICE } from "./payment-messages.ts";
import {
  countingEnv,
  eventRow,
  issued,
  linkFor,
  owner,
  type Session,
  staffLink,
  stub,
} from "./test-gateway.ts";
import { call, one, rows, sessionFor } from "./test-helpers.ts";
import { currentFy, lutOf, mkProforma, putSwiftBank, putTax, todayIso } from "./test-invoice-types.ts";
import { issueInvoice, json, mkInvoice, putBank, putCompany, voidInvoice } from "./test-invoices.ts";
import { recordBody, recorded, ref, verify } from "./test-payments.ts";
import {
  liveSession,
  piOf,
  stripeEventRow,
  stripeLink,
  stripeStub,
  usdClient,
  usdDoc,
} from "./test-stripe.ts";

beforeEach(async () => {
  await putCompany();
  await putBank();
  await putSwiftBank();
  await putTax({ luts: [lutOf(currentFy())] });
});
afterEach(() => setStubTransport(null));

const FX = { rate: "84.1234", source: "FBIL" } as const;
const freezeBatch = (sqls: string[]) => sqls.some((q) => q.includes("INSERT INTO advance_receipts"));

/** A proforma with an open online checkout for its total, and the way to pay it (the webhook as the jobs hook would store it, processed). */
type Paying = {
  provider: "razorpay" | "stripe";
  o: Session;
  id: string;
  clientId: string;
  contactId: string;
  currency: "INR" | "USD";
  total: number;
  checkoutId: string;
  /** Processes the gateway's "paid" webhook: the payment is recorded pending, asking for the proforma. Returns its `payments.id`. */
  pay: () => Promise<string>;
  /** An issued payable invoice of the same client and currency (for the dialog's allocations). */
  invoiceOfClient: () => Promise<string>;
};

async function razorpayProforma(): Promise<Paying> {
  stub();
  const o = await owner();
  const pf = await issued(o, "proforma");
  const l = await linkFor(o, pf);
  return {
    provider: "razorpay",
    o,
    id: pf.id,
    clientId: pf.clientId,
    contactId: pf.contactId,
    currency: "INR",
    total: pf.total,
    checkoutId: l.checkoutId,
    pay: async () => {
      const r = await processEvent(env, await eventRow(l.linkId, l.paymentId));
      expect(r).toMatchObject({ result: "processed", next: { kind: "gateway.advance" } });
      return r.next?.paymentId as string;
    },
    invoiceOfClient: async () => {
      const inv = await mkInvoice(o, { clientId: pf.clientId, contactId: pf.contactId });
      const res = await issueInvoice(o, inv.id);
      expect(res.status, await res.clone().text()).toBe(200);
      return inv.id;
    },
  };
}

async function stripeProforma(): Promise<Paying> {
  stripeStub();
  const o = await owner();
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
    provider: "stripe",
    o,
    id: made.id,
    clientId: made.clientId,
    contactId: made.contactId,
    currency: "USD",
    total,
    checkoutId: r.checkoutId,
    pay: async () => {
      expect(await processEvent(env, await stripeEventRow(sessionId, r.checkoutId))).toEqual({
        result: "processed",
      });
      return stripePaymentRowId(piOf(sessionId));
    },
    invoiceOfClient: () => usdDoc(made.clientId),
  };
}

const CASES = [
  { name: "Razorpay on an INR proforma", make: razorpayProforma },
  { name: "Stripe on a USD proforma", make: stripeProforma },
] as const;

const proformaOf = (id: string) =>
  one<{ status: string; updated_at: number; paid_minor: number; balance_minor: number }>(
    "SELECT status, updated_at, paid_minor, balance_minor FROM documents WHERE id = ?1",
    id,
  );
const childrenOf = (id: string) => rows<{ id: string }>("SELECT id FROM documents WHERE parent_id = ?1", id);
const paymentsOf = (clientId: string) =>
  rows<{ id: string; provider: string; status: string; amount_minor: number }>(
    "SELECT id, provider, status, amount_minor FROM payments WHERE client_id = ?1 ORDER BY recorded_at, id",
    clientId,
  );

/** The advance body as the dialog sends it: by hand (a bank reference typed), or for the waiting payment (`paymentId`, its own amount, day and reference). */
async function advanceBody(pf: Paying, over: Record<string, unknown> = {}) {
  const doc = await proformaOf(pf.id);
  return {
    expectedProformaUpdatedAt: doc?.updated_at,
    amountMinor: pf.total,
    receivedOn: todayIso(),
    reference: ref(),
    ...(pf.currency === "USD" ? { fx: { ...FX, date: todayIso() } } : {}),
    ...over,
  };
}
const advance = (pf: Paying, body: unknown, e: Env = env) =>
  call(`/invoices/${pf.id}/advance-invoice`, { cookie: pf.o.cookie, body }, e);

async function withPayment(pf: Paying, paymentId: string) {
  const p = await one<{ amount_minor: number; received_on: string; reference_norm: string }>(
    "SELECT amount_minor, received_on, reference_norm FROM payments WHERE id = ?1",
    paymentId,
  );
  return advanceBody(pf, {
    amountMinor: p?.amount_minor,
    receivedOn: p?.received_on,
    reference: p?.reference_norm,
    paymentId,
    ...(pf.currency === "USD" ? { fx: { ...FX, date: p?.received_on } } : {}),
  });
}

describe.each(CASES)(
  "(1) no manual tax invoice while an online payment waits: $name [ADM-INV-10, L5]",
  ({ make }) => {
    it("409 online_payment_waiting naming the payment, with or without confirmDuplicate; nothing written", async () => {
      const pf = await make();
      const paymentId = await pf.pay();
      const before = await proformaOf(pf.id);
      for (const over of [{}, { confirmDuplicate: true }]) {
        const res = await advance(pf, await advanceBody(pf, over));
        expect(res.status, await res.clone().text()).toBe(409);
        const b = await json(res);
        expect(b.error).toMatchObject({
          code: "online_payment_waiting",
          message: ONLINE_PAYMENT_WAITING.message,
          details: { paymentId },
        });
      }
      expect(await childrenOf(pf.id)).toEqual([]);
      expect(await proformaOf(pf.id)).toEqual(before);
      // only the gateway's payment, still pending: no manual receipt was made
      expect(await paymentsOf(pf.clientId)).toEqual([
        { id: paymentId, provider: pf.provider, status: "pending_verification", amount_minor: pf.total },
      ]);
    });

    it("the freeze refuses a payment that lands between the read and the batch; the explain names it", async () => {
      const pf = await make();
      let landed = "";
      const before = await proformaOf(pf.id);
      const raced = countingEnv({
        race: {
          when: freezeBatch,
          act: async () => {
            landed = await pf.pay();
            // the payment's own batch never touches the proforma: the freeze below refuses on the online payment alone, not on a stale stamp
            expect((await proformaOf(pf.id))?.updated_at).toBe(before?.updated_at);
          },
        },
      });
      const res = await advance(pf, await advanceBody(pf), raced.env);
      expect(res.status, await res.clone().text()).toBe(409);
      expect((await json(res)).error).toMatchObject({
        code: "online_payment_waiting",
        details: { paymentId: landed },
      });
      expect(landed).not.toBe("");
      expect(await childrenOf(pf.id)).toEqual([]);
      expect(await rows("SELECT id FROM advance_receipts WHERE proforma_id = ?1", pf.id)).toEqual([]);
      expect(await paymentsOf(pf.clientId)).toEqual([
        { id: landed, provider: pf.provider, status: "pending_verification", amount_minor: pf.total },
      ]);
    });
  },
);

describe.each(CASES)(
  "(2) a payment asking for a proforma is confirmed only by issuing: $name [ADM-PAY-01, L5]",
  ({ make }) => {
    it("verify confirm is 409 use_advance_invoice for no allocations, the request, an invoice of the client and another client's document", async () => {
      const pf = await make();
      const paymentId = await pf.pay();
      const invoiceId = await pf.invoiceOfClient();
      const other = await (pf.currency === "USD" ? stripeProforma : razorpayProforma)();
      const otherInvoice = await other.invoiceOfClient();
      for (const over of [
        { allocations: [] },
        {},
        { allocations: [{ documentId: invoiceId, amountMinor: 100 }] },
        { allocations: [{ documentId: otherInvoice, amountMinor: 100 }] },
        { allocations: [{ documentId: pf.id, amountMinor: pf.total }] },
      ]) {
        const res = await verify(pf.o, paymentId, "confirm", over);
        expect(res.status, JSON.stringify(over)).toBe(409);
        expect((await json(res)).error, JSON.stringify(over)).toMatchObject({
          code: "use_advance_invoice",
          message: USE_ADVANCE_INVOICE.message,
          details: { documentId: pf.id },
        });
      }
      // the screens read the same fact: the entry names its proforma
      const view = await json(await call(`/payments/${paymentId}`, { cookie: pf.o.cookie }));
      expect(view.payment.proformaId).toBe(pf.id);
      expect(await paymentsOf(pf.clientId)).toEqual([
        { id: paymentId, provider: pf.provider, status: "pending_verification", amount_minor: pf.total },
      ]);
      expect(await rows("SELECT id FROM payment_allocations WHERE payment_id = ?1", paymentId)).toEqual([]);
    });

    it("the decision statement's WHERE refuses the confirm on its own (a caller that skipped the route's read)", async () => {
      const pf = await make();
      const paymentId = await pf.pay();
      const row = await one<{ recorded_at: number }>(
        "SELECT recorded_at FROM payments WHERE id = ?1",
        paymentId,
      );
      const r = await verifyPaymentStatement(env.DB, {
        paymentId,
        decision: "confirmed",
        now: Date.now(),
        sessionId: pf.o.sessionId,
        note: null,
        expectedRecordedAt: row?.recorded_at as number,
      }).run();
      expect(r.meta.changes).toBe(0);
      expect(
        (await one<{ status: string }>("SELECT status FROM payments WHERE id = ?1", paymentId))?.status,
      ).toBe("pending_verification");
    });

    it('"Confirm by issuing the tax invoice" still issues with the payment, resolves its review items, and the money is counted once', async () => {
      const pf = await make();
      const paymentId = await pf.pay();
      const res = await advance(pf, await withPayment(pf, paymentId));
      expect(res.status, await res.clone().text()).toBe(201);
      const b = await json(res);
      expect(b.type).toBe(pf.currency === "USD" ? "export_invoice" : "tax_invoice");
      const p = await one<{ status: string; verified_by: string; advance_receipt_id: string | null }>(
        "SELECT status, verified_by, advance_receipt_id FROM payments WHERE id = ?1",
        paymentId,
      );
      expect(p).toMatchObject({ status: "confirmed", verified_by: pf.o.id });
      expect(p?.advance_receipt_id).not.toBeNull();
      // one payment for the client, the gateway's, put whole on the new invoice: never a second (manual) receipt for the same money
      expect(await paymentsOf(pf.clientId)).toEqual([
        { id: paymentId, provider: pf.provider, status: "confirmed", amount_minor: pf.total },
      ]);
      expect(
        await rows<{ document_id: string; amount_minor: number }>(
          "SELECT document_id, amount_minor FROM payment_allocations WHERE payment_id = ?1",
          paymentId,
        ),
      ).toEqual([{ document_id: b.id, amount_minor: pf.total }]);
      expect(
        await rows<{ status: string }>(
          "SELECT status FROM review_items WHERE payment_id = ?1 AND status = 'open'",
          paymentId,
        ),
      ).toEqual([]);
      expect(await proformaOf(pf.id)).toMatchObject({
        status: "converted",
        paid_minor: pf.total,
        balance_minor: 0,
      });
      // nothing waits any more, and the entry is no longer pending (a second confirm is the ordinary "already checked")
      expect(await one(WAITING_PAYMENT_SQL, pf.id)).toBeNull();
      const again = await verify(pf.o, paymentId, "confirm", { allocations: [] });
      expect((await json(again)).error.code).toBe("payment_not_pending");
    });
  },
);

/** An online payment pending on the proforma's checkout with NO request (a mismatch, an overpayment), as the settle writes it. Returns its `payments.id`. */
async function checkoutOnly(
  pf: Pick<Paying, "provider" | "checkoutId" | "clientId" | "id">,
  amountMinor: number,
  tag: string,
): Promise<string> {
  const stripe = pf.provider === "stripe";
  const gw = stripe ? `pi_A${amountMinor}R0${tag}` : `pay_NOREQ${tag}`;
  const id = stripe ? stripePaymentRowId(gw) : razorpayPaymentRowId(gw);
  const now = Date.now();
  const st = recordGatewayPaymentStatements(env.DB, {
    provider: pf.provider,
    providerPaymentId: gw,
    paymentId: id,
    checkoutId: pf.checkoutId,
    clientId: pf.clientId,
    documentId: pf.id,
    webhookEventId: null,
    source: "refresh",
    status: "pending_verification",
    amountMinor,
    feeMinor: 0,
    feeTaxMinor: null,
    receivedOn: todayIso(),
    mode: stripe ? "card" : "upi",
    referenceNorm: (stripe ? await stripeReferenceNorm(gw) : razorpayReferenceNorm(gw)) as string,
    inrReceivedMinor: null,
    gatewayFeeInrMinor: null,
    gatewayFeeTaxInrMinor: null,
    refetchedAt: now,
    now,
    allocate: null,
    requestedAllocations: null,
    checkoutPaid: "if_open",
    staleOthers: false,
    event: null,
    bell: null,
  });
  await env.DB.batch([st.main, ...st.side, ...st.last]);
  expect(
    await one<{ status: string; requested_allocations: string | null }>(
      "SELECT status, requested_allocations FROM payments WHERE id = ?1",
      id,
    ),
  ).toEqual({ status: "pending_verification", requested_allocations: null });
  return id;
}

describe.each(CASES)(
  "(2b) the checkout alone makes it the proforma's (lead's decision 1): $name [ADM-PAY-01, ADM-INV-10, L5, L17]",
  ({ make }) => {
    it("never confirmed by the decision, blocks a manual receipt and the void, shows on the proforma's panel, and is confirmed by issuing within the balance", async () => {
      const pf = await make();
      const amount = pf.currency === "USD" ? 1_234 : 50_000;
      const id = await checkoutOnly(pf, amount, "ONE");
      const res = await verify(pf.o, id, "confirm", { allocations: [] });
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatchObject({
        code: "use_advance_invoice",
        details: { documentId: pf.id },
      });
      const manual = await advance(pf, await advanceBody(pf));
      expect(manual.status).toBe(409);
      expect((await json(manual)).error).toMatchObject({
        code: "online_payment_waiting",
        details: { paymentId: id },
      });
      // the void blockers read the same rule: a proforma with such a payment waiting is never voided
      const view = await json(await call(`/invoices/${pf.id}`, { cookie: pf.o.cookie }));
      expect(view.void.blockers).toContain("payment_pending_gateway");
      const refused = await voidInvoice(pf.o, pf.id);
      expect(refused.status).toBe(409);
      expect((await json(refused)).reasons).toContain("payment_pending_gateway");
      // the proforma's panel lists it among the payments waiting, asking for the whole payment
      const panel = await json(await call(`/invoices/${pf.id}/payments`, { cookie: pf.o.cookie }));
      expect(panel.pending).toEqual([expect.objectContaining({ paymentId: id, askedMinor: amount })]);
      // "Confirm by issuing the tax invoice": issued with it, put whole on the new invoice
      const ok = await advance(pf, await withPayment(pf, id));
      expect(ok.status, await ok.clone().text()).toBe(201);
      const b = await json(ok);
      expect(await one<{ status: string }>("SELECT status FROM payments WHERE id = ?1", id)).toEqual({
        status: "confirmed",
      });
      expect(
        await rows<{ document_id: string; amount_minor: number }>(
          "SELECT document_id, amount_minor FROM payment_allocations WHERE payment_id = ?1",
          id,
        ),
      ).toEqual([{ document_id: b.id, amount_minor: amount }]);
      expect(await proformaOf(pf.id)).toMatchObject({ paid_minor: amount, balance_minor: pf.total - amount });
      expect(await paymentsOf(pf.clientId)).toEqual([
        { id, provider: pf.provider, status: "confirmed", amount_minor: amount },
      ]);
    });

    it("overpaid money (above the balance) is held: refused by issuing (more than the balance) and by the decision; its review line says it waits for a refund", async () => {
      const pf = await make();
      const id = await checkoutOnly(pf, pf.total + 100, "OVER");
      const issue = await advance(pf, await withPayment(pf, id));
      expect(issue.status).toBe(409);
      expect((await json(issue)).error.code).toBe("advance_exceeds_balance");
      const res = await verify(pf.o, id, "confirm", { allocations: [] });
      expect((await json(res)).error.code).toBe("use_advance_invoice");
      expect(await one<{ status: string }>("SELECT status FROM payments WHERE id = ?1", id)).toEqual({
        status: "pending_verification",
      });
      expect(await childrenOf(pf.id)).toEqual([]);
      expect(reviewReason("proforma_overpaid", { provider: pf.provider })).toBe(
        "The client paid more than the proforma's balance. It waits for a refund.",
      );
    });
  },
);

describe("(2c) a waiting MANUAL entry (lead's decision 2) [ADM-INV-10, L5, L12]", () => {
  it("the manual tax invoice is 409 payment_waiting naming the Staff entry, with or without confirmDuplicate; issuing with it works", async () => {
    const pf = await razorpayProforma();
    const staff = await sessionFor("staff");
    const entry = recordBody(pf.clientId, pf.total, [{ documentId: pf.id, amountMinor: pf.total }]);
    await recorded(staff, entry);
    for (const over of [{}, { confirmDuplicate: true }, { reference: entry.reference }]) {
      const res = await advance(pf, await advanceBody(pf, over));
      expect(res.status, JSON.stringify(over)).toBe(409);
      expect((await json(res)).error, JSON.stringify(over)).toMatchObject({
        code: "payment_waiting",
        message: PAYMENT_WAITING.message,
        details: { paymentId: entry.id },
      });
    }
    expect(await childrenOf(pf.id)).toEqual([]);
    const ok = await advance(pf, await withPayment(pf, entry.id));
    expect(ok.status, await ok.clone().text()).toBe(201);
  });

  it("two Staff entries: issuing with the newer one is refused (the older is named); then each issues in turn, never a deadlock", async () => {
    const pf = await razorpayProforma();
    const staff = await sessionFor("staff");
    const half = pf.total / 2;
    const first = recordBody(pf.clientId, half, [{ documentId: pf.id, amountMinor: half }]);
    await recorded(staff, first);
    const second = recordBody(pf.clientId, half, [{ documentId: pf.id, amountMinor: half }]);
    await recorded(staff, second);
    const refused = await advance(pf, await withPayment(pf, second.id));
    expect(refused.status).toBe(409);
    expect((await json(refused)).error).toMatchObject({
      code: "payment_waiting",
      details: { paymentId: first.id },
    });
    const one1 = await advance(pf, await withPayment(pf, first.id));
    expect(one1.status, await one1.clone().text()).toBe(201);
    const two = await advance(pf, await withPayment(pf, second.id));
    expect(two.status, await two.clone().text()).toBe(201);
    expect(await proformaOf(pf.id)).toMatchObject({ balance_minor: 0 });
  });

  it("the freeze refuses a manual tax invoice when a Staff entry is recorded between the read and the batch", async () => {
    const pf = await razorpayProforma();
    const staff = await sessionFor("staff");
    const entry = recordBody(pf.clientId, pf.total, [{ documentId: pf.id, amountMinor: pf.total }]);
    const raced = countingEnv({
      race: {
        when: freezeBatch,
        act: async () => {
          await recorded(staff, entry);
        },
      },
    });
    const res = await advance(pf, await advanceBody(pf), raced.env);
    expect(res.status, await res.clone().text()).toBe(409);
    expect((await json(res)).error).toMatchObject({
      code: "payment_waiting",
      details: { paymentId: entry.id },
    });
    expect(await childrenOf(pf.id)).toEqual([]);
  });
});

describe("(3) what stays as it was [ADM-PAY-01, ADM-PAY-05]", () => {
  it("a Staff entry asking for a proforma: the decision refuses even with the dialog's own allocations; the advance with it issues", async () => {
    const pf = await razorpayProforma();
    const staff = await sessionFor("staff");
    const body = recordBody(pf.clientId, pf.total, [{ documentId: pf.id, amountMinor: pf.total }]);
    const r = await recorded(staff, body);
    expect(r.status).toBe("pending_verification");
    // lead's decision 2: a waiting manual entry is the first payment waiting too
    expect(await one(WAITING_PAYMENT_SQL, pf.id)).toEqual({ id: body.id, provider: "manual" });
    const refused = await verify(pf.o, body.id, "confirm", { allocations: [] });
    expect((await json(refused)).error).toMatchObject({
      code: "use_advance_invoice",
      details: { documentId: pf.id },
    });
    const ok = await advance(pf, await withPayment(pf, body.id));
    expect(ok.status, await ok.clone().text()).toBe(201);
  });

  it("ordinary invoice payments: a Staff entry on an invoice is confirmed as before; the proforma field is null", async () => {
    const pf = await razorpayProforma();
    const invoiceId = await pf.invoiceOfClient();
    const staff = await sessionFor("staff");
    const body = recordBody(pf.clientId, 10_000, [{ documentId: invoiceId, amountMinor: 10_000 }]);
    await recorded(staff, body);
    const view = await json(await call(`/payments/${body.id}`, { cookie: pf.o.cookie }));
    expect(view.payment.proformaId).toBeNull();
    const res = await verify(pf.o, body.id, "confirm");
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await json(res)).allocations).toEqual([{ documentId: invoiceId, amountMinor: 10_000 }]);
    // and the proforma's manual tax invoice is not blocked by a payment on another document
    expect(await one(WAITING_PAYMENT_SQL, pf.id)).toBeNull();
    const adv = await advance(pf, await advanceBody(pf));
    expect(adv.status, await adv.clone().text()).toBe(201);
  });

  it("the review item routes move no money: Mark as resolved on the payment's item leaves it pending; the manual advance stays refused", async () => {
    const pf = await stripeProforma();
    const paymentId = await pf.pay();
    const item = await one<{ id: string }>(
      "SELECT id FROM review_items WHERE payment_id = ?1 AND kind = 'advance_blocked'",
      paymentId,
    );
    // "confirmed" is refused (the payment isn't), "dismissed" closes the item only
    const confirmed = await call(`/payments/review/${item?.id}/resolve`, {
      cookie: pf.o.cookie,
      body: { resolution: "confirmed", note: null },
    });
    expect(confirmed.status).toBe(409);
    const dismissed = await call(`/payments/review/${item?.id}/resolve`, {
      cookie: pf.o.cookie,
      body: { resolution: "dismissed", note: null },
    });
    expect(dismissed.status, await dismissed.clone().text()).toBe(200);
    expect(
      (await one<{ status: string }>("SELECT status FROM payments WHERE id = ?1", paymentId))?.status,
    ).toBe("pending_verification");
    expect(await rows("SELECT id FROM payment_allocations WHERE payment_id = ?1", paymentId)).toEqual([]);
    const manual = await advance(pf, await advanceBody(pf));
    expect((await json(manual)).error.code).toBe("online_payment_waiting");
  });

  it("the approvals queue and the payment view carry the proforma (pending only) and the gateway's own payment id", async () => {
    const pf = await stripeProforma();
    const paymentId = await pf.pay();
    const view = await json(await call(`/payments/${paymentId}`, { cookie: pf.o.cookie }));
    expect(view.payment.providerPaymentId).toMatch(/^pi_/);
    const staff = await sessionFor("staff");
    const pf2 = await razorpayProforma();
    const body = recordBody(pf2.clientId, pf2.total, [{ documentId: pf2.id, amountMinor: pf2.total }]);
    await recorded(staff, body);
    const list = await json(await call("/approvals?kind=payment", { cookie: pf2.o.cookie }));
    const item = list.approvals.find((a: { payment: { id: string } }) => a.payment.id === body.id);
    expect(item.payment.proformaId).toBe(pf2.id);
    // once decided (here by issuing), no entry names a proforma any more
    const ok = await advance(pf2, await withPayment(pf2, body.id));
    expect(ok.status, await ok.clone().text()).toBe(201);
    const after = await json(await call(`/payments/${body.id}`, { cookie: pf2.o.cookie }));
    expect(after.payment).toMatchObject({ status: "confirmed", proformaId: null, providerPaymentId: null });
  });
});

describe.each(CASES)(
  "(1b) never on a manual entry while an online payment waits: $name [ADM-INV-10, L5, L12]",
  ({ make }) => {
    it("Confirm by issuing with a Staff entry for the proforma is 409 online_payment_waiting (read and freeze paths); the online payment then issues", async () => {
      const pf = await make();
      const staff = await sessionFor("staff");
      const manual = recordBody(pf.clientId, pf.total, [{ documentId: pf.id, amountMinor: pf.total }], {
        currency: pf.currency,
        ...(pf.currency === "USD" ? { mode: "swift" } : {}),
      });
      await recorded(staff, manual);
      // the read path: the online payment already waits
      const paymentId = await pf.pay();
      const refused = await advance(pf, await withPayment(pf, manual.id));
      expect(refused.status, await refused.clone().text()).toBe(409);
      expect((await json(refused)).error).toMatchObject({
        code: "online_payment_waiting",
        details: { paymentId },
      });
      expect(await childrenOf(pf.id)).toEqual([]);
      // the online payment itself issues; the Staff entry stays pending for the Owner to reject
      const ok = await advance(pf, await withPayment(pf, paymentId));
      expect(ok.status, await ok.clone().text()).toBe(201);
      expect(
        (await one<{ status: string }>("SELECT status FROM payments WHERE id = ?1", manual.id))?.status,
      ).toBe("pending_verification");
    });

    it("the freeze refuses the Staff entry when the online payment lands between the read and the batch", async () => {
      const pf = await make();
      const staff = await sessionFor("staff");
      const manual = recordBody(pf.clientId, pf.total, [{ documentId: pf.id, amountMinor: pf.total }], {
        currency: pf.currency,
        ...(pf.currency === "USD" ? { mode: "swift" } : {}),
      });
      await recorded(staff, manual);
      let landed = "";
      const raced = countingEnv({
        race: {
          when: freezeBatch,
          act: async () => {
            landed = await pf.pay();
          },
        },
      });
      const res = await advance(pf, await withPayment(pf, manual.id), raced.env);
      expect(res.status, await res.clone().text()).toBe(409);
      expect((await json(res)).error).toMatchObject({
        code: "online_payment_waiting",
        details: { paymentId: landed },
      });
      expect(await childrenOf(pf.id)).toEqual([]);
      expect(
        (await one<{ status: string }>("SELECT status FROM payments WHERE id = ?1", manual.id))?.status,
      ).toBe("pending_verification");
    });
  },
);

/** A document with an open online checkout: a proforma or an invoice, through Razorpay (INR) or Stripe (USD). */
type LinkDoc = {
  provider: "razorpay" | "stripe";
  id: string;
  clientId: string;
  contactId: string;
  checkoutId: string;
  /** What a new link asks for: the document's balance. */
  amount: number;
  o: Session;
};

const LINK_DOCS = [
  {
    name: "a Razorpay proforma",
    make: async (): Promise<LinkDoc> => {
      const pf = await razorpayProforma();
      return { ...pf, amount: pf.total };
    },
  },
  {
    name: "a Razorpay tax invoice",
    make: async (): Promise<LinkDoc> => {
      stub();
      const o = await owner();
      const inv = await issued(o);
      const l = await linkFor(o, inv);
      return { provider: "razorpay", ...inv, checkoutId: l.checkoutId, amount: inv.total, o };
    },
  },
  {
    name: "a Stripe proforma",
    make: async (): Promise<LinkDoc> => {
      const pf = await stripeProforma();
      return { ...pf, amount: pf.total };
    },
  },
  {
    name: "a Stripe export invoice",
    make: async (): Promise<LinkDoc> => {
      stripeStub();
      const o = await owner();
      const s = await liveSession();
      return {
        provider: "stripe",
        id: s.documentId,
        clientId: s.clientId,
        contactId: s.contactId,
        checkoutId: s.checkoutId,
        amount: 50_000,
        o,
      };
    },
  },
] as const;

describe.each(LINK_DOCS)(
  "(4) no new link or card page while an online payment is for the document, a checkout-only one included (lead's final round): $name [POR-06, ADM-PAY-01]",
  ({ make }) => {
    it("the portal's Pay path (the PortalPayments RPC's createLinkFor) and the staff link answer payment_processing; nothing is asked of the gateway", async () => {
      const d = await make();
      await checkoutOnly(d, 100, `L${d.id.replaceAll("-", "").slice(-12)}`);
      const portal = await createLinkFor(env, {
        provider: d.provider,
        clientId: d.clientId,
        contactId: d.contactId,
        tokenHash: null,
        documentId: d.id,
        amountMinor: d.amount,
        returnTo: "invoice",
      });
      expect(portal).toEqual({ ok: false, error: "payment_processing" });
      if (d.provider === "razorpay") {
        const stamp = await one<{ updated_at: number }>(
          "SELECT updated_at FROM documents WHERE id = ?1",
          d.id,
        );
        const staff = await staffLink(d.o, d.id, d.amount, stamp?.updated_at ?? 0);
        expect(staff.status).toBe(409);
        expect((await json(staff)).error.code).toBe("payment_processing");
      }
      // no new open checkout was made for it
      expect(
        await rows(
          "SELECT id FROM checkout_sessions WHERE document_id = ?1 AND status IN ('creating', 'live')",
          d.id,
        ),
      ).toEqual([]);
    });
  },
);

describe("(3b) the read's cost [Free plan]", () => {
  it("the waiting read is one seek of payments_client", async () => {
    const plan = (
      await env.DB.prepare(`EXPLAIN QUERY PLAN ${WAITING_PAYMENT_SQL}`).bind("x").all<{ detail: string }>()
    ).results
      .map((r) => r.detail)
      .join(" | ");
    expect(plan).toContain("payments_client");
    expect(plan).not.toMatch(/SCAN wp\b/);
  });
});
