// The statement of account as a CSV (`statement-v1`, M5.5b, LD83; ADM-CLI-04): Date, Document, Details, Debit, Credit, Balance, with an
// opening and a closing row. SPA only, like the rest of `gst/`. The words ("Opening balance", the line kinds) are copy: the caller
// passes them from 07-V (`StatementLabels`), so this core holds no invented text. The dates are the entries' IST dates.
import { parseIsoDate } from "../dates.ts";
import type { StatementEntry, StatementKind } from "../statement.ts";
import { type Cell, type CsvOptions, cell } from "./csv.ts";
import { col, type FileLayout, file, render } from "./layouts.ts";
import { type CalendarDate, fail, type GstIssue, type GstResult, guard, isInt, issue, ok } from "./types.ts";

export type StatementLabels = {
  readonly opening: string;
  readonly closing: string;
  readonly kinds: Readonly<Record<StatementKind, string>>;
};

export type StatementCsvInput = {
  /** The first day of the range: the date of the opening row. */
  readonly from: string;
  /** The last day of the range: the date of the closing row. */
  readonly to: string;
  readonly openingMinor: number;
  readonly closingMinor: number;
  readonly entries: readonly StatementEntry[];
  readonly labels: StatementLabels;
};

/** One row of the file: an entry, or the opening or closing balance line (no document, one balance). */
export type StatementCsvRow = {
  readonly date: CalendarDate;
  readonly document: string;
  readonly details: string;
  readonly debitMinor: number | null;
  readonly creditMinor: number | null;
  readonly balanceMinor: number;
};

const amountOrBlank = (v: number | null): Cell => (v === null ? cell.blank() : cell.amount(v));

const statementV1: FileLayout<StatementCsvRow> = file<StatementCsvRow>("statement", [
  col("Date", (r) => cell.date(r.date)),
  col("Document", (r) => (r.document === "" ? cell.blank() : cell.text(r.document))),
  col("Details", (r) => cell.text(r.details)),
  col("Debit", (r) => amountOrBlank(r.debitMinor)),
  col("Credit", (r) => amountOrBlank(r.creditMinor)),
  col("Balance", (r) => cell.amount(r.balanceMinor)),
]);
export const STATEMENT_LAYOUTS = Object.freeze({ "statement-v1": statementV1 } as const);
export type StatementLayoutId = keyof typeof STATEMENT_LAYOUTS;
export const CURRENT_STATEMENT_LAYOUT: StatementLayoutId = "statement-v1";

/** The rows of a statement file: opening, the entries, closing. A bad date or amount is an error at its place, nothing is skipped. */
export function statementCsvRows(input: StatementCsvInput): GstResult<readonly StatementCsvRow[]> {
  return guard(() => {
    const errors: GstIssue[] = [];
    const from = parseIsoDate(input.from);
    const to = parseIsoDate(input.to);
    if (from === null) errors.push(issue("date_invalid", "from"));
    if (to === null) errors.push(issue("date_invalid", "to"));
    if (!isInt(input.openingMinor)) errors.push(issue("amount_invalid", "openingMinor"));
    if (!isInt(input.closingMinor)) errors.push(issue("amount_invalid", "closingMinor"));
    const dated = input.entries.map((e, i) => {
      const date = parseIsoDate(e.date);
      if (date === null) errors.push(issue("date_invalid", "entries", i));
      if (!isInt(e.debitMinor) || !isInt(e.creditMinor) || !isInt(e.balanceMinor)) {
        errors.push(issue("amount_invalid", "entries", i));
      }
      return { e, date };
    });
    if (errors.length > 0 || from === null || to === null) return fail(errors);
    const rows: StatementCsvRow[] = [
      {
        date: from,
        document: "",
        details: input.labels.opening,
        debitMinor: null,
        creditMinor: null,
        balanceMinor: input.openingMinor,
      },
    ];
    for (const { e, date } of dated) {
      rows.push({
        date: date as CalendarDate,
        document: e.number,
        details: input.labels.kinds[e.kind],
        debitMinor: e.debitMinor === 0 ? null : e.debitMinor,
        creditMinor: e.creditMinor === 0 ? null : e.creditMinor,
        balanceMinor: e.balanceMinor,
      });
    }
    rows.push({
      date: to,
      document: "",
      details: input.labels.closing,
      debitMinor: null,
      creditMinor: null,
      balanceMinor: input.closingMinor,
    });
    return ok(rows);
  });
}

/** The statement of one client, one currency and one range as a CSV text. */
export function statementCsv(
  input: StatementCsvInput,
  version: StatementLayoutId = CURRENT_STATEMENT_LAYOUT,
  opts: CsvOptions = {},
): GstResult<string> {
  return guard(() => {
    if (!Object.hasOwn(STATEMENT_LAYOUTS, version)) return fail([issue("layout_unknown", "version")]);
    const rows = statementCsvRows(input);
    return rows.ok ? ok(render(STATEMENT_LAYOUTS[version], rows.value, opts)) : rows;
  });
}
