// The portal's start-up dry run of its hot routes (M7.5 L39, warm-routes.ts; the admin's CPU warm-up (b)1 pattern): the made-up calls go through a warm
// instance of the portal's own app on a made-up env. Run here under workerd's global-scope rules (a Response or Request with a body, random values, timers and
// fetch refused, `Date.now()` reading 0; the admin's warm-routes.test.ts emulates the same set), the count of calls that answered is pinned, so a fixture or
// route change that stops a call early shows up. The dry run never throws, writes nothing anywhere, logs nothing, counts no request and sets no first-run mark.
import { firstRun, tokenHash } from "@techaust/auth";
import { sqlKey, type WarmCall, type WarmFixture, type WarmStatementSeen } from "@techaust/db/warm";
import { Hono } from "hono/tiny";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtures } from "./fixtures.ts";
import { createApp } from "./index.ts";
import { linkFor, one, verify } from "./test-helpers.ts";
import { PORTAL_WARM } from "./warm-fixtures/portal.ts";
import { WARM_COOKIE, warmAtStartup, warmEnv, warmRoutes } from "./warm-routes.ts";

const REFUSED = "Disallowed operation called within global scope (test)";
/** How many refused operations were asked for (each one costs workerd about 12 ms of start-up: the dry run asks for none). */
let refusals = 0;
const refuse = () => {
  refusals++;
  throw new Error(REFUSED);
};

/** Runs `fn` under workerd's global-scope rules (as apps/admin/worker/warm-routes.test.ts and scripts/cpu-probe-runtime.mjs `underGlobalScopeRules`). */
async function atGlobalScope<T>(fn: () => Promise<T>, clock = 0): Promise<T> {
  const RealResponse = globalThis.Response;
  const RealRequest = globalThis.Request;
  const saved = { setTimeout: globalThis.setTimeout, fetch: globalThis.fetch };
  // Workerd's clock reads 0 at start-up: `Date.now()` AND `new Date()`. `clock`: another reading (the dry run must not depend on that 0).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
  globalThis.Response = class extends RealResponse {
    constructor(body?: BodyInit | null, init?: ResponseInit) {
      if (body !== null && body !== undefined) refuse();
      super(body, init);
    }
    static override json(): Response {
      return refuse();
    }
  } as typeof Response;
  globalThis.Request = class extends RealRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      if (init?.body !== null && init?.body !== undefined) refuse();
      super(input, init);
    }
  } as typeof Request;
  globalThis.setTimeout = refuse as unknown as typeof setTimeout;
  globalThis.fetch = refuse as unknown as typeof fetch;
  const grv = vi.spyOn(crypto, "getRandomValues").mockImplementation(refuse);
  const uuid = vi.spyOn(crypto, "randomUUID").mockImplementation(refuse);
  try {
    return await fn();
  } finally {
    globalThis.Response = RealResponse;
    globalThis.Request = RealRequest;
    globalThis.setTimeout = saved.setTimeout;
    globalThis.fetch = saved.fetch;
    grv.mockRestore();
    uuid.mockRestore();
    vi.useRealTimers();
  }
}

const warmApp = () => createApp({}, { warm: true });
const callName = (call: WarmCall) => `${call.method} ${call.path}`;

/** The dry run under the global-scope rules: its count, each call's status, the refused operations asked for, and every statement each call put to the D1. */
async function dryRun(fixture: WarmFixture = PORTAL_WARM, clock = 0) {
  const statuses: string[] = [];
  const statements: Record<string, WarmStatementSeen[]> = {};
  let current: WarmStatementSeen[] = [];
  const before = refusals;
  const env = warmEnv(fixture.rows, (seen) => current.push(seen));
  const count = await atGlobalScope(
    () =>
      warmRoutes(warmApp(), env, fixture.calls, (call, status) => {
        statuses.push(`${callName(call)} ${status}`);
        statements[callName(call)] = current;
        current = [];
      }),
    clock,
  );
  return { count, statuses, refused: refusals - before, statements };
}

afterEach(() => vi.restoreAllMocks());

describe("the portal's start-up dry run [M7.5 L39]", () => {
  it("the hot routes answer on the made-up rows, asking for no refused operation", async () => {
    const r = await dryRun();
    expect(r.statuses).toMatchInlineSnapshot(`
      [
        "GET /health 200",
        "POST /auth/magic/verify 200",
        "GET /me 200",
        "GET /home 200",
        "GET /invoices 200",
      ]
    `);
    expect(r.count).toBe(5);
    expect(r.refused).toBe(0);
  });

  it("the link use runs its whole batch (the address block, the use, the session, the audit and access rows) on the made-up D1", async () => {
    const r = await dryRun();
    const sql = (r.statements["POST /auth/magic/verify"] ?? []).map((s) => s.sql);
    expect(sql.some((s) => /^UPDATE magic_link_tokens\b/.test(s))).toBe(true);
    expect(sql.some((s) => /^INSERT INTO client_sessions\b/.test(s))).toBe(true);
    expect(sql.some((s) => /^INSERT INTO audit_log\b/.test(s))).toBe(true);
    expect(sql.some((s) => /^INSERT INTO access_log\b/.test(s))).toBe(true);
    // A signed-in call writes no access row in the dry run (the after-the-answer write is skipped), so none reaches even the made-up D1.
    for (const call of ["GET /me", "GET /home", "GET /invoices"])
      expect((r.statements[call] ?? []).filter((s) => /access_log/.test(s.sql))).toEqual([]);
  });

  it("leaves no trace: no log line, no first-run mark, no request counted", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    await dryRun();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    // Keys of hot routes: still a first run after the dry run went through them (the warm app never calls `firstRun`).
    expect(firstRun("GET /api/v1/home")).toBe(1);
    expect(firstRun("GET /api/v1/invoices")).toBe(1);
  });

  it("answers the same whatever the clock reads (the fixture's expiries are far in the future)", async () => {
    const farFuture = Date.UTC(2100, 0, 1);
    const late = await dryRun(PORTAL_WARM, farFuture - 86_400_000);
    expect(late.count).toBe(5);
    expect(late.refused).toBe(0);
  });

  it("the answer book holds every read of every call, and the session read, Home's projects and the invoices list answer rows", async () => {
    const r = await dryRun();
    const misses = Object.entries(r.statements).flatMap(([call, list]) =>
      list.filter((s) => s.read && !s.hit).map((s) => `${call}: ${s.sql.slice(0, 80)}`),
    );
    expect(misses).toEqual([]);
    const rowsOf = (call: string, table: RegExp) =>
      Math.max(
        0,
        ...(r.statements[call] ?? []).filter((s) => s.read && table.test(s.sql)).map((s) => s.rows),
      );
    expect(rowsOf("GET /me", /\bFROM client_sessions\b/)).toBe(1);
    expect(rowsOf("GET /home", /\bFROM projects\b/)).toBeGreaterThanOrEqual(1);
    expect(rowsOf("GET /invoices", /\bFROM documents\b/)).toBeGreaterThanOrEqual(1);
  });

  it("never throws or rejects: a warm app that fails to build, a fixture that throws, a D1 that fails", async () => {
    const thrown = () => {
      throw new Error("the warm app could not be built");
    };
    expect(() => warmAtStartup(thrown, PORTAL_WARM)).not.toThrow();
    await expect(warmAtStartup(thrown, PORTAL_WARM)).resolves.toBe(0);
    const poisoned = {
      get calls(): never {
        throw new Error("a broken fixture");
      },
      rows: {},
    } as unknown as WarmFixture;
    await expect(warmAtStartup(warmApp, poisoned)).resolves.toBe(0);
    const broken = warmEnv({});
    Object.defineProperty(broken, "DB", { value: null });
    await expect(warmRoutes(warmApp(), broken, PORTAL_WARM.calls)).resolves.toBeTypeOf("number");
  });

  it("swallows the rejection of work a warm call hands to waitUntil", async () => {
    const app = new Hono().basePath("/api");
    app.get("/v1/x", (c) => {
      c.executionCtx.waitUntil(Promise.reject(new Error("a background write failed")));
      return c.body(null, 204);
    });
    const count = await warmRoutes(app as unknown as ReturnType<typeof createApp>, warmEnv({}), [
      { method: "GET", path: "/x" },
    ]);
    expect(count).toBe(1);
  });

  it("the made-up env holds no Rate Limiting binding and a pepper of words; the cookie is a made-up one", () => {
    const e = warmEnv({}) as unknown as Record<string, unknown>;
    expect(["RL_SESSION", "RL_SIGNIN", "RL_LINKS"].filter((k) => k in e)).toEqual([]);
    expect(atob(e.PORTAL_KEY_PEPPER as string)).toBe("warm-up-portal-pepper00000000000");
    expect(e.ENVIRONMENT).toBe("warm");
    expect(WARM_COOKIE).toBe("__Host-ta_portal=warm-up-session-not-a-real-one");
  });

  it("the entry runs it at module level, after the router warm-up", () => {
    const files = import.meta.glob("./index.ts", { query: "?raw", import: "default", eager: true });
    expect(files["./index.ts"]).toMatch(
      /^void warmAtStartup\(\(\) => createApp\(\{\}, \{ warm: true \}\), PORTAL_WARM\);$/m,
    );
  });
});

describe("a real link use never takes the dry run's made-up values [M7.5 L39]", () => {
  it("the real app's session token is random, and its audit and access rows have UUIDv7 ids of their own", async () => {
    const f = await fixtures();
    const { res, cookie } = await verify(await linkFor(f.a.finance.id));
    expect(res.status).toBe(200);
    const raw = (cookie as string).split("=")[1] as string;
    expect(raw).not.toBe("warm-up-session-not-a-real-one");
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const id = await tokenHash(raw);
    const audit = await one<{ id: string }>(
      "SELECT id FROM audit_log WHERE action = 'portal.login' AND entity_id = ?",
      id,
    );
    expect(audit?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(audit?.id).not.toMatch(/^00000000-0000-7000-8000-/);
    const warmIds = await one<{ n: number }>(
      "SELECT (SELECT COUNT(*) FROM audit_log WHERE id LIKE '00000000-0000-7000-8000-%') + (SELECT COUNT(*) FROM access_log WHERE id LIKE '00000000-0000-7000-8000-%') AS n",
    );
    expect(warmIds?.n).toBe(0);
  });

  it("the made-up D1 keys a statement as the fixture writer does", () => {
    expect(sqlKey("")).toBe("811c9dc5");
  });
});
