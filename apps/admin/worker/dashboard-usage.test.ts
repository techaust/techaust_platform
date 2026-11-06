// M7.5 D1/G (Q4 A): the Free-plan usage tile's data, `GET /api/v1/dashboard/usage` (invoices Worker): Owner and Accountant only, the last 30 UTC days of the
// `cf.*` totals the jobs Worker recorded, the limits and the alert lines; a day the job could not read is absent, never zero.
import { env } from "cloudflare:workers";
import { FREE_DAILY_LIMITS, USAGE_THRESHOLDS, usageDayOf } from "@techaust/core/usage";
import { beforeAll, describe, expect, it } from "vitest";
import type { UsageTile } from "./dashboard-usage.ts";
import { ROUTES } from "./guard.ts";
import { call, sessionFor } from "./test-helpers.ts";

/** The UTC day `back` days ago (Cloudflare's days are UTC; `usageDayOf` is the UTC day before its argument). */
const day = (back: number) => usageDayOf(Date.now() - (back - 1) * 86_400_000);

beforeAll(async () => {
  const put = (date: string, metric: string, value: number, dimension = "") =>
    env.DB.prepare(
      "INSERT OR REPLACE INTO stats_daily (date, metric, dimension, value) VALUES (?1, ?2, ?3, ?4)",
    ).bind(date, metric, dimension, value);
  await env.DB.batch([
    put(day(2), "cf.requests", 61_000),
    put(day(2), "cf.requests", 60_000, "techaust-web"),
    put(day(2), "cf.d1.rows_read", 900_000),
    put(day(1), "cf.requests", 5_000),
    put(day(1), "cf.exceeded_resources", 2),
    // Older than 30 days, and another metric: not read.
    put(day(40), "cf.requests", 99_000),
    put(day(1), "leads.open", 3, "new"),
  ]);
});

describe("GET /api/v1/dashboard/usage (M7.5 D1/G)", () => {
  it("is a row of the invoices Worker with its own action", () => {
    expect(ROUTES.find((r) => r.path === "/api/v1/dashboard/usage")).toMatchObject({
      method: "GET",
      access: "usage.read",
      on: "invoices",
    });
  });

  it.each([
    ["owner", 200],
    ["accountant", 200],
    ["staff", 403],
    ["sales", 403],
  ] as const)("%s: %i", async (role, status) => {
    const s = await sessionFor(role);
    const res = await call("/dashboard/usage", { cookie: s.cookie });
    expect(res.status).toBe(status);
  });

  it("the totals of the last 30 UTC days by day, the limits and the lines; no split, no other metric, a missing value absent", async () => {
    const s = await sessionFor("accountant");
    const body = (await (await call("/dashboard/usage", { cookie: s.cookie })).json()) as UsageTile;
    expect(body.limits).toEqual(FREE_DAILY_LIMITS);
    expect(body.thresholds).toEqual([...USAGE_THRESHOLDS]);
    expect(body.days).toEqual([
      { date: day(2), values: { "cf.requests": 61_000, "cf.d1.rows_read": 900_000 } },
      { date: day(1), values: { "cf.requests": 5_000, "cf.exceeded_resources": 2 } },
    ]);
    expect(body.newest).toBe(day(1));
  });
});
