// Supply type and place of supply [ADM-INV-05, docs/05 §10, docs/08 G-7, G-8]. VERIFY WITH CA/LEGAL:
// - a registered recipient: the place of supply is the state of the GSTIN (s.12(2)(a) IGST Act); a different state on the
//   record is a warning;
// - an unregistered recipient: the state on the record (s.12(2)(b)); a missing state is an error;
// - an overseas recipient: an export of services (s.2(6), s.13(2)), place of supply code 96, under LUT or with IGST paid;
// - the other place-of-supply rules (s.12(3) to (14)) are treated as not applying; a person may override with a reason.
import { clientTaxCheck, type TaxInput } from "../clients.ts";
import { fyOfDate, isValidDate } from "../dates.ts";
import { EXPORT_PLACE_OF_SUPPLY, isStateCode, type StateCode, selectableStates } from "../gstin.ts";
import type { Currency } from "../money.ts";
import {
  type CalendarDate,
  EXPORT_MODES,
  type ExportMode,
  fail,
  guard,
  issue,
  ok,
  RECIPIENT_STATUSES,
  type RecipientStatus,
  SUPPLY_TYPES,
  type Supply,
  type TaxContext,
  type TaxIssue,
  type TaxResult,
  type TaxWarning,
  warn,
} from "./types.ts";

export type PlaceOfSupplyOverride = { readonly code: string; readonly reason: string };

export type SupplyOptions = {
  /** The document date: it picks the FY for the LUT check. */
  readonly documentDate: CalendarDate;
  readonly currency: Currency;
  /** This document's export mode; missing means the settings' (`tax.exportMode`). */
  readonly exportMode?: ExportMode | undefined;
  readonly placeOfSupplyOverride?: PlaceOfSupplyOverride | null | undefined;
};

/**
 * The letters of undertaking the settings hold: the `luts` list (M5.2) and, when set, the one legacy `tax.lut` of M3 unless its FY is already listed
 * (a stored row must keep working and a saved letter must never vanish).
 */
export function lutsOf(tax: TaxContext["tax"]): { fy: string; arn: string }[] {
  const out = tax.luts.map(({ fy, arn }) => ({ fy, arn }));
  const { arn, fy } = tax.lut;
  if (arn && fy && !out.some((l) => l.fy === fy)) out.push({ fy, arn });
  return out;
}

const OVERRIDE_REASON_MAX = 500;

/**
 * A date the engine can use: a real calendar date whose financial year can be built. `isValidDate` allows years 100 to 9999
 * (years 1 to 99 are not real dates for it); the FY of 1 April 9999 onwards would start in 9999, which `financialYear`
 * refuses, so those dates are refused too.
 */
export function usableDate(date: CalendarDate): boolean {
  if (!isValidDate(date)) return false;
  try {
    fyOfDate(date);
    return true;
  } catch {
    return false;
  }
}

/**
 * The warnings of a fixed supply (debit notes, inclusive splits, an estimate turned into an invoice; credit notes don't raise them yet, M5.3): the same
 * LUT check `determineSupply` makes. The document date picks the FY.
 */
export function fixedSupplyWarnings(
  supply: Supply,
  documentDate: CalendarDate,
  ctx: TaxContext,
): TaxWarning[] {
  if (supply.type !== "export_lut") return [];
  const token = fyOfDate(documentDate).token;
  return ctx.luts.some((l) => l.fy === token) ? [] : [warn("lut_missing_for_fy", "supply", "type")];
}

/**
 * Checks the recipient status given beside a fixed supply: a known value, and an overseas recipient goes with an export,
 * the others with a domestic supply. A missing status is fine (the B2C warning is then simply not given).
 */
export function recipientStatusIssues(
  status: RecipientStatus | undefined,
  supply: Supply,
  ...path: (string | number)[]
): TaxIssue[] {
  if (status === undefined) return [];
  if (!RECIPIENT_STATUSES.includes(status)) return [issue("supply_invalid", ...path)];
  const isExport = supply.type === "export_lut" || supply.type === "export_igst";
  return (status === "overseas") === isExport ? [] : [issue("supply_invalid", ...path)];
}

/**
 * Checks a fixed supply (credit and debit notes, an estimate turned into an invoice): a known type, a known place of supply
 * and supplier state, and a place of supply that fits the type. It is NOT compared with today's supplier state: a note on
 * an old invoice keeps the original's.
 */
export function supplyIssues(supply: Supply, ...path: (string | number)[]): TaxIssue[] {
  const bad = [issue("supply_invalid", ...path)];
  if (!SUPPLY_TYPES.includes(supply.type)) return bad;
  if (!isStateCode(supply.supplierStateCode)) return bad;
  const pos = supply.placeOfSupplyCode;
  if (supply.type === "export_lut" || supply.type === "export_igst") {
    return pos === EXPORT_PLACE_OF_SUPPLY ? [] : bad;
  }
  if (!isStateCode(pos)) return bad;
  return (pos === supply.supplierStateCode) === (supply.type === "intra") ? [] : bad;
}

/** Checks an override: domestic recipients only, a state code that can be picked today, a reason of 1 to 500 characters. */
function overrideIssues(override: PlaceOfSupplyOverride, overseas: boolean): TaxIssue[] {
  const issues: TaxIssue[] = [];
  if (overseas) issues.push(issue("pos_override_not_domestic", "placeOfSupplyOverride"));
  if (!selectableStates().some((state) => state.code === override.code)) {
    issues.push(issue("pos_override_invalid_state", "placeOfSupplyOverride", "code"));
  }
  const reason = typeof override.reason === "string" ? override.reason.trim() : "";
  if (reason.length < 1 || reason.length > OVERRIDE_REASON_MAX) {
    issues.push(issue("pos_override_reason_required", "placeOfSupplyOverride", "reason"));
  }
  return issues;
}

/**
 * The supply of a document to this recipient: the type (intra, inter, export under LUT, export with IGST paid), the place of
 * supply and the supplier's state. The recipient is checked with `clientTaxCheck` (its error codes pass through unchanged).
 */
export function determineSupply(
  recipient: TaxInput,
  ctx: TaxContext,
  opts: SupplyOptions,
): TaxResult<Supply> {
  return guard(() => supplyFor(recipient, ctx, opts));
}

function supplyFor(recipient: TaxInput, ctx: TaxContext, opts: SupplyOptions): TaxResult<Supply> {
  const errors: TaxIssue[] = [];
  const warnings: TaxWarning[] = [];
  if (!usableDate(opts.documentDate)) errors.push(issue("date_invalid", "documentDate"));
  if (!isStateCode(ctx.supplierStateCode)) errors.push(issue("supply_invalid", "ctx", "supplierStateCode"));
  const check = clientTaxCheck(recipient);
  if (!check.ok) errors.push(issue(check.code, "recipient"));
  const override = opts.placeOfSupplyOverride ?? null;
  const overseas = recipient.gstStatus === "overseas";
  // A mode is for exports only, and only the settings' two values exist: anything else would silently mean IGST.
  if (opts.exportMode !== undefined && (!overseas || !EXPORT_MODES.includes(opts.exportMode))) {
    errors.push(issue("supply_invalid", "exportMode"));
  }
  if (override) errors.push(...overrideIssues(override, overseas));
  if (!check.ok || errors.length > 0) return fail(errors);

  if (overseas) {
    const mode = opts.exportMode ?? ctx.tax.exportMode;
    if (opts.currency === "INR") warnings.push(warn("export_in_inr", "currency"));
    if (mode === "lut") {
      const token = fyOfDate(opts.documentDate).token;
      if (!ctx.luts.some((l) => l.fy === token)) warnings.push(warn("lut_missing_for_fy", "exportMode"));
    }
    return ok(
      {
        type: mode === "lut" ? "export_lut" : "export_igst",
        placeOfSupplyCode: EXPORT_PLACE_OF_SUPPLY,
        supplierStateCode: ctx.supplierStateCode,
      },
      warnings,
    );
  }

  for (const w of check.warnings) warnings.push(warn(w.code, "recipient", "stateCode"));
  // A registered recipient has a GSTIN, so its state wins; an unregistered one has the state on the record.
  let pos = (check.gstin ? check.gstin.slice(0, 2) : check.stateCode) as StateCode;
  if (override) {
    pos = override.code as StateCode;
    warnings.push(warn("pos_overridden", "placeOfSupplyOverride"));
  }
  return ok(
    {
      type: pos === ctx.supplierStateCode ? "intra" : "inter",
      placeOfSupplyCode: pos,
      supplierStateCode: ctx.supplierStateCode,
    },
    warnings,
  );
}
