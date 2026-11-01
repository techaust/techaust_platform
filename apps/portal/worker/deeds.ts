// The signed deeds of assignment of the signed-in organisation (T11; run file docs/runs/t11-deed.md, L4, L5; POR-05; 08-C RB-38(a)): the list the portal shows
// under each accepted proposal or estimate, and the signed PDF. Only a SIGNED deed is ever visible: a draft, a final (unsigned) or a cancelled deed is the same
// 404 as one that does not exist. Every query goes through `forClient` with the organisation of the session (`client_id = ?1`); another organisation's deed is
// that 404. The download names the deed in the request body (`POST /deeds/pdf {id}`), never in a path or a query.
// Owner's decision (2026-11-01, review M4): a deed names the invoices and the amount paid (clause 2), so only a contact with portal access AND "can see
// finance" sees it, the same rule as invoices (M5.4): the route rows are `finance` (anyone else gets the plain 404), and every query also holds the rule
// itself (`FINANCE_CONTACT_SQL`, the session's contact bound as `?2`), so a contact whose finance access is taken away stops matching at once.
// Review L2: the list is read for one accepted version (`GET /deeds?document=<id>`), the page it is shown on.
import { DEED_SIGNATURE_LEAD, deedSignatureLine, esignMomentIst } from "@techaust/core/deeds";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type AppEnv, BAD_REQUEST, err, NOT_FOUND } from "./context.ts";
import { streamPdf } from "./offer-core.ts";
import { forClient, scope } from "./scope.ts";
import { json } from "./validate.ts";

/** The session's contact (`?2`) still has portal access and "can see finance" in the deed's organisation (M4, the invoices' rule). */
export const FINANCE_CONTACT_SQL =
  "EXISTS (SELECT 1 FROM contacts fc WHERE fc.id = ?2 AND fc.client_id = d.client_id AND fc.portal_access = 1 AND fc.can_see_finance = 1 AND fc.anonymised_at IS NULL)";

/** The signed deeds of one accepted version (`?3`), newest first: at most 10 (one per project made from that version; served by `deeds_client_source`). */
export const DEEDS_LIST_SQL = `SELECT d.id, d.number_display, d.source_document_id, s.type AS doc_type, s.number_display AS doc_number, s.version, d.esign_at, d.esign_txn,
    d.signed_at, d.signed_size
  FROM deeds d JOIN documents s ON s.id = d.source_document_id AND s.client_id = d.client_id
  WHERE d.client_id = ?1 AND d.source_document_id = ?3 AND d.status = 'signed' AND ${FINANCE_CONTACT_SQL} ORDER BY d.signed_at DESC, d.id DESC LIMIT 10`;

export const DEED_PDF_SQL = `SELECT d.signed_r2_key, d.number_display FROM deeds d WHERE d.client_id = ?1 AND d.id = ?3 AND d.status = 'signed' AND d.signed_r2_key IS NOT NULL AND ${FINANCE_CONTACT_SQL}`;

/** The accepted version a list is read for: an id as the documents carry them (never a token). */
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

type ListRow = {
  id: string;
  number_display: string;
  source_document_id: string;
  doc_type: string;
  doc_number: string | null;
  version: number;
  esign_at: number;
  esign_txn: string;
  signed_at: number;
  signed_size: number;
};

export const deedPdfRequest = z.strictObject({ id: z.string().check(z.minLength(1), z.maxLength(64)) });

export const deeds = new Hono<AppEnv>()
  .get("/", async (c) => {
    const document = c.req.query("document");
    if (document === undefined || !DOCUMENT_ID.test(document)) return err(c, BAD_REQUEST, 400);
    const sc = scope(c);
    const { results } = await forClient(c.env.DB, sc, DEEDS_LIST_SQL, sc.contactId, document).all<ListRow>();
    return c.json({
      deeds: results.map((r) => ({
        id: r.id,
        number: r.number_display,
        /** The accepted proposal or estimate version the deed belongs to: the portal shows it on that page. */
        sourceDocumentId: r.source_document_id,
        offer: { type: r.doc_type, number: r.doc_number, version: r.version },
        /** L5: the eSign details shown next to the signed copy. */
        esignAt: r.esign_at,
        esignMoment: esignMomentIst(r.esign_at),
        esignTxn: r.esign_txn,
        signatureLine: deedSignatureLine(DEED_SIGNATURE_LEAD, r.esign_at, r.esign_txn),
        signedAt: r.signed_at,
        size: r.signed_size,
      })),
    });
  })
  .post("/pdf", json(deedPdfRequest), async (c) => {
    const { id } = c.req.valid("json");
    const sc = scope(c);
    const row = await forClient(c.env.DB, sc, DEED_PDF_SQL, sc.contactId, id).first<{
      signed_r2_key: string;
      number_display: string;
    }>();
    if (!row) return err(c, NOT_FOUND, 404);
    return streamPdf(c, row.signed_r2_key, `${row.number_display.replaceAll("/", "-")}-signed.pdf`);
  });
