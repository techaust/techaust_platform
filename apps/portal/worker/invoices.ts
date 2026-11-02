// The signed-in contact's invoices (M5.4; POR-06, POR-07, Q49, LD62): the list of invoices, proformas, credit notes and debit notes of the organisation, one document's summary and its PDF. A finance-only area (a
// contact without "can see finance" gets the plain 404, as for a document that is not theirs). Every query goes through `forClient`/`bound` with the organisation of the session (`client_id = ?1`);
// another organisation's invoice is the same 404 as one that does not exist. Nothing here pays or marks anything paid (M6, M7.1).
import { IP_READ, portalPayKey, RESERVE_SQL } from "@techaust/auth";
import { Hono } from "hono/tiny";
import { type AppEnv, BAD_REQUEST, type Ctx, err, NOT_FOUND, rateLimited } from "./context.ts";
import {
  CREDIT_NOTES_SQL,
  type CreditNoteRow,
  isWithdrawnRow,
  LINES_SQL,
  type LineRow,
  listItemOf,
  ONLINE_SQL,
  type OnlineRow,
  onlineOf,
  openOrWithdrawnSql,
  PDF_WITHDRAWN,
  SUMMARY_COLS,
  SUMMARY_PARENT_JOIN,
  type SummaryRow,
  summaryOf,
  TYPES_SQL,
  VIEW_PDF_SQL,
  VIEW_SQL,
} from "./invoice-summary.ts";
import { bound, streamPdf } from "./offer-core.ts";
import { pdfFileName } from "./offer-sql.ts";
import { createLink, payAnswer, payBody, providerOf, refreshForClient } from "./pay.ts";
import { PAY_RETURN_LIMIT, PAY_RETURN_WINDOW_MS } from "./pay-return.ts";
import { scope } from "./scope.ts";
import { json } from "./validate.ts";

/** The list's query string: `limit` (1 to 50) and the cursor from the previous page (`issue date:id`). */
const LIMIT = /^\d{1,2}$/;
const AFTER = /^\d{4}-\d{2}-\d{2}:[A-Za-z0-9-]{1,64}$/;
/** Our checkout id on the signed-in page's PayPal return (`c`, a UUID). */
const CHECKOUT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Review part 1, finding 2: the signed-in page's PayPal returns (`?c=`) per CONTACT, under the same `p:pay:` window as the emailed link's return (20 per 10
 * minutes, then locked for the window): each one may POST PayPal's capture, and repeated captures of a declined order count toward PayPal's own attempt limit.
 * True when this request may go on; else the lock's end (UTC ms) for `Retry-After`.
 */
async function payReturnAllowed(c: Ctx, contactId: string, t: number): Promise<true | number> {
  const db = c.env.DB;
  const key = await portalPayKey(c.env.PORTAL_KEY_PEPPER, `contact:${contactId}`);
  const [quota, lock] = await db.batch([
    db.prepare(RESERVE_SQL).bind(key, t, PAY_RETURN_WINDOW_MS, PAY_RETURN_LIMIT, PAY_RETURN_WINDOW_MS, key),
    db.prepare(IP_READ).bind(key),
  ]);
  if (quota?.results[0]) return true;
  return (
    (lock?.results[0] as { locked_until: number | null } | undefined)?.locked_until ??
    t + PAY_RETURN_WINDOW_MS
  );
}

/** ?1 client, ?2 and ?3 the last row's issue date and id (null on the first page), ?4 the page size plus one. Newest first. */
export const LIST_SQL = `SELECT d.id, d.type, d.status, d.number_display, d.issue_date, d.due_date, d.currency, d.total_minor, d.balance_minor, d.voided_at
   FROM documents d
   WHERE d.client_id = ?1 AND d.frozen_at IS NOT NULL AND ${openOrWithdrawnSql("d")} AND d.type IN (${TYPES_SQL})
     AND (?2 IS NULL OR d.issue_date < ?2 OR (d.issue_date = ?2 AND d.id < ?3))
   ORDER BY d.issue_date DESC, d.id DESC LIMIT ?4`;

/** One document of this client (?1 client, ?2 id): the summary's columns. */
export const ONE_SQL = `SELECT ${SUMMARY_COLS} FROM documents d ${SUMMARY_PARENT_JOIN}
   WHERE d.client_id = ?1 AND d.id = ?2 AND d.frozen_at IS NOT NULL AND ${openOrWithdrawnSql("d")} AND d.type IN (${TYPES_SQL})`;

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
    // M6.2 (run file E): `?refresh=1` (the Processing state after 20 s) asks the finance Worker for the link's status first, at most once a minute there.
    // M6.4 (early check 2 finding 3): `&c=<checkout id>` is the signed-in page's return from PayPal (`?pay=paypal&c=…`): THAT checkout is captured (bound to
    // this client and document in the finance Worker) and its state comes back as `online.payPalReturn` (07-ZN lines 4 to 11); `c` implies the refresh. A
    // malformed id is a 400.
    const checkoutId = c.req.query("c");
    if (checkoutId !== undefined && !CHECKOUT_ID.test(checkoutId)) return err(c, BAD_REQUEST, 400);
    if (checkoutId !== undefined) {
      const t = Date.now();
      const allowed = await payReturnAllowed(c, s.contactId, t);
      if (allowed !== true) return rateLimited(c, (allowed - t) / 1000);
    }
    const refreshed =
      c.req.query("refresh") === "1" || checkoutId !== undefined
        ? await refreshForClient(c.env, {
            clientId: s.clientId,
            documentId: id,
            ...(checkoutId === undefined ? {} : { checkoutId }),
          })
        : null;
    const payPalReturn = checkoutId !== undefined ? refreshed?.payPalReturn : undefined;
    const now = Date.now();
    const [, doc, lines, credits, online] = await c.env.DB.batch([
      bound(c.env.DB, VIEW_SQL, [s.clientId, id, now]),
      bound(c.env.DB, ONE_SQL, [s.clientId, id]),
      bound(c.env.DB, LINES_SQL, [s.clientId, id]),
      bound(c.env.DB, CREDIT_NOTES_SQL, [s.clientId, id]),
      bound(c.env.DB, ONLINE_SQL, [s.clientId, id, now]),
    ]);
    const row = doc?.results[0] as SummaryRow | undefined;
    if (!row) return err(c, NOT_FOUND, 404);
    const o = onlineOf(online?.results[0] as OnlineRow | undefined);
    return c.json({
      document: {
        ...summaryOf(row, (lines?.results ?? []) as LineRow[], (credits?.results ?? []) as CreditNoteRow[]),
        ...o,
        // Only on the answer to the return that named the checkout: `{state, retryUrl?}` (a state only; `retryUrl` only with `declined`, PayPal's own page).
        ...(payPalReturn ? { online: { ...o.online, payPalReturn } } : {}),
      },
    });
  })
  // M6.2 (POR-06): Pay now. CSRF and the finance-only guard ran before this; the client is the session's, and the finance Worker re-checks everything.
  .post("/:id/pay", json(payBody), async (c) => {
    const s = scope(c);
    const id = idOf(c);
    if (!id) return err(c, NOT_FOUND, 404);
    const { amountMinor, provider: asked } = c.req.valid("json");
    // M6.3 ("What B2 must not forget" 7): the gateway the document's currency allows (one bound read), unless the request names one; finance re-checks it.
    const doc = asked
      ? null
      : await bound(c.env.DB, "SELECT d.currency FROM documents d WHERE d.client_id = ?1 AND d.id = ?2", [
          s.clientId,
          id,
        ]).first<{ currency: string }>();
    const provider = providerOf(doc?.currency, asked);
    const r = await createLink(c.env, {
      provider,
      clientId: s.clientId,
      contactId: s.contactId,
      tokenHash: null,
      documentId: id,
      amountMinor,
      returnTo: "invoice",
    });
    return payAnswer(c, r, provider);
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
    // ADM-INV-10 (Q3): a withdrawn proforma's stored PDF still carries the bank details, so it is never served (R2 is not read).
    if (isWithdrawnRow(row)) return err(c, PDF_WITHDRAWN, 409);
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
