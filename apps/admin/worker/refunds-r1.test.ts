// M6.5 code review part 1, the fixes at route level [ADM-PAY-08, -10, ADM-INV-17; run file "Code review part 1" findings 2, 3, 6, 8, 9, 10 and the screen review's
// P2-4, P2-10, P2-13]: the ₹10 lakh declaration cap per invoice, RA-41's facts on every confirm answer and the credit-held list, the refund's credit note, the
// bank's INR figure for a USD refund, the written request with "own account", every settlement of a recon day, each payment's own gateway on the panel, and the
// ₹25 lakh line from the balance still payable. No test reaches a gateway: the stub transports answer. Invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStubTransport } from "./gateway/config.ts";
import { fetchSettlements } from "./recon.ts";
import { recordingQueue, stub } from "./test-gateway.ts";
import { call, one, sessionFor, withEnv } from "./test-helpers.ts";
import { todayIso } from "./test-invoice-types.ts";
import { type J, json, putCompany } from "./test-invoices.ts";
import { recordBody, recorded } from "./test-payments.ts";
import { addDoc, line, mkReportClient } from "./test-reports.ts";

const owner = () => sessionFor("owner", { stepUp: true });
beforeEach(async () => {
  await putCompany();
  stub();
});
afterEach(() => {
  setStubTransport(null);
});

describe("finding 2: the ₹10 lakh declaration cap is per invoice [RB-43]", () => {
  it("$9,000 declared, then $9,000 more on the same invoice: 409 declaration_too_large, nothing written; the bank's own approval still goes in", async () => {
    const o = await owner();
    const clientId = await mkReportClient("USD");
    // $50,000 at ₹83.1234: $9,000 is ₹7,48,110.60
    const inv = await addDoc({
      clientId,
      currency: "USD",
      issueDate: "2026-10-05",
      lines: [line(5_000_000)],
    });
    const reduce = (amountMinor: number, declaration: boolean) =>
      call(`/invoices/${inv.id}/realisation-reductions`, {
        cookie: o.cookie,
        body: {
          id: uuidv7(),
          amountMinor,
          approvedOn: todayIso(),
          bankRef: `ADB-${amountMinor}`,
          declaration,
        },
      });
    expect((await reduce(900_000, true)).status).toBe(200);
    const second = await reduce(900_000, true);
    expect(second.status).toBe(409);
    const e = ((await json(second)) as J).error;
    expect(e.code).toBe("declaration_too_large");
    expect(e.details.declaredMinor).toBe(900_000);
    expect(
      await one<{ n: number }>(
        "SELECT count(*) AS n FROM realisation_reductions WHERE document_id = ?1",
        inv.id,
      ),
    ).toEqual({ n: 1 });
    expect((await reduce(900_000, false)).status).toBe(200);
    // a future day (IST) is refused
    const later = await call(`/invoices/${inv.id}/realisation-reductions`, {
      cookie: o.cookie,
      body: {
        id: uuidv7(),
        amountMinor: 1_000,
        approvedOn: "2099-01-01",
        bankRef: "ADB-F",
        declaration: false,
      },
    });
    expect(later.status).toBe(400);
  });
});

const manual = (amountMinor: number, o: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  amountMinor,
  from: "credit",
  reasonCode: "overpayment",
  manual: {
    mode: "neft",
    reference: `UTRB5${Date.now().toString(36).toUpperCase()}`,
    paidOn: todayIso(),
    paidTo: "original",
  },
  ...o,
});

describe("finding 6: a refund of an invoice's excess names its credit note [RA-40]", () => {
  it("the dialog's facts name the newest issued credit note; the refund links it (sent or not); another invoice's note is 409 credit_note_mismatch, nothing written", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const inv = await addDoc({ clientId, issueDate: "2026-10-05" });
    const total = inv.computed.totalMinor;
    const p = await recorded(o, recordBody(clientId, total, [{ documentId: inv.id, amountMinor: total }]));
    const note = await addDoc({
      clientId,
      type: "credit_note",
      parentId: inv.id,
      // issued on the day the payment arrived (second review, M6: a note older than the payment is not linked)
      issueDate: todayIso(),
      lines: [line(10_000)],
    });
    await env.DB.prepare(
      "UPDATE documents SET credited_minor = 10000, updated_at = updated_at + 1 WHERE id = ?",
    )
      .bind(inv.id)
      .run();
    const facts = (
      (await json(await call(`/payments/${p.id}/refunds?documentId=${inv.id}`, { cookie: o.cookie }))) as J
    ).facts;
    expect(facts.issuedCreditNote).toEqual({ id: note.id, number: note.number });
    // another invoice's credit note: refused before anything is written
    const other = await addDoc({ clientId, issueDate: "2026-10-06" });
    const otherNote = await addDoc({
      clientId,
      type: "credit_note",
      parentId: other.id,
      issueDate: "2026-10-21",
      lines: [line(1_000)],
    });
    const wrong = manual(4_000, {
      from: "document",
      documentId: inv.id,
      reasonCode: "credit_note",
      creditNoteId: otherNote.id,
    });
    const bad = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: wrong });
    expect(bad.status).toBe(409);
    expect(((await json(bad)) as J).error.code).toBe("credit_note_mismatch");
    expect(await one("SELECT id FROM payment_refunds WHERE id = ?1", wrong.id)).toBeNull();
    // sent by the dialog
    const sent = manual(4_000, {
      from: "document",
      documentId: inv.id,
      reasonCode: "credit_note",
      creditNoteId: note.id,
    });
    expect((await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: sent })).status).toBe(200);
    expect(await one("SELECT credit_note_id FROM payment_refunds WHERE id = ?1", sent.id)).toEqual({
      credit_note_id: note.id,
    });
    // not sent: the server links the newest one issued since the payment arrived that covers the refund
    const derived = manual(3_000, { from: "document", documentId: inv.id, reasonCode: "credit_note" });
    const res = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: derived });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await json(res)) as J).refund.creditNoteId).toBe(note.id);
  });
});

describe("finding 10: a refund to the payer's own other account needs their written request [RB-24]", () => {
  it("own_account without writtenRequest: 400, nothing written; with it: recorded and in the audit summary", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const p = await recorded(o, recordBody(clientId, 5_000));
    const own = (written: boolean) =>
      manual(1_000, {
        manual: {
          mode: "neft",
          reference: `UTROWN${written ? 1 : 0}${Date.now().toString(36).toUpperCase()}`,
          paidOn: todayIso(),
          paidTo: "own_account",
          ...(written ? { writtenRequest: true } : {}),
        },
      });
    const missing = own(false);
    expect((await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: missing })).status).toBe(400);
    expect(await one("SELECT id FROM payment_refunds WHERE id = ?1", missing.id)).toBeNull();
    const ok = own(true);
    const res = await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: ok });
    expect(res.status, await res.clone().text()).toBe(200);
    const audit = await one<{ summary: string }>(
      "SELECT summary FROM audit_log WHERE action = 'refund.issue' AND entity_id = ?1",
      ok.id,
    );
    expect(JSON.parse(audit?.summary ?? "{}")).toMatchObject({ paidTo: "own_account", writtenRequest: true });
  });
});

describe("screen review P2-4 and P2-10: the panel's own gateway per payment, and the ₹25 lakh line from the balance", () => {
  it("each payment carries its own provider (a gateway payment that reached this invoice another way is not 'manual')", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    const inv = await addDoc({ clientId, issueDate: "2026-10-05" });
    const manualPay = await recorded(
      o,
      recordBody(clientId, 2_000, [{ documentId: inv.id, amountMinor: 2_000 }]),
    );
    // a Razorpay payment made on ANOTHER document's link, then put on this invoice (as a proforma's advance invoice or moved excess leaves it)
    const elsewhere = await addDoc({ clientId, issueDate: "2026-10-05" });
    const T = Date.now();
    const ck = uuidv7();
    await env.DB.prepare(
      `INSERT INTO checkout_sessions (id, provider, document_id, client_id, created_by, source, currency, amount_minor, status, expires_at, created_at, updated_at)
       VALUES (?1, 'razorpay', ?2, ?3, ?4, 'staff', 'INR', 3000, 'creating', ?5, ?6, ?6)`,
    )
      .bind(ck, elsewhere.id, clientId, o.id, T + 86_400_000, T)
      .run();
    await env.DB.prepare(
      "UPDATE checkout_sessions SET status = 'live', provider_link_id = ?2, short_url = 'https://rzp.io/i/x', updated_at = ?3 WHERE id = ?1",
    )
      .bind(ck, `plink_P24${T}`, T + 1)
      .run();
    const gwId = uuidv7();
    await env.DB.prepare(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, charges_minor, fee_tax_minor, received_on, mode, reference_norm, recorded_at, provider_payment_id, checkout_id, refetched_at)
       VALUES (?1, ?2, 'payment', 'razorpay', 'pending_verification', 'INR', 3000, 0, 0, ?3, 'upi', ?4, ?5, ?4, ?6, ?5)`,
    )
      .bind(gwId, clientId, todayIso(), `pay_P24${T}`, T, ck)
      .run();
    await env.DB.prepare(
      "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
    )
      .bind(gwId, o.id, T + 5)
      .run();
    await env.DB.prepare(
      "INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_by, created_at) VALUES (?1, ?2, ?3, 1000, 'allocate', ?4, ?5)",
    )
      .bind(uuidv7(), gwId, inv.id, o.id, T + 6)
      .run();
    const panel = (await json(await call(`/invoices/${inv.id}/payments`, { cookie: o.cookie }))) as J;
    const providerOf = (id: string) => (panel.payments as J[]).find((r) => r.paymentId === id)?.provider;
    expect(providerOf(gwId)).toBe("razorpay");
    expect(providerOf(manualPay.id)).toBe("manual");
    // this invoice's own checkouts never knew it
    expect(JSON.stringify(panel.gateway?.payments ?? [])).not.toContain(gwId);
  });

  it("a USD invoice paid in full shows no ₹25 lakh line; one with a balance is checked on the balance, not the total", async () => {
    const o = await owner();
    const clientId = await mkReportClient("USD");
    // $40,000 at ₹83.1234 is about ₹33 lakh: above the cap as a total
    const paid = await addDoc({
      clientId,
      currency: "USD",
      issueDate: todayIso(),
      lines: [line(4_000_000)],
      paid: "total",
      balance: 0,
      over: { fx_date: todayIso() },
    });
    const paidPanel = (await json(await call(`/invoices/${paid.id}/payments`, { cookie: o.cookie }))) as J;
    expect(paidPanel.paCb).toBeNull();
    // the same invoice with $1,000 still to pay: about ₹83,124, under the cap
    const part = await addDoc({
      clientId,
      currency: "USD",
      issueDate: todayIso(),
      lines: [line(4_000_000)],
      balance: 100_000,
      over: { fx_date: todayIso() },
    });
    const partPanel = (await json(await call(`/invoices/${part.id}/payments`, { cookie: o.cookie }))) as J;
    expect(partPanel.paCb.paypal).toMatchObject({ ok: true, inrMinor: 8_312_340 });
  });
});

describe("finding 8 and screen review P2-13: every settlement of a recon day is fetched and linked [ADM-PAY-10, L11]", () => {
  it("a page naming 7 new settlements: 5 now and the same page again for the rest; Fetch now hands the rest of the day to the jobs Worker", async () => {
    const T = Date.now();
    const ids = Array.from({ length: 7 }, (_, i) => `setl_B5${T}${i}`);
    const entity = (i: number) => `pay_B5${T}${i}`;
    stub((path) => {
      if (path === "/v1/settlements/recon/combined")
        return Response.json({
          count: 7,
          items: ids.map((sid, i) => ({
            entity_id: entity(i),
            type: "payment",
            amount: 1_000 + i,
            fee: 0,
            tax: 0,
            credit: 1_000 + i,
            debit: 0,
            currency: "INR",
            settlement_id: sid,
            settled_at: 1_793_000_000,
          })),
        });
      const m = /^\/v1\/settlements\/(setl_B5\d+)$/.exec(path);
      if (m)
        return Response.json({
          id: m[1],
          entity: "settlement",
          amount: 1_000,
          fees: 0,
          tax: 0,
          utr: `UTR${m[1]?.slice(-4)}`,
          status: "processed",
          created_at: 1_793_000_000,
        });
      return null;
    });
    const linked = async () =>
      (
        await one<{ n: number }>(
          "SELECT count(*) AS n FROM settlement_items WHERE entity_id LIKE ?1 AND settlement_id IS NOT NULL",
          `pay_B5${T}%`,
        )
      )?.n;
    expect(await fetchSettlements(env, { provider: "razorpay", day: "2026-11-02", skip: 0 })).toEqual({
      result: "stored",
      next: { skip: 0 },
    });
    expect(await linked()).toBe(5);
    expect(await fetchSettlements(env, { provider: "razorpay", day: "2026-11-02", skip: 0 })).toEqual({
      result: "stored",
    });
    expect(await linked()).toBe(7);
    expect(
      await one<{ n: number }>(
        "SELECT count(*) AS n FROM settlements WHERE settlement_id LIKE ?1",
        `setl_B5${T}%`,
      ),
    ).toEqual({ n: 7 });
    // Fetch now on another day whose page names more than one call fetches: the next page goes to the jobs Worker
    const ids2 = ids.map((s) => `${s}x`);
    stub((path) => {
      if (path === "/v1/settlements/recon/combined")
        return Response.json({
          count: 7,
          items: ids2.map((sid, i) => ({
            entity_id: `${entity(i)}x`,
            type: "payment",
            amount: 2_000,
            fee: 0,
            tax: 0,
            credit: 2_000,
            debit: 0,
            currency: "INR",
            settlement_id: sid,
            settled_at: 1_793_000_000,
          })),
        });
      const m = /^\/v1\/settlements\/(setl_B5\d+x)$/.exec(path);
      return m
        ? Response.json({
            id: m[1],
            entity: "settlement",
            amount: 2_000,
            fees: 0,
            tax: 0,
            utr: null,
            status: "processed",
            created_at: 1_793_000_000,
          })
        : null;
    });
    const q = recordingQueue();
    const o = await owner();
    const res = await call(
      "/reconciliation/settlements/fetch",
      { cookie: o.cookie, body: { day: "2026-11-01" } },
      withEnv(env, { LEADS_QUEUE: q.queue }),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await json(res)) as J).continued).toBe(true);
    expect(q.sent).toEqual([{ kind: "recon.fetch", provider: "razorpay", day: "2026-11-01", skip: 0 }]);
  });
});

describe("finding 9: the bank's INR figure of a USD refund [L9]", () => {
  it("the Owner records it once for a USD refund that went out; again, or for an INR refund, is 409; Staff can't", async () => {
    const o = await owner();
    const clientId = await mkReportClient("USD");
    const T = Date.now();
    const paymentId = uuidv7();
    await env.DB.prepare(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, reference_norm, recorded_by, recorded_at, verified_by, verified_at)
       VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'USD', 50000, ?3, 'swift', ?4, ?5, ?6, ?5, ?6)`,
    )
      .bind(paymentId, clientId, todayIso(), `SWIFTB5${T}`, o.id, T)
      .run();
    const usd = manual(10_000, {
      confirmExport: true,
      manual: { mode: "swift", reference: `SWIFTRF${T}`, paidOn: todayIso(), paidTo: "original" },
    });
    const made = await call(`/payments/${paymentId}/refunds`, { cookie: o.cookie, body: usd });
    expect(made.status, await made.clone().text()).toBe(200);
    const inr = (body: unknown, s = o) => call(`/refunds/${usd.id}/inr`, { cookie: s.cookie, body });
    expect((await inr({ inrMinor: 830_000 }, await sessionFor("staff", { stepUp: true }))).status).toBe(403);
    const ok = await inr({ inrMinor: 830_000 });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(((await json(ok)) as J).refund.inrRefundedMinor).toBe(830_000);
    const again = await inr({ inrMinor: 1 });
    expect(again.status).toBe(409);
    expect(((await json(again)) as J).error.code).toBe("inr_already_set");
    // an INR refund has no INR figure to record
    const inrClient = await mkReportClient("INR");
    const p = await recorded(o, recordBody(inrClient, 2_000));
    const rupee = manual(500);
    expect((await call(`/payments/${p.id}/refunds`, { cookie: o.cookie, body: rupee })).status).toBe(200);
    const no = await call(`/refunds/${rupee.id}/inr`, { cookie: o.cookie, body: { inrMinor: 500 } });
    expect(no.status).toBe(409);
    expect(((await json(no)) as J).error.code).toBe("inr_not_applicable");
  });
});

describe("finding 3: RA-41 on every confirm, the Payments panel, and credit held at a period's end [RA-41]", () => {
  it("the Owner's record answers the RA-41 facts; the panel carries them per payment; the period-end list shows credit on no invoice and above ₹1,000 over one, not ₹1,000 or less", async () => {
    const o = await owner();
    const clientId = await mkReportClient("INR");
    // on no invoice: may be an advance
    const loose = (await json(
      await call("/payments", { cookie: o.cookie, body: recordBody(clientId, 5_000) }),
    )) as J;
    expect(loose.ra41).toMatchObject({ advanceLine: "credit_may_be_advance" });
    // ₹1,000 or less over an invoice: the proviso, no line
    const inv = await addDoc({ clientId, issueDate: "2026-10-05" });
    const total = inv.computed.totalMinor;
    const small = (await json(
      await call("/payments", {
        cookie: o.cookie,
        body: recordBody(clientId, total + 100_000, [{ documentId: inv.id, amountMinor: total }]),
      }),
    )) as J;
    expect(small.ra41).toMatchObject({ advanceLine: null });
    const inv2 = await addDoc({ clientId, issueDate: "2026-10-05" });
    const big = (await json(
      await call("/payments", {
        cookie: o.cookie,
        body: recordBody(clientId, total + 100_001, [{ documentId: inv2.id, amountMinor: total }]),
      }),
    )) as J;
    expect(big.ra41).toMatchObject({ advanceLine: "credit_may_be_advance" });
    const panel = (await json(await call(`/invoices/${inv2.id}/payments`, { cookie: o.cookie }))) as J;
    expect(panel.receipts[big.id].ra41).toMatchObject({ advanceLine: "credit_may_be_advance" });
    // the period-end list (the Owner and the Accountant): by default the latest return period that has ended (Settings › Tax: quarterly by default)
    const accountant = await sessionFor("accountant");
    const first = (await json(await call("/payments/credit-held", { cookie: accountant.cookie }))) as J;
    const end = first.periodEnd as string;
    expect(first.period).toMatch(/^\d{4}-(Q[1-4]|\d{2})$/);
    // the payments recorded today were not confirmed at that period's end: not listed
    expect((first.items as J[]).map((r) => r.paymentId)).not.toContain(loose.id);
    // a payment on no invoice, confirmed on the period's last day: listed, held since that day (the db test covers allocations and refunds as of the end)
    const noon = Date.parse(`${end}T12:00:00+05:30`);
    const held = uuidv7();
    await env.DB.prepare(
      `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, reference_norm, recorded_by, recorded_at, verified_by, verified_at)
       VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'INR', 300000, ?3, 'neft', ?4, ?5, ?6, ?5, ?6)`,
    )
      .bind(held, clientId, end, `UTRHELD${noon}`, o.id, noon)
      .run();
    const again = (await json(
      await call(`/payments/credit-held?period=${first.period}`, { cookie: accountant.cookie }),
    )) as J;
    const row = (again.items as J[]).find((r) => r.paymentId === held);
    expect(row).toMatchObject({ creditMinor: 300_000, onInvoice: false, heldSince: end, clientId });
    expect((await call("/payments/credit-held", { cookie: (await sessionFor("staff")).cookie })).status).toBe(
      403,
    );
    expect((await call("/payments/credit-held?period=2999-Q1", { cookie: o.cookie })).status).toBe(400);
    expect((await call("/payments/credit-held?period=nonsense", { cookie: o.cookie })).status).toBe(400);
  });
});
