// Single-document links [POR-06, LD9, LD55, LD62]: `POST /api/v1/t/document {token}` and `POST /api/v1/t/document/pdf {token}`. The token travels ONLY in the body (the link form is `portal.../i#t=<token>`; no
// route has a token in its path or query), resolves exactly one document, and the answer is that document's summary and nothing else (`invoice-summary.ts`). The send flows (M5.4) mint one link per recipient.
//
// Since M5.4 a link is BOUND to one contact (like an offer link): the read joins the LIVE contact (portal access on, not anonymised, the same address as when the link was made), the document must belong to
// the client the link was made for, and the client must not be anonymised. Turning access off, changing the address, anonymising the person or the client, revoking the link, voiding the invoice or the link
// expiring ends it at once. What opens: an invoice, proforma, credit note or debit note in a status of `CLIENT_INVOICE_STATUSES` (invoice-summary.ts) (never a draft, a pending approval or a void one). Every other outcome is the
// same 404, and counts toward the address's `p:fail:` counter like a failed sign-in link; a blocked address gets a 429 and writes nothing.
//
// Under the owner's Q1 = A a document-link use is a sign-in event: a valid use writes one `doc_token.use` audit row (actor type `contact`, the contact the link is bound to; the entity is the document), an
// access row, and sets `documents.viewed_at` once (the first view, before the answer; the PDF too); a failed one writes the counter and an access row.
import {
  docTokenRequest,
  FAIL_SQL,
  IP_READ,
  PORTAL_FAIL_LIMIT,
  PORTAL_FAIL_LOCK_MS,
  PORTAL_FAIL_WINDOW_MS,
  portalFailKey,
  tokenHash,
} from "@techaust/auth";
import { accessStmt, auditStmt } from "@techaust/db/log";
import { Hono } from "hono/tiny";
import {
  type AppEnv,
  accessEntry,
  type Ctx,
  callerAddress,
  err,
  logBatch,
  NOT_FOUND,
  rateLimited,
  requestInfo,
} from "./context.ts";
import {
  CLIENT_INVOICE_TYPES,
  CREDIT_NOTES_SQL,
  type CreditNoteRow,
  LINES_SQL,
  type LineRow,
  STATUSES_SQL,
  SUMMARY_COLS,
  SUMMARY_PARENT_JOIN,
  type SummaryRow,
  summaryOf,
  TYPES_SQL,
  VIEW_PDF_SQL,
  VIEW_SQL,
} from "./invoice-summary.ts";
import { streamPdf } from "./offer-core.ts";
import { pdfFileName } from "./offer-sql.ts";
import { json } from "./validate.ts";

/** Document types a link may open: the whole invoice family (LD62; a receipt is M6). */
export const VIEW_PAY_TYPES = CLIENT_INVOICE_TYPES;
/**
 * ?1 token hash, ?2 now. The token, the document of the SAME client, the live contact it is bound to and the client, in one read (primary-key lookups; tests EXPLAIN it). The columns after the summary's
 * are the principal (who the link is for).
 */
export const DOC_READ = `SELECT ${SUMMARY_COLS}, t.contact_id AS link_contact_id, t.client_id AS link_client_id
  FROM doc_access_tokens t
  JOIN documents d ON d.id = t.document_id AND d.client_id = t.client_id
  JOIN contacts c ON c.id = t.contact_id AND c.client_id = t.client_id AND c.portal_access = 1 AND c.can_see_finance = 1 AND c.anonymised_at IS NULL AND lower(c.email) = t.email
  JOIN clients cl ON cl.id = t.client_id AND cl.anonymised_at IS NULL
  ${SUMMARY_PARENT_JOIN}
  WHERE t.token_hash = ?1 AND t.revoked_at IS NULL AND t.expires_at > ?2 AND t.purpose = 'view_pay' AND d.voided_at IS NULL AND d.frozen_at IS NOT NULL AND d.status IN (${STATUSES_SQL}) AND d.type IN (${TYPES_SQL})`;

type Found = SummaryRow & { link_contact_id: string; link_client_id: string };
type Opened = { doc: Found; failKey: string };

/** The address lock and the link in ONE batch: a Response (429 or 404) or the live document the link opens. */
async function open(c: Ctx, token: string): Promise<Opened | Response> {
  const db = c.env.DB;
  const t = Date.now();
  const failKey = await portalFailKey(c.env.PORTAL_KEY_PEPPER, callerAddress(c));
  // A token of the wrong shape is just a failed check: its hash matches nothing, and it counts like any other.
  const [lock, found] = await db.batch([
    db.prepare(IP_READ).bind(failKey),
    db.prepare(DOC_READ).bind(await tokenHash(token), t),
  ]);
  const until = (lock?.results[0] as { locked_until: number | null } | undefined)?.locked_until;
  if (until && until > t) {
    c.set("accessDone", true); // a blocked address writes nothing
    return rateLimited(c, (until - t) / 1000);
  }
  const doc = found?.results[0] as Found | undefined;
  if (!doc) {
    await logBatch(c, 404, [
      db.prepare(FAIL_SQL).bind(failKey, t, PORTAL_FAIL_WINDOW_MS, PORTAL_FAIL_LIMIT, PORTAL_FAIL_LOCK_MS),
    ]);
    return err(c, NOT_FOUND, 404);
  }
  return { doc, failKey };
}

export const docToken = new Hono<AppEnv>()
  .post("/document", json(docTokenRequest), async (c) => {
    const { token } = c.req.valid("json");
    const o = await open(c, token);
    if (o instanceof Response) return o;
    const { doc } = o;
    const db = c.env.DB;
    const t = Date.now();
    c.set("accessDone", true);
    // One batch: the frozen lines (read first), the audit row of the use, the first view (`VIEW_SQL`: set once, only on a document the client may still
    // open, so never on a void one; FX-5, 08-C RA-10), and the access row.
    const [lines, credits] = await db.batch([
      db.prepare(LINES_SQL).bind(doc.link_client_id, doc.id),
      db.prepare(CREDIT_NOTES_SQL).bind(doc.link_client_id, doc.id),
      auditStmt(db, {
        ...requestInfo(c),
        actorType: "contact",
        actorId: doc.link_contact_id,
        role: null,
        action: "doc_token.use",
        entityType: "document",
        entityId: doc.id,
      }),
      db.prepare(VIEW_SQL).bind(doc.link_client_id, doc.id, t),
      accessStmt(db, accessEntry(c, 200, doc.link_contact_id)),
    ]);
    return c.json({
      document: summaryOf(
        doc,
        (lines?.results ?? []) as LineRow[],
        (credits?.results ?? []) as CreditNoteRow[],
      ),
    });
  })
  // The PDF behind the link (the same open and the same counter). The headers are those of the offer PDF: an attachment, never rendered, never cached, never sniffed.
  // Opening it is a view too (FX-5, 08-C RA-10; parity with the signed-in PDF): the first view and the access row in one batch, before the answer.
  .post("/document/pdf", json(docTokenRequest), async (c) => {
    const { token } = c.req.valid("json");
    const o = await open(c, token);
    if (o instanceof Response) return o;
    const { doc } = o;
    const db = c.env.DB;
    c.set("accessDone", true);
    await db.batch([
      db.prepare(VIEW_PDF_SQL).bind(doc.link_client_id, doc.id, Date.now()),
      accessStmt(db, accessEntry(c, doc.pdf_r2_key ? 200 : 409, doc.link_contact_id)),
    ]);
    if (!doc.pdf_r2_key)
      return c.json(
        {
          error: { code: "pdf_pending", message: "The document is still being prepared" },
          request_id: c.var.rid,
        },
        409,
      );
    return streamPdf(c, doc.pdf_r2_key, pdfFileName(doc.number_display, 1));
  });
