// The PDF of a sent proposal or estimate (M4.4; JOB-PDF-01, ADM-PROP-04): staff download it, and may ask for it to be made again.
// The jobs Worker makes it (envelope in R2, then the render); this Worker only READS the bucket (`DOCS`) and enqueues. Streamed through the
// session check: an attachment, never rendered by the browser, never cached, never sniffed. Researched 2026-10-28, BSA 2023 s.63(4) (08-C RB-19):
// the PDF is the evidence an acceptance is tied to (its SHA-256, an immutable copy); its retention is the owner's decision (run file).
import { contentDisposition } from "@techaust/core/file-types";
import { fyLabelOfToken, hasSupplierCopy, supplierPdfKey } from "@techaust/core/pdf-jobs";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import { type ApiError, type AppEnv, type Ctx, err, mutate, NOT_FOUND } from "./context.ts";
import { enqueuePdf, enqueueSupplierPdfOnce } from "./document-events.ts";
import { body, idParam, param } from "./http.ts";
import { INVOICE_TYPES_SQL } from "./invoice-model.ts";
import { CLIENT_GONE } from "./quote-model.ts";

export const PDF_PENDING: ApiError = {
  code: "pdf_pending",
  message: "The PDF isn't ready yet. Try again in a minute.",
};
export const PDF_DONE: ApiError = { code: "pdf_done", message: "This document already has its PDF" };

type PdfRow = {
  id: string;
  type: string;
  status: string;
  version: number;
  number_display: string | null;
  frozen_at: number | null;
  pdf_r2_key: string | null;
  pdf_sha256: string | null;
  gone: number;
};

/** The row of the document whose PDF is asked for, for the types of one router (proposals and estimates, or the invoice flow, M5.1). */
const pdfRowSql = (types: string) =>
  `SELECT id, type, status, version, number_display, frozen_at, pdf_r2_key, pdf_sha256, ${clientGoneSql("client_id")} AS gone FROM documents WHERE id = ?1 AND type IN (${types})`;

/** `TH-PRP-2627-0003-v2.pdf`: the number with its slashes changed, so a browser keeps the name. */
export const pdfFilename = (numberDisplay: string, version: number): string =>
  `${numberDisplay.replace(/[^A-Za-z0-9-]+/g, "-")}-v${version}.pdf`;

const notSent = (r: PdfRow | null): r is null =>
  r === null || r.frozen_at === null || r.number_display === null;

/**
 * The two PDF routes for a set of types (M5.1 generalises M4.4's): the same stream, the same headers, the same retry; only the types and the audit
 * action differ. A draft, an unknown id or another type is 404.
 */
function pdfRoutes(types: string, retryAction: string) {
  const PDF_ROW = pdfRowSql(types);
  return (
    new Hono<AppEnv>()
      // The PDF itself. A draft, an unknown id or another type is 404; a sent version whose PDF is not made yet is 409 `pdf_pending`.
      .get("/:id/pdf", param(idParam), async (c) => {
        const { id } = c.req.valid("param");
        const row = await c.env.DB.prepare(PDF_ROW).bind(id).first<PdfRow>();
        if (notSent(row) || !row) return err(c, NOT_FOUND, 404);
        if (row.pdf_sha256 === null || row.pdf_r2_key === null) return err(c, PDF_PENDING, 409);
        const obj = await c.env.DOCS.get(row.pdf_r2_key);
        if (!obj) {
          console.error(JSON.stringify({ level: "error", message: "pdf object missing", rid: c.var.rid }));
          return err(c, PDF_PENDING, 409);
        }
        return new Response(obj.body, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": String(obj.size),
            "Content-Disposition": contentDisposition(pdfFilename(row.number_display as string, row.version)),
            ETag: `"${row.pdf_sha256}"`,
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex",
          },
        });
      })

      // Ask for the PDF again (the render failed, or the dead-letter bell rang). Only a sent version that has no PDF yet; the jobs consumer
      // is idempotent, so a repeated request never makes a second PDF.
      .post("/:id/pdf/retry", param(idParam), body(z.strictObject({})), async (c) => {
        const { id } = c.req.valid("param");
        const row = await c.env.DB.prepare(PDF_ROW).bind(id).first<PdfRow>();
        if (notSent(row) || !row) return err(c, NOT_FOUND, 404);
        if (row.pdf_sha256 !== null) return err(c, PDF_DONE, 409);
        // An erased client takes nothing new (the standing rule): no audit row, no message. The download above is unchanged (owner question).
        if (row.gone === 1) return err(c, CLIENT_GONE, 409);
        const done = await mutate(c, {
          action: retryAction,
          entityType: "document",
          entityId: id,
          summary: { documentId: id, type: row.type, version: row.version, number: row.number_display },
        });
        if (!done) return err(c, NOT_FOUND, 404);
        retryEnqueue(c, id);
        return c.json({ ok: true, pdf: { state: "pending" } });
      })
  );
}

export const documentPdf = pdfRoutes("'proposal', 'estimate'", "document.pdf_retry");

type SupplierRow = {
  type: string;
  number: number | null;
  number_display: string | null;
  fy: string | null;
  frozen_at: number | null;
  pdf_sha256: string | null;
  gone: number;
};

/** `TH-INV-2627-0003-supplier-copy.pdf`: the number with its slashes changed, marked as the stored copy. */
export const supplierFilename = (numberDisplay: string): string =>
  `${numberDisplay.replace(/[^A-Za-z0-9-]+/g, "-")}-supplier-copy.pdf`;

/**
 * The stored DUPLICATE FOR SUPPLIER copy of an issued tax invoice, export invoice, credit note or debit note (Q11, owner 2026-10-28; Rule 48(2) CGST Rules; Researched 2026-10-28, 08-C RA-07):
 * `GET /invoices/:id/pdf/supplier` for the Owner and the Accountant (`invoices.supplierCopy`). It answers like `/:id/pdf`: the file (an attachment, never cached), or 202 `{state: "making"}` while it is
 * being made after the original; 409 `pdf_pending` while the original has no PDF (FX-4, A5 9) and for an erased client, whose copy is never made. A proforma, a draft or an unknown id is 404. It is never attached to an email, never linked from the portal and never offered to a client. The copy is rendered by jobs after
 * the original; a document issued before this existed (or whose message was lost) has none yet: this route then asks for it (an idempotent queue message) once the original's PDF exists.
 */
export const invoiceSupplierPdf = new Hono<AppEnv>().get("/:id/pdf/supplier", param(idParam), async (c) => {
  const { id } = c.req.valid("param");
  const row = await c.env.DB.prepare(
    `SELECT type, number, number_display, fy, frozen_at, pdf_sha256, ${clientGoneSql("client_id")} AS gone FROM documents WHERE id = ?1 AND type IN (${INVOICE_TYPES_SQL})`,
  )
    .bind(id)
    .first<SupplierRow>();
  const label = row?.fy ? fyLabelOfToken(row.fy) : null;
  if (!row || row.frozen_at === null || !hasSupplierCopy(row.type) || !row.number || !label)
    return err(c, NOT_FOUND, 404);
  const obj = await c.env.DOCS.get(
    supplierPdfKey({ type: row.type, fy: label, number: row.number, version: 1 }),
  );
  if (!obj) {
    // Not made yet. An erased client's copy is never made: 409. The copy is rendered after the original, so while the original has no PDF (not rendered yet, or its
    // render failed: the original's own retry is `/:id/pdf/retry`) nothing here can make it: 409 `pdf_pending`, never a 202 answered forever (FX-4, full audit A5 9).
    // Once the original exists the copy is asked for (an idempotent message) and is being made: 202 {state: "making"}, not an error (the screen polls without a
    // console error per click).
    if (row.gone === 1 || row.pdf_sha256 === null) return err(c, PDF_PENDING, 409);
    c.executionCtx.waitUntil(enqueueSupplierPdfOnce(c.env, id));
    return c.json({ state: "making" as const }, 202);
  }
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(obj.size),
      "Content-Disposition": contentDisposition(supplierFilename(row.number_display ?? String(row.number))),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
});

export const invoicePdf = pdfRoutes(INVOICE_TYPES_SQL, "invoice.pdf_retry");

function retryEnqueue(c: Ctx, documentId: string): void {
  c.executionCtx.waitUntil(enqueuePdf(c.env, documentId, "retry"));
}
