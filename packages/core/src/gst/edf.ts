// The monthly Export Declaration Form (EDF) working list (M5.5a; ADM-REP-07, docs/08-A §8). VERIFY WITH CA/LEGAL: under the
// FEMA 2026 regulations an exporter of services gives the AD bank an EDF within 30 days from the end of the month of the
// invoice (UNVERIFIED whether one EDF may cover a whole month: secondary sources). This is OUR list for the bank
// conversation, not the bank's form. All payment rails are included (Q16). Export credit notes are not included (VERIFY).
import { addDays, type CalendarDate, isValidDate } from "../dates.ts";
import { lastDayOfMonth } from "./period.ts";
import {
  DEFAULT_REALISATION_RULES,
  dueDatesOf,
  type RealisationRules,
  rulesAreValid,
} from "./realisation.ts";
import {
  type Currency,
  compareDates,
  compareText,
  fail,
  type GstIssue,
  type GstResult,
  type GstWarning,
  guard,
  isIntBetween,
  isNonNegInt,
  issue,
  ok,
  type RegisterRow,
} from "./types.ts";

/** The days after the end of the month in which the EDF is due. */
export const EDF_DAYS_AFTER_MONTH = 30;

export type EdfMonth = { readonly from: CalendarDate; readonly to: CalendarDate; readonly due: CalendarDate };

/** The first and last day of the invoice month, and the EDF due date (the last day plus 30 days). */
export function edfMonth(year: number, month: number): GstResult<EdfMonth> {
  return guard(() => {
    if (!isIntBetween(year, 1, 9999) || !isIntBetween(month, 1, 12)) {
      return fail([issue("period_invalid", "period")]);
    }
    const to = { year, month, day: lastDayOfMonth(year, month) };
    return ok({ from: { year, month, day: 1 }, to, due: addDays(to, EDF_DAYS_AFTER_MONTH) });
  });
}

export type EdfRow = {
  readonly id: string;
  readonly number: string;
  readonly issueDate: CalendarDate;
  readonly clientName: string;
  readonly clientAddress: string | null;
  /** ISO 3166 alpha-2. */
  readonly countryCode: string | null;
  readonly currency: Currency;
  readonly totalMinor: number;
  readonly fxRateMicros: number | null;
  readonly inrValueMinor: number;
  /** The distinct SACs of the invoice, joined with "; ". */
  readonly sac: string;
  /** Their descriptions (from `sacDescriptions`), joined with "; "; blank where unknown. */
  readonly description: string;
  readonly purposeCode: string | null;
  readonly femaDue: CalendarDate;
  readonly edfDue: CalendarDate;
};

export type EdfOptions = {
  readonly rules?: RealisationRules;
  readonly sacDescriptions?: Readonly<Record<string, string>>;
};

/** Every non-voided export invoice dated in the month, oldest first. A USD invoice without an exchange rate is `fx_missing`. */
export function edfRows(
  register: readonly RegisterRow[],
  year: number,
  month: number,
  options: EdfOptions = {},
): GstResult<readonly EdfRow[]> {
  return guard(() => {
    const m = edfMonth(year, month);
    if (!m.ok) return m;
    const rules = options.rules ?? DEFAULT_REALISATION_RULES;
    if (!rulesAreValid(rules)) return fail([issue("rules_invalid", "rules")]);
    const descriptions = options.sacDescriptions ?? {};
    const errors: GstIssue[] = [];
    const warnings: GstWarning[] = [];
    const rows: EdfRow[] = [];
    for (const row of register) {
      if (row.kind !== "export_invoice" || row.voided) continue;
      const at = [row.id];
      if (!isValidDate(row.issueDate)) {
        errors.push({ code: "date_invalid", path: at });
        continue;
      }
      if (compareDates(row.issueDate, m.value.from) < 0 || compareDates(row.issueDate, m.value.to) > 0)
        continue;
      if (!isNonNegInt(row.totalMinor) || !isNonNegInt(row.totalInrMinor)) {
        errors.push({ code: "amount_invalid", path: at });
        continue;
      }
      if (row.currency !== "INR" && row.fxRateMicros === null) {
        errors.push({ code: "fx_missing", path: at });
        continue;
      }
      if (row.fxRateMicros !== null && !(isNonNegInt(row.fxRateMicros) && row.fxRateMicros > 0)) {
        errors.push({ code: "amount_invalid", path: at });
        continue;
      }
      const dates = dueDatesOf({ invoiceDate: row.issueDate, currency: row.currency }, rules);
      if (compareDates(row.issueDate, rules.rulesFrom) < 0)
        warnings.push({ code: "before_fema_2026", path: at });
      const sacs = [...new Set(row.rates.map((r) => r.sac).filter((s): s is string => s !== null))].sort(
        compareText,
      );
      rows.push({
        id: row.id,
        number: row.number,
        issueDate: row.issueDate,
        clientName: row.recipient.name,
        clientAddress: row.recipient.address,
        countryCode: row.recipient.countryCode,
        currency: row.currency,
        totalMinor: row.totalMinor,
        fxRateMicros: row.fxRateMicros,
        inrValueMinor: row.totalInrMinor,
        sac: sacs.join("; "),
        description: sacs
          .map((s) => (Object.hasOwn(descriptions, s) ? (descriptions[s] as string) : ""))
          .join("; "),
        purposeCode: row.purposeCode,
        femaDue: dates.femaDue,
        edfDue: m.value.due,
      });
    }
    if (errors.length > 0) return fail(errors);
    rows.sort((a, b) => compareDates(a.issueDate, b.issueDate) || compareText(a.number, b.number));
    return ok(rows, warnings);
  });
}
