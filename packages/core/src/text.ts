// Small text helpers shared by the Workers. Pure.

/** Escapes backslash, `%` and `_` so user text can sit inside a `LIKE ? ESCAPE '\'` pattern as plain characters. */
export const escapeLike = (s: string): string =>
  s.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

/** Escapes every character that means something in a regular expression, so the text matches as itself. */
export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One pattern for every occurrence of any of these texts, longest first (a text that holds another is matched whole), only where it
 * stands as a whole word: a letter, digit, underscore or combining mark (Indic vowel signs belong to a word) on either side is no
 * boundary, so "Ram" never matches inside "Ramp-up". The one definition for the view redactor and the contact rename. Case-sensitive by
 * default (the contact rename); `ignoreCase` also matches "ASHA RAO" and "Asha@Example.test" (the redactor: it only ever hides more; T7, Settled
 * by the lead on the safest reading, 2026-10-30 (08-C RB-37)).
 */
export const wholeWordPattern = (
  texts: readonly string[],
  options: { ignoreCase?: boolean } = {},
): RegExp => {
  const alternation = [...texts]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  return new RegExp(
    `(?<![\\p{L}\\p{N}\\p{M}_])(?:${alternation})(?![\\p{L}\\p{N}\\p{M}_])`,
    options.ignoreCase ? "giu" : "gu",
  );
};

/**
 * The name to show for a client (or a document's recipient): the display name, or the legal name when the display name is missing,
 * empty or only spaces. One rule for the API, the screens and the PDF (M4.3 re-check).
 */
export const nameOrLegal = (displayName: string | null | undefined, legalName: string): string => {
  const d = displayName?.trim();
  return d ? d : legalName;
};
