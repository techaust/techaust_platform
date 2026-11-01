// The start-up dry run of the hot routes (CPU warm-up (b)1, warm-routes.ts): each admin Worker's made-up calls go through a warm instance of its own app on a
// made-up env. Run here under workerd's global-scope rules (a Response or Request with a body, random values, timers and fetch refused, `Date.now()` reading
// 0; checked in local workerd 1.20261001.1, 2026-11-02), the count of calls that answered is pinned per Worker, so a fixture or route change that stops a
// call early shows up. The dry run never throws, writes nothing anywhere, logs nothing, counts no request and sets no first-run mark.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, firstRun, nextRequestNumber } from "./app.ts";
import { forwardRoutes } from "./forward.ts";
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
async function atGlobalScope<T>(fn: () => Promise<T>): Promise<T> {
  const RealResponse = globalThis.Response;
  const RealRequest = globalThis.Request;
  const saved = { setTimeout: globalThis.setTimeout, fetch: globalThis.fetch };
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
  const now = vi.spyOn(Date, "now").mockReturnValue(0);
  try {
    return await fn();
  } finally {
    globalThis.Response = RealResponse;
    globalThis.Request = RealRequest;
    globalThis.setTimeout = saved.setTimeout;
    globalThis.fetch = saved.fetch;
    grv.mockRestore();
    uuid.mockRestore();
    now.mockRestore();
  }
}

const callName = (call: WarmCall) =>
  `${call.method} ${call.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}`;

/**
 * One Worker's dry run under the global-scope rules: its count, each call's status (0: it stopped on a refused operation), the refused operations asked
 * for, and every statement each call put to the made-up D1 (early check 2).
 */
async function dryRun(app: ReturnType<typeof createApp>, fixture: WarmFixture, extra = {}) {
  const statuses: string[] = [];
  const statements: Record<string, WarmStatementSeen[]> = {};
  let current: WarmStatementSeen[] = [];
  const before = refusals;
  const env = warmEnv(fixture.rows, extra, (seen) => current.push(seen));
  const count = await atGlobalScope(() =>
    warmRoutes(app, env, fixture.calls, (call: WarmCall, status: number) => {
      statuses.push(`${callName(call)} ${status}`);
      statements[callName(call)] = current;
      current = [];
    }),
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

  it("leaves no trace: no log line, no request counted, no first-run mark", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    const before = nextRequestNumber().n;
    await dryRun(createApp(mountFinance, undefined, { warm: true }), FINANCE_WARM);
    await dryRun(
      createApp(mountFront, (a) => forwardRoutes(a, ROUTES, true), { warm: true }),
      FRONT_WARM,
      FRONT_WARM_SECRETS,
    );
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(nextRequestNumber().n).toBe(before + 1);
    // Keys no real request of this file has answered: still a first run after the dry run went through them.
    expect(firstRun("GET /api/v1/invoices/:id")).toBe(1);
    expect(firstRun("fwd GET /api/v1/invoices/:id")).toBe(1);
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
