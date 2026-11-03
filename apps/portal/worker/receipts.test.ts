// M6.5 (E; POR-07 receipt download only, run file E): the portal's receipts and refunds on an invoice, and the receipt PDF, every query bound to the session's
// client: another organisation's receipt is the plain 404, a contact without finance access gets the same 404, a receipt whose PDF isn't made is 409. Only
// refunds that went out show (07-ZO line 14: no "refund in progress" line). Invented test data.
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures.ts";
import { ROUTES } from "./guard.ts";
import { bodyOf, call, sessionFor } from "./test-helpers.ts";

let seq = 0;
async function owner(): Promise<string> {
  const id = uuidv7();
  await env.DB.prepare(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, 'Owner', 'owner', 'active')",
  )
    .bind(id, `${id}@example.test`)
    .run();
  return id;
}
/** An issued invoice of `orgId` paid in full by a confirmed manual payment with its receipt (PDF stored when `pdf`). */
async function paidWithReceipt(orgId: string, pdf: boolean) {
  const o = await owner();
  const inv = uuidv7();
  const n = ++seq + 9100;
  await env.DB.prepare(
    "INSERT INTO documents (id, type, status, client_id, currency, frozen_at, series, fy, number, number_display, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor) VALUES (?1, 'tax_invoice', 'issued', ?2, 'INR', 1000, 'inv-r', '2627', ?3, ?4, '2026-11-01', '2026-12-31', 100000, 100000, 118000, 118000)",
  )
    .bind(inv, orgId, n, `TH/I/${n}`)
    .run();
  const pid = uuidv7();
  await env.DB.prepare(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at, verified_by, verified_at)
     VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'INR', 128000, '2026-11-02', 'neft', ?3, 1000, ?3, 1000)`,
  )
    .bind(pid, orgId, o)
    .run();
  await env.DB.prepare(
    "INSERT INTO payment_allocations (id, payment_id, document_id, amount_minor, kind, created_at) VALUES (?1, ?2, ?3, 118000, 'allocate', 2000)",
  )
    .bind(uuidv7(), pid, inv)
    .run();
  const rid = `rct_${pid}`;
  await env.DB.prepare(
    `INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, total_minor, header_extras, updated_at)
     VALUES (?1, 'receipt', 'issued', ?2, 'INR', 'receipt', '2627', ?3, ?4, 1000, '2026-11-03', 128000, ?5, 7000)`,
  )
    .bind(rid, orgId, n, `TH/RCT/2627/${n}`, JSON.stringify({ receiptOf: { receivedOn: "2026-11-02" } }))
    .run();
  if (pdf) {
    const key = `docs/receipt/2026-27/${String(n).padStart(4, "0")}-v1.pdf`;
    await env.DOCS.put(key, new TextEncoder().encode("%PDF-1.7 receipt"));
    await env.DB.prepare("UPDATE documents SET pdf_r2_key = ?2, pdf_sha256 = ?3 WHERE id = ?1")
      .bind(rid, key, "c".repeat(64))
      .run();
  }
  // a credit note of 10,000 left an excess on the invoice, refunded (succeeded): the client sees "Refunded"; a refund from credit is not this invoice's
  await env.DB.prepare(
    "UPDATE documents SET paid_minor = 118000, credited_minor = 10000, balance_minor = 0, status = 'paid', updated_at = updated_at + 1 WHERE id = ?",
  )
    .bind(inv)
    .run();
  for (const [doc, amount] of [
    [null, 500],
    [inv, 10_000],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO payment_refunds (id, payment_id, client_id, document_id, provider, origin, status, mode, paid_to, reason_code, currency, amount_minor, reference_norm, paid_on,
         requested_by, requested_at, attempts, settled_at, settled_on, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'manual', 'owner', 'succeeded', 'neft', 'original', ?5, 'INR', ?6, ?7, '2026-11-04', ?8, 3000, 0, 3000, '2026-11-04', 3000)`,
    )
      .bind(uuidv7(), pid, orgId, doc, doc ? "credit_note" : "overpayment", amount, `UTRP${n}${amount}`, o)
      .run();
  }
  return { inv, rid };
}

describe("receipts and refunds in the portal [M6.5 E, POR-07]", () => {
  it("the receipt PDF route is finance-only", () => {
    expect(ROUTES.find((r) => r.path === "/api/v1/receipts/:id/pdf")).toMatchObject({
      method: "GET",
      access: "finance",
    });
  });

  it("an invoice lists its payments' receipts; the receipt PDF streams to its own client only; another organisation's and a contact without finance get 404", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const { inv, rid } = await paidWithReceipt(f.a.id, true);
    const doc = (await bodyOf(await call(`/invoices/${inv}`, { cookie: s.cookie }))).document as {
      receipts: {
        id: string;
        numberDisplay: string;
        amountMinor: number;
        receivedOn: string;
        hasPdf: boolean;
      }[];
      refunds: { amountMinor: number; on: string }[];
    };
    expect(doc.refunds).toEqual([{ amountMinor: 10_000, on: "2026-11-04" }]);
    expect(doc.receipts).toEqual([
      expect.objectContaining({ id: rid, amountMinor: 128_000, receivedOn: "2026-11-02", hasPdf: true }),
    ]);
    const pdf = await call(`/receipts/${rid}/pdf`, { cookie: s.cookie });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const theirs = await paidWithReceipt(f.b.id, true);
    expect((await call(`/receipts/${theirs.rid}/pdf`, { cookie: s.cookie })).status).toBe(404);
    const noFinance = await sessionFor(f.a.plain);
    expect((await call(`/receipts/${rid}/pdf`, { cookie: noFinance.cookie })).status).toBe(404);
    const pending = await paidWithReceipt(f.a.id, false);
    expect((await call(`/receipts/${pending.rid}/pdf`, { cookie: s.cookie })).status).toBe(409);
  });
});
