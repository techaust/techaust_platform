// Sending an issued invoice, proforma, credit note or debit note, revoking its links and pausing its reminders (M5.4; ADM-INV-15, ADM-INV-13, POR-06, LD55, LD56, LD60, LD15;
// Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28) for which documents are chased). Routes (each a `ROUTES` row; every change one batch through `mutate`):
//   POST /invoices/:id/send              invoices.send   {contactIds 1 to 5, attachPdf?}  the `document_sends` rows (kind send, or resend when the invoice was sent before) and, on the first send, the reminders
//   POST /invoices/:id/links/revoke      invoices.send   cancels the sends still waiting, revokes every live link, pauses the reminders (LD60)
//   POST /invoices/:id/reminders/pause   invoices.send   the waiting reminders go to `paused`
//   POST /invoices/:id/reminders/resume  invoices.send   the paused reminders that are still in the future go back to waiting
// The recipients are the rule of M4.5 (`checkRecipientIds`, `invalidRecipients`): 1 to 5 distinct contacts of THIS client with portal access, not anonymised. The email follows
// the PDF: the rows are written "waiting" (`queued_at` NULL); when the PDF already exists they are queued at once as `invoice.send` (never `offer.send`: the M4.5 consumer
// would cancel an invoice send, LD56), else the jobs Worker's render step queues them and the sweep is the safety net. A reminder row is only ever made by a FIRST send.
import { istDate, toIsoDate } from "@techaust/core/dates";
import { uuidv7 } from "@techaust/core/ids";
import { isReminderType, reminderPolicy, reminderRows } from "@techaust/core/invoices";
import { resolveSetting } from "@techaust/core/settings";
import { invoiceSendStatements } from "@techaust/db/issue";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { type ApiError, type AppEnv, actor, type Ctx, err, mutate, NOT_FOUND } from "./context.ts";
import { checkRecipientIds, invalidRecipients, VALID_INVOICE_RECIPIENTS_SQL } from "./document-links.ts";
import { body, idParam, param } from "./http.ts";
import { INVOICE_TYPES_SQL, INVOICE_VOID } from "./invoice-model.ts";
import { CLIENT_GONE } from "./quote-model.ts";

export const NOT_ISSUED: ApiError = { code: "not_issued", message: "Only an issued invoice can be sent" };
export const REMINDERS_NOT_STARTED: ApiError = {
  code: "reminders_not_started",
  message: "No reminders have been set up for this invoice yet. They start when it is first sent",
};
const RECIPIENT_INVALID: ApiError = {
  code: "recipient_invalid",
  message: "Some contacts can't receive this",
};
const SEND_REFUSED: ApiError = {
  code: "send_refused",
  message: "Nothing was sent. Reload and try again",
};

/** `contactIds`: who receives it (the size bound only; the count has its own error codes). `attachPdf` defaults to the client's setting. There is no free-text message. */
export const sendBody = z.strictObject({
  contactIds: z.array(z.string().check(z.minLength(1), z.maxLength(64))).check(z.maxLength(50)),
  attachPdf: z.optional(z.boolean()),
});

/** What the send, the revoke and the reminder routes read about the document, its client and its history, in one batch. `?1` document id, `?2` now (a paused row whose day has passed is not "paused" any more: it can never be resumed, review M2). */
const DOC_READ = `SELECT d.id, d.type, d.status, d.client_id, d.frozen_at, d.due_date, d.pdf_sha256, d.balance_minor, d.currency,
    cl.attach_pdf, cl.anonymised_at, cl.reminder_policy,
    (SELECT count(*) FROM document_sends s WHERE s.document_id = d.id) AS sends,
    (SELECT count(*) FROM reminders r WHERE r.document_id = d.id) AS reminders,
    (SELECT count(*) FROM reminders r WHERE r.document_id = d.id AND r.sent_at IS NULL AND r.skipped_reason IS NULL) AS reminders_waiting,
    (SELECT count(*) FROM reminders r WHERE r.document_id = d.id AND r.sent_at IS NULL AND r.skipped_reason = 'paused' AND r.due_at > ?2) AS reminders_paused
  FROM documents d JOIN clients cl ON cl.id = d.client_id WHERE d.id = ?1 AND d.type IN (${INVOICE_TYPES_SQL})`;
/**
 * "Revoke links", step 1: cancels the document's sends that have no link yet. `?1` document id, `?2` now, then the guard's own parameters (`guard` is `g.sql(3)`).
 * The subquery names the document as well as the send, so it reads `doc_access_tokens_document` (there is no index on `send_id`).
 */
export const cancelUnlinkedSendsSql = (guard: string) =>
  `UPDATE document_sends SET cancelled_at = ?2 WHERE cancelled_at IS NULL AND document_id = ?1 AND NOT EXISTS (SELECT 1 FROM doc_access_tokens t WHERE t.document_id = ?1 AND t.send_id = document_sends.id) AND ${guard}`;

const PAYMENT_TERMS_READ = "SELECT value FROM settings WHERE key = 'payment_terms'";

type DocRow = {
  id: string;
  type: string;
  status: string;
  client_id: string;
  frozen_at: number | null;
  due_date: string | null;
  pdf_sha256: string | null;
  balance_minor: number;
  currency: string;
  attach_pdf: number;
  anonymised_at: number | null;
  reminder_policy: string | null;
  sends: number;
  reminders: number;
  reminders_waiting: number;
  reminders_paused: number;
};

function recipientRefusal(c: Ctx, e: ApiError, status: 400 | 409, contactIds?: readonly string[]) {
  return c.json(
    {
      error: { code: e.code, message: e.message },
      request_id: c.var.rid,
      ...(contactIds && contactIds.length > 0 ? { contactIds } : {}),
    },
    status,
  );
}

/** Queues one `invoice.send` per row, after the answer. A queue that fails is logged (ids only) and never fails the request: the sweep picks the waiting rows up. */
export function queueInvoiceSends(c: Ctx, sendIds: readonly string[]): void {
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await c.env.EMAIL_QUEUE.sendBatch(
          sendIds.map((sendId) => ({ body: { kind: "invoice.send", sendId } })),
        );
      } catch (e) {
        console.error(
          JSON.stringify({
            level: "error",
            route: c.var.route?.path ?? "other",
            message: "invoice sends not queued",
            cause: e instanceof Error ? e.name : "unknown",
            rid: c.var.rid,
          }),
        );
      }
    })(),
  );
}

async function readDoc(c: Ctx, id: string): Promise<{ doc: DocRow; terms: string | null } | null> {
  const [docR, termsR] = await c.env.DB.batch([
    c.env.DB.prepare(DOC_READ).bind(id, Date.now()),
    c.env.DB.prepare(PAYMENT_TERMS_READ),
  ]);
  const doc = docR?.results[0] as DocRow | undefined;
  if (!doc) return null;
  return { doc, terms: (termsR?.results[0] as { value: string } | undefined)?.value ?? null };
}

export const invoiceSend = new Hono<AppEnv>()
  .post("/:id/send", param(idParam), body(sendBody), async (c) => {
    const { id } = c.req.valid("param");
    const form = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    // The shape of the recipient list needs no database: refuse it before anything is read.
    const shape = checkRecipientIds(form.contactIds);
    if (!shape.ok) return recipientRefusal(c, shape.error, shape.status, shape.invalid);
    const read = await readDoc(c, id);
    if (!read) return err(c, NOT_FOUND, 404);
    const d = read.doc;
    if (d.frozen_at === null || d.status === "draft") return err(c, NOT_ISSUED, 409);
    if (d.status === "void") return err(c, INVOICE_VOID, 409);
    if (d.anonymised_at !== null) return err(c, CLIENT_GONE, 409);
    const invalid = await invalidRecipients(db, d.client_id, shape.ids, VALID_INVOICE_RECIPIENTS_SQL);
    if (invalid.length > 0) return recipientRefusal(c, RECIPIENT_INVALID, 409, invalid);

    const now = Date.now();
    const first = d.sends === 0;
    const kind = first ? "send" : "resend";
    // The reminders belong to the first send only: one per future offset day, at the window's opening hour, under the client's own policy (off, or its own offsets).
    const terms = resolveSetting("payment_terms", read.terms ? JSON.parse(read.terms) : undefined);
    const policy = reminderPolicy(terms, d.reminder_policy ? JSON.parse(d.reminder_policy) : null);
    const rows =
      first && policy.enabled && isReminderType(d.type) && d.due_date !== null
        ? reminderRows(d.due_date, policy.offsets, policy.window.fromHour, toIsoDate(istDate(now)))
        : [];
    const sendRows = shape.ids.map((contactId) => ({ id: uuidv7(), contactId }));
    const statements = invoiceSendStatements(db, {
      documentId: id,
      rows: sendRows,
      attachPdf: form.attachPdf ?? null,
      createdBy: u.id,
      kind,
      now,
      frozenAt: null,
      reminders: rows.map((r) => ({ id: uuidv7(), offset: r.offset, dueAt: r.dueAt })),
    });
    const sends = statements[0] as D1PreparedStatement;
    const reminders = statements[1];
    // The sends statement decides (the audit row follows it with `changes() > 0`); the reminders are guarded on the first send row existing, so a refusal leaves nothing.
    const done = await mutate(c, {
      main: sends,
      action: "invoice.send",
      entityType: "document",
      entityId: id,
      summary: {
        documentId: id,
        type: d.type,
        kind,
        recipients: sendRows.length,
        attachPdf: form.attachPdf ?? d.attach_pdf === 1,
        reminders: rows.length,
      },
      side: () => (reminders ? [reminders] : []),
    });
    if (!done) {
      // The statement wrote nothing: say why, in the order a person can act on it (a recipient lost access, the invoice went void or the client was anonymised in between).
      const again = await invalidRecipients(db, d.client_id, shape.ids, VALID_INVOICE_RECIPIENTS_SQL);
      if (again.length > 0) return recipientRefusal(c, RECIPIENT_INVALID, 409, again);
      const now2 = await readDoc(c, id);
      if (!now2) return err(c, NOT_FOUND, 404);
      if (now2.doc.status === "void") return err(c, INVOICE_VOID, 409);
      if (now2.doc.anonymised_at !== null) return err(c, CLIENT_GONE, 409);
      return err(c, SEND_REFUSED, 409);
    }
    // The PDF already exists: queue the emails now (one message per row). Otherwise the render step does it.
    if (d.pdf_sha256 !== null)
      queueInvoiceSends(
        c,
        sendRows.map((r) => r.id),
      );
    return c.json({
      ok: true,
      kind,
      sends: sendRows.length,
      reminders: rows.length,
      waitingForPdf: d.pdf_sha256 === null,
      // Early check finding 5: links were revoked (or the reminders paused) and this send came after, so no reminder will go out until the staff resume them: the dialog offers "Resume reminders". Never resumed here.
      remindersPaused: d.reminders_paused > 0 && d.reminders_waiting === 0,
    });
  })

  .post("/:id/links/revoke", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const read = await readDoc(c, id);
    if (!read) return err(c, NOT_FOUND, 404);
    if (read.doc.frozen_at === null) return err(c, NOT_ISSUED, 409);
    const t = Date.now();
    let cancelled = 0;
    let revoked = 0;
    let paused = 0;
    // Order matters (as for an offer): first stop the sends that have no link yet (waiting for the PDF, or queued and not yet processed: the jobs Worker mints a link only
    // while `cancelled_at` is NULL), then revoke every link that exists, then pause the reminders (a new link is only ever minted for a reminder that is sent). One batch.
    // A send that already has a link is not cancelled here: the jobs Worker mints no new link for a send whose own link was revoked (a retry after the email queue failed,
    // or a redelivery), and marks it not sent; a reminder claimed before this batch is paused when its claim is given back.
    await mutate(c, {
      side: (g) => [
        db.prepare(cancelUnlinkedSendsSql(g.sql(3))).bind(id, t, ...g.params),
        db
          .prepare(
            `UPDATE doc_access_tokens SET revoked_at = ?2 WHERE document_id = ?1 AND revoked_at IS NULL AND ${g.sql(3)}`,
          )
          .bind(id, t, ...g.params),
        db
          .prepare(
            `UPDATE reminders SET skipped_reason = 'paused' WHERE document_id = ?1 AND sent_at IS NULL AND skipped_reason IS NULL AND ${g.sql(2)}`,
          )
          .bind(id, ...g.params),
      ],
      action: "invoice.links_revoke",
      entityType: "document",
      entityId: id,
      summary: { documentId: id },
      onResults: (results, auditAt) => {
        cancelled = results[auditAt + 1]?.meta.changes ?? 0;
        revoked = results[auditAt + 2]?.meta.changes ?? 0;
        paused = results[auditAt + 3]?.meta.changes ?? 0;
      },
    });
    return c.json({ ok: true, revoked, cancelled, paused });
  })

  .post("/:id/reminders/pause", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const read = await readDoc(c, id);
    if (!read) return err(c, NOT_FOUND, 404);
    if (read.doc.reminders === 0) return err(c, REMINDERS_NOT_STARTED, 409);
    let paused = 0;
    await mutate(c, {
      side: (g) => [
        c.env.DB.prepare(
          `UPDATE reminders SET skipped_reason = 'paused' WHERE document_id = ?1 AND sent_at IS NULL AND skipped_reason IS NULL AND ${g.sql(2)}`,
        ).bind(id, ...g.params),
      ],
      action: "invoice.reminders_pause",
      entityType: "document",
      entityId: id,
      summary: { documentId: id },
      onResults: (results, auditAt) => {
        paused = results[auditAt + 1]?.meta.changes ?? 0;
      },
    });
    return c.json({ ok: true, paused });
  })

  .post("/:id/reminders/resume", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const read = await readDoc(c, id);
    if (!read) return err(c, NOT_FOUND, 404);
    if (read.doc.reminders === 0) return err(c, REMINDERS_NOT_STARTED, 409);
    const t = Date.now();
    let resumed = 0;
    // Only the rows still in the future come back: one whose day passed while paused is never sent late (LD60).
    await mutate(c, {
      side: (g) => [
        c.env.DB.prepare(
          `UPDATE reminders SET skipped_reason = NULL WHERE document_id = ?1 AND skipped_reason = 'paused' AND sent_at IS NULL AND due_at > ?2 AND ${g.sql(3)}`,
        ).bind(id, t, ...g.params),
      ],
      action: "invoice.reminders_resume",
      entityType: "document",
      entityId: id,
      summary: { documentId: id },
      onResults: (results, auditAt) => {
        resumed = results[auditAt + 1]?.meta.changes ?? 0;
      },
    });
    return c.json({ ok: true, resumed });
  });

// ---- what the invoice view shows about sends, links and reminders (read in the view's own batch) --------------------------------------------------------------

/** The sends of a document, newest first, with the recipient's name and the last email status. `?1` document id. */
export const SENDS_OF_SQL = `SELECT s.id, s.contact_id, (SELECT k.name FROM contacts k WHERE k.id = s.contact_id) AS contact_name, s.email, s.kind, s.created_at, s.queued_at, s.cancelled_at,
    CASE WHEN s.kind = 'auto' THEN NULL ELSE (SELECT u.name FROM staff_users u WHERE u.id = s.created_by) END AS sent_by_name,
    (SELECT e.status FROM email_log e WHERE e.entity_type = 'document_send' AND e.entity_id = s.id ORDER BY e.created_at DESC LIMIT 1) AS email_status
  FROM document_sends s WHERE s.document_id = ?1 ORDER BY s.created_at DESC, s.id DESC LIMIT 50`;
/** How many links of the document are live now: not revoked, not expired. `?1` document id, `?2` now. */
export const LIVE_LINKS_SQL =
  "SELECT count(*) AS live FROM doc_access_tokens WHERE document_id = ?1 AND revoked_at IS NULL AND expires_at > ?2";
/** The reminders of a document in offset order. `?1` document id. */
export const REMINDERS_OF_SQL =
  "SELECT offset_days, due_at, sent_at, skipped_reason FROM reminders WHERE document_id = ?1 ORDER BY offset_days LIMIT 20";

export type SendRow = {
  id: string;
  contact_id: string | null;
  contact_name: string | null;
  email: string | null;
  kind: string;
  created_at: number;
  queued_at: number | null;
  cancelled_at: number | null;
  email_status: string | null;
  /** The staff member who sent it (null for an automatic send, whose recorded author is the Owner who turned the switch on). */
  sent_by_name: string | null;
};
export type ReminderRow = {
  offset_days: number;
  due_at: number;
  sent_at: number | null;
  skipped_reason: string | null;
};

/** The sends part of the invoice JSON. */
export function sendsView(
  rows: readonly SendRow[],
  live: number,
  reminderRows_: readonly ReminderRow[],
  now: number,
  window: { fromHour: number; toHour: number },
) {
  // A paused row whose day passed is never sent late (LD60) and never comes back: it is shown as missed, and it does not keep the "paused" banner (review M2).
  const missed = (r: ReminderRow) => r.skipped_reason === "paused" && r.due_at <= now;
  const hhmm = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return {
    sends: rows.map((r) => ({
      id: r.id,
      contactName: r.contact_name,
      email: r.email,
      kind: r.kind,
      createdAt: r.created_at,
      queuedAt: r.queued_at,
      cancelledAt: r.cancelled_at,
      emailStatus: r.email_status,
      sentByName: r.sent_by_name,
    })),
    links: { live },
    reminders: {
      started: reminderRows_.length > 0,
      paused: reminderRows_.some((r) => r.skipped_reason === "paused" && r.due_at > now),
      window: { from: hhmm(window.fromHour), to: hhmm(window.toHour) },
      rows: reminderRows_.map((r) => ({
        offset: r.offset_days,
        dueAt: r.due_at,
        sentAt: r.sent_at,
        skippedReason: missed(r) ? "missed_while_paused" : r.skipped_reason,
      })),
    },
  };
}

/** `actions.send`: whether this member may send this document now, and why not (codes; the words are the designer's). */
export function sendAction(a: {
  role: string;
  frozen: boolean;
  status: string;
  clientGone: boolean;
  allowedRole: boolean;
}): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!a.allowedRole) reasons.push("forbidden");
  if (!a.frozen || a.status === "draft") reasons.push("not_issued");
  else if (a.status === "void") reasons.push("invoice_void");
  if (a.clientGone) reasons.push("client_anonymised");
  return { allowed: reasons.length === 0, reasons };
}
