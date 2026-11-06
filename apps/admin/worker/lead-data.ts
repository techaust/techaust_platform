// A lead's data rights (M7.4 C.8; ADM-CLI-05, FRM-05, ADM-SET-09; run file docs/runs/m7.4-data-protection.md C.8, L20–L22, L24, L37, L44), in the admin API:
//   POST /leads/:id/export             the person's own data, in parts (`leads.dataExport`: Owner, step-up): the summary (the lead and its parts), then
//                                      pages of 50 of `lead_activities`, `email_log` (by the lead's address) and `consent_receipts`; one audit row per call
//                                      (ids and counts only). L31: the summary says a keyed form of the address is kept after an erasure, until when.
//   POST /leads/:id/erase {reason}     erases EVERY unconverted lead with this lead's address (lower-cased) in one batch (`leads.dataErase`: Owner, step-up):
//                                      one `lead.erase` audit row per lead, their bells and their requests' bells, the keyed hash set on each (the triggers write
//                                      the `h:` stop when no other live record holds the address, L20, and stamp and end the consent receipts, L30), then the
//                                      DELETE. 409 `lead_converted` (use the contact's erase), `legal_hold` (any of them held: the hold is read in the batch's
//                                      first row, so `leads_held_no_erase` never surfaces, N4), `too_many_leads` (more than 50, with the refs).
//   POST /leads/:id/consent/withdraw   the lead's consent withdrawn (`leads.write`): the stored consent gains `withdrawnAt` and one `withdraw` receipt with the
//                                      keyed hash of the address is appended, in one batch. 409 `anonymised` for a lead already marked erased or holding
//                                      the anonymise placeholder address, in the read and in the UPDATE's WHERE (review 1 medium 1).
// Researched 2026-10-29, DPDP s.8(7), s.12(3) (08-C RB-37) for the erasure; the keyed hash kept after it: Settled by the lead on the safest reading, 2026-11-06
// (08-C RB-46); the consent receipt: Researched 2026-10-28, DPDP Act s.6, s.6(10) (08-C RB-28).
import { withdrawalOf } from "@techaust/core/consent";
import { leadEraseBody } from "@techaust/core/dp-schemas";
import { uuidv7 } from "@techaust/core/ids";
import { INSERT_RECEIPT_GUARDED_SQL, LEAD_WITH_ADDRESS_SQL } from "@techaust/db/consent";
import { Hono } from "hono/tiny";
import * as z from "zod/mini";
import { auditFirstRow } from "./audit-row.ts";
import { type ApiError, type AppEnv, actor, BAD_REQUEST, err, mutate, NOT_FOUND } from "./context.ts";
import { erasureHash } from "./erasure-key.ts";
import { body, idParam, param } from "./http.ts";
import { decodeCursor, encodeCursor } from "./keyset.ts";

/**
 * L31 (RB-46): how long a keyed form of the address outlives an erasure (the consent proof's figure, `consentProofMonths`, at least 12, default 36), for the
 * export's line. `?` none.
 */
export const KEYED_FORM_MONTHS_SQL =
  "SELECT json_extract(value, '$.consentProofMonths') AS m FROM settings WHERE key = 'retention'";
export const keyedFormMonthsOf = (row: Record<string, unknown> | undefined): number => {
  const m = row?.m;
  return typeof m === "number" && Number.isSafeInteger(m) && m >= 12 ? m : 36;
};

/** The most leads one erase takes (one person rarely has more than a handful; the batch stays one bounded write). */
export const MAX_ERASED_LEADS = 50;

export const LEAD_CONVERTED: ApiError = {
  code: "lead_converted",
  message: "This lead became a client. Erase or anonymise its contact instead",
};
const LEGAL_HOLD: ApiError = {
  code: "legal_hold",
  message: "A legal hold stands on this person. Lift it before erasing",
};
const TOO_MANY_LEADS: ApiError = {
  code: "too_many_leads",
  message: "This person has too many enquiries to erase at once",
};
const NOTHING_TO_WITHDRAW: ApiError = {
  code: "nothing_to_withdraw",
  message: "This lead has no consent to withdraw",
};
const STALE: ApiError = { code: "stale_version", message: "This lead changed. Reload and try again" };
/**
 * Review 1 medium 1: a lead already marked erased, or one an anonymise gave the placeholder address, takes no consent change: its receipts carry the real
 * address's keyed hash already, and a receipt keyed on the placeholder would be a record never deleted.
 */
const LEAD_ANONYMISED: ApiError = {
  code: "anonymised",
  message: "This lead's personal details were removed",
};
/** The placeholder address an anonymise gives (core `anonymisedEmail`), read as `LEAD_WITH_ADDRESS_SQL` reads it (`GLOB 'anonymised+*@invalid'`). */
const isPlaceholderAddress = (email: string): boolean =>
  /^anonymised\+.*@invalid$/s.test(email.toLowerCase());

const exportRequest = z.strictObject({
  part: z.optional(z.enum(["lead_activities", "email_log", "consent_receipts"])),
  after: z.optional(z.string().check(z.maxLength(400))),
});

/** The lead and every unconverted lead with its address (L37: one read before the batch). `?1` the lead. */
export const LEAD_ERASE_READ_SQL = `SELECT l.id, l.ref, l.client_id, l.legal_hold, lower(l.contact_email) AS email,
     (SELECT json_group_array(json_object('id', o.id, 'ref', o.ref, 'held', o.legal_hold)) FROM (SELECT o.id, o.ref, o.legal_hold FROM leads o
        WHERE lower(o.contact_email) = lower(l.contact_email) AND o.client_id IS NULL ORDER BY o.id LIMIT ${MAX_ERASED_LEADS + 1}) o) AS same
   FROM leads l WHERE l.id = ?1`;

/**
 * The batch's first row (`?7` the lead, `?8` the address, `?9` the ids read as JSON, `?10` how many, `?11` the reason): written only while this lead is
 * unconverted, the unconverted leads of the address are exactly the ones read, and none of them is held. Every later statement is guarded on it.
 */
const ERASE_AUDIT_FROM = `FROM leads l WHERE l.id = ?7 AND l.client_id IS NULL
     AND (SELECT count(*) FROM leads o WHERE lower(o.contact_email) = ?8 AND o.client_id IS NULL) = ?10
     AND NOT EXISTS (SELECT 1 FROM leads o WHERE lower(o.contact_email) = ?8 AND o.client_id IS NULL AND (o.legal_hold = 1 OR o.id NOT IN (SELECT value FROM json_each(?9))))`;

/** Statements after the first row; `?1` the ids as JSON. Exported so a test can count and EXPLAIN them. */
export const LEAD_ERASE_SQL = {
  /** One `lead.erase` row for every other lead (the first row is this lead's): ?2 who, ?3 role, ?4 ip, ?5 ua, ?6 request id, ?7 the reason, ?8 this lead. */
  audits: (g: string) =>
    `INSERT INTO audit_log (id, actor_type, actor_id, role, action, entity_type, entity_id, summary, ip, user_agent, request_id)
     SELECT lower(hex(randomblob(16))), 'staff', ?2, ?3, 'lead.erase', 'lead', l.id, json_object('ref', l.ref, 'reason', ?7, 'with', ?8), ?4, ?5, ?6
     FROM leads l WHERE l.id IN (SELECT value FROM json_each(?1)) AND l.id <> ?8 AND ${g}`,
  /** The bells about the leads and about their requests (M7.1 early check 2). */
  bells: (g: string) =>
    `DELETE FROM notifications WHERE ((entity_type = 'lead' AND entity_id IN (SELECT value FROM json_each(?1)))
       OR (entity_type = 'client_request' AND entity_id IN (SELECT r.id FROM client_requests r WHERE r.lead_id IN (SELECT value FROM json_each(?1))))) AND ${g}`,
  /** The keyed hash (`?2`), before the DELETE so the triggers fire (round 2 M7.4-1). */
  hash: (g: string) =>
    `UPDATE leads SET erased_hash = ?2 WHERE id IN (SELECT value FROM json_each(?1)) AND client_id IS NULL AND erased_hash IS NULL AND ${g}`,
  delete: (g: string) =>
    `DELETE FROM leads WHERE id IN (SELECT value FROM json_each(?1)) AND client_id IS NULL AND ${g}`,
} as const;

/** The parts of a lead's export: `?1` the lead, `?2` its lower-cased address; a cursor adds `?3`, `?4`. Each pages 50. */
const EXPORT_PARTS = {
  lead_activities: (cur: boolean) =>
    `SELECT id, kind, body, actor_id, created_at AS at FROM lead_activities WHERE lead_id = ?1${cur ? " AND (created_at, id) > (?3, ?4)" : ""} ORDER BY created_at, id LIMIT 51`,
  email_log: (cur: boolean) =>
    `SELECT id, to_email, template, entity_type, entity_id, status, created_at AS at FROM email_log WHERE to_email = ?2${cur ? " AND (created_at, id) > (?3, ?4)" : ""} ORDER BY created_at, id LIMIT 51`,
  consent_receipts: (cur: boolean) =>
    `SELECT id, event, source, notice_version, purposes, marketing, at FROM consent_receipts WHERE lead_id = ?1${cur ? " AND (at, id) > (?3, ?4)" : ""} ORDER BY at, id LIMIT 51`,
} as const;

type LeadExportRow = Record<string, unknown> & { contact_email: string; client_id: string | null };

export const leadData = new Hono<AppEnv>()
  .post("/:id/export", param(idParam), body(exportRequest), async (c) => {
    const { id } = c.req.valid("param");
    const f = c.req.valid("json");
    const db = c.env.DB;
    const lead = await db.prepare("SELECT * FROM leads WHERE id = ?1").bind(id).first<LeadExportRow>();
    if (!lead) return err(c, NOT_FOUND, 404);
    const email = lead.contact_email.trim().toLowerCase();
    let out: Record<string, unknown>;
    let rows: number;
    if (!f.part) {
      // L31: a keyed form of the address outlives an erasure until the consent proof's cut-off (owner policy, 3 years by default).
      const keep = await db.prepare(KEYED_FORM_MONTHS_SQL).first<Record<string, unknown>>();
      const { erased_hash: _hash, ...plain } = lead;
      out = {
        lead: plain,
        manifest: Object.keys(EXPORT_PARTS),
        keyedFormMonths: keyedFormMonthsOf(keep ?? undefined),
      };
      rows = 1;
    } else {
      const cur = f.after === undefined ? null : decodeCursor(f.after);
      if (f.after !== undefined && !cur) return err(c, BAD_REQUEST, 400);
      const sql = EXPORT_PARTS[f.part](cur !== null);
      // Bind exactly as many values as the statement has parameters (D1 refuses extra ones).
      const params = Math.max(...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
      const { results } = await db
        .prepare(sql)
        .bind(...[id, email, ...(cur ? [cur.k, cur.id] : [])].slice(0, params))
        .all<Record<string, unknown>>();
      const more = results.length > 50;
      const items = more ? results.slice(0, 50) : results;
      const last = items.at(-1);
      out = {
        part: f.part,
        items,
        next: more && last ? encodeCursor({ k: last.at as number, id: String(last.id) }) : null,
      };
      rows = items.length;
    }
    // The audit row is written before anything leaves; ids and counts only.
    await mutate(c, {
      action: "lead.export",
      entityType: "lead",
      entityId: id,
      summary: { ref: lead.ref, part: f.part ?? "summary", rows },
    });
    return c.json(out);
  })

  .post("/:id/erase", param(idParam), body(leadEraseBody), async (c) => {
    const { id } = c.req.valid("param");
    const { reason } = c.req.valid("json");
    const db = c.env.DB;
    const read = await db.prepare(LEAD_ERASE_READ_SQL).bind(id).first<{
      id: string;
      ref: string;
      client_id: string | null;
      legal_hold: number;
      email: string;
      same: string;
    }>();
    if (!read) return err(c, NOT_FOUND, 404);
    if (read.client_id !== null) return err(c, LEAD_CONVERTED, 409);
    const same = JSON.parse(read.same) as { id: string; ref: string; held: number }[];
    if (same.some((l) => l.held === 1)) return err(c, LEGAL_HOLD, 409);
    if (same.length > MAX_ERASED_LEADS)
      return err(c, TOO_MANY_LEADS, 409, { refs: same.slice(0, MAX_ERASED_LEADS).map((l) => l.ref) });
    const ids = JSON.stringify(same.map((l) => l.id));
    const hash = await erasureHash(c.env, read.email);
    let done: boolean;
    try {
      done = await mutate(c, {
        action: "lead.erase",
        entityType: "lead",
        entityId: id,
        auditFirst: (auditId, who) =>
          auditFirstRow(db, auditId, who, {
            action: "lead.erase",
            entityType: "lead",
            entityExpr: "l.id",
            // References only (the ref, the reason code, how many leads went), never the address.
            summaryExpr: "json_object('ref', l.ref, 'reason', ?11, 'leads', ?10)",
            from: ERASE_AUDIT_FROM,
            params: [id, read.email, ids, same.length, reason],
          }),
        after: (g) => {
          const u = actor(c);
          return [
            db
              .prepare(LEAD_ERASE_SQL.audits(g.sql(9)))
              .bind(ids, u.id, u.role, c.var.ip, c.var.ua, c.var.rid, reason, id, ...g.params),
            db.prepare(LEAD_ERASE_SQL.bells(g.sql(2))).bind(ids, ...g.params),
            db.prepare(LEAD_ERASE_SQL.hash(g.sql(3))).bind(ids, hash, ...g.params),
            db.prepare(LEAD_ERASE_SQL.delete(g.sql(2))).bind(ids, ...g.params),
          ];
        },
      });
    } catch (e) {
      // The first row reads the holds in the same batch (N4); a hold set between that row and the update would be refused by the triggers instead.
      if (e instanceof Error && /leads_held_no_erase|leads_held_no_delete/.test(e.message))
        return err(c, LEGAL_HOLD, 409);
      throw e;
    }
    if (!done) {
      const again = await db
        .prepare("SELECT client_id, legal_hold FROM leads WHERE id = ?1")
        .bind(id)
        .first<{ client_id: string | null; legal_hold: number }>();
      if (!again) return err(c, NOT_FOUND, 404);
      if (again.client_id !== null) return err(c, LEAD_CONVERTED, 409);
      if (again.legal_hold === 1) return err(c, LEGAL_HOLD, 409);
      return err(c, STALE, 409);
    }
    return c.json({ ok: true, erased: same.map((l) => l.ref) });
  })

  .post("/:id/consent/withdraw", param(idParam), async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const lead = await db
      .prepare("SELECT id, ref, source, consent, contact_email, erased_hash FROM leads WHERE id = ?1")
      .bind(id)
      .first<{
        id: string;
        ref: string;
        source: string;
        consent: string | null;
        contact_email: string;
        erased_hash: string | null;
      }>();
    if (!lead) return err(c, NOT_FOUND, 404);
    if (lead.erased_hash !== null || isPlaceholderAddress(lead.contact_email))
      return err(c, LEAD_ANONYMISED, 409);
    const now = Date.now();
    const parsed = lead.consent === null ? null : (JSON.parse(lead.consent) as never);
    const w = withdrawalOf(
      { kind: "lead", id, source: lead.source === "web" ? "web" : "manual", consent: parsed },
      now,
      "staff",
    );
    if (!w) return err(c, NOTHING_TO_WITHDRAW, 409);
    // As jobs' `purgeLead`: a hash already set wins (unreachable after the refusal above; kept so the two paths read alike).
    const hash = lead.erased_hash ?? (await erasureHash(c.env, lead.contact_email));
    const r = w.receipt;
    const done = await mutate(c, {
      main: db
        .prepare(
          `UPDATE leads SET consent = ?2, updated_at = max(updated_at + 1, ?3) WHERE id = ?1 AND consent IS ?4 AND ${LEAD_WITH_ADDRESS_SQL("leads")}`,
        )
        .bind(id, JSON.stringify(w.consent), now, lead.consent),
      action: "lead.consent_withdraw",
      entityType: "lead",
      entityId: id,
      summary: { ref: lead.ref },
      side: (g) => [
        db
          .prepare(INSERT_RECEIPT_GUARDED_SQL(g.sql(12)))
          .bind(
            uuidv7(),
            hash,
            id,
            null,
            r.event,
            r.source,
            r.noticeVersion,
            JSON.stringify(r.purposes),
            r.marketing ? 1 : 0,
            r.ipHash,
            r.at,
            ...g.params,
          ),
      ],
    });
    if (!done) {
      // Erased or anonymised between the read and the batch: say so; else the lead changed.
      const again = await db
        .prepare(`SELECT ${LEAD_WITH_ADDRESS_SQL("leads")} AS own FROM leads WHERE id = ?1`)
        .bind(id)
        .first<{ own: number }>();
      if (!again) return err(c, NOT_FOUND, 404);
      if (again.own !== 1) return err(c, LEAD_ANONYMISED, 409);
      return err(c, STALE, 409);
    }
    return c.json({ ok: true, withdrawnAt: now });
  });
