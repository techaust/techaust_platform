// The SQL realisation dates and stages are a twin of the gst core's `realisationDates` and stage order [ADM-REP-07; M5.5b, LD75; VERIFY WITH CA/LEGAL]:
// the Workers may not run the core (SPA only), so SQLite works the dates out and this test proves the two agree: every issue date from 2026-01-01 to
// 2029-12-31 (the month-end clamps included) for INR and USD under three rule variants, and every stage on the days around each due and approaching date.
// The month clamping is checked here ON D1 (workerd), not only in Node's SQLite.
import { addDays, type CalendarDate, parseIsoDate, toIsoDate } from "@techaust/core/dates";
import {
  DEFAULT_REALISATION_RULES,
  type RealisationRules,
  realisationDates,
  realisationRulesOf,
  realisationStatus,
} from "@techaust/core/gst";
import { describe, expect, it } from "vitest";
import {
  ALERT_STAGE_LIST,
  ALERT_STAGES,
  addMonthsClampedSql,
  femaDueSql,
  gstDueSql,
  type RealisationSql,
  SCAN_BINDS,
  STAGE_BELL_KIND,
  settingsBinds,
  stageSql,
} from "../src/realisation.ts";
import { all } from "./helpers.ts";
import { putTax } from "./reports-helpers.ts";

const VARIANTS: { name: string; rules: RealisationRules }[] = [
  { name: "default (9, 12, 12 + 15)", rules: DEFAULT_REALISATION_RULES },
  {
    name: "6 foreign, 18 INR, 24 GST + 0, approaching 10",
    rules: {
      ...DEFAULT_REALISATION_RULES,
      femaMonthsForeign: 6,
      femaMonthsInr: 18,
      gstMonths: 24,
      gstExtraDays: 0,
      approachingDays: 10,
    },
  },
  {
    name: "12 foreign, 12 INR, 6 GST (before FEMA) + 30, approaching 45",
    rules: {
      ...DEFAULT_REALISATION_RULES,
      femaMonthsForeign: 12,
      femaMonthsInr: 12,
      gstMonths: 6,
      gstExtraDays: 30,
      approachingDays: 45,
    },
  },
];

const iso = (d: CalendarDate): string => toIsoDate(d);
const date = (s: string): CalendarDate => parseIsoDate(s) as CalendarDate;

/** The binds of `?1..?5` for a variant (the months and days; `today` is a column in these queries). */
const P: RealisationSql = { ...SCAN_BINDS, today: "t.today" };
const ruleBinds = (r: RealisationRules) => [
  r.femaMonthsForeign,
  r.femaMonthsInr,
  r.gstMonths,
  r.gstExtraDays,
  r.approachingDays,
];
// ?1 is left for a spare; ?2..?6 the rule values, as in SCAN_BINDS

describe("femaDue and gstDue, for every issue date of four years", () => {
  for (const { name, rules } of VARIANTS) {
    for (const currency of ["INR", "USD"] as const) {
      it(`${name}, ${currency}`, async () => {
        const rows = await all<{ issue_date: string; fema: string; gst: string }>(
          `WITH RECURSIVE n(x) AS (SELECT '2026-01-01' UNION ALL SELECT date(x, '+1 day') FROM n WHERE x < '2029-12-31')
           SELECT t.issue_date, ${femaDueSql("t", P)} AS fema, ${gstDueSql("t", P)} AS gst
           FROM (SELECT x AS issue_date, ?7 AS currency, '2026-01-01' AS today FROM n) t ORDER BY t.issue_date`,
          0,
          ...ruleBinds(rules),
          currency,
        );
        expect(rows).toHaveLength(1461);
        for (const r of rows) {
          const core = realisationDates(
            { invoiceDate: date(r.issue_date), currency, supplyType: "export_lut" },
            rules,
          );
          if (!core.ok) throw new Error(JSON.stringify(core.errors));
          if (iso(core.value.femaDue) !== r.fema || iso(core.value.gstDue) !== r.gst) {
            throw new Error(
              `${r.issue_date} ${currency}: SQL ${r.fema} ${r.gst}, core ${iso(core.value.femaDue)} ${iso(core.value.gstDue)}`,
            );
          }
        }
      });
    }
  }

  it("the month-end clamps on D1: 31 May + 9, 31 Aug + 6, 29 Feb 2028 + 12, 31 Jan + 1", async () => {
    const cases: [string, number, string][] = [
      ["2026-05-31", 9, "2027-02-28"],
      ["2026-08-31", 6, "2027-02-28"],
      ["2028-02-29", 12, "2029-02-28"],
      ["2027-01-31", 1, "2027-02-28"],
      ["2028-01-31", 1, "2028-02-29"],
      ["2026-10-15", 12, "2027-10-15"],
    ];
    for (const [from, months, expected] of cases) {
      const rows = await all<{ r: string }>(`SELECT ${addMonthsClampedSql("?1", "?2")} AS r`, from, months);
      expect(rows[0]?.r, `${from} + ${months}`).toBe(expected);
    }
  });
});

/** The issue dates sampled for the stages: every 11th day of four years, and the awkward ones. */
const ISSUE_DATES: string[] = (() => {
  const out: string[] = [];
  let d = date("2026-01-01");
  for (let i = 0; i < 1461; i += 11) {
    out.push(iso(d));
    d = addDays(d, 11);
  }
  return [
    ...out,
    "2026-05-31",
    "2026-08-31",
    "2026-10-01",
    "2026-11-30",
    "2027-01-31",
    "2028-02-29",
    "2028-08-31",
    "2029-12-31",
  ];
})();
const OFFSETS = [-46, -36, -31, -30, -29, -11, -10, -1, 0, 1, 2, 16, 36];

describe("the stage, on the days around every due and approaching date", () => {
  for (const { name, rules } of VARIANTS) {
    for (const [currency, supplyType] of [
      ["USD", "export_lut"],
      ["USD", "export_igst"],
      ["INR", "export_lut"],
      ["INR", "export_igst"],
    ] as const) {
      it(`${name}, ${currency} ${supplyType}`, async () => {
        const cases: { d: string; t: string; bal: number }[] = [];
        for (const issue of ISSUE_DATES) {
          const dates = realisationDates({ invoiceDate: date(issue), currency, supplyType }, rules);
          if (!dates.ok) throw new Error("dates");
          for (const anchor of [dates.value.femaDue, dates.value.gstDue]) {
            // M1: every offset, the due day itself included, with an open balance
            for (const o of OFFSETS) cases.push({ d: issue, t: iso(addDays(anchor, o)), bal: 1_000 });
            // realised: a balance of 0 or below is "realised" on any day, the due day and the day after included
            cases.push({ d: issue, t: iso(anchor), bal: 0 });
            cases.push({ d: issue, t: iso(addDays(anchor, 1)), bal: -1 });
          }
        }
        expect(cases.length).toBeGreaterThan(2_000);
        for (let at = 0; at < cases.length; at += 1_200) {
          const chunk = cases.slice(at, at + 1_200);
          const got = await all<{ i: number; stage: string }>(
            `SELECT t.i, ${stageSql("t", P)} AS stage
             FROM (SELECT j.key AS i, json_extract(j.value, '$.d') AS issue_date, json_extract(j.value, '$.t') AS today, json_extract(j.value, '$.bal') AS balance_minor, ?7 AS currency, ?8 AS supply_type
                   FROM json_each(?1) j) t ORDER BY t.i`,
            JSON.stringify(chunk),
            ...ruleBinds(rules),
            currency,
            supplyType,
          );
          expect(got).toHaveLength(chunk.length);
          for (const r of got) {
            const c = chunk[r.i] as { d: string; t: string; bal: number };
            const core = realisationStatus(
              { invoiceDate: date(c.d), currency, supplyType, outstandingMinor: c.bal },
              date(c.t),
              rules,
            );
            if (!core.ok) throw new Error(JSON.stringify(core.errors));
            if (c.bal <= 0 && r.stage !== "realised") throw new Error(`balance ${c.bal} is not realised`);
            if (c.bal > 0 && r.stage === "realised") throw new Error(`balance ${c.bal} is realised`);
            if (core.value.stage !== r.stage) {
              throw new Error(
                `${currency} ${supplyType} issued ${c.d} on ${c.t} (balance ${c.bal}): SQL ${r.stage}, core ${core.value.stage}`,
              );
            }
          }
        }
      });
    }
  }
});

describe("the settings expressions the dashboard uses", () => {
  it("read the tax row's values, or the defaults for a row without them, and give the same stage as the bound ones", async () => {
    await putTax({ realisation: { warnMonths: 6, inrMonths: 18, escalateMonths: 24, escalateExtraDays: 0 } });
    const p = settingsBinds("t.today");
    const rows = await all<{ fema: string; gst: string }>(
      `SELECT ${femaDueSql("t", p)} AS fema, ${gstDueSql("t", p)} AS gst FROM (SELECT '2026-11-03' AS issue_date, 'USD' AS currency, '2027-01-01' AS today) t`,
    );
    const core = realisationDates(
      { invoiceDate: date("2026-11-03"), currency: "USD", supplyType: "export_lut" },
      { ...DEFAULT_REALISATION_RULES, femaMonthsForeign: 6, gstMonths: 24, gstExtraDays: 0 },
    );
    expect(rows[0]).toEqual({
      fema: iso((core.ok && core.value.femaDue) as CalendarDate),
      gst: iso((core.ok && core.value.gstDue) as CalendarDate),
    });
    // H1: an INR export of 2026-11-03 with 18 months: core (rules made from the SETTINGS) and the SQL give the same FEMA due date
    const settingsRules = realisationRulesOf({
      warnMonths: 6,
      inrMonths: 18,
      escalateMonths: 24,
      escalateExtraDays: 0,
    });
    if (!settingsRules.ok) throw new Error("rules");
    const inrCore = realisationDates(
      { invoiceDate: date("2026-11-03"), currency: "INR", supplyType: "export_lut" },
      settingsRules.value,
    );
    const inrSql = await all<{ fema: string }>(
      `SELECT ${femaDueSql("t", p)} AS fema FROM (SELECT '2026-11-03' AS issue_date, 'INR' AS currency, '2027-01-01' AS today) t`,
    );
    expect(inrSql[0]?.fema).toBe("2028-05-03");
    expect(inrSql[0]?.fema).toBe(iso((inrCore.ok && inrCore.value.femaDue) as CalendarDate));
    // a row without the realisation keys: the defaults (9 months for USD, 12 for INR)
    await putTax({});
    const d = await all<{ fema: string; femaInr: string }>(
      `SELECT ${femaDueSql("a", p)} AS fema, ${femaDueSql("b", p)} AS femaInr
       FROM (SELECT '2026-11-03' AS issue_date, 'USD' AS currency) a, (SELECT '2026-11-03' AS issue_date, 'INR' AS currency) b, (SELECT '2027-01-01' AS today) t`,
    );
    expect(d[0]).toEqual({ fema: "2027-08-03", femaInr: "2027-11-03" });
  });

  it("the four alert stages and their bell kinds are fixed", () => {
    expect(ALERT_STAGE_LIST).toBe("'fema_approaching', 'fema_overdue', 'gst_approaching', 'gst_overdue'");
    expect([...ALERT_STAGES]).toEqual(["fema_approaching", "fema_overdue", "gst_approaching", "gst_overdue"]);
    expect(STAGE_BELL_KIND).toEqual({
      fema_approaching: "export.fema_approaching",
      fema_overdue: "export.fema_overdue",
      gst_approaching: "export.gst_approaching",
      gst_overdue: "export.gst_overdue",
    });
  });
});

describe("the alert scan's bound on the issue date never hides an export that is in an alert stage (L4)", () => {
  // The scan reads only exports with `issue_date < date(today, '+(approaching + 31) days', '-min(FEMA months) months')`. Any export in an alert stage must be inside it:
  // checked for every variant, both currencies and both supply types, for issue dates through four years (the month-end ones included), on the days where a stage
  // starts (femaDue - approaching, gstDue - approaching) and the days around them, and with today = femaDue - approaching exactly.
  for (const { name, rules } of VARIANTS) {
    it(name, async () => {
      const cases: { d: string; t: string; cur: string; sup: string }[] = [];
      for (const issue of ISSUE_DATES) {
        for (const cur of ["USD", "INR"] as const) {
          for (const sup of ["export_lut", "export_igst"] as const) {
            const dates = realisationDates(
              { invoiceDate: date(issue), currency: cur, supplyType: sup },
              rules,
            );
            if (!dates.ok) throw new Error("dates");
            for (const anchor of [dates.value.femaDue, dates.value.gstDue]) {
              for (const o of [
                -rules.approachingDays - 1,
                -rules.approachingDays,
                -rules.approachingDays + 1,
                0,
                1,
                2,
              ]) {
                cases.push({ d: issue, t: iso(addDays(anchor, o)), cur, sup });
              }
            }
          }
        }
      }
      const minMonths = Math.min(rules.femaMonthsForeign, rules.femaMonthsInr);
      let inStage = 0;
      for (let at = 0; at < cases.length; at += 1_500) {
        const chunk = cases.slice(at, at + 1_500);
        const got = await all<{ i: number; stage_in: number; bound_in: number }>(
          `SELECT t.i, (${stageSql("t", P)}) IN (${ALERT_STAGE_LIST}) AS stage_in,
                  t.issue_date < date(t.today, '+' || (?6 + 31) || ' days', '-' || ?7 || ' months') AS bound_in
           FROM (SELECT j.key AS i, json_extract(j.value, '$.d') AS issue_date, json_extract(j.value, '$.t') AS today, json_extract(j.value, '$.cur') AS currency,
                        json_extract(j.value, '$.sup') AS supply_type, 1000 AS balance_minor FROM json_each(?1) j) t`,
          JSON.stringify(chunk),
          ...ruleBinds(rules),
          minMonths,
        );
        for (const r of got) {
          if (r.stage_in === 1) inStage++;
          if (r.stage_in === 1 && r.bound_in !== 1) {
            const c = chunk[r.i] as (typeof chunk)[number];
            throw new Error(
              `${c.cur} ${c.sup} issued ${c.d}, today ${c.t}: in an alert stage but outside the scan's bound`,
            );
          }
        }
      }
      // the cases really do reach the alert stages (a test of nothing would pass too)
      expect(inStage).toBeGreaterThan(cases.length / 4);
    });
  }
});
