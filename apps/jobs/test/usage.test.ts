// M7.5 D1 (Q4 A): `usage.daily` (one GraphQL fetch, one batch into `stats_daily`) and the 09:00 IST usage bells at 50 % and 80 % of a daily Free limit.
// Failure paths: a GraphQL error, a timeout, a 5xx, partial data, no token, and no alert without data. Nothing here reaches Cloudflare: fetch is a fake
// that builds workerd's own Request (so a refused option fails, #168).
import { env } from "cloudflare:workers";
import { parseUsage, usageCrossings, usageDayOf, usageMessageOf } from "@techaust/core/usage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ringUsageBells } from "../src/alerts.ts";
import { PURGE_CRON } from "../src/purge.ts";
import { GRAPHQL_URL, processUsage } from "../src/usage.ts";

const DAY = "2026-11-06";
const MSG = { v: 1, kind: "usage.daily", day: DAY } as const;
const withToken = {
  ...env,
  CF_ANALYTICS_TOKEN: "test-analytics-token",
  CF_ACCOUNT_TAG: "acct",
} as unknown as Env;

const answer = (account: Record<string, unknown> | null, errors?: unknown[]) =>
  JSON.stringify({
    data: account === null ? null : { viewer: { accounts: [account] } },
    errors: errors ?? null,
  });
const FULL = {
  w: [
    { sum: { requests: 70_000 }, dimensions: { scriptName: "techaust-web", status: "success" } },
    {
      sum: { requests: 12_000 },
      dimensions: { scriptName: "techaust-platform-admin-staging", status: "success" },
    },
    {
      sum: { requests: 3 },
      dimensions: { scriptName: "techaust-platform-admin-staging", status: "exceededResources" },
    },
  ],
  d: [{ sum: { rowsRead: 2_600_000, rowsWritten: 1_000 }, dimensions: { databaseId: "db-1" } }],
  q: [
    { sum: { billableOperations: 300 }, dimensions: { actionType: "WriteMessage" } },
    { sum: { billableOperations: 200 }, dimensions: { actionType: "ReadMessage" } },
  ],
};

const rowsOf = async (day = DAY) =>
  (
    await env.DB.prepare(
      "SELECT metric, dimension, value FROM stats_daily WHERE date = ?1 AND metric LIKE 'cf.%' ORDER BY metric, dimension",
    )
      .bind(day)
      .all<{ metric: string; dimension: string; value: number }>()
  ).results;

let calls: Request[] = [];
function fakeFetch(respond: (req: Request) => Response | Promise<Response>) {
  calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    calls.push(req);
    return respond(req);
  });
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM stats_daily WHERE metric LIKE 'cf.%'").run();
  await env.DB.prepare("DELETE FROM notifications WHERE kind = 'usage.limit'").run();
});
afterEach(() => vi.restoreAllMocks());

describe("usage.daily (M7.5 D1)", () => {
  it("the 03:30 IST cron's message names the UTC day that ended (22:00 UTC: today isn't over)", () => {
    expect(usageDayOf(Date.UTC(2026, 10, 7, 22, 0))).toBe("2026-11-06");
    expect(usageMessageOf(Date.UTC(2026, 10, 7, 22, 0))).toEqual(MSG);
    expect(PURGE_CRON).toBe("0 22 * * *");
  });

  it("one POST with the token, no redirect followed and a timeout; the day's totals and splits written", async () => {
    fakeFetch(() => new Response(answer(FULL), { headers: { "content-type": "application/json" } }));
    expect(await processUsage(withToken, MSG, 1_000)).toBe("ack");
    expect(calls).toHaveLength(1);
    const req = calls[0] as Request;
    expect(req.url).toBe(GRAPHQL_URL);
    expect(req.method).toBe("POST");
    expect(req.headers.get("authorization")).toBe("Bearer test-analytics-token");
    expect(req.redirect).toBe("manual");
    const sent = (await req.json()) as { variables: Record<string, string> };
    expect(sent.variables).toEqual({
      a: "acct",
      s: "2026-11-06T00:00:00.000Z",
      e: "2026-11-07T00:00:00.000Z",
      d: DAY,
    });
    const rows = await rowsOf();
    const v = (metric: string, dimension = "") =>
      rows.find((r) => r.metric === metric && r.dimension === dimension)?.value;
    expect(v("cf.requests")).toBe(82_003);
    expect(v("cf.requests", "techaust-web")).toBe(70_000);
    expect(v("cf.exceeded_resources")).toBe(3);
    expect(v("cf.d1.rows_read")).toBe(2_600_000);
    expect(v("cf.d1.rows_written")).toBe(1_000);
    expect(v("cf.queue.operations")).toBe(500);
    expect(v("cf.queue.operations", "WriteMessage")).toBe(300);
    // A rerun writes the same rows again (no doubling).
    expect(await processUsage(withToken, MSG, 2_000)).toBe("ack");
    expect((await rowsOf()).length).toBe(rows.length);
  });

  it("partial data: what came is written, a missing dataset keeps its earlier rows and is never zero-filled", async () => {
    fakeFetch(() => new Response(answer(FULL)));
    await processUsage(withToken, MSG);
    fakeFetch(
      () =>
        new Response(
          answer(
            {
              ...FULL,
              w: [{ sum: { requests: 5 }, dimensions: { scriptName: "x", status: "success" } }],
              d: null,
            },
            [{ message: "d1 unavailable" }],
          ),
        ),
    );
    expect(await processUsage(withToken, MSG)).toBe("ack");
    const rows = await rowsOf();
    expect(rows.find((r) => r.metric === "cf.requests" && r.dimension === "")?.value).toBe(5);
    // D1 kept its earlier reading.
    expect(rows.find((r) => r.metric === "cf.d1.rows_read" && r.dimension === "")?.value).toBe(2_600_000);
  });

  it("a GraphQL error with no data, a 4xx and an answer that isn't JSON: logged and acknowledged, nothing written", async () => {
    for (const res of [
      () => new Response(answer(null, [{ message: "not authorized" }])),
      () => new Response("{}", { status: 403 }),
      () => new Response("<html>"),
    ]) {
      fakeFetch(res);
      expect(await processUsage(withToken, MSG)).toBe("ack");
    }
    expect(await rowsOf()).toEqual([]);
  });

  it("a timeout, a network error, a 5xx and a 429 are retried", async () => {
    for (const res of [
      () => {
        throw new DOMException("timed out", "TimeoutError");
      },
      () => {
        throw new TypeError("network");
      },
      () => new Response("", { status: 502 }),
      () => new Response("", { status: 429 }),
    ]) {
      fakeFetch(res);
      expect(await processUsage(withToken, MSG)).toBe("retry");
    }
    expect(await rowsOf()).toEqual([]);
  });

  it("no token or no account tag (local, production until L3): nothing fetched, nothing written", async () => {
    fakeFetch(() => new Response(answer(FULL)));
    expect(await processUsage({ ...env, CF_ACCOUNT_TAG: "acct" } as unknown as Env, MSG)).toBe("ack");
    expect(await processUsage({ ...withToken, CF_ACCOUNT_TAG: "" } as unknown as Env, MSG)).toBe("ack");
    expect(await processUsage(withToken, { kind: "usage.daily", day: "yesterday" })).toBe("ack");
    expect(calls).toHaveLength(0);
    expect(await rowsOf()).toEqual([]);
  });
});

describe("the parser and the lines (core, M7.5 D1)", () => {
  it("keeps codes and counts only, and tells a failure from partial data", () => {
    expect(parseUsage("<html>")).toEqual({ ok: false, reason: "not_json" });
    expect(parseUsage(answer(null, [{ message: "x" }]))).toEqual({ ok: false, reason: "graphql_error" });
    expect(parseUsage(answer({ w: null, d: null, q: null }))).toEqual({ ok: false, reason: "no_account" });
    const odd = parseUsage(
      answer({ w: [{ sum: { requests: -1 }, dimensions: { scriptName: "a b@c" } }], d: null, q: null }),
    );
    expect(odd.ok && odd.rows).toEqual([
      { metric: "cf.requests", dimension: "", value: 0 },
      { metric: "cf.exceeded_resources", dimension: "", value: 0 },
      { metric: "cf.requests", dimension: "other", value: 0 },
    ]);
  });

  it("the highest line crossed per metric, at exactly 50 % and 80 %", () => {
    expect(usageCrossings([])).toEqual([]);
    expect(usageCrossings([{ metric: "cf.requests", value: 49_999 }])).toEqual([]);
    expect(usageCrossings([{ metric: "cf.requests", value: 50_000 }])[0]?.threshold).toBe(50);
    expect(usageCrossings([{ metric: "cf.requests", value: 80_000 }])[0]?.threshold).toBe(80);
    expect(usageCrossings([{ metric: "cf.queue.operations", value: 9_000 }])[0]).toEqual({
      metric: "cf.queue.operations",
      threshold: 80,
      value: 9_000,
      limit: 10_000,
    });
  });
});

describe("usage bells at 09:00 IST (M7.5 D1)", () => {
  const NOW = Date.UTC(2026, 10, 8, 3, 30);
  const bells = async () =>
    (
      await env.DB.prepare(
        "SELECT entity_id, title FROM notifications WHERE kind = 'usage.limit' ORDER BY entity_id",
      ).all<{
        entity_id: string;
        title: string;
      }>()
    ).results;

  it("no recorded day: no bell (no alert without data)", async () => {
    expect(await ringUsageBells(env, NOW)).toBe(0);
    expect(await bells()).toEqual([]);
  });

  it("the newest recorded day's crossings ring once per owner, the highest line only, and never again", async () => {
    fakeFetch(() => new Response(answer(FULL)));
    await processUsage(withToken, MSG);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO staff_users (id, email, name, role, status) VALUES ('u_usage_o1', 'o1@example.test', 'Owner One', 'owner', 'active')",
      ),
      env.DB.prepare(
        "INSERT OR IGNORE INTO staff_users (id, email, name, role, status) VALUES ('u_usage_s1', 's1@example.test', 'Staff One', 'staff', 'active')",
      ),
    ]);
    const owners = (
      await env.DB.prepare(
        "SELECT count(*) AS n FROM staff_users WHERE role = 'owner' AND status = 'active'",
      ).first<{ n: number }>()
    )?.n;
    // Requests 82,003 (80 %) and D1 rows read 2,600,000 (50 %); rows written and queue operations are under 50 %.
    expect(await ringUsageBells(env, NOW)).toBe(2);
    const got = await bells();
    expect(owners).toBeGreaterThan(0);
    // Owners only: the staff member gets none.
    expect(got.length).toBe(2 * (owners ?? 0));
    expect(got.map((b) => b.entity_id)).toContain(`${DAY}|cf.requests|80`);
    expect(got.map((b) => b.entity_id)).toContain(`${DAY}|cf.d1.rows_read|50`);
    expect(got.find((b) => b.entity_id.includes("cf.requests"))?.title).toBe(
      "Free plan: Worker requests at 80 % of the daily limit on 2026-11-06 (82,003 of 1,00,000)",
    );
    await ringUsageBells(env, NOW);
    expect((await bells()).length).toBe(got.length);
  });
});
