// A client's statement of account (M5.5b, LD78, LD85; ADM-CLI-04; Q58, VERIFY WITH CA/LEGAL): `GET /clients/:id/statement`, one currency, a range, keyset pages of at
// most 50 lines with the balance before each page. Debits are the tax invoices, export invoices and debit notes (not voided); credits are the credit notes and the advance
// payments recorded against proformas (Q9); proformas are not listed (LD22). The lines come from SQL (`@techaust/db/reports`), the running balance from core
// `statementEntries` (bigint, no floats); a statement made today closes at the sum of the client's open balances (the ledger). Staff only: nothing here is sent to a client
// contact (Q62), so the "can see finance" rule of M5.4 has nothing to filter yet; the portal statement (M7) must apply it.
// Self-contained (LD85): context, http, keyset and packages only, so a later third Worker can take `/clients/:id/statement*`.
import { type StatementKind, type StatementRow, statementEntries } from "@techaust/core/statement";
import {
  REPORT_PAGE_SIZE,
  STATEMENT_BALANCE_BEFORE_SQL,
  STATEMENT_PAGE_SQL,
  STATEMENT_TOTALS_SQL,
  statementBalanceBeforeBinds,
  statementPageBinds,
  statementTotalsBinds,
} from "@techaust/db/reports";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type ApiError, type AppEnv, BAD_REQUEST, err, NOT_FOUND } from "./context.ts";
import { idParam, isoDate, param, query } from "./http.ts";
import { decodeCursor, encodeCursor } from "./keyset.ts";

export const STATEMENT_FAILED: ApiError = {
  code: "statement_failed",
  message: "The statement could not be worked out. Try again, and tell the owner if it keeps happening",
};
export const PERIOD_INVALID: ApiError = {
  code: "period_invalid",
  message: "Choose a range that starts on or before its last day",
};

const SK = /^\d{4}-\d{2}-\d{2}\|[123]$/;

export const statementQuery = z.object({
  from: isoDate,
  to: isoDate,
  currency: z.optional(z.enum(["INR", "USD"])),
  after: z.optional(z.string().check(z.maxLength(400))),
});

type LineRow = {
  id: string;
  kind: string;
  date: string;
  number: string;
  amount: number;
  sk: string;
  parent: string | null;
};

const asRow = (r: LineRow): StatementRow => ({
  id: r.id,
  kind: r.kind as StatementKind,
  date: r.date,
  number: r.number,
  amountMinor: r.amount,
  againstNumber: r.parent,
});

export const statements = new Hono<AppEnv>().get(
  "/:id/statement",
  param(idParam),
  query(statementQuery),
  async (c) => {
    const { id } = c.req.valid("param");
    const q = c.req.valid("query");
    if (q.to < q.from) return err(c, PERIOD_INVALID, 400);
    let cursor: { sk: string; id: string } | undefined;
    if (q.after !== undefined) {
      const k = decodeCursor(q.after);
      if (!k || typeof k.k !== "string" || !SK.test(k.k)) return err(c, BAD_REQUEST, 400);
      cursor = { sk: k.k, id: k.id };
    }
    const db = c.env.DB;
    const clientStmt = db.prepare("SELECT currency FROM clients WHERE id = ?1").bind(id);
    // A currency the caller named needs no lookup before the reads: the client's existence is the first statement of the one batch (L7). Without one, the client's own
    // currency is read first (two round trips, as before).
    let currency = q.currency;
    if (currency === undefined) {
      const client = await clientStmt.first<{ currency: string }>();
      if (!client) return err(c, NOT_FOUND, 404);
      currency = client.currency;
    }
    const stmts = [
      ...(q.currency === undefined ? [] : [clientStmt]),
      db
        .prepare(STATEMENT_PAGE_SQL(cursor !== undefined))
        .bind(...statementPageBinds(id, currency, q.from, q.to, cursor)),
      db
        .prepare(STATEMENT_BALANCE_BEFORE_SQL(cursor !== undefined))
        .bind(...statementBalanceBeforeBinds(id, currency, q.from, cursor)),
      db.prepare(STATEMENT_TOTALS_SQL).bind(...statementTotalsBinds(id, currency, q.from, q.to)),
      // the range's opening balance: only a later page needs its own query (the first page's balance before IS the opening)
      ...(cursor
        ? [
            db
              .prepare(STATEMENT_BALANCE_BEFORE_SQL(false))
              .bind(...statementBalanceBeforeBinds(id, currency, q.from)),
          ]
        : []),
    ];
    const batch = await db.batch(stmts);
    if (q.currency !== undefined && batch[0]?.results.length === 0) return err(c, NOT_FOUND, 404);
    const res = q.currency === undefined ? batch : batch.slice(1);
    const lines = (res[0]?.results ?? []) as LineRow[];
    const balanceBefore = (res[1]?.results[0] as { balance: number } | undefined)?.balance ?? 0;
    const totals = (res[2]?.results[0] as { debit: number; credit: number } | undefined) ?? {
      debit: 0,
      credit: 0,
    };
    const opening = cursor
      ? ((res[3]?.results[0] as { balance: number } | undefined)?.balance ?? 0)
      : balanceBefore;
    const page = lines.slice(0, REPORT_PAGE_SIZE);
    const done = statementEntries(page.map(asRow), balanceBefore);
    const closing = BigInt(opening) + BigInt(totals.debit) - BigInt(totals.credit);
    if (!done.ok || !Number.isSafeInteger(Number(closing))) return err(c, STATEMENT_FAILED, 500);
    const last = page.at(-1);
    return c.json({
      from: q.from,
      to: q.to,
      currency,
      entries: done.entries,
      balanceBeforeMinor: balanceBefore,
      range: {
        openingMinor: opening,
        debitMinor: totals.debit,
        creditMinor: totals.credit,
        closingMinor: Number(closing),
      },
      next: lines.length > REPORT_PAGE_SIZE && last ? encodeCursor({ k: last.sk, id: last.id }) : null,
    });
  },
);
