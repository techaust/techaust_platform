// The Tax settings form's model (ADM-SET-03; the defaults are Researched 2026-10-28 or OPEN per 08-C): the stored `tax` row as the fields hold it, and the payload a save sends back. Pure, so
// the round trip is tested without a browser (routes/settings/tax.tsx draws the fields). Every stored value a field shows comes back as the person left
// it, and every stored value the page has no field for is kept as stored (`...doc.value`): a save never resets a setting to its default (M5.5b early
// check H2: the B2CL threshold and the INR realisation period, LD77).
import {
  issueDateOf,
  REALISATION_MAX_DAYS,
  REALISATION_MAX_MONTHS,
  REALISATION_MIN_DAYS,
  REALISATION_MIN_MONTHS,
} from "@techaust/core/invoices";
import type { Settings } from "@techaust/core/settings";
import type { SettingsDoc } from "../api.ts";
import type { Built } from "../routes/settings/kit.tsx";
import { Y } from "./copy-y.ts";
import type { LutRow } from "./invoice-types.ts";
import { annualReturnError, annualReturnsOf } from "./notes.ts";
import { TAX_FIELDS_COPY } from "./reports.ts";
import { bpToPercent, type FieldErrors, intIn, moneyFrom, moneyInput, percentToBp } from "./settings-form.ts";

export type Tax = Settings["tax"];
export type Category = keyof Tax["sacByCategory"];
export const CATEGORIES: { key: Category; label: string }[] = [
  { key: "advise", label: "Advise" },
  { key: "build", label: "Build" },
  { key: "automate", label: "Automate" },
  { key: "connect", label: "Connect" },
  { key: "run", label: "Run" },
];

/** The words of the realisation bounds; the bounds themselves are core's (`REALISATION_*` in `@techaust/core/invoices`, read by the schema, the stored-settings reader and `realisationRulesOf`). */
export const REALISATION_ERRORS = {
  warnMonths: "Enter the months before the warning, from 1 to 1,200.",
  escalateMonths: "Enter the months before escalating, from 1 to 1,200.",
  escalateExtraDays: "Enter the days before the final reminder, from 0 to 36,500.",
} as const;

/**
 * FX-4 (full audit A5 12; 07-Y, PENDING, marked): the words of Settings › Tax "default SAC" for custom lines, for the designer's field. Six digits, or empty for none
 * (Researched 2026-10-28, Notification 11/2017-CT (Rate) (08-C RA-16)).
 */
export const TAX_SAC_COPY = {
  defaultSacLabel: Y("Default SAC for custom lines"),
  defaultSacHint: Y(
    "A new line that is not from the catalogue starts with this SAC. Leave it empty to enter one on each line.",
  ),
  defaultSacError: Y("The default SAC has 6 digits, or leave it empty."),
} as const;

/**
 * FX-4 (full audit A5 8; 07-Y, PENDING, marked): a LUT added to the list is kept only when the form is saved, so until then its row says so. A row is unsaved
 * when the stored list has no LUT for its year with the same ARN and date.
 */
export const LUT_UNSAVED = Y("Not saved yet");

export const lutIsUnsaved = (row: LutRow, saved: readonly LutRow[]): boolean =>
  !saved.some((s) => s.fy === row.fy && s.arn === row.arn && (s.filedOn ?? "") === (row.filedOn ?? ""));

/** The field id of an annual return's date (./routes/settings/annual-returns.tsx uses the same). */
export const annualReturnFieldId = (fy: string) => `f-annualReturnsFiled-${fy}`;

export type TaxForm = {
  rate: string;
  allowLineOverride: boolean;
  sac: Record<Category, string>;
  /** FX-4 (A5 12): the SAC a new custom line starts with; "" is none. */
  defaultSac: string;
  exportMode: Tax["exportMode"];
  /** M5.2 (ADM-INV-18): the letters of undertaking, one per financial year (replaces the single ARN field). */
  luts: LutRow[];
  /** M5.2 (ADM-INV-06, LD31): a house rule of the checklist (07-S §3), switchable. */
  bankDetails: boolean;
  /** Step 5 (07-S §3; Researched 2026-10-28, 08-C RA-06): "Authorised signatory" is a house rule too. On unless stored off. */
  signatory: boolean;
  advanceMode: Tax["advanceMode"];
  fxSource: Tax["fxSource"];
  eInvoicing: boolean;
  reverseChargeText: string;
  invoiceAlertDays: string;
  cnMonth: string;
  cnDay: string;
  /**
   * rt1 T1 (R3, owner 2026-10-31; 07-ZD line 1): how GSTR-1 is filed, which sets the last day for a credit note on last year's invoices. Read as stored and
   * always saved back as the field holds it: the schema's `prefault` would otherwise turn a missing key back into "quarterly" (lead D9).
   */
  gstr1Frequency: Tax["gstr1Frequency"];
  /** M5.3 (Q33): the day the annual return of each FY was filed, by FY token; "" is no return. */
  annualReturns: Record<string, string>;
  b2c: string;
  /** M5.5b (LD77): the B2CL threshold, in rupees as typed. */
  b2cl: string;
  warnMonths: string;
  /** M5.5b (LD77): the FEMA period of an export invoiced in rupees. */
  inrMonths: string;
  escalateMonths: string;
  escalateExtraDays: string;
  crossBorder: string;
};

export function taxToForm(v: Tax): TaxForm {
  return {
    rate: bpToPercent(v.defaultRateBp),
    allowLineOverride: v.allowLineOverride,
    sac: { ...v.sacByCategory },
    defaultSac: v.defaultSac ?? "",
    exportMode: v.exportMode,
    // The API folds the old single letter into the list on read (early check 3), so the list is the whole story.
    luts: (v.luts ?? []).map((l) => ({ fy: l.fy, arn: l.arn, filedOn: l.filedOn ?? null })),
    bankDetails: v.invoiceChecklist?.bankDetails ?? true,
    signatory: v.invoiceChecklist?.signatory ?? true,
    advanceMode: v.advanceMode,
    fxSource: v.fxSource,
    eInvoicing: v.eInvoicing,
    reverseChargeText: v.reverseChargeText,
    invoiceAlertDays: String(v.invoiceAlertDays),
    cnMonth: String(v.creditNoteCutoff.month),
    cnDay: String(v.creditNoteCutoff.day),
    // A row stored before rt1 has no key: it reads as the schema's default (quarterly), as the server reads it.
    gstr1Frequency: v.gstr1Frequency ?? "quarterly",
    annualReturns: Object.fromEntries((v.annualReturnsFiled ?? []).map((r) => [r.fy, r.filedOn])),
    b2c: moneyInput(v.b2cDetailsThresholdInrMinor, "INR"),
    b2cl: moneyInput(v.b2clThresholdInrMinor, "INR"),
    warnMonths: String(v.realisation.warnMonths),
    inrMonths: String(v.realisation.inrMonths),
    escalateMonths: String(v.realisation.escalateMonths),
    escalateExtraDays: String(v.realisation.escalateExtraDays),
    crossBorder: moneyInput(v.crossBorderWarnInrMinor, "INR"),
  };
}

/** The form's own checks, in the order the fields appear, then the value to save (every other stored key kept as it was). */
export function buildTax(f: TaxForm, doc: Pick<SettingsDoc<"tax">, "value">, now = Date.now()): Built<"tax"> {
  const e: FieldErrors = {};
  const rate = percentToBp(f.rate);
  if (rate === null)
    e["f-defaultRateBp"] = "Enter the default GST rate: 0 to 100 %, with at most 2 decimals.";
  for (const c of CATEGORIES)
    if (!/^\d{6}$/.test(f.sac[c.key].trim()))
      e[`f-sacByCategory-${c.key}`] = `The ${c.label} SAC has 6 digits.`;
  const defaultSac = f.defaultSac.trim();
  if (defaultSac !== "" && !/^\d{6}$/.test(defaultSac)) e["f-defaultSac"] = TAX_SAC_COPY.defaultSacError;
  const alertDays = intIn(f.invoiceAlertDays, 1, 30);
  if (alertDays === null) e["f-invoiceAlertDays"] = "Enter the tax invoice reminder in days, from 1 to 30.";
  const cnMonth = intIn(f.cnMonth, 1, 12);
  const cnDay = intIn(f.cnDay, 1, 31);
  if (cnDay === null) e["f-creditNoteCutoff-day"] = "Enter the credit note cut-off day, from 1 to 31.";
  const today = issueDateOf(now);
  for (const [fy, filedOn] of Object.entries(f.annualReturns)) {
    const bad = annualReturnError(fy, filedOn, today);
    if (bad) e[annualReturnFieldId(fy)] = bad;
  }
  const b2c = moneyFrom(f.b2c, "INR");
  if (!b2c.ok) e["f-b2cDetailsThresholdInrMinor"] = `Unregistered buyer details from: ${b2c.error}`;
  // 07-V §8: above zero (the schema refuses zero too).
  const b2cl = moneyFrom(f.b2cl, "INR");
  const b2clOk = b2cl.ok && b2cl.minor > 0;
  if (!b2clOk) e["f-b2clThresholdInrMinor"] = TAX_FIELDS_COPY.b2clError;
  const cross = moneyFrom(f.crossBorder, "INR");
  if (!cross.ok) e["f-crossBorderWarnInrMinor"] = `Cross-border payment warning: ${cross.error}`;
  if (!f.reverseChargeText.trim()) e["f-reverseChargeText"] = "Enter the reverse-charge line.";
  // The realisation periods are bounded as the reports read them (core: 1 to 1,200 months, 0 to 36,500 days), so a saved value never stops the
  // reports with `settings_invalid` (M5.5b review 4). The bounded words are not in 07 (batch Q69): 07-W §3.
  const warn = intIn(f.warnMonths, REALISATION_MIN_MONTHS, REALISATION_MAX_MONTHS);
  if (warn === null) e["f-realisation-warnMonths"] = REALISATION_ERRORS.warnMonths;
  const inrMonths = intIn(f.inrMonths, 1, 120);
  if (inrMonths === null) e["f-realisation-inrMonths"] = TAX_FIELDS_COPY.inrMonthsError;
  const esc = intIn(f.escalateMonths, REALISATION_MIN_MONTHS, REALISATION_MAX_MONTHS);
  if (esc === null) e["f-realisation-escalateMonths"] = REALISATION_ERRORS.escalateMonths;
  const extra = intIn(f.escalateExtraDays, REALISATION_MIN_DAYS, REALISATION_MAX_DAYS);
  if (extra === null) e["f-realisation-escalateExtraDays"] = REALISATION_ERRORS.escalateExtraDays;
  if (
    Object.keys(e).length ||
    rate === null ||
    alertDays === null ||
    cnMonth === null ||
    cnDay === null ||
    !b2c.ok ||
    !b2cl.ok ||
    !b2clOk ||
    warn === null ||
    inrMonths === null ||
    esc === null ||
    extra === null ||
    !cross.ok
  )
    return { errors: e };
  return {
    value: {
      ...doc.value,
      defaultRateBp: rate,
      allowLineOverride: f.allowLineOverride,
      sacByCategory: Object.fromEntries(
        CATEGORIES.map((c) => [c.key, f.sac[c.key].trim()]),
      ) as Tax["sacByCategory"],
      defaultSac,
      exportMode: f.exportMode,
      // The deprecated single letter is never written again: the list is saved, the old key stays empty.
      lut: { arn: null, fy: null },
      luts: f.luts,
      invoiceChecklist: { bankDetails: f.bankDetails, paymentLink: false, signatory: f.signatory },
      advanceMode: f.advanceMode,
      fxSource: f.fxSource,
      eInvoicing: f.eInvoicing,
      reverseChargeText: f.reverseChargeText.trim(),
      invoiceAlertDays: alertDays,
      creditNoteCutoff: { month: cnMonth, day: cnDay },
      gstr1Frequency: f.gstr1Frequency,
      annualReturnsFiled: annualReturnsOf(f.annualReturns),
      b2cDetailsThresholdInrMinor: b2c.minor,
      b2clThresholdInrMinor: b2cl.minor,
      // Every stored key of the realisation block is kept, then the four the page shows are set.
      realisation: {
        ...doc.value.realisation,
        warnMonths: warn,
        inrMonths,
        escalateMonths: esc,
        escalateExtraDays: extra,
      },
      crossBorderWarnInrMinor: cross.minor,
    },
  };
}
