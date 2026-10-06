// Document numbering formats [ADM-SET-04, ADM-INV-03]. A format is a template such as "TH/INV/{FY}/{N}":
// {FY} is the financial-year token ("2627") and {N} the counter, zero-padded. GST limits invoice serial numbers
// to 16 characters of A–Z, 0–9, "/" and "-" (Rule 46(b), VERIFY WITH CA); we apply the same limit to every
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

/** Validate a format before it is saved in settings. The longest possible number must fit. */
export function validateFormat(format: NumberingFormat): FormatCheck {
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
  const check = validateFormat(format);
  if (!check.ok) throw new RangeError(check.error);
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

/** Settings rule: the next number can be raised but never lowered (no reuse) [ADM-SET-04]. */
export const canSetNextNumber = (current: number, proposed: number): boolean =>
  Number.isSafeInteger(proposed) && proposed >= current;
