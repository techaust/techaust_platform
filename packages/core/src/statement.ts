// The statement of account of one client in one currency (M5.5b, LD78; ADM-CLI-04, JOB-PDF-01). Pure, no I/O, no zod, no floats:
// money in minor units with bigint sums and a checked way back to a safe integer. Worker-safe (the admin API, the jobs Worker and
// the SPA all import it as `@techaust/core/statement`).
// What a statement lists before online payments exist (M6; Q58, Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28)):
//   debits   tax invoices, export invoices and debit notes (not voided);
//   credits  credit notes, and the advance payments recorded against proformas (`advance_receipts`, Q9);
// and NOT proformas (not a tax document; their payment shows through the tax invoice, so nothing counts twice, LD22). The closing
// balance of a statement made today equals the sum of `balance_minor` of the client's open debit documents (the ledger).

/** The kinds of line on a statement. */
export type StatementKind = "tax_invoice" | "export_invoice" | "debit_note" | "credit_note" | "receipt";

/** The document types that add to what the client owes (a credit note and a receipt reduce it). */
export const STATEMENT_DEBIT_TYPES = ["tax_invoice", "export_invoice", "debit_note"] as const;

/** A statement PDF lists at most this many lines (a longer period is refused: make the range shorter, or use the CSV). */
export const STATEMENT_PDF_MAX_ENTRIES = 200;

/** One line as the database gives it: the amount is positive and the kind says which side it is on. */
export type StatementRow = {
  readonly id: string;
  readonly kind: StatementKind;
  /** The document's issue date, or the day the money arrived (ISO, IST). */
  readonly date: string;
  /** The document's printed number (a receipt shows the number of the invoice it paid). */
  readonly number: string;
  readonly amountMinor: number;
  /** A credit or debit note: the number of the invoice it is against (07-V "Credit note against {number}"; FX-4, 07-Y "Debit note against {number}"); null or absent for every other kind. */
  readonly againstNumber?: string | null;
};

export type StatementEntry = StatementRow & {
  readonly debitMinor: number;
  readonly creditMinor: number;
  /** The running balance after this line, opening balance included. */
  readonly balanceMinor: number;
};

export type StatementResult =
  | {
      readonly ok: true;
      readonly entries: readonly StatementEntry[];
      readonly totals: { readonly debitMinor: number; readonly creditMinor: number };
      readonly closingMinor: number;
    }
  | { readonly ok: false; readonly code: "amount_invalid" | "amount_out_of_range" };

const isDebit = (kind: StatementKind): boolean => kind !== "credit_note" && kind !== "receipt";

const back = (value: bigint): number | null => {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
};

/**
 * The lines with a running balance, in the order given (the database orders them by date, then debit documents, credit notes and
 * receipts; the page keyset is that order). An amount that is not a positive safe integer is `amount_invalid` and a sum beyond the
 * safe-integer range is `amount_out_of_range`: nothing is rounded or clipped.
 */
export function statementEntries(rows: readonly StatementRow[], openingMinor: number): StatementResult {
  if (!Number.isSafeInteger(openingMinor)) return { ok: false, code: "amount_invalid" };
  let balance = BigInt(openingMinor);
  let debits = 0n;
  let credits = 0n;
  const entries: StatementEntry[] = [];
  for (const row of rows) {
    if (!Number.isSafeInteger(row.amountMinor) || row.amountMinor <= 0)
      return { ok: false, code: "amount_invalid" };
    const amount = BigInt(row.amountMinor);
    const debit = isDebit(row.kind);
    if (debit) {
      debits += amount;
      balance += amount;
    } else {
      credits += amount;
      balance -= amount;
    }
    const running = back(balance);
    if (running === null) return { ok: false, code: "amount_out_of_range" };
    entries.push({
      ...row,
      debitMinor: debit ? row.amountMinor : 0,
      creditMinor: debit ? 0 : row.amountMinor,
      balanceMinor: running,
    });
  }
  const debitMinor = back(debits);
  const creditMinor = back(credits);
  const closingMinor = back(balance);
  if (debitMinor === null || creditMinor === null || closingMinor === null) {
    return { ok: false, code: "amount_out_of_range" };
  }
  return { ok: true, entries, totals: { debitMinor, creditMinor }, closingMinor };
}
