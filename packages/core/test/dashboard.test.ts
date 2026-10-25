import { describe, expect, it } from "vitest";
import { FINANCE_AUDIT_ACTIONS } from "../src/audit.ts";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_OWN_ONLY,
  MILESTONE_WINDOW_DAYS,
  TILES,
  TIME_ACTIONS,
  tilesFor,
} from "../src/dashboard.ts";
import { ROLES } from "../src/permissions.ts";
import {
  isStatsKind,
  isStatsMessage,
  STATS_METRICS,
  STATS_MILESTONE_DAYS,
  statsDateOf,
  statsMessages,
} from "../src/stats.ts";

describe("dashboard tiles by role [ADM-DASH-01]", () => {
  it("owner sees every tile; staff the delivery tiles and their own time; sales the pipeline; the accountant finance", () => {
    expect(tilesFor("owner").sort()).toEqual(TILES.map((t) => t.key).sort());
    expect(tilesFor("staff")).toEqual(["projects", "milestones", "careBurn", "myTime", "activity"]);
    expect(tilesFor("sales")).toEqual(["leads", "pipelineValue", "activity"]);
    expect(tilesFor("accountant")).toEqual(["finance", "activity"]);
  });

  it("every tile has a capability that exists, and a role list only narrows it", () => {
    for (const t of TILES) for (const role of t.roles ?? []) expect(ROLES).toContain(role);
  });
});

describe("activity lists", () => {
  it("are exact names, never prefixes, and have no duplicates", () => {
    for (const role of ROLES) {
      const list = ACTIVITY_ACTIONS[role];
      expect(new Set(list).size, role).toBe(list.length);
      for (const a of list) expect(a, `${role} ${a}`).toMatch(/^[a-z_]+(\.[a-z_0-9]+)+$/);
    }
  });

  it("keep sign-in, the bell and staff alerts out of every role's feed", () => {
    for (const role of ROLES)
      for (const a of ACTIVITY_ACTIONS[role]) expect(a).not.toMatch(/^(auth|notification|alert|portal)\./);
  });

  it("give sales no finance action and no care plan, and the accountant only the finance list", () => {
    const finance = FINANCE_AUDIT_ACTIONS as readonly string[];
    expect(ACTIVITY_ACTIONS.sales.filter((a) => finance.includes(a) || a.startsWith("care_plan."))).toEqual(
      [],
    );
    expect(ACTIVITY_ACTIONS.sales).not.toContain("client.billing_update");
    expect([...ACTIVITY_ACTIONS.accountant].sort()).toEqual([...finance].sort());
    expect(finance).toContain("care_plan.terms");
  });

  it("staff and sales see time entries only when they are their own; the owner sees all", () => {
    for (const role of ["staff", "sales"] as const) {
      for (const a of TIME_ACTIONS) expect(ACTIVITY_ACTIONS[role]).toContain(a);
      expect(ACTIVITY_OWN_ONLY[role]).toEqual(TIME_ACTIONS);
    }
    expect(ACTIVITY_OWN_ONLY.owner).toEqual([]);
    expect(ACTIVITY_OWN_ONLY.accountant).toEqual([]);
    expect(ACTIVITY_ACTIONS.accountant.some((a) => a.startsWith("time."))).toBe(false);
  });

  it("every own-only action is in that role's list", () => {
    for (const role of ROLES)
      for (const a of ACTIVITY_OWN_ONLY[role]) expect(ACTIVITY_ACTIONS[role]).toContain(a);
  });
});

describe("the nightly date and messages [item 6]", () => {
  it("the date is the IST day that just ended: 22:00 UTC is 03:30 IST the next morning, minus one day", () => {
    expect(statsDateOf(Date.UTC(2026, 10, 30, 22, 0))).toBe("2026-11-30"); // fires 2026-12-01 03:30 IST
    expect(statsDateOf(Date.UTC(2026, 11, 31, 22, 0))).toBe("2026-12-31"); // across a year end
    expect(statsDateOf(Date.UTC(2028, 1, 28, 22, 0))).toBe("2028-02-28"); // before a leap day
    expect(statsDateOf(Date.UTC(2028, 1, 29, 22, 0))).toBe("2028-02-29");
    // a cron that fires late, at 05:00 IST, still names the same day; one that fires at 23:59 IST the evening before names the day before
    expect(statsDateOf(Date.UTC(2026, 10, 30, 23, 30))).toBe("2026-11-30");
    expect(statsDateOf(Date.UTC(2026, 10, 30, 18, 29))).toBe("2026-11-29"); // 23:59 IST on the 30th: the 29th ended
  });

  it("there is one valid message per metric, all for the same date", () => {
    const msgs = statsMessages("2026-11-30");
    expect(msgs.map((m) => m.metric)).toEqual([...STATS_METRICS]);
    for (const m of msgs) {
      expect(isStatsMessage(m)).toBe(true);
      expect(m.date).toBe("2026-11-30");
      expect(m.after).toBeUndefined();
    }
  });

  it("the milestone window is the dashboard's", () => {
    expect(STATS_MILESTONE_DAYS).toBe(MILESTONE_WINDOW_DAYS);
  });
});

describe("the stats message", () => {
  const ok = { kind: "stats.metric", metric: "leads.open", date: "2026-11-30" };

  it("accepts a known metric on a real date, with or without a continuation", () => {
    for (const metric of STATS_METRICS) expect(isStatsMessage({ ...ok, metric })).toBe(true);
    expect(isStatsMessage({ ...ok, after: "plan-1" })).toBe(true);
  });

  it("refuses anything else, and tells a stats message of an unknown metric from a stranger", () => {
    for (const bad of [
      null,
      "x",
      {},
      { ...ok, kind: "lead.purge" },
      { ...ok, metric: "nope" },
      { ...ok, metric: 7 },
      { ...ok, date: "2026-02-30" },
      { ...ok, date: 20261130 },
      { ...ok, after: "" },
      { ...ok, after: "x".repeat(65) },
      { ...ok, after: 5 },
    ])
      expect(isStatsMessage(bad), JSON.stringify(bad)).toBe(false);
    expect(isStatsKind({ ...ok, metric: "future.metric" })).toBe(true);
    expect(isStatsKind({ kind: "lead.purge" })).toBe(false);
    expect(isStatsKind(null)).toBe(false);
  });
});
