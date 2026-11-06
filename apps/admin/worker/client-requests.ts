// The data and contact requests (M7.1; POR-09, POR-11; M7.4 ADM-SET-09, ADM-CLI-05; run files m7.1-portal C, L8 and m7.4-data-protection C.1–C.4), in the
// admin API Worker:
//   GET  /client-requests                  a keyset page of 50: by status (oldest first, `client_requests_status`), by state (overdue, due soon, not
//                                          acknowledged in 48 hours: by reply date over `client_requests_due`, C.1) or one client's (newest first,
//                                          `client_requests_client`), and the open count (`requests.read`). Each row carries its clock (received, reply
//                                          due, state, days left) and whether this member may close it (`canClose`);
//   POST /client-requests                  staff log a request that came by email, post, phone or in person (`requests.log`, C.2; audit
//                                          `client_request.log`);
//   POST /client-requests/:id/step         acknowledged or identity checked, each once (`requests.log`, C.3; audit `client_request.step`; 409 `step_done`);
//   POST /client-requests/:id/close        the outcome, an optional note, the decline reason, the fulfilling erase or anonymise, the export date
//                                          (`requests.close`, C.4; audit `client_request.close`).
// Who closes what (M7.1 review fix 11): Staff close a contact change or a grievance; every data-rights kind (access, correction, erasure, consent withdrawal,
// nomination) is the Owner's: `decide()` on the record's kind, the close UPDATE's WHERE and the trigger `client_requests_owner_close`. The clock: Researched
// 2026-11-06, DPDP Rules 2025 r.14(3); SPDI r.5(9); privacy notice 07-A §§7–8 (08-C RB-47); L42 (identity before `done`): Settled by the lead on the safest
// reading, 2026-11-06 (08-C RB-47).
import { ANONYMISED_CLIENT } from "@techaust/core/clients";
import {
  loggedDetailsOf,
  requestCloseBody,
  requestCloseNoteOf,
  requestLogBody,
  requestStepBody,
} from "@techaust/core/dp-schemas";
import {
  ACK_WINDOW_MS,
  closeVerdict,
  daysLeft,
  dueSoonBound,
  loggedReceivedAt,
  REQUEST_STATES,
  requestDueAt,
  requestDueAtSql,
  requestState,
} from "@techaust/core/dsr";
import { uuidv7 } from "@techaust/core/ids";
import { decide } from "@techaust/core/permissions";
import { isRequestKind, REQUEST_STATUSES, STAFF_CLOSE_KINDS } from "@techaust/core/portal";
import { Hono } from "hono/tiny";
import { type AppEnv, actor, BAD_REQUEST, err, FORBIDDEN, mutate, NOT_FOUND } from "./context.ts";
import { body, idParam, param } from "./http.ts";

const PAGE = 50;
const AFTER = /^-?\d{1,15}:[A-Za-z0-9_-]{1,64}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const STAFF_KINDS_SQL = `(${STAFF_CLOSE_KINDS.map((k) => `'${k}'`).join(", ")})`;
const isDsrKindFilter = (k: string) => isRequestKind(k) || k === "consent_withdrawal" || k === "nomination";

const COLS = `r.id, r.client_id, k.code AS client_code, k.display_name AS client_name, (k.anonymised_at IS NOT NULL) AS client_gone, r.contact_id,
  c.name AS contact_name, c.email AS contact_email, r.lead_id, (SELECT ref FROM leads WHERE id = r.lead_id) AS lead_code, r.lead_ref, r.contact_ref,
  r.requester_email, r.kind, r.details, r.status, r.outcome, r.closed_by, (SELECT name FROM staff_users WHERE id = r.closed_by) AS closed_by_name, r.closed_at,
  r.close_note, r.created_at, r.updated_at, r.received_at, r.due_at, r.ack_due_at, r.acknowledged_at, r.channel, r.logged_by, r.identity_checked_at,
  r.identity_checked_by, r.decline_reason, r.action_audit_id, r.export_sent_at`;
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
/**
 * C.1: the open requests in one state, by reply date (B1 decision 10: `INDEXED BY client_requests_due`, which the planner would pass over for
 * `client_requests_status`). ?1 and ?2 the `due_at` range of the state, ?3 1 when the state also needs a late acknowledgement, ?4 now, ?5 kind or NULL, ?6
 * and ?7 the cursor (due_at, id). The ranges follow core `requestState`'s order: overdue `due_at < now`; due soon `now ≤ due_at ≤ bound`; not acknowledged
 * `due_at > bound` with no acknowledgement and `ack_due_at < now`.
 */
export const REQUESTS_BY_STATE_SQL = `SELECT ${COLS} FROM client_requests r INDEXED BY client_requests_due ${FROM}
   WHERE r.status = 'open' AND r.due_at BETWEEN ?1 AND ?2 AND (?3 = 0 OR (r.acknowledged_at IS NULL AND r.ack_due_at < ?4)) AND ${kindOf(5)}
     AND (r.due_at, r.id) > (?6, ?7) ORDER BY r.due_at, r.id LIMIT ${PAGE + 1}`;
export const OPEN_REQUESTS_COUNT_SQL =
  "SELECT count(*) AS n FROM client_requests INDEXED BY client_requests_status WHERE status = 'open'";

/**
 * C.4: ?1 request, ?2 outcome, ?3 who, ?4 now, ?5 note, ?6 the member's role, ?7 decline reason, ?8 the fulfilling audit row, ?9 export sent at. Only an open
 * request, only a kind the role may close (the trigger `client_requests_owner_close` holds it too), L42's identity check for a `done` access, correction,
 * erasure or nomination request, and (round 4, round 6) a `done` erasure only against the erase or anonymise of its own contact (`contactId` in the audit
 * summary = `contact_ref`) or lead (the audit entity = `lead_ref`), written after it arrived. The export date is never in the future. The trigger
 * `client_requests_close_rules` holds the same rules.
 */
export const REQUEST_CLOSE_SQL = `UPDATE client_requests SET status = 'closed', outcome = ?2, closed_by = ?3, closed_at = ?4, close_note = ?5, updated_at = max(updated_at, ?4),
     decline_reason = ?7, action_audit_id = ?8, export_sent_at = ?9
   WHERE id = ?1 AND status = 'open' AND (?6 = 'owner' OR kind IN ${STAFF_KINDS_SQL})
     AND (?2 <> 'done' OR kind NOT IN ('data_access', 'data_correction', 'data_erasure', 'nomination') OR identity_checked_at IS NOT NULL)
     AND (?9 IS NULL OR ?9 <= ?4)
     AND (?2 <> 'done' OR kind <> 'data_erasure' OR EXISTS (SELECT 1 FROM audit_log a WHERE a.id = ?8 AND a.at >= client_requests.received_at
       AND ((client_requests.contact_ref IS NOT NULL AND a.action IN ('contact.erase', 'contact.anonymise') AND json_extract(a.summary, '$.contactId') = client_requests.contact_ref)
         OR (client_requests.lead_ref IS NOT NULL AND a.action = 'lead.erase' AND a.entity_type = 'lead' AND a.entity_id = client_requests.lead_ref))))`;

/**
 * C.3: ?1 request, ?2 now, ?3 who. Each step once, on an open request; the trigger `client_requests_steps` holds the same (set once, by an active member,
 * never before the request arrived).
 */
export const REQUEST_STEP_SQL = {
  acknowledged:
    "UPDATE client_requests SET acknowledged_at = max(?2, received_at), updated_at = max(updated_at, ?2) WHERE id = ?1 AND status = 'open' AND acknowledged_at IS NULL AND ?3 IS NOT NULL",
  identity_checked:
    "UPDATE client_requests SET identity_checked_at = ?2, identity_checked_by = ?3, updated_at = max(updated_at, ?2) WHERE id = ?1 AND status = 'open' AND identity_checked_at IS NULL",
} as const;

/** Any open request of this kind for the same subject (round 5, M7.1 note 4: answered 409 through NOT EXISTS, never by the unique index aborting). */
const OPEN_SAME = `SELECT 1 FROM client_requests o WHERE o.kind = ?6 AND o.status = 'open' AND (
     (?3 IS NOT NULL AND o.contact_id = ?3)
  OR (?4 IS NOT NULL AND o.lead_ref = ?4)
  OR (?5 IS NOT NULL AND o.requester_email = ?5 AND o.contact_id IS NULL AND o.lead_ref IS NULL)
  OR (?3 IS NULL AND ?4 IS NULL AND ?5 IS NULL AND o.client_id = ?2 AND o.contact_id IS NULL AND o.lead_ref IS NULL AND o.requester_email IS NULL))`;

/**
 * C.2: ?1 id, ?2 client (or NULL), ?3 contact, ?4 lead, ?5 requester's address, ?6 kind, ?7 details, ?8 received_at, ?9 due_at, ?10 ack_due_at, ?11 channel,
 * ?12 who, ?13 now. The contact must be live and its client's (the client of a contact comes from the contact; a client sent with it must be that one, else
 * nothing is written and the answer is 404), the lead must exist, unconverted and not erased (L22), a client alone must exist and not be anonymised; the
 * reply date is checked again against core's SQL twin; no open request of the kind for the subject.
 */
export const REQUEST_LOG_SQL = `INSERT INTO client_requests (id, client_id, contact_id, contact_ref, lead_id, lead_ref, requester_email, kind, details, status, created_at, updated_at,
     received_at, due_at, ack_due_at, channel, logged_by)
   SELECT ?1, CASE WHEN ?3 IS NULL THEN ?2 ELSE (SELECT client_id FROM contacts WHERE id = ?3) END, ?3, ?3, ?4, ?4, ?5, ?6, ?7, 'open', ?13, ?13, ?8, ?9, ?10, ?11, ?12
   WHERE ?9 = ${requestDueAtSql("?8")} AND ?10 = ?8 + ${ACK_WINDOW_MS}
     AND (?3 IS NULL OR EXISTS (SELECT 1 FROM contacts c JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?3 AND c.anonymised_at IS NULL AND cl.anonymised_at IS NULL AND (?2 IS NULL OR c.client_id = ?2)))
     AND (?4 IS NULL OR EXISTS (SELECT 1 FROM leads l WHERE l.id = ?4 AND l.client_id IS NULL AND l.erased_hash IS NULL))
     AND (?3 IS NOT NULL OR ?2 IS NULL OR EXISTS (SELECT 1 FROM clients cl WHERE cl.id = ?2 AND cl.anonymised_at IS NULL))
     AND NOT EXISTS (${OPEN_SAME})`;

/** Why a log was refused (read after the batch wrote nothing): ?2 client, ?3 contact, ?4 lead, ?5 address, ?6 kind. */
const LOG_WHY_SQL = `SELECT
     (?3 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = ?3 AND (?2 IS NULL OR c.client_id = ?2))) AS no_contact,
     (?3 IS NOT NULL AND EXISTS (SELECT 1 FROM contacts c JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?3 AND (c.anonymised_at IS NOT NULL OR cl.anonymised_at IS NOT NULL))) AS contact_gone,
     (?4 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = ?4)) AS no_lead,
     (?4 IS NOT NULL AND EXISTS (SELECT 1 FROM leads l WHERE l.id = ?4 AND l.client_id IS NOT NULL)) AS lead_converted,
     (?4 IS NOT NULL AND EXISTS (SELECT 1 FROM leads l WHERE l.id = ?4 AND l.erased_hash IS NOT NULL)) AS lead_erased,
     (?3 IS NULL AND ?4 IS NULL AND ?5 IS NULL AND ?2 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients cl WHERE cl.id = ?2)) AS no_client,
     (?3 IS NULL AND ?4 IS NULL AND ?5 IS NULL AND ?2 IS NOT NULL AND EXISTS (SELECT 1 FROM clients cl WHERE cl.id = ?2 AND cl.anonymised_at IS NOT NULL)) AS client_gone,
     EXISTS (${OPEN_SAME}) AS open_same`;

export const REQUEST_CLOSED = { code: "request_closed", message: "This request is already closed" } as const;
export const REQUEST_OPEN = {
  code: "request_open",
  message: "A request of this kind is already open",
} as const;
export const LEAD_CONVERTED = {
  code: "lead_converted",
  message: "This lead became a client. Log the request against its contact",
} as const;
export const STEP_DONE = { code: "step_done", message: "This step is already recorded" } as const;
export const ACTION_MISSING = {
  code: "action_missing",
  message: "Link the erase or anonymise of this person, made after the request arrived",
} as const;
const GONE = { code: "anonymised", message: "This record was anonymised" } as const;
const CLOSE_CODES: Record<string, string> = {
  decline_reason_required: "Choose why the request is declined",
  decline_reason_not_allowed: "That reason doesn't fit this request",
  action_required: "Link the erase or anonymise that fulfilled the request",
  action_not_allowed: "Only a done erasure request links an erase or anonymise",
  export_sent_not_allowed: "Only a done access request records when its export was sent",
  identity_not_checked: "Record the identity check before closing this request as done",
};

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
  lead_code: string | null;
  lead_ref: string | null;
  contact_ref: string | null;
  requester_email: string | null;
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
  received_at: number | null;
  due_at: number | null;
  ack_due_at: number | null;
  acknowledged_at: number | null;
  channel: string;
  logged_by: string | null;
  identity_checked_at: number | null;
  identity_checked_by: string | null;
  decline_reason: string | null;
  action_audit_id: string | null;
  export_sent_at: number | null;
};

/** A request as the admin shows it; `canClose` is this member's right on its kind (the SPA shows Close only then). */
export function requestView(r: ClientRequestRow, role: Parameters<typeof decide>[0], now = Date.now()) {
  const clock = {
    status: r.status,
    dueAt: r.due_at,
    ackDueAt: r.ack_due_at,
    acknowledgedAt: r.acknowledged_at,
  };
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
    lead: r.lead_ref ? { id: r.lead_ref, ref: r.lead_code, gone: r.lead_id === null } : null,
    contactRef: r.contact_ref,
    requesterEmail: r.requester_email,
    kind: r.kind,
    details: r.details,
    status: r.status,
    outcome: r.outcome,
    closedBy: r.closed_by ? { id: r.closed_by, name: r.closed_by_name } : null,
    closedAt: r.closed_at,
    closeNote: r.close_note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    channel: r.channel,
    loggedBy: r.logged_by,
    receivedAt: r.received_at,
    dueAt: r.due_at,
    ackDueAt: r.ack_due_at,
    acknowledgedAt: r.acknowledged_at,
    identityCheckedAt: r.identity_checked_at,
    identityCheckedBy: r.identity_checked_by,
    declineReason: r.decline_reason,
    actionAuditId: r.action_audit_id,
    exportSentAt: r.export_sent_at,
    state: requestState(clock, now),
    daysLeft: r.status === "open" && r.due_at !== null ? daysLeft(r.due_at, now) : null,
    canClose: r.status === "open" && decide(role, "requests.close", { requestKind: r.kind }) === "allow",
  };
}

/** The `due_at` range and acknowledgement flag of a state filter at `now` (C.1). */
function stateRange(state: "overdue" | "due_soon" | "ack_overdue", now: number): [number, number, 0 | 1] {
  const bound = dueSoonBound(now);
  if (state === "overdue") return [0, now - 1, 0];
  if (state === "due_soon") return [now, bound, 0];
  return [bound + 1, Number.MAX_SAFE_INTEGER, 1];
}

/** The close row as read: what `closeVerdict` needs, and who may close it. */
type CloseRead = {
  kind: string;
  status: string;
  contact_ref: string | null;
  lead_ref: string | null;
  identity_checked_at: number | null;
};

export const clientRequests = new Hono<AppEnv>()
  .get("/", async (c) => {
    const u = actor(c);
    const status = c.req.query("status");
    const state = c.req.query("state");
    const kind = c.req.query("kind") ?? null;
    const client = c.req.query("client");
    const after = c.req.query("after");
    const stateFilter =
      state === "overdue" || state === "due_soon" || state === "ack_overdue" ? state : undefined;
    if (
      (status !== undefined && !(REQUEST_STATUSES as readonly string[]).includes(status)) ||
      (state !== undefined &&
        (stateFilter === undefined || !(REQUEST_STATES as readonly string[]).includes(state))) ||
      (state !== undefined && (client !== undefined || status !== undefined)) ||
      (kind !== null && !isDsrKindFilter(kind)) ||
      (client !== undefined && !ID.test(client)) ||
      (after !== undefined && !AFTER.test(after))
    )
      return err(c, BAD_REQUEST, 400);
    const at = after ? after.indexOf(":") : -1;
    const cursor = after ? [Number(after.slice(0, at)), after.slice(at + 1)] : null;
    const db = c.env.DB;
    const now = Date.now();
    let list: D1PreparedStatement;
    let keyOf: (r: ClientRequestRow) => number;
    if (stateFilter) {
      const [lo, hi, ack] = stateRange(stateFilter, now);
      list = db.prepare(REQUESTS_BY_STATE_SQL).bind(lo, hi, ack, now, kind, ...(cursor ?? [-1, ""]));
      keyOf = (r) => r.due_at ?? 0;
    } else if (client) {
      list = db
        .prepare(REQUESTS_BY_CLIENT_SQL)
        .bind(client, status ?? null, kind, ...(cursor ?? [Number.MAX_SAFE_INTEGER, ""]));
      keyOf = (r) => r.created_at;
    } else {
      list = db.prepare(REQUESTS_BY_STATUS_SQL).bind(status ?? "open", kind, ...(cursor ?? [-1, ""]));
      keyOf = (r) => r.created_at;
    }
    const [rows, count] = await db.batch([list, db.prepare(OPEN_REQUESTS_COUNT_SQL)]);
    const all = (rows?.results ?? []) as ClientRequestRow[];
    const page = all.slice(0, PAGE);
    const last = page[page.length - 1];
    return c.json({
      items: page.map((r) => requestView(r, u.role, now)),
      next: all.length > PAGE && last ? `${keyOf(last)}:${last.id}` : null,
      openCount: (count?.results[0] as { n: number } | undefined)?.n ?? 0,
    });
  })

  // ---- C.2: staff log a request (email, post, phone, in person) ----
  .post("/", body(requestLogBody), async (c) => {
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const now = Date.now();
    const received = loggedReceivedAt(f.receivedOn, now);
    if (received === null)
      return err(c, { code: "received_on_invalid", message: "The day can't be in the future" }, 400);
    const id = uuidv7();
    const details = loggedDetailsOf(f);
    const subject = [
      f.contactId === undefined ? (f.clientId ?? null) : (f.clientId ?? null),
      f.contactId ?? null,
      f.leadId ?? null,
      f.requesterEmail ?? null,
    ] as const;
    const done = await mutate(c, {
      main: db
        .prepare(REQUEST_LOG_SQL)
        .bind(
          id,
          ...subject,
          f.kind,
          details,
          received,
          requestDueAt(received),
          received + ACK_WINDOW_MS,
          f.channel,
          u.id,
          now,
        ),
      action: "client_request.log",
      entityType: "client_request",
      entityId: id,
      // Codes and ids only, never the words or the address.
      summary: {
        requestId: id,
        kind: f.kind,
        channel: f.channel,
        subject: f.contactId ? "contact" : f.leadId ? "lead" : f.requesterEmail ? "email" : "client",
      },
      status: 201,
    });
    if (done) {
      const row = await db
        .prepare(`SELECT ${COLS} FROM client_requests r ${FROM} WHERE r.id = ?1`)
        .bind(id)
        .first<ClientRequestRow>();
      return c.json({ request: row ? requestView(row, u.role, now) : { id } }, 201);
    }
    const why = await db
      .prepare(LOG_WHY_SQL)
      .bind(null, ...subject, f.kind)
      .first<Record<string, number>>();
    if (why?.no_contact || why?.no_lead || why?.no_client) return err(c, NOT_FOUND, 404);
    if (why?.lead_converted) return err(c, LEAD_CONVERTED, 409);
    if (why?.contact_gone || why?.client_gone || why?.lead_erased) return err(c, GONE, 409);
    if (why?.open_same) return err(c, REQUEST_OPEN, 409);
    return err(c, BAD_REQUEST, 400);
  })

  // ---- C.3: acknowledged / identity checked, each once ----
  .post("/:id/step", param(idParam), body(requestStepBody), async (c) => {
    const { id } = c.req.valid("param");
    const { step } = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const now = Date.now();
    const done = await mutate(c, {
      main: db.prepare(REQUEST_STEP_SQL[step]).bind(id, now, u.id),
      action: "client_request.step",
      entityType: "client_request",
      entityId: id,
      summary: { requestId: id, step },
    });
    if (done) return c.json({ ok: true, step, at: now });
    const row = await db
      .prepare("SELECT status, acknowledged_at, identity_checked_at FROM client_requests WHERE id = ?1")
      .bind(id)
      .first<{ status: string; acknowledged_at: number | null; identity_checked_at: number | null }>();
    if (!row) return err(c, NOT_FOUND, 404);
    if (row.status !== "open") return err(c, REQUEST_CLOSED, 409);
    return err(c, STEP_DONE, 409);
  })

  // ---- C.4: the close ----
  .post("/:id/close", param(idParam), body(requestCloseBody), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const u = actor(c);
    const db = c.env.DB;
    const read = () =>
      db
        .prepare(
          "SELECT kind, status, contact_ref, lead_ref, identity_checked_at FROM client_requests WHERE id = ?1",
        )
        .bind(id)
        .first<CloseRead>();
    const before = await read();
    if (!before) return err(c, NOT_FOUND, 404);
    // The guard let Staff through as "approval" (no kind there); the record's kind decides, and only "allow" closes.
    if (decide(u.role, "requests.close", { requestKind: before.kind }) !== "allow")
      return err(c, FORBIDDEN, 403);
    const verdict = closeVerdict(
      {
        kind: before.kind,
        status: before.status,
        contactRef: before.contact_ref,
        leadRef: before.lead_ref,
        identityCheckedAt: before.identity_checked_at,
      },
      {
        outcome: f.outcome,
        declineReason: f.declineReason ?? null,
        actionAuditId: f.actionAuditId ?? null,
        exportSentAt: f.exportSentAt ?? null,
      },
    );
    if (!verdict.ok) {
      if (verdict.code === "request_closed") return err(c, REQUEST_CLOSED, 409);
      return err(c, { code: verdict.code, message: CLOSE_CODES[verdict.code] ?? "Check the close" }, 409);
    }
    const note = requestCloseNoteOf(f.note);
    const now = Date.now();
    const declineReason = f.outcome === "declined" ? (f.declineReason ?? null) : null;
    const actionAuditId = f.outcome === "done" ? (f.actionAuditId ?? null) : null;
    const exportSentAt = f.exportSentAt ?? null;
    let done: boolean;
    try {
      done = await mutate(c, {
        main: db
          .prepare(REQUEST_CLOSE_SQL)
          .bind(id, f.outcome, u.id, now, note, u.role, declineReason, actionAuditId, exportSentAt),
        action: "client_request.close",
        entityType: "client_request",
        entityId: id,
        // Codes only, never the note's words.
        summary: {
          requestId: id,
          kind: before.kind,
          outcome: f.outcome,
          note: note ? "set" : null,
          declineReason,
          actionAuditId,
          exportSent: exportSentAt !== null,
        },
      });
    } catch (e) {
      // The trigger holds what the WHERE holds; a refusal here means the row changed between the read and the batch.
      if (e instanceof Error && /client_requests_close_rules/.test(e.message))
        return err(c, { code: "close_refused", message: "Check the close and try again" }, 409);
      if (e instanceof Error && /client_requests_owner_close/.test(e.message)) return err(c, FORBIDDEN, 403);
      throw e;
    }
    if (!done) {
      const again = await read();
      if (again?.status !== "open") return err(c, REQUEST_CLOSED, 409);
      if (f.outcome === "done" && again.identity_checked_at === null && before.identity_checked_at !== null)
        return err(c, { code: "identity_not_checked", message: CLOSE_CODES.identity_not_checked ?? "" }, 409);
      if (f.outcome === "done" && again.kind === "data_erasure") return err(c, ACTION_MISSING, 409);
      if (exportSentAt !== null && exportSentAt > now)
        return err(
          c,
          { code: "export_sent_not_allowed", message: CLOSE_CODES.export_sent_not_allowed ?? "" },
          409,
        );
      return err(c, FORBIDDEN, 403);
    }
    return c.json({ ok: true, status: "closed", outcome: f.outcome });
  });
