// The start-up dry run of the hot routes (CPU warm-up (b)1, warm-routes.ts): each admin Worker's made-up calls go through a warm instance of its own app on a
// made-up env. Run here under workerd's global-scope rules (a Response or Request with a body, random values, timers and fetch refused, `Date.now()` reading
// 0; checked in local workerd 1.20261001.1, 2026-11-02), the count of calls that answered is pinned per Worker, so a fixture or route change that stops a
// call early shows up. The dry run never throws, writes nothing anywhere, logs nothing, counts no request and sets no first-run mark.
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, firstRun, nextRequestNumber, requestFacts } from "./app.ts";
import { forwardRoutes } from "./forward.ts";
import { transportOf } from "./gateway/config.ts";
import { ROUTES } from "./guard.ts";
import { mountApi } from "./routes-api.ts";
import { mountFinance } from "./routes-finance.ts";
import { mountFront } from "./routes-front.ts";
import { API_WARM } from "./warm-fixtures/api.ts";
import { FINANCE_WARM } from "./warm-fixtures/finance.ts";
import { FRONT_WARM } from "./warm-fixtures/front.ts";
import { FRONT_WARM_SECRETS } from "./warm-front.ts";
import {
  sqlKey,
  type WarmCall,
  type WarmFixture,
  type WarmStatementSeen,
  warmAtStartup,
  warmDb,
  warmEnv,
  warmRoutes,
} from "./warm-routes.ts";

const REFUSED = "Disallowed operation called within global scope (test)";
/** How many refused operations were asked for (each one cost workerd about 12 ms of start-up, fix round decision 1c: the dry runs ask for none). */
let refusals = 0;
const refuse = () => {
  refusals++;
  throw new Error(REFUSED);
};

/** Runs `fn` under workerd's global-scope rules (the probe emulates the same set: scripts/cpu-probe-runtime.mjs `underGlobalScopeRules`). */
async function atGlobalScope<T>(fn: () => Promise<T>, clock = 0): Promise<T> {
  const RealResponse = globalThis.Response;
  const RealRequest = globalThis.Request;
  const saved = { setTimeout: globalThis.setTimeout, fetch: globalThis.fetch };
  // Workerd's clock reads 0 at start-up: `Date.now()` AND `new Date()` (early check finding 7), so Date is faked here (timers are refused below). `clock`:
  // another reading (review finding 2: the dry run must not depend on that 0).
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

const callName = (call: WarmCall) =>
  `${call.method} ${call.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}`;

/**
 * One Worker's dry run under the global-scope rules: its count, each call's status (0: it stopped on a refused operation), the refused operations asked
 * for, and every statement each call put to the made-up D1 (early check 2).
 */
async function dryRun(app: ReturnType<typeof createApp>, fixture: WarmFixture, extra = {}, clock = 0) {
  const statuses: string[] = [];
  const statements: Record<string, WarmStatementSeen[]> = {};
  let current: WarmStatementSeen[] = [];
  const before = refusals;
  const env = warmEnv(fixture.rows, extra, (seen) => current.push(seen));
  const count = await atGlobalScope(
    () =>
      warmRoutes(app, env, fixture.calls, (call: WarmCall, status: number) => {
        statuses.push(`${callName(call)} ${status}`);
        statements[callName(call)] = current;
        current = [];
      }),
    clock,
  );
  return { count, statuses, refused: refusals - before, statements };
}

/** The reads of a dry run that the answer book does not hold (a stale fixture: answered with no rows, the route's code then runs on nothing). */
const missesOf = (statements: Record<string, WarmStatementSeen[]>) =>
  Object.entries(statements).flatMap(([call, list]) =>
    list.filter((s) => s.read && !s.hit).map((s) => `${call}: ${s.sql.slice(0, 80)}`),
  );

/** The rows the list statement of a call answered: the read whose SQL matches `table` and answered the most rows. */
const listRows = (statements: Record<string, WarmStatementSeen[]>, call: string, table: RegExp) =>
  Math.max(0, ...(statements[call] ?? []).filter((s) => s.read && table.test(s.sql)).map((s) => s.rows));

afterEach(() => vi.restoreAllMocks());

describe("the start-up dry run [CPU warm-up (b)1]", () => {
  it("the finance Worker's hot routes answer on the made-up rows", async () => {
    // What the warm `c.json` serialises (it answers without a body): the issue call's 409 must be `content_changed`, the refusal AFTER the recompute.
    const stringify = JSON.stringify;
    const codes: string[] = [];
    vi.spyOn(JSON, "stringify").mockImplementation((value: unknown, ...rest: unknown[]) => {
      const code = (value as { error?: { code?: unknown } } | null)?.error?.code;
      if (typeof code === "string") codes.push(code);
      return stringify(value, ...(rest as [undefined, undefined]));
    });
    const r = await dryRun(createApp(mountFinance, undefined, { warm: true }), FINANCE_WARM);
    expect(codes).toEqual(["content_changed"]);
    expect(r.statuses).toMatchInlineSnapshot(`
      [
        "POST /invoices/:id/issue 409",
        "GET /invoices/:id 200",
        "GET /invoices/:id/payments 200",
        "GET /dashboard 200",
        "GET /invoices 200",
        "GET /payments/review 200",
        "GET /approvals 200",
      ]
    `);
    // Fix round decision 1c: the issue call carries a content hash that is not the draft's, so it reads, recomputes the invoice and answers 409
    // `content_changed` before its first new id; PATCH and the advance invoice are not dry-run (they would reach a new id). No refused operation at all.
    expect(r.count).toBe(6);
    expect(r.refused).toBe(0);
  });

  it("the API Worker's hot routes answer on the made-up rows", async () => {
    const r = await dryRun(createApp(mountApi, undefined, { warm: true }), API_WARM);
    expect(r.statuses).toMatchInlineSnapshot(`
      [
        "GET /notifications 200",
        "GET /settings 200",
        "GET /clients 200",
        "GET /clients/:id 200",
        "GET /leads 200",
      ]
    `);
    expect(r.count).toBe(5);
    expect(r.refused).toBe(0);
  });

  it("the front Worker's sign-in, account and forwarded routes answer on the made-up rows", async () => {
    const r = await dryRun(
      createApp(mountFront, (a) => forwardRoutes(a, ROUTES, true), { warm: true }),
      FRONT_WARM,
      FRONT_WARM_SECRETS,
    );
    expect(r.statuses).toMatchInlineSnapshot(`
      [
        "GET /health 200",
        "GET /auth/me 200",
        "POST /auth/salt 200",
        "POST /auth/login 200",
        "GET /invoices/:id 200",
        "POST /invoices/:id/issue 200",
        "GET /notifications 200",
        "GET /leads 200",
        "GET /dashboard 200",
      ]
    `);
    // Fix round decision 1c: no TOTP call (the session it starts, and a refusal's access row, need random values). No refused operation at all.
    expect(r.count).toBe(9);
    expect(r.refused).toBe(0);
  });

  it("leaves no trace: no log line, no request counted, no first-run mark (all three Workers)", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    const before = nextRequestNumber().n;
    await dryRun(createApp(mountFinance, undefined, { warm: true }), FINANCE_WARM);
    // Review finding 7: the API Worker's dry run too, so a handler's own console line in any hot route fails here.
    await dryRun(createApp(mountApi, undefined, { warm: true }), API_WARM);
    await dryRun(
      createApp(mountFront, (a) => forwardRoutes(a, ROUTES, true), { warm: true }),
      FRONT_WARM,
      FRONT_WARM_SECRETS,
    );
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(nextRequestNumber().n).toBe(before + 1);
    // Keys no real request of this file has answered: still a first run after the dry run went through them.
    expect(firstRun("GET /api/v1/invoices/:id")).toBe(1);
    expect(firstRun("fwd GET /api/v1/invoices/:id")).toBe(1);
    expect(firstRun("GET /api/v1/clients/:id")).toBe(1);
  });

  it("the fixtures' expiries are far in the future, so the dry run answers the same whatever the clock reads (review finding 2)", async () => {
    // The fixture writer's WARM_FAR_FUTURE_MS (scripts/cpu-probe.mjs): 2100-01-01T00:00:00Z.
    const farFuture = Date.UTC(2100, 0, 1);
    const expiries: number[] = [];
    const collect = (v: unknown): void => {
      if (Array.isArray(v)) for (const x of v) collect(x);
      else if (v !== null && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          if (/(?:^|_)expires_at$|^step_up_until$/.test(k) && typeof x === "number") expiries.push(x);
          else collect(x);
        }
    };
    for (const f of [FRONT_WARM, API_WARM, FINANCE_WARM]) collect(f.rows);
    expect(expiries.length).toBeGreaterThanOrEqual(9);
    expect(expiries.filter((x) => x !== farFuture)).toEqual([]);
    // A clock a day before those expiries (not workerd's start-up 0): every Worker's dry run answers as many calls, refusing nothing.
    const late = farFuture - 86_400_000;
    const finance = await dryRun(createApp(mountFinance, undefined, { warm: true }), FINANCE_WARM, {}, late);
    const api = await dryRun(createApp(mountApi, undefined, { warm: true }), API_WARM, {}, late);
    const front = await dryRun(
      createApp(mountFront, (a) => forwardRoutes(a, ROUTES, true), { warm: true }),
      FRONT_WARM,
      FRONT_WARM_SECRETS,
      late,
    );
    expect([finance.count, api.count, front.count]).toEqual([6, 5, 9]);
    expect(finance.refused + api.refused + front.refused).toBe(0);
  });

  it("one helper gives the app and the forwarder their request facts; a warm one moves no counter and draws nothing (review finding 8)", () => {
    const n0 = nextRequestNumber().n;
    expect(requestFacts(true, undefined)).toEqual({ iso: "warm", n: 0, rid: "warm" });
    expect(requestFacts(true, "ray-1")).toEqual({ iso: "warm", n: 0, rid: "ray-1" });
    const real = requestFacts(false, "ray-2");
    expect(real.n).toBe(n0 + 1);
    expect(real.rid).toBe("ray-2");
    expect(real.iso).not.toBe("warm");
    expect(requestFacts(false, undefined).rid).toMatch(/^[0-9a-f]{16}$/);
  });

  // Early check 2: a fixture gone stale (a hot route's SQL changed and `node scripts/cpu-probe.mjs --write-fixtures` was not re-run) must fail here, not
  // leave a dry run answering 200 on nothing. Every read of every call is in the answer book, and every list call's list answers rows.
  it("the answer books hold every read of every call, and every list has rows", async () => {
    const finance = await dryRun(createApp(mountFinance, undefined, { warm: true }), FINANCE_WARM);
    const api = await dryRun(createApp(mountApi, undefined, { warm: true }), API_WARM);
    const front = await dryRun(
      createApp(mountFront, (a) => forwardRoutes(a, ROUTES, true), { warm: true }),
      FRONT_WARM,
      FRONT_WARM_SECRETS,
    );
    expect(missesOf(finance.statements)).toEqual([]);
    expect(missesOf(api.statements)).toEqual([]);
    expect(missesOf(front.statements)).toEqual([]);
    // Every call that reads put at least one statement to the D1 (a call that stopped before its reads would warm nothing of its own).
    for (const r of [finance, api])
      for (const [call, list] of Object.entries(r.statements))
        expect(list.filter((s) => s.read).length, call).toBeGreaterThan(0);
    const lists: [Record<string, WarmStatementSeen[]>, string, RegExp][] = [
      [finance.statements, "GET /invoices", /\bFROM documents\b/],
      [finance.statements, "GET /payments/review", /\bFROM review_items\b/],
      [finance.statements, "GET /approvals", /\bFROM approvals\b/],
      [api.statements, "GET /notifications", /\bFROM notifications WHERE user_id = \?1(?! AND read_at)/],
      [api.statements, "GET /clients", /\bFROM clients\b/],
      [api.statements, "GET /leads", /\bFROM leads\b/],
    ];
    for (const [statements, call, table] of lists)
      expect(listRows(statements, call, table), call).toBeGreaterThanOrEqual(1);
  });

  it("an entry's start-up never throws or rejects: a warm app that fails to build, a run that rejects (early check finding 4)", async () => {
    const thrown = () => {
      throw new Error("the warm app could not be built");
    };
    expect(() => warmAtStartup(thrown, FINANCE_WARM)).not.toThrow();
    await expect(warmAtStartup(thrown, FINANCE_WARM)).resolves.toBe(0);
    const poisoned = {
      get calls(): never {
        throw new Error("a broken fixture");
      },
      rows: {},
    } as unknown as WarmFixture;
    await expect(warmAtStartup(() => createApp(mountApi, undefined, { warm: true }), poisoned)).resolves.toBe(
      0,
    );
  });

  it("swallows the rejection of work a warm call hands to waitUntil (early check finding 4)", async () => {
    const rejected = vi.fn();
    const app = new Hono().basePath("/api");
    app.get("/v1/x", (c) => {
      const work = Promise.reject(new Error("a background write failed"));
      const caught = vi.spyOn(work, "catch");
      c.executionCtx.waitUntil(work);
      rejected(caught.mock.calls.length);
      return c.body(null, 204);
    });
    const count = await warmRoutes(app as unknown as ReturnType<typeof createApp>, warmEnv({}), [
      { method: "GET", path: "/x" },
    ]);
    expect(count).toBe(1);
    expect(rejected).toHaveBeenCalledWith(1);
  });

  it("runs with workerd's start-up clock: Date.now() and new Date() both read 0, and the real clock is back afterwards (early check finding 7)", async () => {
    expect(await atGlobalScope(async () => [Date.now(), new Date().toISOString()])).toEqual([
      0,
      "1970-01-01T00:00:00.000Z",
    ]);
    expect(Date.now()).toBeGreaterThan(0);
    expect(new Date().toISOString()).not.toBe("1970-01-01T00:00:00.000Z");
  });

  it("the finance answer book keeps one row per answer: its bundle's headroom is for M6.3 (lead decision 9)", () => {
    const answers = Object.values(FINANCE_WARM.rows).flat();
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.filter((a) => a.r.length > 1)).toEqual([]);
  });

  it("the made-up env's gateway transport is unset, so no gateway call can be made (early check finding 5)", () => {
    expect(transportOf(warmEnv({}))).toBe("unset");
    // Review finding 4: unset because the made-up env never names a transport, not only because ENVIRONMENT is "warm".
    expect("GATEWAY_TRANSPORT" in warmEnv({})).toBe(false);
    expect(transportOf({ ...warmEnv({}), ENVIRONMENT: "local" })).toBe("unset");
  });

  it("never throws, even when every read fails", async () => {
    const broken = warmEnv({});
    Object.defineProperty(broken, "DB", { value: null });
    await expect(
      warmRoutes(createApp(mountFinance, undefined, { warm: true }), broken, FINANCE_WARM.calls),
    ).resolves.toBeTypeOf("number");
  });
});

describe("the made-up D1 [CPU warm-up (b)1]", () => {
  const sql = "SELECT id, name FROM t WHERE id = ?1";
  const db = warmDb({
    [sqlKey(sql)]: [
      { p: ["a"], r: [{ id: "a", name: "Sample A" }], c: 0 },
      { p: ["b"], r: [{ id: "b", name: "Sample B" }], c: 0 },
    ],
  });

  it("answers by the statement and its parameters, else the first recorded rows; a write reports one row changed", async () => {
    expect(await db.prepare(sql).bind("b").first("name")).toBe("Sample B");
    expect(await db.prepare(sql).bind("zzz").first()).toEqual({ id: "a", name: "Sample A" });
    expect((await db.prepare("SELECT 1").all()).results).toEqual([]);
    const [w] = await db.batch([db.prepare("UPDATE t SET name = ?1").bind("x")]);
    expect(w?.meta.changes).toBe(1);
    expect(await db.prepare(sql).bind("a").raw({ columnNames: true })).toEqual([
      ["id", "name"],
      ["a", "Sample A"],
    ]);
  });

  it("tells the observer each statement it answered, and which reads the book did not hold (early check 2)", async () => {
    const seen: WarmStatementSeen[] = [];
    const watched = warmDb({ [sqlKey(sql)]: [{ r: [{ id: "a", name: "Sample A" }], c: 0 }] }, (s) =>
      seen.push(s),
    );
    await watched.prepare(sql).bind("a").first();
    await watched.prepare("SELECT 1 AS stale").all();
    await watched.batch([watched.prepare("UPDATE t SET name = ?1").bind("x")]);
    await watched.prepare(sql).raw();
    expect(seen.map((s) => [s.read, s.hit, s.rows])).toEqual([
      [true, true, 1],
      [true, false, 0],
      [false, false, 0],
      [true, true, 1],
    ]);
  });

  it("keys a statement by FNV-1a of its text, as the probe's fixture writer does", () => {
    expect(sqlKey("")).toBe("811c9dc5");
    expect(sqlKey("SELECT 1")).toBe(sqlKey("SELECT 1"));
    expect(sqlKey("SELECT 1")).not.toBe(sqlKey("SELECT 2"));
  });
});
