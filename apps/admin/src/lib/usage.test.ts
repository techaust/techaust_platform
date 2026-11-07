// M7.5 G: the Free-plan usage tile's rules (lib/usage.ts): who sees it, the window and its gaps, the share and status words held to core's crossings (the
// 09:00 bells), en-IN grouping, the strip's name, and the 07-ZS words. The pool has no DOM; the tile's wiring is checked on its source.
import { FREE_DAILY_LIMITS, USAGE_METRICS, usageCrossings } from "@techaust/core/usage";
import { describe, expect, it } from "vitest";
import type { UsageTile } from "../api.ts";
import dashboardSource from "../routes/dashboard.tsx?raw";
import tileSource from "../routes/dashboard-usage.tsx?raw";
import { allowed } from "./access.ts";
import {
  levelOf,
  sharePct,
  shareText,
  stripLabel,
  USAGE_COPY,
  usageCount,
  usageDayText,
  usageView,
} from "./usage.ts";

const NOW = Date.parse("2026-11-07T05:00:00Z"); // 10:30 IST: yesterday's UTC day is 2026-11-06
const tile = (days: UsageTile["days"], newest = days.at(-1)?.date ?? null): UsageTile => ({
  limits: { ...FREE_DAILY_LIMITS },
  thresholds: [50, 80],
  days,
  newest,
});

describe("who sees the tile", () => {
  it("the Owner and the Accountant (usage.read); Staff and Sales never", () => {
    expect(allowed("owner", "usage.read")).toBe(true);
    expect(allowed("accountant", "usage.read")).toBe(true);
    expect(allowed("staff", "usage.read")).toBe(false);
    expect(allowed("sales", "usage.read")).toBe(false);
  });

  it("the dashboard mounts it only for a role with usage.read, after the other tiles", () => {
    expect(dashboardSource).toMatch(/\{allowed\(user\.role, "usage\.read"\) && <UsageTile \/>\}\s*<\/div>/);
    expect(tileSource).toMatch(/api\.dashboardUsage\(\)/);
  });
});

describe("usageView", () => {
  it("no reading yet: null (the empty state)", () => {
    expect(usageView(tile([]), NOW)).toBeNull();
  });

  it("the window ends yesterday (UTC) and runs 30 days; a missed day is a gap, never a zero; the newest day leads the table", () => {
    const v = usageView(
      tile([
        { date: "2026-10-01", values: { "cf.requests": 9 } }, // before the window
        { date: "2026-10-08", values: { "cf.requests": 1_200, "cf.d1.rows_read": 40_000 } },
        { date: "2026-11-05", values: { "cf.requests": 3_400 } },
        {
          date: "2026-11-06",
          values: { "cf.requests": 82_003, "cf.d1.rows_written": 0, "cf.exceeded_resources": 2 },
        },
      ]),
      NOW,
    );
    if (!v) throw new Error("expected a view");
    expect([v.from, v.to, v.newest, v.stale]).toEqual(["2026-10-08", "2026-11-06", "2026-11-06", false]);
    expect(v.rows.map((r) => r.metric)).toEqual(USAGE_METRICS);
    const req = v.rows[0];
    expect(req?.latest).toBe(82_003);
    expect(req?.points.map((p) => p.date)).toEqual(["2026-10-08", "2026-11-05", "2026-11-06"]);
    // D1 rows read wasn't read on the newest day: "Not read", and only the day it was read is a point
    expect(v.rows[1]?.latest).toBeNull();
    expect(v.rows[1]?.points).toEqual([{ date: "2026-10-08", value: 40_000 }]);
    // a zero that was read is a zero
    expect(v.rows[2]?.latest).toBe(0);
    expect(v.stopped).toBe(2);
    // the table lists every day of the window, newest first; a day not read has no values (it says "Not read")
    expect(v.days).toHaveLength(30);
    expect(v.days[0]).toEqual({
      date: "2026-11-06",
      values: { "cf.requests": 82_003, "cf.d1.rows_written": 0, "cf.exceeded_resources": 2 },
    });
    expect(v.days[2]).toEqual({ date: "2026-11-04", values: {} });
    expect(v.days.at(-1)?.date).toBe("2026-10-08");
    expect(v.days.filter((d) => Object.keys(d.values).length > 0).map((d) => d.date)).toEqual([
      "2026-11-06",
      "2026-11-05",
      "2026-10-08",
    ]);
  });

  it("L50: a healthy day never shows stale, an empty last slot or a 'Not read' top row (the reading runs at 00:30 UTC)", () => {
    const month = (newest: string) =>
      tile(
        Array.from({ length: 31 }, (_, k) => ({
          date: new Date(Date.parse(`${newest}T00:00:00Z`) - k * 86_400_000).toISOString().slice(0, 10),
          values: { "cf.requests": 1_000 + k },
        })).reverse(),
      );
    const cases: [string, number, string][] = [
      // 23:59 UTC on 7 Nov: the 06:00 IST reading of that morning recorded 6 Nov
      ["23:59 UTC, 6 Nov read", Date.parse("2026-11-07T23:59:00Z"), "2026-11-06"],
      // 00:31 UTC on 8 Nov, the reading of 7 Nov not in yet (queued at 00:30): still fresh, the window still ends on 6 Nov
      ["00:31 UTC, 7 Nov not yet read", Date.parse("2026-11-08T00:31:00Z"), "2026-11-06"],
      // 00:31 UTC on 8 Nov, the reading of 7 Nov in
      ["00:31 UTC, 7 Nov read", Date.parse("2026-11-08T00:31:00Z"), "2026-11-07"],
    ];
    for (const [name, now, newest] of cases) {
      const v = usageView(month(newest), now);
      if (!v) throw new Error("expected a view");
      expect([v.stale, v.to, v.newest], name).toEqual([false, newest, newest]);
      expect(v.days, name).toHaveLength(30);
      expect(v.days[0]?.date, name).toBe(newest);
      expect(Object.keys(v.days[0]?.values ?? {}), name).toEqual(["cf.requests"]);
      // every one of the 30 days was read: no gap anywhere, and the strip's last point is the newest day
      expect(
        v.days.every((d) => Object.keys(d.values).length > 0),
        name,
      ).toBe(true);
      expect(v.rows[0]?.points.at(-1)?.date, name).toBe(newest);
      expect(v.rows[0]?.points, name).toHaveLength(30);
    }
  });

  it("L50: a reading missing past the day before yesterday is stale, and the window ends yesterday with the missed days as gaps", () => {
    const v = usageView(
      tile([{ date: "2026-11-06", values: { "cf.requests": 10 } }]),
      Date.parse("2026-11-09T00:31:00Z"),
    );
    expect([v?.stale, v?.to]).toEqual([true, "2026-11-08"]);
    expect(v?.days.slice(0, 3)).toEqual([
      { date: "2026-11-08", values: {} },
      { date: "2026-11-07", values: {} },
      { date: "2026-11-06", values: { "cf.requests": 10 } },
    ]);
  });

  it("a newest reading older than the day before yesterday is stale (the reading stopped)", () => {
    const v = usageView(tile([{ date: "2026-11-02", values: { "cf.requests": 10 } }]), NOW);
    expect(v?.stale).toBe(true);
    expect(v?.stopped).toBeNull();
  });
});

describe("share and status", () => {
  it("the share rounds down, as core's integer check: 79.99 % is 79 %, under the 80 % line", () => {
    expect(sharePct(79_999, 100_000)).toBe(79);
    expect(sharePct(80_000, 100_000)).toBe(80);
    expect(shareText(0, 100_000)).toBe("0 %");
    expect(shareText(1, 100_000)).toBe("Under 1 %");
    expect(shareText(82_003, 100_000)).toBe("82 %");
  });

  it("the status agrees with the bells (core usageCrossings) at every edge, and the limit itself is its own word", () => {
    for (const metric of USAGE_METRICS) {
      const limit = FREE_DAILY_LIMITS[metric];
      for (const value of [0, limit / 2 - 1, limit / 2, (limit * 8) / 10 - 1, (limit * 8) / 10, limit - 1]) {
        expect(levelOf(metric, value)).toBe(usageCrossings([{ metric, value }])[0]?.threshold ?? null);
      }
      expect(levelOf(metric, limit)).toBe("limit");
      expect(levelOf(metric, limit + 1)).toBe("limit");
    }
    expect(USAGE_COPY.reached[50]).toBe("50 % reached");
    expect(USAGE_COPY.reached[80]).toBe("80 % reached");
    expect(USAGE_COPY.reached.limit).toBe("Limit reached");
  });
});

describe("words and numbers", () => {
  it("en-IN grouping, as the bell prints it", () => {
    expect(usageCount(100_000)).toBe("1,00,000");
    expect(usageCount(5_000_000)).toBe("50,00,000");
    expect(USAGE_COPY.ofLimit(usageCount(82_003), usageCount(100_000))).toBe("82,003 of 1,00,000");
  });

  it("days as the admin writes dates", () => {
    expect(usageDayText("2026-11-06")).toBe("06 Nov 2026");
    expect(USAGE_COPY.intro("06 Nov 2026")).toBe(
      "Use on 06 Nov 2026 (UTC) against each daily limit, with the last 30 days.",
    );
  });

  it("a strip is named by its highest day and the days read; one never read says so", () => {
    const v = usageView(
      tile([
        { date: "2026-11-04", values: { "cf.requests": 51_000 } },
        { date: "2026-11-06", values: { "cf.requests": 82_003 } },
      ]),
      NOW,
    );
    if (!v) throw new Error("expected a view");
    expect(stripLabel(v.rows[0] as (typeof v.rows)[number])).toBe(
      "Worker requests over the last 30 days: highest 82,003 on 06 Nov 2026 (82 % of the limit); 2 of 30 days read.",
    );
    expect(stripLabel(v.rows[3] as (typeof v.rows)[number])).toBe(
      "Queue operations over the last 30 days: no day read.",
    );
  });

  it("07-ZS: no ampersand, no arrow character, sentence case", () => {
    const words = Object.values(USAGE_COPY)
      .flatMap((w) => (typeof w === "string" ? [w] : typeof w === "object" ? Object.values(w) : []))
      .join("\n");
    expect(words).not.toMatch(/&|→/);
  });
});
