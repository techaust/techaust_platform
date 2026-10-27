// Settings documents (docs/05 §5.2 `settings`) with the researched defaults from docs/08 §7.1 and docs/04
// ADM-SET-*. VERIFY WITH CA/LEGAL: every tax and legal rule here is a default the Owner can change, never
// settled advice. Company identity (legal name, GSTIN, address) and bank details are entered by the Owner in
// the admin (M3.1) and are never committed: this repository is public.
//
// Written with `zod/mini` (M3.1): the admin Worker validates these on every Settings save, and its bundle guard
// (scripts/worker-budget.mjs) keeps classic zod (~150 KB) out. The behaviour is the same as the classic version.
import * as z from "zod/mini";
import { parseIsoDate } from "../dates.ts";
import { EMAIL_TEMPLATES } from "../email-templates.ts";
import { type LegacyLutFate, type LutEntry, legacyLutFate, normaliseLutArn } from "../export-invoice.ts";
import { STATE_CODES, type StateCode, validateGstin } from "../gstin.ts";
import {
  DEFAULT_PADDING,
  type FormatCheck,
  type NumberingFormat,
  SERIES,
  type Series,
  validateFormat,
  validateStoredFormat,
} from "../numbering.ts";

/**
 * The brand logo files a document may use (ADM-SET-01), file names under `packages/ui/brand`. A fixed list: the PDF and the
 * admin read the file by name, so a name outside it is refused. A test checks that every file exists.
 */
export const BRAND_LOGOS = [
  "logo-primary-color.svg",
  "logo-primary-dark.svg",
  "logo-primary-ink.svg",
  "logo-primary-black.svg",
  "logo-primary-white.svg",
  "logo-stacked-color.svg",
  "logo-stacked-dark.svg",
  "logo-stacked-ink.svg",
  "logo-stacked-black.svg",
  "logo-stacked-white.svg",
] as const;

/** ADM-SET-01: the PAN is part of the GSTIN (characters 3 to 12). Derived, never typed or stored. */
export const panOf = (gstinValue: string | null): string | null =>
  gstinValue && gstinValue.length === 15 ? gstinValue.slice(2, 12) : null;

const nonneg = z.int().check(z.gte(0));
const minor = nonneg;
const bp = z.int().check(z.gte(0), z.lte(10_000));
const intBetween = (min: number, max?: number) =>
  z.int().check(z.gte(min), ...(max === undefined ? [] : [z.lte(max)]));
const text = (min: number, max?: number) =>
  z.string().check(z.minLength(min), ...(max === undefined ? [] : [z.maxLength(max)]));

/** A GSTIN, normalised (trim, upper case, no spaces) and checked: shape, known state, check character (VERIFY WITH CA). */
const gstin = z.pipe(
  z.string({ error: "Enter the GSTIN" }),
  z.transform((value, ctx) => {
    const result = validateGstin(value);
    if (!result.ok) {
      ctx.issues.push({ code: "custom", message: result.error, input: value });
      return z.NEVER;
    }
    return result.gstin;
  }),
);

const stateCode = z.enum(Object.keys(STATE_CODES) as [StateCode, ...StateCode[]], {
  error: "Choose a state",
});

/**
 * ADM-SET-01 (M4.4): the authorised signatory's signature image, uploaded by the owner. The image lives in the `DOCS` bucket under a key
 * made from its SHA-256, so a replacement never changes the file an earlier document used. Only the signature routes write this field
 * (the generic company form can neither set nor clear it). A stored company row from before M4.4 has no such key and reads as null.
 * It is printed only on invoices (from M5.2); VERIFY WITH CA/LEGAL that a signature image is wanted at all.
 */
export const SIGNATURE_MIMES = ["image/png", "image/jpeg"] as const;
export const SIGNATURE_MAX_BYTES = 256 * 1024;
export const signatureRef = z.strictObject({
  key: z.string().check(z.minLength(1), z.maxLength(120)),
  mime: z.enum(SIGNATURE_MIMES),
  size: z.int().check(z.gte(1), z.lte(SIGNATURE_MAX_BYTES)),
  sha256: z.string().check(z.regex(/^[0-9a-f]{64}$/)),
  /** PNG only (read from the header); null for a JPEG. */
  width: z.nullable(z.int()),
  height: z.nullable(z.int()),
  updatedAt: z.int(),
});
export type SignatureRef = z.infer<typeof signatureRef>;

export const companySettings = z
  .strictObject({
    tradeName: text(1),
    legalName: z.nullable(text(1)),
    /** Checked like any GSTIN: shape, a known state code and the check character (VERIFY WITH CA). */
    gstin: z.nullable(gstin),
    stateCode,
    address: z.nullable(z.string()),
    documentsEmail: z.nullable(z.email()),
    documentsPhone: z.nullable(z.string()),
    /** ADM-SET-01: the principal place of business printed on documents (may differ from the registered address). */
    principalPlace: z.nullable(text(0, 500)),
    /** ADM-SET-01 (lead decision): the logos are chosen from the generated brand files, never uploaded (uploads wait for R2, M3.4). */
    logoLight: z.enum(BRAND_LOGOS),
    logoDark: z.enum(BRAND_LOGOS),
    /** ADM-SET-01, M4.4: the signature image (optional; absent reads as null). Set and cleared only by `PUT/DELETE /settings/signature`. */
    signature: z.optional(z.nullable(signatureRef)),
  })
  .check(
    z.refine((c) => c.gstin === null || c.gstin.startsWith(c.stateCode), {
      error: "The GSTIN's first two digits must match the company state code",
      path: ["gstin"],
    }),
  );

/** An ISO calendar date as a date input gives it ("2026-03-28"); a real date. */
const isoDate = z.string().check(
  z.regex(/^\d{4}-\d{2}-\d{2}$/),
  z.refine((v) => parseIsoDate(v) !== null, { error: "Enter a real date" }),
);

/**
 * ADM-SET-03, ADM-INV-18 (M5.2): one letter of undertaking per financial year. `fy` is the token ("2627": two consecutive years), `arn` the number from
 * the GST portal (spaces dropped, upper case; its format is NOT VERIFIED, so only a safe 1 to 30 characters of letters and digits is checked),
 * `filedOn` the day it was filed (optional). VERIFY WITH CA/LEGAL.
 */
export const lutEntry = z.strictObject({
  fy: z.string().check(
    z.regex(/^\d{4}$/, { error: "Pick a financial year" }),
    z.refine((v) => (Number(v.slice(0, 2)) + 1) % 100 === Number(v.slice(2)), {
      error: "A financial year runs between two consecutive years",
    }),
  ),
  arn: z.pipe(
    z.pipe(z.string({ error: "Enter the ARN from the GST portal." }), z.transform(normaliseLutArn)),
    z.string().check(z.regex(/^[A-Z0-9]{1,30}$/, { error: "Enter the ARN from the GST portal." })),
  ),
  filedOn: z.nullable(isoDate),
});

/**
 * G-11, Q33 (M5.3; VERIFY WITH CA/LEGAL): the day the annual return (GSTR-9) of a financial year was filed. Once it is, credit notes for that year's supplies are
 * refused from that day (s.34(2): "or the date of furnishing the annual return, whichever is earlier"). `fy` is the token ("2627", the lutEntry rule), `filedOn` an
 * ISO date on or after 1 April after that FY ends. A day after today is refused by the route (`annual_return_future`), never here: this schema has no clock.
 */
export const annualReturnEntry = z
  .strictObject({
    // 07-T §8: "Enter the financial year." (the token is two consecutive years, "2627")
    fy: z.string().check(
      z.regex(/^\d{4}$/, { error: "Enter the financial year." }),
      // only a four-digit token is checked here, so a malformed one gets the message once
      z.refine((v) => !/^\d{4}$/.test(v) || (Number(v.slice(0, 2)) + 1) % 100 === Number(v.slice(2)), {
        error: "Enter the financial year.",
      }),
    ),
    filedOn: isoDate,
  })
  .check(
    z.refine((v) => !/^\d{4}$/.test(v.fy) || v.filedOn >= `${2000 + Number(v.fy.slice(2))}-04-01`, {
      error: "The filing date must be after the end of that financial year.",
      path: ["filedOn"],
    }),
  );

/**
 * LD31: only the switchable lines of the mandatory-field checklist (ADM-INV-06) are stored in the `tax` row; the locked ones are a constant in
 * `@techaust/core/invoices` and naming one here is refused (a strict object). The payment link stays off until online payment exists (M6): `true` is refused.
 */
export const invoiceChecklistSettings = z.strictObject({
  bankDetails: z.boolean(),
  paymentLink: z.literal(false),
});

export const taxSettings = z.object({
  /** G-1: 18 % on all services (CGST 9 + SGST 9, or IGST 18). */
  defaultRateBp: bp,
  allowLineOverride: z.boolean(),
  /** G-2: SAC by catalogue category (6 digits printed). */
  sacByCategory: z.record(
    z.enum(["advise", "build", "automate", "connect", "run"]),
    z.string().check(z.regex(/^\d{6}$/)),
  ),
  /** G-10: tax per line per head, half-up to the paisa; INR grand total to the nearest ₹1; USD not rounded. */
  rounding: z.object({
    lineTax: z.literal("half_up"),
    totalInr: z.literal("nearest_rupee"),
    totalUsd: z.literal("none"),
  }),
  /** G-8: exports under LUT (0 % IGST) by default; needs a saved ARN for the FY. */
  exportMode: z.enum(["lut", "igst_paid"]),
  /**
   * DEPRECATED (M5.2): the one letter of M3. Stored rows keep it and the current screen still saves it; `lutsOf` reads it as a list entry when its FY is
   * not in `luts`. New code writes `luts`. An input without it reads as empty.
   */
  lut: z.prefault(
    z.object({
      arn: z.nullable(z.string()),
      fy: z.nullable(z.string().check(z.regex(/^\d{4}$/))),
    }),
    { arn: null, fy: null },
  ),
  /** G-8, ADM-INV-18 (M5.2): the letters of undertaking, at most one per FY, at most 20. */
  luts: z.array(lutEntry).check(
    z.maxLength(20),
    z.check((ctx) => {
      const seen = new Set<string>();
      ctx.value.forEach((l, i) => {
        if (seen.has(l.fy))
          ctx.issues.push({
            code: "custom",
            message: "This year already has an LUT.",
            input: ctx.value,
            path: [i, "fy"],
          });
        seen.add(l.fy);
      });
    }),
  ),
  /** ADM-INV-06, Q10 (M5.2, LD31): the switchable lines of the mandatory-field checklist. */
  invoiceChecklist: invoiceChecklistSettings,
  /** Q24 (M5.2; VERIFY WITH CA/LEGAL, Rule 34(2)): how many days before the invoice date the exchange rate's own date may be (0 = the same day only). */
  fxMaxAgeDays: intBetween(0, 7),
  /** G-6: Proforma → automatic Tax Invoice on payment; alternatives selectable. */
  advanceMode: z.enum(["proforma", "invoice_upfront", "receipt_voucher"]),
  /** G-9: FBIL/RBI reference rate on the invoice date. */
  fxSource: z.enum(["FBIL/RBI", "manual"]),
  /** G-14: off while AATO ≤ ₹5 Cr (assumed). */
  eInvoicing: z.boolean(),
  reverseChargeText: text(1),
  /** G-5: warn this many days after supply if no tax invoice yet (services are due within 30 days). */
  invoiceAlertDays: intBetween(1, 30),
  /** G-11: credit notes are blocked after this date following the FY of supply (or the annual return). */
  creditNoteCutoff: z.object({ month: intBetween(1, 12), day: intBetween(1, 31) }),
  /** G-11, Q33 (M5.3): the annual returns filed, at most one per FY, at most 20; a stored row without it reads as empty. */
  annualReturnsFiled: z.prefault(
    z.array(annualReturnEntry).check(
      z.maxLength(20),
      z.check((ctx) => {
        const seen = new Set<string>();
        ctx.value.forEach((r, i) => {
          if (seen.has(r.fy))
            ctx.issues.push({
              code: "custom",
              message: "This year already has a filing date.",
              input: ctx.value,
              path: [i, "fy"],
            });
          seen.add(r.fy);
        });
      }),
    ),
    [],
  ),
  /** ADM-INV-06: unregistered recipients at or above this value need name, address and state. */
  b2cDetailsThresholdInrMinor: minor,
  /** G-12: export realisation warnings (FEMA). */
  realisation: z.object({
    warnMonths: intBetween(1),
    /** Q15 (M5.5b; VERIFY WITH CA/LEGAL, FEMA 2026): months to realise an export invoice in INR; a stored row without it reads 12. */
    inrMonths: z.prefault(intBetween(1, 120), 12),
    escalateMonths: intBetween(1),
    escalateExtraDays: intBetween(0),
  }),
  /**
   * Q18 (M5.5b; VERIFY WITH CA/LEGAL, Notification 12/2024): an inter-state invoice to an unregistered client above this INR amount
   * (strictly more) is reported as B2CL in GSTR-1; at or below it, as B2CS. A stored row without it reads Rs 1,00,000.00; zero is refused.
   */
  b2clThresholdInrMinor: z.prefault(intBetween(1), 1_00_000_00),
  /** G-18: warn above this amount per cross-border gateway transaction. */
  crossBorderWarnInrMinor: minor,
});

/**
 * M5.2 (analyst, early check 3; VERIFY WITH CA/LEGAL): folds the deprecated single `lut` of M3 into the `luts` list and clears it, unless its FY is
 * already listed (then the list entry wins and the legacy value is dropped). Applied when the `tax` row is read for a screen and when it is saved, so a
 * letter the owner deletes from the list can never come back from the old key, and a letter that was only ever in the old key is never lost, unless
 * it could not be a list entry at all. The old ARN is normalised like a list entry's (spaces dropped, upper case); one the list would still refuse is
 * dropped (`legacyLutFate` says which case, for a logged note), so a Tax save never fails on a field the person cannot see (review 8).
 */
export function foldLegacyLut<T extends Parameters<typeof legacyLutFate>[0] & { luts: readonly LutEntry[] }>(
  tax: T,
): T {
  const f = legacyLutFate(tax);
  const luts = f.fate === "folded" ? [...tax.luts, f.entry] : tax.luts;
  return { ...tax, luts, lut: { arn: null, fy: null } };
}

export { type LegacyLutFate, legacyLutFate };

const numberingFormatOf = (check: (f: NumberingFormat) => FormatCheck) =>
  z.object({ template: z.string(), padding: z.int() }).check(
    z.refine((f) => check(f).ok, {
      error: (i) => `Invalid numbering format ${JSON.stringify(i.input)}`,
    }),
  );

const SERIES_KEYS = Object.keys(SERIES) as [Series, ...Series[]];

/** The numbering settings as they are SAVED: every format passes `validateFormat` (LD18's first-character rule included). */
export const numberingSettings = z.record(z.enum(SERIES_KEYS), numberingFormatOf(validateFormat));

/** The numbering settings as they are READ: the rules that held before M5.1, so an older stored row never turns a route into a 500 (the owner fixes it on the next save). */
export const storedNumberingSettings = z.record(z.enum(SERIES_KEYS), numberingFormatOf(validateStoredFormat));

const scheduleStep = z.object({ label: text(1), pctBp: bp });

export const paymentTermsSettings = z
  .object({
    /** Net 7 by default (ADM-INV-09); clients can override. */
    dueDays: intBetween(0, 90),
    /** Q-P3-6: proposals and estimates are valid for 15 days. */
    proposalValidityDays: intBetween(1, 90),
    /** Q-P3-6: builds 40/30/30; small fixed jobs (under the thresholds) 100 % upfront; care plans monthly in advance. */
    buildSchedule: z.array(scheduleStep).check(z.minLength(1)),
    smallJobThreshold: z.object({ INR: minor, USD: minor }),
    /** ADM-INV-13: reminder offsets relative to the due date, sent 09:00–19:00 IST only. */
    reminderOffsetsDays: z.array(intBetween(-30, 90)).check(z.minLength(1)),
    reminderWindowIst: z.object({ fromHour: intBetween(0, 23), toHour: intBetween(1, 24) }),
    /** ADM-SET-05: the smallest part-payment a Razorpay link may ask for (INR minor; the full balance if lower). */
    razorpayMinPartialInrMinor: minor,
    /**
     * The website's liability cap (INR minor), printed on /terms (M2.3 follow-up, 07-A section 2 item 10). One source: apps/web reads
     * it from SETTINGS_DEFAULTS. VERIFY WITH CA/LEGAL (08 L-12).
     */
    websiteLiabilityCapInrMinor: minor,
  })
  .check(
    z.refine((t) => t.buildSchedule.reduce((a, s) => a + s.pctBp, 0) === 10_000, {
      error: "The build schedule must add up to 100 %",
      path: ["buildSchedule"],
    }),
    // The tax engine refuses a last instalment of 0 % (M4.2 review M4), so the template can't save one.
    z.refine((t) => (t.buildSchedule.at(-1)?.pctBp ?? 1) >= 1, {
      error: "The last step of the build schedule can't be 0 %",
      path: ["buildSchedule"],
    }),
  );

export const retentionSettings = z.strictObject({
  /** ADM-SET-09: unconverted leads; never below the 1-year minimum (DPDP Rule 8(3)). */
  leadsMonths: intBetween(12),
  emailLogMonths: intBetween(1),
  /** ≥ 13 months (DPDP Rule 6: 1 year; CERT-In: 180 days). */
  securityLogMonths: intBetween(13),
  /** Financial records and the audit log: 10 years by default, never below 8 (s.36). */
  financialYears: intBetween(8),
});

export const flagSettings = z.object({
  /** S3 DPDP Readiness page stays hidden until a legal partner exists (Q-B12). */
  dpdpReadinessPage: z.boolean(),
  weeklyDigest: z.boolean(),
  /** ADM-SET-10: these reach the website only through the publish snapshot (M4.1); nothing here changes the site by itself. */
  blogEnabled: z.boolean(),
  calComUrl: z.nullable(z.url({ protocol: /^https$/ }).check(z.maxLength(300))),
  /** International format (E.164). */
  whatsappNumber: z.nullable(
    z
      .string()
      .check(z.regex(/^\+[1-9][0-9]{7,14}$/, { error: "Use the international format, e.g. +919800000000" })),
  ),
  ga4Id: z.nullable(
    z
      .string()
      .check(z.regex(/^G-[A-Z0-9]{6,12}$/, { error: "A Google Analytics 4 ID looks like G-XXXXXXXXXX" })),
  ),
});

/** Payment gateways that have a mode setting (ADM-SET-06). */
export const GATEWAYS = ["razorpay", "stripe", "paypal"] as const;
export type Gateway = (typeof GATEWAYS)[number];
export const GATEWAY_MODES = ["test", "live"] as const;
/** The Worker secret names that make a gateway "configured" (names only, from .env.example; values are never read out). */
export const GATEWAY_SECRETS: Record<Gateway, readonly string[]> = {
  razorpay: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"],
  stripe: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  paypal: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID"],
};

/** ADM-SET-06: the mode only. Keys are Worker secrets; status (configured / missing) is computed, never stored. */
export const gatewaySettings = z.strictObject({
  razorpay: z.strictObject({ mode: z.enum(GATEWAY_MODES) }),
  stripe: z.strictObject({ mode: z.enum(GATEWAY_MODES) }),
  paypal: z.strictObject({ mode: z.enum(GATEWAY_MODES) }),
});

/** ADM-SET-07: sender identities, reply-to, a copy to the owner per template, and the footer line. */
export const emailSettings = z.strictObject({
  senders: z.strictObject({ hello: z.email(), billing: z.email(), noReply: z.email() }),
  replyTo: z.email(),
  /** A blind copy to the owner, per template; a missing template means no copy. */
  bccOwner: z.partialRecord(z.enum(EMAIL_TEMPLATES), z.boolean()),
  footerText: text(1, 500),
});

export const SETTINGS_SCHEMAS = {
  company: companySettings,
  tax: taxSettings,
  numbering: numberingSettings,
  payment_terms: paymentTermsSettings,
  retention: retentionSettings,
  flags: flagSettings,
  gateways: gatewaySettings,
  email: emailSettings,
} as const;
/** What a stored row is read with: the same schemas, except that numbering takes a format valid before M5.1 (see `storedNumberingSettings`). */
const READ_SCHEMAS = { ...SETTINGS_SCHEMAS, numbering: storedNumberingSettings } as const;
export type SeededSettingKey = keyof typeof SETTINGS_SCHEMAS;
export type Settings = { [K in SeededSettingKey]: z.infer<(typeof SETTINGS_SCHEMAS)[K]> };

/** Group names a person may open in Settings (the 8 stored here, plus bank details and the terms blocks, which have their own tables). */
export const SETTINGS_GROUPS = [
  "company",
  "bank",
  "tax",
  "numbering",
  "payment_terms",
  "gateways",
  "email",
  "terms",
  "retention",
  "flags",
] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

/**
 * A stored setting as the app reads it: the defaults merged under the stored value, then validated. Rows saved before a field
 * existed (the seed is insert-only, so staging and production rows keep their old shape) still read as complete.
 * Throws if the merged value is invalid (a corrupted row), which the caller turns into a 500, never a silent default.
 */
export function resolveSetting<K extends SeededSettingKey>(key: K, stored: unknown): Settings[K] {
  return READ_SCHEMAS[key].parse(mergeDefaults(SETTINGS_DEFAULTS[key], stored ?? undefined)) as Settings[K];
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Defaults under the stored value at every depth of plain objects; arrays and scalars in the stored value win whole. */
function mergeDefaults(base: unknown, stored: unknown): unknown {
  if (!isPlain(base)) return stored === undefined ? base : stored;
  if (stored === undefined) return base;
  if (!isPlain(stored)) return stored;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(stored)) {
    if (k === "__proto__") continue;
    out[k] = Object.hasOwn(base, k) ? mergeDefaults(base[k], v) : v;
  }
  return out;
}

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
    principalPlace: null,
    logoLight: "logo-primary-color.svg",
    logoDark: "logo-primary-dark.svg",
    signature: null,
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
    luts: [],
    invoiceChecklist: { bankDetails: true, paymentLink: false },
    fxMaxAgeDays: 4,
    advanceMode: "proforma",
    fxSource: "FBIL/RBI",
    eInvoicing: false,
    reverseChargeText: "Tax payable on reverse charge: No",
    invoiceAlertDays: 25,
    creditNoteCutoff: { month: 11, day: 30 },
    annualReturnsFiled: [],
    b2cDetailsThresholdInrMinor: 50_000_00,
    realisation: { warnMonths: 9, inrMonths: 12, escalateMonths: 12, escalateExtraDays: 15 },
    b2clThresholdInrMinor: 1_00_000_00,
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
    // VERIFY WITH CA/LEGAL: the default part-payment floor (docs/04 ADM-SET-05): INR 10,000.
    razorpayMinPartialInrMinor: 10_000_00,
    // VERIFY WITH CA/LEGAL (08 L-12): INR 10,000, the figure the site printed before this setting existed.
    websiteLiabilityCapInrMinor: 1_000_000,
  },
  retention: { leadsMonths: 12, emailLogMonths: 13, securityLogMonths: 13, financialYears: 10 },
  flags: {
    dpdpReadinessPage: false,
    weeklyDigest: true,
    blogEnabled: true,
    calComUrl: null,
    whatsappNumber: null,
    ga4Id: null,
  },
  gateways: { razorpay: { mode: "test" }, stripe: { mode: "test" }, paypal: { mode: "test" } },
  email: {
    senders: {
      hello: "hello@techaust.com",
      billing: "billing@techaust.com",
      noReply: "no-reply@techaust.com",
    },
    replyTo: "contact@techaust.com",
    bccOwner: {},
    footerText: "TecHaust Technologies · Balurghat, West Bengal, India · contact@techaust.com",
  },
};

/**
 * The admin Worker's settings API (M3.1): parses the defaults of every settings schema once, so the first Settings request
 * does not pay for building them. Returns how many parsed (8: company, tax, numbering, payment terms, retention, flags,
 * gateways, email).
 */
export function warmSettings(): number {
  try {
    let n = 0;
    for (const key of Object.keys(SETTINGS_SCHEMAS) as SeededSettingKey[]) {
      n += SETTINGS_SCHEMAS[key].safeParse(SETTINGS_DEFAULTS[key]).success ? 1 : 0;
    }
    return n;
  } catch {
    return 0; // never stop a Worker from starting
  }
}
