// Sending again, revoking links and the certificate download (M4.5; ADM-PROP-07, ADM-PROP-08): wired into the route table and the app (stage B).
//   POST /documents/:id/resend {contactIds, attachPdf?}   proposals.send   new `document_sends` rows (kind 'resend') for the latest sent version
//   POST /documents/:id/links/revoke                      proposals.send   revokes every live offer link of the offer (all its versions)
//   GET  /documents/:id/certificate                       proposals.read   streams the acceptance certificate
// The recipients are the same rule as the first send (`checkRecipients`): 1 to 5 distinct contacts of THIS client with portal access, not
// anonymised. The email follows the PDF: the rows are written "waiting" (queued_at NULL); when the PDF already exists they are queued at
// once (`offer.send`, one message per row), else the jobs Worker's render step queues them (and a sweep is the safety net).
import { contentDisposition } from "@techaust/core/file-types";
import { uuidv7 } from "@techaust/core/ids";
import { todayIst as todayIstText } from "@techaust/core/offers";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { clientGoneSql } from "./anonymised.ts";
import { type ApiError, type AppEnv, actor, err, mutate, NOT_FOUND } from "./context.ts";
import { pdfFilename } from "./document-pdf.ts";
import { body, idParam, param } from "./http.ts";
import { CLIENT_GONE, NOT_A_QUOTE } from "./quote-model.ts";

export const MAX_RECIPIENTS = 5;

/** `TH-PRP-2627-0003-v2-certificate.pdf`. */
const certificateFilename = (numberDisplay: string, version: number): string =>
  pdfFilename(numberDisplay, version).replace(/\.pdf$/, "-certificate.pdf");

const RECIPIENTS_REQUIRED: ApiError = {
  code: "recipients_required",
  message: "Choose at least one contact to send to",
};
const RECIPIENTS_TOO_MANY: ApiError = {
  code: "recipients_too_many",
  message: "Choose at most five contacts",
};
const NOT_RESENDABLE: ApiError = {
  code: "not_resendable",
  message: "Only the latest sent version, still open, can be sent again",
};
const CERTIFICATE_PENDING: ApiError = {
  code: "certificate_pending",
  message: "The certificate is still being made. Try again in a minute.",
};

/** 50 is only a size bound for the schema; the real limit (5) has its own error code. */
export const resendBody = z.strictObject({
  contactIds: z.array(z.string().check(z.minLength(1), z.maxLength(64))).check(z.maxLength(50)),
  attachPdf: z.optional(z.boolean()),
});

/** The contacts of `clientId` among `ids` that may receive an offer (portal access on, not anonymised). Placeholders: ?1 client, ?2 JSON array of ids. */
export const VALID_RECIPIENTS_SQL =
  "SELECT c.id, c.name, lower(c.email) AS email, c.is_billing FROM contacts c WHERE c.client_id = ?1 AND c.portal_access = 1 AND c.anonymised_at IS NULL AND c.id IN (SELECT value FROM json_each(?2))";

/** The same rule for an invoice-family document: the contact must also be allowed to see finance (POR-03; the portal refuses the rest). */
export const VALID_INVOICE_RECIPIENTS_SQL = VALID_RECIPIENTS_SQL.replace(
  "c.portal_access = 1 AND",
  "c.portal_access = 1 AND c.can_see_finance = 1 AND",
);

export type RecipientCheck =
  | { ok: true; ids: string[] }
  | { ok: false; error: ApiError; status: 400 | 409; invalid?: string[] };

/** The shape checks that need no database: 1 to 5, distinct. The database check (`validRecipients`) follows. */
export function checkRecipientIds(ids: readonly string[]): RecipientCheck {
  if (ids.length === 0) return { ok: false, error: RECIPIENTS_REQUIRED, status: 400 };
  if (ids.length > MAX_RECIPIENTS) return { ok: false, error: RECIPIENTS_TOO_MANY, status: 400 };
  const distinct = [...new Set(ids)];
  if (distinct.length !== ids.length)
    return {
      ok: false,
      error: { code: "recipient_invalid", message: "A contact is listed twice" },
      status: 409,
      invalid: ids.filter((id, i) => ids.indexOf(id) !== i),
    };
  return { ok: true, ids: distinct };
}

/** Which of `ids` may NOT receive the offer of `clientId` (another client's, no portal access, anonymised, unknown). */
export async function invalidRecipients(
  db: D1Database,
  clientId: string,
  ids: readonly string[],
  sql: string = VALID_RECIPIENTS_SQL,
): Promise<string[]> {
  const ok = await db.prepare(sql).bind(clientId, JSON.stringify(ids)).all<{ id: string }>();
  const good = new Set(ok.results.map((r) => r.id));
  return ids.filter((id) => !good.has(id));
}

const QUOTES = "('proposal', 'estimate')";

/** The frozen offer (a proposal or an estimate) by id. ?1 document id. Whether it is still open (the newest version, sent or viewed, not past its last valid day) is checked in the send's INSERT. */
const OPEN_LATEST =
  "SELECT d.id, d.client_id, d.version_group_id, d.pdf_sha256, d.type FROM documents d WHERE d.id = ?1 AND d.type IN ('proposal', 'estimate') AND d.frozen_at IS NOT NULL";

const NEWEST =
  "NOT EXISTS (SELECT 1 FROM documents n WHERE n.version_group_id = d.version_group_id AND n.version > d.version AND n.frozen_at IS NOT NULL)";

export const documentLinks = new Hono<AppEnv>()
  .post("/:id/resend", param(idParam), body(resendBody), async (c) => {
    const { id } = c.req.valid("param");
    const form = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const shape = checkRecipientIds(form.contactIds);
    if (!shape.ok)
      return c.json(
        {
          error: { code: shape.error.code, message: shape.error.message },
          request_id: c.var.rid,
          ...(shape.invalid ? { contactIds: shape.invalid } : {}),
        },
        shape.status,
      );
    const [doc, client] = await db.batch([
      db.prepare(OPEN_LATEST).bind(id),
      db
        .prepare(
          "SELECT c.attach_pdf, c.anonymised_at FROM clients c WHERE c.id = (SELECT client_id FROM documents WHERE id = ?1)",
        )
        .bind(id),
    ]);
    const d = doc?.results[0] as
      | { id: string; client_id: string; version_group_id: string; pdf_sha256: string | null; type: string }
      | undefined;
    const cl = client?.results[0] as { attach_pdf: number; anonymised_at: number | null } | undefined;
    if (!d || !cl) return err(c, NOT_FOUND, 404);
    if (cl.anonymised_at !== null) return err(c, CLIENT_GONE, 409);
    const invalid = await invalidRecipients(db, d.client_id, shape.ids);
    if (invalid.length > 0)
      return c.json(
        {
          error: { code: "recipient_invalid", message: "Some contacts can't receive this" },
          contactIds: invalid,
          request_id: c.var.rid,
        },
        409,
      );

    const t = Date.now();
    const today = todayIstText(t);
    const attach = form.attachPdf ?? cl.attach_pdf === 1;
    const rows = shape.ids.map((contactId) => ({ id: uuidv7(), contactId }));
    // One statement writes every row or none: the document is open and the newest, and the count of valid recipients equals the list.
    // T7: an offer whose personal details were erased is withdrawn: never sent again (409 `not_resendable`; Settled by the lead on the safest reading,
    // 2026-10-30 (08-C RB-37)).
    const done = await mutate(c, {
      main: db
        .prepare(
          `INSERT INTO document_sends (id, document_id, version_group_id, client_id, contact_id, email, attach_pdf, kind, queued_at, created_by, created_at)
           SELECT json_extract(j.value, '$.id'), d.id, d.version_group_id, d.client_id, c.id, lower(c.email), ?3, 'resend', NULL, ?4, ?5
           FROM documents d JOIN json_each(?2) j JOIN contacts c ON c.id = json_extract(j.value, '$.contactId') AND c.client_id = d.client_id AND c.portal_access = 1 AND c.anonymised_at IS NULL
           WHERE d.id = ?1 AND d.type IN ${QUOTES} AND d.frozen_at IS NOT NULL AND d.redacted_at IS NULL AND d.status IN ('sent', 'viewed') AND d.valid_until >= ?6 AND ${NEWEST}
           AND NOT ${clientGoneSql("d.client_id")}
           AND (SELECT count(*) FROM contacts c2 WHERE c2.client_id = d.client_id AND c2.portal_access = 1 AND c2.anonymised_at IS NULL AND c2.id IN (SELECT json_extract(value, '$.contactId') FROM json_each(?2))) = json_array_length(?2)`,
        )
        .bind(id, JSON.stringify(rows), attach ? 1 : 0, u.id, t, today),
      action: "document.resend",
      entityType: "document",
      entityId: id,
      summary: { documentId: id, recipients: rows.length, attachPdf: attach },
    });
    if (!done) return err(c, NOT_RESENDABLE, 409);
    // The PDF already exists: queue the emails now (one message per row). Otherwise the render step does it.
    if (d.pdf_sha256 !== null) {
      c.executionCtx.waitUntil(
        (async () => {
          try {
            await c.env.EMAIL_QUEUE.sendBatch(
              rows.map((r) => ({ body: { kind: "offer.send", sendId: r.id } })),
            );
          } catch {
            console.error(
              JSON.stringify({
                level: "error",
                route: c.var.route?.path ?? "other",
                message: "offer sends not queued",
                rid: c.var.rid,
              }),
            );
          }
        })(),
      );
    }
    return c.json({ ok: true, sends: rows.length, waitingForPdf: d.pdf_sha256 === null });
  })

  .post("/:id/links/revoke", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const t = Date.now();
    const head = await db
      .prepare(
        "SELECT d.version_group_id FROM documents d WHERE d.id = ?1 AND d.type IN ('proposal', 'estimate') AND d.frozen_at IS NOT NULL",
      )
      .bind(id)
      .first<{ version_group_id: string }>();
    if (!head) return err(c, id ? NOT_FOUND : NOT_A_QUOTE, 404);
    let revoked = 0;
    let cancelled = 0;
    // Order matters: first stop the sends that have no link yet (waiting for the PDF, or queued and not yet processed: the jobs Worker
    // mints a link only while `cancelled_at` is NULL), then revoke every link that exists. One batch, so a link minted a moment before is
    // revoked here and one minted after finds the send cancelled, or (a send that already had a link: a retry after the email queue failed, or a
    // redelivery) finds that send's own link revoked, so the jobs Worker mints nothing and marks it not sent. The audit row is written for every
    // revoke (nothing may be left to revoke).
    await mutate(c, {
      side: (g) => [
        db
          .prepare(
            `UPDATE document_sends SET cancelled_at = ?2 WHERE cancelled_at IS NULL AND document_id IN (SELECT id FROM documents WHERE version_group_id = ?1) AND NOT EXISTS (SELECT 1 FROM offer_links l WHERE l.send_id = document_sends.id) AND ${g.sql(3)}`,
          )
          .bind(head.version_group_id, t, ...g.params),
        db
          .prepare(
            `UPDATE offer_links SET revoked_at = ?2 WHERE version_group_id = ?1 AND revoked_at IS NULL AND ${g.sql(3)}`,
          )
          .bind(head.version_group_id, t, ...g.params),
      ],
      action: "document.links_revoke",
      entityType: "document",
      entityId: id,
      summary: { documentId: id },
      onResults: (results, auditAt) => {
        cancelled = results[auditAt + 1]?.meta.changes ?? 0;
        revoked = results[auditAt + 2]?.meta.changes ?? 0;
      },
    });
    return c.json({ ok: true, revoked, cancelled });
  })

  .get("/:id/certificate", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const [cert, acc] = await db.batch([
      db
        .prepare(
          "SELECT ce.r2_key, d.number_display, d.version FROM acceptance_certificates ce JOIN acceptances a ON a.id = ce.acceptance_id JOIN documents d ON d.id = a.document_id WHERE a.document_id = ?1",
        )
        .bind(id),
      db.prepare("SELECT 1 AS yes FROM acceptances WHERE document_id = ?1").bind(id),
    ]);
    const row = cert?.results[0] as
      | { r2_key: string; number_display: string | null; version: number }
      | undefined;
    if (!row) return acc?.results[0] ? err(c, CERTIFICATE_PENDING, 409) : err(c, NOT_FOUND, 404);
    const object = await c.env.DOCS.get(row.r2_key);
    if (!object) return err(c, NOT_FOUND, 404);
    // The same download rules as the proposal's own PDF (document-pdf.ts): an attachment, never rendered, never cached, never sniffed.
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(object.size),
        "Content-Disposition": contentDisposition(
          certificateFilename(row.number_display ?? "document", row.version),
        ),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  });
