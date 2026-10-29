// A client's Overview figures and a project's billed figure (FX-3, A3 4 and A3 5; ADM-CLI-03, ADM-PRJ-05), read from the frozen documents with the client
// statement's rules (LD78; Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28)): debits are the tax invoices, export invoices and debit notes, the
// credit notes are listed apart, proformas are left out, voided documents never count. The SQL is `@techaust/db/reports` (EXPLAIN-tested); the twin test
// `figures.test.ts` proves that billed and the balance agree with GET /clients/:id/statement for the same client.
// "Collected" (client) and "paid" (project) need payments (M6): they are left out of the answer, never sent as 0. An anonymised client gets no figures
// (the Overview and its projects show none), though its frozen documents stay.
import { istDate, toIsoDate } from "@techaust/core/dates";
import {
  CLIENT_FIGURES_SQL,
  type ClientFiguresRow,
  PROJECT_BILLED_SQL,
  type ProjectBilledRow,
} from "@techaust/db/reports";
import { type Ctx, err, NOT_FOUND } from "./context.ts";

/** One currency of a client's figures; amounts in minor units, tax included. */
export type ClientFigures = {
  readonly currency: "INR" | "USD";
  /** The statement's debit column over all time: tax invoices, export invoices and debit notes. */
  readonly billedMinor: number;
  /** The credit notes issued to the client. */
  readonly creditedMinor: number;
  /** What the client owes now: the statement's closing balance today (Σ the open debit documents' balances). */
  readonly balanceMinor: number;
  /** The part of the balance past its due date (due before today, IST), and on how many documents. */
  readonly overdueMinor: number;
  readonly overdueCount: number;
};

/** The answer of GET /clients/:id/finance. */
export type ClientFinanceAnswer =
  | { readonly available: true; readonly asOf: string; readonly currencies: readonly ClientFigures[] }
  | { readonly available: false; readonly reason: "anonymised" };

/** One currency of a project's billed figure. */
export type ProjectBilled = {
  readonly currency: "INR" | "USD";
  readonly billedMinor: number;
  readonly creditedMinor: number;
};

export const clientFiguresOf = (rows: readonly ClientFiguresRow[]): ClientFigures[] =>
  rows.map((r) => ({
    currency: r.currency,
    billedMinor: r.billed,
    creditedMinor: r.credited,
    balanceMinor: r.balance,
    overdueMinor: r.overdue,
    overdueCount: r.overdue_n,
  }));

export const projectBilledOf = (rows: readonly ProjectBilledRow[]): ProjectBilled[] =>
  rows.map((r) => ({ currency: r.currency, billedMinor: r.billed, creditedMinor: r.credited }));

/** The project's billed statement, for the project page's batch. */
export const projectBilledStatement = (db: D1Database, projectId: string): D1PreparedStatement =>
  db.prepare(PROJECT_BILLED_SQL).bind(projectId);

/**
 * GET /clients/:id/finance (`clients.finance.read`): the client row and its figures in ONE batch. 404 for an unknown client; an anonymised client answers
 * `{available: false, reason: "anonymised"}`.
 */
export async function clientFinance(c: Ctx, id: string, now = Date.now()): Promise<Response> {
  const db = c.env.DB;
  const today = toIsoDate(istDate(now));
  const [client, figures] = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT anonymised_at FROM clients WHERE id = ?1").bind(id),
    db.prepare(CLIENT_FIGURES_SQL).bind(id, today),
  ]);
  const row = client?.results[0] as { anonymised_at: number | null } | undefined;
  if (!row) return err(c, NOT_FOUND, 404);
  const answer: ClientFinanceAnswer =
    row.anonymised_at !== null
      ? { available: false, reason: "anonymised" }
      : {
          available: true,
          asOf: today,
          currencies: clientFiguresOf((figures?.results ?? []) as ClientFiguresRow[]),
        };
  return c.json(answer);
}
