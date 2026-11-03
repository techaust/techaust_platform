// The monthly Export Declaration Form (EDF) working list (M5.5a; ADM-REP-07, docs/08-A §8). Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 3(2) (08-C RB-03): under the
// FEMA 2026 regulations an exporter of services gives the AD bank an EDF within 30 days from the end of the month of the
// invoice; one EDF may cover all the exports of the month (08-C RB-03). Settled by the lead on the safest reading, 2026-10-30 (08-C RB-03): "software" (FEMA 23(R)/2026-RB Reg. 2(1)(e)); one monthly EDF with the AD bank; never Reg. 3(2)(b). This is OUR list for the bank
// conversation, not the bank's form. All payment rails are included (Q16). Export credit notes are not rows of their own (no 08-C row covers them); from
// `edf-v2` (M6.5, L13, RB-43) an invoice's row carries what its credit notes took off it, what was realised on it (`paid_minor`, net of a refund's release), the
// AD bank's Reg. 6 reductions (Settled by the lead on the safest reading, 2026-11-03 (08-C RB-43): the EDF keeps the full value; FEMA treats the invoice as not
// fully realised until the reduction is recorded) and whether a card or PayPal payment on an LUT export still awaits its proof (Settled by the lead on the safest
// reading, 2026-11-02 (08-C RA-38)).
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
  /**
   * `edf-v2` (B4; L13): "Amount realised", the invoice's `paid_minor` in its own currency (net of a refund's release); null when the page carried no facts
   * (`edf-v1` leaves the column blank whatever it holds).
   */
  readonly realisedMinor: number | null;
  /** What its credit notes took off it (`credited_minor`); null without facts. */
  readonly creditedMinor: number | null;
  /** RB-43: Σ the AD bank's Reg. 6 reductions, with the latest one's day and the bank's reference; null without facts (and the day and reference without one). */
  readonly reductionsMinor: number | null;
  readonly reductionOn: CalendarDate | null;
  readonly reductionRef: string | null;
  /** RA-38: an LUT export with a card or PayPal payment still without its proof; null without facts. */
  readonly proofMissing: boolean | null;
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
      // `edf-v2` (B4): the facts are checked whole; a damaged one fails the list rather than printing a guess.
      const f = row.realisationFacts ?? null;
      if (
        f !== null &&
        (!isNonNegInt(f.paidMinor) ||
          !isNonNegInt(f.creditedMinor) ||
          !isNonNegInt(f.reductionsMinor) ||
          typeof f.proofMissing !== "boolean")
      ) {
        errors.push({ code: "amount_invalid", path: [...at, "realisationFacts"] });
        continue;
      }
      if (f !== null && f.reductionOn !== null && !isValidDate(f.reductionOn)) {
        errors.push({ code: "date_invalid", path: [...at, "realisationFacts"] });
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
        realisedMinor: f === null ? null : f.paidMinor,
        creditedMinor: f === null ? null : f.creditedMinor,
        reductionsMinor: f === null ? null : f.reductionsMinor,
        reductionOn: f === null ? null : f.reductionOn,
        reductionRef: f === null ? null : f.reductionRef,
        proofMissing: f === null ? null : f.proofMissing,
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
