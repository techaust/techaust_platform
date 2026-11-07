// Rebuild PDF in the portal (JOB-PDF-02, POR-05, POR-06, POR-07; run file docs/runs/rebuild-pdf.md, L3 and the analyst's early check): every portal PDF
// download goes through `streamPdf`, which serves the newest rebuilt file of the key the client-bound row records, else the original, and the original again
// when a recorded rebuild's object is gone (change 1). Scoping is unchanged: another organisation's document stays the plain 404 even with a rebuild on it.
// The rebuild rows are written through the real request and result statements (`@techaust/db/pdf-repairs`), so the insert triggers check them.
// Invented data only.
import { env } from "cloudflare:workers";
import { docTokenStmt } from "@techaust/auth";
import { uuidv7 } from "@techaust/core";
import { type RepairKind, repairKey } from "@techaust/core/pdf-repair";
import { REQUEST_INSERT_SQL, RESULT_INSERT_SQL, requestBinds } from "@techaust/db/pdf-repairs";
import { describe, expect, it } from "vitest";
import { type FxContact, fixtures } from "./fixtures.ts";
import { mkOffer } from "./offer-fixtures.ts";
import { call, counted, sessionFor, spyConsole } from "./test-helpers.ts";

const REBUILT = "%PDF-1.7 rebuilt";
let seq = 0;

async function staff(): Promise<string> {
  const id = uuidv7();
  await env.DB.prepare(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, 'Owner', 'owner', 'active')",
  )
    .bind(id, `${id}@example.test`)
    .run();
  return id;
}

/** A completed rebuild of `originalKey` (the request, the object at `-r1`, the `rebuilt` result), as the admin route and the jobs Worker write it. */
async function rebuild(kind: RepairKind, subjectId: string, originalKey: string): Promise<string> {
  const id = uuidv7();
  const now = Date.now();
  const r = await env.DB.prepare(REQUEST_INSERT_SQL[kind])
    .bind(
      ...requestBinds({
        id,
        kind,
        subjectId,
        originalKey,
        checkedKey: originalKey,
        checkedSha: null,
        found: "missing",
        by: await staff(),
        now,
      }),
    )
    .run();
  expect(r.meta.changes, `request ${kind}`).toBeGreaterThan(0);
  const newKey = repairKey(originalKey, 1);
  await env.DOCS.put(newKey, REBUILT);
  const done = await env.DB.prepare(RESULT_INSERT_SQL)
    .bind(id, "rebuilt", null, "e".repeat(64), REBUILT.length, now)
    .run();
  expect(done.meta.changes, `result ${kind}`).toBeGreaterThan(0);
  return newKey;
}

/** An issued tax invoice of `orgId` with its PDF stored (inserted issued and frozen, as the doc-token tests do). */
async function invoice(orgId: string) {
  const id = uuidv7();
  const n = 7_000 + ++seq;
  const key = `docs/tax_invoice/2026-27/${n}-v1.pdf`;
  await env.DOCS.put(key, `%PDF-1.7 original ${n}`);
  await env.DB.prepare(
    "INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor, pdf_r2_key, pdf_sha256) VALUES (?1, 'tax_invoice', 'issued', ?2, 'INR', 'inv-rb', '2627', ?3, ?4, 1000, '2026-11-01', '2026-12-31', 100000, 100000, 118000, 118000, ?5, ?6)",
  )
    .bind(id, orgId, n, `TH/RB/${n}`, key, "c".repeat(64))
    .run();
  return { id, key, original: `%PDF-1.7 original ${n}` };
}

/** A receipt of a confirmed payment of `orgId` with its PDF stored (the receipt trigger wants the payment, of the same amount). */
async function receipt(orgId: string) {
  const owner = await staff();
  const pid = uuidv7();
  const n = 7_500 + ++seq;
  await env.DB.prepare(
    `INSERT INTO payments (id, client_id, kind, provider, status, currency, amount_minor, received_on, mode, recorded_by, recorded_at, verified_by, verified_at)
     VALUES (?1, ?2, 'payment', 'manual', 'confirmed', 'INR', 50000, '2026-11-02', 'neft', ?3, 1000, ?3, 1000)`,
  )
    .bind(pid, orgId, owner)
    .run();
  const id = `rct_${pid}`;
  const key = `docs/receipt/2026-27/${n}-v1.pdf`;
  await env.DOCS.put(key, `%PDF-1.7 receipt ${n}`);
  await env.DB.prepare(
    "INSERT INTO documents (id, type, status, client_id, currency, series, fy, number, number_display, frozen_at, issue_date, total_minor, header_extras, pdf_r2_key, pdf_sha256) VALUES (?1, 'receipt', 'issued', ?2, 'INR', 'receipt', '2627', ?3, ?4, 1000, '2026-11-03', 50000, ?5, ?6, ?7)",
  )
    .bind(
      id,
      orgId,
      n,
      `TH/RCT/2627/${n}`,
      JSON.stringify({ receiptOf: { receivedOn: "2026-11-02" } }),
      key,
      "d".repeat(64),
    )
    .run();
  return { id, key };
}

async function viewLink(contact: FxContact, documentId: string) {
  const { token, stmt } = await docTokenStmt(env.DB, {
    documentId,
    purpose: "view_pay",
    expiresAt: Date.now() + 86_400_000,
    contactId: contact.id,
    clientId: contact.clientId,
    email: contact.email,
    sendId: null,
  });
  await stmt.run();
  return token;
}

describe("the portal serves the rebuilt PDF when the original is gone [JOB-PDF-02]", () => {
  it("an offer (POR-05): the rebuilt file, one indexed lookup on the original key", async () => {
    const f = await fixtures();
    const cookie = (await sessionFor(f.a.finance)).cookie;
    // Expired: the client can no longer accept it (owner Q1 = B), so it may be rebuilt.
    const o = await mkOffer(f.a, { validInDays: -3 });
    await rebuild("offer", o.id, o.pdfKey);
    await env.DOCS.delete(o.pdfKey);
    const c = counted();
    const res = await call(`/offers/${o.id}/pdf`, { cookie }, c.env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(REBUILT);
    const lookups = c.seen.filter((q) => q.sql.includes("pdf_repair_results"));
    expect(lookups).toHaveLength(1);
    expect(lookups[0]?.params).toEqual([o.pdfKey]);
  });

  it("the acceptance certificate (POR-05)", async () => {
    const f = await fixtures();
    const cookie = (await sessionFor(f.a.finance)).cookie;
    const o = await mkOffer(f.a, { status: "accepted" });
    const acc = uuidv7();
    const certKey = o.pdfKey.replace(/\.pdf$/, "-certificate.pdf");
    await env.DB.prepare(
      "INSERT INTO acceptances (id, document_id, contact_id, typed_name, email, accepted_at, pdf_sha256, via, certificate_r2_key) VALUES (?1, ?2, ?3, 'A Person', ?4, ?5, 's', 'session', ?6)",
    )
      .bind(acc, o.id, f.a.finance.id, f.a.finance.email, Date.now(), certKey)
      .run();
    await env.DOCS.put(certKey, "%PDF-1.7 certificate");
    await env.DB.prepare(
      "INSERT INTO acceptance_certificates (acceptance_id, r2_key, sha256, rendered_at) VALUES (?1, ?2, ?3, 1)",
    )
      .bind(acc, certKey, "b".repeat(64))
      .run();
    await rebuild("certificate", acc, certKey);
    await env.DOCS.delete(certKey);
    const res = await call(`/offers/${o.id}/certificate`, { cookie });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(REBUILT);
  });

  it("an invoice (POR-06), signed in and through the emailed link; another organisation's stays the plain 404", async () => {
    const f = await fixtures();
    const cookie = (await sessionFor(f.a.finance)).cookie;
    const inv = await invoice(f.a.id);
    await rebuild("invoice", inv.id, inv.key);
    await env.DOCS.delete(inv.key);
    const res = await call(`/invoices/${inv.id}/pdf`, { cookie });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(REBUILT);
    const linked = await call("/t/document/pdf", { body: { token: await viewLink(f.a.finance, inv.id) } });
    expect(linked.status).toBe(200);
    expect(await linked.text()).toBe(REBUILT);
    // B's finance contact asking for A's invoice (which has a rebuild): the same 404 as a made-up id
    const theirs = (await sessionFor(f.b.finance)).cookie;
    expect((await call(`/invoices/${inv.id}/pdf`, { cookie: theirs })).status).toBe(404);
    expect((await call(`/invoices/${uuidv7()}/pdf`, { cookie: theirs })).status).toBe(404);
  });

  it("a receipt (POR-07)", async () => {
    const f = await fixtures();
    const cookie = (await sessionFor(f.a.finance)).cookie;
    const r = await receipt(f.a.id);
    await rebuild("receipt", r.id, r.key);
    await env.DOCS.delete(r.key);
    const res = await call(`/receipts/${r.id}/pdf`, { cookie });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(REBUILT);
    expect(
      (await call(`/receipts/${r.id}/pdf`, { cookie: (await sessionFor(f.b.finance)).cookie })).status,
    ).toBe(404);
  });

  it("change 1: a recorded rebuild whose object is gone serves the original, logged with the request id only", async () => {
    const f = await fixtures();
    const cookie = (await sessionFor(f.a.finance)).cookie;
    const inv = await invoice(f.a.id);
    const newKey = await rebuild("invoice", inv.id, inv.key);
    await env.DOCS.delete(newKey);
    const spy = spyConsole();
    try {
      const res = await call(`/invoices/${inv.id}/pdf`, { cookie });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(inv.original);
    } finally {
      spy.stop();
    }
    expect(spy.lines.filter((l) => l.includes("rebuilt pdf object missing"))).toHaveLength(1);
    expect(spy.lines.some((l) => l.includes(inv.key) || l.includes(newKey))).toBe(false);
  });

  it("no rebuild: the original, as before", async () => {
    const f = await fixtures();
    const cookie = (await sessionFor(f.a.finance)).cookie;
    const inv = await invoice(f.a.id);
    const res = await call(`/invoices/${inv.id}/pdf`, { cookie });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(inv.original);
  });
});
