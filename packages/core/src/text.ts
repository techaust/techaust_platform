// Small text helpers shared by the Workers. Pure.

/** Escapes backslash, `%` and `_` so user text can sit inside a `LIKE ? ESCAPE '\'` pattern as plain characters. */
export const escapeLike = (s: string): string =>
  s.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
