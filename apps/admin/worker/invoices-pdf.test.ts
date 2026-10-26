// The PDF routes of invoices [ADM-INV-07, JOB-PDF-01; M5.1 generalises M4.4's]: the stored file streams through the session, a draft has none, a retry asks the
// jobs Worker again, and every one of them is for the invoice flow only. The PDF itself is made by the jobs Worker (stage B).
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { mkDoc } from "./test-clients.ts";
import { call, one, sessionFor, withEnv } from "./test-helpers.ts";
import {
  auditCount,
  codeOf,
  getInvoice,
  issueInvoice,
  json,
  mkInvoice,
  mkInvoiceClient,
  putBank,
  putCompany,
} from "./test-invoices.ts";

const owner = () => sessionFor("owner", { stepUp: true });
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

beforeAll(async () => {
  await putCompany();
  await putBank();
});

describe("GET /invoices/:id/pdf", () => {
  it("a draft and an unknown id are 404; an issued invoice with no PDF yet is 409 pdf_pending", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await call(`/invoices/${made.id}/pdf`, { cookie: o.cookie })).status).toBe(404);
    expect((await call("/invoices/nope/pdf", { cookie: o.cookie })).status).toBe(404);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const pending = await call(`/invoices/${made.id}/pdf`, { cookie: o.cookie });
    expect(pending.status).toBe(409);
    expect(await codeOf(pending)).toBe("pdf_pending");
    expect((await getInvoice(o, made.id)).pdf).toMatchObject({ state: "pending", sha256: null });
  });

  it("the stored file streams as a private attachment named after the number, for the owner, Staff and the accountant; Sales has none", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    const issued = await json(await issueInvoice(o, made.id));
    const key = `docs/tax_invoice/${issued.fy}/${made.id}-v1.pdf`;
    await env.DOCS.put(key, PDF);
    await env.DB.prepare("UPDATE documents SET pdf_r2_key = ?2, pdf_sha256 = ?3 WHERE id = ?1")
      .bind(made.id, key, "f".repeat(64))
      .run();
    for (const role of ["owner", "staff", "accountant"] as const) {
      const s = await sessionFor(role);
      const res = await call(`/invoices/${made.id}/pdf`, { cookie: s.cookie });
      expect(res.status, role).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Content-Disposition")).toContain(`TH-INV-${issued.fy}-`);
      expect(res.headers.get("ETag")).toBe(`"${"f".repeat(64)}"`);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    }
    expect(
      (await call(`/invoices/${made.id}/pdf`, { cookie: (await sessionFor("sales")).cookie })).status,
    ).toBe(403);
    expect((await getInvoice(o, made.id)).pdf).toMatchObject({ state: "ready", fingerprint: "f".repeat(12) });
  });

  it("a proposal is not an invoice: the invoice route says 404, and the document route does not serve an invoice", async () => {
    const o = await owner();
    const c = await mkInvoiceClient();
    const prop = await mkDoc(c.clientId, "proposal", { frozen: true });
    expect((await call(`/invoices/${prop}/pdf`, { cookie: o.cookie })).status).toBe(404);
    const made = await mkInvoice(o, { clientId: c.clientId });
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    expect((await call(`/documents/${made.id}/pdf`, { cookie: o.cookie })).status).toBe(404);
  });
});

describe("POST /invoices/:id/pdf/retry", () => {
  it("asks the jobs Worker again for an issued invoice without a PDF (one audit row); a draft is 404; one that has its PDF is 409 pdf_done", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await call(`/invoices/${made.id}/pdf/retry`, { cookie: o.cookie, body: {} })).status).toBe(404);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const sent: unknown[] = [];
    const queue = { send: async (m: unknown) => void sent.push(m), sendBatch: async () => undefined };
    const res = await call(
      `/invoices/${made.id}/pdf/retry`,
      { cookie: o.cookie, body: {} },
      withEnv(env, { PDF_QUEUE: queue }),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(sent).toEqual([{ v: 1, kind: "pdf.snapshot", documentId: made.id, reason: "retry" }]);
    expect(await auditCount("invoice.pdf_retry", made.id)).toBe(1);
    await env.DB.prepare("UPDATE documents SET pdf_r2_key = 'k', pdf_sha256 = ?2 WHERE id = ?1")
      .bind(made.id, "a".repeat(64))
      .run();
    const done = await call(`/invoices/${made.id}/pdf/retry`, { cookie: o.cookie, body: {} });
    expect(done.status).toBe(409);
    expect(await codeOf(done)).toBe("pdf_done");
    expect(await one("SELECT pdf_sha256 FROM documents WHERE id = ?", made.id)).toEqual({
      pdf_sha256: "a".repeat(64),
    });
  });

  it("an anonymised client takes nothing new: 409, no audit row, no message", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    await env.DB.prepare("UPDATE clients SET anonymised_at = 9 WHERE id = ?").bind(made.clientId).run();
    const sent: unknown[] = [];
    const queue = { send: async (m: unknown) => void sent.push(m), sendBatch: async () => undefined };
    const res = await call(
      `/invoices/${made.id}/pdf/retry`,
      { cookie: o.cookie, body: {} },
      withEnv(env, { PDF_QUEUE: queue }),
    );
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("client_anonymised");
    expect(sent).toEqual([]);
    expect(await auditCount("invoice.pdf_retry", made.id)).toBe(0);
  });

  it("the retry is a draft-level action (invoices.draft): the owner needs no fresh code and Staff may ask; the accountant and Sales may not", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const noCode = await sessionFor("owner");
    expect((await call(`/invoices/${made.id}/pdf/retry`, { cookie: noCode.cookie, body: {} })).status).toBe(
      200,
    );
    const staff = await sessionFor("staff");
    const res = await call(`/invoices/${made.id}/pdf/retry`, { cookie: staff.cookie, body: {} });
    expect(res.status, await res.clone().text()).toBe(200);
    for (const role of ["accountant", "sales"] as const) {
      const s = await sessionFor(role);
      expect(
        (await call(`/invoices/${made.id}/pdf/retry`, { cookie: s.cookie, body: {} })).status,
        role,
      ).toBe(403);
    }
  });
});
