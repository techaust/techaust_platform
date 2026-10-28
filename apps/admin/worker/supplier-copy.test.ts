// GET /invoices/:id/pdf/supplier [Q11, owner 2026-10-28; Rule 48(2) CGST Rules]: the stored DUPLICATE FOR SUPPLIER copy, for the Owner and the Accountant only. It answers like /:id/pdf
// (the file, or 202 {state: making}; 409 pdf_pending for an erased client), a proforma, a draft and an unknown id are 404, and a missing copy is asked for again, once the original exists.
import { env } from "cloudflare:workers";
import { fyLabelOfToken, supplierPdfKey } from "@techaust/core/pdf-jobs";
import { beforeAll, describe, expect, it } from "vitest";
import { SUPPLIER_ASK_WINDOW_MS, supplierAskKey } from "./document-events.ts";
import { call, one, sessionFor, withEnv } from "./test-helpers.ts";
import { mkProforma } from "./test-invoice-types.ts";
import { codeOf, issueInvoice, mkInvoice, putBank, putCompany } from "./test-invoices.ts";
import { issueCredit, mkIssuedInvoice } from "./test-notes.ts";

const owner = () => sessionFor("owner", { stepUp: true });
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

beforeAll(async () => {
  await putCompany();
  await putBank();
});

const keyOf = async (id: string) => {
  const r = await one<{ type: string; fy: string; number: number }>(
    "SELECT type, fy, number FROM documents WHERE id = ?",
    id,
  );
  return supplierPdfKey({
    type: r?.type ?? "",
    fy: fyLabelOfToken(r?.fy ?? "") ?? "",
    number: r?.number ?? 0,
    version: 1,
  });
};
const queueOf = () => {
  const sent: unknown[] = [];
  return { sent, queue: { send: async (m: unknown) => void sent.push(m), sendBatch: async () => undefined } };
};

describe("GET /invoices/:id/pdf/supplier", () => {
  it("the stored copy streams as a private attachment for the owner and the accountant; Staff and Sales are 403", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    await env.DOCS.put(await keyOf(made.id), PDF);
    for (const role of ["owner", "accountant"] as const) {
      const res = await call(`/invoices/${made.id}/pdf/supplier`, {
        cookie: (await sessionFor(role)).cookie,
      });
      expect(res.status, role).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Content-Disposition")).toContain("supplier-copy.pdf");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
    }
    for (const role of ["staff", "sales"] as const)
      expect(
        (await call(`/invoices/${made.id}/pdf/supplier`, { cookie: (await sessionFor(role)).cookie })).status,
        role,
      ).toBe(403);
  });

  it("a credit note has a copy; a draft, a proforma and an unknown id are 404", async () => {
    const o = await owner();
    const inv = await mkIssuedInvoice(o, { prices: [100_000] });
    const { id } = await issueCredit(o, inv.id, { mode: "lines", lines: [{ line: 0, taxableMinor: 1_000 }] });
    await env.DOCS.put(await keyOf(id), PDF);
    expect((await call(`/invoices/${id}/pdf/supplier`, { cookie: o.cookie })).status).toBe(200);
    const draft = await mkInvoice(o);
    expect((await call(`/invoices/${draft.id}/pdf/supplier`, { cookie: o.cookie })).status).toBe(404);
    const pf = await mkProforma(o);
    expect((await issueInvoice(o, pf.id)).status).toBe(200);
    expect((await call(`/invoices/${pf.id}/pdf/supplier`, { cookie: o.cookie })).status).toBe(404);
    expect((await call("/invoices/nope/pdf/supplier", { cookie: o.cookie })).status).toBe(404);
  });

  it("not made yet: 202 making; with the original's PDF in place the route asks jobs for the copy (one idempotent message); without it, no message", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    const a = queueOf();
    const noOriginal = await call(
      `/invoices/${made.id}/pdf/supplier`,
      { cookie: o.cookie },
      withEnv(env, { PDF_QUEUE: a.queue }),
    );
    expect(noOriginal.status).toBe(202);
    expect(await noOriginal.json()).toEqual({ state: "making" });
    expect(a.sent).toEqual([]);
    await env.DB.prepare("UPDATE documents SET pdf_r2_key = 'k', pdf_sha256 = ?2 WHERE id = ?1")
      .bind(made.id, "a".repeat(64))
      .run();
    const b = queueOf();
    const asked = await call(
      `/invoices/${made.id}/pdf/supplier`,
      { cookie: o.cookie },
      withEnv(env, { PDF_QUEUE: b.queue }),
    );
    expect(asked.status).toBe(202);
    expect(await asked.json()).toEqual({ state: "making" });
    expect(b.sent).toEqual([{ v: 1, kind: "pdf.supplier", documentId: made.id, hop: 0 }]);
  });

  it("repeated and parallel downloads of a copy not made yet send ONE message in 5 minutes; after the window it asks again; a queue that fails frees the claim (review 2026-10-28, finding 8)", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    await env.DB.prepare("UPDATE documents SET pdf_r2_key = 'k', pdf_sha256 = ?2 WHERE id = ?1")
      .bind(made.id, "c".repeat(64))
      .run();
    const q = queueOf();
    const ask = () =>
      call(`/invoices/${made.id}/pdf/supplier`, { cookie: o.cookie }, withEnv(env, { PDF_QUEUE: q.queue }));
    // sequential: the first asks, the rest are held
    for (const res of [await ask(), await ask(), await ask()]) {
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ state: "making" });
    }
    // parallel: still the one message
    await Promise.all([ask(), ask(), ask(), ask()]);
    expect(q.sent).toEqual([{ v: 1, kind: "pdf.supplier", documentId: made.id, hop: 0 }]);
    // inside the window the claim is held; once the last ask is older than 5 minutes the next one goes
    const held = await env.DB.prepare("SELECT asked_at FROM pdf_asks WHERE key = ?1")
      .bind(supplierAskKey(made.id))
      .first<{ asked_at: number }>();
    expect(held?.asked_at).toBeGreaterThan(0);
    await env.DB.prepare("UPDATE pdf_asks SET asked_at = ?2 WHERE key = ?1")
      .bind(supplierAskKey(made.id), Date.now() - SUPPLIER_ASK_WINDOW_MS - 1)
      .run();
    await ask();
    expect(q.sent).toHaveLength(2);
    await ask();
    expect(q.sent).toHaveLength(2);
    // a queue that cannot be reached: the claim is released, so the next download asks again (not 5 minutes later)
    await env.DB.prepare("DELETE FROM pdf_asks WHERE key = ?1").bind(supplierAskKey(made.id)).run();
    const failing = {
      send: async () => {
        throw new Error("queue down");
      },
      sendBatch: async () => undefined,
    };
    const down = await call(
      `/invoices/${made.id}/pdf/supplier`,
      { cookie: o.cookie },
      withEnv(env, { PDF_QUEUE: failing }),
    );
    expect(down.status).toBe(202);
    await ask();
    expect(q.sent).toHaveLength(3);
  });

  it("an anonymised client: the stored copy still downloads (as the original does), but none is asked for", async () => {
    const o = await owner();
    const made = await mkInvoice(o);
    expect((await issueInvoice(o, made.id)).status).toBe(200);
    await env.DB.prepare("UPDATE documents SET pdf_r2_key = 'k', pdf_sha256 = ?2 WHERE id = ?1")
      .bind(made.id, "b".repeat(64))
      .run();
    await env.DB.prepare("UPDATE clients SET anonymised_at = 9 WHERE id = ?").bind(made.clientId).run();
    const q = queueOf();
    const res = await call(
      `/invoices/${made.id}/pdf/supplier`,
      { cookie: o.cookie },
      withEnv(env, { PDF_QUEUE: q.queue }),
    );
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("pdf_pending");
    expect(q.sent).toEqual([]);
  });
});
