// The Udyam registration number (T10; ADM-SET-01, ADM-INV-01): saved in Settings › Company and printed on tax invoices only (owner, 2026-10-31; 07-ZC
// line 6). Pure, no zod: the settings schema, the admin's issuer block and the PDF envelope check all read these. Printing it is the owner's choice, not a legal
// requirement: Researched 2026-10-30, MSMED ss.15–16 (08-C RB-39(a)).

/**
 * The shape of a Udyam registration number, canonical form only (upper case, no spaces): `UDYAM-XX-00-0000000` (two letters for the state, two digits, seven
 * digits). The form trims and upper-cases what is typed; the schema accepts only this (L5: shape only, no cross-check with the GSTIN's state).
 * OPEN (08-C RB-39): is UDYAM-XX-00-0000000 the official format? The Udyam portal and the MSME notification were not read; this is the shape of the owner's
 * own number and of 07-ZC line 4.
 */
export const UDYAM_NUMBER_RE = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;

/** The enterprise categories (L3): stored as a key, printed as the words of `@techaust/pdf/copy` (07-ZC line 5). Default `micro` (owner, 2026-10-29: a micro enterprise). */
export const UDYAM_CATEGORIES = ["micro", "small", "medium"] as const;
export type UdyamCategory = (typeof UDYAM_CATEGORIES)[number];

/** The Udyam block as Settings › Company stores it and a tax invoice's issuer block freezes it (`company.udyam`). */
export type Udyam = { readonly number: string; readonly category: UdyamCategory };

/** The one document type that prints the Udyam line (owner, 2026-10-31): the tax invoice (ordinary, for a payment received, automatic care). Export invoices, proformas and notes leave it off. */
export const UDYAM_PRINTED_ON = "tax_invoice";
export const udyamPrintedOn = (type: string): boolean => type === UDYAM_PRINTED_ON;

/** True when `v` is a Udyam block of the canonical shape (a stored or frozen value read back without zod). */
export function isUdyam(v: unknown): v is Udyam {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  return (
    keys.length === 2 &&
    typeof o.number === "string" &&
    UDYAM_NUMBER_RE.test(o.number) &&
    typeof o.category === "string" &&
    (UDYAM_CATEGORIES as readonly string[]).includes(o.category)
  );
}
