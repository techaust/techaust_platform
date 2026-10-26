// Client scoping [POR-03, LD8]: the scope comes from the session alone, every statement of a signed-in request is
// bound to that organisation, another organisation's thing is the same 404 as a missing one, and the portal never
// names a staff table. The SQL spy and the cross-tenant harness are written to be reused by M4.5 and M7.1.
import { describe, expect, it } from "vitest";
import { NOT_FOUND, type RouteDef } from "./context.ts";
import { type Fixtures, fixtures } from "./fixtures.ts";
import { ROUTES, SESSION_READ } from "./guard.ts";
import { createApp, type TestRoute } from "./index.ts";
import { forClient, issueScope, notFound, requireFinance, scope } from "./scope.ts";
import {
  bodyOf,
  type CallInit,
  callerFor,
  counted,
  crossTenant,
  extraContact,
  type Seen,
  sessionFor,
  type TenantCase,
  tablesWithClientId,
  unscoped,
} from "./test-helpers.ts";

// ---- test-only routes: what M4.5 / M7.1 routes will look like -----------------------------------------------------

const row = (method: RouteDef["method"], path: string, access: RouteDef["access"]): RouteDef => ({
  method,
  path: `/api/v1${path}`,
  access,
});

const SHOWN =
  "SELECT id, type, status FROM documents WHERE client_id = ?1 AND id = ?2 AND status NOT IN ('draft', 'pending_approval', 'void')";

const testRoutes: TestRoute[] = [
  {
    def: row("GET", "/test/documents/:id", "session"),
    handler: async (c) => {
      const found = await forClient(c.env.DB, scope(c), SHOWN, c.req.param("id")).first();
      return found ? c.json(found) : notFound(c);
    },
  },
  {
    def: row("GET", "/test/finance/documents/:id", "finance"),
    handler: async (c) => {
      const s = scope(c);
      requireFinance(s);
      const found = await forClient(c.env.DB, s, SHOWN, c.req.param("id")).first();
      return found ? c.json(found) : notFound(c);
    },
  },
  {
    def: row("GET", "/test/echo", "session"),
    handler: (c) => {
      const s = scope(c);
      return c.json({ clientId: s.clientId, contactId: s.contactId, query: c.req.query() });
    },
  },
  {
    def: row("POST", "/test/echo-body", "session"),
    handler: async (c) => {
      const s = scope(c);
      return c.json({ clientId: s.clientId, contactId: s.contactId, body: await c.req.json() });
    },
  },
  {
    def: row("GET", "/test/public-scope", "public"),
    handler: (c) => c.json({ clientId: scope(c).clientId }),
  },
];
const testApp = createApp({ testRoutes });
const send = callerFor(testApp);

// ---- every guarded route is classified (a route added later FAILS here until it is) --------------------------------

type Key = `${RouteDef["method"]} ${string}`;
const keyOf = (r: RouteDef): Key => `${r.method} ${r.path}`;
/** Every route of the app under test: the product's table and this file's test-only routes. */
const ALL_ROUTES: readonly RouteDef[] = [...ROUTES, ...testRoutes.map((t) => t.def)];
const GUARDED = ALL_ROUTES.filter((r) => r.access !== "public");

/**
 * Routes that return or change rows of an organisation by an id the caller names: each runs through `crossTenant`
 * (my own thing is served; another organisation's, a missing and a hidden one are one 404; finance is a 404 without
 * finance access). M4.5 and M7.1 add their routes here.
 */
const TENANT_CASES: Record<string, TenantCase> = {
  "GET /api/v1/test/documents/:id": {
    name: "GET /test/documents/:id",
    request: (id) => ({ path: `/test/documents/${id}` }),
    hidden: (f) => [f.a.docs.draft, f.a.docs.pending, f.a.docs.void],
  },
  "GET /api/v1/test/finance/documents/:id": {
    name: "GET /test/finance/documents/:id",
    request: (id) => ({ path: `/test/finance/documents/${id}` }),
    finance: true,
  },
};

/**
 * Guarded routes that name an organisation's row by an id and are proven in offer-routes.test.ts with the same `crossTenant` harness on
 * their own fixtures (a proposal must be sent and rendered to be shown, which an invoice fixture is not). Here they only join the SQL-spy loop.
 */
const TENANT_ELSEWHERE: Record<string, { request: (id: string) => { path: string; init?: CallInit } }> = {
  "GET /api/v1/offers": { request: () => ({ path: "/offers" }) },
  "GET /api/v1/offers/:id": { request: (id) => ({ path: `/offers/${id}` }) },
  "GET /api/v1/offers/:id/pdf": { request: (id) => ({ path: `/offers/${id}/pdf` }) },
  "GET /api/v1/offers/:id/certificate": { request: (id) => ({ path: `/offers/${id}/certificate` }) },
  "POST /api/v1/offers/:id/accept": {
    request: (id) => ({
      path: `/offers/${id}/accept`,
      init: { body: { typedName: "Sample Person", agree: true } },
    }),
  },
  "POST /api/v1/offers/:id/decline": {
    request: (id) => ({ path: `/offers/${id}/decline`, init: { body: { reason: "price" } } }),
  },
};

/** Guarded routes that touch no row of an organisation by a caller-named id, with the reason and a sample request. */
const NO_CLIENT_ROWS: Record<
  string,
  { why: string; request: (f: Fixtures) => { path: string; init?: CallInit } }
> = {
  "GET /api/v1/me": { why: "answers from the guard's own read", request: () => ({ path: "/me" }) },
  "POST /api/v1/auth/sessions/revoke-all": {
    why: "revokes the session's own contact's sessions; no id from the caller",
    request: () => ({ path: "/auth/sessions/revoke-all", init: { method: "POST" } }),
  },
  "GET /api/v1/test/echo": { why: "echoes the scope", request: () => ({ path: "/test/echo" }) },
  "POST /api/v1/test/echo-body": {
    why: "echoes the scope",
    request: (f) => ({ path: "/test/echo-body", init: { body: { client_id: f.b.id } } }),
  },
};

describe("every guarded route is classified for the cross-tenant and SQL-spy tests [POR-03]", () => {
  it("each guarded route is in exactly one of TENANT_CASES and NO_CLIENT_ROWS, and neither lists a route that is gone", () => {
    const keys = GUARDED.map(keyOf);
    for (const k of keys) {
      const where = [k in TENANT_CASES, k in NO_CLIENT_ROWS, k in TENANT_ELSEWHERE].filter(Boolean).length;
      expect(
        where,
        `${k} must be in TENANT_CASES (crossTenant) or NO_CLIENT_ROWS (with a reason), not both, not neither`,
      ).toBe(1);
    }
    for (const k of [
      ...Object.keys(TENANT_CASES),
      ...Object.keys(NO_CLIENT_ROWS),
      ...Object.keys(TENANT_ELSEWHERE),
    ])
      expect(keys, `${k} is classified but is not a guarded route`).toContain(k);
  });

  it("the product table's guarded routes are the two classified as NO_CLIENT_ROWS and the offer routes", () => {
    expect(
      ROUTES.filter((r) => r.access !== "public")
        .map(keyOf)
        .sort(),
    ).toEqual(
      ["GET /api/v1/me", "POST /api/v1/auth/sessions/revoke-all", ...Object.keys(TENANT_ELSEWHERE)].sort(),
    );
  });
});

describe("every statement of a signed-in request is bound to the session's organisation [POR-03]", () => {
  it("the spy sees the schema's client_id tables (documents, contacts, client_sessions, ... and not access_log)", async () => {
    const tables = await tablesWithClientId();
    for (const t of ["documents", "contacts", "client_sessions", "projects"]) expect(tables).toContain(t);
    expect(tables).not.toContain("access_log");
    expect(tables).not.toContain("audit_log");
  });

  it("self-test: the spy flags a statement that BINDS the organisation's id but doesn't filter on it, and one that filters on another value", async () => {
    const tables = await tablesWithClientId();
    const row = (sql: string, params: unknown[]) => ({ sql, params });
    const guardRead = row(SESSION_READ, ["hash"]);
    const good = [
      row("SELECT * FROM documents WHERE client_id = ?1 AND id = ?2", ["A", "x"]),
      row("SELECT * FROM documents WHERE id = ?1 AND client_id = ?2", ["x", "A"]),
      row("SELECT * FROM documents d WHERE d.client_id = ?3", ["x", "y", "A"]),
      row("INSERT INTO access_log (id) VALUES (?1)", ["A"]), // no client table: out of scope
    ];
    const bad = [
      row("SELECT * FROM documents WHERE id = ?1", ["x"]), // no filter at all
      row("SELECT * FROM documents WHERE id = ?1", ["A"]), // binds A's id, but as the document id
      row("SELECT * FROM documents WHERE client_id = ?1", ["B"]), // filters on another organisation
      row("SELECT * FROM documents WHERE client_id = ?2 AND id = ?1", ["A", "x"]), // ?2 is not A's id
      row("SELECT * FROM documents WHERE client_id != ?1", ["A"]),
      row("SELECT * FROM documents WHERE other_client_id = ?1", ["A"]),
      row("UPDATE client_sessions SET revoked_at = ?2 WHERE contact_id = ?1", ["A", 1]),
    ];
    expect(unscoped([...good, ...bad, guardRead], "A", tables, [SESSION_READ])).toEqual(bad);
  });

  it("the touch statement filters on the client too", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain, { lastSeen: Date.now() - 30 * 60_000 });
    const c = counted();
    await send("/me", { cookie: s.cookie }, c.env);
    const touch = c.seen.find((x) => x.sql.startsWith("UPDATE client_sessions SET last_seen_at"));
    expect(touch).toBeDefined();
    expect(unscoped([touch as Seen], f.a.id, await tablesWithClientId(), [])).toEqual([]);
  });

  for (const route of GUARDED) {
    const key = keyOf(route);
    it(`${key}: as organisation A, every statement that touches a client table filters on A's id (but the guard read)`, async () => {
      const f = await fixtures();
      const tables = await tablesWithClientId();
      const tenant = TENANT_CASES[key];
      const plain = NO_CLIENT_ROWS[key];
      const elsewhere = TENANT_ELSEWHERE[key];
      const asked = tenant
        ? tenant.request(f.a.docs.issued)
        : elsewhere
          ? elsewhere.request(f.a.docs.proposal)
          : plain?.request(f);
      expect(
        asked,
        `${key} has no sample request: classify it in TENANT_CASES or NO_CLIENT_ROWS`,
      ).toBeDefined();
      const { path, init } = asked as { path: string; init?: CallInit };
      // a session whose 15-minute touch is due too, so the touch statement is in play on every route
      const who = key.includes("revoke-all") ? await extraContact(f.a.id) : f.a.finance;
      const s = await sessionFor(who, { lastSeen: Date.now() - 20 * 60_000 });
      const c = counted();
      const res = await send(path, { ...init, cookie: s.cookie }, c.env);
      expect([200, 404], key).toContain(res.status);
      expect(unscoped(c.seen, f.a.id, tables, [SESSION_READ]), key).toEqual([]);
      expect(
        c.seen.filter((x) => x.sql === SESSION_READ),
        key,
      ).toHaveLength(1);
      expect(c.seen.length, `${key} ran no statements: the spy would pass vacuously`).toBeGreaterThan(1);
      // the same request for the other organisation's document, where the route takes one: still every statement scoped to A
      if (tenant) {
        const other = counted();
        const o = tenant.request(f.b.docs.issued);
        const r2 = await send(o.path, { ...o.init, cookie: s.cookie }, other.env);
        expect(r2.status).toBe(404);
        expect(unscoped(other.seen, f.a.id, tables, [SESSION_READ]), `${key} (B's id)`).toEqual([]);
      }
    });
  }
});

describe("the scope comes from the session only [POR-03]", () => {
  it("a client_id or contact_id in the query, the body or the headers is ignored", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    const q = await send(`/test/echo?client_id=${f.b.id}&contact_id=${f.b.finance.id}&clientId=${f.b.id}`, {
      cookie: s.cookie,
      headers: {
        "X-Client-Id": f.b.id,
        "X-Contact-Id": f.b.finance.id,
        "Client-Id": f.b.id,
        "X-Forwarded-Client": f.b.id,
      },
    });
    expect(await bodyOf(q)).toMatchObject({ clientId: f.a.id, contactId: f.a.plain.id });
    const b = await send("/test/echo-body", {
      cookie: s.cookie,
      body: { client_id: f.b.id, contact_id: f.b.finance.id, clientId: f.b.id },
    });
    expect(await bodyOf(b)).toMatchObject({ clientId: f.a.id, contactId: f.a.plain.id });
  });

  it("GET /me returns only the session's contact and organisation, whatever the request asks for", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain);
    const res = await send(`/me?client_id=${f.b.id}&contact_id=${f.b.finance.id}`, {
      cookie: s.cookie,
      headers: { "X-Client-Id": f.b.id },
    });
    expect(await bodyOf(res)).toEqual({
      contact: { name: f.a.plain.name, email: f.a.plain.email },
      organisation: { displayName: f.a.name },
      canSeeFinance: false,
    });
  });

  it("scope() throws on a route that has no session (a public route may not use it) and the answer is a clean 500", async () => {
    const res = await send("/test/public-scope");
    expect(res.status).toBe(500);
    expect(await bodyOf(res)).toEqual({ error: { code: "internal", message: "Something went wrong" } });
  });

  it("a scope can't be forged: only the guard's own value is accepted", async () => {
    const f = await fixtures();
    const forged = { contactId: f.a.plain.id, clientId: f.b.id, canSeeFinance: true, sessionId: "x" };
    const fake = createApp({
      testRoutes: [
        {
          def: row("GET", "/test/forged", "public"),
          handler: (c) => {
            (c as unknown as { set: (k: string, v: unknown) => void }).set("scope", forged);
            return c.json({ clientId: scope(c).clientId });
          },
        },
      ],
    });
    expect((await callerFor(fake)("/test/forged")).status).toBe(500);
  });
});

describe("forClient [POR-03]", () => {
  const s = issueScope({
    contactId: "contact-1",
    clientId: "client-1",
    canSeeFinance: false,
    sessionId: "s",
  });

  it("binds ?1 to the scope's client and the rest after it", async () => {
    const c = counted();
    const stmt = forClient(c.db, s, "SELECT 1 FROM documents WHERE client_id = ?1 AND id = ?2", "d1");
    await stmt.first();
    expect(c.seen[0]?.params).toEqual(["client-1", "d1"]);
  });

  it("refuses SQL that doesn't say client_id = ?1: before anything reaches the database", () => {
    const c = counted();
    for (const sql of [
      "SELECT * FROM documents WHERE id = ?1",
      "SELECT * FROM documents WHERE client_id = ?2",
      "SELECT * FROM documents WHERE client_id = ?10",
      "SELECT * FROM documents WHERE client_id IN (?1)",
      "SELECT * FROM documents WHERE client_id = 'x'",
      "SELECT * FROM documents WHERE other_client_id = ?1",
      "SELECT * FROM documents",
    ])
      expect(() => forClient(c.db, s, sql), sql).toThrow(/client_id = \?1/);
    expect(c.calls()).toBe(0);
  });

  it("accepts the alias form and spacing", () => {
    const c = counted();
    expect(() => forClient(c.db, s, "SELECT * FROM documents d WHERE d.client_id = ?1")).not.toThrow();
    expect(() =>
      forClient(c.db, s, "SELECT * FROM documents WHERE client_id=?1 AND x = ?2", 1),
    ).not.toThrow();
  });

  it("requireFinance: a contact without finance gets the plain 404 from the Worker", async () => {
    const f = await fixtures();
    expect(() => requireFinance(s)).toThrow();
    const without = await sessionFor(f.a.plain);
    const res = await send(`/test/finance/documents/${f.a.docs.issued}`, { cookie: without.cookie });
    expect(res.status).toBe(404);
    expect(await bodyOf(res)).toEqual({ error: { code: NOT_FOUND.code, message: NOT_FOUND.message } });
  });

  it("notFound is the very same body as the router's own 404", async () => {
    const f = await fixtures();
    const s2 = await sessionFor(f.a.finance);
    const mine = await send(`/test/documents/${f.b.docs.issued}`, { cookie: s2.cookie });
    const unknown = await send("/nothing/here", { cookie: s2.cookie });
    expect(mine.status).toBe(404);
    expect(await bodyOf(mine)).toEqual(await bodyOf(unknown));
  });
});

describe("cross-tenant: another organisation's, a missing and a hidden thing are one 404 [POR-03]", () => {
  // Every TENANT_CASES route, through the shared harness (the coverage test above makes the list complete).
  crossTenant(
    testApp,
    Object.values(TENANT_CASES),
    fixtures,
    (f) => f.a.docs.issued,
    (f) => f.b.docs.issued,
  );

  it("the same, as the other organisation: B sees B's and gets the 404 for A's", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.b.finance);
    expect((await send(`/test/documents/${f.b.docs.issued}`, { cookie: s.cookie })).status).toBe(200);
    expect((await send(`/test/documents/${f.a.docs.issued}`, { cookie: s.cookie })).status).toBe(404);
  });
});

describe("what the portal's own sources may and may not do [POR-03, LD8]", () => {
  const files = import.meta.glob("./*.ts", { query: "?raw", import: "default", eager: true });
  const product = Object.entries(files).filter(
    ([name]) => !/\.test\.ts$|test-helpers|fixtures|test-setup|\.d\.ts$/.test(name),
  );

  it("sees the Worker's files", () => {
    const names = product.map(([n]) => n.replace("./", ""));
    for (const n of ["index.ts", "guard.ts", "scope.ts", "auth.ts", "me.ts", "doc-token.ts"])
      expect(names).toContain(n);
  });

  it("no portal SQL names a staff_ table", () => {
    for (const [name, text] of product) expect(text, name).not.toMatch(/\bstaff_[a-z]/i);
  });

  it("only guard.ts (and scope.ts itself) mention issueScope: nothing else can build a scope", () => {
    const mentions = product.filter(([, text]) => text.includes("issueScope")).map(([n]) => n);
    expect(mentions.sort()).toEqual(["./guard.ts", "./scope.ts"]);
  });

  it("no route reads a client or contact id from the request (the handlers never touch the query or body for scope)", () => {
    for (const [name, text] of product) {
      expect(text, name).not.toMatch(/req\.(query|param|header)\(\s*["'`](client|contact)[-_ ]?id/i);
    }
  });
});
