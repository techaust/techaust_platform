// M6.5 code review part 1, the fixes at route level [ADM-PAY-08, -10, ADM-INV-17; run file "Code review part 1" findings 2, 3, 6, 8, 9, 10 and the screen review's
// P2-4, P2-10, P2-13]: the ₹10 lakh declaration cap per invoice, RA-41's facts on every confirm answer and the credit-held list, the refund's credit note, the
// bank's INR figure for a USD refund, the written request with "own account", every settlement of a recon day, each payment's own gateway on the panel, and the
// ₹25 lakh line from the balance still payable. No test reaches a gateway: the stub transports answer. Invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core/ids";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStubTransport } from "./gateway/config.ts";
import { stub } from "./test-gateway.ts";
import { call, one, sessionFor } from "./test-helpers.ts";
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
      issueDate: "2026-10-20",
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
    // not sent: the server links the invoice's newest issued one
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
