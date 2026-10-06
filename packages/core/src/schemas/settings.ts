// Settings documents (docs/05 §5.2 `settings`) with the researched defaults from docs/08 §7.1 and docs/04
// ADM-SET-*. VERIFY WITH CA/LEGAL: every tax and legal rule here is a default the Owner can change, never
// settled advice. Company identity (legal name, GSTIN, address) and bank details are entered by the Owner in
// the admin (M3.1) and are never committed: this repository is public.
import { z } from "zod";
import { DEFAULT_PADDING, SERIES, type Series, validateFormat } from "../numbering.ts";

const minor = z.int().nonnegative();
const bp = z.int().min(0).max(10_000);

export const companySettings = z.object({
  tradeName: z.string().min(1),
  legalName: z.string().min(1).nullable(),
  gstin: z.string().length(15).nullable(),
  stateCode: z.string().regex(/^\d{2}$/),
  address: z.string().nullable(),
  documentsEmail: z.email().nullable(),
  documentsPhone: z.string().nullable(),
});

export const taxSettings = z.object({
  /** G-1: 18 % on all services (CGST 9 + SGST 9, or IGST 18). */
  defaultRateBp: bp,
  allowLineOverride: z.boolean(),
  /** G-2: SAC by catalogue category (6 digits printed). */
  sacByCategory: z.record(
    z.enum(["advise", "build", "automate", "connect", "run"]),
    z.string().regex(/^\d{6}$/),
  ),
  /** G-10: tax per line per head, half-up to the paisa; INR grand total to the nearest ₹1; USD not rounded. */
  rounding: z.object({
    lineTax: z.literal("half_up"),
    totalInr: z.literal("nearest_rupee"),
    totalUsd: z.literal("none"),
  }),
  /** G-8: exports under LUT (0 % IGST) by default; needs a saved ARN for the FY. */
  exportMode: z.enum(["lut", "igst_paid"]),
  lut: z.object({
    arn: z.string().nullable(),
    fy: z
      .string()
      .regex(/^\d{4}$/)
      .nullable(),
  }),
  /** G-6: Proforma → automatic Tax Invoice on payment; alternatives selectable. */
  advanceMode: z.enum(["proforma", "invoice_upfront", "receipt_voucher"]),
  /** G-9: FBIL/RBI reference rate on the invoice date. */
  fxSource: z.enum(["FBIL/RBI", "manual"]),
  /** G-14: off while AATO ≤ ₹5 Cr (assumed). */
  eInvoicing: z.boolean(),
  reverseChargeText: z.string().min(1),
  /** G-5: warn this many days after supply if no tax invoice yet (services are due within 30 days). */
  invoiceAlertDays: z.int().min(1).max(30),
  /** G-11: credit notes are blocked after this date following the FY of supply (or the annual return). */
  creditNoteCutoff: z.object({ month: z.int().min(1).max(12), day: z.int().min(1).max(31) }),
  /** ADM-INV-06: unregistered recipients at or above this value need name, address and state. */
  b2cDetailsThresholdInrMinor: minor,
  /** G-12: export realisation warnings (FEMA). */
  realisation: z.object({
    warnMonths: z.int().min(1),
    escalateMonths: z.int().min(1),
    escalateExtraDays: z.int().min(0),
  }),
  /** G-18: warn above this amount per cross-border gateway transaction. */
  crossBorderWarnInrMinor: minor,
});

const numberingFormat = z
  .object({ template: z.string(), padding: z.int() })
  .refine((f) => validateFormat(f).ok, {
    error: (i) => `Invalid numbering format ${JSON.stringify(i.input)}`,
  });

export const numberingSettings = z.record(
  z.enum(Object.keys(SERIES) as [Series, ...Series[]]),
  numberingFormat,
);

const scheduleStep = z.object({ label: z.string().min(1), pctBp: bp });

export const paymentTermsSettings = z
  .object({
    /** Net 7 by default (ADM-INV-09); clients can override. */
    dueDays: z.int().min(0).max(90),
    /** Q-P3-6: proposals and estimates are valid for 15 days. */
    proposalValidityDays: z.int().min(1).max(90),
    /** Q-P3-6: builds 40/30/30; small fixed jobs (under the thresholds) 100 % upfront; care plans monthly in advance. */
    buildSchedule: z.array(scheduleStep).min(1),
    smallJobThreshold: z.object({ INR: minor, USD: minor }),
    /** ADM-INV-13: reminder offsets relative to the due date, sent 09:00–19:00 IST only. */
    reminderOffsetsDays: z.array(z.int().min(-30).max(90)).min(1),
    reminderWindowIst: z.object({ fromHour: z.int().min(0).max(23), toHour: z.int().min(1).max(24) }),
  })
  .refine((t) => t.buildSchedule.reduce((a, s) => a + s.pctBp, 0) === 10_000, {
    error: "The build schedule must add up to 100 %",
    path: ["buildSchedule"],
  });

export const retentionSettings = z
  .object({
    /** ADM-SET-09: unconverted leads; never below the 1-year minimum (DPDP Rule 8(3)). */
    leadsMonths: z.int().min(12),
    emailLogMonths: z.int().min(1),
    /** ≥ 13 months (DPDP Rule 6: 1 year; CERT-In: 180 days). */
    securityLogMonths: z.int().min(13),
    /** Financial records and the audit log: 10 years by default, never below 8 (s.36). */
    financialYears: z.int().min(8),
  })
  .strict();

export const flagSettings = z.object({
  /** S3 DPDP Readiness page stays hidden until a legal partner exists (Q-B12). */
  dpdpReadinessPage: z.boolean(),
  weeklyDigest: z.boolean(),
});

export const SETTINGS_SCHEMAS = {
  company: companySettings,
  tax: taxSettings,
  numbering: numberingSettings,
  payment_terms: paymentTermsSettings,
  retention: retentionSettings,
  flags: flagSettings,
} as const;
export type SeededSettingKey = keyof typeof SETTINGS_SCHEMAS;
export type Settings = { [K in SeededSettingKey]: z.infer<(typeof SETTINGS_SCHEMAS)[K]> };

/** The defaults the database is seeded with (VERIFY WITH CA/LEGAL). */
export const SETTINGS_DEFAULTS: Settings = {
  company: {
    tradeName: "TecHaust Technologies",
    legalName: null,
    gstin: null,
    stateCode: "19",
    address: null,
    documentsEmail: "contact@techaust.com",
    documentsPhone: null,
  },
  tax: {
    defaultRateBp: 1_800,
    allowLineOverride: true,
    sacByCategory: {
      advise: "998313",
      build: "998314",
      automate: "998314",
      connect: "998314",
      run: "998313",
    },
    rounding: { lineTax: "half_up", totalInr: "nearest_rupee", totalUsd: "none" },
    exportMode: "lut",
    lut: { arn: null, fy: null },
    advanceMode: "proforma",
    fxSource: "FBIL/RBI",
    eInvoicing: false,
    reverseChargeText: "Tax payable on reverse charge: No",
    invoiceAlertDays: 25,
    creditNoteCutoff: { month: 11, day: 30 },
    b2cDetailsThresholdInrMinor: 50_000_00,
    realisation: { warnMonths: 9, escalateMonths: 12, escalateExtraDays: 15 },
    crossBorderWarnInrMinor: 25_00_000_00,
  },
  numbering: Object.fromEntries(
    (Object.keys(SERIES) as Series[]).map((s) => [
      s,
      { template: SERIES[s].default, padding: DEFAULT_PADDING },
    ]),
  ) as Settings["numbering"],
  payment_terms: {
    dueDays: 7,
    proposalValidityDays: 15,
    buildSchedule: [
      { label: "On acceptance", pctBp: 4_000 },
      { label: "Midpoint milestone", pctBp: 3_000 },
      { label: "On delivery", pctBp: 3_000 },
    ],
    smallJobThreshold: { INR: 1_00_000_00, USD: 2_000_00 },
    reminderOffsetsDays: [-3, 0, 3, 7, 14],
    reminderWindowIst: { fromHour: 9, toHour: 19 },
  },
  retention: { leadsMonths: 12, emailLogMonths: 13, securityLogMonths: 13, financialYears: 10 },
  flags: { dpdpReadinessPage: false, weeklyDigest: true },
};
