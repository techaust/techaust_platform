// Shared helpers of the portal API tests (workerd, a fresh D1 per test file with every migration applied).
import { env } from "cloudflare:workers";
import { newToken, PORTAL_ABS_MS, PORTAL_COOKIE, PORTAL_IDLE_MS, tokenHash } from "@techaust/auth";
import { uuidv7 } from "@techaust/core";
import { expect, it, vi } from "vitest";
import type { RouteDef } from "./context.ts";
import type { Fixtures, FxContact } from "./fixtures.ts";
import app, { createApp } from "./index.ts";
import type { MagicLink, MagicLinkSender } from "./sender.ts";

export const ORIGIN = "https://portal.example";

// ---- D1 wrappers ---------------------------------------------------------------------------------------------

type Around = <T>(run: () => Promise<T>) => Promise<T>;
export type Seen = { sql: string; params: unknown[] };
type Record_ = (s: Seen) => void;

class Stmt {
  constructor(
    readonly real: D1PreparedStatement,
    private readonly around: Around,
    readonly sql: string,
    readonly params: unknown[],
    private readonly record: Record_,
  ) {}
  bind(...v: unknown[]) {
    return new Stmt(this.real.bind(...v), this.around, this.sql, v, this.record);
  }
  private seen() {
    this.record({ sql: this.sql, params: this.params });
  }
  first(...a: unknown[]) {
    this.seen();
    return this.around(() => (this.real.first as (...x: unknown[]) => Promise<unknown>)(...a));
  }
  run() {
    this.seen();
    return this.around(() => this.real.run());
  }
  all() {
    this.seen();
    return this.around(() => this.real.all());
  }
  raw(...a: unknown[]) {
    this.seen();
    return this.around(() => (this.real.raw as (...x: unknown[]) => Promise<unknown>)(...a));
  }
  /** Used by the batch wrapper. */
  see() {
    this.seen();
    return this.real;
  }
}

/** A D1 whose first/run/all/raw/batch calls go through `around` (a batch is ONE call, as on D1). */
function wrap(db: D1Database, around: Around, record: Record_ = () => {}): D1Database {
  return {
    prepare: (q: string) => new Stmt(db.prepare(q), around, q, [], record),
    batch: (stmts: Stmt[]) =>
      around(() =>
        db.batch(
          stmts.map((s) => {
            return s.see();
          }),
        ),
      ),
  } as unknown as D1Database;
}

/** `env` with another DB. */
export const withDb = (db: D1Database): Env =>
  new Proxy(env, { get: (t, k) => (k === "DB" ? db : Reflect.get(t, k)) }) as Env;

export type Counted = { env: Env; db: D1Database; calls: () => number; seen: Seen[] };

/** `env` whose DB counts calls (a batch counts once, as it does on D1) and records every statement it runs. */
export function counted(base: D1Database = env.DB): Counted {
  let n = 0;
  const seen: Seen[] = [];
  const db = wrap(
    base,
    (run) => {
      n++;
      return run();
    },
    (s) => seen.push(s),
  );
  return { env: withDb(db), db, calls: () => n, seen };
}

/**
 * Holds the RESULT of each of the first `n` calls until the n-th call has been issued, so `n` parallel requests
 * all see the database as it was before any of them wrote (the calls themselves still run in issue order).
 * Later calls are not held.
 */
export function barrierDb(base: D1Database, n: number): D1Database {
  let issued = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return wrap(base, (run) => {
    const mine = issued++;
    if (issued === n) release();
    const p = run();
    if (mine >= n) return p;
    return p.then(
      async (r) => {
        await gate;
        return r;
      },
      async (e) => {
        await gate;
        throw e;
      },
    );
  });
}

// ---- requests ------------------------------------------------------------------------------------------------

let ipSeq = 0;
/** A fresh documentation-range address per request, so the per-address quotas of one test never leak into the next. */
export const nextIp = () => `198.51.${Math.floor(ipSeq / 250) % 250}.${(ipSeq++ % 250) + 1}`;

export type CallInit = {
  body?: unknown;
  cookie?: string | undefined;
  method?: string;
  headers?: Record<string, string>;
  /** The caller's address; default a fresh one. `null`: send no address header. */
  ip?: string | null;
  /** Skip the JSON content type and Origin (for CSRF tests): give your own headers. */
  raw?: boolean;
};

type Handler = { request: (url: string, init: RequestInit, env: Env) => Response | Promise<Response> };

export const callerFor =
  (target: Handler) =>
  async (path: string, init: CallInit = {}, e: Env = env) => {
    const ip = init.ip === undefined ? nextIp() : init.ip;
    return target.request(
      `${ORIGIN}/api/v1${path}`,
      {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: {
          ...(init.raw
            ? {}
            : {
                ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
                Origin: ORIGIN,
              }),
          ...(ip ? { "CF-Connecting-IP": ip } : {}),
          ...(init.cookie ? { Cookie: init.cookie } : {}),
          ...init.headers,
        },
        body: init.body === undefined ? null : JSON.stringify(init.body),
      },
      e,
    );
  };

/** One request on the default app, as the SPA would send it (same origin, JSON). */
export const call = callerFor(app);

/** A capturing sender: what the Worker would have emailed. */
export function capture() {
  const sent: MagicLink[] = [];
  const sender: MagicLinkSender = {
    async send(links) {
      sent.push(...links);
    },
  };
  return { sender, sent, app: createApp({ sender }) };
}

/** The raw token inside a link (`…/auth/callback#t=<token>`). */
export const tokenOfLink = (url: string) => new URL(url).hash.replace(/^#t=/, "");

/** One request on a counting DB: the response, how many D1 calls it made and the statements it ran. */
export async function counting(path: string, init: CallInit = {}, target: Handler = app) {
  const c = counted();
  const res = await callerFor(target)(path, init, c.env);
  return { res, calls: c.calls(), seen: c.seen };
}

export const cookieOf = (res: Response, name = PORTAL_COOKIE) =>
  res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))
    ?.split(";")[0] ?? null;

/** The Set-Cookie line (all attributes) of the portal cookie. */
export const setCookieLine = (res: Response, name = PORTAL_COOKIE) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? null;

/** The response body without `request_id` (it differs per request by design). */
export async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  const text = await res.clone().text();
  if (!text) return {}; // a 204 has no body
  const { request_id: _ignored, ...rest } = JSON.parse(text) as Record<string, unknown>;
  return rest;
}

// ---- D1 reads ------------------------------------------------------------------------------------------------

export const one = <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...params)
    .first<T>();

export const rows = async <T = Record<string, unknown>>(sql: string, ...params: unknown[]) =>
  (
    await env.DB.prepare(sql)
      .bind(...params)
      .all<T>()
  ).results;

export const countOf = async (table: string, where = "1 = 1", ...params: unknown[]) =>
  (
    (await one<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, ...params)) as {
      n: number;
    }
  ).n;

export const attemptsRow = (key: string) =>
  one<{ failures: number; locked_until: number | null; window_start: number }>(
    "SELECT window_start, failures, locked_until FROM auth_attempts WHERE key = ?",
    key,
  );

/** Row counts of the tables a refused request must not touch. */
export const writes = async () => ({
  tokens: await countOf("magic_link_tokens"),
  sessions: await countOf("client_sessions"),
  audit: await countOf("audit_log"),
  access: await countOf("access_log"),
});

/** A new contact of an organisation, so a test that changes a contact never touches the shared fixtures. */
export async function extraContact(
  clientId: string,
  o: { portal?: boolean; finance?: boolean; email?: string; anonymised?: boolean } = {},
): Promise<FxContact> {
  const id = uuidv7();
  const email = o.email ?? `extra-${id.slice(-12)}@example.test`;
  await env.DB.prepare(
    "INSERT INTO contacts (id, client_id, name, email, portal_access, can_see_finance, anonymised_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  )
    .bind(
      id,
      clientId,
      `Extra ${id.slice(-6)}`,
      email,
      o.portal === false ? 0 : 1,
      o.finance ? 1 : 0,
      o.anonymised ? Date.now() : null,
    )
    .run();
  return { id, clientId, email, name: `Extra ${id.slice(-6)}`, finance: !!o.finance };
}

// ---- sessions and links, straight in the database --------------------------------------------------------------

/** A live portal session written straight to the database (no link): for tests of what a signed-in contact can do. */
export async function sessionFor(
  contact: FxContact,
  opts: { lastSeen?: number; idleExpires?: number; absExpires?: number; revoked?: number | null } = {},
) {
  const token = newToken();
  const id = await tokenHash(token);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO client_sessions (id, contact_id, client_id, last_seen_at, idle_expires_at, abs_expires_at, revoked_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  )
    .bind(
      id,
      contact.id,
      contact.clientId,
      opts.lastSeen ?? now,
      opts.idleExpires ?? now + PORTAL_IDLE_MS,
      opts.absExpires ?? now + PORTAL_ABS_MS,
      opts.revoked ?? null,
    )
    .run();
  return { cookie: `${PORTAL_COOKIE}=${token}`, token, sessionId: id, contact };
}
export type TestSession = Awaited<ReturnType<typeof sessionFor>>;

/** A magic link straight in the database (the lead's `portal:link` script does the same). */
export async function linkFor(contactId: string, o: { expiresIn?: number; usedAt?: number } = {}) {
  const token = newToken();
  await env.DB.prepare(
    "INSERT INTO magic_link_tokens (token_hash, contact_id, expires_at, used_at) VALUES (?1, ?2, ?3, ?4)",
  )
    .bind(await tokenHash(token), contactId, Date.now() + (o.expiresIn ?? 15 * 60_000), o.usedAt ?? null)
    .run();
  return token;
}

/** Use a link through the API; the cookie of the session it made (null when it didn't). */
export async function verify(token: string, init: CallInit = {}) {
  const res = await call("/auth/magic/verify", { body: { token }, ...init });
  return { res, cookie: cookieOf(res) };
}

// ---- the console ---------------------------------------------------------------------------------------------

export type Spy = { lines: string[]; stop: () => void };

/** Collects everything written through console.log/info/warn/error/debug. */
export function spyConsole(): Spy {
  const lines: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
    }),
  );
  return {
    lines,
    stop: () => {
      for (const s of spies) s.mockRestore();
    },
  };
}

// ---- the SQL spy --------------------------------------------------------------------------------------------------

/** Tables that have a `client_id` column, from the live schema (so a new table is covered without editing the test). */
export async function tablesWithClientId() {
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

// ---- the cross-tenant harness (reused by M4.5 and M7.1) ---------------------------------------------------------

export type TenantCase = {
  /** The route as a sentence, for the test names. */
  name: string;
  /** The request for a document id (the harness adds the cookie). */
  request: (id: string) => { path: string; init?: CallInit };
  /** A route that needs finance access. */
  finance?: boolean;
  /** Documents of organisation A in states the portal may not show (drafts, pending approval, void). */
  hidden?: (f: Fixtures) => string[];
};

/**
 * `crossTenant(...)`: defines the tests that every route returning a document (or anything with an owner) must pass:
 * organisation A's contact sees A's document, and gets the SAME 404 (status and body) for B's document, a made-up id
 * and each hidden document; a finance route is the same 404 for a contact without finance access. Call it inside a
 * `describe`, with the cases for the routes under test and the fixtures.
 */
export function crossTenant(
  target: Handler,
  cases: TenantCase[],
  fx: () => Promise<Fixtures>,
  mine: (fx: Fixtures) => string,
  theirs: (fx: Fixtures) => string,
) {
  const send = callerFor(target);
  for (const c of cases) {
    it(`${c.name}: my document is served`, async () => {
      const f = await fx();
      const s = await sessionFor(f.a.finance);
      const { path, init } = c.request(mine(f));
      expect((await send(path, { ...init, cookie: s.cookie })).status).toBe(200);
    });
    it(`${c.name}: another organisation's document, a made-up id and a hidden document are one and the same 404`, async () => {
      const f = await fx();
      const s = await sessionFor(f.a.finance);
      const ask = async (id: string) => {
        const { path, init } = c.request(id);
        const res = await send(path, { ...init, cookie: s.cookie });
        return { status: res.status, body: await bodyOf(res) };
      };
      const missing = await ask(`no-such-${crypto.randomUUID()}`);
      expect(missing.status).toBe(404);
      expect(await ask(theirs(f))).toEqual(missing);
      for (const hidden of c.hidden?.(f) ?? []) expect(await ask(hidden)).toEqual(missing);
    });
    if (c.finance)
      it(`${c.name}: without finance access it is the same 404, even for my own document`, async () => {
        const f = await fx();
        const withFinance = await sessionFor(f.a.finance);
        const without = await sessionFor(f.a.plain);
        const missing = c.request(`no-such-${crypto.randomUUID()}`);
        const miss = await send(missing.path, { ...missing.init, cookie: withFinance.cookie });
        const { path, init } = c.request(mine(f));
        const res = await send(path, { ...init, cookie: without.cookie });
        expect(res.status).toBe(404);
        expect(await bodyOf(res)).toEqual(await bodyOf(miss));
      });
  }
}

/** Every route the table declares as a (method, path) pair, for the coverage tests. */
export const pairs = (rs: readonly RouteDef[]) => rs.map((r) => `${r.method} ${r.path}`).sort();
