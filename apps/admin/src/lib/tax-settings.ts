// The Tax settings form's model (ADM-SET-03; the defaults are Researched 2026-10-28 or OPEN per 08-C): the stored `tax` row as the fields hold it, and the payload a save sends back. Pure, so
// the round trip is tested without a browser (routes/settings/tax.tsx draws the fields). Every stored value a field shows comes back as the person left
// it, and every stored value the page has no field for is kept as stored (`...doc.value`): a save never resets a setting to its default (M5.5b early
// check H2: the B2CL threshold and the INR realisation period, LD77).
import { issueDateOf } from "@techaust/core/invoices";
import type { Settings } from "@techaust/core/settings";
import type { SettingsDoc } from "../api.ts";
import type { Built } from "../routes/settings/kit.tsx";
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

/** The reports' own bounds on the realisation periods (core `realisationRulesOf` and the stored-settings reader). */
export const REALISATION_MAX_MONTHS = 1200;
export const REALISATION_MAX_DAYS = 36_500;
export const REALISATION_ERRORS = {
  warnMonths: "Enter the months before the warning, from 1 to 1,200.",
  escalateMonths: "Enter the months before escalating, from 1 to 1,200.",
  escalateExtraDays: "Enter the days before the final reminder, from 0 to 36,500.",
} as const;

/** The field id of an annual return's date (./routes/settings/annual-returns.tsx uses the same). */
export const annualReturnFieldId = (fy: string) => `f-annualReturnsFiled-${fy}`;

export type TaxForm = {
  rate: string;
  allowLineOverride: boolean;
  sac: Record<Category, string>;
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
  const warn = intIn(f.warnMonths, 1, REALISATION_MAX_MONTHS);
  if (warn === null) e["f-realisation-warnMonths"] = REALISATION_ERRORS.warnMonths;
  const inrMonths = intIn(f.inrMonths, 1, 120);
  if (inrMonths === null) e["f-realisation-inrMonths"] = TAX_FIELDS_COPY.inrMonthsError;
  const esc = intIn(f.escalateMonths, 1, REALISATION_MAX_MONTHS);
  if (esc === null) e["f-realisation-escalateMonths"] = REALISATION_ERRORS.escalateMonths;
  const extra = intIn(f.escalateExtraDays, 0, REALISATION_MAX_DAYS);
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
