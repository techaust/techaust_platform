// The monthly Export Declaration Form (EDF) working list (M5.5a; ADM-REP-07, docs/08-A §8). Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 3(2) (08-C RB-03): under the
// FEMA 2026 regulations an exporter of services gives the AD bank an EDF within 30 days from the end of the month of the
// invoice; one EDF may cover all the exports of the month (08-C RB-03). OPEN (08-C RB-03): the bank's own form and channel. This is OUR list for the bank
// conversation, not the bank's form. All payment rails are included (Q16). Export credit notes are not included (no 08-C row covers them).
import { addDays, type CalendarDate, isValidDate } from "../dates.ts";
import { lastDayOfMonth } from "./period.ts";
import {
  checkedDueDates,
  DEFAULT_REALISATION_RULES,
  type RealisationRules,
  rulesAreValid,
} from "./realisation.ts";
import {
  type Currency,
  compareDates,
  compareDocNumbers,
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
  /** FEMA due dates extended by the bank, by document id: the same input as `realisationRows`, so the two reports agree. */
  readonly extensions?: Readonly<Record<string, { readonly femaDue?: CalendarDate }>>;
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
    const extensions = options.extensions ?? {};
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
      const extension = Object.hasOwn(extensions, row.id) ? extensions[row.id] : undefined;
      // the shared input check and `before_fema_2026` warning of the realisation report
      const dates = checkedDueDates(
        {
          invoiceDate: row.issueDate,
          currency: row.currency,
          supplyType: row.supplyType,
          extension,
          extendedTo: row.extendedTo ?? undefined,
        },
        rules,
        at,
      );
      if (!dates.ok) {
        errors.push(...dates.errors);
        continue;
      }
      warnings.push(...dates.warnings);
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
        femaDue: dates.value.femaDue,
        edfDue: m.value.due,
      });
    }
    if (errors.length > 0) return fail(errors);
    // date, number in issue order ("/10" after "/9", FX-4 review L3), id
    rows.sort(
      (a, b) =>
        compareDates(a.issueDate, b.issueDate) ||
        compareDocNumbers(a.number, b.number) ||
        compareText(a.id, b.id),
    );
    return ok(rows, warnings);
  });
}
