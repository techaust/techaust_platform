// POST /api/v1/t/document and /t/document/pdf: a single-document link, bound to one contact [POR-06, NFR-9, LD55, LD62, M5.4]. The token is in the body only, resolves exactly one
// document of the contact's own organisation, and the answer is that document's summary (frozen row and frozen lines) and nothing else. Failure paths first.
import { env } from "cloudflare:workers";
import { docTokenStmt, newDocToken, PORTAL_FAIL_LIMIT, portalFailKey, tokenHash } from "@techaust/auth";
import { uuidv7 } from "@techaust/core";
import { schema } from "@techaust/db";
import { describe, expect, it, vi } from "vitest";
import { DOC_READ, VIEW_PAY_TYPES } from "./doc-token.ts";
import { type FxContact, fixtures } from "./fixtures.ts";
import { ROUTES } from "./guard.ts";
import { CLIENT_INVOICE_STATUSES } from "./invoice-summary.ts";
import {
  attemptsRow,
  beforeBatch,
  bodyOf,
  call,
  counting,
  countOf,
  one,
  rows,
  withDb,
  writes,
} from "./test-helpers.ts";

const NOT_FOUND = { error: { code: "not_found", message: "Not found" } };
const use = (token: string, init: { ip?: string | null; headers?: Record<string, string> } = {}) =>
  call("/t/document", { body: { token }, ...init });
const usePdf = (token: string, init: { ip?: string | null; headers?: Record<string, string> } = {}) =>
  call("/t/document/pdf", { body: { token }, ...init });

let seq = 0;
/**
 * settle-08c T4 (rt2): a credit note, a debit note and an invoice for a payment received freeze only with a signature reference in the issuer block (trigger
 * `documents_signature_required`, migration 0055). The same reference as db `SIGNED_ISSUER` (no image: the trigger checks the reference only).
 */
const TEST_SIGNATURE = {
  key: "settings/signature-00112233aabbccdd.png",
  sha256: "ab".repeat(32),
  mime: "image/png",
} as const;
/** A frozen document of an organisation with two lines (the lines go in while it is still a draft, as the issue does); its issuer is signed (T4). */
async function frozenDoc(
  orgId: string,
  type: string,
  o: { status?: string; parentId?: string; pdfKey?: string; balance?: number } = {},
) {
  const id = uuidv7();
  const n = ++seq + 900;
  await env.DB.prepare(
    "INSERT INTO documents (id, type, status, client_id, currency, subtotal_minor, taxable_minor, cgst_minor, sgst_minor, total_minor, balance_minor, parent_id) VALUES (?1, ?2, 'draft', ?3, 'INR', 100000, 100000, 9000, 9000, 118000, 0, ?4)",
  )
    .bind(id, type, orgId, o.parentId ?? null)
    .run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO document_lines (id, document_id, position, description, qty_milli, unit, rate_minor, taxable_minor, gst_rate_bp, cgst_minor, sgst_minor, line_total_minor, sac) VALUES (?1, ?2, 1, 'Care plan, Growth', 1000, 'month', 100000, 100000, 1800, 9000, 9000, 118000, '998313')",
    ).bind(uuidv7(), id),
  ]);
  await env.DB.prepare(
    "UPDATE documents SET status = ?2, series = 'inv-t', fy = '2627', number = ?3, number_display = ?4, frozen_at = 1000, issue_date = '2026-11-05', due_date = ?5, balance_minor = ?6, pdf_r2_key = ?7, issuer = ?8 WHERE id = ?1",
  )
    .bind(
      id,
      o.status ?? "issued",
      n,
      `TH/T/${n}`,
      type === "credit_note" ? null : "2026-11-12",
      o.balance ?? 118000,
      o.pdfKey ?? null,
      JSON.stringify({
        signature: TEST_SIGNATURE,
        bank: {
          inr: {
            accountName: "TecHaust",
            accountNo: "123",
            ifsc: "BANK0001",
            bankName: "Bank",
            branch: null,
          },
        },
      }),
    )
    .run();
  return id;
}

async function link(
  contact: FxContact,
  documentId: string,
  o: { expiresIn?: number; sendId?: string | null } = {},
) {
  const { token, stmt } = await docTokenStmt(env.DB, {
    documentId,
    purpose: "view_pay",
    expiresAt: Date.now() + (o.expiresIn ?? 86_400_000),
    contactId: contact.id,
    clientId: contact.clientId,
    email: contact.email,
    sendId: o.sendId ?? null,
  });
  await stmt.run();
  return token;
}

describe("a valid link opens exactly one document [POR-06]", () => {
  it("200 with the summary of the frozen row and its lines; 2 D1 calls; nothing of the client or another document", async () => {
    const f = await fixtures();
    const doc = await frozenDoc(f.a.id, "tax_invoice");
    const token = await link(f.a.finance, doc);
    const { res, calls } = await counting("/t/document", { body: { token } });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    const body = (await bodyOf(res)) as { document: Record<string, unknown> };
    expect(Object.keys(body)).toEqual(["document"]);
    expect(Object.keys(body.document).sort()).toEqual(
      [
        "balance",
        "balanceMinor",
        "bank",
        "creditedMinor",
        // final sweep P2: the issued credit notes against an invoice (none here)
        "creditNotes",
        "currency",
        "dueDate",
        // FX-4 (A5 5): false here (a tax invoice); true only for a proforma sealed with the estimate marker
        "gstEstimate",
        "id",
        "issueDate",
        "lines",
        "numberDisplay",
        // final sweep P15: a note's reason and its invoice's id (both null on an invoice)
        "noteReason",
        "paidMinor",
        "parentId",
        "parentNumber",
        "pdfReady",
        "status",
        // M6.1 (07-ZH line 18): the TDS the client deducted, and its summary row (null when none)
        "tdsMinor",
        "tdsRow",
        "total",
        "totals",
        "type",
        // ADM-INV-10: the day a proforma was withdrawn (null here)
        "withdrawnOn",
        // M6.2 (POR-06): the Pay now block, bound to the link's client
        "payOnline",
        "wholeRupees",
        "online",
        // M6.3: the gateway of the document's currency (Stripe for USD, Razorpay for INR)
        "provider",
      ].sort(),
    );
    expect(body.document).toMatchObject({
      id: doc,
      type: "tax_invoice",
      status: "issued",
      currency: "INR",
      gstEstimate: false,
      issueDate: "2026-11-05",
      dueDate: "2026-11-12",
      total: "₹1,180.00",
      balance: "₹1,180.00",
      pdfReady: false,
      bank: { inr: { accountNo: "123", ifsc: "BANK0001" } },
    });
    expect(
      (body.document.lines as { description: string; qtyMilli: number; lineTotalMinor: number }[])[0],
    ).toMatchObject({
      description: "Care plan, Growth",
      qtyMilli: 1000,
      lineTotalMinor: 118000,
    });
    const text = JSON.stringify(body);
    for (const secret of [f.a.id, f.a.name, f.a.finance.email, "recipient", "content_sha256", "pdf_r2_key"])
      expect(text).not.toContain(secret);
  });

  it("a USD invoice shows the SWIFT account, never the INR one (early check finding 8)", async () => {
    const clientId = uuidv7();
    await env.DB.prepare(
      "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, currency) VALUES (?1, ?2, 'U', 'U', 'business', 'US', 'overseas', 'USD')",
    )
      .bind(clientId, `CL-U${++seq}`)
      .run();
    const contactId = uuidv7();
    const email = `u${seq}@example.test`;
    await env.DB.prepare(
      "INSERT INTO contacts (id, client_id, name, email, portal_access, can_see_finance) VALUES (?1, ?2, 'U', ?3, 1, 1)",
    )
      .bind(contactId, clientId, email)
      .run();
    const id = uuidv7();
    await env.DB.prepare(
      "INSERT INTO documents (id, type, status, client_id, currency, total_minor, balance_minor) VALUES (?1, 'export_invoice', 'draft', ?2, 'USD', 1000, 0)",
    )
      .bind(id, clientId)
      .run();
    const issuer = JSON.stringify({
      bank: {
        inr: {
          accountName: "TecHaust",
          accountNo: "INR123",
          ifsc: "BANK0001",
          bankName: "Bank",
          branch: null,
        },
        swift: {
          accountName: "TecHaust",
          accountNo: "USD456",
          swift: "SAMPUS33",
          bankName: "US Bank",
          branch: null,
          bankAddress: "1 Main St",
          intermediary: null,
          purposeCode: "P0802",
        },
      },
    });
    await env.DB.prepare(
      "UPDATE documents SET status = 'issued', series = 'exp-t', fy = '2627', number = 31, number_display = 'TH/EXP/2627/0031', frozen_at = 1000, issue_date = '2026-11-05', balance_minor = 1000, issuer = ?2 WHERE id = ?1",
    )
      .bind(id, issuer)
      .run();
    const res = await use(await link({ id: contactId, clientId, email, name: "U", finance: false }, id));
    expect(res.status).toBe(200);
    const body = JSON.stringify(await res.json());
    expect(body).toContain('"swift":{');
    expect(body).toContain("SAMPUS33");
    expect(body).toContain("USD456");
    expect(body).not.toContain("INR123");
    expect(body).not.toContain("BANK0001");
  });

  it("each organisation's link opens its own document and no other", async () => {
    const f = await fixtures();
    const a = (await (await use(f.tokens.aIssued)).json()) as { document: { id: string } };
    const b = (await (await use(f.tokens.bIssued)).json()) as { document: { id: string } };
    expect(a.document.id).toBe(f.a.docs.issued);
    expect(b.document.id).toBe(f.b.docs.issued);
  });

  it("every type of the invoice family opens: proforma, tax invoice, export invoice, credit note (no due date, no bank) and debit note (its own due date)", async () => {
    const f = await fixtures();
    expect(VIEW_PAY_TYPES).toEqual([
      "proforma",
      "tax_invoice",
      "export_invoice",
      "credit_note",
      "debit_note",
    ]);
    expect(
      ((await (await use(f.tokens.aProforma)).json()) as { document: { type: string } }).document.type,
    ).toBe("proforma");
    const parent = f.a.docs.issued;
    const dn = await frozenDoc(f.a.id, "debit_note", { parentId: parent });
    const dnRes = await use(await link(f.a.finance, dn));
    expect(dnRes.status).toBe(200);
    const d = (
      (await dnRes.json()) as {
        document: { type: string; dueDate: string | null; parentNumber: string | null };
      }
    ).document;
    expect(d).toMatchObject({ type: "debit_note", dueDate: "2026-11-12" });
    expect(d.parentNumber).toMatch(/^TH\/INV\/2627\//);
    // a credit note is inserted frozen (its issue batch sets the IMS status; lines are refused on a frozen row, so it has none here)
    const cn = uuidv7();
    await env.DB.prepare(
      "INSERT INTO documents (id, type, status, client_id, currency, parent_id, frozen_at, series, fy, number, number_display, issue_date, total_minor, balance_minor, issuer) VALUES (?1, 'credit_note', 'issued', ?2, 'INR', ?3, 1000, 'cn-t', '2627', 77, 'TH/CN/2627/0077', '2026-11-06', 5000, 0, ?4)",
    )
      .bind(
        cn,
        f.a.id,
        parent,
        JSON.stringify({
          bank: { inr: { accountName: "T", accountNo: "1", ifsc: null, bankName: "B", branch: null } },
        }),
      )
      .run();
    const cnRes = await use(await link(f.a.finance, cn));
    expect(cnRes.status).toBe(200);
    expect(((await cnRes.json()) as { document: Record<string, unknown> }).document).toMatchObject({
      type: "credit_note",
      dueDate: null,
      balanceMinor: 0,
      bank: null,
    });
  });

  it("final sweep P2, P15: the link to an invoice names its issued credit notes; the link to a note names its invoice (id, number) and its frozen reason", async () => {
    const f = await fixtures();
    const parent = await frozenDoc(f.a.id, "tax_invoice");
    const parentNumber = (
      await one<{ n: string }>("SELECT number_display AS n FROM documents WHERE id = ?", parent)
    )?.n;
    const noteOf = {
      kind: "credit",
      parent: {
        id: parent,
        type: "tax_invoice",
        fy: "2627",
        number: parentNumber,
        issueDate: "2026-11-05",
        supplyType: "intra",
        recipientStatus: "unregistered",
        placeOfSupplyCode: "19",
        totalMinor: 118000,
        totalInrMinor: null,
      },
      reason: { code: "price_correction", text: "Agreed rate" },
      request: { mode: "full", takes: [{ line: 0, taxableMinor: 100000 }] },
    };
    const cn = uuidv7();
    await env.DB.prepare(
      "INSERT INTO documents (id, type, status, client_id, currency, parent_id, frozen_at, series, fy, number, number_display, issue_date, total_minor, balance_minor, header_extras) VALUES (?1, 'credit_note', 'issued', ?2, 'INR', ?3, 1000, 'cn-p', '2627', 78, 'TH/CN/2627/0078', '2026-11-06', 5000, 0, ?4)",
    )
      .bind(cn, f.a.id, parent, JSON.stringify({ noteOf }))
      .run();
    const inv = (await (await use(await link(f.a.finance, parent))).json()) as {
      document: Record<string, unknown>;
    };
    expect(inv.document).toMatchObject({
      creditNotes: [{ id: cn, numberDisplay: "TH/CN/2627/0078" }],
      parentId: null,
      noteReason: null,
    });
    const note = (await (await use(await link(f.a.finance, cn))).json()) as {
      document: Record<string, unknown>;
    };
    expect(note.document).toMatchObject({
      parentId: parent,
      parentNumber,
      noteReason: { code: "price_correction", text: "Agreed rate" },
      creditNotes: [],
    });
    // another organisation's link opens its own document only: none of A's notes or invoice
    const theirs = (await (await use(f.tokens.bIssued)).json()) as { document: Record<string, unknown> };
    expect(theirs.document).toMatchObject({ creditNotes: [], parentId: null });
    expect(JSON.stringify(theirs)).not.toContain(cn);
  });

  it("is declared public, a POST, with no token in the path or query of any route", () => {
    for (const path of ["/api/v1/t/document", "/api/v1/t/document/pdf"])
      expect(ROUTES.find((r) => r.path === path)).toMatchObject({ method: "POST", access: "public" });
    for (const r of ROUTES) {
      // the only path parameters are ids of the session's own offers and invoices; a token is never in a path
      expect(
        r.path.replace("/offers/:id", "/offers").replace("/invoices/:id", "/invoices"),
        r.path,
      ).not.toMatch(/:|\?|token/i);
    }
  });

  it("the token in a query or a path does nothing", async () => {
    const f = await fixtures();
    const viaQuery = await call(`/t/document?token=${f.tokens.aIssued}`, { method: "POST", body: {} });
    expect(viaQuery.status).toBe(400);
    expect((await call(`/t/${f.tokens.aIssued}`)).status).toBe(404);
    expect((await call(`/t/document/${f.tokens.aIssued}`)).status).toBe(404);
  });

  it("a bad body is a 400 with no D1 call", async () => {
    for (const body of [{}, { token: 1 }, { token: null }, { token: "x".repeat(257) }]) {
      const { res, calls } = await counting("/t/document", { body });
      expect(res.status).toBe(400);
      expect(calls).toBe(0);
    }
  });
});

describe("a link is bound to its contact [POR-06, LD55]", () => {
  const closes: [string, (f: Awaited<ReturnType<typeof fixtures>>, c: FxContact) => Promise<void>][] = [
    [
      "portal access turned off",
      async (_f, c) =>
        void (await env.DB.prepare("UPDATE contacts SET portal_access = 0 WHERE id = ?").bind(c.id).run()),
    ],
    [
      "finance access turned off (POR-03)",
      async (_f, c) =>
        void (await env.DB.prepare("UPDATE contacts SET can_see_finance = 0 WHERE id = ?").bind(c.id).run()),
    ],
    [
      "the address changed",
      async (_f, c) =>
        void (await env.DB.prepare("UPDATE contacts SET email = ? WHERE id = ?")
          .bind(`moved-${c.id}@example.test`, c.id)
          .run()),
    ],
    [
      "the contact anonymised",
      async (_f, c) =>
        void (await env.DB.prepare("UPDATE contacts SET anonymised_at = ? WHERE id = ?")
          .bind(Date.now(), c.id)
          .run()),
    ],
    [
      "the client anonymised",
      async (_f, c) =>
        void (await env.DB.prepare(
          "UPDATE clients SET anonymised_at = ? WHERE id = (SELECT client_id FROM contacts WHERE id = ?)",
        )
          .bind(Date.now(), c.id)
          .run()),
    ],
  ];
  for (const [name, close] of closes)
    it(`${name}: the same 404 as an unknown link, counted`, async () => {
      const f = await fixtures();
      const org = await (async () => {
        // a fresh organisation, so closing it does not disturb the shared fixtures
        const clientId = uuidv7();
        await env.DB.prepare(
          "INSERT INTO clients (id, code, legal_name, display_name, type, country, gst_status, state_code, currency) VALUES (?1, ?2, 'L', 'D', 'business', 'IN', 'unregistered', '19', 'INR')",
        )
          .bind(clientId, `CL-Z${++seq}`)
          .run();
        const contactId = uuidv7();
        const email = `z${seq}@example.test`;
        await env.DB.prepare(
          "INSERT INTO contacts (id, client_id, name, email, portal_access, can_see_finance) VALUES (?1, ?2, 'Z', ?3, 1, 1)",
        )
          .bind(contactId, clientId, email)
          .run();
        return {
          clientId,
          contact: { id: contactId, clientId, email, name: "Z", finance: false } as FxContact,
        };
      })();
      void f;
      const token = await link(org.contact, await frozenDoc(org.clientId, "tax_invoice"));
      expect((await use(token)).status).toBe(200);
      await close(f, org.contact);
      const ip = `192.0.2.${100 + seq}`;
      const { res, calls } = await counting("/t/document", { body: { token }, ip });
      expect(res.status).toBe(404);
      expect(await bodyOf(res)).toEqual(NOT_FOUND);
      expect(calls).toBe(2);
      expect((await attemptsRow(await portalFailKey(env.PORTAL_KEY_PEPPER, ip)))?.failures).toBe(1);
      expect((await usePdf(token)).status).toBe(404);
    });

  it("a link names ONE document: it never opens another invoice of the same organisation", async () => {
    const f = await fixtures();
    const one_ = await frozenDoc(f.a.id, "tax_invoice");
    const other = await frozenDoc(f.a.id, "tax_invoice");
    const res = await use(await link(f.a.finance, one_));
    expect(((await res.json()) as { document: { id: string } }).document.id).toBe(one_);
    expect(one_).not.toBe(other);
  });

  it("the database refuses a link that is not bound, or for a draft, another client's document or another client's contact (the trigger of 0044)", async () => {
    const f = await fixtures();
    await expect(
      env.DB.prepare(
        "INSERT INTO doc_access_tokens (token_hash, document_id, purpose, expires_at) VALUES ('h-unbound', ?1, 'view_pay', 9999999999999)",
      )
        .bind(f.a.docs.issued)
        .run(),
    ).rejects.toThrow(/doc_access_tokens_bound_insert/);
    await expect(link(f.a.finance, f.a.docs.draft)).rejects.toThrow(/doc_access_tokens_bound_insert/);
    await expect(link(f.a.finance, f.a.docs.pending)).rejects.toThrow(/doc_access_tokens_bound_insert/);
    await expect(link(f.a.finance, f.b.docs.issued)).rejects.toThrow(/doc_access_tokens_bound_insert/);
    await expect(link(f.b.finance, f.a.docs.issued)).rejects.toThrow(/doc_access_tokens_bound_insert/);
  });
});

describe("tokens are random and stored hashed [POR-06]", () => {
  it("newDocToken: 32 random bytes; docTokenStmt stores SHA-256 and resolves exactly one document", async () => {
    const f = await fixtures();
    const t = newDocToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const token = await link(f.a.finance, f.a.docs.proforma);
    const stored = await rows<{ token_hash: string; document_id: string; contact_id: string; email: string }>(
      "SELECT token_hash, document_id, contact_id, email FROM doc_access_tokens WHERE token_hash = ?",
      await tokenHash(token),
    );
    expect(stored).toEqual([
      {
        token_hash: await tokenHash(token),
        document_id: f.a.docs.proforma,
        contact_id: f.a.finance.id,
        email: f.a.finance.email,
      },
    ]);
    expect(JSON.stringify(await rows("SELECT * FROM doc_access_tokens"))).not.toContain(token);
    const res = await use(token);
    expect(((await res.json()) as { document: { id: string } }).document.id).toBe(f.a.docs.proforma);
  });

  it("the database can hold only the view_pay purpose (the query asks for it too)", async () => {
    const f = await fixtures();
    await expect(
      env.DB.prepare(
        "INSERT INTO doc_access_tokens (token_hash, document_id, purpose, expires_at, contact_id, client_id, email) VALUES ('h-other', ?1, 'pay_only', 9999999999999, ?2, ?3, ?4)",
      )
        .bind(f.a.docs.issued, f.a.finance.id, f.a.id, f.a.finance.email)
        .run(),
    ).rejects.toThrow(/doc_access_tokens_purpose|CHECK/);
    expect(DOC_READ).toContain("t.purpose = 'view_pay'");
  });
});

describe("everything else is the same 404 [POR-06]", () => {
  it("revoked, expired, void, wrong type (a proposal), unknown and malformed: identical status and body, 2 calls", async () => {
    const f = await fixtures();
    const cases: [string, string][] = [
      ["revoked", f.tokens.aIssuedRevoked],
      ["expired", f.tokens.aIssuedExpired],
      ["void", f.tokens.aVoid],
      ["wrong type (a proposal)", f.tokens.aProposal],
      ["unknown", "A".repeat(43)],
      ["malformed", "not-a-token"],
      ["empty", ""],
      ["a document id instead of a token", f.a.docs.issued],
    ];
    for (const [name, token] of cases) {
      const { res, calls } = await counting("/t/document", { body: { token } });
      expect(res.status, name).toBe(404);
      expect(await bodyOf(res), name).toEqual(NOT_FOUND);
      expect(calls, name).toBe(2);
    }
  });

  it("the status rule is an allow-list: every schema status is either open or closed, and each opens or not accordingly", async () => {
    const f = await fixtures();
    const CLOSED_QUOTES = [
      "draft",
      "pending_approval",
      "void",
      "sent",
      "viewed",
      "accepted",
      "rejected",
      "expired",
      "revised",
    ];
    // the allow-list the SQL really uses: every schema status except the closed ones and the quote statuses
    expect([...CLIENT_INVOICE_STATUSES].sort()).toEqual(
      [...schema.DOCUMENT_STATUSES].filter((s) => !CLOSED_QUOTES.includes(s)).sort(),
    );
    expect(DOC_READ).toContain("d.status IN (");
    expect(DOC_READ).not.toContain("NOT IN");
    for (const status of schema.DOCUMENT_STATUSES) {
      const did = uuidv7();
      // inserted frozen, as a link needs (a draft cannot get one); the quote statuses are never open for an invoice-family document
      await env.DB.prepare(
        "INSERT INTO documents (id, type, status, client_id, currency, frozen_at, series, fy, number, number_display, voided_at, void_reason) VALUES (?1, 'proforma', ?2, ?3, 'INR', 1000, 'p', '2627', ?4, ?5, ?6, ?7)",
      )
        .bind(
          did,
          status,
          f.a.id,
          ++seq + 5000,
          `TH/S/${seq}`,
          status === "void" ? 5 : null,
          status === "void" ? "x" : null,
        )
        .run();
      const token = await link(f.a.finance, did);
      const open = (CLIENT_INVOICE_STATUSES as readonly string[]).includes(status);
      expect((await use(token)).status, status).toBe(open ? 200 : 404);
    }
    expect(CLOSED_QUOTES.length).toBeGreaterThan(0);
  });

  it("a voided document stops opening even if it was open when the link was made", async () => {
    const f = await fixtures();
    const doc = await frozenDoc(f.b.id, "tax_invoice");
    const token = await link(f.b.finance, doc);
    // FX-5 (owner decision 2026-10-30, 08-C RA-10): a document the client has opened is never voided (trigger documents_viewed_no_void), so
    // the void lands before the first use here; the link made while it was open stops working.
    await env.DB.prepare(
      "UPDATE documents SET status = 'void', voided_at = ?1, void_reason = 'test' WHERE id = ?2",
    )
      .bind(Date.now(), doc)
      .run();
    expect((await use(token)).status).toBe(404);
    // and once opened, a document can't be voided at all
    const opened = await frozenDoc(f.b.id, "tax_invoice");
    const openedToken = await link(f.b.finance, opened);
    expect((await use(openedToken)).status).toBe(200);
    await expect(
      env.DB.prepare(
        "UPDATE documents SET status = 'void', voided_at = ?1, void_reason = 'test' WHERE id = ?2",
      )
        .bind(Date.now(), opened)
        .run(),
    ).rejects.toThrow(/documents_viewed_no_void/);
  });
});

describe("the first view and the audit rows [NFR-9, Q1 = A]", () => {
  it("viewed_at is set once, by the first use", async () => {
    const f = await fixtures();
    const doc = await frozenDoc(f.a.id, "tax_invoice");
    const token = await link(f.a.finance, doc);
    expect(
      (await one<{ v: number | null }>("SELECT viewed_at AS v FROM documents WHERE id = ?", doc))?.v,
    ).toBeNull();
    await use(token);
    const first = (await one<{ v: number }>("SELECT viewed_at AS v FROM documents WHERE id = ?", doc))?.v;
    expect(first).toBeGreaterThan(0);
    await use(token);
    expect((await one<{ v: number }>("SELECT viewed_at AS v FROM documents WHERE id = ?", doc))?.v).toBe(
      first,
    );
  });

  it("every valid use writes exactly one doc_token.use row (actor type contact, the contact the link is bound to, the document) and one access row", async () => {
    const f = await fixtures();
    await call("/t/document", {
      body: { token: f.tokens.aIssued },
      ip: "192.0.2.81",
      headers: { "cf-ray": "ray-doc-1", "User-Agent": "doc-agent" },
    });
    await call("/t/document", { body: { token: f.tokens.aIssued }, headers: { "cf-ray": "ray-doc-2" } });
    expect(
      await rows(
        "SELECT actor_type, actor_id, role, action, entity_type, entity_id, ip, user_agent FROM audit_log WHERE request_id = 'ray-doc-1'",
      ),
    ).toEqual([
      {
        actor_type: "contact",
        actor_id: f.a.finance.id,
        role: null,
        action: "doc_token.use",
        entity_type: "document",
        entity_id: f.a.docs.issued,
        ip: "192.0.2.81",
        user_agent: "doc-agent",
      },
    ]);
    expect(await countOf("audit_log", "request_id = 'ray-doc-2' AND action = 'doc_token.use'")).toBe(1);
    expect(
      await rows("SELECT realm, actor_id, route, status FROM access_log WHERE request_id = 'ray-doc-1'"),
    ).toEqual([{ realm: "portal", actor_id: f.a.finance.id, route: "/api/v1/t/document", status: 200 }]);
  });

  it("a failed check writes its counter and an access row (404) and NO audit row", async () => {
    const before = await countOf("audit_log");
    const ip = "192.0.2.82";
    const res = await call("/t/document", {
      body: { token: "q".repeat(43) },
      ip,
      headers: { "cf-ray": "ray-doc-bad" },
    });
    expect(res.status).toBe(404);
    expect(await countOf("audit_log")).toBe(before);
    expect(
      await rows("SELECT actor_id, route, status FROM access_log WHERE request_id = 'ray-doc-bad'"),
    ).toEqual([{ actor_id: null, route: "/api/v1/t/document", status: 404 }]);
    expect((await attemptsRow(await portalFailKey(env.PORTAL_KEY_PEPPER, ip)))?.failures).toBe(1);
  });
});

describe("the wall clock of the summary (local; the staging reading is the gate)", () => {
  it("a 100-line invoice is one read of the frozen row and its lines, summarised without the envelope", async () => {
    const f = await fixtures();
    const id = uuidv7();
    await env.DB.prepare(
      "INSERT INTO documents (id, type, status, client_id, currency, subtotal_minor, taxable_minor, total_minor, balance_minor) VALUES (?1, 'tax_invoice', 'draft', ?2, 'INR', 100000, 100000, 118000, 0)",
    )
      .bind(id, f.a.id)
      .run();
    await env.DB.batch(
      Array.from({ length: 100 }, (_, i) =>
        env.DB.prepare(
          "INSERT INTO document_lines (id, document_id, position, description, qty_milli, unit, rate_minor, taxable_minor, gst_rate_bp, cgst_minor, sgst_minor, line_total_minor, sac) VALUES (?1, ?2, ?3, ?4, 1000, 'fixed', 1000, 1000, 1800, 90, 90, 1180, '998313')",
        ).bind(uuidv7(), id, i + 1, `Line ${i + 1} of a long invoice`),
      ),
    );
    await env.DB.prepare(
      "UPDATE documents SET status = 'issued', series = 'inv-t', fy = '2627', number = 4242, number_display = 'TH/T/4242', frozen_at = 1000, issue_date = '2026-11-05', due_date = '2026-11-12', balance_minor = 118000 WHERE id = ?1",
    )
      .bind(id)
      .run();
    const token = await link(f.a.finance, id);
    const t0 = performance.now();
    const res = await use(token);
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    expect(res.status).toBe(200);
    expect(((await res.json()) as { document: { lines: unknown[] } }).document.lines).toHaveLength(100);
    expect(ms).toBeLessThan(2_000);
    console.info(`[M5.4 wall clock ms] portal summary of 100 lines: ${ms}`);
  });
});

describe("the PDF behind the link [POR-06, M4.5 headers]", () => {
  it("409 pdf_pending until it exists; then the bytes as an attachment, never rendered, never cached, never sniffed", async () => {
    const f = await fixtures();
    const none = await frozenDoc(f.a.id, "tax_invoice");
    const pending = await usePdf(await link(f.a.finance, none));
    expect(pending.status).toBe(409);
    expect(((await bodyOf(pending)).error as { code: string }).code).toBe("pdf_pending");
    // a PDF not delivered yet is not a view (lead, FX-5 fix round 1, question 2)
    expect(
      (await one<{ v: number | null }>("SELECT viewed_at AS v FROM documents WHERE id = ?", none))?.v ?? null,
    ).toBeNull();
    const key = `docs/tax_invoice/2026-27/${9000 + ++seq}-v1.pdf`;
    await env.DOCS.put(key, "%PDF-1.4 test");
    const doc = await frozenDoc(f.a.id, "tax_invoice", { pdfKey: key });
    const res = await usePdf(await link(f.a.finance, doc));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("%PDF-1.4 test");
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="TH-T-\d+-v1\.pdf"$/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe("sandbox");
  });
  it("FX-5 (early check 2; 08-C RA-10): opening the PDF through the link records the first view before the answer, once; a bad link writes none", async () => {
    const f = await fixtures();
    const viewedAt = async (id: string) =>
      (await one<{ v: number | null }>("SELECT viewed_at AS v FROM documents WHERE id = ?", id))?.v ?? null;
    const key = `docs/tax_invoice/2026-27/${9000 + ++seq}-v1.pdf`;
    await env.DOCS.put(key, "%PDF-1.4 view");
    const doc = await frozenDoc(f.a.id, "tax_invoice", { pdfKey: key });
    const token = await link(f.a.finance, doc);
    const res = await usePdf(token);
    expect(res.status).toBe(200);
    await res.arrayBuffer();
    const first = await viewedAt(doc);
    expect(first).not.toBeNull();
    const again = await usePdf(token);
    expect(again.status).toBe(200);
    await again.arrayBuffer();
    expect(await viewedAt(doc)).toBe(first);
    const other = await frozenDoc(f.a.id, "tax_invoice", { pdfKey: key });
    expect((await usePdf(`${token}x`)).status).toBe(404);
    expect(await viewedAt(other)).toBeNull();
  });
  it("review L1: a tax invoice voided after the link was checked is the 404, read again in the batch of the view; R2 not read, no view, not counted", async () => {
    const f = await fixtures();
    const key = `docs/tax_invoice/2026-27/${9000 + ++seq}-v1.pdf`;
    await env.DOCS.put(key, "%PDF-1.4 raced");
    const doc = await frozenDoc(f.a.id, "tax_invoice", { pdfKey: key });
    const token = await link(f.a.finance, doc);
    const ip = "192.0.2.84";
    const voidIt = () =>
      env.DB.prepare(
        "UPDATE documents SET status = 'void', voided_at = ?1, void_reason = 'test' WHERE id = ?2",
      )
        .bind(Date.now(), doc)
        .run();
    const get = vi.spyOn(env.DOCS, "get");
    try {
      const res = await call(
        "/t/document/pdf",
        { body: { token }, ip, headers: { "cf-ray": "ray-doc-l1" } },
        withDb(beforeBatch(env.DB, 2, voidIt)),
      );
      expect(res.status).toBe(404);
      expect(await bodyOf(res)).toEqual(NOT_FOUND);
      expect(get).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
    }
    expect(
      (await one<{ v: number | null }>("SELECT viewed_at AS v FROM documents WHERE id = ?", doc))?.v ?? null,
    ).toBeNull();
    expect(await rows("SELECT status FROM access_log WHERE request_id = 'ray-doc-l1'")).toEqual([
      { status: 404 },
    ]);
    expect(await attemptsRow(await portalFailKey(env.PORTAL_KEY_PEPPER, ip))).toBeNull();
  });
  it("a bad link is the same 404 and counts", async () => {
    const ip = "192.0.2.83";
    const res = await call("/t/document/pdf", { body: { token: "z".repeat(43) }, ip });
    expect(res.status).toBe(404);
    expect((await attemptsRow(await portalFailKey(env.PORTAL_KEY_PEPPER, ip)))?.failures).toBe(1);
  });
});

describe("failed checks count per address; a blocked address writes nothing [POR-06]", () => {
  it("20 failures block the address: even a valid link is a 429 in ONE call and nothing is written", async () => {
    const f = await fixtures();
    const ip = "192.0.2.91";
    for (let i = 0; i < PORTAL_FAIL_LIMIT; i++) expect((await use(`wrong-${i}`, { ip })).status).toBe(404);
    const before = {
      ...(await writes()),
      counters: JSON.stringify(await rows("SELECT * FROM auth_attempts ORDER BY key")),
    };
    const { res, calls } = await counting("/t/document", { body: { token: f.tokens.aIssued }, ip });
    expect(res.status).toBe(429);
    expect(calls).toBe(1);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect({
      ...(await writes()),
      counters: JSON.stringify(await rows("SELECT * FROM auth_attempts ORDER BY key")),
    }).toEqual(before);
    expect((await use(f.tokens.aIssued, { ip: "192.0.2.92" })).status).toBe(200); // another address is fine
  });

  it("failed sign-in links and failed document links share the address's counter", async () => {
    const ip = "192.0.2.93";
    for (let i = 0; i < 10; i++) await call("/auth/magic/verify", { body: { token: `m-${i}` }, ip });
    for (let i = 0; i < 10; i++) await use(`d-${i}`, { ip });
    expect((await attemptsRow(await portalFailKey(env.PORTAL_KEY_PEPPER, ip)))?.failures).toBe(20);
    expect((await use("one-more", { ip })).status).toBe(429);
  });
});
