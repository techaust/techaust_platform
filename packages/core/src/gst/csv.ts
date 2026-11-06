// A small CSV writer with typed cells (M5.5a; ADM-REP-04). RFC 4180: comma separator, every record (the header too) ends in
// CRLF, a field holding a quote, comma, CR or LF is quoted with the quotes doubled, UTF-8. A byte-order mark only on request
// (v1 writes none: UNVERIFIED whether the Offline Tool wants one).
// Spreadsheet-formula defence: a TEXT cell that starts with `= + - @`, a tab or a CR gets a `'` in front (the one shared
// defuser, `@techaust/core/csv-cell`, M7.5 B1). A NUMERIC cell is never defused, so `-500.00` stays a number; numeric cells
// come only from `cell.amount`, `cell.rate`, `cell.count`, `cell.date`: there is no string-to-number path.
import { defuse, quoteField } from "../csv-cell.ts";
import type { CalendarDate } from "../dates.ts";
import { formatAmount, formatCount, formatDate, formatMicros, formatRate } from "./format.ts";

declare const cellBrand: unique symbol;
type CellShape =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "raw"; readonly value: string }
  | { readonly kind: "blank" };
/**
 * `text` is defused and quoted as needed, `raw` is a pre-formatted number or date, `blank` is an empty field. The type is
 * branded (type level only): the only way to get a `Cell` is a `cell.*` constructor, so no caller can hand-build a `raw` cell
 * around free text and skip `defuse`.
 */
export type Cell = CellShape & { readonly [cellBrand]: true };
const make = (c: CellShape): Cell => c as Cell;

/** The shared defuser (M7.5 B1), re-exported under its old name for the layouts and their tests. */
export { defuse };

export const cell = {
  /** Free text (names, addresses, numbers of documents): defused when written. */
  text: (value: string): Cell => make({ kind: "text", value }),
  /** An amount in minor units as `-500.00`. A value that is not a safe integer throws a RangeError (a bug, not input). */
  amount: (minor: number): Cell => make({ kind: "raw", value: formatAmount(minor) }),
  /** A rate in basis points as `18`, `12.5`, `0.25`. */
  rate: (bp: number): Cell => make({ kind: "raw", value: formatRate(bp) }),
  /** An exchange rate in micros as `83.500000`. */
  micros: (micros: number): Cell => make({ kind: "raw", value: formatMicros(micros) }),
  /** A whole count as plain digits. */
  count: (n: number): Cell => make({ kind: "raw", value: formatCount(n) }),
  /** A date as `dd-Mmm-yyyy` (UNVERIFIED). */
  date: (date: CalendarDate): Cell => make({ kind: "raw", value: formatDate(date) }),
  blank: (): Cell => make({ kind: "blank" }),
};

/** One cell as its CSV field. */
export function field(c: Cell): string {
  if (c.kind === "blank") return "";
  return quoteField(c.kind === "text" ? defuse(c.value) : c.value);
}

export type CsvOptions = { readonly bom?: boolean };

/** The records, each ending in CRLF (the header is just the first record). */
export function writeCsv(records: readonly (readonly Cell[])[], opts: CsvOptions = {}): string {
  const body = records.map((r) => `${r.map(field).join(",")}\r\n`).join("");
  return opts.bom === true ? `\uFEFF${body}` : body;
}
