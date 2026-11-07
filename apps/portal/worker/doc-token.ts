// Single-document links [POR-06, LD9, LD55, LD62]: `POST /api/v1/t/document {token}` and `POST /api/v1/t/document/pdf {token}`. The token travels ONLY in the body (the link form is `portal.../i#t=<token>`; no
// route has a token in its path or query), resolves exactly one document, and the answer is that document's summary and nothing else (`invoice-summary.ts`). The send flows (M5.4) mint one link per recipient.
//
// Since M5.4 a link is BOUND to one contact (like an offer link): the read joins the LIVE contact (portal access on, not anonymised, the same address as when the link was made), the document must belong to
// the client the link was made for, and the client must not be anonymised. Turning access off, changing the address, anonymising the person or the client, revoking the link, voiding the invoice or the link
// expiring ends it at once. What opens: an invoice, proforma, credit note or debit note in a status of `CLIENT_INVOICE_STATUSES` (invoice-summary.ts) (never a draft, a pending approval or a void one). Every other outcome is the
// same 404, and counts toward the address's `p:fail:` counter like a failed sign-in link; a blocked address gets a 429 and writes nothing.
// M7.1 L12 and review 1 L3: a genuine link that ended 30 days after its document was settled is the same 404 but is NOT counted (old links must not lock an address).
// ADM-INV-10 (owner, 2026-10-30, docs/13): a withdrawn proforma (`openOrWithdrawnSql`) still opens, as withdrawn (a valid link, no failure counted); its PDF is a 409.
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
import { viewPayLiveSql } from "@techaust/db/sql-rules";
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
  isWithdrawnRow,
  LINES_SQL,
  type LineRow,
  ONLINE_SQL,
  type OnlineRow,
  onlineOf,
  openOrWithdrawnSql,
  openSql,
  PDF_WITHDRAWN,
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
import { createLink, payAnswer, payTokenBody, providerOf } from "./pay.ts";
import { json } from "./validate.ts";

/** Document types a link may open: the whole invoice family (LD62; a receipt is M6). */
export const VIEW_PAY_TYPES = CLIENT_INVOICE_TYPES;
/**
 * ?1 token hash, ?2 now. The token, the document of the SAME client, the live contact it is bound to and the client, in one read (primary-key lookups; tests EXPLAIN it). The columns after the summary's
 * are the principal (who the link is for). `view_pay_live` is L12's end (paid + 30 days), read as a column rather than in the WHERE (review 1, L3): a row with
 * `view_pay_live = 0` is a genuine link that ended because the document was settled, the 404 WITHOUT a `p:fail:` count (only a wrong or unknown token counts).
 */
export const DOC_READ = `SELECT ${SUMMARY_COLS}, t.contact_id AS link_contact_id, t.client_id AS link_client_id, ${viewPayLiveSql("d", "?2")} AS view_pay_live
  FROM doc_access_tokens t
  JOIN documents d ON d.id = t.document_id AND d.client_id = t.client_id
  JOIN contacts c ON c.id = t.contact_id AND c.client_id = t.client_id AND c.portal_access = 1 AND c.can_see_finance = 1 AND c.anonymised_at IS NULL AND lower(c.email) = t.email
  JOIN clients cl ON cl.id = t.client_id AND cl.anonymised_at IS NULL
  ${SUMMARY_PARENT_JOIN}
  WHERE t.token_hash = ?1 AND t.revoked_at IS NULL AND t.expires_at > ?2 AND t.purpose = 'view_pay' AND d.frozen_at IS NOT NULL AND ${openOrWithdrawnSql("d")} AND d.type IN (${TYPES_SQL})`;

/**
 * M7.1 L13 (the proforma-withdraw re-check): the link is still live NOW, for this document (`d`): not revoked, not expired, bound to its live contact with
 * portal access and finance at the same address, of a client not anonymised, and not past paid + 30 days (L12). `h` the token hash, `n` now.
 */
export const linkLiveSql = (h: string, n: string) =>
  `EXISTS (SELECT 1 FROM doc_access_tokens lt
     JOIN contacts lc ON lc.id = lt.contact_id AND lc.client_id = lt.client_id AND lc.portal_access = 1 AND lc.can_see_finance = 1 AND lc.anonymised_at IS NULL AND lower(lc.email) = lt.email
     JOIN clients lcl ON lcl.id = lt.client_id AND lcl.anonymised_at IS NULL
     WHERE lt.token_hash = ${h} AND lt.document_id = d.id AND lt.client_id = d.client_id AND lt.revoked_at IS NULL AND lt.expires_at > ${n} AND lt.purpose = 'view_pay'
       AND ${viewPayLiveSql("d", n)})`;

/**
 * L11 (12 "M1.6"): a link's use writes its `doc_token.use` audit row at most once per contact and document per 15 minutes (on `audit_log_entity`); the access
 * row stays one per request (13 2026-10-21). The guard of the audit insert: the document, the contact and the cut (now less 15 minutes).
 */
export const DOC_TOKEN_AUDIT_WINDOW_MS = 15 * 60_000;
const auditThrottle = (documentId: string, contactId: string, now: number) => ({
  sql: (at: number) =>
    `NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_type = 'document' AND a.entity_id = ?${at} AND a.action = 'doc_token.use' AND a.actor_id = ?${at + 1} AND a.at > ?${at + 2})`,
  params: [documentId, contactId, now - DOC_TOKEN_AUDIT_WINDOW_MS],
});

/**
 * ?1 client, ?2 document, ?3 token hash, ?4 now: the document's state NOW, read in the batch that writes the PDF view (review L1). `open()` read the row in an
 * earlier batch, so a withdrawal, a void, a revoked link, a contact who lost finance or access, or a PDF that finished in between would otherwise be read from
 * the old row. M7.1 L13: the PDF key and every link and contact condition are read HERE, and the PDF is served only from what this returns. `open` = the PDF
 * may be served; `readable` without `open` = withdrawn; `link_live` = the link still opens.
 */
export const PDF_STATE_SQL = `SELECT d.type, d.status, d.pdf_r2_key, d.number_display, ${openSql("d")} AS open, ${openOrWithdrawnSql("d")} AS readable,
    ${linkLiveSql("?3", "?4")} AS link_live
  FROM documents d WHERE d.client_id = ?1 AND d.id = ?2`;
type PdfState = {
  type: string;
  status: string;
  pdf_r2_key: string | null;
  number_display: string | null;
  open: number;
  readable: number;
  link_live: number;
};
/** The PDF's first view through a link (?1 client, ?2 document, ?3 now, ?4 token hash): only while the link is still live (L13), and only a delivered PDF. */
export const LINK_VIEW_PDF_SQL = `${VIEW_PDF_SQL} AND EXISTS (SELECT 1 FROM documents d WHERE d.id = ?2 AND d.client_id = ?1 AND ${linkLiveSql("?4", "?3")})`;

/**
 * Full audit M6–M7 AU12 (B3 M1; 08-C RA-10): the summary's first view through a link (?1 client, ?2 document, ?3 now, ?4 token hash), written FIRST in the
 * batch that serves the page and only while the link is still live, so a void (or a revoke, an expiry, a lost access) that landed after `open()` writes no
 * view and is never served.
 */
export const LINK_VIEW_SQL = `${VIEW_SQL} AND EXISTS (SELECT 1 FROM documents d WHERE d.id = ?2 AND d.client_id = ?1 AND ${linkLiveSql("?4", "?3")})`;

/**
 * AU12: the summary read again in the same batch, after the view (?1 client, ?2 document, ?3 token hash, ?4 now): the document as it is NOW, only while the
 * link is still live and the document still one the client may open (a withdrawn proforma included). The answer is served only from this row.
 */
export const DOC_REREAD_SQL = `SELECT ${SUMMARY_COLS} FROM documents d ${SUMMARY_PARENT_JOIN}
  WHERE d.client_id = ?1 AND d.id = ?2 AND d.frozen_at IS NOT NULL AND ${openOrWithdrawnSql("d")} AND d.type IN (${TYPES_SQL}) AND ${linkLiveSql("?3", "?4")}`;

/**
 * AU12: a log row's guard: the document is still one the client may open and the link is still live for it, the re-read's own rule (`n` the first
 * placeholder; document, client, token hash, now).
 */
const linkLiveGuard = (documentId: string, clientId: string, hash: string, now: number) => ({
  sql: (n: number) =>
    `EXISTS (SELECT 1 FROM documents d WHERE d.id = ?${n} AND d.client_id = ?${n + 1} AND d.frozen_at IS NOT NULL AND ${openOrWithdrawnSql("d")} AND d.type IN (${TYPES_SQL}) AND ${linkLiveSql(`?${n + 2}`, `?${n + 3}`)})`,
  params: [documentId, clientId, hash, now],
});

export type Found = SummaryRow & { link_contact_id: string; link_client_id: string; view_pay_live: number };
export type Opened = { doc: Found; failKey: string; hash: string };

/**
 * The address lock and the link in ONE batch: a Response (429 or 404) or the live document the link opens. A wrong or unknown token is the 404 and counts on
 * `p:fail:`; a genuine link past its 30 days after settlement (L12) is the same 404, not counted (review 1, L3: old links must not lock an office address).
 */
export async function open(c: Ctx, token: string): Promise<Opened | Response> {
  const db = c.env.DB;
  const t = Date.now();
  const failKey = await portalFailKey(c.env.PORTAL_KEY_PEPPER, callerAddress(c));
  // A token of the wrong shape is just a failed check: its hash matches nothing, and it counts like any other.
  const hash = await tokenHash(token);
  const [lock, found] = await db.batch([
    db.prepare(IP_READ).bind(failKey),
    db.prepare(DOC_READ).bind(hash, t),
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
  if (doc.view_pay_live !== 1) {
    // Review 1, L3: a genuine link that ended with the document's settlement. The access row only (the link's contact), no `p:fail:` count.
    c.set("accessDone", true);
    await db.batch([accessStmt(db, accessEntry(c, 404, doc.link_contact_id))]);
    return err(c, NOT_FOUND, 404);
  }
  return { doc, failKey, hash };
}

export const docToken = new Hono<AppEnv>()
  .post("/document", json(docTokenRequest), async (c) => {
    const { token } = c.req.valid("json");
    const o = await open(c, token);
    if (o instanceof Response) return o;
    const { doc, hash } = o;
    const db = c.env.DB;
    const t = Date.now();
    c.set("accessDone", true);
    // Full audit AU12 (B3 M1; FX-5, 08-C RA-10): ONE batch, the first view FIRST and only while the link is still live (`LINK_VIEW_SQL`: set once, never on
    // a void document), then the summary read again (`DOC_REREAD_SQL`), the frozen lines, the credit notes, the Pay now block, the audit row of the use and
    // the access row (both written only while the link is still live). The answer is served only from the re-read: a void, a revoke or a lost access
    // between `open()` and this batch answers the 404 (the link was valid when checked, so no `p:fail:` count) with one 404 access row.
    const throttle = auditThrottle(doc.id, doc.link_contact_id, t);
    const live = linkLiveGuard(doc.id, doc.link_client_id, hash, t);
    const [, again, lines, credits, online] = await db.batch([
      db.prepare(LINK_VIEW_SQL).bind(doc.link_client_id, doc.id, t, hash),
      db.prepare(DOC_REREAD_SQL).bind(doc.link_client_id, doc.id, hash, t),
      db.prepare(LINES_SQL).bind(doc.link_client_id, doc.id),
      db.prepare(CREDIT_NOTES_SQL).bind(doc.link_client_id, doc.id),
      // M6.2: the Pay now block, bound to the link's client.
      db.prepare(ONLINE_SQL).bind(doc.link_client_id, doc.id, t),
      auditStmt(
        db,
        {
          ...requestInfo(c),
          actorType: "contact",
          actorId: doc.link_contact_id,
          role: null,
          action: "doc_token.use",
          entityType: "document",
          entityId: doc.id,
        },
        {
          sql: (n) => `${throttle.sql(n)} AND ${live.sql(n + throttle.params.length)}`,
          params: [...throttle.params, ...live.params],
        },
      ),
      accessStmt(db, accessEntry(c, 200, doc.link_contact_id), live),
    ]);
    const now = again?.results[0] as SummaryRow | undefined;
    if (!now) {
      await db.batch([accessStmt(db, accessEntry(c, 404, doc.link_contact_id))]);
      return err(c, NOT_FOUND, 404);
    }
    return c.json({
      document: {
        ...summaryOf(now, (lines?.results ?? []) as LineRow[], (credits?.results ?? []) as CreditNoteRow[]),
        ...onlineOf(online?.results[0] as OnlineRow | undefined),
      },
    });
  })
  // M6.2 (POR-06): Pay now from the emailed link. The same open and the same counter as the summary (a bad token counts toward `p:fail:`); the token's HASH
  // goes to the finance Worker, which re-checks it (live, unrevoked, for this document, bound to its live contact) and makes the link with Razorpay's return page
  // `pay/return` (no token in any URL).
  .post("/document/pay", json(payTokenBody), async (c) => {
    const { token, amountMinor, provider: asked } = c.req.valid("json");
    const o = await open(c, token);
    if (o instanceof Response) return o;
    // M6.3: the gateway the document's currency allows (the open read already holds it), unless the request names one.
    const provider = providerOf(o.doc.currency, asked);
    const r = await createLink(c.env, {
      provider,
      clientId: o.doc.link_client_id,
      contactId: null,
      tokenHash: await tokenHash(token),
      documentId: o.doc.id,
      amountMinor,
      returnTo: "pay_return",
    });
    return payAnswer(c, r, provider);
  })
  // The PDF behind the link (the same open and the same counter). The headers are those of the offer PDF: an attachment, never rendered, never cached, never sniffed.
  // Opening it is a view too (FX-5, 08-C RA-10; parity with the signed-in PDF): the first view and the access row in one batch, before the answer.
  .post("/document/pdf", json(docTokenRequest), async (c) => {
    const { token } = c.req.valid("json");
    const o = await open(c, token);
    if (o instanceof Response) return o;
    const { doc } = o;
    const db = c.env.DB;
    // ADM-INV-10 (Q3): a withdrawn proforma's link opens its summary, never its PDF (R2 is not read). A valid link, so no `p:fail:` count; the access row only.
    if (isWithdrawnRow(doc)) {
      c.set("accessDone", true);
      await db.batch([accessStmt(db, accessEntry(c, 409, doc.link_contact_id))]);
      return err(c, PDF_WITHDRAWN, 409);
    }
    c.set("accessDone", true);
    // Review L1: the state is read again in the batch that writes the view, and the access row of a served (or pending) PDF is written only while the
    // document is still open (the same `openSql` as the check below). A withdrawal or a void that landed after `open()` answers as the document now is,
    // without reading R2: 409 `withdrawn` for a withdrawn proforma, else the 404. The link was valid when checked, so neither counts toward `p:fail:`.
    const hash = await tokenHash(token);
    const at = Date.now();
    const [state] = await db.batch([
      db.prepare(PDF_STATE_SQL).bind(doc.link_client_id, doc.id, hash, at),
      db.prepare(LINK_VIEW_PDF_SQL).bind(doc.link_client_id, doc.id, at, hash),
      // The access row of a served PDF, written only while the document is open, its PDF stored and the link live; any other outcome writes its own below.
      accessStmt(db, accessEntry(c, 200, doc.link_contact_id), {
        sql: (n) =>
          `EXISTS (SELECT 1 FROM documents d WHERE d.id = ?${n} AND d.client_id = ?${n + 1} AND ${openSql("d")} AND d.pdf_r2_key IS NOT NULL AND ${linkLiveSql(`?${n + 2}`, `?${n + 3}`)})`,
        params: [doc.id, doc.link_client_id, hash, at],
      }),
    ]);
    const now = state?.results[0] as PdfState | undefined;
    if (!now?.open || now.link_live !== 1) {
      const withdrawn = now?.link_live === 1 && !!now.readable && isWithdrawnRow(now);
      await db.batch([accessStmt(db, accessEntry(c, withdrawn ? 409 : 404, doc.link_contact_id))]);
      return withdrawn ? err(c, PDF_WITHDRAWN, 409) : err(c, NOT_FOUND, 404);
    }
    // Served only from what the state read returned (L13): a PDF that finished after `open()` is served; one that has none yet is 409 `pdf_pending`.
    if (!now.pdf_r2_key) {
      await db.batch([accessStmt(db, accessEntry(c, 409, doc.link_contact_id))]);
      return c.json(
        {
          error: { code: "pdf_pending", message: "The document is still being prepared" },
          request_id: c.var.rid,
        },
        409,
      );
    }
    return streamPdf(c, now.pdf_r2_key, pdfFileName(now.number_display, 1));
  });
