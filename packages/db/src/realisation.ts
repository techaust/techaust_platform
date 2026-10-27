// Export realisation dates and stages in SQL (M5.5b, LD75; ADM-REP-07, docs/08-A §8): the Workers (the alert scan, the dashboard) may not run the gst core
// (SPA only, LD16), so the FEMA and GST due dates and the stage of an export invoice are worked out here, in SQLite, and PROVED equal to core's
// `realisationDates` and stage order by a property test (`packages/db/test/realisation-twin.test.ts`), the way `CREDITED_SO_FAR_SQL` is.
// VERIFY WITH CA/LEGAL, all of it (FEMA 2026 as amended 22 Sep 2026; GST Rule 96A(1)(b); Q15, Q53):
//   femaDue = issue date + 9 months (a foreign currency) or 12 months (INR), clamped to the end of a shorter month (31 May + 9 months = 28 or 29 Feb);
//   gstDue  = max(issue date + 12 months, femaDue) + 15 days (Rule 96A), a stage only for an export under LUT (Q53);
//   both are the LAST allowed day: overdue is the day after, "approaching" starts `approachingDays` before.
// The months and days are SQL expressions given by the caller (a bound `?3`, or a subquery on the settings row), never pasted values.
// No FEMA extension exists before M6.1 (Q60): the standard date is the only one.

/** The SQL expressions (usually `?n` placeholders) of the rule parameters and of today (IST, ISO date text). */
export type RealisationSql = {
  readonly foreignMonths: string;
  readonly inrMonths: string;
  readonly gstMonths: string;
  readonly gstExtraDays: string;
  readonly approachingDays: string;
  readonly today: string;
};

/** The numbering of the scan statement: today, then the five rule values (`?7`, the smaller FEMA period, only bounds the read). */
export const SCAN_BINDS: RealisationSql = Object.freeze({
  today: "?1",
  foreignMonths: "?2",
  inrMonths: "?3",
  gstMonths: "?4",
  gstExtraDays: "?5",
  approachingDays: "?6",
});

/** `date + months` clamped to the last day of the target month, as ISO text: the twin of core `addMonthsClamped`. */
export const addMonthsClampedSql = (date: string, months: string): string =>
  `min(date(${date}, '+' || ${months} || ' months'), date(${date}, 'start of month', '+' || (${months} + 1) || ' months', '-1 day'))`;

/** The FEMA due date of an export invoice row `alias` (columns `issue_date` and `currency`). */
export const femaDueSql = (alias: string, p: RealisationSql): string =>
  `CASE WHEN ${alias}.currency = 'INR' THEN ${addMonthsClampedSql(`${alias}.issue_date`, p.inrMonths)} ELSE ${addMonthsClampedSql(`${alias}.issue_date`, p.foreignMonths)} END`;

/** The GST due date (Rule 96A) of the same row: the later of 12 months and the FEMA date, plus the extra days. Worked out for every export (the CSV shows it); the STAGE uses it for LUT exports only. */
export const gstDueSql = (alias: string, p: RealisationSql): string =>
  `date(max(${addMonthsClampedSql(`${alias}.issue_date`, p.gstMonths)}, ${femaDueSql(alias, p)}), '+' || ${p.gstExtraDays} || ' days')`;

/**
 * The stage of an export invoice row `alias` (columns `issue_date`, `currency`, `supply_type`, `balance_minor`) on `p.today`, first match wins, as core `stageOf`:
 * realised (nothing outstanding), GST overdue, GST approaching, FEMA overdue, FEMA approaching, ok. The GST stages only when `supply_type = 'export_lut'` (Q53).
 */
export const stageSql = (alias: string, p: RealisationSql): string => {
  const fema = femaDueSql(alias, p);
  const gst = gstDueSql(alias, p);
  const lut = `${alias}.supply_type = 'export_lut'`;
  return `CASE
    WHEN ${alias}.balance_minor <= 0 THEN 'realised'
    WHEN ${lut} AND ${p.today} > ${gst} THEN 'gst_overdue'
    WHEN ${lut} AND ${p.today} >= date(${gst}, '-' || ${p.approachingDays} || ' days') THEN 'gst_approaching'
    WHEN ${p.today} > ${fema} THEN 'fema_overdue'
    WHEN ${p.today} >= date(${fema}, '-' || ${p.approachingDays} || ' days') THEN 'fema_approaching'
    ELSE 'ok' END`;
};

/** The four stages that ring a bell and send an email (the others are quiet). */
export const ALERT_STAGES = ["fema_approaching", "fema_overdue", "gst_approaching", "gst_overdue"] as const;
export type AlertStage = (typeof ALERT_STAGES)[number];

/** `'a', 'b'` for an SQL list of the alert stages. */
export const ALERT_STAGE_LIST = ALERT_STAGES.map((s) => `'${s}'`).join(", ");

/**
 * The bell kind of each alert stage (07-V names the titles): the entity of a bell is the export invoice's id, the (user, kind, entity) triple is unique, so
 * a stage rings once per owner (Q54).
 */
export const STAGE_BELL_KIND: Readonly<Record<AlertStage, string>> = Object.freeze({
  fema_approaching: "export.fema_approaching",
  fema_overdue: "export.fema_overdue",
  gst_approaching: "export.gst_approaching",
  gst_overdue: "export.gst_overdue",
});

/**
 * The settings expressions the dashboard uses, so its stage statements need no earlier read: the `tax` row's values, with the defaults for a missing key
 * (9, 12, 12, 15 and 30 days). A value that is not valid is caught by the route, which reads the same row with `realisationParamsFromStoredTax` in the
 * same batch and withholds the tile's export figures when it says `{ ok: false }`.
 */
const taxValue = (path: string, fallback: number): string =>
  `coalesce((SELECT json_extract(s.value, '${path}') FROM settings s WHERE s.key = 'tax'), ${fallback})`;
export const settingsBinds = (todayExpr: string): RealisationSql => ({
  today: todayExpr,
  foreignMonths: taxValue("$.realisation.warnMonths", 9),
  inrMonths: taxValue("$.realisation.inrMonths", 12),
  gstMonths: taxValue("$.realisation.escalateMonths", 12),
  gstExtraDays: taxValue("$.realisation.escalateExtraDays", 15),
  approachingDays: "30",
});
