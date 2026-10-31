// T7 (08-C RB-37(a); Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37)): when a contact is ANONYMISED, the frozen copy of every proposal or
// estimate that was never accepted and names them loses their personal details; the number, status, dates, amounts and hashes stay, and the envelope and
// the PDF are deleted. Accepted offers and every invoice-family document are never touched (financial records, 08-C RB-37(b)).
//
// How it is written (no read-then-write race): D1 has no regular expressions, so the Worker reads the offers ONCE (one batch), works the redacted values
// out with core's one rule (`@techaust/core/redaction`), and adds a fixed number of statements to the anonymise batch (`UPDATE ... FROM json_each(?plan)`,
// whatever the number of offers). The batch's audit-first row is written only while the eligible set, each offer's `redacted_at`, the contact's `updated_at`,
// the last-live state and (client scope) the client's `updated_at` are what was read (`redactionGuard`), and every statement here is guarded on that row; a
// mismatch writes nothing and the route reads again once. An offer already redacted for another person is redacted again (its `redacted_at` moves forward,
// never back). Audit rows hold ids, counts and field NAMES only.

import { uuidv7 } from "@techaust/core/ids";
import { fyLabelOfToken, pdfKeys } from "@techaust/core/pdf-jobs";
import {
  type OfferText,
  offerScope,
  type Redact,
  redactionValues,
  redactOffer,
  redactor,
} from "@techaust/core/redaction";
import type { RecipientSnapshot } from "@techaust/db/issue";
import type { GuardSql } from "@techaust/db/log";
import { LAST_LIVE_SQL, MAX_REDACTED_OFFERS, REDACTABLE_OFFER_SQL } from "@techaust/db/offer-redaction";
import type { ApiError } from "./context.ts";
import { dropObjects } from "./files.ts";

/** 07-ZG line 3 (owner-approved 2026-10-31). */
export const TOO_MANY_OFFERS: ApiError = {
  code: "too_many_offers",
  message:
    "This person is named on more than 10 offers, so they can't be anonymised in one go. Nothing was changed. Ask your developer to anonymise them in parts.",
};

const ELIGIBLE = REDACTABLE_OFFER_SQL("d", "c", "cl");
const FROM_CONTACT = "FROM contacts c JOIN clients cl ON cl.id = c.client_id";
/** The ids of the eligible offers of contact `?1` (at most one more than the cap, so the cap can be told apart). */
const OFFER_IDS = `SELECT d.id ${FROM_CONTACT} JOIN documents d ON ${ELIGIBLE} WHERE c.id = ?1 ORDER BY d.id LIMIT ${MAX_REDACTED_OFFERS + 1}`;

/** The read before the batch, one statement per part (exported so a test can EXPLAIN each one). `?1` the contact. */
export const REDACTION_READ_SQL = {
  head: `SELECT c.id, c.name, c.email, c.phone, c.updated_at AS contact_updated_at, c.anonymised_at, cl.type AS client_type, cl.legal_name, cl.display_name, cl.gstin, cl.updated_at AS client_updated_at, (cl.type = 'individual' AND ${LAST_LIVE_SQL("c")}) AS last_live ${FROM_CONTACT} WHERE c.id = ?1`,
  offers: `SELECT d.id, d.type, d.fy, d.number, d.version, d.recipient, d.title, d.decision_note, d.contact_id, d.snapshot_r2_key, d.pdf_r2_key, d.redacted_at ${FROM_CONTACT} JOIN documents d ON ${ELIGIBLE} WHERE c.id = ?1 ORDER BY d.id LIMIT ${MAX_REDACTED_OFFERS + 1}`,
  sections: `SELECT id, document_id, title, body_md FROM document_sections WHERE document_id IN (${OFFER_IDS})`,
  lines: `SELECT id, document_id, description, detail FROM document_lines WHERE document_id IN (${OFFER_IDS})`,
  schedule: `SELECT id, document_id, label, detail FROM payment_schedules WHERE document_id IN (${OFFER_IDS})`,
} as const;

type Head = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  contact_updated_at: number;
  anonymised_at: number | null;
  client_type: string;
  legal_name: string | null;
  display_name: string | null;
  gstin: string | null;
  client_updated_at: number;
  last_live: number;
};
type OfferRow = {
  id: string;
  type: string;
  fy: string | null;
  number: number | null;
  version: number;
  recipient: string | null;
  title: string | null;
  decision_note: string | null;
  contact_id: string | null;
  snapshot_r2_key: string | null;
  pdf_r2_key: string | null;
  redacted_at: number | null;
};
type Child = { id: string; document_id: string };

/** What the read found and what the batch writes. */
export type RedactionPlan = {
  /** The contact as read (null: no such contact). */
  head: Head | null;
  /** More offers than the cap: 409 `too_many_offers`, nothing is written. */
  tooMany: boolean;
  /** The eligible ids as read (the guard proves the batch sees the same set). */
  ids: string[];
  /** `[[id, redacted_at as read], ...]`: the guard proves no offer was redacted again between the read and the batch (its text would be stale). */
  stamps: string;
  /** The earliest time this redaction may be stamped with: one past the newest `redacted_at` read (it only moves forward), else 0. */
  after: number;
  /** `[{id, a (audit id), r? (new recipient), t? (new title), f (field names)}]`. */
  docs: string;
  sections: string;
  lines: string;
  schedule: string;
  /** The R2 objects to delete after the batch (envelope and PDF of each offer, derived and stored keys). */
  keys: string[];
};

/** Reads the contact and its eligible offers with their text in ONE batch, and works out what the anonymise batch writes. */
export async function readRedactionPlan(db: D1Database, contactId: string): Promise<RedactionPlan> {
  const q = REDACTION_READ_SQL;
  const [h, o, s, l, p] = await db.batch([
    db.prepare(q.head).bind(contactId),
    db.prepare(q.offers).bind(contactId),
    db.prepare(q.sections).bind(contactId),
    db.prepare(q.lines).bind(contactId),
    db.prepare(q.schedule).bind(contactId),
  ]);
  const head = (h?.results[0] as Head | undefined) ?? null;
  const offers = (o?.results ?? []) as OfferRow[];
  const empty = {
    head,
    tooMany: false,
    ids: [],
    stamps: "[]",
    after: 0,
    docs: "[]",
    sections: "[]",
    lines: "[]",
    schedule: "[]",
    keys: [],
  };
  if (!head) return empty;
  if (offers.length > MAX_REDACTED_OFFERS) return { ...empty, tooMany: true };
  const byDoc = <T extends Child>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(r.document_id);
      if (list) list.push(r);
      else m.set(r.document_id, [r]);
    }
    return m;
  };
  const sections = byDoc((s?.results ?? []) as (Child & { title: string | null; body_md: string | null })[]);
  const lines = byDoc((l?.results ?? []) as (Child & { description: string; detail: string | null })[]);
  const schedule = byDoc((p?.results ?? []) as (Child & { label: string; detail: string | null })[]);
  const contact = { id: head.id, name: head.name, email: head.email, phone: head.phone };
  const client = { legalName: head.legal_name, displayName: head.display_name, gstin: head.gstin };
  const docs: unknown[] = [];
  const sectionRows: unknown[] = [];
  const lineRows: unknown[] = [];
  const scheduleRows: unknown[] = [];
  const keys = new Set<string>();
  // One compiled pattern per distinct value list (most offers of one person share it); per request only, never kept across requests (it holds names).
  const compiled = new Map<string, Redact>();
  const redactorOf = (values: string[]) => {
    const key = values.join("\u0000");
    let r = compiled.get(key);
    if (!r) {
      r = redactor(values);
      compiled.set(key, r);
    }
    return r;
  };
  for (const d of offers) {
    const recipient = d.recipient === null ? null : (JSON.parse(d.recipient) as RecipientSnapshot);
    const scope = offerScope({
      lastLiveIndividual: head.last_live === 1,
      recipient,
      documentContactId: d.contact_id,
      contact,
    });
    const values = redactionValues({ recipient, contact, client, scope });
    const text: OfferText<RecipientSnapshot> = {
      recipient,
      title: d.title,
      decisionNote: d.decision_note,
      sections: (sections.get(d.id) ?? []).map((x) => ({ id: x.id, title: x.title, bodyMd: x.body_md })),
      lines: (lines.get(d.id) ?? []).map((x) => ({ id: x.id, description: x.description, detail: x.detail })),
      schedule: (schedule.get(d.id) ?? []).map((x) => ({ id: x.id, label: x.label, detail: x.detail })),
    };
    // T7 finding 2 (Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37)): at an individual client the recipient's own names are the person's
    // name, so contact scope takes their values out of them too (the frozen client type, else the live one).
    const out = redactOffer(text, values, scope, {
      individual: (recipient?.clientType ?? head.client_type) === "individual",
      redact: redactorOf(values),
    });
    docs.push({
      id: d.id,
      a: uuidv7(),
      ...(out.recipient !== null && out.fields.some((f) => f.startsWith("recipient."))
        ? { r: out.recipient }
        : {}),
      ...(out.title !== d.title && out.title !== null ? { t: out.title } : {}),
      f: out.fields,
    });
    sectionRows.push(...out.sections);
    lineRows.push(...out.lines);
    scheduleRows.push(...out.schedule);
    const label = d.fy === null ? null : fyLabelOfToken(d.fy);
    if (label !== null && d.number !== null) {
      try {
        const k = pdfKeys({ type: d.type, fy: label, number: d.number, version: d.version });
        keys.add(k.snapshot);
        keys.add(k.pdf);
      } catch {
        // a key that cannot be derived; the stored keys below still go
      }
    }
    if (d.snapshot_r2_key) keys.add(d.snapshot_r2_key);
    if (d.pdf_r2_key) keys.add(d.pdf_r2_key);
  }
  return {
    head,
    tooMany: false,
    ids: offers.map((d) => d.id),
    stamps: JSON.stringify(offers.map((d) => [d.id, d.redacted_at])),
    after: offers.reduce((m, d) => Math.max(m, (d.redacted_at ?? -1) + 1), 0),
    docs: JSON.stringify(docs),
    sections: JSON.stringify(sectionRows),
    lines: JSON.stringify(lineRows),
    schedule: JSON.stringify(scheduleRows),
    keys: [...keys],
  };
}

/**
 * The conditions the anonymise audit-first row adds (its FROM is `contacts c JOIN clients cl`; placeholders from `at`): the eligible set at batch time is
 * exactly the set read, no offer of it was redacted again since (its `redacted_at` is as read), the contact's `updated_at` and the last-live state are as
 * read, and in client scope the client's `updated_at` is too.
 */
export function redactionGuard(plan: RedactionPlan, at: number): { sql: string; params: unknown[] } {
  const head = plan.head as Head;
  return {
    sql: [
      `(SELECT count(*) FROM documents d WHERE ${ELIGIBLE}) = ?${at}`,
      `NOT EXISTS (SELECT 1 FROM documents d WHERE ${ELIGIBLE} AND d.id NOT IN (SELECT value FROM json_each(?${at + 1})))`,
      `c.updated_at = ?${at + 2}`,
      `(cl.type = 'individual' AND ${LAST_LIVE_SQL("c")}) = ?${at + 3}`,
      `(?${at + 3} = 0 OR cl.updated_at = ?${at + 4})`,
      `NOT EXISTS (SELECT 1 FROM json_each(?${at + 5}) j JOIN documents d ON d.id = json_extract(j.value, '$[0]') WHERE d.redacted_at IS NOT json_extract(j.value, '$[1]'))`,
    ].join(" AND "),
    params: [
      plan.ids.length,
      JSON.stringify(plan.ids),
      head.contact_updated_at,
      head.last_live,
      head.client_updated_at,
      plan.stamps,
    ],
  };
}

/** The plan's document ids, as a subquery over the bound plan `?1`. */
const PLAN_IDS = "(SELECT json_extract(value, '$.id') FROM json_each(?1))";

/** Step 2e's statements (exported so a test can EXPLAIN them). `?1` the plan (or the child rows), `?2` the time; the guard follows. */
export const REDACTION_WRITE_SQL = {
  /**
   * The offers: recipient and title as planned, the decision note cleared, `redacted_at` set or moved forward (`?2` is past every value read). The
   * eligibility is checked again (`?3` the contact).
   */
  documents: (g: string) =>
    `UPDATE documents SET recipient = CASE WHEN json_type(j.value, '$.r') = 'object' THEN json_extract(j.value, '$.r') ELSE documents.recipient END,
       title = CASE WHEN json_type(j.value, '$.t') = 'text' THEN json_extract(j.value, '$.t') ELSE documents.title END,
       decision_note = NULL, redacted_at = ?2, updated_at = max(documents.updated_at + 1, ?2)
     FROM json_each(?1) j
     WHERE documents.id = json_extract(j.value, '$.id') AND documents.redacted_at IS NOT ?2 AND EXISTS (SELECT 1 FROM contacts c JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?3 AND ${REDACTABLE_OFFER_SQL("documents", "c", "cl")}) AND ${g}`,
  /** One `document.redact` row per offer redacted in this batch (`?3` actor, `?4` role, `?5` contact, `?6` the anonymise audit id, `?7` ip, `?8` ua, `?9` request). */
  audit: (g: string) =>
    `INSERT INTO audit_log (id, actor_type, actor_id, role, action, entity_type, entity_id, summary, ip, user_agent, request_id)
     SELECT json_extract(j.value, '$.a'), 'staff', ?3, ?4, 'document.redact', 'document', d.id,
       json_object('documentId', d.id, 'version', d.version, 'contactId', ?5, 'eraseAuditId', ?6, 'fields', json(json_extract(j.value, '$.f')), 'snapshotSha12', substr(d.snapshot_sha256, 1, 12), 'pdfDeleted', 1),
       ?7, ?8, ?9
     FROM json_each(?1) j JOIN documents d ON d.id = json_extract(j.value, '$.id') WHERE d.redacted_at = ?2 AND ${g}`,
  sectionsText: (g: string) =>
    `UPDATE document_sections SET title = json_extract(j.value, '$.title'), body_md = json_extract(j.value, '$.bodyMd'), redacted_at = ?2
     FROM json_each(?1) j WHERE document_sections.id = json_extract(j.value, '$.id') AND document_sections.redacted_at IS NOT ?2 AND (SELECT redacted_at FROM documents WHERE id = document_sections.document_id) = ?2 AND ${g}`,
  linesText: (g: string) =>
    `UPDATE document_lines SET description = json_extract(j.value, '$.description'), detail = json_extract(j.value, '$.detail'), redacted_at = ?2
     FROM json_each(?1) j WHERE document_lines.id = json_extract(j.value, '$.id') AND document_lines.redacted_at IS NOT ?2 AND (SELECT redacted_at FROM documents WHERE id = document_lines.document_id) = ?2 AND ${g}`,
  scheduleText: (g: string) =>
    `UPDATE payment_schedules SET label = json_extract(j.value, '$.label'), detail = json_extract(j.value, '$.detail'), redacted_at = ?2
     FROM json_each(?1) j WHERE payment_schedules.id = json_extract(j.value, '$.id') AND payment_schedules.redacted_at IS NOT ?2 AND (SELECT redacted_at FROM documents WHERE id = payment_schedules.document_id) = ?2 AND ${g}`,
  /** The child rows whose text held nothing personal (this time) are marked too, so every row of a redacted offer carries its time (`?1` the plan). */
  mark: (table: "document_sections" | "document_lines" | "payment_schedules", g: string) =>
    `UPDATE ${table} SET redacted_at = ?2 WHERE document_id IN ${PLAN_IDS} AND redacted_at IS NOT ?2 AND (SELECT redacted_at FROM documents WHERE id = ${table}.document_id) = ?2 AND ${g}`,
  /** Q1 = A (owner, 2026-10-31): the offer is withdrawn for everyone: every send not yet holding a link is cancelled (the jobs Worker mints none then). */
  cancelSends: (g: string) =>
    `UPDATE document_sends SET cancelled_at = ?2 WHERE cancelled_at IS NULL AND document_id IN ${PLAN_IDS} AND NOT EXISTS (SELECT 1 FROM offer_links l WHERE l.send_id = document_sends.id) AND ${g}`,
  /** ... and when it is the newest frozen version of its group, every live link of the group is revoked (an older version's links stay with the newer one). */
  revokeLinks: (g: string) =>
    `UPDATE offer_links SET revoked_at = ?2 WHERE revoked_at IS NULL AND version_group_id IN (SELECT d.version_group_id FROM documents d WHERE d.id IN ${PLAN_IDS} AND NOT EXISTS (SELECT 1 FROM documents n WHERE n.version_group_id = d.version_group_id AND n.version > d.version AND n.frozen_at IS NOT NULL)) AND ${g}`,
  /** The bells about these offers and about their approvals go (a bell is not a record, and it names the document). */
  documentBells: (g: string) =>
    `DELETE FROM notifications WHERE entity_type = 'document' AND entity_id IN ${PLAN_IDS} AND ${g}`,
  approvalBells: (g: string) =>
    `DELETE FROM notifications WHERE entity_type = 'approval' AND entity_id IN (SELECT a.id FROM approvals a WHERE a.document_id IN ${PLAN_IDS}) AND ${g}`,
  /** The free text of their approvals (the requester's reason, the owner's note) can name the person; the approval rows stay. */
  approvals: (g: string) =>
    `UPDATE approvals SET reason = NULL, note = NULL WHERE document_id IN ${PLAN_IDS} AND (reason IS NOT NULL OR note IS NOT NULL) AND ${g}`,
} as const;

/** Step 2e of the anonymise batch: a fixed 13 statements, each guarded on the anonymise audit row (`g`). None when nothing is eligible. */
export function redactionStatements(
  db: D1Database,
  plan: RedactionPlan,
  g: GuardSql,
  ctx: {
    contactId: string;
    eraseAuditId: string;
    t: number;
    actor: { id: string; role: string };
    ip: string | null;
    ua: string | null;
    requestId: string | null;
  },
): D1PreparedStatement[] {
  if (plan.ids.length === 0) return [];
  const w = REDACTION_WRITE_SQL;
  // `redacted_at` only moves forward: past every value read (two erasures in the same millisecond, or a clock behind an earlier one).
  const t = Math.max(ctx.t, plan.after);
  const at2 = (sql: (g: string) => string, json: string) =>
    db.prepare(sql(g.sql(3))).bind(json, t, ...g.params);
  return [
    db.prepare(w.documents(g.sql(4))).bind(plan.docs, t, ctx.contactId, ...g.params),
    db
      .prepare(w.audit(g.sql(10)))
      .bind(
        plan.docs,
        t,
        ctx.actor.id,
        ctx.actor.role,
        ctx.contactId,
        ctx.eraseAuditId,
        ctx.ip,
        ctx.ua,
        ctx.requestId,
        ...g.params,
      ),
    at2(w.sectionsText, plan.sections),
    at2(w.linesText, plan.lines),
    at2(w.scheduleText, plan.schedule),
    at2((x) => w.mark("document_sections", x), plan.docs),
    at2((x) => w.mark("document_lines", x), plan.docs),
    at2((x) => w.mark("payment_schedules", x), plan.docs),
    at2(w.cancelSends, plan.docs),
    at2(w.revokeLinks, plan.docs),
    at2(w.documentBells, plan.docs),
    at2(w.approvalBells, plan.docs),
    at2(w.approvals, plan.docs),
  ];
}

/** After a successful batch: the envelope and PDF objects of the redacted offers are deleted (write-once `DOCS`; a failure is logged with keys only). */
export const dropOfferObjects = (env: Env, keys: string[]) => dropObjects(env.DOCS, keys, "offer redacted");
