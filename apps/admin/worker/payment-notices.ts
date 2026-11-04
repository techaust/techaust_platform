// "I've paid" notices in the admin (M7.1; ADM-PAY-05, POR-06; run file C, L10, L23), in the finance Worker:
//   GET  /payments/notices                  the Notices tab: a keyset page of 50 by status (oldest first, `payment_notices_status`), or one client's
//                                           (`payment_notices_client`), and the open count for the navigation (`payments.read`);
//   POST /payments/notices/:id/close        a dismiss with an optional note (`payments.notices`; audit `payment.notice_close`). A notice is RECORDED only
//                                           through `POST /payments` with `noticeId` (payments.ts: the recording batch moves it, L23).
// A notice is what the client says it paid, never a payment and never money (L10): nothing here touches the ledger. It never blocks a void or a withdraw
// either: the invoice's Payments panel lists the open ones, which the void and withdraw dialogs show as a warning only (`GET /invoices/:id/payments`).
// Staff lines (lead's delegation, run file H): S1 (the tab and the close), S4 (the warning), S6 (the close dialog's "no personal data" hint, the designer's).

import { ANONYMISED_CLIENT } from "@techaust/core/clients";
import { noticeCloseBody, noticeCloseNoteOf } from "@techaust/core/portal-schemas";
import { Hono } from "hono/tiny";
import { type AppEnv, actor, BAD_REQUEST, err, mutate, NOT_FOUND } from "./context.ts";
import { body, idParam, param } from "./http.ts";

const PAGE = 50;
const AFTER = /^\d{1,15}:[A-Za-z0-9_-]{1,64}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const STATUSES = ["open", "recorded", "dismissed"] as const;

const COLS = `n.id, n.client_id, k.code AS client_code, k.display_name AS client_name, (k.anonymised_at IS NOT NULL) AS client_gone, n.document_id,
  d.type AS document_type, d.number_display, n.contact_id, c.name AS contact_name, n.via, n.amount_minor, n.currency, n.paid_on, n.reference, n.reference_norm,
  n.note, n.status, n.payment_id, n.closed_by, (SELECT name FROM staff_users WHERE id = n.closed_by) AS closed_by_name, n.closed_at, n.close_note, n.created_at`;
const FROM =
  "JOIN clients k ON k.id = n.client_id JOIN documents d ON d.id = n.document_id LEFT JOIN contacts c ON c.id = n.contact_id";

/** ?1 status, ?2 and ?3 the cursor (created_at, id; -1 and "" on the first page). Oldest first. */
export const NOTICES_BY_STATUS_SQL = `SELECT ${COLS} FROM payment_notices n INDEXED BY payment_notices_status ${FROM}
   WHERE n.status = ?1 AND (n.created_at, n.id) > (?2, ?3) ORDER BY n.created_at, n.id LIMIT ${PAGE + 1}`;
/** ?1 client, ?2 status, ?3 and ?4 the cursor. Oldest first. */
export const NOTICES_BY_CLIENT_SQL = `SELECT ${COLS} FROM payment_notices n INDEXED BY payment_notices_client ${FROM}
   WHERE n.client_id = ?1 AND n.status = ?2 AND (n.created_at, n.id) > (?3, ?4) ORDER BY n.created_at, n.id LIMIT ${PAGE + 1}`;
export const OPEN_NOTICES_COUNT_SQL =
  "SELECT count(*) AS n FROM payment_notices INDEXED BY payment_notices_status WHERE status = 'open'";
/** ?1 notice, ?2 who, ?3 now, ?4 note: a dismiss, only while open (the trigger also freezes it after). */
export const NOTICE_DISMISS_SQL = `UPDATE payment_notices SET status = 'dismissed', closed_by = ?2, closed_at = ?3, close_note = ?4
   WHERE id = ?1 AND status = 'open'`;

export const NOTICE_CLOSED = { code: "notice_closed", message: "This notice is already closed" } as const;

export type NoticeRow = {
  id: string;
  client_id: string;
  client_code: string;
  client_name: string;
  client_gone: number;
  document_id: string;
  document_type: string;
  number_display: string | null;
  contact_id: string | null;
  contact_name: string | null;
  via: string;
  amount_minor: number;
  currency: string;
  paid_on: string;
  reference: string;
  reference_norm: string;
  note: string | null;
  status: string;
  payment_id: string | null;
  closed_by: string | null;
  closed_by_name: string | null;
  closed_at: number | null;
  close_note: string | null;
  created_at: number;
};

/** A notice as the Notices tab shows it (an anonymised client is named as such everywhere). */
export const noticeView = (r: NoticeRow) => ({
  id: r.id,
  client: {
    id: r.client_id,
    code: r.client_code,
    name: r.client_gone === 1 ? ANONYMISED_CLIENT : r.client_name,
  },
  document: { id: r.document_id, type: r.document_type, numberDisplay: r.number_display },
  contact: r.contact_id ? { id: r.contact_id, name: r.contact_name } : null,
  via: r.via,
  amountMinor: r.amount_minor,
  currency: r.currency,
  paidOn: r.paid_on,
  reference: r.reference,
  referenceNorm: r.reference_norm,
  note: r.note,
  status: r.status,
  paymentId: r.payment_id,
  closedBy: r.closed_by ? { id: r.closed_by, name: r.closed_by_name } : null,
  closedAt: r.closed_at,
  closeNote: r.close_note,
  createdAt: r.created_at,
});

export const paymentNotices = new Hono<AppEnv>()
  .get("/notices", async (c) => {
    const status = c.req.query("status") ?? "open";
    const client = c.req.query("client");
    const after = c.req.query("after");
    if (
      !(STATUSES as readonly string[]).includes(status) ||
      (client !== undefined && !ID.test(client)) ||
      (after !== undefined && !AFTER.test(after))
    )
      return err(c, BAD_REQUEST, 400);
    const at = after ? after.indexOf(":") : -1;
    const cursor = after ? [Number(after.slice(0, at)), after.slice(at + 1)] : [-1, ""];
    const db = c.env.DB;
    const [list, count] = await db.batch([
      client
        ? db.prepare(NOTICES_BY_CLIENT_SQL).bind(client, status, ...cursor)
        : db.prepare(NOTICES_BY_STATUS_SQL).bind(status, ...cursor),
      db.prepare(OPEN_NOTICES_COUNT_SQL),
    ]);
    const rows = (list?.results ?? []) as NoticeRow[];
    const page = rows.slice(0, PAGE);
    const last = page[page.length - 1];
    return c.json({
      items: page.map(noticeView),
      next: rows.length > PAGE && last ? `${last.created_at}:${last.id}` : null,
      openCount: (count?.results[0] as { n: number } | undefined)?.n ?? 0,
    });
  })
  .post("/notices/:id/close", param(idParam), body(noticeCloseBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const read = () =>
      db.prepare("SELECT status FROM payment_notices WHERE id = ?1").bind(id).first<{ status: string }>();
    const before = await read();
    if (!before) return err(c, NOT_FOUND, 404);
    if (before.status !== "open") return err(c, NOTICE_CLOSED, 409);
    const note = noticeCloseNoteOf(f.note);
    const done = await mutate(c, {
      main: db.prepare(NOTICE_DISMISS_SQL).bind(id, u.id, Date.now(), note),
      action: "payment.notice_close",
      entityType: "payment_notice",
      entityId: id,
      // Never the note's words (it may name a person).
      summary: { noticeId: id, outcome: "dismissed", note: note ? "set" : null },
    });
    if (!done) return err(c, NOTICE_CLOSED, 409);
    return c.json({ ok: true, status: "dismissed" });
  });
