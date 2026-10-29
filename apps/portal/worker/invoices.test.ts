// The signed-in contact's invoices [POR-06, POR-03, Q49, LD62, M5.4]: the list (keyset, newest first, never a draft or a void one), one document's summary and its PDF. A finance-only area; another
// organisation's invoice is the same 404 as one that does not exist (the cross-tenant harness runs these routes in scope.test.ts too).
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it, vi } from "vitest";
import { fixtures } from "./fixtures.ts";
import { ROUTES } from "./guard.ts";
import app from "./index.ts";
import { VIEW_SQL } from "./invoice-summary.ts";
import { LIST_SQL, ONE_SQL } from "./invoices.ts";
import { bodyOf, call, nextIp, ORIGIN, one, sessionFor } from "./test-helpers.ts";

let seq = 0;
async function mk(
  orgId: string,
  o: {
    type?: string;
    status?: string;
    issueDate?: string;
    pdfKey?: string | null;
    void?: boolean;
    headerExtras?: string | null;
  } = {},
) {
  const id = uuidv7();
  const n = ++seq + 7000;
  await env.DB.prepare(
    "INSERT INTO documents (id, type, status, client_id, currency, frozen_at, series, fy, number, number_display, issue_date, due_date, subtotal_minor, taxable_minor, total_minor, balance_minor, pdf_r2_key, voided_at, void_reason, header_extras) VALUES (?1, ?2, ?3, ?4, 'INR', 1000, 'inv-i', '2627', ?5, ?6, ?7, '2026-12-31', 100000, 100000, 118000, 118000, ?8, ?9, ?10, ?11)",
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
      o.headerExtras ?? null,
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
    // a voided document is hidden by its voided_at, whatever its status says (review L4)
    const voidedIssued = await mk(f.a.id, { status: "issued", void: true });
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
    expect(ids).not.toContain(voidedIssued);
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

  it("FX-4 (A5 5; Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28)): gstEstimate is true only for a proforma sealed with the marker; an older proforma and every other type are false", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const notice = "This is not a tax invoice. A tax invoice will be issued when payment is received.";
    const estimateOf = async (id: string) => {
      const res = await call(`/invoices/${id}`, { cookie: s.cookie });
      expect(res.status).toBe(200);
      return ((await bodyOf(res)).document as { gstEstimate: boolean }).gstEstimate;
    };
    const marked = JSON.stringify({ proforma: { notice, gstEstimate: true } });
    expect(await estimateOf(await mk(f.a.id, { type: "proforma", headerExtras: marked }))).toBe(true);
    // a proforma sealed before FX-4: the notice only, or no extras at all (the fixture's)
    expect(
      await estimateOf(
        await mk(f.a.id, { type: "proforma", headerExtras: JSON.stringify({ proforma: { notice } }) }),
      ),
    ).toBe(false);
    expect(await estimateOf(f.a.docs.proforma)).toBe(false);
    // the marker means nothing on another type
    expect(await estimateOf(await mk(f.a.id, { headerExtras: marked }))).toBe(false);
  });

  it("the PDF: 409 pdf_pending until it exists, then the attachment; another organisation's is the same 404", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const none = await mk(f.a.id);
    const pending = await call(`/invoices/${none}/pdf`, { cookie: s.cookie });
    expect(pending.status).toBe(409);
    expect(((await bodyOf(pending)).error as { code: string }).code).toBe("pdf_pending");
    // a PDF not delivered yet is not a view (lead, FX-5 fix round 1, question 2)
    expect(
      (await one<{ v: number | null }>("SELECT viewed_at AS v FROM documents WHERE id = ?", none))?.v ?? null,
    ).toBeNull();
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

// FX-5 (early check 1, 2 and 4; owner decision 2026-10-30, docs/13; 08-C RA-10): a document the client has opened can't be voided, so the view is
// written in the batch that reads what the answer shows, never in the background after it.
describe("the first view is written before the answer [FX-5, ADM-INV-07, 08-C RA-10]", () => {
  const viewedAt = async (id: string) =>
    (await one<{ v: number | null }>("SELECT viewed_at AS v FROM documents WHERE id = ?", id))?.v ?? null;
  const VOID =
    "UPDATE documents SET status = 'void', voided_at = ?2, void_reason = 'Issued in error' WHERE id = ?1";
  const voidNow = (id: string) => env.DB.prepare(VOID).bind(id, Date.now()).run();
  /** The access log refuses every insert while this trigger is installed: the background write (session touch and access row) then fails whole. */
  const BLOCK =
    "CREATE TRIGGER test_fx5_block_access BEFORE INSERT ON access_log BEGIN SELECT RAISE(ABORT, 'test: access log blocked'); END";
  const UNBLOCK = "DROP TRIGGER IF EXISTS test_fx5_block_access";
  const signedIn = (cookie: string) => ({ headers: { Cookie: cookie, "CF-Connecting-IP": nextIp() } });

  it("(a) viewed_at is set when exports.default.fetch resolves, and a void after it is refused by the database (documents_viewed_no_void)", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const doc = await mk(f.a.id);
    const res = await exports.default.fetch(`${ORIGIN}/api/v1/invoices/${doc}`, signedIn(s.cookie));
    expect(res.status).toBe(200);
    const at = await viewedAt(doc);
    expect(at).not.toBeNull();
    await expect(voidNow(doc)).rejects.toThrow(/documents_viewed_no_void/);
    expect(await viewedAt(doc)).toBe(at);
    // the control: the same void on a document nobody opened goes through (the refusal above is the view's, not another rule's)
    const unopened = await mk(f.a.id);
    await voidNow(unopened);
    expect(await one("SELECT status FROM documents WHERE id = ?", unopened)).toEqual({ status: "void" });
  });

  it("(b) voided first: the summary and the PDF are the same 404 and viewed_at stays NULL", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const key = `docs/tax_invoice/2026-27/${8000 + ++seq}-v1.pdf`;
    await env.DOCS.put(key, "%PDF-1.4 voided first");
    const doc = await mk(f.a.id, { pdfKey: key });
    await voidNow(doc);
    expect((await call(`/invoices/${doc}`, { cookie: s.cookie })).status).toBe(404);
    expect((await call(`/invoices/${doc}/pdf`, { cookie: s.cookie })).status).toBe(404);
    expect(await viewedAt(doc)).toBeNull();
  });

  it("(c) the view lands even when the background write fails, and before the request's background work is awaited", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const doc = await mk(f.a.id);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await env.DB.prepare(BLOCK).run();
    try {
      const ctx = createExecutionContext();
      const res = await app.request(`${ORIGIN}/api/v1/invoices/${doc}`, signedIn(s.cookie), env, ctx);
      expect(res.status).toBe(200);
      // read before the background work is awaited: the view is already there
      expect(await viewedAt(doc)).not.toBeNull();
      await waitOnExecutionContext(ctx);
      // the background write failed whole (its access row was refused), so the view can only have come from the answer's own batch
      expect(logged.mock.calls.some(([line]) => String(line).includes("access log write failed"))).toBe(true);
      expect(await viewedAt(doc)).not.toBeNull();
      await expect(voidNow(doc)).rejects.toThrow(/documents_viewed_no_void/);
    } finally {
      await env.DB.prepare(UNBLOCK).run();
      logged.mockRestore();
    }
  });

  it("(d) opening the PDF records the first view too, once; a PDF still being prepared is no view (lead, fix round 1 question 2)", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const key = `docs/tax_invoice/2026-27/${8000 + ++seq}-v1.pdf`;
    await env.DOCS.put(key, "%PDF-1.4 first view");
    const doc = await mk(f.a.id, { pdfKey: key });
    expect(await viewedAt(doc)).toBeNull();
    const res = await call(`/invoices/${doc}/pdf`, { cookie: s.cookie });
    expect(res.status).toBe(200);
    await res.arrayBuffer();
    const first = await viewedAt(doc);
    expect(first).not.toBeNull();
    const again = await call(`/invoices/${doc}/pdf`, { cookie: s.cookie });
    expect(again.status).toBe(200);
    await again.arrayBuffer();
    expect(await viewedAt(doc)).toBe(first);
    const pending = await mk(f.a.id);
    expect((await call(`/invoices/${pending}/pdf`, { cookie: s.cookie })).status).toBe(409);
    expect(await viewedAt(pending)).toBeNull();
    // another organisation's PDF is a 404 and writes nothing on their document
    const theirs = await mk(f.b.id, { pdfKey: key });
    expect((await call(`/invoices/${theirs}/pdf`, { cookie: s.cookie })).status).toBe(404);
    expect(await viewedAt(theirs)).toBeNull();
  });

  it("VIEW_SQL writes only a document the client may open: never a draft, a void one, an offer or another organisation's; at most once", async () => {
    const f = await fixtures();
    const changes = async (client: string, id: string) =>
      (await env.DB.prepare(VIEW_SQL).bind(client, id, Date.now()).run()).meta.changes;
    const open = await mk(f.a.id);
    expect(await changes(f.a.id, open)).toBe(1);
    expect(await changes(f.a.id, open)).toBe(0);
    for (const id of [
      f.a.docs.draft,
      f.a.docs.void,
      await mk(f.a.id, { status: "void", void: true }),
      await mk(f.a.id, { status: "issued", void: true }),
      f.a.docs.proposal,
    ])
      expect(await changes(f.a.id, id)).toBe(0);
    expect(await changes(f.a.id, await mk(f.b.id))).toBe(0);
  });
});
