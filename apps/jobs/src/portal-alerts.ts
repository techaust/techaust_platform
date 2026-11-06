// The staff bells of the full portal (M7.1; POR-09, POR-11, ADM-PAY-05; run file D, L9, L16). Portal SQL never names a `staff_` table, so after a request
// (`portal.request`) or an "I've paid" notice (`payment.notice`) the portal puts only `{ kind: "portal.alert", auditId }` on the email queue. This consumer, in
// ONE unit of work: reads the audit row and the request or notice it names, with its client, contact and document, in ONE batch -> works out who is told ->
// writes the bells in ONE statement -> ack. Idempotent: a bell is unique per (member, kind, entity) (`notifications_user_event`) and written with INSERT OR
// IGNORE, so a redelivered alert writes nothing new. No email in M7.1 (L16). Who is told: a request -> the active Owners, and the active Staff too for a
// contact change (`STAFF_BELL_KINDS`); a notice -> the active Owners and Staff. A row that is not a contact's portal request or notice is refused (logged).
//
// Staff lines (lead's delegation, run file H): S3, drafted here for the lead, `{name} at {client} sent a request: {kind}` and
// `{client} says they paid {amount} for {number}`; the kind words below are part of S3.
import { ANONYMISED_CLIENT } from "@techaust/core/clients";
import { offerViewedTitle } from "@techaust/core/copy-zq";
import { APPROVED_07ZR, NEW_KIND_BELL_WORDS, REQUEST_KIND_LABELS, RULE9_BLOCK } from "@techaust/core/copy-zr";
import { formatDate, istDate } from "@techaust/core/dates";
import { formatMoney, money } from "@techaust/core/money";
import { staffNotify } from "@techaust/core/notifications";
import {
  isPortalAlertMessage,
  OFFER_VIEW_ACTION,
  PORTAL_ALERT_ACTIONS,
  type PortalAlertAction,
  type RequestKind,
  staffBelled,
} from "@techaust/core/portal";
import { logEvent } from "./log.ts";

export type PortalAlertResult = "belled" | "missing" | "ignored" | "invalid";

/**
 * M7.2 (E, Q2 A): ?1 the audit id. The proposal or estimate a contact's first view names (the portal's `document.view` row), never another document type.
 */
export const OFFER_OF_AUDIT_SQL = `SELECT d.id, d.number_display FROM documents d
   WHERE d.id = (SELECT a.entity_id FROM audit_log a WHERE a.id = ?1 AND a.action = 'document.view' AND a.entity_type = 'document' AND a.actor_type = 'contact')
     AND d.type IN ('proposal', 'estimate')`;
/**
 * ?1 the document, ?2 the title, ?3 the link. `offer.viewed` for every active Owner and the active member who sent this version (`document_sends.created_by`,
 * index `document_sends_document`); once per member (`notifications_user_event`).
 */
export const OFFER_VIEW_BELLS_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
   SELECT 'n_' || lower(hex(randomblob(16))), u.id, 'offer.viewed', 'document', ?1, ?2, ?3 FROM staff_users u
   WHERE u.status = 'active' AND (u.role = 'owner' OR u.id IN (SELECT s.created_by FROM document_sends s WHERE s.document_id = ?1))`;

/** S3 (draft for the lead): the kind of a request as a bell names it. */
export const REQUEST_KIND_WORDS: Record<RequestKind | keyof typeof NEW_KIND_BELL_WORDS, string> = {
  contact_change: "change to a person's portal access",
  data_access: "copy of their personal data",
  data_correction: "correction of their personal data",
  data_erasure: "erasure of their personal data",
  grievance: "concern about how we handle their data",
  // M7.4 (L9): the two new kinds (builder's drafts for the lead, 07-ZR).
  ...NEW_KIND_BELL_WORDS,
};

/**
 * M7.4 (D.8, L32): the acknowledgement email is queued only while 07-ZR's client lines are approved, or locally (the M6.5 receipt gate's pattern): no
 * "[Placeholder]" line ever leaves "local", and no request is marked acknowledged by an email that wasn't sent.
 */
export const requestCopyGate = { approved: (): boolean => APPROVED_07ZR };

/** ?1 the request, ?2 now: acknowledged once, when its email is queued (L32), never before it arrived (the trigger `client_requests_steps` holds the same). */
export const REQUEST_ACK_SQL =
  "UPDATE client_requests SET acknowledged_at = max(?2, received_at), updated_at = max(updated_at, ?2) WHERE id = ?1 AND status = 'open' AND acknowledged_at IS NULL";

type AuditRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_type: string;
};
type RequestRow = {
  id: string;
  kind: string;
  client_id: string;
  client_name: string;
  client_gone: number;
  contact_name: string | null;
  /** M7.4: the live contact's address (the acknowledgement's recipient), and the clock. */
  contact_email?: string | null;
  received_at?: number | null;
  due_at?: number | null;
  acknowledged_at?: number | null;
};
type NoticeRow = {
  id: string;
  amount_minor: number;
  currency: string;
  client_name: string;
  client_gone: number;
  number_display: string | null;
};

/** ?1 the audit id. The request the row names, only when the row is a portal request. */
export const REQUEST_OF_AUDIT_SQL = `SELECT r.id, r.kind, r.client_id, k.display_name AS client_name, (k.anonymised_at IS NOT NULL) AS client_gone, c.name AS contact_name,
     c.email AS contact_email, r.received_at, r.due_at, r.acknowledged_at
   FROM client_requests r JOIN clients k ON k.id = r.client_id LEFT JOIN contacts c ON c.id = r.contact_id AND c.anonymised_at IS NULL
   WHERE r.id = (SELECT a.entity_id FROM audit_log a WHERE a.id = ?1 AND a.action = 'portal.request' AND a.entity_type = 'client_request')`;
/** ?1 the audit id. The notice the row names, only when the row is a payment notice. */
export const NOTICE_OF_AUDIT_SQL = `SELECT n.id, n.amount_minor, n.currency, k.display_name AS client_name, (k.anonymised_at IS NOT NULL) AS client_gone, d.number_display
   FROM payment_notices n JOIN clients k ON k.id = n.client_id JOIN documents d ON d.id = n.document_id
   WHERE n.id = (SELECT a.entity_id FROM audit_log a WHERE a.id = ?1 AND a.action = 'payment.notice' AND a.entity_type = 'payment_notice')`;
/**
 * ?1 kind, ?2 entity type, ?3 entity id, ?4 title, ?5 link, ?6 1 when Staff are told too. One bell per active Owner (and Staff), never twice
 * (`notifications_user_event`).
 */
export const BELLS_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
   SELECT 'n_' || lower(hex(randomblob(16))), o.id, ?1, ?2, ?3, ?4, ?5 FROM staff_users o
   WHERE o.status = 'active' AND (o.role = 'owner' OR (?6 = 1 AND o.role = 'staff'))`;

export type PortalBell = {
  kind: PortalAlertAction;
  entityType: "client_request" | "payment_notice";
  entityId: string;
  title: string;
  link: string;
  staffToo: boolean;
};

/** The bell of a request (S3). A contact who was erased or anonymised is "A contact"; an anonymised client is named as such everywhere. */
export function requestBellOf(r: RequestRow): PortalBell {
  const client = r.client_gone === 1 ? ANONYMISED_CLIENT : r.client_name;
  const kind = REQUEST_KIND_WORDS[r.kind as RequestKind] ?? "request";
  return {
    kind: "portal.request",
    entityType: "client_request",
    entityId: r.id,
    title: `${r.contact_name ?? "A contact"} at ${client} sent a request: ${kind}`,
    link: `/clients/${r.client_id}?tab=requests`,
    staffToo: staffBelled(r.kind),
  };
}

/** The bell of an "I've paid" notice (S3): the client, the amount it says it paid and the document's number. */
export function noticeBellOf(n: NoticeRow): PortalBell {
  const client = n.client_gone === 1 ? ANONYMISED_CLIENT : n.client_name;
  const amount = formatMoney(money(n.amount_minor, n.currency === "USD" ? "USD" : "INR"));
  return {
    kind: "payment.notice",
    entityType: "payment_notice",
    entityId: n.id,
    title: `${client} says they paid ${amount} for ${n.number_display ?? "a document"}`,
    link: "/payments?tab=notices",
    staffToo: true,
  };
}

export async function processPortalAlert(env: Env, body: unknown): Promise<PortalAlertResult> {
  if (!isPortalAlertMessage(body)) {
    logEvent("portal_alert.invalid_message");
    return "invalid";
  }
  const db = env.DB;
  const [auditR, requestR, noticeR, offerR] = await db.batch([
    db
      .prepare("SELECT id, action, entity_type, entity_id, actor_type FROM audit_log WHERE id = ?1")
      .bind(body.auditId),
    db.prepare(REQUEST_OF_AUDIT_SQL).bind(body.auditId),
    db.prepare(NOTICE_OF_AUDIT_SQL).bind(body.auditId),
    db.prepare(OFFER_OF_AUDIT_SQL).bind(body.auditId),
  ]);
  const row = auditR?.results[0] as AuditRow | undefined;
  if (!row) {
    logEvent("portal_alert.missing"); // acked: a row that is not there now will not be there on a retry either
    return "missing";
  }
  if (row.action === OFFER_VIEW_ACTION && row.actor_type === "contact") {
    // M7.2 (E, Q2 A, S7): the bell named by the document's number, else "Untitled" (13 2026-10-26), then its emails by the members' switches (off by default).
    const offer = offerR?.results[0] as { id: string; number_display: string | null } | undefined;
    if (!offer) {
      logEvent("portal_alert.ignored", { why: "no_offer" });
      return "ignored";
    }
    await db
      .prepare(OFFER_VIEW_BELLS_SQL)
      .bind(offer.id, offerViewedTitle(offer.number_display), `/documents/${offer.id}`)
      .run();
    await env.EMAIL_QUEUE.send(staffNotify("offer.viewed", offer.id));
    return "belled";
  }
  if (!(PORTAL_ALERT_ACTIONS as readonly string[]).includes(row.action) || row.actor_type !== "contact") {
    logEvent("portal_alert.ignored", { why: "not_portal" });
    return "ignored";
  }
  const request = requestR?.results[0] as RequestRow | undefined;
  const notice = noticeR?.results[0] as NoticeRow | undefined;
  const bell = request ? requestBellOf(request) : notice ? noticeBellOf(notice) : null;
  if (!bell) {
    logEvent("portal_alert.ignored", { why: "no_entity" });
    return "ignored";
  }
  const bells = db
    .prepare(BELLS_SQL)
    .bind(bell.kind, bell.entityType, bell.entityId, bell.title, bell.link, bell.staffToo ? 1 : 0);
  // M7.4 (D.8, L32): a portal request is acknowledged by email to the contact who sent it (C2 to C4 and the Rule 9 block), queued first (its `email_log`
  // claim is keyed on the request and the address, so a redelivery sends nothing twice), then `acknowledged_at` is set in the bells' batch.
  const ack =
    request?.contact_email &&
    request.client_gone !== 1 &&
    request.acknowledged_at == null &&
    typeof request.received_at === "number" &&
    typeof request.due_at === "number" &&
    (requestCopyGate.approved() || (env.ENVIRONMENT as string) === "local");
  if (ack && request) {
    await env.EMAIL_QUEUE.send({
      template: "request.received",
      to: request.contact_email as string,
      data: {
        kind_label: REQUEST_KIND_LABELS[request.kind] ?? request.kind,
        date: formatDate(istDate(request.received_at as number)),
        due_date: formatDate(istDate(request.due_at as number)),
        rule9: RULE9_BLOCK(null),
      },
      entity: { type: "client_request", id: request.id },
    });
    await db.batch([bells, db.prepare(REQUEST_ACK_SQL).bind(request.id, Date.now())]);
  } else await bells.run();
  return "belled";
}

/** Start-up warm-up: one bell of each kind on made-up rows (the money formatter's first run). Returns 2. Never throws. */
export function warmPortalAlerts(): number {
  try {
    requestBellOf({
      id: "warm",
      kind: "data_access",
      client_id: "warm",
      client_name: "Warm",
      client_gone: 0,
      contact_name: "Warm Up",
    });
    noticeBellOf({
      id: "warm",
      amount_minor: 100,
      currency: "INR",
      client_name: "Warm",
      client_gone: 0,
      number_display: "TH/INV/2627/0001",
    });
    return 2;
  } catch {
    return 0;
  }
}
