// The PDF of a sent proposal or estimate (M4.4; JOB-PDF-01, ADM-PROP-04): staff download it, and may ask for it to be made again.
// The jobs Worker makes it (envelope in R2, then the render); this Worker only READS the bucket (`DOCS`) and enqueues. Streamed through the
// session check: an attachment, never rendered by the browser, never cached, never sniffed. VERIFY WITH CA/LEGAL: the PDF is the
// evidence an acceptance is tied to; its retention is the owner's decision (run file).
import { contentDisposition } from "@techaust/core/file-types";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import { type ApiError, type AppEnv, type Ctx, err, mutate, NOT_FOUND } from "./context.ts";
import { enqueuePdf } from "./document-events.ts";
import { body, idParam, param } from "./http.ts";
import { CLIENT_GONE } from "./quote-model.ts";

export const PDF_PENDING: ApiError = { code: "pdf_pending", message: "The PDF isn't ready yet. Try again in a minute." };
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

const PDF_ROW = `SELECT id, type, status, version, number_display, frozen_at, pdf_r2_key, pdf_sha256, ${clientGoneSql("client_id")} AS gone FROM documents WHERE id = ?1 AND type IN ('proposal', 'estimate')`;

/** `TH-PRP-2627-0003-v2.pdf`: the number with its slashes changed, so a browser keeps the name. */
export const pdfFilename = (numberDisplay: string, version: number): string =>
  `${numberDisplay.replace(/[^A-Za-z0-9-]+/g, "-")}-v${version}.pdf`;

const notSent = (r: PdfRow | null): r is null =>
  r === null || r.frozen_at === null || r.number_display === null;

export const documentPdf = new Hono<AppEnv>()
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
      action: "document.pdf_retry",
      entityType: "document",
      entityId: id,
      summary: { documentId: id, type: row.type, version: row.version, number: row.number_display },
    });
    if (!done) return err(c, NOT_FOUND, 404);
    retryEnqueue(c, id);
    return c.json({ ok: true, pdf: { state: "pending" } });
  });

function retryEnqueue(c: Ctx, documentId: string): void {
  c.executionCtx.waitUntil(enqueuePdf(c.env, documentId, "retry"));
}
