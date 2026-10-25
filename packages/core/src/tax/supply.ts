// Supply type and place of supply [ADM-INV-05, docs/05 §10, docs/08 G-7, G-8]. VERIFY WITH CA/LEGAL:
// - a registered recipient: the place of supply is the state of the GSTIN (s.12(2)(a) IGST Act); a different state on the
//   record is a warning;
// - an unregistered recipient: the state on the record (s.12(2)(b)); a missing state is an error;
// - an overseas recipient: an export of services (s.2(6), s.13(2)), place of supply code 96, under LUT or with IGST paid;
// - the other place-of-supply rules (s.12(3) to (14)) are treated as not applying; a person may override with a reason.
import { clientTaxCheck, type TaxInput } from "../clients.ts";
import { fyOfDate, isValidDate } from "../dates.ts";
import { EXPORT_PLACE_OF_SUPPLY, isStateCode, type StateCode } from "../gstin.ts";
import type { Currency } from "../money.ts";
import {
  type CalendarDate,
  type ExportMode,
  fail,
  issue,
  ok,
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

/** The letters of undertaking the settings hold today: `tax.lut` is one entry, so a list of 0 or 1 (M5.2 makes it a list). */
export function lutsOf(tax: TaxContext["tax"]): { fy: string; arn: string }[] {
  const { arn, fy } = tax.lut;
  return arn && fy ? [{ fy, arn }] : [];
}

const OVERRIDE_REASON_MAX = 500;

/** Checks an override: domestic recipients only, a known state code, a reason of 1 to 500 characters. */
function overrideIssues(override: PlaceOfSupplyOverride, overseas: boolean): TaxIssue[] {
  const issues: TaxIssue[] = [];
  if (overseas) issues.push(issue("pos_override_not_domestic", "placeOfSupplyOverride"));
  if (!isStateCode(override.code)) {
    issues.push(issue("pos_override_invalid_state", "placeOfSupplyOverride", "code"));
  }
  const reason = override.reason.trim();
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
  const errors: TaxIssue[] = [];
  const warnings: TaxWarning[] = [];
  if (!isValidDate(opts.documentDate)) errors.push(issue("date_invalid", "documentDate"));
  const check = clientTaxCheck(recipient);
  if (!check.ok) errors.push(issue(check.code, "recipient"));
  const override = opts.placeOfSupplyOverride ?? null;
  const overseas = recipient.gstStatus === "overseas";
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
