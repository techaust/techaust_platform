// The one CSV text-cell writer (M7.5 B1; ASVS 5.0 V1): every CSV the admin builds (the audit export, the time export, the payments register, the M7.3
// reports and the GST layouts in `gst/csv.ts`) goes through it, so the spreadsheet-formula defence and the RFC 4180 quoting live in one place.
//   - `defuse`: a text that starts with `= + - @`, a tab or a carriage return gets a `'` in front, so a spreadsheet reads it as text, never a formula.
//   - `csvCell`: the defused text, quoted when it holds a quote, a comma, a CR or an LF, with the quotes doubled.
// Only TEXT goes through here: a number a sheet must add up (an amount, a rate) is written plain by its own writer and never defused, so `-500.00` stays a
// number.

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** A leading `= + - @`, tab or CR gets a `'` prefix, so a spreadsheet reads the text as text. */
export const defuse = (text: string): string => (FORMULA_START.test(text) ? `'${text}` : text);

/** A field quoted when it holds a quote, comma, CR or LF (RFC 4180), the quotes doubled. Not defused: `csvCell` is the text writer. */
export const quoteField = (field: string): string =>
  NEEDS_QUOTES.test(field) ? `"${field.replaceAll('"', '""')}"` : field;

/** One CSV text cell: defused, then quoted as needed. */
export const csvCell = (text: string): string => quoteField(defuse(text));
