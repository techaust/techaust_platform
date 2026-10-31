// The signed deeds of assignment of the signed-in organisation (T11; run file docs/runs/t11-deed.md, L4, L5; POR-05; 08-C RB-38(a)): the list the portal shows
// under each accepted proposal or estimate, and the signed PDF. Only a SIGNED deed is ever visible: a draft, a final (unsigned) or a cancelled deed is the same
// 404 as one that does not exist. Every query goes through `forClient` with the organisation of the session (`client_id = ?1`); another organisation's deed is
// that 404. The download names the deed in the request body (`POST /deeds/pdf {id}`), never in a path or a query.
import { DEED_SIGNATURE_LEAD, deedSignatureLine, esignMomentIst } from "@techaust/core/deeds";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type AppEnv, err, NOT_FOUND } from "./context.ts";
import { streamPdf } from "./offer-core.ts";
import { forClient, scope } from "./scope.ts";
import { json } from "./validate.ts";

/** At most 50 signed deeds, newest first (an organisation has one per completed project). */
export const DEEDS_LIST_SQL = `SELECT d.id, d.number_display, d.source_document_id, s.type AS doc_type, s.number_display AS doc_number, s.version, d.esign_at, d.esign_txn,
    d.signed_at, d.signed_size
  FROM deeds d JOIN documents s ON s.id = d.source_document_id AND s.client_id = d.client_id
  WHERE d.client_id = ?1 AND d.status = 'signed' ORDER BY d.signed_at DESC, d.id DESC LIMIT 50`;

export const DEED_PDF_SQL =
  "SELECT d.signed_r2_key, d.number_display FROM deeds d WHERE d.client_id = ?1 AND d.id = ?2 AND d.status = 'signed' AND d.signed_r2_key IS NOT NULL";

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
    const { results } = await forClient(c.env.DB, scope(c), DEEDS_LIST_SQL).all<ListRow>();
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
    const row = await forClient(c.env.DB, scope(c), DEED_PDF_SQL, id).first<{
      signed_r2_key: string;
      number_display: string;
    }>();
    if (!row) return err(c, NOT_FOUND, 404);
    return streamPdf(c, row.signed_r2_key, `${row.number_display.replaceAll("/", "-")}-signed.pdf`);
  });
