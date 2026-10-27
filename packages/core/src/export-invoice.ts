// What an export invoice and a proforma need beyond a domestic tax invoice (M5.2; ADM-INV-10, ADM-INV-18, G-6, G-8, U-1, 08-A §8), pure: no I/O, no zod,
// no floats. Exported through `@techaust/core/invoices`. EVERY RULE AND EVERY WORD HERE IS A RESEARCHED DEFAULT: VERIFY WITH CA/LEGAL.
import { addDays, financialYear, fromIst, fyOfDate, istDate, parseIsoDate, toIsoDate } from "./dates.ts";

/**
 * The Rule 46 export endorsement, one line per route, in capitals as the rule gives it (07-S §1; word for word from 08-A §8 :344-348). Frozen and
 * sealed in the invoice header at issue, and checked byte for byte before the PDF is rendered (LD33). VERIFY WITH CA/LEGAL; the IGST-route wording
 * is NOT VERIFIED beyond "... ON PAYMENT OF INTEGRATED TAX" (08-A :346).
 */
export const EXPORT_ENDORSEMENT = {
  lut: "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX",
  igst_paid:
    "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS ON PAYMENT OF INTEGRATED TAX",
} as const;
export type ExportRoute = keyof typeof EXPORT_ENDORSEMENT;

/** What a proforma must say about itself (07-S §2; VERIFY WITH CA/LEGAL): it is not a tax invoice. Frozen in the header and checked before rendering. */
export const PROFORMA_NOTICE =
  "This is not a tax invoice. A tax invoice will be issued when payment is received.";

// ---- letters of undertaking (G-8, U-1; ADM-INV-18) ---------------------------------------------------------------------------------------

/** One saved letter of undertaking: the FY token ("2627") and the ARN from the GST portal (its format is NOT VERIFIED, so only a safe shape is checked). */
export type Lut = { readonly fy: string; readonly arn: string; readonly filedOn?: string | null };

/** The letter for a financial year (the token, "2627"), or null. A Lut without an ARN does not count. */
export function lutFor(fyToken: string, luts: readonly Lut[]): { fy: string; arn: string } | null {
  const hit = luts.find((l) => l.fy === fyToken && l.arn.trim() !== "");
  return hit ? { fy: hit.fy, arn: hit.arn } : null;
}

export type LutReminder = {
  /** The FY that is running, and the one after it, as tokens and as people read them ("2026-27"). */
  readonly currentFy: string;
  readonly currentFyLabel: string;
  readonly nextFy: string;
  readonly nextFyLabel: string;
  /** 1 to 31 March (IST) and the next FY has no letter yet: "File next year's LUT before 1 April" (Q22). */
  readonly due: boolean;
  /** The FY that is running has no letter (from 1 April, until one is saved). */
  readonly currentMissing: boolean;
};

/**
 * The reminders of ADM-INV-18 and Q22 for an IST day (`today`, ISO) and the saved letters: `due` through March while the next FY has none,
 * `currentMissing` while the running FY has none. An unreadable date gives neither.
 */
export function lutReminder(today: string, luts: readonly Lut[]): LutReminder | null {
  const d = parseIsoDate(today);
  if (!d) return null;
  const current = fyOfDate(d);
  const next = financialYear(current.startYear + 1);
  return {
    currentFy: current.token,
    currentFyLabel: current.label,
    nextFy: next.token,
    nextFyLabel: next.label,
    due: d.month === 3 && lutFor(next.token, luts) === null,
    currentMissing: lutFor(current.token, luts) === null,
  };
}

/**
 * The saved letters, read from the stored `tax` settings value WITHOUT zod (the jobs Worker must not bring zod in): the `luts` list, and the one
 * legacy `lut {arn, fy}` of M3 when set and its FY is not listed. Anything malformed is skipped, never thrown.
 */
export function lutsFromStoredTax(json: unknown): { fy: string; arn: string }[] {
  const out: { fy: string; arn: string }[] = [];
  const tax = isRecord(json) ? json : {};
  const add = (fy: unknown, arn: unknown) => {
    if (typeof fy !== "string" || !/^\d{4}$/.test(fy)) return;
    if (typeof arn !== "string" || arn.trim() === "") return;
    if (!out.some((l) => l.fy === fy)) out.push({ fy, arn });
  };
  if (Array.isArray(tax.luts)) for (const l of tax.luts) if (isRecord(l)) add(l.fy, l.arn);
  if (isRecord(tax.lut)) add(tax.lut.fy, tax.lut.arn);
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

// ---- an advance received against a proforma (Q9, G-6) ------------------------------------------------------------------------------------

/**
 * The payment reference in its one stored form: trimmed, upper case, spaces removed, 1 to 60 of `A-Z 0-9 / -`. Null when it cannot be one. Two
 * spellings of one reference give one key, so the same payment cannot be recorded twice (the unique key of `advance_receipts`).
 */
export function normaliseReference(text: string): string | null {
  const n = text.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9/-]{1,60}$/.test(n) ? n : null;
}

/** The RBI purpose code of a foreign-currency receipt, e.g. P0802 (08-A :365; the codes themselves are NOT VERIFIED here, VERIFY WITH CA/LEGAL). */
export const PURPOSE_CODE = /^P\d{4}$/;

/**
 * When the 25-day warning of a proforma for DELIVERED work starts (Rule 47: a tax invoice within 30 days of supply; ADM-INV-10, 08 G-5): the start of
 * the IST day `alertDays` after the IST day the milestone was delivered, in UTC ms.
 */
export function proformaWarnAt(deliveredAtMs: number, alertDays: number): number {
  return fromIst(addDays(istDate(deliveredAtMs), alertDays));
}

/** The ISO form of `proformaWarnAt`'s day (for a screen). */
export const proformaWarnDate = (deliveredAtMs: number, alertDays: number): string =>
  toIsoDate(addDays(istDate(deliveredAtMs), alertDays));
