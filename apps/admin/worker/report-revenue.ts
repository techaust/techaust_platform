// M7.3 (ADM-REP-01, -02, -06; run file docs/runs/m7.3-reports.md C1, C2, C9, L1 to L9, L12): revenue and collections, and outstanding and ageing, on the invoices
// Worker with the other reports. Read only (the Accountant's matrix row is `reports.finance`, L5): no write, no audit row (the `/export` twins of C2 and C9 are B2's,
// under `exports.gst`, and reuse `revenueClientsPage` and `ageingPage` below). Every figure is a sum made in SQL (`@techaust/db/reports`); the Worker only checks the
// query, renames columns and names an anonymised client (L1: no rate maths, no split of a payment, no balance at a past date). Reports are not tax documents
// (Researched 2026-10-28 (08-C RA-28)); a credit note counts on the day it is issued (Researched (08-C RA-04)).
import { ANONYMISED_CLIENT } from "@techaust/core/clients";
import { istDate, toIsoDate } from "@techaust/core/dates";
import type { Currency } from "@techaust/core/money";
import {
  AGEING_BUCKETS,
  type AgeingRow,
  ageingBucket,
  type CollectedFigures,
  fyBounds,
  fyMonths,
  type InvoicedFigures,
  type RevenueByKey,
  type RevenueByMonth,
  type RevenueClientRow,
} from "@techaust/core/reports";
import {
  AGEING_PAGE_SQL,
  AGEING_TOTALS_SQL,
  type AgeingSqlRow,
  type AgeingTotalsSqlRow,
  type CategorySqlRow,
  type KeyedSqlRow,
  REPORT_PAGE_SIZE,
  REVENUE_CATEGORY_SQL,
  REVENUE_CLIENTS_SQL,
  REVENUE_KIND_SQL,
  REVENUE_MONTHS_SQL,
  type RevenueClientSqlRow,
  type RevenueMonthSqlRow,
  type RevenueSqlRow,
  revenueClientsBinds,
} from "@techaust/db/reports";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type ApiError, type AppEnv, BAD_REQUEST, type Ctx, err, mutate } from "./context.ts";
import { query } from "./http.ts";
import { decodeCursor, encodeCursor } from "./keyset.ts";

export const PERIOD_INVALID: ApiError = { code: "period_invalid", message: "Choose a financial year" };

const fyToken = z.string().check(z.regex(/^\d{4}$/));
const afterQuery = z.optional(z.string().check(z.maxLength(400)));
const currency = z.enum(["INR", "USD"]);
/** The query schemas (module top level; B2's warm-up parses one sample of each). */
export const revenueQuery = z.object({ fy: fyToken, by: z.optional(z.enum(["month", "category", "kind"])) });
export const revenueClientsQuery = z.object({ fy: fyToken, currency, after: afterQuery });
export const ageingQuery = z.object({ after: afterQuery });

const todayIst = () => toIsoDate(istDate(Date.now()));
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Invoiced figures of a row: null when the row has no document. */
const invoicedOf = (
  r: Pick<RevenueSqlRow, "currency" | "documents" | "taxable" | "total" | "inr_taxable" | "inr_total">,
): InvoicedFigures => ({
  currency: r.currency,
  count: r.documents,
  taxableMinor: r.taxable,
  totalMinor: r.total,
  inrTaxableMinor: r.inr_taxable,
  inrTotalMinor: r.inr_total,
});
const collectedOf = (r: RevenueSqlRow): CollectedFigures => ({
  currency: r.currency,
  payments: r.payments,
  receivedMinor: r.received,
  refundedMinor: r.refunded,
  collectedMinor: r.collected,
  tdsMinor: r.tds,
  inrCollectedMinor: r.inr_collected,
  inrMissing: r.inr_missing,
});
const hasCollected = (r: RevenueSqlRow) => r.payments > 0 || r.tds_n > 0 || r.refunds > 0;

const clientOf = (r: {
  client_id: string;
  client_code: string;
  client_name: string;
  anonymised_at: number | null;
}) => ({
  id: r.client_id,
  code: r.client_code,
  name: r.anonymised_at === null ? r.client_name : ANONYMISED_CLIENT,
});

/** C1: the FY's revenue by month (invoiced and collected), by category or by kind (invoiced only, Q2 A). */
export async function revenueReport(
  c: Ctx,
  q: z.infer<typeof revenueQuery>,
): Promise<RevenueByMonth | RevenueByKey<string> | null> {
  const fy = fyBounds(q.fy);
  if (!fy) return null;
  const db = c.env.DB;
  const by = q.by ?? "month";
  if (by === "month") {
    const { results } = await db.prepare(REVENUE_MONTHS_SQL).bind(fy.from).all<RevenueMonthSqlRow>();
    return {
      by,
      fy: q.fy,
      from: fy.from,
      to: fy.to,
      months: fyMonths(fy.startYear).map((month) => {
        const of = results.filter((r) => r.month === month);
        return {
          month,
          invoiced: of.filter((r) => r.documents > 0).map(invoicedOf),
          collected: of.filter(hasCollected).map(collectedOf),
        };
      }),
    };
  }
  const keyed = (rows: readonly KeyedSqlRow[]) => {
    const keys: string[] = [];
    for (const r of rows) if (!keys.includes(r.key)) keys.push(r.key);
    return keys.map((key) => ({ key, invoiced: rows.filter((r) => r.key === key).map(invoicedOf) }));
  };
  if (by === "kind") {
    const { results } = await db.prepare(REVENUE_KIND_SQL).bind(fy.from, fy.to).all<KeyedSqlRow>();
    return { by, fy: q.fy, from: fy.from, to: fy.to, rows: keyed(results) };
  }
  const { results } = await db.prepare(REVENUE_CATEGORY_SQL).bind(fy.from, fy.to).all<CategorySqlRow>();
  // every row of a currency carries the same round-off: one per currency
  const roundOff: NonNullable<RevenueByKey<string>["roundOff"]> = [];
  for (const r of results)
    if (!roundOff.some((x) => x.currency === r.currency))
      roundOff.push({ currency: r.currency, roundOffMinor: r.round_off, inrRoundOffMinor: r.inr_round_off });
  return { by, fy: q.fy, from: fy.from, to: fy.to, rows: keyed(results), roundOff };
}

/** The cursor of a C2 page: the last row's invoiced total and client id; null for none, "bad" for one that is not ours. */
function revenueCursorOf(after: string | undefined): { k: number; id: string } | null | "bad" {
  if (after === undefined) return null;
  const cur = decodeCursor(after);
  return cur && typeof cur.k === "number" && Number.isSafeInteger(cur.k) && ID.test(cur.id)
    ? { k: cur.k, id: cur.id }
    : "bad";
}

export type RevenueClientsPage = {
  fy: string;
  from: string;
  to: string;
  currency: Currency;
  rows: RevenueClientRow[];
  next: string | null;
};

/** C2: one page of the clients' revenue in one currency (shared with B2's `/export` twin). `"period"` / `"cursor"` when the query is refused. */
export async function revenueClientsPage(
  c: Ctx,
  q: z.infer<typeof revenueClientsQuery>,
): Promise<RevenueClientsPage | "period" | "cursor"> {
  const fy = fyBounds(q.fy);
  if (!fy) return "period";
  const cursor = revenueCursorOf(q.after);
  if (cursor === "bad") return "cursor";
  const { results } = await c.env.DB.prepare(REVENUE_CLIENTS_SQL(cursor !== null))
    .bind(...revenueClientsBinds(fy.from, fy.to, q.currency, cursor ?? undefined))
    .all<RevenueClientSqlRow>();
  const page = results.slice(0, REPORT_PAGE_SIZE);
  const last = page.at(-1);
  return {
    fy: q.fy,
    from: fy.from,
    to: fy.to,
    currency: q.currency,
    rows: page.map((r) => ({ client: clientOf(r), invoiced: invoicedOf(r), collected: collectedOf(r) })),
    next: results.length > REPORT_PAGE_SIZE && last ? encodeCursor({ k: last.k, id: last.client_id }) : null,
  };
}

const bucketsOf = (r: AgeingSqlRow | AgeingTotalsSqlRow) =>
  Object.fromEntries(
    AGEING_BUCKETS.map((b) => [b, { count: r[`n_${b}`], balanceMinor: r[`b_${b}`] }]),
  ) as AgeingRow["buckets"];

export type AgeingPage = {
  asOf: string;
  rows: AgeingRow[];
  /** The first page only: per currency, every open document in each bucket (C9). */
  totals: { currency: Currency; buckets: AgeingRow["buckets"]; totalMinor: number }[] | null;
  next: string | null;
};

/** C9: one page of the ageing as at today (IST), by client id (shared with B2's `/export` twin). `"cursor"` when the cursor is not ours. */
export async function ageingPage(c: Ctx, q: z.infer<typeof ageingQuery>): Promise<AgeingPage | "cursor"> {
  let after: string | null = null;
  if (q.after !== undefined) {
    const cur = decodeCursor(q.after);
    if (cur?.k !== "c" || !ID.test(cur.id)) return "cursor";
    after = cur.id;
  }
  const today = todayIst();
  const db = c.env.DB;
  const page = db
    .prepare(AGEING_PAGE_SQL(after !== null))
    .bind(...(after === null ? [today] : [today, after]));
  const [rowsRes, totalsRes] = await db.batch(
    after === null ? [page, db.prepare(AGEING_TOTALS_SQL).bind(today)] : [page],
  );
  const rows = (rowsRes?.results ?? []) as AgeingSqlRow[];
  // The statement reads 51 clients (one more than a page) and gives a row per client and currency.
  const clients: string[] = [];
  for (const r of rows) if (!clients.includes(r.client_id)) clients.push(r.client_id);
  const kept = new Set(clients.slice(0, REPORT_PAGE_SIZE));
  const last = clients[REPORT_PAGE_SIZE - 1];
  return {
    asOf: today,
    rows: rows
      .filter((r) => kept.has(r.client_id))
      .map((r) => ({
        client: clientOf(r),
        currency: r.currency,
        buckets: bucketsOf(r),
        totalMinor: r.total,
        creditHeldMinor: r.credit,
      })),
    totals:
      after === null
        ? ((totalsRes?.results ?? []) as AgeingTotalsSqlRow[]).map((t) => ({
            currency: t.currency,
            buckets: bucketsOf(t),
            totalMinor: t.balance,
          }))
        : null,
    next: clients.length > REPORT_PAGE_SIZE && last ? encodeCursor({ k: "c", id: last }) : null,
  };
}

/**
 * Start-up warm-up (run file J; warm-invoices.ts): the three query schemas parsed once, the ageing bucket rule and the row mappers run on made-up rows, so the
 * first metered revenue, ageing or export request compiles none of them. Pure of `env`; the count of samples that worked is pinned (warm-split.test.ts).
 * Never throws.
 */
export function warmRevenueReports(): number {
  try {
    const money: RevenueSqlRow = {
      currency: "INR",
      documents: 1,
      taxable: 100,
      total: 118,
      inr_taxable: 100,
      inr_total: 118,
      payments: 1,
      received: 118,
      refunds: 0,
      refunded: 0,
      collected: 118,
      tds_n: 0,
      tds: 0,
      inr_missing: 0,
      inr_collected: 118,
    };
    const owed = {
      currency: "INR",
      ...Object.fromEntries(
        AGEING_BUCKETS.flatMap((b) => [
          [`n_${b}`, 1],
          [`b_${b}`, 10],
        ]),
      ),
    } as AgeingTotalsSqlRow;
    const samples = [
      revenueQuery.safeParse({ fy: "2627", by: "category" }).success,
      revenueClientsQuery.safeParse({ fy: "2627", currency: "USD", after: "x" }).success,
      ageingQuery.safeParse({ after: "x" }).success,
      ageingBucket("2026-08-01", "2026-10-15") === "d61_90",
      invoicedOf(money).count === 1 && collectedOf(money).collectedMinor === 118 && hasCollected(money),
      bucketsOf(owed).d90_plus.balanceMinor === 10,
      clientOf({ client_id: "c", client_code: "C", client_name: "N", anonymised_at: 1 }).name ===
        ANONYMISED_CLIENT,
    ];
    return samples.filter(Boolean).length;
  } catch {
    return 0; // never stop a Worker from starting
  }
}

export const revenueReports = new Hono<AppEnv>()
  .get("/revenue", query(revenueQuery), async (c) => {
    const body = await revenueReport(c, c.req.valid("query"));
    return body ? c.json(body) : err(c, PERIOD_INVALID, 400);
  })
  .get("/revenue/clients", query(revenueClientsQuery), async (c) => {
    const page = await revenueClientsPage(c, c.req.valid("query"));
    if (page === "period") return err(c, PERIOD_INVALID, 400);
    if (page === "cursor") return err(c, BAD_REQUEST, 400);
    return c.json(page);
  })
  .get("/ageing", query(ageingQuery), async (c) => {
    const page = await ageingPage(c, c.req.valid("query"));
    return page === "cursor" ? err(c, BAD_REQUEST, 400) : c.json(page);
  })
  // C6 (L6): the CSV twins of C2 and C9, the registers' rule: `exports.gst` (Owner and Accountant with a fresh code on every page, the guard's step-up) and one
  // `report.export` audit row per page with what was exported, never the rows' contents. The page is read first; a refused query or cursor writes nothing.
  .get("/revenue/export", query(revenueClientsQuery), async (c) => {
    const page = await revenueClientsPage(c, c.req.valid("query"));
    if (page === "period") return err(c, PERIOD_INVALID, 400);
    if (page === "cursor") return err(c, BAD_REQUEST, 400);
    const written = await mutate(c, {
      action: "report.export",
      entityType: "report",
      entityId: null,
      summary: {
        report: "revenue_clients",
        fy: page.fy,
        currency: page.currency,
        rows: page.rows.length,
        firstPage: c.req.valid("query").after === undefined,
      },
    });
    return written ? c.json(page) : err(c, BAD_REQUEST, 400);
  })
  .get("/ageing/export", query(ageingQuery), async (c) => {
    const page = await ageingPage(c, c.req.valid("query"));
    if (page === "cursor") return err(c, BAD_REQUEST, 400);
    const written = await mutate(c, {
      action: "report.export",
      entityType: "report",
      entityId: null,
      summary: { report: "ageing", asOf: page.asOf, rows: page.rows.length, firstPage: page.totals !== null },
    });
    return written ? c.json(page) : err(c, BAD_REQUEST, 400);
  });
