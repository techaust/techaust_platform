// POST /api/v1/t/document: a single-document link [POR-06, NFR-9]. The token is in the body only, resolves exactly one
// document, and the answer is that document's header and nothing else.
import { env } from "cloudflare:workers";
import { docTokenStmt, newDocToken, PORTAL_FAIL_LIMIT, portalFailKey, tokenHash } from "@techaust/auth";
import { schema } from "@techaust/db";
import { describe, expect, it } from "vitest";
import { DOC_READ, OPEN_STATUSES, VIEW_PAY_TYPES } from "./doc-token.ts";
import { fixtures } from "./fixtures.ts";
import { ROUTES } from "./guard.ts";
import { attemptsRow, bodyOf, call, counting, countOf, rows, writes } from "./test-helpers.ts";

const NOT_FOUND = { error: { code: "not_found", message: "Not found" } };
const use = (token: string, init: { ip?: string | null; headers?: Record<string, string> } = {}) =>
  call("/t/document", { body: { token }, ...init });

describe("a valid link opens exactly one document [POR-06]", () => {
  it("200 with only the document header (id, type, number_display, status); 2 D1 calls", async () => {
    const f = await fixtures();
    const { res, calls } = await counting("/t/document", { body: { token: f.tokens.aIssued } });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    const body = (await bodyOf(res)) as { document: Record<string, unknown> };
    expect(Object.keys(body)).toEqual(["document"]);
    expect(Object.keys(body.document).sort()).toEqual(["id", "number_display", "status", "type"]);
    expect(body.document).toMatchObject({ id: f.a.docs.issued, type: "tax_invoice", status: "issued" });
    expect(String(body.document.number_display)).toMatch(/^TH\/INV\/2627\/\d{4}$/);
    // nothing else of the document, or of its client, leaks
    const text = JSON.stringify(body);
    for (const secret of [f.a.id, f.a.name, "total_minor", "balance", "recipient"])
      expect(text).not.toContain(secret);
  });

  it("each organisation's link opens its own document and no other", async () => {
    const f = await fixtures();
    const a = (await (await use(f.tokens.aIssued)).json()) as { document: { id: string } };
    const b = (await (await use(f.tokens.bIssued)).json()) as { document: { id: string } };
    expect(a.document.id).toBe(f.a.docs.issued);
    expect(b.document.id).toBe(f.b.docs.issued);
  });

  it("a proforma opens too (the allowed types are proforma, tax_invoice and export_invoice)", async () => {
    const f = await fixtures();
    expect(VIEW_PAY_TYPES).toEqual(["proforma", "tax_invoice", "export_invoice"]);
    const res = await use(f.tokens.aProforma);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { document: { type: string } }).document.type).toBe("proforma");
  });

  it("is declared public, a POST, with no token in the path or query of any route", () => {
    const row = ROUTES.find((r) => r.path === "/api/v1/t/document");
    expect(row).toMatchObject({ method: "POST", access: "public" });
    for (const r of ROUTES) {
      expect(r.path, r.path).not.toMatch(/:|\?|token/i);
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

describe("tokens are random and stored hashed [POR-06]", () => {
  it("newDocToken: 32 random bytes; docTokenStmt stores SHA-256 and resolves exactly one document", async () => {
    const f = await fixtures();
    const t = newDocToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const { token, stmt } = await docTokenStmt(env.DB, {
      documentId: f.a.docs.proforma,
      purpose: "view_pay",
      expiresAt: Date.now() + 60_000,
    });
    await stmt.run();
    const stored = await rows<{ token_hash: string; document_id: string }>(
      "SELECT token_hash, document_id FROM doc_access_tokens WHERE token_hash = ?",
      await tokenHash(token),
    );
    expect(stored).toEqual([{ token_hash: await tokenHash(token), document_id: f.a.docs.proforma }]);
    expect(JSON.stringify(await rows("SELECT * FROM doc_access_tokens"))).not.toContain(token);
    const res = await use(token);
    expect(((await res.json()) as { document: { id: string } }).document.id).toBe(f.a.docs.proforma);
  });

  it("the database can hold only the view_pay purpose (the query asks for it too)", async () => {
    const f = await fixtures();
    await expect(
      env.DB.prepare(
        "INSERT INTO doc_access_tokens (token_hash, document_id, purpose, expires_at) VALUES ('h-other', ?1, 'pay_only', 9999999999999)",
      )
        .bind(f.a.docs.issued)
        .run(),
    ).rejects.toThrow(/doc_access_tokens_purpose|CHECK/);
    expect(DOC_READ).toContain("t.purpose = 'view_pay'");
  });
});

describe("everything else is the same 404 [POR-06]", () => {
  it("revoked, expired, draft, pending approval, void, wrong type, unknown and malformed: identical status and body, 2 calls", async () => {
    const f = await fixtures();
    const cases: [string, string][] = [
      ["revoked", f.tokens.aIssuedRevoked],
      ["expired", f.tokens.aIssuedExpired],
      ["draft", f.tokens.aDraft],
      ["pending approval", f.tokens.aPending],
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
    const CLOSED = ["draft", "pending_approval", "void"];
    expect([...OPEN_STATUSES, ...CLOSED].sort()).toEqual([...schema.DOCUMENT_STATUSES].sort());
    expect(DOC_READ).toContain("d.status IN (");
    expect(DOC_READ).not.toContain("NOT IN");
    for (const status of schema.DOCUMENT_STATUSES) {
      const did = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO documents (id, type, status, client_id, currency) VALUES (?1, 'proforma', ?2, ?3, 'INR')",
      )
        .bind(did, status, f.a.id)
        .run();
      const { token, stmt } = await docTokenStmt(env.DB, {
        documentId: did,
        purpose: "view_pay",
        expiresAt: Date.now() + 60_000,
      });
      await stmt.run();
      expect((await use(token)).status, status).toBe(CLOSED.includes(status) ? 404 : 200);
    }
  });

  it("a voided document stops opening even if it was open when the link was made", async () => {
    const f = await fixtures();
    const { token, stmt } = await docTokenStmt(env.DB, {
      documentId: f.b.docs.proforma,
      purpose: "view_pay",
      expiresAt: Date.now() + 60_000,
    });
    await stmt.run();
    expect((await use(token)).status).toBe(200);
    await env.DB.prepare(
      "UPDATE documents SET status = 'void', voided_at = ?1, void_reason = 'test' WHERE id = ?2",
    )
      .bind(Date.now(), f.b.docs.proforma)
      .run();
    expect((await use(token)).status).toBe(404);
  });
});

describe("audit and access rows [NFR-9, Q1 = A]", () => {
  it("every valid use writes exactly one doc_token.use row (actor type contact, actor NULL, the document) and one access row", async () => {
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
        actor_id: null,
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
    ).toEqual([{ realm: "portal", actor_id: null, route: "/api/v1/t/document", status: 200 }]);
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
