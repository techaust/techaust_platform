// Document numbering formats [ADM-SET-04, ADM-INV-03]. A format is a template such as "TH/INV/{FY}/{N}":
// {FY} is the financial-year token ("2627") and {N} the counter, zero-padded. GST limits invoice serial numbers
// to 16 characters of A–Z, 0–9, "/" and "-" (Rule 46(b), Researched 2026-10-28, Rule 46 CGST Rules (08-C RA-05)); we apply the same limit to every
// series so all numbers fit the same columns and PDFs. Numbers are assigned in SQL at issue (docs/05 §5.4),
// using `sqlPrintfPattern`, so the app and the database format numbers identically.
import { type FinancialYear, financialYear } from "./dates.ts";

export const MAX_NUMBER_LENGTH = 16;

export const SERIES = {
  invoice: { label: "Tax invoice", gst: true, default: "TH/INV/{FY}/{N}" },
  export: { label: "Export invoice", gst: true, default: "TH/EXP/{FY}/{N}" },
  creditNote: { label: "Credit note", gst: true, default: "TH/CN/{FY}/{N}" },
  debitNote: { label: "Debit note", gst: true, default: "TH/DN/{FY}/{N}" },
  receiptVoucher: { label: "Receipt voucher", gst: true, default: "TH/RV/{FY}/{N}" },
  refundVoucher: { label: "Refund voucher", gst: true, default: "TH/RF/{FY}/{N}" },
  receipt: { label: "Payment receipt", gst: false, default: "TH/RCT/{FY}/{N}" },
  proforma: { label: "Proforma invoice", gst: false, default: "TH/PI/{FY}/{N}" },
  estimate: { label: "Estimate", gst: false, default: "TH/EST/{FY}/{N}" },
  proposal: { label: "Proposal", gst: false, default: "TH/PRP/{FY}/{N}" },
  // T11 (L1; Researched 2026-10-31, Copyright Act s.19(1) (08-C RB-38(a))): the deed of assignment of copyright, numbered gap-free per FY when it is finalised
  // (15 characters at padding 4). Not a GST document.
  deed: { label: "Deed of assignment", gst: false, default: "TH/DA/{FY}/{N}" },
} as const;

export type Series = keyof typeof SERIES;
export type NumberingFormat = { readonly template: string; readonly padding: number };

export const DEFAULT_PADDING = 4;
export const defaultFormat = (series: Series): NumberingFormat => ({
  template: SERIES[series].default,
  padding: DEFAULT_PADDING,
});

const LITERAL = /^[A-Z0-9/-]*$/;

/** The largest counter value a format can show (9999 for padding 4). */
export const maxNumber = (format: NumberingFormat): number => 10 ** format.padding - 1;

type Parts = { before: string; middle: string; after: string; fyFirst: boolean };

function split(template: string): Parts | null {
  const fy = template.split("{FY}");
  const n = template.split("{N}");
  if (fy.length !== 2 || n.length !== 2) return null;
  const fyAt = template.indexOf("{FY}");
  const nAt = template.indexOf("{N}");
  const [a, b] = fyAt < nAt ? (["{FY}", "{N}"] as const) : (["{N}", "{FY}"] as const);
  const first = template.indexOf(a);
  const second = template.indexOf(b);
  return {
    before: template.slice(0, first),
    middle: template.slice(first + a.length, second),
    after: template.slice(second + b.length),
    fyFirst: fyAt < nAt,
  };
}

export type FormatCheck = { ok: true; maxLength: number } | { ok: false; error: string };

/**
 * Validate a format before it is SAVED in settings. The longest possible number must fit, and the number must not start with 0, "/" or "-" (LD18).
 * The first-character rule applies on save only: a format stored before M5.1 that breaks it must still READ (`validateStoredFormat`), or every
 * route that reads the numbering settings would answer 500 until someone fixed the row by hand.
 */
export const validateFormat = (format: NumberingFormat): FormatCheck => checkFormat(format, true);

/** Validate a format that is already stored: the rules that held before M5.1 (everything except LD18's first character), so reading never throws for a row that was valid when saved. */
export const validateStoredFormat = (format: NumberingFormat): FormatCheck => checkFormat(format, false);

function checkFormat(format: NumberingFormat, strictStart: boolean): FormatCheck {
  if (!Number.isInteger(format.padding) || format.padding < 1 || format.padding > 8) {
    return { ok: false, error: "Padding must be between 1 and 8 digits" };
  }
  const parts = split(format.template);
  if (!parts) return { ok: false, error: "The format needs {FY} and {N} exactly once each" };
  const literals = parts.before + parts.middle + parts.after;
  if (!LITERAL.test(literals)) {
    return { ok: false, error: 'Use only capital letters A–Z, digits 0–9, "/" and "-"' };
  }
  if (parts.middle === "") return { ok: false, error: "Put a separator between {FY} and {N}" };
  // LD18 (Researched 2026-10-28, Rules 46(b), 50, 51 and 53 CGST Rules (08-C RA-09), 08-A §4): the e-invoice schema wants the number to start with a letter or 1-9, never 0, "/" or "-".
  // The number starts with the text before the first token; with none, the FY token (always 1-9 for a real FY) or the counter,
  // which starts with a padding zero whenever the padding is more than one digit.
  const first = parts.before[0];
  if (
    strictStart &&
    (first !== undefined
      ? first === "/" || first === "-" || first === "0"
      : !parts.fyFirst && format.padding > 1)
  ) {
    return { ok: false, error: 'The number must not start with 0, "/" or "-"' };
  }
  const maxLength = literals.length + 4 + format.padding;
  if (maxLength > MAX_NUMBER_LENGTH) {
    return {
      ok: false,
      error: `Numbers could reach ${maxLength} characters; the limit is ${MAX_NUMBER_LENGTH}`,
    };
  }
  return { ok: true, maxLength };
}

const assertValid = (format: NumberingFormat) => {
  const result = validateStoredFormat(format);
  if (!result.ok) throw new RangeError(result.error);
};

/** Format the n-th document of a financial year: (TH/INV/{FY}/{N}, FY 2026-27, 1) → "TH/INV/2627/0001". */
export function formatDocumentNumber(format: NumberingFormat, fy: FinancialYear, n: number): string {
  assertValid(format);
  if (!Number.isSafeInteger(n) || n < 1 || n > maxNumber(format)) {
    throw new RangeError(`Document number ${n} is outside 1–${maxNumber(format)} for this format`);
  }
  return format.template.replace("{FY}", fy.token).replace("{N}", String(n).padStart(format.padding, "0"));
}

/** Read a number back into its financial year and counter (null if it doesn't match the format). */
export function parseDocumentNumber(
  format: NumberingFormat,
  value: string,
): { fy: FinancialYear; n: number } | null {
  assertValid(format);
  const parts = split(format.template) as Parts;
  const esc = (s: string) => s.replace(/[/-]/g, "\\$&");
  const fy = "(\\d{4})";
  const n = `(\\d{${format.padding}})`;
  const re = new RegExp(
    `^${esc(parts.before)}${parts.fyFirst ? fy : n}${esc(parts.middle)}${parts.fyFirst ? n : fy}${esc(parts.after)}$`,
  );
  const m = re.exec(value);
  if (!m) return null;
  const token = (parts.fyFirst ? m[1] : m[2]) as string;
  const counter = Number(parts.fyFirst ? m[2] : m[1]);
  const start = Number(token.slice(0, 2));
  if ((start + 1) % 100 !== Number(token.slice(2))) return null;
  if (counter < 1) return null;
  // Two-digit years: the 2000s (FY 99-00 → 2099). Revisit in 2099.
  return { fy: financialYear(2000 + start), n: counter };
}

/**
 * The SQLite printf() pattern for a format, with the FY token as the string argument and the counter as the
 * integer: "TH/INV/{FY}/{N}" → "TH/INV/%s/%04d". Literals can't contain "%" (validateFormat). SQLite's
 * printf has no positional arguments, so `argOrder` tells the caller which order to bind them in.
 */
export function sqlPrintfPattern(format: NumberingFormat): {
  pattern: string;
  argOrder: ["fy", "n"] | ["n", "fy"];
} {
  assertValid(format);
  const parts = split(format.template) as Parts;
  const n = `%0${format.padding}d`;
  return parts.fyFirst
    ? { pattern: `${parts.before}%s${parts.middle}${n}${parts.after}`, argOrder: ["fy", "n"] }
    : { pattern: `${parts.before}${n}${parts.middle}%s${parts.after}`, argOrder: ["n", "fy"] };
}

/**
 * Whether two formats could ever print the same number (ADM-SET-04; Researched 2026-10-28, Rules 46(b), 50(b), 51(b) and 53(1A) CGST Rules (08-C RA-09):
 * a number is unique for the financial year, whichever series it is in). Two tests, either of which refuses the pair:
 *   1. the brief's rule: the literal text (the template with {FY} and {N} removed) is the same ("TH/{FY}/{N}" and "TH/{N}/{FY}" share "TH//" and both can print "TH/2627/2627");
 *   2. the shape: written out, each format is a run of literal characters and digit positions (four for {FY}, `padding` for {N}); two formats of the same
 *      length clash when every position could hold the same character ("TH/{FY}/{N}" with padding 5 and "TH/{FY}/0{N}" with padding 4 both print
 *      "TH/2627/00001", although their literal text differs). The FY digits are treated as any digit, so the test only ever refuses more, never less.
 * Unreadable formats never clash here (`validateStoredFormat` refuses them on its own).
 */
export function formatsCanClash(a: NumberingFormat, b: NumberingFormat): boolean {
  const pa = split(a.template);
  const pb = split(b.template);
  if (!pa || !pb) return false;
  if (pa.before + pa.middle + pa.after === pb.before + pb.middle + pb.after) return true;
  const sa = shapeOf(pa, a.padding);
  const sb = shapeOf(pb, b.padding);
  if (sa.length !== sb.length) return false;
  return sa.every((x, i) => {
    const y = sb[i] as string;
    if (x === "#" || y === "#") return /[#0-9]/.test(x) && /[#0-9]/.test(y);
    return x === y;
  });
}

/** A format written out: each literal character as itself, each digit of {FY} or {N} as "#" (any digit). */
function shapeOf(p: Parts, padding: number): string[] {
  const fy = "#".repeat(4);
  const n = "#".repeat(padding);
  return [...`${p.before}${p.fyFirst ? fy : n}${p.middle}${p.fyFirst ? n : fy}${p.after}`];
}

/** Every pair of series whose formats could print the same number (`formatsCanClash`), each pair once, in `SERIES` order. */
export function numberingClashes(
  formats: Readonly<Partial<Record<Series, NumberingFormat>>>,
): [Series, Series][] {
  const keys = (Object.keys(SERIES) as Series[]).filter((s) => formats[s] !== undefined);
  const out: [Series, Series][] = [];
  keys.forEach((s, i) => {
    for (const t of keys.slice(i + 1))
      if (formatsCanClash(formats[s] as NumberingFormat, formats[t] as NumberingFormat)) out.push([s, t]);
  });
  return out;
}

/** Settings rule: the next number can be raised but never lowered (no reuse) [ADM-SET-04]. */
export const canSetNextNumber = (current: number, proposed: number): boolean =>
  Number.isSafeInteger(proposed) && proposed >= current;

const byCodeUnit = (a: string, b: string): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);

/** A document number as its series part and the digits at its end ("TH/CN/2627/10" -> "TH/CN/2627/", "10"); no digits at the end -> null. */
const numberParts = (n: string): { series: string; digits: string | null } => {
  const m = /^(.*?)(\d+)$/.exec(n);
  return m ? { series: m[1] as string, digits: m[2] as string } : { series: n, digits: null };
};

/** Two runs of digits as integers, compared as text (no conversion, so no size limit): fewer significant digits is smaller. */
const compareDigits = (a: string, b: string): -1 | 0 | 1 => {
  const x = a.replace(/^0+(?=\d)/, "");
  const y = b.replace(/^0+(?=\d)/, "");
  return x.length < y.length ? -1 : x.length > y.length ? 1 : byCodeUnit(x, y);
};

/**
 * Two document numbers in the order they were issued (FX-4 review L3): by series (text), then by the integer at the end, never by the text of the whole, so
 * "TH/CN/2627/10" comes after "/9" (as the notes ledger orders them, `apps/admin/src/lib/notes.ts`). A number with no digits at the end comes after its series'
 * numbered ones; two that are still equal fall back to their text ("/09" before "/9"), so the order is total. Callers break a remaining tie on the id.
 */
export const compareDocNumbers = (a: string, b: string): -1 | 0 | 1 => {
  const x = numberParts(a);
  const y = numberParts(b);
  const series = byCodeUnit(x.series, y.series);
  if (series !== 0) return series;
  if (x.digits === null || y.digits === null) {
    if (x.digits !== y.digits) return x.digits === null ? 1 : -1;
  } else {
    const n = compareDigits(x.digits, y.digits);
    if (n !== 0) return n;
  }
  return byCodeUnit(a, b);
};
