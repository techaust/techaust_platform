// M6.5 second review, the fixes at route level [ADM-PAY-08, -10; run file "Second review" M1, M3, M6, L1, L2; L48]: credit at a period's end by the day the
// money arrived (confirmed after the end: listed and marked), one "Needs review" item per refund made in a gateway's dashboard (Stripe's `charge.refunded`
// never opens one), the credit note a refund of an invoice's excess is linked to only when that note made the excess, a recon page of skipped lines that still
// hands on the day, and a settlement's lines in pages of 50. No test reaches a gateway: the stub transports answer. Invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStubTransport } from "./gateway/config.ts";
import { processEvent } from "./gateway/events.ts";
import { fetchSettlements } from "./recon.ts";
import { stub } from "./test-gateway.ts";
import { call, one, rows, sessionFor } from "./test-helpers.ts";
import { todayIso } from "./test-invoice-types.ts";
import { type J, json, putCompany } from "./test-invoices.ts";
import { recordBody, recorded } from "./test-payments.ts";
import { addDoc, line, mkReportClient } from "./test-reports.ts";
import { liveSession, piOf, stripeEventRow, stripeStub } from "./test-stripe.ts";

const owner = () => sessionFor("owner", { stepUp: true });
beforeEach(async () => {
  await putCompany();
  stub();
});
afterEach(() => {
  setStubTransport(null);
});

const outsideItems = (paymentId: string) =>
  rows<{ id: string; amount_minor: number; refund: string | null }>(
    "SELECT id, amount_minor, json_extract(facts, '$.refundId') AS refund FROM review_items WHERE payment_id = ?1 AND kind = 'refunded_outside'",
    paymentId,
  );
const bellsOf = async (reviewIds: string[]) =>
  (
    await rows<{ n: number }>(
      "SELECT count(*) AS n FROM notifications WHERE entity_type = 'review_item' AND entity_id IN (SELECT value FROM json_each(?1))",
      JSON.stringify(reviewIds),
    )
  )[0]?.n ?? 0;
const activeOwners = async () =>
  (
    await rows<{ n: number }>(
      "SELECT count(*) AS n FROM staff_users WHERE role = 'owner' AND status = 'active'",
    )
  )[0]?.n;

// ---- M1: credit at a period's end -----------------------------------------------------------------------------------------------------------------------------

describe("M1 (L48, RA-41): the credit-held list takes money by the day it arrived, whatever day it was confirmed", () => {
  it("received on the period's last day, confirmed today: on that period's list, marked confirmedAfter; one confirmed in time is not marked", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const first = (await json(await call("/payments/credit-held", { cookie: o.cookie }))) as J;
    const end = first.periodEnd as string;
    const insert = async (verifiedAt: number) => {
      const id = uuidv7();
      await env.DB.prepare(
        `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, reference_norm, recorded_by, recorded_at, verified_by, verified_at)
         VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'INR', 250000, ?3, 'neft', ?4, ?5, ?6, ?5, ?6)`,
      )
        .bind(id, clientId, end, `UTRM1${verifiedAt}${id.slice(-6)}`, o.id, verifiedAt)
        .run();
      return id;
    };
    const late = await insert(Date.now());
    const inTime = await insert(Date.parse(`${end}T12:00:00+05:30`));
    const again = (await json(
      await call(`/payments/credit-held?period=${first.period}`, { cookie: o.cookie }),
    )) as J;
    const mine = (again.items as J[]).filter((r) => r.paymentId === late || r.paymentId === inTime);
    expect(Object.fromEntries(mine.map((r) => [r.paymentId, [r.creditMinor, r.confirmedAfter]]))).toEqual({
      [late]: [250_000, true],
      [inTime]: [250_000, false],
    });
  });
});

// ---- M3: one item per refund made in a gateway's dashboard ------------------------------------------------------------------------------------------------

let seq = 0;
/** A confirmed Razorpay payment with nothing allocated (all credit), as a settled online payment leaves it. */
async function rzpPayment(clientId: string, ownerId: string, amount = 50_000) {
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
    .bind(ck, `plink_R2${T}`, T + 1)
    .run();
  const id = uuidv7();
  const ref = `pay_R2${T}`;
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

describe("M3: a refund made in a gateway's dashboard opens ONE refunded_outside item", () => {
  it("Razorpay's refund.created then refund.processed of one dashboard refund: one item and one bell per owner; the second event is processed quietly", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await rzpPayment(clientId, o.id);
    const ev = async (type: string) => {
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
            refundId: `rfnd_DASHR2${seq}`,
            paymentId: p.ref,
            amountMinor: 2_500,
            currency: "INR",
          }),
        )
        .run();
      return id;
    };
    expect(await processEvent(env, await ev("refund.created"))).toEqual({ result: "needs_review" });
    const second = await ev("refund.processed");
    expect(await processEvent(env, second)).toEqual({ result: "processed" });
    expect(await one("SELECT status, outcome FROM webhook_events WHERE id = ?1", second)).toEqual({
      status: "processed",
      outcome: "refunded_outside_known",
    });
    const items = await outsideItems(p.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ amount_minor: 2_500, refund: `rfnd_DASHR2${seq}` });
    expect(await bellsOf(items.map((i) => i.id))).toBe(await activeOwners());
  });

  it("Stripe's charge.refunded (the running total, no refund id) never opens an item; refund.created then refund.updated open one, with the refund's own amount", async () => {
    stripeStub();
    const s = await liveSession();
    expect(await processEvent(env, await stripeEventRow(s.sessionId, s.checkoutId))).toMatchObject({
      result: "processed",
    });
    const pi = piOf(s.sessionId);
    const payment = await one<{ id: string }>(
      "SELECT id FROM payments WHERE provider = 'stripe' AND provider_payment_id = ?1",
      pi,
    );
    const paymentId = payment?.id as string;
    const reId = `re_R2${Date.now()}`;
    const charge = await stripeEventRow("", "", "charge.refunded", {
      event: "charge.refunded",
      object: "refund",
      paymentId: pi,
      // an earlier $30 and this $50: Stripe's `amount_refunded` is the charge's running total
      amountMinor: 8_000,
      currency: "USD",
      livemode: 0,
    });
    expect(await processEvent(env, charge)).toEqual({ result: "processed" });
    expect(await one("SELECT outcome FROM webhook_events WHERE id = ?1", charge)).toEqual({
      outcome: "charge_refunded_logged",
    });
    expect(await outsideItems(paymentId)).toEqual([]);
    const refundEvent = (type: string, status: string) =>
      stripeEventRow("", "", type, {
        event: type,
        object: "refund",
        refundId: reId,
        paymentId: pi,
        amountMinor: 5_000,
        currency: "USD",
        status,
        livemode: 0,
      });
    expect(await processEvent(env, await refundEvent("refund.created", "pending"))).toEqual({
      result: "needs_review",
    });
    expect(await processEvent(env, await refundEvent("refund.updated", "succeeded"))).toEqual({
      result: "processed",
    });
    const items = await outsideItems(paymentId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ amount_minor: 5_000, refund: reId });
  });
});

// ---- M6: the credit note a refund of an invoice's excess is linked to ---------------------------------------------------------------------------------------

const manual = (amountMinor: number, o: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  amountMinor,
  from: "document",
  reasonCode: "credit_note",
  manual: {
    mode: "neft",
    reference: `UTRB6${Date.now().toString(36).toUpperCase()}${++seq}`,
    paidOn: todayIso(),
    paidTo: "original",
  },
  ...o,
});

describe("M6 (RA-40): a refund of an invoice's excess links only the credit note that made it", () => {
  it("a note issued before the payment arrived: none linked; one issued since but smaller than the refund: none; one issued since that covers it: linked", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const inv = await addDoc({ clientId, issueDate: "2026-10-05" });
    const total = inv.computed.totalMinor;
    const p = await recorded(o, recordBody(clientId, total, [{ documentId: inv.id, amountMinor: total }]));
    // an unrelated price correction issued before the payment arrived (₹11,800)
    const old = await addDoc({
      clientId,
      type: "credit_note",
      parentId: inv.id,
      issueDate: "2026-10-01",
      lines: [line(10_000)],
    });
    const credit = (minor: number) =>
      env.DB.prepare("UPDATE documents SET credited_minor = ?2, updated_at = updated_at + 1 WHERE id = ?1")
        .bind(inv.id, minor)
        .run();
    await credit(old.computed.totalMinor);
    const refund = async (amountMinor: number) => {
      const body = manual(amountMinor, { documentId: inv.id });
      const res = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body });
      expect(res.status, await res.clone().text()).toBe(200);
      return ((await json(res)) as J).refund.creditNoteId as string | null;
    };
    expect(await refund(3_000)).toBeNull();
    // the dialog's facts name no note either (none was issued since the payment arrived)
    const facts = (
      (await json(await call(`/payments/${p.id}/refunds?documentId=${inv.id}`, { cookie: o.cookie }))) as J
    ).facts;
    expect(facts.issuedCreditNote).toBeNull();
    // a note issued today (₹1,180): it covers a ₹1,000 refund, not a ₹2,000 one
    const fresh = await addDoc({
      clientId,
      type: "credit_note",
      parentId: inv.id,
      issueDate: todayIso(),
      lines: [line(1_000)],
    });
    await credit(old.computed.totalMinor + fresh.computed.totalMinor);
    expect(await refund(2_000)).toBeNull();
    expect(await refund(1_000)).toBe(fresh.id);
  });
});

// ---- L1 and L2: reconciliation ----------------------------------------------------------------------------------------------------------------------------

describe("L1: a full recon page whose lines were all skipped still hands on the rest of the day", () => {
  it("100 lines not in INR: nothing stored, the next page asked for; a short page of them is empty", async () => {
    const T = Date.now();
    const page = (n: number) =>
      Response.json({
        count: n,
        items: Array.from({ length: n }, (_, i) => ({
          entity_id: `pay_L1${T}${i}`,
          type: "payment",
          amount: 1_000,
          fee: 0,
          tax: 0,
          credit: 1_000,
          debit: 0,
          currency: "USD",
          settlement_id: `setl_L1${T}`,
          settled_at: 1_793_000_000,
        })),
      });
    stub((path) => (path === "/v1/settlements/recon/combined" ? page(100) : null));
    expect(await fetchSettlements(env, { provider: "razorpay", day: "2026-11-02", skip: 0 })).toEqual({
      result: "stored",
      next: { skip: 100 },
    });
    expect(
      await one("SELECT count(*) AS n FROM settlement_items WHERE entity_id LIKE ?1", `pay_L1${T}%`),
    ).toEqual({
      n: 0,
    });
    stub((path) => (path === "/v1/settlements/recon/combined" ? page(3) : null));
    expect(await fetchSettlements(env, { provider: "razorpay", day: "2026-11-02", skip: 100 })).toEqual({
      result: "empty",
    });
  });
});

describe("L2: a settlement's lines in keyset pages of 50", () => {
  it("120 lines: 50, 50 and 20, in order, none twice; a bad cursor is 400", async () => {
    const o = await owner();
    const T = Date.now();
    const sid = uuidv7();
    await env.DB.prepare(
      `INSERT INTO settlements (id, provider, settlement_id, utr, currency, amount_minor, fees_minor, tax_minor, settled_at, settled_on, status, fetched_at)
       VALUES (?1, 'razorpay', ?2, NULL, 'INR', 120000, 0, 0, ?3, '2026-11-02', 'processed', ?3)`,
    )
      .bind(sid, `setl_L2${T}`, T)
      .run();
    const ids: string[] = [];
    for (let i = 0; i < 120; i++) {
      const id = uuidv7();
      ids.push(id);
      await env.DB.prepare(
        `INSERT INTO settlement_items (id, settlement_id, provider, entity_type, entity_id, direction, amount_minor, fee_minor, tax_minor, "match", created_at)
         VALUES (?1, ?2, 'razorpay', 'payment', ?3, 'credit', 1000, 0, 0, 'unmatched', ?4)`,
      )
        .bind(id, sid, `pay_L2${T}${String(i).padStart(3, "0")}`, T + Math.floor(i / 3))
        .run();
    }
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | null = null;
    for (let n = 0; n < 5; n++) {
      const res = await call(
        `/reconciliation/settlements/${sid}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        { cookie: o.cookie },
      );
      expect(res.status).toBe(200);
      const body = (await json(res)) as J;
      expect(body.settlement.id).toBe(sid);
      sizes.push((body.items as J[]).length);
      seen.push(...(body.items as J[]).map((i) => i.id as string));
      cursor = body.next;
      if (!cursor) break;
    }
    expect(sizes).toEqual([50, 50, 20]);
    expect(seen).toEqual(ids);
    expect(
      (await call(`/reconciliation/settlements/${sid}?cursor=nonsense`, { cookie: o.cookie })).status,
    ).toBe(400);
  });
});
