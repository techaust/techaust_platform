// The PDF of a client's statement of account (M5.5b, LD79, LD85; JOB-PDF-01, ADM-CLI-04; Q19, Q57, Q59): a request makes one `statement_pdfs` row (a cache, not a record) and puts
// ONE `pdf.statement` message on `PDF_QUEUE`; the jobs Worker makes the PDF and stores it write-once in the private R2 bucket `DOCS`. This Worker only enqueues and streams the
// finished object back (never cached, never sniffed). At most 200 lines (a longer range is refused: shorten it, or use the CSV); never for an anonymised client. The request
// AWAITS the queue send, so a failure is told to the person (503, the row marked failed) instead of waiting for a PDF that will never come. Self-contained (LD85).
import { contentDisposition } from "@techaust/core/file-types";
import { uuidv7 } from "@techaust/core/ids";
import { STATEMENT_PDF_MAX_ENTRIES } from "@techaust/core/statement";
import { STATEMENT_COUNT_SQL, statementTotalsBinds } from "@techaust/db/reports";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type ApiError, type AppEnv, actor, err, mutate, NOT_FOUND } from "./context.ts";
import { body, isoDate, param } from "./http.ts";
import { PERIOD_INVALID } from "./statements.ts";

const ANONYMISED: ApiError = {
  code: "client_anonymised",
  message: "This client's personal details were removed, so no statement can be made",
};
const TOO_LONG: ApiError = {
  code: "statement_too_long",
  message: `A statement PDF holds at most ${STATEMENT_PDF_MAX_ENTRIES} lines. Choose a shorter range`,
};
const EMPTY: ApiError = { code: "statement_empty", message: "There is nothing to list in this range" };
const FAILED: ApiError = {
  code: "statement_failed",
  message: "The statement could not be made. Make it again, and tell the owner if it keeps happening",
};
const UNAVAILABLE: ApiError = {
  code: "queue_unavailable",
  message: "The PDF could not be started. Try again in a minute",
};

const request = z.strictObject({
  from: isoDate,
  to: isoDate,
  currency: z.optional(z.enum(["INR", "USD"])),
});
const pdfParam = z.object({
  id: z.string().check(z.minLength(1), z.maxLength(64)),
  sid: z.string().check(z.minLength(1), z.maxLength(64)),
});

/** The company block a statement prints (no bank, no sender), read from Settings as JSON at the time of the request. */
function companyOf(value: string | undefined) {
  let c: Record<string, unknown> = {};
  try {
    const parsed = value === undefined ? null : JSON.parse(value);
    if (parsed && typeof parsed === "object") c = parsed as Record<string, unknown>;
  } catch {
    // an unreadable row gives an empty block: the request is refused below
  }
  const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  const tradeName = str(c.tradeName);
  const stateCode = str(c.stateCode);
  const logo = str(c.logoLight);
  if (tradeName === null || stateCode === null || logo === null) return null;
  const email = str(c.documentsEmail);
  return {
    tradeName,
    legalName: str(c.legalName),
    address: str(c.address),
    gstin: str(c.gstin),
    stateCode,
    logo,
    ...(email ? { email } : {}),
  };
}

type PdfRow = {
  id: string;
  client_id: string;
  from_date: string;
  to_date: string;
  pdf_r2_key: string | null;
  pdf_sha256: string | null;
  failed_at: number | null;
  code: string;
  anonymised_at: number | null;
};

/** A request identical to a still-pending one from this recent returns that row instead of queueing a second job (L6). */
const DEDUPE_MS = 5 * 60_000;

export const statementPdf = new Hono<AppEnv>()
  // Ask for the PDF of one range and currency. 202 with the row's id; poll the GET below.
  .post(
    "/:id/statement/pdf",
    param(z.object({ id: z.string().check(z.minLength(1), z.maxLength(64)) })),
    body(request),
    async (c) => {
      const { id } = c.req.valid("param");
      const q = c.req.valid("json");
      if (q.to < q.from) return err(c, PERIOD_INVALID, 400);
      const db = c.env.DB;
      const [clientRes, settingsRes] = await db.batch([
        db.prepare("SELECT currency, anonymised_at FROM clients WHERE id = ?1").bind(id),
        db.prepare("SELECT value FROM settings WHERE key = 'company'"),
      ]);
      const client = clientRes?.results[0] as { currency: string; anonymised_at: number | null } | undefined;
      if (!client) return err(c, NOT_FOUND, 404);
      if (client.anonymised_at !== null) return err(c, ANONYMISED, 409);
      const currency = q.currency ?? client.currency;
      const company = companyOf((settingsRes?.results[0] as { value: string } | undefined)?.value);
      if (company === null) return err(c, FAILED, 409);
      const count = await db
        .prepare(STATEMENT_COUNT_SQL)
        .bind(...statementTotalsBinds(id, currency, q.from, q.to))
        .first<{ n: number }>();
      const n = count?.n ?? 0;
      if (n === 0) return err(c, EMPTY, 409);
      if (n > STATEMENT_PDF_MAX_ENTRIES) return err(c, TOO_LONG, 409);
      // L6: the same client, currency and range asked again while the first is still being made: the same row, no second job
      const pending = await db
        .prepare(
          `SELECT id FROM statement_pdfs WHERE client_id = ?1 AND currency = ?2 AND from_date = ?3 AND to_date = ?4
             AND pdf_r2_key IS NULL AND failed_at IS NULL AND created_at >= ?5 ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .bind(id, currency, q.from, q.to, Date.now() - DEDUPE_MS)
        .first<{ id: string }>();
      if (pending) return c.json({ id: pending.id }, 202);
      const statementId = uuidv7();
      const done = await mutate(c, {
        // the row is written only while the client is still not anonymised; the audit row follows the INSERT's change
        main: db
          .prepare(
            `INSERT INTO statement_pdfs (id, client_id, currency, from_date, to_date, issuer, requested_by)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE NOT EXISTS (SELECT 1 FROM clients z WHERE z.id = ?2 AND z.anonymised_at IS NOT NULL)`,
          )
          .bind(statementId, id, currency, q.from, q.to, JSON.stringify({ company }), actor(c).id),
        action: "client.statement_pdf",
        entityType: "client",
        entityId: id,
        summary: { statementId, from: q.from, to: q.to, currency, entries: n },
        status: 202,
      });
      if (!done) return err(c, ANONYMISED, 409);
      try {
        await c.env.PDF_QUEUE.send({ v: 1, kind: "pdf.statement", statementId, hop: 0 });
      } catch {
        await db
          .prepare("UPDATE statement_pdfs SET failed_at = ?1, fail_code = 'queue' WHERE id = ?2")
          .bind(Date.now(), statementId)
          .run();
        return err(c, UNAVAILABLE, 503);
      }
      return c.json({ id: statementId }, 202);
    },
  )

  // The PDF: pending 202, failed 409 `statement_failed`, ready streamed. A row of another client is a 404.
  .get("/:id/statement/pdf/:sid", param(pdfParam), async (c) => {
    const { id, sid } = c.req.valid("param");
    const row = await c.env.DB.prepare(
      `SELECT s.id, s.client_id, s.from_date, s.to_date, s.pdf_r2_key, s.pdf_sha256, s.failed_at, c.code, c.anonymised_at
       FROM statement_pdfs s JOIN clients c ON c.id = s.client_id WHERE s.id = ?1 AND s.client_id = ?2`,
    )
      .bind(sid, id)
      .first<PdfRow>();
    if (!row) return err(c, NOT_FOUND, 404);
    // An anonymised client's statement is never served, even before the purge has deleted the object (M2; DPDP, Researched 2026-10-28, DPDP Act s.8(7) and s.12(3) (08-C RB-11))
    if (row.anonymised_at !== null) return err(c, ANONYMISED, 409);
    if (row.failed_at !== null) return err(c, FAILED, 409);
    if (row.pdf_r2_key === null || row.pdf_sha256 === null) return c.json({ status: "pending" }, 202);
    const obj = await c.env.DOCS.get(row.pdf_r2_key);
    // A key that is set but whose object is gone will not come back: it is a failure, not "still pending" (M2)
    if (!obj) return err(c, FAILED, 409);
    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(obj.size),
        "Content-Disposition": contentDisposition(
          `statement-${row.code}-${row.from_date}-to-${row.to_date}.pdf`,
        ),
        ETag: `"${row.pdf_sha256}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  });
