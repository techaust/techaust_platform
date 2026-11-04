// The signed-in contact's Profile page (M7.1; POR-09, POR-11; run file C, Q1 = A, L15): `GET /profile` (their own details, the colleagues with portal access
// and their own requests) and `POST /profile` (their own name and phone; owner, 2026-11-01: a change of email, and adding or removing people, stays a request).
// Every statement says `client_id = ?1` and names the session's contact (`?2`); nothing about who comes from the request.
//
// Colleagues are shown by NAME AND TITLE ONLY (L15), never an email, a phone or an id: Settled by the lead on the safest reading, 2026-11-05 (08-C RB-45):
// showing a contact who else in her own organisation has portal access serves the purpose the client gave the data for, limited to what it needs: name and
// title only, the same client only, people who have portal access and are not anonymised.
// The self-edit is a correction by the person themselves: Settled by the lead on the safest reading, 2026-11-05 (08-C RB-44): the contact corrects her own
// name and phone here, and everything else (the sign-in email, another person's data, data in documents) is a `data_correction` request; the self-edit is
// audited as `contact.self_update` with the field names only (never the values; NFR-6).
import { uuidv7 } from "@techaust/core/ids";
import { profileUpdate, storedPhone } from "@techaust/core/portal-schemas";
import { accessStmt, auditStmt } from "@techaust/db/log";
import { Hono } from "hono/tiny";
import { type AppEnv, accessEntry, BAD_REQUEST, type Ctx, err, requestInfo } from "./context.ts";
import { bound } from "./offer-core.ts";
import { scope } from "./scope.ts";
import { pageOf } from "./shared.ts";
import { json } from "./validate.ts";

/** ?1 client, ?2 the session's contact: their own details. */
export const ME_SQL =
  "SELECT c.name, c.email, c.phone, c.title, c.updated_at FROM contacts c WHERE c.client_id = ?1 AND c.id = ?2 AND c.anonymised_at IS NULL";
/**
 * ?1 client, ?2 the session's contact (marked as "(you)", C18): every live contact with portal access, by name and title only (L15). One read of at most 50,
 * not keyset pages: a recorded exception to the paging convention (lead, L26, early check 2 finding 6): an organisation's contacts with portal access are few,
 * and the list is a courtesy view, not a record.
 */
export const COLLEAGUES_SQL = `SELECT c.name, c.title, c.id = ?2 AS you FROM contacts c
   WHERE c.client_id = ?1 AND c.portal_access = 1 AND c.anonymised_at IS NULL ORDER BY c.name COLLATE NOCASE, c.id LIMIT 50`;
const REQUEST_COLS = "r.id, r.kind, r.details, r.status, r.outcome, r.created_at, r.closed_at";
/** ?1 client, ?2 contact, ?3 the page size plus one: the contact's own requests, newest first (never the staff's close note). */
export const MY_REQUESTS_SQL = `SELECT ${REQUEST_COLS} FROM client_requests r INDEXED BY client_requests_contact
   WHERE r.contact_id = ?2 AND r.client_id = ?1 ORDER BY r.created_at DESC, r.id DESC LIMIT ?3`;
/** ?1 client, ?2 contact, ?3 and ?4 the last row's created_at and id, ?5 the page size plus one. */
export const MY_REQUESTS_AFTER_SQL = `SELECT ${REQUEST_COLS} FROM client_requests r INDEXED BY client_requests_contact
   WHERE r.contact_id = ?2 AND r.client_id = ?1 AND (r.created_at, r.id) < (?3, ?4) ORDER BY r.created_at DESC, r.id DESC LIMIT ?5`;

/**
 * ?1 client, ?2 contact, ?3 name, ?4 phone, ?5 now, ?6 the `updated_at` the page read. Only the live contact itself (portal access, not anonymised), and only
 * when nothing changed it since (409 `stale_version`). The email never changes here (the schema is strict).
 */
export const SELF_UPDATE_SQL = `UPDATE contacts SET name = ?3, phone = ?4, updated_at = ?5
   WHERE id = ?2 AND client_id = ?1 AND updated_at = ?6 AND portal_access = 1 AND anonymised_at IS NULL`;

/** 409: the row changed since the page read it. The SPA shows copy line C17; the message stays a marked placeholder until the owner approves the copy page. */
export const STALE_VERSION = { code: "stale_version", message: "[Placeholder] C17" } as const;

type MeRow = { name: string; email: string; phone: string | null; title: string | null; updated_at: number };
type ColleagueRow = { name: string; title: string | null; you: number };
export type RequestRow = {
  id: string;
  kind: string;
  details: string | null;
  status: string;
  outcome: string | null;
  created_at: number;
  closed_at: number | null;
};

/** One of the contact's own requests (C19, C23): its kind, their words, open or closed with the outcome. */
export const requestOf = (r: RequestRow) => ({
  id: r.id,
  kind: r.kind,
  details: r.details,
  status: r.status,
  outcome: r.outcome,
  createdAt: r.created_at,
  closedAt: r.closed_at,
});

/** The profile's data: the contact's own details, the colleagues (name and title), and a page of their requests. */
async function readProfile(c: Ctx) {
  const s = scope(c);
  const page = pageOf(c);
  if (!page) return null;
  const db = c.env.DB;
  const [me, colleagues, requests] = await db.batch([
    bound(db, ME_SQL, [s.clientId, s.contactId]),
    bound(db, COLLEAGUES_SQL, [s.clientId, s.contactId]),
    page.after
      ? bound(db, MY_REQUESTS_AFTER_SQL, [
          s.clientId,
          s.contactId,
          page.after.createdAt,
          page.after.id,
          page.take + 1,
        ])
      : bound(db, MY_REQUESTS_SQL, [s.clientId, s.contactId, page.take + 1]),
  ]);
  const m = me?.results[0] as MeRow | undefined;
  const rows = (requests?.results ?? []) as RequestRow[];
  const shown = rows.slice(0, page.take);
  const last = shown[shown.length - 1];
  return {
    me: m ? { name: m.name, email: m.email, phone: m.phone, title: m.title, updatedAt: m.updated_at } : null,
    organisation: c.var.who?.organisation ?? null,
    colleagues: ((colleagues?.results ?? []) as ColleagueRow[]).map((r) => ({
      name: r.name,
      title: r.title,
      you: r.you === 1,
    })),
    requests: shown.map(requestOf),
    requestsNext: rows.length > page.take && last ? `${last.created_at}:${last.id}` : null,
  };
}

export const profile = new Hono<AppEnv>()
  .get("/", async (c) => {
    const p = await readProfile(c);
    if (!p) return err(c, BAD_REQUEST, 400);
    // The guard's read said the contact is live; a row gone between the two reads is the guard's 401 on the next request.
    return c.json(p);
  })
  .post("/", json(profileUpdate), async (c) => {
    const s = scope(c);
    const { name, phone, expectedUpdatedAt } = c.req.valid("json");
    const db = c.env.DB;
    const now = Math.max(Date.now(), expectedUpdatedAt + 1);
    // ONE batch: [the session touch], the guarded update, its audit row only if it changed the row, the access row only if the audit row exists, and the
    // row as it now is.
    const auditId = uuidv7();
    const stmts = [
      ...(c.var.touch ? [c.var.touch] : []),
      bound(db, SELF_UPDATE_SQL, [s.clientId, s.contactId, name, storedPhone(phone), now, expectedUpdatedAt]),
      auditStmt(
        db,
        {
          ...requestInfo(c),
          id: auditId,
          actorType: "contact",
          actorId: s.contactId,
          role: null,
          action: "contact.self_update",
          entityType: "contact",
          entityId: s.contactId,
          // Field names only, never the values (NFR-6).
          summary: { fields: ["name", "phone"] },
        },
        "changes",
      ),
      accessStmt(db, accessEntry(c, 200), { auditId }),
      bound(db, ME_SQL, [s.clientId, s.contactId]),
    ];
    const results = await db.batch(stmts);
    const updated = results[c.var.touch ? 1 : 0]?.meta.changes === 1;
    if (!updated) return err(c, STALE_VERSION, 409);
    c.set("accessDone", true);
    const m = results[results.length - 1]?.results[0] as MeRow | undefined;
    return c.json({
      me: m
        ? { name: m.name, email: m.email, phone: m.phone, title: m.title, updatedAt: m.updated_at }
        : null,
    });
  });
