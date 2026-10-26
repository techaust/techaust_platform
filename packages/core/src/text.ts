// Small text helpers shared by the Workers. Pure.

/** Escapes backslash, `%` and `_` so user text can sit inside a `LIKE ? ESCAPE '\'` pattern as plain characters. */
export const escapeLike = (s: string): string =>
  s.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

/**
 * The name to show for a client (or a document's recipient): the display name, or the legal name when the display name is missing,
 * empty or only spaces. One rule for the API, the screens and the PDF (M4.3 re-check).
 */
export const nameOrLegal = (displayName: string | null | undefined, legalName: string): string => {
  const d = displayName?.trim();
  return d ? d : legalName;
};
