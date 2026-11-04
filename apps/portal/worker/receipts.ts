// The organisation's receipts and credit notes (M7.1; POR-07, L20; run file C): `GET /receipts?after=&limit=`, finance-only (a contact without "can see
// finance" gets the plain 404 at the guard; Researched 2026-10-28, RB-31: invoice information only to finance contacts). Read from the FROZEN rows, as M5.4's
// invoice list is: the issued receipts of the client's payments (M6.5: type `receipt`, `rct_<payment id>`, a void one is never listed) and its issued credit
// notes (frozen, not void, an open status). A keyset page of at most 50, newest first, on `documents_client_receipts`; every statement says `client_id = ?1`.
// The PDFs are the existing routes, reused (Step 0): `GET /receipts/:id/pdf` (M6.5) for a receipt and `GET /invoices/:id/pdf` (M5.4) for a credit note.
import { Hono } from "hono/tiny";
import { type AppEnv, BAD_REQUEST, err } from "./context.ts";
import { STATUSES_SQL, TYPES_SQL } from "./invoice-summary.ts";
import { bound } from "./offer-core.ts";
import { scope } from "./scope.ts";

const LIMIT = /^\d{1,2}$/;
/** The cursor: the last row's issue day and id. */
const AFTER = /^\d{4}-\d{2}-\d{2}:[A-Za-z0-9_-]{1,64}$/;

const COLS = `r.id, r.type, r.number_display, r.issue_date, r.currency, r.total_minor, r.pdf_r2_key IS NOT NULL AS has_pdf,
     CASE WHEN r.type = 'receipt' THEN json_extract(r.header_extras, '$.receiptOf.appliedTo') END AS applied_to,
     CASE WHEN r.type = 'receipt' THEN json_extract(r.header_extras, '$.receiptOf.appliedMore') END AS applied_more,
     p.number_display AS parent_number,
     CASE WHEN p.frozen_at IS NOT NULL AND p.voided_at IS NULL AND p.status IN (${STATUSES_SQL}) AND p.type IN (${TYPES_SQL}) THEN p.id END AS parent_open_id`;
const FROM = `FROM documents r INDEXED BY documents_client_receipts LEFT JOIN documents p ON p.id = r.parent_id AND p.client_id = r.client_id
   WHERE r.client_id = ?1 AND r.frozen_at IS NOT NULL AND r.type IN ('receipt', 'credit_note')
     AND ((r.type = 'receipt' AND r.status = 'issued') OR (r.type = 'credit_note' AND r.voided_at IS NULL AND r.status IN (${STATUSES_SQL})))`;
/** ?1 client, ?2 the page size plus one. */
export const RECEIPTS_SQL = `SELECT ${COLS} ${FROM} ORDER BY r.issue_date DESC, r.id DESC LIMIT ?2`;
/** ?1 client, ?2 and ?3 the last row's issue day and id, ?4 the page size plus one. */
export const RECEIPTS_AFTER_SQL = `SELECT ${COLS} ${FROM} AND (r.issue_date, r.id) < (?2, ?3) ORDER BY r.issue_date DESC, r.id DESC LIMIT ?4`;

export type ReceiptListRow = {
  id: string;
  type: string;
  number_display: string | null;
  issue_date: string | null;
  currency: string;
  total_minor: number;
  has_pdf: number;
  applied_to: string | null;
  applied_more: number | null;
  parent_number: string | null;
  parent_open_id: string | null;
};

/** The invoice numbers a receipt's money was applied to at issue (its sealed `receiptOf.appliedTo`); empty on damaged data. */
function appliedNumbers(text: string | null): string[] {
  if (!text) return [];
  try {
    const list = JSON.parse(text) as unknown;
    return Array.isArray(list)
      ? list.flatMap((a) =>
          typeof a === "object" && a !== null && typeof (a as { number?: unknown }).number === "string"
            ? [(a as { number: string }).number]
            : [],
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * One row of the list (C11: number, date, amount, "For", Download PDF). `for` is what the document is for: a receipt's invoices (as sealed, with how many more
 * were left out) or a credit note's invoice (with its id only when the client may open it).
 */
export function receiptRowOf(r: ReceiptListRow) {
  const receipt = r.type === "receipt";
  return {
    id: r.id,
    kind: receipt ? ("receipt" as const) : ("credit_note" as const),
    numberDisplay: r.number_display,
    issueDate: r.issue_date,
    currency: r.currency,
    amountMinor: r.total_minor,
    pdfReady: r.has_pdf === 1,
    for: receipt
      ? {
          numbers: appliedNumbers(r.applied_to),
          more: Number.isSafeInteger(r.applied_more) ? r.applied_more : 0,
        }
      : { numbers: r.parent_number ? [r.parent_number] : [], more: 0, invoiceId: r.parent_open_id },
  };
}

export const receiptList = new Hono<AppEnv>().get("/", async (c) => {
  const s = scope(c);
  const rawLimit = c.req.query("limit");
  const after = c.req.query("after");
  if (rawLimit !== undefined && !LIMIT.test(rawLimit)) return err(c, BAD_REQUEST, 400);
  if (after !== undefined && !AFTER.test(after)) return err(c, BAD_REQUEST, 400);
  const take = Math.min(Math.max(rawLimit === undefined ? 50 : Number(rawLimit), 1), 50);
  const at = after?.indexOf(":") ?? -1;
  const rows = (
    await (after
      ? bound(c.env.DB, RECEIPTS_AFTER_SQL, [s.clientId, after.slice(0, at), after.slice(at + 1), take + 1])
      : bound(c.env.DB, RECEIPTS_SQL, [s.clientId, take + 1])
    ).all<ReceiptListRow>()
  ).results;
  const page = rows.slice(0, take);
  const last = page[page.length - 1];
  return c.json({
    items: page.map(receiptRowOf),
    next: rows.length > take && last?.issue_date ? `${last.issue_date}:${last.id}` : null,
  });
});
