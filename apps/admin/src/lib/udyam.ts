// The Udyam registration in Settings › Company (T10, rt2; ADM-SET-01): the words of 07-ZC lines 4 and 5 (APPROVED by the owner, 2026-10-31) and the pure rule
// the form follows. The form trims and upper-cases what is typed (L5) and always sends the key (L8): the block, or null to leave the line off. The shape is
// core's (`isUdyamNumber`, the same check the settings schema refines with); the category words are the PDF's own (`@techaust/pdf/copy`, L3), so the select and the
// printed line never differ. Printing it is the owner's choice, not a legal requirement: Researched 2026-10-30, MSMED ss.15–16 (08-C RB-39(a)).
import {
  isUdyamNumber,
  UDYAM_CATEGORIES,
  UDYAM_NUMBER_ERROR,
  type Udyam,
  type UdyamCategory,
} from "@techaust/core/invoices";
import { UDYAM_COPY } from "@techaust/pdf/copy";

/** 07-ZC line 4 (the number) and line 5 (the category). */
export const UDYAM_FORM_COPY = {
  label: "Udyam registration number",
  hint: "Printed on tax invoices. Leave it empty to leave it off.",
  /** Core's, the very text the settings schema answers with (code review 5). */
  error: UDYAM_NUMBER_ERROR,
  categoryLabel: "Enterprise category",
} as const;

/** The select's options in core's order, with line 5's words. */
export const UDYAM_OPTIONS: readonly { value: UdyamCategory; label: string }[] = UDYAM_CATEGORIES.map(
  (value) => ({
    value,
    label: UDYAM_COPY.categories[value],
  }),
);

/** What is typed, as the form sends it: trimmed and in capitals. */
export const normaliseUdyam = (typed: string): string => typed.trim().toUpperCase();

/** The form's two fields → the stored value: null when the number is empty (no line), the block when it has the canonical shape, else 07-ZC's error. */
export function udyamOf(
  typed: string,
  category: UdyamCategory,
): { ok: true; value: Udyam | null } | { ok: false; error: string } {
  const number = normaliseUdyam(typed);
  if (number === "") return { ok: true, value: null };
  if (!isUdyamNumber(number)) return { ok: false, error: UDYAM_FORM_COPY.error };
  return { ok: true, value: { number, category } };
}

/** The category a form starts with: the saved one, else micro (core's default, owner 2026-10-29). */
export const udyamCategoryOf = (saved: Udyam | null | undefined): UdyamCategory => saved?.category ?? "micro";
