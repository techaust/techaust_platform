// Export realisation dates and stages (M5.5a; ADM-REP-07, docs/08-A §8). VERIFY WITH CA/LEGAL, all of it:
// - FEMA (Export and Import of Goods and Services) Regulations 2026 as amended 22 Sep 2026, in force 1 Oct 2026: 9 months from
//   the invoice date for services, 12 months if invoiced or settled in INR (docs/08 U-2);
// - GST Rule 96A(1)(b): IGST with interest within 15 days after one year from the invoice date, or the FEMA period with any
//   RBI extension, whichever is later.
// Both dates are the LAST ALLOWED day ("overdue" starts the day after); a month that is too short is clamped to its last
// day (31 May + 9 months = 28 or 29 February). Pure: `today` is always passed in.
import { addDays, type CalendarDate, isValidDate } from "../dates.ts";
import { addMonthsClamped } from "./period.ts";
import {
  type Currency,
  compareDates,
  compareText,
  fail,
  type GstIssue,
  type GstResult,
  type GstWarning,
  guard,
  isInt,
  isIntBetween,
  issue,
  ok,
  type RegisterRow,
  type SupplyType,
  warn,
} from "./types.ts";

export type RealisationRules = {
  /** FEMA months for an invoice in a foreign currency. */
  readonly femaMonthsForeign: number;
  /** FEMA months for an invoice in INR (`tax.realisation.inrMonths`). */
  readonly femaMonthsInr: number;
  readonly gstMonths: number;
  readonly gstExtraDays: number;
  /** How many days before a due date the stage turns to "approaching". */
  readonly approachingDays: number;
  /** The day the FEMA 2026 rules start: an invoice before it carries the warning `before_fema_2026`. */
  readonly rulesFrom: CalendarDate;
};

export const DEFAULT_REALISATION_RULES: RealisationRules = Object.freeze({
  femaMonthsForeign: 9,
  femaMonthsInr: 12,
  gstMonths: 12,
  gstExtraDays: 15,
  approachingDays: 30,
  rulesFrom: Object.freeze({ year: 2026, month: 10, day: 1 }),
});

/** The settings (`tax.realisation`) that map onto the rules. */
export type RealisationSettings = {
  readonly warnMonths: number;
  /** FEMA months for an invoice in INR (`tax.realisation.inrMonths`); missing is the default, 12 (an older caller). */
  readonly inrMonths?: number | undefined;
  readonly escalateMonths: number;
  readonly escalateExtraDays: number;
};

export const rulesAreValid = (r: RealisationRules): boolean =>
  isIntBetween(r.femaMonthsForeign, 1, 1200) &&
  isIntBetween(r.femaMonthsInr, 1, 1200) &&
  isIntBetween(r.gstMonths, 1, 1200) &&
  isIntBetween(r.gstExtraDays, 0, 36_500) &&
  isIntBetween(r.approachingDays, 0, 36_500) &&
  isValidDate(r.rulesFrom);

/** The rules from the settings: `warnMonths` is the FEMA period, `escalateMonths` and `escalateExtraDays` the GST one. */
export function realisationRulesOf(settings: RealisationSettings): GstResult<RealisationRules> {
  return guard(() => {
    const rules: RealisationRules = {
      ...DEFAULT_REALISATION_RULES,
      femaMonthsForeign: settings.warnMonths,
      femaMonthsInr: settings.inrMonths ?? DEFAULT_REALISATION_RULES.femaMonthsInr,
      gstMonths: settings.escalateMonths,
      gstExtraDays: settings.escalateExtraDays,
    };
    return rulesAreValid(rules) ? ok(rules) : fail([issue("rules_invalid", "rules")]);
  });
}

export type RealisationInput = {
  readonly invoiceDate: CalendarDate;
  readonly currency: Currency;
  /**
   * Rule 96A (the GST escalation) applies to an export under LUT only (08-A :350; Q53, VERIFY WITH CA/LEGAL): an export with
   * IGST paid moves through the FEMA stages alone. `gstDue` is still worked out for every export (it is in the CSV).
   */
  readonly supplyType: SupplyType;
  /** The FEMA due date as extended by the bank or RBI, if any: it replaces the computed one. */
  readonly extension?: { readonly femaDue?: CalendarDate } | undefined;
};

export type RealisationDates = { readonly femaDue: CalendarDate; readonly gstDue: CalendarDate };

export type RealisationStage =
  | "realised"
  | "gst_overdue"
  | "gst_approaching"
  | "fema_overdue"
  | "fema_approaching"
  | "ok";

const issuesOf = (
  input: RealisationInput,
  rules: RealisationRules,
  path: (string | number)[],
): GstIssue[] => {
  const out: GstIssue[] = [];
  if (!rulesAreValid(rules)) out.push(issue("rules_invalid", ...path, "rules"));
  if (!isValidDate(input.invoiceDate)) out.push(issue("date_invalid", ...path));
  const extended = input.extension?.femaDue;
  if (extended !== undefined && !isValidDate(extended)) out.push(issue("date_invalid", ...path, "extension"));
  return out;
};

/** The due dates, with the input and the rules already checked (a caller that has not checked them uses `realisationDates`). */
export function dueDatesOf(input: RealisationInput, rules: RealisationRules): RealisationDates {
  const femaMonths = input.currency === "INR" ? rules.femaMonthsInr : rules.femaMonthsForeign;
  const femaDue = input.extension?.femaDue ?? addMonthsClamped(input.invoiceDate, femaMonths);
  const gstBase = addMonthsClamped(input.invoiceDate, rules.gstMonths);
  const later = compareDates(gstBase, femaDue) >= 0 ? gstBase : femaDue;
  return { femaDue, gstDue: addDays(later, rules.gstExtraDays) };
}

/**
 * The one input check and the one `before_fema_2026` warning of every report (the realisation report, the EDF and the dates):
 * the due dates of one export invoice, every path starting at `path`. Not wrapped by `guard`: its callers are.
 */
export function checkedDueDates(
  input: RealisationInput,
  rules: RealisationRules,
  path: readonly (string | number)[],
): GstResult<RealisationDates> {
  const found = issuesOf(input, rules, [...path]);
  if (found.length > 0) return fail(found);
  const warnings: GstWarning[] = [];
  if (compareDates(input.invoiceDate, rules.rulesFrom) < 0) warnings.push(warn("before_fema_2026", ...path));
  return ok(dueDatesOf(input, rules), warnings);
}

/** The FEMA and GST due dates (last allowed days) of one export invoice. */
export function realisationDates(
  input: RealisationInput,
  rules: RealisationRules = DEFAULT_REALISATION_RULES,
): GstResult<RealisationDates> {
  return guard(() => checkedDueDates(input, rules, []));
}

/** The stage on `today`, first match wins: realised, GST overdue, GST approaching, FEMA overdue, FEMA approaching, ok. */
export function stageOf(
  dates: RealisationDates,
  outstandingMinor: number,
  today: CalendarDate,
  approachingDays: number,
  /** False for an export with IGST paid (Q53): the GST stages are skipped. */
  gstApplies = true,
): RealisationStage {
  if (outstandingMinor <= 0) return "realised";
  if (gstApplies && compareDates(today, dates.gstDue) > 0) return "gst_overdue";
  if (gstApplies && compareDates(today, addDays(dates.gstDue, -approachingDays)) >= 0) {
    return "gst_approaching";
  }
  if (compareDates(today, dates.femaDue) > 0) return "fema_overdue";
  if (compareDates(today, addDays(dates.femaDue, -approachingDays)) >= 0) return "fema_approaching";
  return "ok";
}

export type RealisationStatus = RealisationDates & { readonly stage: RealisationStage };

/** The due dates and the stage of one invoice on `today`. `outstandingMinor` is in the invoice currency. */
export function realisationStatus(
  input: RealisationInput & { readonly outstandingMinor: number },
  today: CalendarDate,
  rules: RealisationRules = DEFAULT_REALISATION_RULES,
): GstResult<RealisationStatus> {
  return guard(() => {
    const dates = checkedDueDates(input, rules, []);
    const found: GstIssue[] = dates.ok ? [] : [...dates.errors];
    if (!isValidDate(today)) found.push(issue("date_invalid", "today"));
    if (!isInt(input.outstandingMinor)) found.push(issue("amount_invalid", "outstandingMinor"));
    if (!dates.ok || found.length > 0) return fail(found);
    const gstApplies = input.supplyType === "export_lut";
    return ok(
      {
        ...dates.value,
        stage: stageOf(dates.value, input.outstandingMinor, today, rules.approachingDays, gstApplies),
      },
      dates.warnings,
    );
  });
}

export type RealisationRow = {
  readonly id: string;
  readonly number: string;
  readonly issueDate: CalendarDate;
  readonly clientName: string;
  readonly currency: Currency;
  readonly outstandingMinor: number;
  readonly femaDue: CalendarDate;
  readonly gstDue: CalendarDate;
  readonly stage: RealisationStage;
};

/**
 * The realisation report: every non-voided export invoice (realised ones included, with the stage "realised"), oldest first,
 * as of `today`. `extensions` holds the FEMA due dates extended by the bank, by document id.
 */
export function realisationRows(
  register: readonly RegisterRow[],
  today: CalendarDate,
  rules: RealisationRules = DEFAULT_REALISATION_RULES,
  extensions: Readonly<Record<string, { readonly femaDue?: CalendarDate }>> = {},
): GstResult<readonly RealisationRow[]> {
  return guard(() => {
    const errors: GstIssue[] = [];
    const warnings: GstWarning[] = [];
    const rows: RealisationRow[] = [];
    if (!isValidDate(today)) errors.push(issue("date_invalid", "today"));
    if (!rulesAreValid(rules)) errors.push(issue("rules_invalid", "rules"));
    if (errors.length > 0) return fail(errors);
    for (const row of register) {
      if (row.kind !== "export_invoice" || row.voided) continue;
      const extension = Object.hasOwn(extensions, row.id) ? extensions[row.id] : undefined;
      const r = realisationStatus(
        {
          invoiceDate: row.issueDate,
          currency: row.currency,
          supplyType: row.supplyType,
          extension,
          outstandingMinor: row.outstandingMinor,
        },
        today,
        rules,
      );
      if (!r.ok) {
        errors.push(...r.errors.map((e) => ({ code: e.code, path: [row.id, ...e.path] })));
        continue;
      }
      for (const w of r.warnings) warnings.push({ code: w.code, path: [row.id] });
      rows.push({
        id: row.id,
        number: row.number,
        issueDate: row.issueDate,
        clientName: row.recipient.name,
        currency: row.currency,
        outstandingMinor: row.outstandingMinor,
        femaDue: r.value.femaDue,
        gstDue: r.value.gstDue,
        stage: r.value.stage,
      });
    }
    if (errors.length > 0) return fail(errors);
    rows.sort((a, b) => compareDates(a.issueDate, b.issueDate) || compareText(a.number, b.number));
    return ok(rows, warnings);
  });
}
