// The signed-in contact's invoices [POR-06, POR-03, Q49, LD62, M5.4]: the list (keyset, newest first, never a draft or a void one), one document's summary and its PDF. A finance-only area; another
// organisation's invoice is the same 404 as one that does not exist (the cross-tenant harness runs these routes in scope.test.ts too).
import { env } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it } from "vitest";
import { fixtures } from "./fixtures.ts";
import { ROUTES } from "./guard.ts";
import { LIST_SQL, ONE_SQL } from "./invoices.ts";
import { bodyOf, call, one, sessionFor } from "./test-helpers.ts";

let seq = 0;
async function mk(
  orgId: string,
  o: { type?: string; status?: string; issueDate?: string; pdfKey?: string | null; void?: boolean } = {},
) {
  const id = uuidv7();
  const n = ++seq + 7000;
  await env.DB.prepare(
    "INSERT INTO documents (id, type, status, client_id, currency, frozen_at, series, fy, number, number_display, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor, pdf_r2_key, voided_at, void_reason) VALUES (?1, ?2, ?3, ?4, 'INR', 1000, 'inv-i', '2627', ?5, ?6, ?7, '2026-12-31', 100000, 100000, 118000, 118000, ?8, ?9, ?10)",
  )
    .bind(
      id,
      o.type ?? "tax_invoice",
      o.status ?? "issued",
      orgId,
      n,
      `TH/I/${n}`,
      o.issueDate ?? "2026-11-05",
      o.pdfKey ?? null,
      o.void ? 5 : null,
      o.void ? "x" : null,
    )
    .run();
  return id;
}

describe("the list [POR-06]", () => {
  it("is declared for finance contacts only, three routes, none with a token", () => {
    for (const p of ["/api/v1/invoices", "/api/v1/invoices/:id", "/api/v1/invoices/:id/pdf"])
      expect(ROUTES.find((r) => r.path === p)).toMatchObject({ method: "GET", access: "finance" });
  });

  it("lists this organisation's issued documents newest first, never a draft or a void one, never another organisation's; 404 without finance", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const older = await mk(f.a.id, { issueDate: "2026-10-01" });
    const newer = await mk(f.a.id, { issueDate: "2026-11-20" });
    const credited = await mk(f.a.id, { status: "partially_credited", issueDate: "2026-11-10" });
    const theirs = await mk(f.b.id);
    const res = await call("/invoices", { cookie: s.cookie });
    expect(res.status).toBe(200);
    const body = (await bodyOf(res)) as {
      invoices: { id: string; total: string; balance: string; type: string }[];
      next: string | null;
    };
    const ids = body.invoices.map((i) => i.id);
    expect(ids).toContain(older);
    expect(ids).toContain(credited);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(credited));
    expect(ids.indexOf(credited)).toBeLessThan(ids.indexOf(older));
    expect(ids).not.toContain(theirs);
    for (const hidden of [f.a.docs.draft, f.a.docs.pending, f.a.docs.void, f.a.docs.proposal])
      expect(ids).not.toContain(hidden);
    expect(body.invoices[0]).toMatchObject({ total: "₹1,180.00", balance: "₹1,180.00" });
    const plain = await sessionFor(f.a.plain);
    expect((await call("/invoices", { cookie: plain.cookie })).status).toBe(404);
    expect((await call("/invoices")).status).toBe(401);
  });

  it("pages by (issue date, id) with a cursor; a bad limit or cursor is a 400", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    for (let i = 0; i < 4; i++) await mk(f.a.id, { issueDate: `2027-01-0${i + 1}` });
    const first = (await bodyOf(await call("/invoices?limit=2", { cookie: s.cookie }))) as {
      invoices: { id: string }[];
      next: string | null;
    };
    expect(first.invoices).toHaveLength(2);
    expect(first.next).toMatch(/^2027-01-0\d:/);
    const second = (await bodyOf(
      await call(`/invoices?limit=2&after=${first.next}`, { cookie: s.cookie }),
    )) as { invoices: { id: string }[] };
    expect(second.invoices.map((i) => i.id).filter((id) => first.invoices.some((x) => x.id === id))).toEqual(
      [],
    );
    for (const bad of ["limit=abc", "limit=100", "after=nope", "after=2027-01-01"])
      expect((await call(`/invoices?${bad}`, { cookie: s.cookie })).status, bad).toBe(400);
  });

  it("the statements are served by an index on the organisation (EXPLAIN QUERY PLAN)", async () => {
    for (const sql of [LIST_SQL, ONE_SQL]) {
      const plan = (
        await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
          .bind(...(sql === LIST_SQL ? ["c", null, "", 51] : ["c", "d"]))
          .all<{ detail: string }>()
      ).results
        .map((r) => r.detail)
        .join(" | ");
      expect(plan).not.toMatch(/SCAN d\b(?! USING)/);
    }
  });
});

describe("one invoice and its PDF [POR-06]", () => {
  it("serves the summary of my own invoice, records the first view once; another organisation's, a draft and a void one are the same 404", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const mine = await mk(f.a.id);
    const res = await call(`/invoices/${mine}`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    expect(((await bodyOf(res)).document as { id: string; type: string }).id).toBe(mine);
    expect(
      (await one<{ v: number | null }>("SELECT viewed_at AS v FROM documents WHERE id = ?", mine))?.v,
    ).not.toBeNull();
    const missing = await call(`/invoices/no-such-${uuidv7()}`, { cookie: s.cookie });
    const ask = async (id: string) => {
      const r = await call(`/invoices/${id}`, { cookie: s.cookie });
      return { status: r.status, body: await bodyOf(r) };
    };
    const expected = { status: missing.status, body: await bodyOf(missing) };
    expect(expected.status).toBe(404);
    for (const id of [
      await mk(f.b.id),
      f.a.docs.draft,
      f.a.docs.void,
      f.a.docs.proposal,
      await mk(f.a.id, { status: "void", void: true }),
    ])
      expect(await ask(id)).toEqual(expected);
  });

  it("the PDF: 409 pdf_pending until it exists, then the attachment; another organisation's is the same 404", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const none = await mk(f.a.id);
    const pending = await call(`/invoices/${none}/pdf`, { cookie: s.cookie });
    expect(pending.status).toBe(409);
    expect(((await bodyOf(pending)).error as { code: string }).code).toBe("pdf_pending");
    const key = `docs/tax_invoice/2026-27/${8000 + ++seq}-v1.pdf`;
    await env.DOCS.put(key, "%PDF-1.4 signed in");
    const withPdf = await mk(f.a.id, { pdfKey: key });
    const res = await call(`/invoices/${withPdf}/pdf`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("%PDF-1.4 signed in");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; /);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const theirs = await mk(f.b.id, { pdfKey: key });
    expect((await call(`/invoices/${theirs}/pdf`, { cookie: s.cookie })).status).toBe(404);
    const plain = await sessionFor(f.a.plain);
    expect((await call(`/invoices/${withPdf}/pdf`, { cookie: plain.cookie })).status).toBe(404);
  });
});
