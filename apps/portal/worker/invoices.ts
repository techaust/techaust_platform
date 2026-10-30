// The signed-in contact's invoices (M5.4; POR-06, POR-07, Q49, LD62): the list of invoices, proformas, credit notes and debit notes of the organisation, one document's summary and its PDF. A finance-only area (a
// contact without "can see finance" gets the plain 404, as for a document that is not theirs). Every query goes through `forClient`/`bound` with the organisation of the session (`client_id = ?1`);
// another organisation's invoice is the same 404 as one that does not exist. Nothing here pays or marks anything paid (M6, M7.1).
import { Hono } from "hono/tiny";
import { type AppEnv, BAD_REQUEST, type Ctx, err, NOT_FOUND } from "./context.ts";
import {
  CREDIT_NOTES_SQL,
  type CreditNoteRow,
  LINES_SQL,
  type LineRow,
  listItemOf,
  STATUSES_SQL,
  SUMMARY_COLS,
  type SummaryRow,
  summaryOf,
  TYPES_SQL,
  VIEW_PDF_SQL,
  VIEW_SQL,
} from "./invoice-summary.ts";
import { bound, streamPdf } from "./offer-core.ts";
import { pdfFileName } from "./offer-sql.ts";
import { scope } from "./scope.ts";

/** The list's query string: `limit` (1 to 50) and the cursor from the previous page (`issue date:id`). */
const LIMIT = /^\d{1,2}$/;
const AFTER = /^\d{4}-\d{2}-\d{2}:[A-Za-z0-9-]{1,64}$/;

/** ?1 client, ?2 and ?3 the last row's issue date and id (null on the first page), ?4 the page size plus one. Newest first. */
export const LIST_SQL = `SELECT d.id, d.type, d.status, d.number_display, d.issue_date, d.due_date, d.currency, d.total_minor, d.balance_minor
   FROM documents d
   WHERE d.client_id = ?1 AND d.frozen_at IS NOT NULL AND d.voided_at IS NULL AND d.status IN (${STATUSES_SQL}) AND d.type IN (${TYPES_SQL})
     AND (?2 IS NULL OR d.issue_date < ?2 OR (d.issue_date = ?2 AND d.id < ?3))
   ORDER BY d.issue_date DESC, d.id DESC LIMIT ?4`;

/** One document of this client (?1 client, ?2 id): the summary's columns. */
export const ONE_SQL = `SELECT ${SUMMARY_COLS} FROM documents d
   WHERE d.client_id = ?1 AND d.id = ?2 AND d.frozen_at IS NOT NULL AND d.voided_at IS NULL AND d.status IN (${STATUSES_SQL}) AND d.type IN (${TYPES_SQL})`;

/** An id the database could not hold is a 404 without a query. */
const idOf = (c: Ctx): string | null => {
  const id = c.req.param("id") ?? "";
  return id.length > 0 && id.length <= 64 ? id : null;
};

export const invoices = new Hono<AppEnv>()
  .get("/", async (c) => {
    const s = scope(c);
    const rawLimit = c.req.query("limit");
    const after = c.req.query("after") ?? null;
    if (rawLimit !== undefined && !LIMIT.test(rawLimit)) return err(c, BAD_REQUEST, 400);
    if (after !== null && !AFTER.test(after)) return err(c, BAD_REQUEST, 400);
    const take = Math.min(Math.max(rawLimit === undefined ? 50 : Number(rawLimit), 1), 50);
    const [date, id] = after ? (after.split(":") as [string, string]) : [null, ""];
    const rows = (await bound(c.env.DB, LIST_SQL, [s.clientId, date, id, take + 1]).all<SummaryRow>())
      .results;
    const page = rows.slice(0, take);
    const last = page[page.length - 1];
    return c.json({
      invoices: page.map(listItemOf),
      next: rows.length > take && last?.issue_date ? `${last.issue_date}:${last.id}` : null,
    });
  })
  .get("/:id", async (c) => {
    const s = scope(c);
    const id = idOf(c);
    if (!id) return err(c, NOT_FOUND, 404);
    // FX-5 (08-C RA-10): the first view is written FIRST, in the batch that reads what the answer shows, never after the answer (a void landing
    // between a 200 and a background write would pass, and a failed background write would lose the view). The access row and the session touch stay
    // in the background (index.ts).
    const [, doc, lines, credits] = await c.env.DB.batch([
      bound(c.env.DB, VIEW_SQL, [s.clientId, id, Date.now()]),
      bound(c.env.DB, ONE_SQL, [s.clientId, id]),
      bound(c.env.DB, LINES_SQL, [s.clientId, id]),
      bound(c.env.DB, CREDIT_NOTES_SQL, [s.clientId, id]),
    ]);
    const row = doc?.results[0] as SummaryRow | undefined;
    if (!row) return err(c, NOT_FOUND, 404);
    return c.json({
      document: summaryOf(
        row,
        (lines?.results ?? []) as LineRow[],
        (credits?.results ?? []) as CreditNoteRow[],
      ),
    });
  })
  .get("/:id/pdf", async (c) => {
    const s = scope(c);
    const id = idOf(c);
    if (!id) return err(c, NOT_FOUND, 404);
    // FX-5 (08-C RA-10): opening the PDF is a view too, written in the same batch as the read (as above), once the PDF exists.
    const [, doc] = await c.env.DB.batch([
      bound(c.env.DB, VIEW_PDF_SQL, [s.clientId, id, Date.now()]),
      bound(c.env.DB, ONE_SQL, [s.clientId, id]),
    ]);
    const row = doc?.results[0] as SummaryRow | undefined;
    if (!row) return err(c, NOT_FOUND, 404);
    if (!row.pdf_r2_key)
      return c.json(
        {
          error: { code: "pdf_pending", message: "The document is still being prepared" },
          request_id: c.var.rid,
        },
        409,
      );
    return streamPdf(c, row.pdf_r2_key, pdfFileName(row.number_display, 1));
  });
