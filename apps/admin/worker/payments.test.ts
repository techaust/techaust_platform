// The payment API (M6.1; ADM-PAY-01, ADM-PAY-05, ADM-PAY-06, ADM-INV-16, ADM-INV-17, ADM-APR-01, Q60; run file F): who may record, check, withdraw and move
// credit; the refusals in 07-ZH's words; races; TDS; proofs; FEMA extensions; and the reads that follow the ledger. All names, references and amounts are
// invented test data.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkClient, mkContact } from "./test-clients.ts";
import { call, NOON_IST_MID_FY, one, pinClock, rows, sessionFor, withDb } from "./test-helpers.ts";
import { currentFy, mkProforma, todayIso } from "./test-invoice-types.ts";
import { codeOf, issueInvoice, type J, json, putBank, putCompany, voidInvoice } from "./test-invoices.ts";
import { issueCredit, mkIssuedInvoice } from "./test-notes.ts";
import {
  ledgerOf,
  paymentRow,
  putDoc,
  record,
  recordBody,
  recorded,
  ref,
  tdsBody,
  today,
  verify,
} from "./test-payments.ts";
import { mkProject, PDF_BYTES, PNG_BYTES } from "./test-projects.ts";
import { addDoc, mkReportClient } from "./test-reports.ts";

const owner = () => sessionFor("owner", { stepUp: true });
const TOTAL = 118_000; // addDoc's default line (100,000 taxable at 18 %)

beforeEach(async () => {
  await putCompany();
});
afterEach(() => vi.useRealTimers());

async function invoiceFor(currency: "INR" | "USD" = "INR", issueDate = "2026-10-05") {
  const clientId = await mkReportClient(currency);
  const inv = await addDoc({ clientId, currency, issueDate });
  return { clientId, inv };
}

describe("who may record and check [ADM-PAY-05; owner Q2 A]", () => {
  it("the Owner without a fresh code gets 403 step_up_required on record and verify", async () => {
    const o = await sessionFor("owner");
    const { clientId } = await invoiceFor();
    const res = await record(o, recordBody(clientId, 1_000));
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("step_up_required");
    const staff = await sessionFor("staff");
    const made = await recorded(staff, recordBody(clientId, 1_000));
    const v = await verify(o, made.id, "confirm");
    expect(v.status).toBe(403);
    expect(await codeOf(v)).toBe("step_up_required");
  });

  it("the Owner's entry is confirmed in the same batch: the invoice is paid, the rest is credit (07-ZH line 9)", async () => {
    const o = await owner();
    const { clientId, inv } = await invoiceFor();
    const body = recordBody(clientId, 120_000, [{ documentId: inv.id, amountMinor: TOTAL }]);
    const made = await recorded(o, body);
    expect(made).toMatchObject({ status: "confirmed", unallocatedMinor: 2_000, warnings: [] });
    expect(await ledgerOf(inv.id)).toMatchObject({ status: "paid", paid_minor: TOTAL, balance_minor: 0 });
    const credit = await json(await call(`/clients/${clientId}/credit`, { cookie: o.cookie }));
    expect(credit.credits).toEqual([{ currency: "INR", creditMinor: 2_000 }]);
    expect(
      await one(
        "SELECT count(*) AS n FROM audit_log WHERE entity_id = ? AND action = 'payment.record'",
        body.id,
      ),
    ).toEqual({
      n: 1,
    });
  });

  it("Staff's entry waits: pending, an approval row, a bell for each Owner in 07-ZH line 5's words; the balance does not move", async () => {
    const o = await owner();
    const staff = await sessionFor("staff", { name: "Mira Staff" });
    const { clientId, inv } = await invoiceFor();
    const made = await recorded(
      staff,
      recordBody(clientId, 50_000, [{ documentId: inv.id, amountMinor: 50_000 }]),
    );
    expect(made.status).toBe("pending_verification");
    const row = await paymentRow(made.id);
    expect(row.status).toBe("pending_verification");
    expect(JSON.parse(row.requested_allocations as string)).toEqual([
      { documentId: inv.id, amountMinor: 50_000 },
    ]);
    expect(await ledgerOf(inv.id)).toMatchObject({ paid_minor: 0, balance_minor: TOTAL });
    expect(
      await one("SELECT kind, status, document_id FROM approvals WHERE payment_id = ?", made.id),
    ).toEqual({
      kind: "payment_verify",
      status: "pending",
      document_id: null,
    });
    const bell = await one<{ title: string; link: string }>(
      "SELECT title, link FROM notifications WHERE entity_id = ? AND user_id = ? AND kind = 'payment.verify'",
      made.id,
      o.id,
    );
    expect(bell?.title).toMatch(/^Mira Staff recorded a payment of .*500\.00 from .+\. Check it\.$/);
    expect(bell?.link).toBe(`/payments/${made.id}`);
    // A Staff entry with no allocation stores none (NULL, not an empty list).
    const bare = await recorded(staff, recordBody(clientId, 1_000));
    expect((await paymentRow(bare.id)).requested_allocations).toBeNull();
  });

  it("the list filters by status through the partial indexes (pending and confirmed answer 200)", async () => {
    const o = await owner();
    const staff = await sessionFor("staff", { name: "Mira Staff" });
    const { clientId, inv } = await invoiceFor();
    const waiting = await recorded(staff, recordBody(clientId, 1_000));
    const done = await recorded(o, recordBody(clientId, 2_000, [{ documentId: inv.id, amountMinor: 2_000 }]));
    const pending = await call("/payments?status=pending_verification", { cookie: o.cookie });
    expect(pending.status).toBe(200);
    const p = (await json(pending)) as { payments: { id: string }[] };
    expect(p.payments.map((x) => x.id)).toContain(waiting.id);
    expect(p.payments.map((x) => x.id)).not.toContain(done.id);
    const confirmed = await call("/payments?status=confirmed", { cookie: o.cookie });
    expect(confirmed.status).toBe(200);
    const c = (await json(confirmed)) as { payments: { id: string }[] };
    expect(c.payments.map((x) => x.id)).toContain(done.id);
    expect(c.payments.map((x) => x.id)).not.toContain(waiting.id);
  });

  it("Sales gets 403 on every payment route; the Accountant reads and gets 403 on every write", async () => {
    const sales = await sessionFor("sales", { stepUp: true });
    const acc = await sessionFor("accountant", { stepUp: true });
    const o = await owner();
    const { clientId, inv } = await invoiceFor();
    const made = await recorded(o, recordBody(clientId, 1_000));
    for (const path of [
      "/payments",
      `/payments/${made.id}`,
      `/clients/${clientId}/credit`,
      `/invoices/${inv.id}/payments`,
    ])
      expect((await call(path, { cookie: sales.cookie })).status, path).toBe(403);
    for (const path of [
      "/payments",
      `/payments/${made.id}`,
      `/clients/${clientId}/credit`,
      `/invoices/${inv.id}/payments`,
    ])
      expect((await call(path, { cookie: acc.cookie })).status, path).toBe(200);
    expect((await call("/reports/payments?fy=2627", { cookie: acc.cookie })).status).toBe(200);
    const writes: [string, unknown][] = [
      ["/payments", recordBody(clientId, 1_000)],
      [`/payments/${made.id}/verify`, { decision: "confirm", expectedRecordedAt: 1 }],
      [`/payments/${made.id}/withdraw`, { reason: "x" }],
      [`/payments/${made.id}/tds-certificate`, { certificateNo: "A", certificateOn: todayIso() }],
      [`/clients/${clientId}/credit/apply`, { documentId: inv.id, amountMinor: 1, expectedUpdatedAt: 1 }],
      [`/invoices/${inv.id}/credit/release`, { amountMinor: 1, expectedUpdatedAt: 1 }],
      [`/invoices/${inv.id}/realisation-extensions`, { extendedTo: "2030-01-01", bankRef: "X" }],
    ];
    for (const [path, body] of writes) {
      expect((await call(path, { cookie: acc.cookie, body })).status, `accountant ${path}`).toBe(403);
      expect((await call(path, { cookie: sales.cookie, body })).status, `sales ${path}`).toBe(403);
    }
    const proof = await putDoc(`/payments/${made.id}/proof`, PDF_BYTES, {
      cookie: acc.cookie,
      headers: { "X-Proof-Kind": "Advice" },
    });
    expect(proof.status).toBe(403);
  });
});

describe("the Owner's check [ADM-PAY-05, L6, L18]", () => {
  it("confirm puts the money on the invoice and rings the requester (07-ZH line 6); a second check is 409 payment_not_pending", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const { clientId, inv } = await invoiceFor();
    const made = await recorded(
      staff,
      recordBody(clientId, 50_000, [{ documentId: inv.id, amountMinor: 50_000 }]),
    );
    const res = await verify(o, made.id, "confirm");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await ledgerOf(inv.id)).toMatchObject({
      status: "partially_paid",
      paid_minor: 50_000,
      balance_minor: 68_000,
    });
    const bell = await one<{ title: string }>(
      "SELECT title FROM notifications WHERE entity_id = ? AND user_id = ? AND kind = 'payment.decided'",
      made.id,
      staff.id,
    );
    expect(bell?.title).toMatch(/^Your payment of .*500\.00 from .+ was confirmed\.$/);
    expect((await one("SELECT status FROM approvals WHERE payment_id = ?", made.id))?.status).toBe(
      "approved",
    );
    const again = await verify(o, made.id, "confirm");
    expect(again.status).toBe(409);
    expect(await json(again)).toMatchObject({
      error: { code: "payment_not_pending", message: "This payment was already checked." },
    });
    // Staff never checks.
    const other = await recorded(staff, recordBody(clientId, 10));
    expect((await verify(await sessionFor("staff", { stepUp: true }), other.id, "confirm")).status).toBe(403);
  });

  it("reject needs a reason, rings the requester with it, and moves nothing", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const { clientId, inv } = await invoiceFor();
    const made = await recorded(
      staff,
      recordBody(clientId, 5_000, [{ documentId: inv.id, amountMinor: 5_000 }]),
    );
    expect(await codeOf(await verify(o, made.id, "reject"))).toBe("reason_required");
    const res = await verify(o, made.id, "reject", { note: "Not in the bank statement" });
    expect(res.status).toBe(200);
    expect(await ledgerOf(inv.id)).toMatchObject({ paid_minor: 0 });
    const bell = await one<{ title: string }>(
      "SELECT title FROM notifications WHERE entity_id = ? AND kind = 'payment.decided'",
      made.id,
    );
    expect(bell?.title).toMatch(/was rejected: Not in the bank statement\.$/);
  });

  it("the approvals queue lists the payment and refuses to decide it there (409 use_payment_verify)", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const { clientId } = await invoiceFor();
    const made = await recorded(staff, recordBody(clientId, 700));
    const list = await json(await call("/approvals?kind=payment", { cookie: o.cookie }));
    const item = list.approvals.find((a: J) => a.payment.id === made.id);
    expect(item).toMatchObject({ kind: "payment", state: "pending", payment: { amountMinor: 700 } });
    const res = await call(`/approvals/${item.id}/decide`, {
      cookie: o.cookie,
      body: { decision: "approve" },
    });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("use_payment_verify");
  });

  it("two parallel confirms over the balance: exactly one succeeds", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const { clientId, inv } = await invoiceFor();
    const a = await recorded(
      staff,
      recordBody(clientId, TOTAL, [{ documentId: inv.id, amountMinor: TOTAL }]),
    );
    const b = await recorded(
      staff,
      recordBody(clientId, TOTAL, [{ documentId: inv.id, amountMinor: TOTAL }]),
    );
    const res = await Promise.all([verify(o, a.id, "confirm"), verify(o, b.id, "confirm")]);
    const statuses = res.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const refused = res.find((r) => r.status === 409) as Response;
    expect(["allocation_exceeds_balance", "ledger_changed"]).toContain(await codeOf(refused));
    expect(await ledgerOf(inv.id)).toMatchObject({ paid_minor: TOTAL, balance_minor: 0, status: "paid" });
    const confirmed = await rows(
      "SELECT id FROM payments WHERE id IN (?, ?) AND status = 'confirmed'",
      a.id,
      b.id,
    );
    expect(confirmed).toHaveLength(1);
  });
});

describe("refusals [L12, 07-ZH line 13]", () => {
  it("the same id again is 409 already_recorded and writes nothing", async () => {
    const o = await owner();
    const { clientId } = await invoiceFor();
    const body = recordBody(clientId, 1_000);
    await recorded(o, body);
    const res = await record(o, { ...body, reference: ref() });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("already_recorded");
    expect(await one("SELECT count(*) AS n FROM audit_log WHERE entity_id = ?", body.id)).toEqual({ n: 1 });
  });

  it("a reference already seen is 409 reference_seen with its day and client, then recorded with confirmDuplicate", async () => {
    const o = await owner();
    const { clientId } = await invoiceFor();
    const r = ref();
    await recorded(o, recordBody(clientId, 1_000, [], { reference: r }));
    const again = recordBody(clientId, 1_000, [], { reference: ` ${r.toLowerCase()} ` });
    const res = await record(o, again);
    expect(res.status).toBe(409);
    const b = await json(res);
    expect(b.error.code).toBe("reference_seen");
    expect(b.error.message).toMatch(
      /^This bank reference was already recorded on \d{2} \w{3} \d{4} for .+\. Record it again only if it is a different payment\.$/,
    );
    expect(b.error.details).toMatchObject({ receivedOn: today() });
    expect((await record(o, { ...again, confirmDuplicate: true })).status).toBe(201);
  });

  it("a reference that does not normalise is 400 reference_invalid; money received needs one", async () => {
    const o = await owner();
    const { clientId } = await invoiceFor();
    expect(await codeOf(await record(o, recordBody(clientId, 1_000, [], { reference: "@@@" })))).toBe(
      "reference_invalid",
    );
    expect((await record(o, recordBody(clientId, 1_000, [], { reference: undefined }))).status).toBe(400);
  });

  it("an anonymised client takes no payment (409 client_anonymised)", async () => {
    const o = await owner();
    const { clientId } = await invoiceFor();
    await env.DB.prepare("UPDATE clients SET anonymised_at = 1 WHERE id = ?").bind(clientId).run();
    const res = await record(o, recordBody(clientId, 1_000));
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("client_anonymised");
  });

  it("more than the invoice owes is 409 allocation_exceeds_balance in 07-ZH's words", async () => {
    const o = await owner();
    const { clientId, inv } = await invoiceFor();
    const res = await record(
      o,
      recordBody(clientId, 200_000, [{ documentId: inv.id, amountMinor: 119_000 }]),
    );
    expect(res.status).toBe(409);
    const b = await json(res);
    expect(b.error.code).toBe("allocation_exceeds_balance");
    expect(b.error.message).toMatch(/^This is more than the invoice still owes \(.*1,180\.00\)\.$/);
    expect(b.error.details).toEqual({ documentId: inv.id, balanceMinor: TOTAL });
  });

  it("a received day in the future is refused", async () => {
    const o = await owner();
    const { clientId } = await invoiceFor();
    expect(await codeOf(await record(o, recordBody(clientId, 1, [], { receivedOn: "2099-01-01" })))).toBe(
      "received_on_future",
    );
  });
});

describe("a payment on a proforma [L5, 07-ZH line 12]", () => {
  it("the Owner's entry is refused; Staff's waits; the Owner's check is refused; the advance with paymentId confirms it, once", async () => {
    const o = await owner();
    await putBank();
    const staff = await sessionFor("staff");
    const pf = await mkProforma(o);
    expect((await issueInvoice(o, pf.id)).status).toBe(200);
    const clientId = (await one<{ client_id: string }>("SELECT client_id FROM documents WHERE id = ?", pf.id))
      ?.client_id as string;
    const total = (
      await one<{ total_minor: number }>("SELECT total_minor FROM documents WHERE id = ?", pf.id)
    )?.total_minor as number;
    const own = await record(o, recordBody(clientId, total, [{ documentId: pf.id, amountMinor: total }]));
    expect(await json(own)).toMatchObject({
      error: {
        code: "use_advance_invoice",
        message: "A payment on a proforma is confirmed by issuing the tax invoice for the payment received.",
      },
    });
    const staffBody = recordBody(clientId, total, [{ documentId: pf.id, amountMinor: total }]);
    const made = await recorded(staff, staffBody);
    expect(await codeOf(await verify(o, made.id, "confirm"))).toBe("use_advance_invoice");
    const stamp = (await one<{ updated_at: number }>("SELECT updated_at FROM documents WHERE id = ?", pf.id))
      ?.updated_at;
    const advance = (amount: number, paymentId: string, reference = staffBody.reference) =>
      call(`/invoices/${pf.id}/advance-invoice`, {
        cookie: o.cookie,
        body: {
          expectedProformaUpdatedAt: stamp,
          amountMinor: amount,
          receivedOn: today(),
          reference,
          paymentId,
        },
      });
    expect(await codeOf(await advance(total - 1, made.id))).toBe("payment_mismatch");
    // early check 2, finding 7: the reference typed must be the entry's own
    expect(await codeOf(await advance(total, made.id, ref()))).toBe("payment_mismatch");
    const both = await Promise.all([advance(total, made.id), advance(total, made.id)]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    const invoices = await rows<{ id: string }>(
      "SELECT id FROM documents WHERE parent_id = ? AND type = 'tax_invoice' AND frozen_at IS NOT NULL",
      pf.id,
    );
    expect(invoices).toHaveLength(1);
    const row = await paymentRow(made.id);
    expect(row).toMatchObject({ status: "confirmed", verified_by: o.id });
    expect(row.advance_receipt_id).not.toBeNull();
    expect(await ledgerOf(invoices[0]?.id as string)).toMatchObject({ status: "paid", balance_minor: 0 });
    expect((await one("SELECT status FROM approvals WHERE payment_id = ?", made.id))?.status).toBe(
      "approved",
    );
    // the requester's bell rings (early check A7)
    expect(
      await one(
        "SELECT count(*) AS n FROM notifications WHERE entity_id = ? AND kind = 'payment.decided'",
        made.id,
      ),
    ).toEqual({ n: 1 });
    // an advance-backed payment is never withdrawn (L23.2)
    const w = await call(`/payments/${made.id}/withdraw`, { cookie: o.cookie, body: { reason: "x" } });
    expect(await codeOf(w)).toBe("payment_advance_backed");
  });
});

describe("withdraw [L7]", () => {
  it("a confirmed entry is withdrawn with a reason and the invoice owes again; a pending one is refused", async () => {
    const o = await owner();
    const { clientId, inv } = await invoiceFor();
    const made = await recorded(o, recordBody(clientId, TOTAL, [{ documentId: inv.id, amountMinor: TOTAL }]));
    const res = await call(`/payments/${made.id}/withdraw`, {
      cookie: o.cookie,
      body: { reason: "Entered twice" },
    });
    expect(res.status).toBe(200);
    expect(await ledgerOf(inv.id)).toMatchObject({ status: "issued", paid_minor: 0, balance_minor: TOTAL });
    expect((await paymentRow(made.id)).status).toBe("withdrawn");
    const staff = await sessionFor("staff");
    const p = await recorded(staff, recordBody(clientId, 10));
    expect(
      await codeOf(await call(`/payments/${p.id}/withdraw`, { cookie: o.cookie, body: { reason: "x" } })),
    ).toBe("payment_not_confirmed");
  });
});

describe("credit: use it, move an excess to it [L2, L13]", () => {
  it("apply is bounded by the balance and the credit; release by the excess", async () => {
    const o = await owner();
    const { clientId, inv } = await invoiceFor();
    await recorded(o, recordBody(clientId, 20_000));
    const stamp = async () => (await ledgerOf(inv.id)).updated_at;
    const apply = async (amountMinor: number) =>
      call(`/clients/${clientId}/credit/apply`, {
        cookie: o.cookie,
        body: { documentId: inv.id, amountMinor, expectedUpdatedAt: await stamp() },
      });
    expect(await codeOf(await apply(TOTAL + 1))).toBe("allocation_exceeds_balance");
    expect(await codeOf(await apply(20_001))).toBe("exceeds_credit");
    const ok = await apply(20_000);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await ledgerOf(inv.id)).toMatchObject({ paid_minor: 20_000, balance_minor: TOTAL - 20_000 });
    const stale = await call(`/clients/${clientId}/credit/apply`, {
      cookie: o.cookie,
      body: { documentId: inv.id, amountMinor: 1, expectedUpdatedAt: 1 },
    });
    expect(await codeOf(stale)).toBe("stale_version");
    // another client's invoice is not found here
    const other = await mkReportClient();
    expect(
      (
        await call(`/clients/${other}/credit/apply`, {
          cookie: o.cookie,
          body: { documentId: inv.id, amountMinor: 1, expectedUpdatedAt: await stamp() },
        })
      ).status,
    ).toBe(404);
    // release: pay the rest, then a credit note makes an excess of 10,000
    await recorded(
      o,
      recordBody(clientId, TOTAL - 20_000, [{ documentId: inv.id, amountMinor: TOTAL - 20_000 }]),
    );
    await env.DB.prepare(
      "UPDATE documents SET credited_minor = 10000, updated_at = updated_at + 1 WHERE id = ?",
    )
      .bind(inv.id)
      .run();
    const release = async (amountMinor: number) =>
      call(`/invoices/${inv.id}/credit/release`, {
        cookie: o.cookie,
        body: { amountMinor, expectedUpdatedAt: await stamp() },
      });
    expect(await codeOf(await release(10_001))).toBe("exceeds_excess");
    const rel = await release(10_000);
    expect(rel.status, await rel.clone().text()).toBe(200);
    expect(await ledgerOf(inv.id)).toMatchObject({ paid_minor: TOTAL - 10_000, balance_minor: 0 });
    const credit = await json(await call(`/clients/${clientId}/credit`, { cookie: o.cookie }));
    expect(credit.credits).toEqual([{ currency: "INR", creditMinor: 10_000 }]);
  });

  it("RA-17: credit from money that arrived in an earlier month warns (07-ZH line 10), never blocks", async () => {
    pinClock(NOON_IST_MID_FY); // 15 Oct 2026, IST
    const o = await owner();
    const clientId = await mkReportClient();
    const inv = await addDoc({ clientId, issueDate: "2026-10-05" });
    await recorded(o, recordBody(clientId, 5_000, [], { receivedOn: "2026-09-20" }));
    const res = await call(`/clients/${clientId}/credit/apply`, {
      cookie: o.cookie,
      body: {
        documentId: inv.id,
        amountMinor: 5_000,
        expectedUpdatedAt: (await ledgerOf(inv.id)).updated_at,
      },
    });
    expect(res.status).toBe(200);
    expect((await json(res)).warnings).toEqual([
      { code: "received_in_earlier_month", documentId: inv.id, month: "2026-09" },
    ]);
  });
});

describe("TDS [T8; Settled by the lead on the safest reading, 2026-10-30 (08-C RA-30)]", () => {
  it("TDS settles the balance; an export invoice or an overseas client refuses it (409 tds_not_allowed); the certificate is set once", async () => {
    const o = await owner();
    const { clientId, inv } = await invoiceFor();
    const made = await recorded(o, tdsBody(clientId, inv.id, 11_800));
    expect(await ledgerOf(inv.id)).toMatchObject({
      tds_minor: 11_800,
      paid_minor: 0,
      balance_minor: TOTAL - 11_800,
    });
    const view = await json(await call(`/payments/${made.id}`, { cookie: o.cookie }));
    expect(view.payment.tds).toMatchObject({ certificateAwaited: true });
    const cert = () =>
      call(`/payments/${made.id}/tds-certificate`, {
        cookie: o.cookie,
        body: { certificateNo: "16A-0001", certificateOn: todayIso() },
      });
    expect((await cert()).status).toBe(200);
    expect(await codeOf(await cert())).toBe("certificate_already_set");
    // an export invoice (here an INR one, for an overseas client) refuses TDS (L8: only tax invoices and debit notes of clients in India)
    const overseas = await mkReportClient("INR", { country: "US", gst_status: "overseas", state_code: null });
    const exp = await addDoc({ clientId: overseas, type: "export_invoice", issueDate: "2026-10-05" });
    const res = await record(o, tdsBody(overseas, exp.id, 1_000));
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({
      error: { code: "tds_not_allowed", message: "TDS applies only to rupee invoices for clients in India." },
    });
    // a USD client's TDS entry is refused before anything is written (the body's INR rule, then the client)
    const { clientId: usd, inv: usdInv } = await invoiceFor("USD");
    expect((await record(o, tdsBody(usd, usdInv.id, 1_000, { currency: "USD" }))).status).toBe(400);
    expect(await codeOf(await record(o, tdsBody(usd, usdInv.id, 1_000)))).toBe("currency_mismatch");
  });

  it("a credit note on an invoice with TDS keeps the identity: balance = total − paid − credited − TDS", async () => {
    const o = await owner();
    await putBank();
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    await recorded(o, tdsBody(inv.clientId, inv.id, 10_000));
    await issueCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 10_000 }] });
    const l = await ledgerOf(inv.id);
    expect(l.tds_minor).toBe(10_000);
    expect(l.balance_minor).toBe(l.total_minor - l.paid_minor - l.credited_minor - l.tds_minor);
    // core `ledgerStatusOf(total, paid + TDS, credited)`: the TDS counts as settled money, so the invoice reads part-paid.
    expect(l.status).toBe("partially_paid");
  });
});

describe("the proof [ADM-INV-17, L10, L11]", () => {
  it("is sniffed, at most 5 MB, set once, and streams back", async () => {
    const o = await owner();
    const { clientId } = await invoiceFor();
    const made = await recorded(o, recordBody(clientId, 1_000));
    const path = `/payments/${made.id}/proof`;
    const kind = { "X-Proof-Kind": "Bank%20advice" };
    expect((await putDoc(path, PDF_BYTES, { cookie: o.cookie, name: "a.txt", headers: kind })).status).toBe(
      415,
    );
    expect(
      await codeOf(await putDoc(path, PDF_BYTES, { cookie: o.cookie, name: "a.png", headers: kind })),
    ).toBe("file_type_mismatch");
    expect(
      (
        await putDoc(path, PDF_BYTES, {
          cookie: o.cookie,
          headers: kind,
          length: String(5 * 1024 * 1024 + 1),
        })
      ).status,
    ).toBe(413);
    expect((await putDoc(path, PDF_BYTES, { cookie: o.cookie })).status).toBe(400); // no proof type
    const ok = await putDoc(path, PNG_BYTES, { cookie: o.cookie, name: "advice.png", headers: kind });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const row = await paymentRow(made.id);
    expect(row).toMatchObject({ proof_kind: "Bank advice", proof_mime: "image/png" });
    expect(String(row.proof_r2_key)).toMatch(new RegExp(`^payments/${made.id}/proof-[0-9a-f]{64}$`));
    expect(await codeOf(await putDoc(path, PDF_BYTES, { cookie: o.cookie, headers: kind }))).toBe(
      "proof_already_set",
    );
    const got = await call(path, { cookie: o.cookie });
    expect(got.status).toBe(200);
    expect(got.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG_BYTES);
    // Staff may add one too; the object is in DOCS, never the file vault
    expect(await env.DOCS.head(String(row.proof_r2_key))).not.toBeNull();
  });
});

describe("FEMA extensions [Q60, L14; 08-C RB-04, RA-20]", () => {
  it("an extension moves the realisation stage; earlier or too far is refused", async () => {
    pinClock(NOON_IST_MID_FY); // 15 Oct 2026
    const o = await owner();
    const clientId = await mkReportClient("USD");
    const inv = await addDoc({ clientId, currency: "USD", issueDate: "2025-12-01" }); // FEMA 9 months: 1 Sep 2026, overdue
    const panel = async () => json(await call(`/invoices/${inv.id}/payments`, { cookie: o.cookie }));
    expect((await panel()).realisation).toMatchObject({
      femaDue: "2026-09-01",
      stage: "fema_overdue",
      extensions: [],
    });
    const extend = (extendedTo: string) =>
      call(`/invoices/${inv.id}/realisation-extensions`, {
        cookie: o.cookie,
        body: { extendedTo, bankRef: "AD-REF-9" },
      });
    expect(await codeOf(await extend("2026-08-31"))).toBe("extension_not_later");
    expect(await codeOf(await extend("2125-12-31"))).toBe("extension_too_far");
    expect((await extend("2027-06-30")).status).toBe(201);
    const after = (await panel()).realisation;
    expect(after).toMatchObject({
      femaStandard: "2026-09-01",
      femaDue: "2027-06-30",
      gstDue: "2027-07-15",
      stage: "ok",
    });
    expect(after.extensions).toHaveLength(1);
    // the realisation report's row carries it for the browser's core
    const rep = await json(await call("/reports/realisation?show=all", { cookie: o.cookie }));
    const row = rep.rows.find((r: J) => r.id === inv.id);
    expect(row.extendedTo).toEqual({ year: 2027, month: 6, day: 30 });
  });
});

describe("reads that follow the ledger [07-ZH lines 16, 17, 19, 20, 21]", () => {
  it("the dashboard tiles: collected this month and the Owner's payments to check", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const { clientId } = await invoiceFor();
    const before = await json(await call("/dashboard", { cookie: o.cookie }));
    const sum = (t: J) => (t.collected.month as J[]).find((x) => x.currency === "INR")?.collectedMinor ?? 0;
    await recorded(o, recordBody(clientId, 3_000));
    await recorded(staff, recordBody(clientId, 4_000));
    const after = await json(await call("/dashboard", { cookie: o.cookie }));
    expect(sum(after.tiles.finance) - sum(before.tiles.finance)).toBe(3_000);
    expect(after.tiles.finance.paymentsToVerify.count - before.tiles.finance.paymentsToVerify.count).toBe(1);
  });

  it("the client's collected and credit, and a project's paid", async () => {
    const o = await owner();
    const clientId = await mkReportClient();
    const project = await mkProject(clientId);
    const inv = await addDoc({ clientId, issueDate: "2026-10-05", over: { project_id: project.id } });
    await recorded(o, recordBody(clientId, 50_000, [{ documentId: inv.id, amountMinor: 40_000 }]));
    const fin = await json(await call(`/clients/${clientId}/finance`, { cookie: o.cookie }));
    expect(fin.currencies[0]).toMatchObject({
      collectedMinor: 50_000,
      creditMinor: 10_000,
      balanceMinor: TOTAL - 40_000,
    });
    const p = await json(await call(`/projects/${project.id}`, { cookie: o.cookie }));
    expect(p.figures.billed.currencies[0]).toMatchObject({ billedMinor: TOTAL, paidMinor: 40_000 });
  });

  it("the statement lists the payment and the TDS line; the register lists both, TDS apart by kind", async () => {
    const o = await owner();
    const { clientId, inv } = await invoiceFor();
    await recorded(o, recordBody(clientId, 20_000, [{ documentId: inv.id, amountMinor: 20_000 }]));
    await recorded(o, tdsBody(clientId, inv.id, 2_000));
    const s = await json(
      await call(`/clients/${clientId}/statement?from=2020-04-01&to=${today()}&currency=INR`, {
        cookie: o.cookie,
      }),
    );
    const kinds = s.entries.map((e: J) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["tax_invoice", "receipt", "tds"]));
    expect(s.range.closingMinor).toBe(TOTAL - 22_000);
    const reg = await json(await call(`/reports/payments?fy=${currentFy()}`, { cookie: o.cookie }));
    const mine = reg.rows.filter((r: J) => r.client.id === clientId);
    expect(mine.map((r: J) => r.kind).sort()).toEqual(["payment", "tds"]);
    expect(mine.find((r: J) => r.kind === "tds").tds.certificateAwaited).toBe(true);
  });

  it("void is refused while a payment waits (payment_pending) or TDS is recorded (tds_recorded)", async () => {
    const o = await owner();
    await putBank();
    const staff = await sessionFor("staff");
    const a = await mkIssuedInvoice(o, { prices: [100_000] });
    await recorded(staff, recordBody(a.clientId, 1_000, [{ documentId: a.id, amountMinor: 1_000 }]));
    const ra = await voidInvoice(o, a.id);
    expect(ra.status).toBe(409);
    expect((await json(ra)).reasons).toContain("payment_pending");
    const view = await json(await call(`/invoices/${a.id}`, { cookie: o.cookie }));
    expect(view.void.blockers).toContain("payment_pending");
    const b = await mkIssuedInvoice(o, { prices: [100_000] });
    await recorded(o, tdsBody(b.clientId, b.id, 1_000));
    const rb = await voidInvoice(o, b.id);
    expect((await json(rb)).reasons).toContain("tds_recorded");
  });

  it("anonymising an individual client is refused while a payment of it waits (07-ZH line 22)", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const clientId = await mkClient({ type: "individual" });
    const contact = await mkContact(clientId, { is_primary: 1 });
    await recorded(staff, recordBody(clientId, 1_000));
    const res = await call(`/contacts/${contact.id}/erase`, {
      cookie: o.cookie,
      body: { mode: "anonymise", reason: "requested" },
    });
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({
      error: {
        code: "payments_pending",
        message: "This client has payments waiting for the owner's check. Confirm or reject them first.",
      },
    });
  });
});

// ---- early check 2 (stage B2), findings 1 to 12 ------------------------------------------------------------------------------------------------------

/**
 * `env` whose DB runs `hook` just before its `n`th batch: a change landing between a route's read and its write (the route's own reads are batch 1 when it
 * reads with a batch, so its write is batch 2; a route that reads with `first` writes in batch 1).
 */
function raceBefore(n: number, hook: () => Promise<unknown>): Env {
  let i = 0;
  const real = env.DB;
  const db = new Proxy(real, {
    get(t, k) {
      if (k === "batch")
        return async (stmts: D1PreparedStatement[]) => {
          if (++i === n) await hook();
          return t.batch(stmts);
        };
      const v = Reflect.get(t, k);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  return withDb(db);
}

/** An issued proforma of a client of its own, with its total. */
async function issuedProforma(o: Awaited<ReturnType<typeof owner>>) {
  await putBank();
  const pf = await mkProforma(o);
  expect((await issueInvoice(o, pf.id)).status).toBe(200);
  const row = (await one<{ client_id: string; total_minor: number; updated_at: number }>(
    "SELECT client_id, total_minor, updated_at FROM documents WHERE id = ?",
    pf.id,
  )) as { client_id: string; total_minor: number; updated_at: number };
  return { id: pf.id, clientId: row.client_id, total: row.total_minor, stamp: row.updated_at };
}

const advanceCall = (
  o: { cookie: string },
  pf: { id: string; stamp: number },
  body: Record<string, unknown>,
  e?: Env,
) =>
  call(
    `/invoices/${pf.id}/advance-invoice`,
    { cookie: o.cookie, body: { expectedProformaUpdatedAt: pf.stamp, receivedOn: today(), ...body } },
    e,
  );

describe("early check 2: the advance and the payment entries [L5, L12; 07-ZH lines 12, 13]", () => {
  it("finding 1: an advance without paymentId refuses a reference already seen (409 reference_seen), naming the pending entry that asks for this proforma; confirmDuplicate goes past it", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const pf = await issuedProforma(o);
    const staffBody = recordBody(pf.clientId, pf.total, [{ documentId: pf.id, amountMinor: pf.total }]);
    const made = await recorded(staff, staffBody);
    const res = await advanceCall(o, pf, { amountMinor: pf.total, reference: staffBody.reference });
    expect(res.status).toBe(409);
    const b = await json(res);
    expect(b.error.code).toBe("reference_seen");
    expect(b.error.message).toMatch(
      /^This bank reference was already recorded on \d{2} \w{3} \d{4} for .+\. Record it again only if it is a different payment\.$/,
    );
    expect(b.error.details).toMatchObject({ receivedOn: today(), paymentId: made.id });
    // another client's confirmed payment with the reference: refused too, with no paymentId to offer
    const other = await mkReportClient();
    const r2 = ref();
    await recorded(o, recordBody(other, 1_000, [], { reference: r2 }));
    const res2 = await advanceCall(o, pf, { amountMinor: pf.total, reference: r2 });
    expect(await codeOf(res2.clone())).toBe("reference_seen");
    expect((await json(res2)).error.details.paymentId).toBeUndefined();
    expect(
      await rows("SELECT id FROM documents WHERE parent_id = ? AND frozen_at IS NOT NULL", pf.id),
    ).toHaveLength(0);
    const ok = await advanceCall(o, pf, { amountMinor: pf.total, reference: r2, confirmDuplicate: true });
    expect(ok.status, await ok.clone().text()).toBe(201);
  });

  it("finding 2: the pending entry confirmed from the Payments list between the read and the batch: nothing is frozen, no receipt, 409 payment_not_pending", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const pf = await issuedProforma(o);
    const staffBody = recordBody(pf.clientId, pf.total, [{ documentId: pf.id, amountMinor: pf.total }]);
    const made = await recorded(staff, staffBody);
    const race = raceBefore(2, () =>
      env.DB.prepare(
        "UPDATE payments SET status = 'confirmed', verified_by = ?2, verified_at = ?3 WHERE id = ?1",
      )
        .bind(made.id, o.id, Date.now())
        .run(),
    );
    const res = await advanceCall(
      o,
      pf,
      { amountMinor: pf.total, reference: staffBody.reference, paymentId: made.id },
      race,
    );
    expect(res.status, await res.clone().text()).toBe(409);
    expect(await codeOf(res)).toBe("payment_not_pending");
    expect(
      await rows("SELECT id FROM documents WHERE parent_id = ? AND type = 'tax_invoice'", pf.id),
    ).toHaveLength(0);
    expect(await rows("SELECT id FROM advance_receipts WHERE proforma_id = ?", pf.id)).toHaveLength(0);
    expect(await rows("SELECT id FROM payment_allocations WHERE payment_id = ?", made.id)).toHaveLength(0);
    expect((await paymentRow(made.id)).advance_receipt_id).toBeNull();
  });

  it("finding 3: a proforma ask is the only allocation and the whole amount, else 409 proforma_ask_whole with nothing written", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const pf = await issuedProforma(o);
    const inv = await addDoc({ clientId: pf.clientId, issueDate: "2026-10-05" });
    const split = recordBody(pf.clientId, pf.total + 1_000, [
      { documentId: pf.id, amountMinor: pf.total },
      { documentId: inv.id, amountMinor: 1_000 },
    ]);
    const part = recordBody(pf.clientId, pf.total, [{ documentId: pf.id, amountMinor: pf.total - 1 }]);
    for (const body of [split, part]) {
      const res = await record(staff, body);
      expect(res.status).toBe(409);
      const b = await json(res);
      expect(b.error.code).toBe("proforma_ask_whole");
      expect(b.error.details).toEqual({ documentId: pf.id });
      expect(await one("SELECT id FROM payments WHERE id = ?", body.id)).toBeNull();
    }
    expect(
      (await record(staff, recordBody(pf.clientId, pf.total, [{ documentId: pf.id, amountMinor: pf.total }])))
        .status,
    ).toBe(201);
  });
});

describe("early check 2: erase, stamps, refusals and void blockers [L31, L32; 08-C RB-11, RA-25]", () => {
  it("finding 4: erasing an individual's last contact deletes the payment bells and clears the payments' and the check's free text; amounts and references stay", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const clientId = await mkClient({ type: "individual" });
    const contact = await mkContact(clientId, { is_primary: 1 });
    const asked = recordBody(clientId, 1_000, [], { note: "Paid from a relative's account" });
    const p1 = await recorded(staff, asked);
    expect((await verify(o, p1.id, "reject", { note: "The advice names another person" })).status).toBe(200);
    const confirmedBody = recordBody(clientId, 2_000, [], { note: "Cash deposit by a named person" });
    const p2 = await recorded(o, confirmedBody);
    expect(
      (
        await call(`/payments/${p2.id}/withdraw`, {
          cookie: o.cookie,
          body: { reason: "Entered for the wrong person" },
        })
      ).status,
    ).toBe(200);
    const bells = () =>
      rows(
        "SELECT id FROM notifications WHERE entity_type = 'payment' AND entity_id IN (?, ?)",
        p1.id,
        p2.id,
      );
    expect((await bells()).length).toBeGreaterThan(0);
    expect(
      (await one<{ note: string | null }>("SELECT note FROM approvals WHERE payment_id = ?", p1.id))?.note,
    ).toBe("The advice names another person");
    const res = await call(`/contacts/${contact.id}/erase`, {
      cookie: o.cookie,
      body: { mode: "anonymise", reason: "requested" },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await bells()).toEqual([]);
    expect(await one("SELECT note FROM approvals WHERE payment_id = ?", p1.id)).toEqual({ note: null });
    for (const [id, amount, body] of [
      [p1.id, 1_000, asked],
      [p2.id, 2_000, confirmedBody],
    ] as const) {
      const row = await paymentRow(id);
      expect(row).toMatchObject({
        note: null,
        decision_note: null,
        withdraw_reason: null,
        amount_minor: amount,
      });
      expect(row.reference_norm).toBe(String(body.reference).toUpperCase());
    }
    expect((await paymentRow(p1.id)).status).toBe("rejected");
    expect((await paymentRow(p2.id)).status).toBe("withdrawn");
  });

  it("L38: after the fold into T7's statements, one erase still clears both kinds of bell and both kinds of approval note; another client's stay", async () => {
    const o = await owner();
    const staff = await sessionFor("staff");
    const clientId = await mkClient({ type: "individual" });
    const contact = await mkContact(clientId, { is_primary: 1 });
    const inv = await addDoc({ clientId, issueDate: "2026-10-05" });
    const p = await recorded(staff, recordBody(clientId, 1_000, [], { note: "Paid by a named relative" }));
    expect((await verify(o, p.id, "reject", { note: "The advice names another person" })).status).toBe(200);
    // the other arm of each folded statement: a bell about the issued invoice, and an issue request on it with its reason and note
    const docBell = `nt-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO notifications (id, user_id, kind, entity_type, entity_id, title, link) VALUES (?1, ?2, 'pdf.failed', 'document', ?3, 'A bell naming the client', '/x')",
    )
      .bind(docBell, o.id, inv.id)
      .run();
    const issueAsk = `ap-${crypto.randomUUID()}`;
    await env.DB.prepare(
      "INSERT INTO approvals (id, kind, document_id, requested_by, reason, content_sha256, status, decided_by, decided_at, note) VALUES (?1, 'issue', ?2, ?3, 'For the named client', 'h', 'approved', ?4, 1, 'Fine for the named client')",
    )
      .bind(issueAsk, inv.id, staff.id, o.id)
      .run();
    // another individual client's bell and check note are untouched
    const otherClient = await mkClient({ type: "individual" });
    await mkContact(otherClient, { is_primary: 1 });
    const q = await recorded(staff, recordBody(otherClient, 1_000));
    expect((await verify(o, q.id, "reject", { note: "Kept: another client" })).status).toBe(200);
    const res = await call(`/contacts/${contact.id}/erase`, {
      cookie: o.cookie,
      body: { mode: "anonymise", reason: "requested" },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(
      await rows(
        "SELECT id FROM notifications WHERE (entity_type = 'payment' AND entity_id = ?) OR id = ?",
        p.id,
        docBell,
      ),
    ).toEqual([]);
    expect(await one("SELECT reason, note FROM approvals WHERE payment_id = ?", p.id)).toEqual({
      reason: null,
      note: null,
    });
    expect(await one("SELECT reason, note FROM approvals WHERE id = ?", issueAsk)).toEqual({
      reason: null,
      note: null,
    });
    expect(await paymentRow(p.id)).toMatchObject({ note: null, decision_note: null, amount_minor: 1_000 });
    expect(
      (await rows("SELECT id FROM notifications WHERE entity_type = 'payment' AND entity_id = ?", q.id))
        .length,
    ).toBeGreaterThan(0);
    expect(await one("SELECT note FROM approvals WHERE payment_id = ?", q.id)).toEqual({
      note: "Kept: another client",
    });
  });

  it("finding 4: a business client's contact erase leaves its payments' text alone", async () => {
    const o = await owner();
    const clientId = await mkClient({ type: "business" });
    const contact = await mkContact(clientId, { is_primary: 1 });
    await mkContact(clientId);
    const p = await recorded(o, recordBody(clientId, 1_000, [], { note: "Kept: a business client" }));
    const res = await call(`/contacts/${contact.id}/erase`, {
      cookie: o.cookie,
      body: { mode: "anonymise", reason: "requested" },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await paymentRow(p.id)).note).toBe("Kept: a business client");
  });

  it("finding 5: apply and release answer the document's stored updated_at (the recompute moves it after the claim)", async () => {
    const o = await owner();
    const { clientId, inv } = await invoiceFor();
    await recorded(o, recordBody(clientId, 20_000));
    const applied = await json(
      await call(`/clients/${clientId}/credit/apply`, {
        cookie: o.cookie,
        body: {
          documentId: inv.id,
          amountMinor: 5_000,
          expectedUpdatedAt: (await ledgerOf(inv.id)).updated_at,
        },
      }),
    );
    expect(applied.updatedAt).toBe((await ledgerOf(inv.id)).updated_at);
    // the answer's stamp is good for the next save
    const second = await call(`/clients/${clientId}/credit/apply`, {
      cookie: o.cookie,
      body: { documentId: inv.id, amountMinor: 1_000, expectedUpdatedAt: applied.updatedAt },
    });
    expect(second.status, await second.clone().text()).toBe(200);
    await recorded(o, recordBody(clientId, TOTAL, [{ documentId: inv.id, amountMinor: TOTAL - 6_000 }]));
    await env.DB.prepare(
      "UPDATE documents SET credited_minor = 3000, updated_at = updated_at + 1 WHERE id = ?",
    )
      .bind(inv.id)
      .run();
    const released = await json(
      await call(`/invoices/${inv.id}/credit/release`, {
        cookie: o.cookie,
        body: { amountMinor: 3_000, expectedUpdatedAt: (await ledgerOf(inv.id)).updated_at },
      }),
    );
    expect(released.updatedAt).toBe((await ledgerOf(inv.id)).updated_at);
  });

  it("finding 8: an extension refused after the read says why (a later one landed, the invoice was voided), never a bare 401", async () => {
    pinClock(NOON_IST_MID_FY);
    const o = await owner();
    const clientId = await mkReportClient("USD");
    const inv = await addDoc({ clientId, currency: "USD", issueDate: "2025-12-01" });
    const extend = (extendedTo: string, e?: Env) =>
      call(
        `/invoices/${inv.id}/realisation-extensions`,
        { cookie: o.cookie, body: { extendedTo, bankRef: "AD-1" } },
        e,
      );
    const later = raceBefore(1, () =>
      env.DB.prepare(
        "INSERT INTO realisation_extensions (id, document_id, extended_to, bank_ref, recorded_by, created_at) VALUES (?1, ?2, '2027-12-31', 'AD-0', ?3, 1)",
      )
        .bind(`x-${inv.id}`, inv.id, o.id)
        .run(),
    );
    const r1 = await extend("2027-06-30", later);
    expect(r1.status).toBe(409);
    expect(await json(r1)).toMatchObject({
      error: { code: "extension_not_later", details: { femaDue: "2027-12-31" } },
    });
    const voided = raceBefore(1, () =>
      env.DB.prepare("UPDATE documents SET status = 'void', voided_at = 9, void_reason = 'x' WHERE id = ?1")
        .bind(inv.id)
        .run(),
    );
    const r2 = await extend("2028-06-30", voided);
    expect(r2.status).toBe(409);
    expect(await codeOf(r2)).toBe("invoice_void");
  });

  it("finding 12: the letter route: set once, a wrong type refused, an anonymised client refused", async () => {
    pinClock(NOON_IST_MID_FY);
    const o = await owner();
    const clientId = await mkReportClient("USD");
    const inv = await addDoc({ clientId, currency: "USD", issueDate: "2025-12-01" });
    const ext = async (extendedTo: string) =>
      (
        await json(
          await call(`/invoices/${inv.id}/realisation-extensions`, {
            cookie: o.cookie,
            body: { extendedTo, bankRef: "AD-L" },
          }),
        )
      ).id as string;
    const e1 = await ext("2027-06-30");
    const path = (eid: string) => `/invoices/${inv.id}/realisation-extensions/${eid}/letter`;
    expect((await putDoc(path(e1), PDF_BYTES, { cookie: o.cookie, name: "letter.txt" })).status).toBe(415);
    expect(await codeOf(await putDoc(path(e1), PDF_BYTES, { cookie: o.cookie, name: "letter.png" }))).toBe(
      "file_type_mismatch",
    );
    const ok = await putDoc(path(e1), PDF_BYTES, { cookie: o.cookie, name: "letter.pdf" });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await codeOf(await putDoc(path(e1), PNG_BYTES, { cookie: o.cookie, name: "letter.png" }))).toBe(
      "letter_already_set",
    );
    const e2 = await ext("2027-12-31");
    await env.DB.prepare("UPDATE clients SET anonymised_at = 1 WHERE id = ?").bind(clientId).run();
    const gone = await putDoc(path(e2), PDF_BYTES, { cookie: o.cookie, name: "letter.pdf" });
    expect(gone.status).toBe(409);
    expect(await codeOf(gone)).toBe("client_anonymised");
    expect(await one("SELECT letter_r2_key FROM realisation_extensions WHERE id = ?", e2)).toEqual({
      letter_r2_key: null,
    });
  });

  it("finding 9: an allocation is payment_recorded, a waiting entry payment_pending (L32)", async () => {
    const o = await owner();
    await putBank();
    const staff = await sessionFor("staff");
    const a = await mkIssuedInvoice(o, { prices: [100_000] });
    const made = await recorded(o, recordBody(a.clientId, 1_000, [{ documentId: a.id, amountMinor: 1_000 }]));
    await call(`/payments/${made.id}/withdraw`, { cookie: o.cookie, body: { reason: "Entered twice" } });
    const ra = await voidInvoice(o, a.id);
    expect(ra.status).toBe(409);
    const reasons = (await json(ra)).reasons;
    expect(reasons).toContain("payment_recorded");
    expect(reasons).not.toContain("payment_pending");
    const view = await json(await call(`/invoices/${a.id}`, { cookie: o.cookie }));
    expect(view.void.blockers).toContain("payment_recorded");
    const b = await mkIssuedInvoice(o, { prices: [100_000] });
    await recorded(staff, recordBody(b.clientId, 1_000, [{ documentId: b.id, amountMinor: 1_000 }]));
    const rb = (await json(await voidInvoice(o, b.id))).reasons;
    expect(rb).toContain("payment_pending");
    expect(rb).not.toContain("payment_recorded");
  });
});

describe("early check 2, finding 12: races", () => {
  it("two parallel 'Use credit' calls on two invoices drawing on one source: one 200, one 409; the payment never gives more than its amount", async () => {
    const o = await owner();
    const clientId = await mkReportClient();
    const a = await addDoc({ clientId, issueDate: "2026-10-05" });
    const b = await addDoc({ clientId, issueDate: "2026-10-05" });
    const src = await recorded(o, recordBody(clientId, 10_000));
    const apply = async (documentId: string) =>
      call(`/clients/${clientId}/credit/apply`, {
        cookie: o.cookie,
        body: { documentId, amountMinor: 8_000, expectedUpdatedAt: (await ledgerOf(documentId)).updated_at },
      });
    const both = await Promise.all([apply(a.id), apply(b.id)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    const refused = both.find((r) => r.status === 409) as Response;
    expect(["ledger_changed", "exceeds_credit"]).toContain(await codeOf(refused));
    const net = await one<{ net: number }>(
      "SELECT coalesce(sum(CASE kind WHEN 'allocate' THEN amount_minor ELSE -amount_minor END), 0) AS net FROM payment_allocations WHERE payment_id = ?",
      src.id,
    );
    expect(net?.net).toBe(8_000);
    const credit = await json(await call(`/clients/${clientId}/credit`, { cookie: o.cookie }));
    expect(credit.credits).toEqual([{ currency: "INR", creditMinor: 2_000 }]);
  });

  it("a parallel void and confirm on one invoice: exactly one wins", async () => {
    const o = await owner();
    await putBank();
    const staff = await sessionFor("staff");
    const x = await mkIssuedInvoice(o, { prices: [100_000] });
    const made = await recorded(staff, recordBody(x.clientId, 1_000));
    const [v, c] = await Promise.all([
      voidInvoice(o, x.id),
      verify(o, made.id, "confirm", { allocations: [{ documentId: x.id, amountMinor: 1_000 }] }),
    ]);
    expect([v.status, c.status].sort()).toEqual([200, 409]);
    const doc = await one<{ status: string }>("SELECT status FROM documents WHERE id = ?", x.id);
    const held = await rows("SELECT id FROM payment_allocations WHERE document_id = ?", x.id);
    if (v.status === 200) {
      expect(doc?.status).toBe("void");
      expect(held).toHaveLength(0);
      expect((await paymentRow(made.id)).status).toBe("pending_verification");
    } else {
      expect(doc?.status).not.toBe("void");
      expect(held).toHaveLength(1);
      expect((await json(v)).reasons).toContain("payment_recorded");
    }
  });
});
