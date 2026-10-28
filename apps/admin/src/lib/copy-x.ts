// 07-X (M5 owner fixes): the lines the fix task added, PENDING the owner (docs/07-content-appendix/X-m5-owner-fixes.md). Each one shows the
// "[Placeholder] " mark before the designer's recommended words until the owner approves the page; then `APPROVED_07X` turns true and the
// marks go (the M5.4 pattern). Its own module, so the Catalogue screens can mark their line without loading the proposal screens' words.

export const APPROVED_07X = false;
export const PLACEHOLDER_MARK = "[Placeholder]";
/** A 07-X line as the screen shows it: marked until the owner approves 07-X. */
export const X = (line: string): string => (APPROVED_07X ? line : `${PLACEHOLDER_MARK} ${line}`);

/** §4.2 (sweep finding 9): under the Catalogue's "Deliverables, assumptions and exclusions", what the three texts are for. */
export const CATALOGUE_TEXTS_HINT = X(
  "A new proposal or estimate takes its Deliverables section, and its Assumptions and exclusions section, from these texts. Where a text is empty, the section is hidden and the draft says so.",
);
