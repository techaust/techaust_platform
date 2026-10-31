// A withdrawn proforma in the portal [ADM-INV-10, POR-06, POR-03; owner, 2026-10-30, docs/13; Q3 of runs/proforma-withdraw]: the client sees it as withdrawn (the list, the page and the
// emailed link), with no amount due, no due date, no PDF and never the reason; reading it writes no view. A void proforma that never reached the client stays closed (404), and another
// organisation's withdrawn proforma, a contact without finance and a dead link are the same 404 as ever. Failure paths first.
import { env } from "cloudflare:workers";
import { docTokenStmt, portalFailKey } from "@techaust/auth";
import { uuidv7 } from "@techaust/core";
import { issueDateOf } from "@techaust/core/invoices";
import { describe, expect, it, vi } from "vitest";
import { type FxContact, fixtures } from "./fixtures.ts";
import { attemptsRow, bodyOf, call, nextIp, one, sessionFor } from "./test-helpers.ts";

const REASON = "Owner reason text never shown";
let seq = 0;
let staffId: string | null = null;

async function staff() {
  if (staffId) return staffId;
  staffId = uuidv7();
  await env.DB.prepare(
    "INSERT INTO staff_users (id, email, name, role, status) VALUES (?1, ?2, 'Owner', 'owner', 'active')",
  )
    .bind(staffId, `${staffId}@example.test`)
    .run();
  return staffId;
}

/**
 * An issued proforma of an organisation, delivered as asked (opened in the portal, emailed, both or neither), then voided with a reason (`withdrawn`: it had
 * reached the client), with a stored PDF.
 */
async function proforma(
  orgId: string,
  o: { delivered?: "viewed" | "emailed" | "none"; voided?: boolean } = {},
) {
  const id = uuidv7();
  const n = ++seq + 6000;
  const key = `docs/proforma/2026-27/${n}-v1.pdf`;
  await env.DOCS.put(key, "%PDF-1.4 proforma with bank details");
  await env.DB.prepare(
    "INSERT INTO documents (id, type, status, client_id, currency, frozen_at, series, fy, number, number_display, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor, pdf_r2_key) VALUES (?1, 'proforma', 'issued', ?2, 'INR', 1000, 'proforma-w', '2627', ?3, ?4, '2026-11-05', '2026-11-20', 100000, 100000, 118000, 118000, ?5)",
  )
    .bind(id, orgId, n, `TH/PF/${n}`, key)
    .run();
  const delivered = o.delivered ?? "emailed";
  if (delivered === "viewed")
    await env.DB.prepare("UPDATE documents SET viewed_at = 8000 WHERE id = ?").bind(id).run();
  if (delivered === "emailed")
    await env.DB.prepare(
      "INSERT INTO document_sends (id, document_id, version_group_id, client_id, contact_id, email, attach_pdf, kind, created_by) VALUES (?1, ?2, ?2, ?3, NULL, 'a@example.test', 0, 'send', ?4)",
    )
      .bind(uuidv7(), id, orgId, await staff())
      .run();
  const voidedAt = Date.UTC(2026, 10, 9, 20, 0, 0); // 10 November 2026, 01:30 IST
  if (o.voided !== false)
    await env.DB.prepare(
      "UPDATE documents SET status = 'void', voided_at = ?2, void_reason = ?3, updated_at = ?2 WHERE id = ?1",
    )
      .bind(id, voidedAt, REASON)
      .run();
  return { id, key, voidedAt };
}

async function link(contact: FxContact, documentId: string, o: { expiresIn?: number } = {}) {
  const { token, stmt } = await docTokenStmt(env.DB, {
    documentId,
    purpose: "view_pay",
    expiresAt: Date.now() + (o.expiresIn ?? 86_400_000),
    contactId: contact.id,
    clientId: contact.clientId,
    email: contact.email,
    sendId: null,
  });
  await stmt.run();
  return token;
}

const viewedAt = async (id: string) =>
  (await one<{ v: number | null }>("SELECT viewed_at AS v FROM documents WHERE id = ?", id))?.v ?? null;

describe("closed as before [ADM-INV-10, POR-03]", () => {
  it("a void proforma that never reached the client is a 404 on the page, the PDF and the link, and is not listed", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const quiet = await proforma(f.a.id, { delivered: "none" });
    expect((await call(`/invoices/${quiet.id}`, { cookie: s.cookie })).status).toBe(404);
    expect((await call(`/invoices/${quiet.id}/pdf`, { cookie: s.cookie })).status).toBe(404);
    const token = await link(f.a.finance, quiet.id);
    expect((await call("/t/document", { body: { token } })).status).toBe(404);
    const list = (await bodyOf(await call("/invoices", { cookie: s.cookie }))).invoices as { id: string }[];
    expect(list.map((r) => r.id)).not.toContain(quiet.id);
  });

  it("another organisation's withdrawn proforma, a contact without finance, and a link of another organisation's contact are 404", async () => {
    const f = await fixtures();
    const theirs = await proforma(f.b.id);
    const s = await sessionFor(f.a.finance);
    expect((await call(`/invoices/${theirs.id}`, { cookie: s.cookie })).status).toBe(404);
    expect((await call(`/invoices/${theirs.id}/pdf`, { cookie: s.cookie })).status).toBe(404);
    const mine = await proforma(f.a.id);
    const plain = await sessionFor(f.a.plain);
    expect((await call(`/invoices/${mine.id}`, { cookie: plain.cookie })).status).toBe(404);
    expect((await call("/t/document", { body: { token: await link(f.a.plain, mine.id) } })).status).toBe(404);
    // a link for B's contact to A's document can't even be made (trigger `doc_access_tokens_bound_insert`); B's own link opens only B's document
    await expect(link(f.b.finance, mine.id)).rejects.toThrow(/doc_access_tokens_bound_insert/);
    const bLink = await call("/t/document", { body: { token: await link(f.b.finance, theirs.id) } });
    expect(bLink.status).toBe(200);
    expect(((await bodyOf(bLink)).document as { id: string }).id).toBe(theirs.id);
    const list = (await bodyOf(await call("/invoices", { cookie: s.cookie }))).invoices as { id: string }[];
    expect(list.map((r) => r.id)).not.toContain(theirs.id);
  });

  it("a revoked or expired link to a withdrawn proforma is 404", async () => {
    const f = await fixtures();
    const pf = await proforma(f.a.id);
    const expired = await link(f.a.finance, pf.id, { expiresIn: -1_000 });
    expect((await call("/t/document", { body: { token: expired } })).status).toBe(404);
    const revoked = await link(f.a.finance, pf.id);
    await env.DB.prepare("UPDATE doc_access_tokens SET revoked_at = 1 WHERE document_id = ?")
      .bind(pf.id)
      .run();
    expect((await call("/t/document", { body: { token: revoked } })).status).toBe(404);
  });
});

describe("the PDF of a withdrawn proforma is never served [ADM-INV-10, Q3]", () => {
  it("signed in and through the link: 409 withdrawn in 07-ZF 20's words; R2 is not read; no view is written", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const pf = await proforma(f.a.id, { delivered: "emailed" });
    const get = vi.spyOn(env.DOCS, "get");
    try {
      const res = await call(`/invoices/${pf.id}/pdf`, { cookie: s.cookie });
      expect(res.status).toBe(409);
      expect(await bodyOf(res)).toMatchObject({
        error: {
          code: "withdrawn",
          message: "The PDF isn't available because this payment request was withdrawn.",
        },
      });
      const token = await link(f.a.finance, pf.id);
      const ip = nextIp();
      const viaLink = await call("/t/document/pdf", { body: { token }, ip });
      expect(viaLink.status).toBe(409);
      expect(((await bodyOf(viaLink)).error as { code: string }).code).toBe("withdrawn");
      expect(get).not.toHaveBeenCalled();
      // the spy sees the Worker's reads: a live proforma's PDF is read through it
      const live = await proforma(f.a.id, { delivered: "emailed", voided: false });
      expect((await call(`/invoices/${live.id}/pdf`, { cookie: s.cookie })).status).toBe(200);
      expect(get).toHaveBeenCalled();
      // a valid link: no failure counted for the address
      expect(await attemptsRow(await portalFailKey(env.PORTAL_KEY_PEPPER, ip))).toBeNull();
    } finally {
      get.mockRestore();
    }
    expect(await viewedAt(pf.id)).toBeNull();
  });
});

describe("what the client sees [ADM-INV-10, POR-06, Q3]", () => {
  it("the list: status withdrawn, the day it was withdrawn, no amount due and no due date", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const pf = await proforma(f.a.id, { delivered: "viewed" });
    const body = await bodyOf(await call("/invoices?limit=50", { cookie: s.cookie }));
    const row = (body.invoices as Record<string, unknown>[]).find((r) => r.id === pf.id);
    expect(row).toMatchObject({
      type: "proforma",
      status: "withdrawn",
      withdrawnOn: issueDateOf(pf.voidedAt),
      balanceMinor: null,
      balance: null,
      dueDate: null,
      total: "₹1,180.00",
    });
    expect(issueDateOf(pf.voidedAt)).toBe("2026-11-10");
    expect(JSON.stringify(body)).not.toContain(REASON);
    // a live document is unchanged: no withdrawnOn
    const live = (body.invoices as Record<string, unknown>[]).find((r) => r.id === f.a.docs.proforma);
    expect(live).toMatchObject({ status: "issued", withdrawnOn: null, balanceMinor: 118000 });
  });

  it("the page: withdrawn, no balance, due date or PDF, never the reason; reading it writes no view", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const pf = await proforma(f.a.id, { delivered: "emailed" });
    const res = await call(`/invoices/${pf.id}`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.document).toMatchObject({
      id: pf.id,
      type: "proforma",
      status: "withdrawn",
      withdrawnOn: "2026-11-10",
      balanceMinor: null,
      balance: null,
      dueDate: null,
      pdfReady: false,
    });
    expect(JSON.stringify(body)).not.toContain(REASON);
    expect(await viewedAt(pf.id)).toBeNull();
  });

  it("the emailed link: 200 with the withdrawn page, no failure counted, no view written", async () => {
    const f = await fixtures();
    const pf = await proforma(f.a.id, { delivered: "emailed" });
    const token = await link(f.a.finance, pf.id);
    const ip = nextIp();
    const res = await call("/t/document", { body: { token }, ip });
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.document).toMatchObject({
      status: "withdrawn",
      balanceMinor: null,
      dueDate: null,
      pdfReady: false,
    });
    expect(JSON.stringify(body)).not.toContain(REASON);
    expect(await attemptsRow(await portalFailKey(env.PORTAL_KEY_PEPPER, ip))).toBeNull();
    expect(await viewedAt(pf.id)).toBeNull();
  });
});
