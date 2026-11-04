// The requests clients send from the portal (M7.1; POR-09, POR-11; run file C, L8), in the admin API Worker:
//   GET  /client-requests                  a keyset page of 50: by status (oldest first, `client_requests_status`; the `kind` filter is residual on it) or one
//                                          client's (newest first, `client_requests_client`: the client page's Requests panel), and the open count for the
//                                          navigation (`requests.read`). Each row says whether this member may close it (`canClose`);
//   POST /client-requests/:id/close        the outcome and an optional note (`requests.close`; audit `client_request.close`; 409 `request_closed`).
// Who closes what (review fix 11, early check 1 finding 3): Staff close a contact change or a grievance; every data-rights kind (access, correction, erasure, and
// any kind M7.4 adds) is the Owner's. Held in three places: `decide()` on the record's kind (the guard only lets Staff through as "approval"), the close
// UPDATE's WHERE (`?role = 'owner' OR kind IN (…)`), and the trigger `client_requests_owner_close` (0072: an active Owner, whatever the route sent).
// The request's 30-day clock is M7.4's. The close note is kept as the record of how the request was handled (lead triage, item 5); the dialog's hint asks for
// no personal data (staff line S6). Staff lines S2 (the panel and the close) are the designer's under the lead's delegation.
import { ANONYMISED_CLIENT } from "@techaust/core/clients";
import { decide } from "@techaust/core/permissions";
import { isRequestKind, REQUEST_STATUSES, STAFF_CLOSE_KINDS } from "@techaust/core/portal";
import { requestCloseBody, requestCloseNoteOf } from "@techaust/core/portal-schemas";
import { Hono } from "hono/tiny";
import { type AppEnv, actor, BAD_REQUEST, err, FORBIDDEN, mutate, NOT_FOUND } from "./context.ts";
import { body, idParam, param } from "./http.ts";

const PAGE = 50;
const AFTER = /^\d{1,15}:[A-Za-z0-9_-]{1,64}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const STAFF_KINDS_SQL = `(${STAFF_CLOSE_KINDS.map((k) => `'${k}'`).join(", ")})`;

const COLS = `r.id, r.client_id, k.code AS client_code, k.display_name AS client_name, (k.anonymised_at IS NOT NULL) AS client_gone, r.contact_id,
  c.name AS contact_name, c.email AS contact_email, r.lead_id, r.kind, r.details, r.status, r.outcome, r.closed_by,
  (SELECT name FROM staff_users WHERE id = r.closed_by) AS closed_by_name, r.closed_at, r.close_note, r.created_at, r.updated_at`;
const FROM = "LEFT JOIN clients k ON k.id = r.client_id LEFT JOIN contacts c ON c.id = r.contact_id";
/** The optional kind filter (`?n` the kind, or NULL for every kind). */
const kindOf = (n: number) => `(?${n} IS NULL OR r.kind = ?${n})`;

/** ?1 status, ?2 kind or NULL, ?3 and ?4 the cursor (created_at, id; -1 and "" on the first page). Oldest first. */
export const REQUESTS_BY_STATUS_SQL = `SELECT ${COLS} FROM client_requests r INDEXED BY client_requests_status ${FROM}
   WHERE r.status = ?1 AND ${kindOf(2)} AND (r.created_at, r.id) > (?3, ?4) ORDER BY r.created_at, r.id LIMIT ${PAGE + 1}`;
/** ?1 client, ?2 status or NULL, ?3 kind or NULL, ?4 and ?5 the cursor (newest first: a huge created_at on the first page). */
export const REQUESTS_BY_CLIENT_SQL = `SELECT ${COLS} FROM client_requests r INDEXED BY client_requests_client ${FROM}
   WHERE r.client_id = ?1 AND (?2 IS NULL OR r.status = ?2) AND ${kindOf(3)} AND (r.created_at, r.id) < (?4, ?5)
   ORDER BY r.created_at DESC, r.id DESC LIMIT ${PAGE + 1}`;
export const OPEN_REQUESTS_COUNT_SQL =
  "SELECT count(*) AS n FROM client_requests INDEXED BY client_requests_status WHERE status = 'open'";
/**
 * ?1 request, ?2 outcome, ?3 who, ?4 now, ?5 note, ?6 the member's role. Only an open request, and only a kind the role may close (the trigger
 * `client_requests_owner_close` holds it too).
 */
export const REQUEST_CLOSE_SQL = `UPDATE client_requests SET status = 'closed', outcome = ?2, closed_by = ?3, closed_at = ?4, close_note = ?5, updated_at = max(updated_at, ?4)
   WHERE id = ?1 AND status = 'open' AND (?6 = 'owner' OR kind IN ${STAFF_KINDS_SQL})`;

export const REQUEST_CLOSED = { code: "request_closed", message: "This request is already closed" } as const;

export type ClientRequestRow = {
  id: string;
  client_id: string | null;
  client_code: string | null;
  client_name: string | null;
  client_gone: number | null;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  lead_id: string | null;
  kind: string;
  details: string | null;
  status: string;
  outcome: string | null;
  closed_by: string | null;
  closed_by_name: string | null;
  closed_at: number | null;
  close_note: string | null;
  created_at: number;
  updated_at: number;
};

/** A request as the admin shows it; `canClose` is this member's right on its kind (the SPA shows Close only then). */
export function requestView(r: ClientRequestRow, role: Parameters<typeof decide>[0]) {
  return {
    id: r.id,
    client: r.client_id
      ? {
          id: r.client_id,
          code: r.client_code,
          name: r.client_gone === 1 ? ANONYMISED_CLIENT : r.client_name,
        }
      : null,
    contact: r.contact_id ? { id: r.contact_id, name: r.contact_name, email: r.contact_email } : null,
    leadId: r.lead_id,
    kind: r.kind,
    details: r.details,
    status: r.status,
    outcome: r.outcome,
    closedBy: r.closed_by ? { id: r.closed_by, name: r.closed_by_name } : null,
    closedAt: r.closed_at,
    closeNote: r.close_note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    canClose: r.status === "open" && decide(role, "requests.close", { requestKind: r.kind }) === "allow",
  };
}

export const clientRequests = new Hono<AppEnv>()
  .get("/", async (c) => {
    const u = actor(c);
    const status = c.req.query("status");
    const kind = c.req.query("kind") ?? null;
    const client = c.req.query("client");
    const after = c.req.query("after");
    if (
      (status !== undefined && !(REQUEST_STATUSES as readonly string[]).includes(status)) ||
      (kind !== null && !isRequestKind(kind)) ||
      (client !== undefined && !ID.test(client)) ||
      (after !== undefined && !AFTER.test(after))
    )
      return err(c, BAD_REQUEST, 400);
    const at = after ? after.indexOf(":") : -1;
    const db = c.env.DB;
    const list = client
      ? db
          .prepare(REQUESTS_BY_CLIENT_SQL)
          .bind(
            client,
            status ?? null,
            kind,
            ...(after ? [Number(after.slice(0, at)), after.slice(at + 1)] : [Number.MAX_SAFE_INTEGER, ""]),
          )
      : db
          .prepare(REQUESTS_BY_STATUS_SQL)
          .bind(
            status ?? "open",
            kind,
            ...(after ? [Number(after.slice(0, at)), after.slice(at + 1)] : [-1, ""]),
          );
    const [rows, count] = await db.batch([list, db.prepare(OPEN_REQUESTS_COUNT_SQL)]);
    const all = (rows?.results ?? []) as ClientRequestRow[];
    const page = all.slice(0, PAGE);
    const last = page[page.length - 1];
    return c.json({
      items: page.map((r) => requestView(r, u.role)),
      next: all.length > PAGE && last ? `${last.created_at}:${last.id}` : null,
      openCount: (count?.results[0] as { n: number } | undefined)?.n ?? 0,
    });
  })
  .post("/:id/close", param(idParam), body(requestCloseBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const read = () =>
      db
        .prepare("SELECT kind, status FROM client_requests WHERE id = ?1")
        .bind(id)
        .first<{ kind: string; status: string }>();
    const before = await read();
    if (!before) return err(c, NOT_FOUND, 404);
    // The guard let Staff through as "approval" (no kind there); the record's kind decides, and only "allow" closes.
    if (decide(u.role, "requests.close", { requestKind: before.kind }) !== "allow")
      return err(c, FORBIDDEN, 403);
    if (before.status !== "open") return err(c, REQUEST_CLOSED, 409);
    const note = requestCloseNoteOf(f.note);
    const done = await mutate(c, {
      main: db.prepare(REQUEST_CLOSE_SQL).bind(id, f.outcome, u.id, Date.now(), note, u.role),
      action: "client_request.close",
      entityType: "client_request",
      entityId: id,
      // Codes only, never the note's words.
      summary: { requestId: id, kind: before.kind, outcome: f.outcome, note: note ? "set" : null },
    });
    if (!done) {
      const again = await read();
      return again?.status === "open" ? err(c, FORBIDDEN, 403) : err(c, REQUEST_CLOSED, 409);
    }
    return c.json({ ok: true, status: "closed", outcome: f.outcome });
  });
