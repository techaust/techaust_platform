// Which GSTR-1 section a document belongs to (M5.5a; ADM-REP-04, ADM-INV-17 thresholds). Every rule is Researched 2026-10-28, GSTN advisories of June 2025 (08-C RA-23)
// (docs/08-research-appendix/A-gst-invoicing.md §4, §8). Pure and never throws.
import { validateGstin } from "../gstin.ts";
import {
  fail,
  type GstResult,
  isNonNegInt,
  issue,
  type NoteParent,
  ok,
  type Path,
  type RecipientStatus,
  type SupplyType,
} from "./types.ts";

/** The B2CL threshold: an inter-state invoice to an unregistered person above this value, in INR minor units (Rs 1,00,000). */
export const DEFAULT_B2CL_THRESHOLD_INR_MINOR = 1_00_000_00;

export type InvoiceSection = "b2b" | "b2cl" | "b2cs" | "exp";
/** The sections of a note: a credit or debit note to a registered person, to others, or netted into the B2CS table. */
export type NoteSection = "cdnr" | "cdnur" | "b2cs";
/** The "UR Type" of the CDNUR table. */
export type UrType = "B2CL" | "EXPWOP" | "EXPWP";

/** What the section depends on (an invoice, or the parent of a note). */
export type ClassifyInput = {
  readonly supplyType: SupplyType;
  readonly recipientStatus: RecipientStatus;
  readonly gstin: string | null;
  readonly totalInrMinor: number;
};

export type NoteClass = { readonly section: NoteSection; readonly urType: UrType | null };

/**
 * The section of an invoice. An export (under LUT or with IGST, INR or foreign currency) is `exp`; a registered recipient is
 * `b2b` and needs a valid GSTIN; an unregistered one with an inter-state supply of strictly more than the threshold is
 * `b2cl`; everything else is `b2cs`.
 */
export function classifyInvoice(
  input: ClassifyInput,
  thresholdInrMinor: number,
  path: Path = [],
): GstResult<InvoiceSection> {
  if (!isNonNegInt(thresholdInrMinor))
    return fail([issue("threshold_invalid", "params", "b2clThresholdInrMinor")]);
  if (input.supplyType === "export_lut" || input.supplyType === "export_igst") return ok("exp");
  if (input.recipientStatus === "registered") {
    if (input.gstin === null || input.gstin === "") return fail([{ code: "gstin_missing", path }]);
    return validateGstin(input.gstin).ok ? ok("b2b") : fail([{ code: "gstin_invalid", path }]);
  }
  if (
    input.recipientStatus === "unregistered" &&
    input.supplyType === "inter" &&
    input.totalInrMinor > thresholdInrMinor
  ) {
    return ok("b2cl");
  }
  return ok("b2cs");
}

/**
 * The section of a credit or debit note, by the section of its parent invoice (same threshold): a B2B parent gives `cdnr`, a
 * B2CL parent `cdnur` (UR type B2CL), an export parent `cdnur` (EXPWOP under LUT, EXPWP with IGST), a B2CS parent nets the
 * note into the B2CS table. The note's own recipient GSTIN is the one checked. No parent is `parent_missing`.
 */
export function classifyNote(
  note: { readonly gstin: string | null; readonly noteOf: NoteParent | null },
  thresholdInrMinor: number,
  path: Path = [],
): GstResult<NoteClass> {
  if (note.noteOf === null) return fail([{ code: "parent_missing", path }]);
  const parent = classifyInvoice(
    {
      supplyType: note.noteOf.supplyType,
      recipientStatus: note.noteOf.recipientStatus,
      gstin: note.gstin,
      totalInrMinor: note.noteOf.totalInrMinor,
    },
    thresholdInrMinor,
    path,
  );
  if (!parent.ok) return parent;
  switch (parent.value) {
    case "b2b":
      return ok({ section: "cdnr", urType: null });
    case "b2cl":
      return ok({ section: "cdnur", urType: "B2CL" });
    case "exp":
      return ok({ section: "cdnur", urType: note.noteOf.supplyType === "export_lut" ? "EXPWOP" : "EXPWP" });
    default:
      return ok({ section: "b2cs", urType: null });
  }
}
