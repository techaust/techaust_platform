// M7.4 B.2: retention families and cut-offs [ADM-SET-09, NFR-9, JOB-CRON-01] (run file docs/runs/m7.4-data-protection.md, A.6, I; L34: 366-day floors).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fromIst } from "../src/dates.ts";
import {
  CLOCK_SKEW_MARGIN_MS,
  cutoffOf,
  cutoffsOf,
  FIGURE_FLOORS,
  FIXED_RETENTION,
  FLOORED_FAMILIES,
  isRetentionFamily,
  RETENTION_FAMILIES,
  RETENTION_MODES,
  type RetentionFamily,
  retentionLiveVerdict,
  TRIAL_REPORT_FRESH_SQL,
  TRIAL_REPORT_MAX_AGE_MS,
  TRIGGER_FLOOR_DAYS,
} from "../src/retention.ts";
import { RETENTION_FLOORS, SETTINGS_DEFAULTS } from "../src/schemas/settings.ts";

const DAY = 86_400_000;
const figures = { emailLogMonths: 13, securityLogMonths: 13, requestsMonths: 36, consentProofMonths: 36 };
const asOf = fromIst({ year: 2027, month: 6, day: 15 }, 3, 30); // 03:30 IST, the nightly run (22:00 UTC the day before)
const istMidnight = (y: number, m: number, d: number) => fromIst({ year: y, month: m, day: d });
const SETTING_FAMILIES = Object.keys(FLOORED_FAMILIES) as (keyof typeof FLOORED_FAMILIES)[];

describe("families and modes", () => {
  it("eleven families, every floored one among them", () => {
    expect(RETENTION_FAMILIES).toHaveLength(11);
    for (const f of SETTING_FAMILIES) expect(RETENTION_FAMILIES).toContain(f);
    expect(isRetentionFamily("bells")).toBe(true);
    expect(isRetentionFamily("documents")).toBe(false);
    expect(isRetentionFamily(null)).toBe(false);
    expect(RETENTION_MODES).toEqual(["dry_run", "live"]);
  });
  it("the figure floors follow the settings floors (A.8 adds the last two to RETENTION_FLOORS)", () => {
    expect(FIGURE_FLOORS.emailLogMonths).toBe(RETENTION_FLOORS.emailLogMonths);
    expect(FIGURE_FLOORS.securityLogMonths).toBe(RETENTION_FLOORS.securityLogMonths);
    expect(FIGURE_FLOORS.requestsMonths).toBe(12);
    expect(FIGURE_FLOORS.consentProofMonths).toBe(12);
    expect(TRIGGER_FLOOR_DAYS).toBe(366);
  });
});

describe("cutoffOf", () => {
  it("setting-driven families: the start of the IST day N calendar months back", () => {
    expect(cutoffOf("email_log", figures, asOf)).toEqual({ before: istMidnight(2026, 5, 15) });
    expect(cutoffOf("email_events", figures, asOf)).toEqual({ before: istMidnight(2026, 5, 15) });
    expect(cutoffOf("access_log", figures, asOf)).toEqual({ before: istMidnight(2026, 5, 15) });
    expect(cutoffOf("audit_ip", figures, asOf)).toEqual({ before: istMidnight(2026, 5, 15) });
    expect(cutoffOf("requests", figures, asOf)).toEqual({ before: istMidnight(2024, 6, 15) });
    expect(cutoffOf("consent", figures, asOf)).toEqual({ before: istMidnight(2024, 6, 15) });
  });
  it("12 months is held back to the 366-day floor and the clock margin (12 calendar months can be 365 days; L2)", () => {
    const twelve = { ...figures, emailLogMonths: 12, requestsMonths: 12, consentProofMonths: 12 };
    for (const f of ["email_log", "requests", "consent"] as const)
      expect(cutoffOf(f, twelve, asOf)).toEqual({ before: asOf - 366 * DAY - CLOCK_SKEW_MARGIN_MS });
    expect(CLOCK_SKEW_MARGIN_MS).toBe(3_600_000);
  });
  it("a figure below its floor reads at the floor; a malformed one throws", () => {
    expect(cutoffOf("access_log", { ...figures, securityLogMonths: 1 }, asOf)).toEqual(
      cutoffOf("access_log", figures, asOf),
    );
    expect(() => cutoffOf("email_log", { ...figures, emailLogMonths: 12.5 }, asOf)).toThrow(RangeError);
    expect(() => cutoffOf("consent", { ...figures, consentProofMonths: Number.NaN }, asOf)).toThrow(
      RangeError,
    );
    expect(() => cutoffOf("sessions", figures, -1)).toThrow(RangeError);
    expect(() => cutoffOf("sessions", figures, 1.5)).toThrow(RangeError);
    expect(() => cutoffOf("nope" as RetentionFamily, figures, asOf)).toThrow(RangeError);
  });
  it("fixed families", () => {
    expect(cutoffOf("sessions", figures, asOf)).toEqual({ before: asOf - 30 * DAY });
    expect(cutoffOf("counters", figures, asOf)).toEqual({ before: asOf - 2 * DAY });
    expect(cutoffOf("bells", figures, asOf)).toEqual({
      before: istMidnight(2026, 6, 15),
      readBefore: asOf - 90 * DAY,
    });
    expect(cutoffOf("stats", figures, asOf)).toEqual({ before: istMidnight(2025, 6, 15) });
    expect(cutoffOf("runs", figures, asOf)).toEqual({ before: istMidnight(2026, 5, 15) });
    expect(FIXED_RETENTION.sessionsDays).toBe(30);
  });
  it("cutoffsOf gives every family", () => {
    const all = cutoffsOf(figures, asOf);
    expect(Object.keys(all)).toEqual([...RETENTION_FAMILIES]);
    expect(all.counters).toEqual(cutoffOf("counters", figures, asOf));
  });
  it("property: no figure and no day brings a floored cut-off within 366 days (refused at 365, allowed at 367)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SETTING_FAMILIES),
        fc.integer({ min: -5, max: 600 }),
        fc.integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2045, 0, 1) }),
        (family, months, at) => {
          const f = {
            emailLogMonths: months,
            securityLogMonths: months,
            requestsMonths: months,
            consentProofMonths: months,
          };
          const { before } = cutoffOf(family, f, at);
          // a row 365 days old is never due; one older than the cut-off is
          expect(before).toBeLessThanOrEqual(at - TRIGGER_FLOOR_DAYS * DAY - CLOCK_SKEW_MARGIN_MS);
          expect(at - 365 * DAY >= before).toBe(true);
          // and a high figure is exactly N months back
          if (months >= 24) expect(before).toBeLessThan(at - 700 * DAY);
        },
      ),
    );
  });
  it("defaults: the settings defaults give 13-month logs", () => {
    const d = SETTINGS_DEFAULTS.retention;
    const f = { ...figures, emailLogMonths: d.emailLogMonths, securityLogMonths: d.securityLogMonths };
    expect(cutoffOf("email_log", f, asOf).before).toBe(istMidnight(2026, 5, 15));
  });
});

describe("retentionLiveVerdict (Q1 A, C.7)", () => {
  const now = asOf;
  it("needs a finished dry run within 7 days", () => {
    expect(retentionLiveVerdict({ lastDryRun: null, now })).toBe("no_trial_report");
    expect(retentionLiveVerdict({ lastDryRun: { finishedAt: null }, now })).toBe("no_trial_report");
    expect(retentionLiveVerdict({ lastDryRun: { finishedAt: 1.5 }, now })).toBe("no_trial_report");
    expect(retentionLiveVerdict({ lastDryRun: { finishedAt: now - DAY }, now })).toBe("ok");
    expect(retentionLiveVerdict({ lastDryRun: { finishedAt: now - TRIAL_REPORT_MAX_AGE_MS }, now })).toBe(
      "ok",
    );
    expect(retentionLiveVerdict({ lastDryRun: { finishedAt: now - TRIAL_REPORT_MAX_AGE_MS - 1 }, now })).toBe(
      "trial_report_stale",
    );
  });
  it("the SQL twin reads finished dry runs within the same window", () => {
    const sql = TRIAL_REPORT_FRESH_SQL("?4");
    expect(sql).toContain("mode = 'dry_run'");
    expect(sql).toContain("finished_at IS NOT NULL");
    expect(sql).toContain(`(?4) - ${TRIAL_REPORT_MAX_AGE_MS}`);
  });
});
