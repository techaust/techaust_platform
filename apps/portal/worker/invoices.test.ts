// The signed-in contact's invoices [POR-06, POR-03, Q49, LD62, M5.4]: the list (keyset, newest first, never a draft or a void one), one document's summary and its PDF. A finance-only area; another
// organisation's invoice is the same 404 as one that does not exist (the cross-tenant harness runs these routes in scope.test.ts too).
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { uuidv7 } from "@techaust/core";
import { describe, expect, it, vi } from "vitest";
import { fixtures } from "./fixtures.ts";
import { ROUTES } from "./guard.ts";
import app from "./index.ts";
import { CREDIT_NOTES_SQL, SUMMARY_COLS, VIEW_SQL } from "./invoice-summary.ts";
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

/** An issued invoice with three lines (10 % off, ₹50.00 off, no discount): the lines go in while it is a draft, as the issue does. */
async function invoiceWithLines(orgId: string) {
  const id = uuidv7();
  const n = ++seq + 8000;
  await env.DB.prepare(
    "INSERT INTO documents (id, type, status, client_id, currency, subtotal_minor, taxable_minor, cgst_minor, sgst_minor, total_minor, balance_minor) VALUES (?1, 'tax_invoice', 'draft', ?2, 'INR', 300000, 285000, 25650, 25650, 336300, 0)",
  )
    .bind(id, orgId)
    .run();
  const line = (pos: number, kind: string | null, value: number | null, taxable: number) =>
    env.DB.prepare(
      "INSERT INTO document_lines (id, document_id, position, description, qty_milli, unit, rate_minor, discount_kind, discount_value, taxable_minor, gst_rate_bp, cgst_minor, sgst_minor, line_total_minor) VALUES (?1, ?2, ?3, ?4, 1000, 'fixed', 100000, ?5, ?6, ?7, 1800, ?8, ?8, ?9)",
    ).bind(
      uuidv7(),
      id,
      pos,
      `Line ${pos}`,
      kind,
      value,
      taxable,
      (taxable * 9) / 100,
      (taxable * 118) / 100,
    );
  await env.DB.batch([
    line(1, "percent", 1000, 90000),
    line(2, "fixed", 5000, 95000),
    line(3, null, null, 100000),
  ]);
  await env.DB.prepare(
    "UPDATE documents SET status = 'issued', series = 'inv-l', fy = '2627', number = ?2, number_display = ?3, frozen_at = 1000, issue_date = '2026-11-05', due_date = '2026-11-12', balance_minor = 336300 WHERE id = ?1",
  )
    .bind(id, n, `TH/INV/2627/${n}`)
    .run();
  return { id, number: `TH/INV/2627/${n}` };
}

/** A note against `parent`, inserted frozen (as doc-token.test.ts does), with its frozen request in `header_extras.noteOf`. */
async function noteAgainst(
  orgId: string,
  parent: { id: string; number: string },
  type: "credit_note" | "debit_note",
  o: { frozenAt?: number; reason?: { code: string; text: string }; headerExtras?: string } = {},
) {
  const id = uuidv7();
  const n = ++seq + 8500;
  const number = `TH/${type === "credit_note" ? "CN" : "DN"}/2627/${n}`;
  const noteOf = {
    kind: type === "credit_note" ? "credit" : "debit",
    parent: {
      id: parent.id,
      type: "tax_invoice",
      fy: "2627",
      number: parent.number,
      issueDate: "2026-11-05",
      supplyType: "intra",
      recipientStatus: "unregistered",
      placeOfSupplyCode: "19",
      totalMinor: 336300,
      totalInrMinor: null,
    },
    reason: o.reason ?? { code: "service_deficient", text: "Two pages were late" },
    request: { mode: "amount", grossMinor: 5000, takes: [{ line: 0, taxableMinor: 4237 }] },
  };
  await env.DB.prepare(
    "INSERT INTO documents (id, type, status, client_id, currency, parent_id, frozen_at, series, fy, number, number_display, issue_date, due_date, total_minor, balance_minor, header_extras) VALUES (?1, ?2, 'issued', ?3, 'INR', ?4, ?5, 'note-l', '2627', ?6, ?7, '2026-11-06', ?8, 5000, ?9, ?10)",
  )
    .bind(
      id,
      type,
      orgId,
      parent.id,
      o.frozenAt ?? 1000,
      n,
      number,
      type === "credit_note" ? null : "2026-11-13",
      type === "credit_note" ? 0 : 5000,
      o.headerExtras ?? JSON.stringify({ noteOf }),
    )
    .run();
  return { id, number };
}

describe("the summary's line discounts, credit notes and a note's invoice and reason (final sweep P2, P3, P15) [POR-06]", () => {
  type Doc = {
    id: string;
    parentId: string | null;
    parentNumber: string | null;
    noteReason: { code: string; text: string } | null;
    creditNotes: { id: string; numberDisplay: string | null }[];
    lines: {
      position: number;
      discountKind: string | null;
      discountValue: number | null;
      discount: string | null;
    }[];
  };
  const get = async (cookie: string, id: string) => {
    const res = await call(`/invoices/${id}`, { cookie });
    return { status: res.status, doc: ((await bodyOf(res)) as { document?: Doc }).document };
  };

  it("an invoice carries each line's discount as the PDF prints it and its issued credit notes, in issue order; never a debit note", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const inv = await invoiceWithLines(f.a.id);
    const second = await noteAgainst(f.a.id, inv, "credit_note", { frozenAt: 3000 });
    const first = await noteAgainst(f.a.id, inv, "credit_note", { frozenAt: 2000 });
    await noteAgainst(f.a.id, inv, "debit_note", { reason: { code: "price_correction", text: "Rate" } });
    const { status, doc } = await get(s.cookie, inv.id);
    expect(status).toBe(200);
    expect(doc?.lines.map((l) => [l.position, l.discountKind, l.discountValue, l.discount])).toEqual([
      [1, "percent", 1000, "10 %"],
      [2, "fixed", 5000, "₹50.00"],
      [3, null, null, null],
    ]);
    expect(doc?.creditNotes).toEqual([
      { id: first.id, numberDisplay: first.number },
      { id: second.id, numberDisplay: second.number },
    ]);
    // an invoice has no parent of its own here and no reason
    expect(doc).toMatchObject({ parentId: null, noteReason: null });
  });

  it("a credit or debit note carries its invoice (id and number) and its reason as frozen; no credit notes of its own", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.finance);
    const inv = await invoiceWithLines(f.a.id);
    const cn = await noteAgainst(f.a.id, inv, "credit_note");
    const dn = await noteAgainst(f.a.id, inv, "debit_note", {
      reason: { code: "tax_charged_too_low", text: "" },
    });
    expect((await get(s.cookie, cn.id)).doc).toMatchObject({
      parentId: inv.id,
      parentNumber: inv.number,
      noteReason: { code: "service_deficient", text: "Two pages were late" },
      creditNotes: [],
    });
    expect((await get(s.cookie, dn.id)).doc).toMatchObject({
      parentId: inv.id,
      parentNumber: inv.number,
      noteReason: { code: "tax_charged_too_low", text: "" },
      creditNotes: [],
    });
    // damaged frozen data names no reason (never a 500)
    const damaged = await noteAgainst(f.a.id, inv, "credit_note", {
      headerExtras: JSON.stringify({ noteOf: { kind: "credit", reason: "x" } }),
    });
    expect((await get(s.cookie, damaged.id)).doc).toMatchObject({ parentId: inv.id, noteReason: null });
    const notJson = await noteAgainst(f.a.id, inv, "credit_note", { headerExtras: "{not json" });
    expect((await get(s.cookie, notJson.id)).doc).toMatchObject({ noteReason: null });
  });

  it("scoping: another organisation's contact gets the same 404 for the invoice and its notes; the statements bound to another organisation return nothing", async () => {
    const f = await fixtures();
    const a = await sessionFor(f.a.finance);
    const b = await sessionFor(f.b.finance);
    const inv = await invoiceWithLines(f.a.id);
    const cn = await noteAgainst(f.a.id, inv, "credit_note");
    const missing = await call(`/invoices/no-such-${uuidv7()}`, { cookie: b.cookie });
    const expected = { status: missing.status, body: await bodyOf(missing) };
    for (const id of [inv.id, cn.id]) {
      const r = await call(`/invoices/${id}`, { cookie: b.cookie });
      expect({ status: r.status, body: await bodyOf(r) }).toEqual(expected);
    }
    // the credit notes and the parent are read with the session's organisation only
    const credits = (await env.DB.prepare(CREDIT_NOTES_SQL).bind(f.b.id, inv.id).all()).results;
    expect(credits).toEqual([]);
    expect((await env.DB.prepare(CREDIT_NOTES_SQL).bind(f.a.id, inv.id).all()).results).toHaveLength(1);
    expect((await env.DB.prepare(ONE_SQL).bind(f.b.id, cn.id).all()).results).toEqual([]);
    // B's own invoice lists none of A's notes; a contact without finance sees nothing
    const theirs = await mk(f.b.id);
    expect((await get(b.cookie, theirs)).doc?.creditNotes).toEqual([]);
    const plain = await sessionFor(f.a.plain);
    expect((await call(`/invoices/${inv.id}`, { cookie: plain.cookie })).status).toBe(404);
    expect((await get(a.cookie, inv.id)).doc?.creditNotes).toEqual([{ id: cn.id, numberDisplay: cn.number }]);
  });

  it("the parent is named only while the client may open it: the subselect is bound to the organisation and the open statuses", async () => {
    // the parent check trigger allows only an issued parent of the same client, so the guard is proven on the statement itself: pointed at
    // another organisation, or at a parent that is void, it yields NULL
    const f = await fixtures();
    const inv = await invoiceWithLines(f.a.id);
    const cn = await noteAgainst(f.a.id, inv, "credit_note");
    const parentOf = async (sql: string) =>
      (
        await env.DB.prepare(`SELECT ${sql} FROM documents d WHERE d.id = ?1`)
          .bind(cn.id)
          .first<{ p: string | null }>()
      )?.p ?? null;
    const subselect = SUMMARY_COLS.slice(SUMMARY_COLS.lastIndexOf("(SELECT p.id")).replace(
      / AS parent_open_id$/,
      " AS p",
    );
    expect(await parentOf(subselect)).toBe(inv.id);
    expect(
      await parentOf(subselect.replace("p.client_id = d.client_id", `p.client_id = '${f.b.id}'`)),
    ).toBeNull();
    expect(await parentOf(subselect.replace("p.voided_at IS NULL", "p.voided_at IS NOT NULL"))).toBeNull();
    // an invoice's own parent (a converted proforma) is not offered as a link: notes only
    expect(SUMMARY_COLS).toContain("d.type IN ('credit_note', 'debit_note')");
  });

  it("CREDIT_NOTES_SQL is served by documents_parent (EXPLAIN QUERY PLAN)", async () => {
    const plan = (
      await env.DB.prepare(`EXPLAIN QUERY PLAN ${CREDIT_NOTES_SQL}`).bind("c", "d").all<{ detail: string }>()
    ).results
      .map((r) => r.detail)
      .join(" | ");
    expect(plan).toMatch(/documents_parent/);
    expect(plan).not.toMatch(/SCAN n\b(?! USING)/);
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
