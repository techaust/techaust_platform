// A small CSV writer with typed cells (M5.5a; ADM-REP-04). RFC 4180: comma separator, every record (the header too) ends in
// CRLF, a field holding a quote, comma, CR or LF is quoted with the quotes doubled, UTF-8. A byte-order mark only on request
// (v1 writes none: UNVERIFIED whether the Offline Tool wants one).
// Spreadsheet-formula defence: a TEXT cell that starts with `= + - @`, a tab or a CR gets a `'` in front (the set of
// `apps/admin/src/lib/audit.ts` `csvCell`). A NUMERIC cell is never defused, so `-500.00` stays a number; numeric cells
// come only from `cell.amount`, `cell.rate`, `cell.count`, `cell.date`: there is no string-to-number path.
import type { CalendarDate } from "../dates.ts";
import { formatAmount, formatCount, formatDate, formatMicros, formatRate } from "./format.ts";

/** `text` is defused and quoted as needed, `raw` is a pre-formatted number or date, `blank` is an empty field. */
export type Cell =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "raw"; readonly value: string }
  | { readonly kind: "blank" };

const FORMULA_START = /^[=+\-@\t\r]/;

/** A leading `= + - @`, tab or CR gets a `'` prefix, so a spreadsheet reads the text as text. */
export const defuse = (text: string): string => (FORMULA_START.test(text) ? `'${text}` : text);

export const cell = {
  /** Free text (names, addresses, numbers of documents): defused when written. */
  text: (value: string): Cell => ({ kind: "text", value }),
  /** An amount in minor units as `-500.00`. A value that is not a safe integer throws a RangeError (a bug, not input). */
  amount: (minor: number): Cell => ({ kind: "raw", value: formatAmount(minor) }),
  /** A rate in basis points as `18`, `12.5`, `0.25`. */
  rate: (bp: number): Cell => ({ kind: "raw", value: formatRate(bp) }),
  /** An exchange rate in micros as `83.500000`. */
  micros: (micros: number): Cell => ({ kind: "raw", value: formatMicros(micros) }),
  /** A whole count as plain digits. */
  count: (n: number): Cell => ({ kind: "raw", value: formatCount(n) }),
  /** A date as `dd-Mmm-yyyy` (UNVERIFIED). */
  date: (date: CalendarDate): Cell => ({ kind: "raw", value: formatDate(date) }),
  blank: (): Cell => ({ kind: "blank" }),
};

const NEEDS_QUOTES = /[",\r\n]/;
const quote = (field: string): string =>
  NEEDS_QUOTES.test(field) ? `"${field.replaceAll('"', '""')}"` : field;

/** One cell as its CSV field. */
export function field(c: Cell): string {
  if (c.kind === "blank") return "";
  return quote(c.kind === "text" ? defuse(c.value) : c.value);
}

export type CsvOptions = { readonly bom?: boolean };

/** The records, each ending in CRLF (the header is just the first record). */
export function writeCsv(records: readonly (readonly Cell[])[], opts: CsvOptions = {}): string {
  const body = records.map((r) => `${r.map(field).join(",")}\r\n`).join("");
  return opts.bom === true ? `﻿${body}` : body;
}
