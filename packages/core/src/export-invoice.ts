// What an export invoice and a proforma need beyond a domestic tax invoice (M5.2; ADM-INV-10, ADM-INV-18, G-6, G-8, U-1, 08-A §8), pure: no I/O, no zod,
// no floats. Exported through `@techaust/core/invoices`. EVERY RULE AND EVERY WORD HERE IS A RESEARCHED DEFAULT: Researched 2026-10-28, s.2(6) IGST Act, Rule 46 (08-C RA-18).
import {
  addDays,
  daysBetween,
  financialYear,
  fromIst,
  fyOfDate,
  istDate,
  parseIsoDate,
  toIsoDate,
} from "./dates.ts";

/**
 * The Rule 46 export endorsement, one line per route, in capitals as the rule gives it (07-S §1; word for word from 08-A §8 :344-348). Frozen and
 * sealed in the invoice header at issue, and checked byte for byte before the PDF is rendered (LD33). Researched 2026-10-28, s.2(6) IGST Act, Rule 46 (08-C RA-18: the endorsement texts as built).
 * OPEN (08-C RA-18): the IGST-route wording is verified only up to "... ON PAYMENT OF INTEGRATED TAX" (08-A :346).
 */
export const EXPORT_ENDORSEMENT = {
  lut: "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX",
  igst_paid:
    "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS ON PAYMENT OF INTEGRATED TAX",
} as const;
export type ExportRoute = keyof typeof EXPORT_ENDORSEMENT;

/** What a proforma must say about itself (07-S §2; Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17)): it is not a tax invoice. Frozen in the header and checked before rendering. */
export const PROFORMA_NOTICE =
  "This is not a tax invoice. A tax invoice will be issued when payment is received.";

/**
 * FX-4 (audit A5 5): a proforma's GST is an estimate, not a firm figure (Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28): a proforma is not
 * a tax document; its GST is shown as an estimate). Every proforma issued from FX-4 on carries `proforma.gstEstimate: true` in its sealed header
 * (`header_extras`), so the PDF, the admin view and the portal label its tax heads "(estimate)"; a proforma sealed before it has no marker and prints
 * exactly as it was issued. Only the literal `true` counts: anything else (absent, false, a string) is no marker.
 */
export const isGstEstimate = (proforma: { readonly gstEstimate?: unknown } | null | undefined): boolean =>
  proforma?.gstEstimate === true;

/**
 * The same marker read from the stored `documents.header_extras` text (the portal reads the frozen row, not the R2 envelope): false for null, text
 * that is not a JSON object, or an object without the marker. Pure.
 */
export function gstEstimateOfHeaderExtras(text: string | null | undefined): boolean {
  if (typeof text !== "string") return false;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return false;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const p = (v as { proforma?: unknown }).proforma;
  return typeof p === "object" && p !== null && isGstEstimate(p as { gstEstimate?: unknown });
}

// ---- letters of undertaking (G-8, U-1; ADM-INV-18) ---------------------------------------------------------------------------------------

/** One saved letter of undertaking: the FY token ("2627") and the ARN from the GST portal (its format is NOT VERIFIED, so only a safe shape is checked). */
export type Lut = { readonly fy: string; readonly arn: string; readonly filedOn?: string | null };

/** The letter for a financial year (the token, "2627"), or null. A Lut without an ARN does not count. */
export function lutFor(fyToken: string, luts: readonly Lut[]): { fy: string; arn: string } | null {
  const hit = luts.find((l) => l.fy === fyToken && l.arn.trim() !== "");
  return hit ? { fy: hit.fy, arn: hit.arn } : null;
}

/** The route the tax invoice for a payment received may take (Q37, owner 2026-10-28), as the API names it: `igst` is the engine's `igst_paid`. */
export type AdvanceRouteChoice = "lut" | "igst";

export type AdvanceRoute =
  | {
      readonly ok: true;
      readonly route: ExportRoute;
      /** The FY of the receipt day, as its token ("2627") and its label ("2026-27"): the LUT of THIS year is the one that is needed. */
      readonly fy: string;
      readonly fyLabel: string;
      /** The proforma was under LUT, this invoice is issued with IGST and no LUT is saved for the receipt year: the PDF says so (07-S section 9). */
      readonly igstNoLut: boolean;
    }
  | {
      readonly ok: false;
      readonly code: "advance_lut_missing";
      readonly fy: string;
      readonly fyLabel: string;
    }
  | { readonly ok: false; readonly code: "advance_route_invalid" };

/**
 * The route of a tax invoice for a payment received, judged by the FY of the day the payment arrived (the time of supply of an advance, s.13(2) CGST),
 * not by the day the invoice is issued (Q37; Researched 2026-10-28, Rule 96A "prior to export", 08-C RA-19). `proformaRoute` is the proforma's own;
 * `requested` is the Owner's pick (omitted: the proforma's). The LUT route needs a LUT saved for the receipt FY, else `advance_lut_missing`; the Owner
 * then saves the LUT or asks for the IGST route. An LUT route on a proforma that charged IGST is refused (`advance_route_invalid`: a payment cannot
 * move from tax charged to none). An unreadable date is `advance_route_invalid`.
 */
export function advanceRouteFor(input: {
  readonly proformaRoute: ExportRoute;
  readonly requested?: AdvanceRouteChoice | null;
  readonly receivedOn: string;
  readonly luts: readonly Lut[];
}): AdvanceRoute {
  const d = parseIsoDate(input.receivedOn);
  if (!d) return { ok: false, code: "advance_route_invalid" };
  const fy = fyOfDate(d);
  const want: ExportRoute =
    input.requested === "igst" ? "igst_paid" : input.requested === "lut" ? "lut" : input.proformaRoute;
  if (want === "lut" && input.proformaRoute === "igst_paid")
    return { ok: false, code: "advance_route_invalid" };
  const hasLut = lutFor(fy.token, input.luts) !== null;
  if (want === "lut" && !hasLut)
    return { ok: false, code: "advance_lut_missing", fy: fy.token, fyLabel: fy.label };
  return {
    ok: true,
    route: want,
    fy: fy.token,
    fyLabel: fy.label,
    igstNoLut: want === "igst_paid" && input.proformaRoute === "lut" && !hasLut,
  };
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

/** The most letters the `luts` list keeps. */
export const LUTS_MAX = 20;

/** A letter as the list stores it. */
export type LutEntry = { fy: string; arn: string; filedOn: string | null };

/** The ARN as the list keeps it: spaces dropped, upper case (the twin of the `lutEntry` schema's transform). */
export const normaliseLutArn = (arn: string): string => arn.replace(/\s+/g, "").toUpperCase();

/** True for a year token of two consecutive years ("2627"). */
const lutFyOk = (fy: string): boolean =>
  fy.length === 4 &&
  [...fy].every((ch) => ch >= "0" && ch <= "9") &&
  (Number(fy.slice(0, 2)) + 1) % 100 === Number(fy.slice(2));

type LegacyLutTax = {
  readonly lut: { readonly arn: string | null; readonly fy: string | null };
  readonly luts: readonly { readonly fy: string; readonly arn?: string; readonly filedOn?: string | null }[];
};

/**
 * What becomes of the deprecated single `lut` of M3 (review 2, finding 9: the ONE rule; the settings fold, `lutsOf` and the stored-row reader all ask it, pure and
 * without zod): `none` (no letter in it), `listed` (its FY already has a list entry: the entry wins), `invalid` (the list would refuse it: an ARN that is not 1 to 30
 * letters or digits once normalised, or a year that is not two consecutive years), `full` (the list already holds 20) or `folded` (it counts as this list entry).
 * Researched 2026-10-28, Rule 96A CGST Rules (08-C RA-19: one LUT per FY). OPEN (08-C RA-19): the ARN's format, so only 1 to 30 letters and digits are checked.
 */
export type LegacyLutFate =
  | { fate: "none" | "listed" | "invalid" | "full" }
  | { fate: "folded"; entry: LutEntry };

export function legacyLutFate(tax: LegacyLutTax): LegacyLutFate {
  const { arn, fy } = tax.lut;
  if (!arn || !fy) return { fate: "none" };
  if (tax.luts.some((l) => l.fy === fy)) return { fate: "listed" };
  const norm = normaliseLutArn(arn);
  if (!lutFyOk(fy) || !/^[A-Z0-9]{1,30}$/.test(norm)) return { fate: "invalid" };
  if (tax.luts.length >= LUTS_MAX) return { fate: "full" };
  return { fate: "folded", entry: { fy, arn: norm, filedOn: null } };
}

/**
 * The saved letters, read from the stored `tax` settings value WITHOUT zod (the jobs Worker must not bring zod in): the `luts` list, and the one
 * legacy `lut {arn, fy}` of M3 when `legacyLutFate` says it counts. Anything malformed is skipped, never thrown.
 */
export function lutsFromStoredTax(json: unknown): { fy: string; arn: string }[] {
  const tax = isRecord(json) ? json : {};
  const list: { fy: string; arn: string }[] = [];
  if (Array.isArray(tax.luts))
    for (const l of tax.luts) {
      if (!isRecord(l) || typeof l.fy !== "string" || typeof l.arn !== "string") continue;
      if (!/^\d{4}$/.test(l.fy) || l.arn.trim() === "" || list.some((x) => x.fy === l.fy)) continue;
      list.push({ fy: l.fy, arn: l.arn });
    }
  const legacy = isRecord(tax.lut) ? tax.lut : {};
  const fate = legacyLutFate({
    lut: {
      arn: typeof legacy.arn === "string" ? legacy.arn : null,
      fy: typeof legacy.fy === "string" ? legacy.fy : null,
    },
    luts: list,
  });
  return fate.fate === "folded" ? [...list, { fy: fate.entry.fy, arn: fate.entry.arn }] : list;
}

/** SQLite's `trim(x)` with no second argument: only spaces (U+0020) are taken off, never tabs or line breaks. */
const sqlTrim = (s: string): string => s.replace(/^ +| +$/g, "");

/**
 * rt1 review 6 (Researched 2026-10-30, Rule 96A(1) CGST Rules, Notification 37/2017-CT (08-C RA-19, Q39)): the letter a debit note on an export under LUT relies on, judged
 * EXACTLY as db `LUT_FOR_FY_SQL` judges the stored `tax` row (the freeze WHERE and the trigger `documents_debit_note_lut_fy`, 0054), so the blocker the screen shows and the
 * refusal of the issue never disagree (a db test runs both over the same rows). A list entry of that FY whose ARN is not blank once its spaces are trimmed; else the one
 * legacy `lut` of M3 with that FY and such an ARN, whatever `legacyLutFate` says of it (an ARN the list would refuse, a full list: SQL counts them, so this counts them).
 * The legacy ARN is returned as the list keeps one (`normaliseLutArn`), or as stored when that would leave nothing. Null: none.
 */
export function lutForFyAsSql(
  fyToken: string,
  tax: {
    readonly lut: LegacyLutTax["lut"];
    readonly luts: readonly { readonly fy: string; readonly arn: string }[];
  },
): { fy: string; arn: string } | null {
  const listed = tax.luts.find((l) => l.fy === fyToken && sqlTrim(l.arn) !== "");
  if (listed) return { fy: listed.fy, arn: listed.arn };
  const { arn, fy } = tax.lut;
  if (fy !== fyToken || arn === null || sqlTrim(arn) === "") return null;
  return { fy, arn: normaliseLutArn(arn) || arn };
}

/** The export route stored in a `tax` settings value (`exportMode`), read WITHOUT zod; anything else is the default, the LUT route (G-8). */
export function exportModeFromStoredTax(json: unknown): ExportRoute {
  return isRecord(json) && json.exportMode === "igst_paid" ? "igst_paid" : "lut";
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * `invoiceAlertDays` of a stored `tax` settings value (G-5), read WITHOUT zod: a whole number from 1 to 30, else the default 25 (the jobs Worker's daily alerts must not
 * stop because a row fails the schema).
 */
export function alertDaysFromStoredTax(json: unknown): number {
  const days = isRecord(json) ? json.invoiceAlertDays : undefined;
  return typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 30 ? days : 25;
}

/** The export realisation rules (FEMA 2026 and Rule 96A; Q15, Researched 2026-10-28, FEMA 23(R)/2026-RB Reg. 5(1) (08-C RB-01)) as the Workers read them: no zod, no floats. */
export type StoredRealisationParams =
  | {
      readonly ok: true;
      readonly femaMonthsForeign: number;
      readonly femaMonthsInr: number;
      readonly gstMonths: number;
      readonly gstExtraDays: number;
      readonly approachingDays: 30;
    }
  | { readonly ok: false };

/**
 * `tax.realisation` of a stored `tax` settings value read WITHOUT zod (LD77), for the jobs Worker and the admin API (the GST core is
 * SPA only, LD16): `warnMonths` (foreign), `inrMonths`, `escalateMonths` and `escalateExtraDays`. A missing key is its default (9, 12,
 * 12, 15); a key of the wrong type, not a whole number, or outside the limits of `realisationRulesOf` makes the whole answer
 * `{ ok: false }`, so a caller skips the scan with a log line instead of guessing. The twin of `realisationRulesOf` (a table test).
 */
export function realisationParamsFromStoredTax(json: unknown): StoredRealisationParams {
  const tax = isRecord(json) ? json : {};
  const raw = tax.realisation;
  if (raw !== undefined && !isRecord(raw)) return { ok: false };
  const r = raw ?? {};
  const pick = (key: string, fallback: number, min: number, max: number): number | null => {
    const v = r[key];
    if (v === undefined) return fallback;
    return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : null;
  };
  const femaMonthsForeign = pick("warnMonths", 9, 1, 1200);
  const femaMonthsInr = pick("inrMonths", 12, 1, 1200);
  const gstMonths = pick("escalateMonths", 12, 1, 1200);
  const gstExtraDays = pick("escalateExtraDays", 15, 0, 36_500);
  if (femaMonthsForeign === null || femaMonthsInr === null || gstMonths === null || gstExtraDays === null) {
    return { ok: false };
  }
  return { ok: true, femaMonthsForeign, femaMonthsInr, gstMonths, gstExtraDays, approachingDays: 30 };
}

/**
 * `b2clThresholdInrMinor` of a stored `tax` value, read WITHOUT zod: missing is Rs 1,00,000.00 (Q18); a value that is not a positive
 * safe integer is `null` (the caller refuses the report instead of filing with a guessed threshold).
 */
export function b2clThresholdFromStoredTax(json: unknown): number | null {
  const v = isRecord(json) ? json.b2clThresholdInrMinor : undefined;
  if (v === undefined) return 1_00_000_00;
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 1 ? v : null;
}

// ---- the daily LUT check (B3: the bell of ADM-INV-18, Q22, LD27) ---------------------------------------------------------------------------

export const LUT_CHECK_KIND = "lut.check";
/** `asOf` is the IST date the run is for. The cron adds one such message to its existing daily batch (no new cron, no new queue). */
export type LutCheckMessage = { kind: typeof LUT_CHECK_KIND; asOf: string };

/** The message the daily cron sends: the IST date of the run. */
export const lutCheckMessage = (scheduledTime: number): LutCheckMessage => ({
  kind: LUT_CHECK_KIND,
  asOf: toIsoDate(istDate(scheduledTime)),
});

/** True for a body that says `kind: "lut.check"` (a malformed one is acknowledged and logged, never a lead). */
export const isLutCheckKind = (body: unknown): boolean => isRecord(body) && body.kind === LUT_CHECK_KIND;

export function isLutCheckMessage(body: unknown): body is LutCheckMessage {
  return (
    isRecord(body) &&
    body.kind === LUT_CHECK_KIND &&
    typeof body.asOf === "string" &&
    parseIsoDate(body.asOf) !== null
  );
}

/** The Monday (ISO) of the week (Monday to Sunday) an ISO date falls in; null for a date that is not one. The weekly bell's key. */
export function weekMondayOf(iso: string): string | null {
  const d = parseIsoDate(iso);
  if (!d) return null;
  const days = daysBetween({ year: 1970, month: 1, day: 1 }, d); // whole days since 1970-01-01
  const sinceMonday = (days + 3) % 7; // 1 January 1970 was a Thursday
  return toIsoDate(addDays(d, -sinceMonday));
}

/**
 * What the daily check decides for one IST day and the saved letters: a bell for the owners, or null. In March while the next FY has no letter, the
 * "file next year's LUT" bell (entity `lut:<next FY>:<Monday>`); otherwise, while the running FY has no letter, the "missing" bell (entity
 * `lut:<running FY>:<Monday>`). One bell a week per owner (the entity carries the week), only then. Researched 2026-10-28, Rule 96A CGST Rules (08-C RA-19).
 */
export function lutBellFor(
  today: string,
  luts: readonly Lut[],
): { kind: "next_fy_due" | "current_missing"; fy: string; fyLabel: string; entity: string } | null {
  const r = lutReminder(today, luts);
  const monday = weekMondayOf(today);
  if (!r || !monday) return null;
  if (r.due)
    return { kind: "next_fy_due", fy: r.nextFy, fyLabel: r.nextFyLabel, entity: `lut:${r.nextFy}:${monday}` };
  if (r.currentMissing)
    return {
      kind: "current_missing",
      fy: r.currentFy,
      fyLabel: r.currentFyLabel,
      entity: `lut:${r.currentFy}:${monday}`,
    };
  return null;
}

// ---- an advance received against a proforma (Q9, G-6) ------------------------------------------------------------------------------------

/**
 * The payment reference in its one stored form: trimmed, upper case, spaces removed, 1 to 60 of `A-Z 0-9 / -`. Null when it cannot be one. Two
 * spellings of one reference give one key, so the same payment cannot be recorded twice (the unique key of `advance_receipts`).
 */
export function normaliseReference(text: string): string | null {
  const n = text.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9/-]{1,60}$/.test(n) ? n : null;
}

/** The RBI purpose code of a foreign-currency receipt, e.g. P0802 (08-A :365; the codes themselves are NOT VERIFIED here, OPEN (08-C RB-06): which RBI purpose code fits our exports? the bank confirms it). */
export const PURPOSE_CODE = /^P\d{4}$/;

/**
 * When the 25-day warning of a proforma for DELIVERED work starts (Rule 47: a tax invoice within 30 days of supply; ADM-INV-10, 08 G-5): the start of
 * the IST day `alertDays` after the IST day the milestone was delivered, in UTC ms.
 */
export function proformaWarnAt(deliveredAtMs: number, alertDays: number): number {
  return fromIst(addDays(istDate(deliveredAtMs), alertDays));
}

/**
 * The cutoff the unbilled-work and proforma-due readers bind (ADM-INV-19, ADM-INV-10; M5.4): a milestone delivered AT OR BEFORE this instant has reached
 * its warning (`proformaWarnAt(delivered, alertDays) <= nowMs`). It is the last millisecond before the start of the IST day `alertDays - 1` days before
 * today, so the day the warning opens is the 25th IST day after delivery: 23:59:59.999 the day before it is still quiet and 00:00 IST is not.
 */
export const unbilledCutoff = (nowMs: number, alertDays: number): number =>
  fromIst(addDays(istDate(nowMs), 1 - alertDays)) - 1;

/** The ISO form of `proformaWarnAt`'s day (for a screen). */
export const proformaWarnDate = (deliveredAtMs: number, alertDays: number): string =>
  toIsoDate(addDays(istDate(deliveredAtMs), alertDays));
