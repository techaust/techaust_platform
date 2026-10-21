// Client scoping [POR-03, LD8]: the scope comes from the session alone, every statement of a signed-in request is
// bound to that organisation, another organisation's thing is the same 404 as a missing one, and the portal never
// names a staff table. The SQL spy and the cross-tenant harness are written to be reused by M4.5 and M7.1.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { NOT_FOUND, type RouteDef } from "./context.ts";
import { fixtures } from "./fixtures.ts";
import { SESSION_READ } from "./guard.ts";
import { createApp, type TestRoute } from "./index.ts";
import { forClient, issueScope, notFound, requireFinance, scope } from "./scope.ts";
import {
  bodyOf,
  callerFor,
  counted,
  crossTenant,
  extraContact,
  type Seen,
  sessionFor,
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

// ---- the SQL spy --------------------------------------------------------------------------------------------------

/** Tables that have a `client_id` column, from the live schema (so a new table is covered without editing the test). */
async function tablesWithClientId() {
  const all = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'",
  ).all<{ name: string }>();
  const out: string[] = [];
  for (const t of all.results) {
    const cols = await env.DB.prepare("SELECT name FROM pragma_table_info(?)")
      .bind(t.name)
      .all<{ name: string }>();
    if (cols.results.some((c) => c.name === "client_id")) out.push(t.name);
  }
  return out;
}

/**
 * The statements that touch a table with a `client_id` column WITHOUT binding the organisation's id. `allow`: the exact
 * SQL texts that may (only the guard's session read, which is what discovers the organisation).
 */
export function unscoped(seen: Seen[], clientId: string, tables: string[], allow: string[]) {
  return seen.filter((s) => {
    if (allow.includes(s.sql)) return false;
    const touches = tables.some((t) => new RegExp(`\\b${t}\\b`, "i").test(s.sql));
    return touches && !s.params.includes(clientId);
  });
}

describe("every statement of a signed-in request is bound to the session's organisation [POR-03]", () => {
  it("the spy sees the schema's client_id tables (documents, contacts, client_sessions, ... and not access_log)", async () => {
    const tables = await tablesWithClientId();
    for (const t of ["documents", "contacts", "client_sessions", "projects"]) expect(tables).toContain(t);
    expect(tables).not.toContain("access_log");
    expect(tables).not.toContain("audit_log");
  });

  it("the spy catches an unscoped statement (a made-up one) and lets the guard's read through", async () => {
    const tables = await tablesWithClientId();
    const bad = { sql: "SELECT * FROM documents WHERE id = ?1", params: ["x"] };
    const ok = { sql: "SELECT * FROM documents WHERE client_id = ?1 AND id = ?2", params: ["A", "x"] };
    const guardRead = { sql: SESSION_READ, params: ["hash"] };
    expect(unscoped([bad, ok, guardRead], "A", tables, [SESSION_READ])).toEqual([bad]);
  });

  it("every session route, as organisation A: no statement touches a client table without A's id (except the guard read)", async () => {
    const f = await fixtures();
    const tables = await tablesWithClientId();
    const due = Date.now() - 20 * 60_000; // a session whose 15-minute touch is due: the touch statement is in play
    const requests: {
      name: string;
      cookie: string;
      path: string;
      init?: { method?: string; body?: unknown };
    }[] = [];
    const add = async (name: string, who = f.a.finance, o: { lastSeen?: number } = {}) => {
      const s = await sessionFor(who, o);
      return { name, cookie: s.cookie };
    };
    requests.push({ ...(await add("GET /me")), path: "/me" });
    requests.push({
      ...(await add("GET /me with a touch due", f.a.finance, { lastSeen: due })),
      path: "/me",
    });
    requests.push({ ...(await add("GET test document")), path: `/test/documents/${f.a.docs.issued}` });
    requests.push({ ...(await add("GET test document of B")), path: `/test/documents/${f.b.docs.issued}` });
    requests.push({
      ...(await add("GET test finance document")),
      path: `/test/finance/documents/${f.a.docs.issued}`,
    });
    requests.push({ ...(await add("GET test echo")), path: "/test/echo" });
    requests.push({
      ...(await add("POST test echo-body")),
      path: "/test/echo-body",
      init: { body: { client_id: f.b.id } },
    });
    requests.push({
      ...(await add("POST revoke-all", await extraContact(f.a.id))),
      path: "/auth/sessions/revoke-all",
      init: { method: "POST" },
    });
    let checked = 0;
    for (const r of requests) {
      const c = counted();
      const res = await send(r.path, { ...r.init, cookie: r.cookie }, c.env);
      expect([200, 404], r.name).toContain(res.status);
      expect(unscoped(c.seen, f.a.id, tables, [SESSION_READ]), r.name).toEqual([]);
      // the guard's read happened exactly once, and it is the only allow-listed statement
      expect(
        c.seen.filter((s) => s.sql === SESSION_READ),
        r.name,
      ).toHaveLength(1);
      checked += c.seen.length;
    }
    expect(checked).toBeGreaterThan(requests.length * 2); // not a vacuous pass
  });

  it("the touch statement binds the client too", async () => {
    const f = await fixtures();
    const s = await sessionFor(f.a.plain, { lastSeen: Date.now() - 30 * 60_000 });
    const c = counted();
    await send("/me", { cookie: s.cookie }, c.env);
    const touch = c.seen.find((x) => x.sql.startsWith("UPDATE client_sessions SET last_seen_at"));
    expect(touch?.params).toContain(f.a.id);
  });
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
  crossTenant(
    testApp,
    [
      {
        name: "GET a document",
        request: (id) => ({ path: `/test/documents/${id}` }),
        hidden: (f) => [f.a.docs.draft, f.a.docs.pending, f.a.docs.void],
      },
    ],
    fixtures,
    (f) => f.a.docs.issued,
    (f) => f.b.docs.issued,
  );

  crossTenant(
    testApp,
    [
      {
        name: "GET a finance document",
        request: (id) => ({ path: `/test/finance/documents/${id}` }),
        finance: true,
      },
    ],
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
