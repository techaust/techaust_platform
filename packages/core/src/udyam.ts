// The Udyam registration number (T10; ADM-SET-01, ADM-INV-01): saved in Settings › Company and printed on tax invoices only (owner, 2026-10-31; 07-ZC
// line 6). Pure, no zod: the settings schema and the admin's issuer block read the live rule; the PDF envelope reads a sealed block by its shape only. Printing it is the owner's choice, not a legal
// requirement: Researched 2026-10-30, MSMED ss.15–16 (08-C RB-39(a)).

/**
 * The shape of a Udyam registration number, canonical form only (upper case, no spaces): `UDYAM-XX-00-0000000` (two letters for the state, two digits, seven
 * digits). The form trims and upper-cases what is typed; the schema accepts only this (L5: shape only, no cross-check with the GSTIN's state).
 * OPEN (08-C RB-39): is UDYAM-XX-00-0000000 the official format? The Udyam portal and the MSME notification were not read; this is the shape of the owner's
 * own number and of 07-ZC line 4.
 */
export const UDYAM_NUMBER_RE = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;

/**
 * The one check of a number's shape (second review 5b): the settings schema refines with it and `isUdyam` (the live settings value) reads it, so the shape
 * lives here only. Never applied to a sealed block (`isSealedUdyam`).
 */
export const isUdyamNumber = (n: unknown): n is string => typeof n === "string" && UDYAM_NUMBER_RE.test(n);

/** 07-ZC line 4, the error for a number of any other shape (APPROVED by the owner, 2026-10-31): one text for the settings schema and the company form (code review 5). */
export const UDYAM_NUMBER_ERROR = "Enter the number as UDYAM-XX-00-0000000.";

/** The enterprise categories (L3): stored as a key, printed as the words of `@techaust/pdf/copy` (07-ZC line 5). Default `micro` (owner, 2026-10-29: a micro enterprise). */
export const UDYAM_CATEGORIES = ["micro", "small", "medium"] as const;
export type UdyamCategory = (typeof UDYAM_CATEGORIES)[number];

/** The Udyam block as Settings › Company stores it and a tax invoice's issuer block freezes it (`company.udyam`). */
export type Udyam = { readonly number: string; readonly category: UdyamCategory };

/** The one document type that prints the Udyam line (owner, 2026-10-31): the tax invoice (ordinary, for a payment received, automatic care). Export invoices, proformas and notes leave it off. */
export const UDYAM_PRINTED_ON = "tax_invoice";
export const udyamPrintedOn = (type: string): boolean => type === UDYAM_PRINTED_ON;

/**
 * True when `v` is a Udyam block of the canonical shape, by TODAY's rule (`UDYAM_NUMBER_RE`, `UDYAM_CATEGORIES`): for live inputs only (Settings › Company
 * read back without zod). A block frozen into an issued document is read with `isSealedUdyam` instead.
 */
export function isUdyam(v: unknown): v is Udyam {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  return (
    keys.length === 2 &&
    isUdyamNumber(o.number) &&
    typeof o.category === "string" &&
    (UDYAM_CATEGORIES as readonly string[]).includes(o.category)
  );
}

/**
 * The Udyam block as an issued document froze it (final re-check, lead triage): what was valid on the day of issue. The number's format and the categories
 * may change later (OPEN (08-C RB-39)), so a sealed block is never read with today's rule; the seal hash protects its content.
 */
export type SealedUdyam = { readonly number: string; readonly category: string };

/** The bound on each sealed value, in UTF-16 units (a canonical number is 19, the longest category key 6): a sanity bound, not a format rule. */
export const SEALED_UDYAM_MAX = 40;

const sealedText = (s: unknown): s is string =>
  typeof s === "string" && s.trim().length > 0 && s.length <= SEALED_UDYAM_MAX;

/**
 * True when `v` has the shape of a sealed Udyam block: exactly `number` and `category`, each a non-blank string of at most `SEALED_UDYAM_MAX` units. Shape
 * only, never `UDYAM_NUMBER_RE` or `UDYAM_CATEGORIES`: a later change to either must never refuse an invoice issued before it.
 */
export function isSealedUdyam(v: unknown): v is SealedUdyam {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return Object.keys(o).length === 2 && sealedText(o.number) && sealedText(o.category);
}
