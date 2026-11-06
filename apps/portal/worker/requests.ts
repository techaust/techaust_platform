// A contact's requests from the Profile page (M7.1; POR-09, POR-11; run file C, L8, L9, L16): `POST /requests {kind, details}`. Five kinds: adding, removing or
// changing a person's access, and a channel for each of the DPDP Act's rights of the data principal (access, Researched 2026-10-29, DPDP Act s.11(1) and
// Rule 14 (08-C RB-36); correction and erasure, Researched 2026-10-29, DPDP Act s.8(7) and s.12(3) (08-C RB-37); correction channels Settled by the lead on the safest
// reading, 2026-11-05 (08-C RB-44): a contact corrects her own name and phone on the Profile page, anything else is a `data_correction` request, and both are
// audited; a grievance, Researched 2026-10-28, SPDI Rules 2011 Rule 5(9) (08-C RB-13)). Identity is the signed-in
// session (L8): the insert takes the client, the contact and `contact_ref` from the session (the trigger holds `contact_ref IS contact_id`).
//
// ONE batch, every rule in the INSERT's WHERE: the contact is live, it has no open request of this kind (409 `request_open`; the partial unique index
// `client_requests_open_kind` backs it) and it sent fewer than 5 today in IST (429 `too_many_requests`, `REQUESTS_TODAY_SQL`). The audit row is written only if
// the insert happened, the access row only if the audit row exists; a read in the same batch explains a refusal. Then the staff bell is asked of the jobs
// Worker (`portal.alert`, L9: portal SQL never names a staff table). No email in M7.1 (L16): the screen acknowledges.
import { requestDueAtSql } from "@techaust/core/dsr";
import { uuidv7 } from "@techaust/core/ids";
import { portalAlertMessage, REQUESTS_PER_DAY } from "@techaust/core/portal";
import { clientRequest, requestDetailsOf } from "@techaust/core/portal-schemas";
import { accessStmt, auditStmt } from "@techaust/db/log";
import { REQUESTS_TODAY_SQL } from "@techaust/db/sql-rules";
import { Hono } from "hono/tiny";
import { type AppEnv, accessEntry, type Ctx, err, NOT_FOUND, requestInfo } from "./context.ts";
import { bound } from "./offer-core.ts";
import { type RequestRow, requestOf } from "./profile.ts";
import { scope } from "./scope.ts";
import { json } from "./validate.ts";

/** An open request of this kind by this contact (?2 contact, ?4 kind). */
const OPEN_OF_KIND =
  "SELECT 1 FROM client_requests o WHERE o.contact_id = ?2 AND o.kind = ?4 AND o.status = 'open'";

/**
 * ?1 client, ?2 contact (both from the session), ?3 the new id, ?4 kind, ?5 details, ?6 now. The contact must be the session's live contact of this client;
 * no open request of the kind; fewer than `REQUESTS_PER_DAY` since 00:00 IST. Early check 2, finding 4: the client is joined not anonymised, so the insert
 * holds the anonymised-client lock itself (not only through the guard's session read).
 */
// M7.4 (A.1; RB-47): the request clock is written with the row: received when sent (`created_at`), the reply date (core `requestDueAt`, its SQL twin),
// the acknowledgement 48 hours on; the trigger `client_requests_clock_insert` checks all three. L42: a portal request is identity-checked by the sign-in that
// sent it, so `identity_checked_at` is the time it arrived (no staff member: the trigger allows that only for `channel = 'portal'`).
export const REQUEST_INSERT_SQL = `INSERT INTO client_requests (id, client_id, contact_id, contact_ref, kind, details, status, created_at, updated_at, received_at, due_at, ack_due_at, identity_checked_at)
   SELECT ?3, c.client_id, c.id, c.id, ?4, ?5, 'open', ?6, ?6, ?6, ${requestDueAtSql("?6")}, ?6 + 172800000, ?6 FROM contacts c
     JOIN clients k ON k.id = c.client_id AND k.anonymised_at IS NULL
   WHERE c.client_id = ?1 AND c.id = ?2 AND c.portal_access = 1 AND c.anonymised_at IS NULL
     AND NOT EXISTS (${OPEN_OF_KIND}) AND ${REQUESTS_TODAY_SQL("?2", "?6")} < ${REQUESTS_PER_DAY}`;

/** Read in the same batch, after the insert: the new row (when written), else why not. ?1 client, ?2 contact, ?3 id, ?4 kind, ?5 now. */
export const REQUEST_AFTER_SQL = `SELECT (SELECT r.id FROM client_requests r WHERE r.id = ?3 AND r.client_id = ?1) AS written,
     EXISTS (SELECT 1 FROM client_requests o WHERE o.contact_id = ?2 AND o.kind = ?4 AND o.status = 'open' AND o.client_id = ?1) AS open_of_kind,
     ${REQUESTS_TODAY_SQL("?2", "?5")} AS today`;

/** The refusals (the SPA words them: C24). */
export const REQUEST_OPEN = { code: "request_open", message: "[Placeholder] C24" } as const;
export const TOO_MANY_REQUESTS = { code: "too_many_requests", message: "[Placeholder] C24" } as const;

/**
 * L9: asks the jobs Worker for the staff bells of the audit row just written. In the execution context, after the answer; a failed send is one log line
 * (the row and the admin's lists still show the request or the notice: the bell is the only thing missing). Production has no email queue until Phase 7.
 */
export function alertStaff(c: Ctx, auditId: string): void {
  const queue = c.env.EMAIL_QUEUE as Queue | undefined;
  if (!queue) return;
  c.executionCtx.waitUntil(
    queue.send(portalAlertMessage(auditId)).catch(() => {
      console.error(
        JSON.stringify({
          level: "error",
          route: c.var.route?.path ?? "other",
          message: "queue send failed",
          queue: "EMAIL_QUEUE",
        }),
      );
    }),
  );
}

export const requests = new Hono<AppEnv>().post("/", json(clientRequest), async (c) => {
  const s = scope(c);
  const body = c.req.valid("json");
  const details = requestDetailsOf(body);
  const db = c.env.DB;
  const id = uuidv7();
  const auditId = uuidv7();
  const now = Date.now();
  const at = c.var.touch ? 1 : 0;
  let results: D1Result[];
  try {
    results = await db.batch([
      ...(c.var.touch ? [c.var.touch] : []),
      bound(db, REQUEST_INSERT_SQL, [s.clientId, s.contactId, id, body.kind, details, now]),
      auditStmt(
        db,
        {
          ...requestInfo(c),
          id: auditId,
          actorType: "contact",
          actorId: s.contactId,
          role: null,
          action: "portal.request",
          entityType: "client_request",
          entityId: id,
          // The kind only (a code), never the words.
          summary: { kind: body.kind },
        },
        "changes",
      ),
      accessStmt(db, accessEntry(c, 201), { auditId }),
      bound(db, REQUEST_AFTER_SQL, [s.clientId, s.contactId, id, body.kind, now]),
    ]);
  } catch (e) {
    // Two requests of one kind in the same instant: the partial unique index refuses the second, which is the same answer as the WHERE's.
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) return err(c, REQUEST_OPEN, 409);
    throw e;
  }
  const after = results[at + 3]?.results[0] as
    | { written: string | null; open_of_kind: number; today: number }
    | undefined;
  if (results[at]?.meta.changes !== 1 || !after?.written) {
    if (after?.open_of_kind === 1) return err(c, REQUEST_OPEN, 409);
    if ((after?.today ?? 0) >= REQUESTS_PER_DAY) return err(c, TOO_MANY_REQUESTS, 429);
    return err(c, NOT_FOUND, 404);
  }
  c.set("accessDone", true);
  alertStaff(c, auditId);
  const row: RequestRow = {
    id,
    kind: body.kind,
    details,
    status: "open",
    outcome: null,
    created_at: now,
    closed_at: null,
  };
  return c.json({ request: requestOf(row) }, 201);
});
