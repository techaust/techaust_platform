// Export realisation dates and stages in SQL (M5.5b, LD75; ADM-REP-07, docs/08-A §8): the Workers (the alert scan, the dashboard) may not run the gst core
// (SPA only, LD16), so the FEMA and GST due dates and the stage of an export invoice are worked out here, in SQLite, and PROVED equal to core's
// `realisationDates` and stage order by a property test (`packages/db/test/realisation-twin.test.ts`), the way `CREDITED_SO_FAR_SQL` is.
// Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 5(1) (08-C RB-01), all of it (FEMA 2026 as amended 22 Sep 2026; GST Rule 96A(1)(b); Q15, Q53):
//   femaDue = issue date + 9 months (a foreign currency) or 12 months (INR), clamped to the end of a shorter month (31 May + 9 months = 28 or 29 Feb);
//   gstDue  = max(issue date + 12 months, femaDue) + 15 days (Rule 96A), a stage only for an export under LUT (Q53);
//   both are the LAST allowed day: overdue is the day after, "approaching" starts `approachingDays` before.
// The months and days are SQL expressions given by the caller (a bound `?3`, or a subquery on the settings row), never pasted values.
// M6.1 (Q60, L14): the AD bank may extend the FEMA period (`realisation_extensions`, append-only); the FEMA date is then the later of the standard date and the
// latest `extended_to` of the invoice, and the GST date follows it (Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 5(1) (08-C RB-04); Rule 96A(1)(b) CGST Rules
// (08-C RA-20)). The twin is core `realisationDates` with `extendedTo`.
// M6.5: two more facts decide "realised" (core `stageOf` with its `fema` facts is the twin):
//   - RB-43 (Settled by the lead on the safest reading, 2026-11-03 (08-C RB-43)): an export is FEMA-realised only once what was paid on it (its `paid_minor`, net of
//     any refund's release) plus the AD bank's Reg. 6 reductions (`realisation_reductions`) covers its total; nothing outstanding but less received is the stage
//     `reduction_pending`. The GST stage keeps following the balance (Rule 96A not re-read for this point).
//   - RA-38 (Settled by the lead on the safest reading, 2026-11-02 (08-C RA-38); L38): an export under LUT is realised for GST only when every confirmed card or
//     PayPal payment on it (Stripe, PayPal) has its proof: a proof file, or a link to a remittance advice now (`paymentHasAdviceSql`). Until then its GST stages
//     still run on its dates (an IGST-with-interest risk at the GST date), and it is `ok` before them.
import { paymentHasAdviceSql, paymentNetSql } from "./sql-rules.ts";

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

/** The standard FEMA due date of an export invoice row `alias` (columns `issue_date` and `currency`), before any extension. */
export const femaStandardSql = (alias: string, p: RealisationSql): string =>
  `CASE WHEN ${alias}.currency = 'INR' THEN ${addMonthsClampedSql(`${alias}.issue_date`, p.inrMonths)} ELSE ${addMonthsClampedSql(`${alias}.issue_date`, p.foreignMonths)} END`;

/**
 * The FEMA due date of an export invoice row `alias` (columns `id`, `issue_date` and `currency`): the later of the standard date and the latest extension the
 * bank granted (a correlated `max` over `realisation_extensions_document (document_id, extended_to)`, one index seek; '' when there is none, which every
 * ISO date is after). SQLite's two-argument `max` is NULL when either is NULL, hence the `coalesce`.
 */
export const femaDueSql = (alias: string, p: RealisationSql): string =>
  `max(${femaStandardSql(alias, p)}, coalesce((SELECT max(x.extended_to) FROM realisation_extensions x WHERE x.document_id = ${alias}.id), ''))`;

/** The GST due date (Rule 96A) of the same row: the later of 12 months and the FEMA date, plus the extra days. Worked out for every export (the CSV shows it); the STAGE uses it for LUT exports only. */
export const gstDueSql = (alias: string, p: RealisationSql): string =>
  `date(max(${addMonthsClampedSql(`${alias}.issue_date`, p.gstMonths)}, ${femaDueSql(alias, p)}), '+' || ${p.gstExtraDays} || ' days')`;

/** RB-43: Σ the AD bank's Reg. 6 reductions of export invoice row `alias` (one seek of `realisation_reductions_document`). */
export const reductionsSql = (alias: string): string =>
  `(SELECT coalesce(sum(rr.amount_minor), 0) FROM realisation_reductions rr WHERE rr.document_id = ${alias}.id)`;

/**
 * RA-38 (L38): a confirmed card or PayPal payment (Stripe, PayPal) that holds money on export invoice row `alias` has no proof yet: no proof file and no advice
 * link now. One seek of `payment_allocations_document`, a primary-key read of each payment and a seek of `realisation_advice_payments_active`.
 */
export const proofMissingSql = (alias: string): string =>
  `EXISTS (SELECT 1 FROM payment_allocations ra INDEXED BY payment_allocations_document JOIN payments rp ON rp.id = ra.payment_id
     WHERE ra.document_id = ${alias}.id AND ra.kind = 'allocate' AND rp.status = 'confirmed' AND rp.kind = 'payment' AND rp.provider IN ('stripe', 'paypal')
       AND rp.proof_r2_key IS NULL AND NOT ${paymentHasAdviceSql("rp")} AND ${paymentNetSql("rp.id", `${alias}.id`)} > 0)`;

/**
 * The stage of an export invoice row `alias` (columns `id`, `issue_date`, `currency`, `supply_type`, `balance_minor`, `paid_minor`, `total_minor`) on `p.today`,
 * first match wins, as core `stageOf`: reduction pending (nothing outstanding, but paid plus reductions short of the total: RB-43), realised (nothing outstanding,
 * and for an LUT export every card or PayPal payment on it proven: RA-38), GST overdue, GST approaching (an LUT export only, Q53), FEMA overdue, FEMA approaching
 * (something outstanding), ok. Each stage's literal appears once, so a test reads the order from the text.
 */
export const stageSql = (alias: string, p: RealisationSql): string => {
  const fema = femaDueSql(alias, p);
  const gst = gstDueSql(alias, p);
  const lut = `${alias}.supply_type = 'export_lut'`;
  const settled = `${alias}.balance_minor <= 0`;
  return `CASE
    WHEN ${settled} AND ${alias}.paid_minor + ${reductionsSql(alias)} < ${alias}.total_minor THEN 'reduction_pending'
    WHEN ${settled} AND NOT (${lut} AND ${proofMissingSql(alias)}) THEN 'realised'
    WHEN ${lut} AND ${p.today} > ${gst} THEN 'gst_overdue'
    WHEN ${lut} AND ${p.today} >= date(${gst}, '-' || ${p.approachingDays} || ' days') THEN 'gst_approaching'
    WHEN ${alias}.balance_minor > 0 AND ${p.today} > ${fema} THEN 'fema_overdue'
    WHEN ${alias}.balance_minor > 0 AND ${p.today} >= date(${fema}, '-' || ${p.approachingDays} || ' days') THEN 'fema_approaching'
    ELSE 'ok' END`;
};

/**
 * M6.5: the exports a stage reader must look at beyond those with a balance: an LUT export may still be in a GST stage until its card or PayPal proof is on file
 * (RA-38), and a fully settled export short of its total waits for its reduction (RB-43). The readers (scan, counts, next) take `balance_minor > 0` OR this.
 */
export const stageOpenSql = (alias: string): string =>
  `(${alias}.balance_minor > 0 OR ${alias}.supply_type = 'export_lut' OR ${alias}.paid_minor < ${alias}.total_minor)`;

/**
 * Every stage `stageSql` can give, in its order (core `RealisationStage`; a db test pins the list to the `THEN` literals of `stageSql` and to core's type). The
 * dashboard's stage counts (`EXPORT_STAGE_COUNTS_SQL`) have one column per stage in this list.
 */
export const EXPORT_STAGES = [
  "reduction_pending",
  "realised",
  "gst_overdue",
  "gst_approaching",
  "fema_overdue",
  "fema_approaching",
  "ok",
] as const;

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
