// M7.3 C5 dashboard v2 (ADM-DASH-01; run file C5 (c), (e)): the open-leads trend of the last 30 IST days from the nightly `leads.open` counts, and the links to each
// report with the role's period filled in, only for the reports the role may read (docs/04 §9). The figures of (a), (b) and (d) are held by
// dashboard-report-parity.test.ts, dashboard-finance.test.ts and dashboard-pipeline.test.ts. Invented data only.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportLinksFor } from "./dashboard.ts";
import { call, pinClock, sessionFor } from "./test-helpers.ts";
import type { J } from "./test-invoices.ts";

beforeEach(() => {
  pinClock(); // 2026-10-15, 12:00 IST
});
afterEach(() => vi.useRealTimers());

const stat = (date: string, dimension: string, value: number) =>
  env.DB.prepare("INSERT INTO stats_daily (date, metric, dimension, value) VALUES (?1, 'leads.open', ?2, ?3)")
    .bind(date, dimension, value)
    .run();

describe("GET /dashboard v2 [ADM-DASH-01]", () => {
  it("leads.trend: the open leads per day of the last 30 IST days, a day without a nightly count absent (never a zero)", async () => {
    await stat("2026-09-15", "new", 99); // 31 days back: outside the window
    await stat("2026-09-16", "new", 2);
    await stat("2026-09-16", "qualified", 3);
    await stat("2026-10-14", "new", 4);
    await stat("2026-10-14", "proposal_sent", 1);
    await stat("2026-10-15", "qualified", 6);
    await env.DB.prepare(
      "INSERT INTO stats_daily (date, metric, dimension, value) VALUES ('2026-10-15', 'leads.won', '', 50)",
    ).run();
    const s = await sessionFor("owner");
    const body = (await (await call("/dashboard", { cookie: s.cookie })).json()) as J;
    expect(body.tiles.leads.trend).toEqual({
      from: "2026-09-16",
      to: "2026-10-15",
      points: [
        { date: "2026-09-16", open: 5 },
        { date: "2026-10-14", open: 5 },
        { date: "2026-10-15", open: 6 },
      ],
    });
  });

  it("the report links: each role gets the reports it may read, with its period filled in", async () => {
    const expected: Record<string, J> = {
      owner: {
        revenue: { fy: "2627" },
        ageing: {},
        pipeline: { from: "2026-10-01", to: "2026-10-15" },
        careHours: { month: "2026-10" },
      },
      accountant: { revenue: { fy: "2627" }, ageing: {} },
      sales: { pipeline: { from: "2026-10-01", to: "2026-10-15" } },
      staff: { careHours: { month: "2026-10" } },
    };
    for (const [role, links] of Object.entries(expected)) {
      const s = await sessionFor(role as "owner");
      const body = (await (await call("/dashboard", { cookie: s.cookie })).json()) as J;
      expect(body.reports, role).toEqual(links);
    }
  });

  it("reportLinksFor: in April the revenue link is the new FY's", () => {
    expect(reportLinksFor("accountant", "2027-04-01")).toEqual({ revenue: { fy: "2728" }, ageing: {} });
    expect(reportLinksFor("accountant", "2027-03-31")).toEqual({ revenue: { fy: "2627" }, ageing: {} });
  });
});
