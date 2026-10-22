// Anything that ends up in an email header or a redirect header goes through here first (FRM-03).

// C0/C1 control characters, plus the Unicode line and paragraph separators (written as code points on purpose).
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point
const UNSAFE = new RegExp(`[\\u0000-\\u001f\\u007f-\\u009f${String.fromCharCode(0x2028, 0x2029)}]+`, "g");

/** Replaces CR, LF and the other control characters with a space, so a value cannot add a header line. */
export function stripCrLf(value: string): string {
  return value.replace(UNSAFE, " ").trim();
}
