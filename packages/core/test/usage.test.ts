// M7.5 D1 (Q4 A): the pure parts of the Free-plan usage job (packages/core/src/usage.ts): the day, the message, the query variables, the answer parser,
// the alert lines and the bell title. The jobs Worker's own tests cover the fetch, the batch and the bells (apps/jobs/test/usage.test.ts).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  EXCEEDED_METRIC,
  FREE_DAILY_LIMITS,
  isUsageKind,
  isUsageMessage,
  newestUsageDay,
  parseUsage,
  USAGE_METRICS,
  USAGE_QUERY,
  usageBellTitle,
  usageCrossings,
  usageDayOf,
  usageMessageOf,
  usageVariables,
} from "../src/usage.ts";

const answer = (account: unknown, errors: unknown = null) =>
  JSON.stringify({ data: { viewer: { accounts: account === undefined ? [] : [account] } }, errors });

describe("usage message and day", () => {
  it("the UTC day before the cron's run, and a message only with a real ISO day", () => {
    expect(usageDayOf(Date.UTC(2026, 0, 1, 22))).toBe("2025-12-31");
    expect(usageMessageOf(Date.UTC(2026, 10, 7, 22))).toEqual({ v: 1, kind: "usage.daily", day: "2026-11-06" });
    expect(isUsageMessage({ v: 1, kind: "usage.daily", day: "2026-11-06" })).toBe(true);
    for (const bad of [null, "x", { kind: "usage.daily" }, { v: 2, kind: "usage.daily", day: "2026-11-06" }, { v: 1, kind: "usage.daily", day: "6 Nov" }])
      expect(isUsageMessage(bad)).toBe(false);
    expect(isUsageKind({ kind: "usage.daily" })).toBe(true);
    expect(isUsageKind({ kind: "stats.metric" })).toBe(false);
    expect(isUsageKind(7)).toBe(false);
  });

  it("the query names the three datasets, and the variables cover exactly one UTC day", () => {
    for (const ds of ["workersInvocationsAdaptive", "d1AnalyticsAdaptiveGroups", "queueMessageOperationsAdaptiveGroups"])
      expect(USAGE_QUERY).toContain(ds);
    expect(usageVariables("tag", "2026-02-28")).toEqual({
      a: "tag",
      s: "2026-02-28T00:00:00.000Z",
      e: "2026-03-01T00:00:00.000Z",
      d: "2026-02-28",
    });
  });
});

describe("parseUsage", () => {
  it("totals, splits and the exceeded-resources count", () => {
    const r = parseUsage(
      answer({
        w: [
          { sum: { requests: 10 }, dimensions: { scriptName: "a", status: "success" } },
          { sum: { requests: 2 }, dimensions: { scriptName: "a", status: "exceededResources" } },
          { sum: { requests: 5 }, dimensions: { scriptName: "b", status: "success" } },
        ],
        d: [
          { sum: { rowsRead: 7, rowsWritten: 1 }, dimensions: { databaseId: "x" } },
          { sum: { rowsRead: 3, rowsWritten: 2 }, dimensions: { databaseId: "y" } },
        ],
        q: [{ sum: { billableOperations: 4 }, dimensions: { actionType: "WriteMessage" } }],
      }),
    );
    if (!r.ok) throw new Error("expected ok");
    const v = (m: string, d = "") => r.rows.find((x) => x.metric === m && x.dimension === d)?.value;
    expect(v("cf.requests")).toBe(17);
    expect(v("cf.requests", "a")).toBe(12);
    expect(v(EXCEEDED_METRIC)).toBe(2);
    expect(v(EXCEEDED_METRIC, "a")).toBe(2);
    expect(v("cf.d1.rows_read")).toBe(10);
    expect(v("cf.d1.rows_written", "y")).toBe(2);
    expect(v("cf.queue.operations")).toBe(4);
    expect(r.missing).toEqual([]);
    expect(r.errors).toBe(0);
  });

  it("partial data lists what is missing; nothing at all is a failure", () => {
    const r = parseUsage(answer({ w: [], d: null }, [{ message: "x" }]));
    expect(r).toEqual({
      ok: true,
      rows: [
        { metric: "cf.requests", dimension: "", value: 0 },
        { metric: EXCEEDED_METRIC, dimension: "", value: 0 },
      ],
      missing: ["d1", "queues"],
      errors: 1,
    });
    expect(parseUsage(answer({ w: null, d: null, q: null }, [{}]))).toEqual({ ok: false, reason: "graphql_error" });
    expect(parseUsage(answer(undefined))).toEqual({ ok: false, reason: "no_account" });
    expect(parseUsage(JSON.stringify({ errors: [{}] }))).toEqual({ ok: false, reason: "graphql_error" });
    expect(parseUsage("nope")).toEqual({ ok: false, reason: "not_json" });
  });

  it("never keeps a value that isn't a count, nor a dimension that isn't a plain code (property)", () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (requests, name) => {
        const r = parseUsage(answer({ w: [{ sum: { requests }, dimensions: { scriptName: name } }], d: null, q: null }));
        if (!r.ok) return true;
        return r.rows.every((x) => Number.isSafeInteger(x.value) && x.value >= 0 && /^[A-Za-z0-9._-]{0,80}$/.test(x.dimension));
      }),
    );
  });
});

describe("alert lines", () => {
  it("each metric's highest line, with integer maths at the edges", () => {
    for (const m of USAGE_METRICS) {
      const limit = FREE_DAILY_LIMITS[m];
      expect(usageCrossings([{ metric: m, value: limit / 2 - 1 }])).toEqual([]);
      expect(usageCrossings([{ metric: m, value: limit / 2 }])[0]?.threshold).toBe(50);
      expect(usageCrossings([{ metric: m, value: (limit * 4) / 5 }])[0]?.threshold).toBe(80);
      expect(usageCrossings([{ metric: m, value: limit * 3 }])[0]?.threshold).toBe(80);
    }
    expect(usageCrossings([{ metric: EXCEEDED_METRIC, value: 99 }])).toEqual([]);
  });

  it("the bell title names the metric, the line, the day and both figures", () => {
    expect(
      usageBellTitle({ metric: "cf.d1.rows_written", threshold: 50, value: 51_000, limit: 100_000 }, "2026-11-06"),
    ).toBe("Free plan: D1 rows written at 50 % of the daily limit on 2026-11-06 (51,000 of 1,00,000)");
  });

  it("the newest day among recorded rows", () => {
    expect(newestUsageDay([])).toBeNull();
    expect(newestUsageDay([{ date: "2026-11-05" }, { date: "2026-11-06" }, { date: "2026-11-04" }])).toBe("2026-11-06");
  });
});
