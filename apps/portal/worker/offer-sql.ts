// The SQL of the portal's offer routes (M4.5; POR-04, POR-05, ADM-PROP-08, ADM-PROP-10). Every statement says `client_id = ?1`
// (the organisation, from the session or from a live offer link), reaches child tables only through a scoped parent, and decides
// nothing from an earlier read: each condition of an accept or a decline sits in the statement that writes. Placeholders are numbered.
// Researched 2026-10-28, BSA 2023 s.63(4) (08-C RB-19): accepting by a typed name and a ticked box, and the evidence recorded (docs/runs/m4.5-send-accept.md §4).
import { clipHeader } from "@techaust/db/log";

/** The statuses a client may see. A `converted` estimate is shown as accepted (lead decision, 2026-10-26: conversion is internal to TecHaust); drafts are never shown. */
export const CLIENT_STATUSES = [
  "sent",
  "viewed",
  "accepted",
  "converted",
  "rejected",
  "expired",
  "revised",
] as const;
const list = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(", ");
const STATUSES_SQL = list(CLIENT_STATUSES);
const QUOTES = "('proposal', 'estimate')";

/** There is no newer frozen version in the group (the latest one is the one a client may act on). */
const NEWEST =
  "NOT EXISTS (SELECT 1 FROM documents n WHERE n.version_group_id = d.version_group_id AND n.version > d.version AND n.frozen_at IS NOT NULL)";

/**
 * There is no newer RENDERED frozen version in the group. The list and the downloads use this one: while the next version is still being
 * rendered, the offer stays visible (and downloadable) on its latest rendered version instead of vanishing (M4.5 fix L5).
 */
const NEWEST_RENDERED =
  "NOT EXISTS (SELECT 1 FROM documents n WHERE n.version_group_id = d.version_group_id AND n.version > d.version AND n.frozen_at IS NOT NULL AND n.pdf_sha256 IS NOT NULL)";

/** ?1 client, ?2 now (cursor: sent_at), ?3 cursor id, ?4 limit. A page of the latest rendered version of each offer, newest first. */
export const LIST_SQL = `SELECT d.id, d.type, d.title, d.number_display, d.version, d.status, d.valid_until, d.total_minor, d.currency, d.decided_at, d.sent_at FROM documents d WHERE d.client_id = ?1 AND d.type IN ${QUOTES} AND d.frozen_at IS NOT NULL AND d.pdf_sha256 IS NOT NULL AND d.status IN (${STATUSES_SQL}) AND ${NEWEST_RENDERED} AND (?2 IS NULL OR d.sent_at < ?2 OR (d.sent_at = ?2 AND d.id < ?3)) ORDER BY d.sent_at DESC, d.id DESC LIMIT ?4`;

/** ?2 document id. The document of this organisation, as the portal may show it (a sent, rendered or decided offer). */
export const DOC_SQL = `SELECT d.id, d.type, d.status, d.version, d.title, d.number_display, d.valid_until, d.version_group_id, d.snapshot_r2_key, d.pdf_r2_key, d.pdf_sha256, d.decided_at, d.decision_reason, d.decision_note, dc.name AS decided_by FROM documents d LEFT JOIN contacts dc ON dc.id = d.decided_contact_id AND dc.client_id = d.client_id WHERE d.id = ?2 AND d.client_id = ?1 AND d.type IN ${QUOTES} AND d.frozen_at IS NOT NULL AND d.status IN (${STATUSES_SQL})`;

/** ?2 document id. The acceptance record (never the IP or the user agent: they are the owner's evidence). */
export const ACCEPTANCE_SQL =
  "SELECT a.typed_name, a.email, a.accepted_at, a.pdf_sha256, a.via FROM acceptances a JOIN documents d ON d.id = a.document_id WHERE d.client_id = ?1 AND a.document_id = ?2";

/** ?2 document id. Whether the certificate has been rendered. */
export const CERTIFICATE_SQL =
  "SELECT c.rendered_at FROM acceptance_certificates c JOIN acceptances a ON a.id = c.acceptance_id JOIN documents d ON d.id = a.document_id WHERE d.client_id = ?1 AND a.document_id = ?2";

/** ?2 document id. The newest frozen AND rendered version of the same offer (a version still being rendered cannot be shown yet). */
export const LATEST_SQL =
  "SELECT n.id, n.version FROM documents n WHERE n.client_id = ?1 AND n.version_group_id = (SELECT g.version_group_id FROM documents g WHERE g.id = ?2 AND g.client_id = ?1) AND n.frozen_at IS NOT NULL AND n.pdf_sha256 IS NOT NULL ORDER BY n.version DESC LIMIT 1";

/**
 * ?2 document id. The key a PDF download streams: the latest rendered version of the offer, or the accepted one (POR-05); an older, revised
 * version is a 404 (M4.5 fix L8).
 */
export const KEYS_SQL = `SELECT d.pdf_r2_key, d.number_display, d.version, d.status FROM documents d WHERE d.id = ?2 AND d.client_id = ?1 AND (?3 IS NULL OR d.version_group_id = ?3) AND d.type IN ${QUOTES} AND d.frozen_at IS NOT NULL AND d.status IN (${STATUSES_SQL}) AND (d.status IN ('accepted', 'converted') OR ${NEWEST_RENDERED})`;
/** ?2 document id. The certificate key of an accepted offer. */
export const CERT_KEY_SQL = `SELECT c.r2_key, d.number_display, d.version FROM acceptance_certificates c JOIN acceptances a ON a.id = c.acceptance_id JOIN documents d ON d.id = a.document_id WHERE d.client_id = ?1 AND a.document_id = ?2 AND (?3 IS NULL OR d.version_group_id = ?3) AND d.type IN ${QUOTES}`;
/** ?2 document id, ?3 the link's group (null on a session). Whether the offer has an acceptance (the certificate may be pending). */
export const HAS_ACCEPTANCE_SQL =
  "SELECT 1 AS yes FROM acceptances a JOIN documents d ON d.id = a.document_id WHERE d.client_id = ?1 AND a.document_id = ?2 AND (?3 IS NULL OR d.version_group_id = ?3)";

/** ?2 document id, ?3 the link's group (null on a session), ?4 the contact (the name a decline shows): the offer's group and version, before a decision (the lead rule needs the group). */
export const PRE_SQL = `SELECT d.version_group_id, d.version, (SELECT c.name FROM contacts c WHERE c.id = ?4 AND c.client_id = ?1) AS contact_name FROM documents d WHERE d.id = ?2 AND d.client_id = ?1 AND (?3 IS NULL OR d.version_group_id = ?3) AND d.type IN ${QUOTES} AND d.frozen_at IS NOT NULL`;

/**
 * The first view: sent becomes viewed, once. ?1 client, ?2 document, ?3 now, ?4 today (IST). An offer past its last valid day reads as expired
 * and is not marked viewed (M4.5 fix L9). The audit row follows it directly, guarded by `changes()`, so a second view writes nothing.
 */
export const VIEW_SQL =
  "UPDATE documents SET status = 'viewed', viewed_at = ?3 WHERE id = ?2 AND client_id = ?1 AND status = 'sent' AND viewed_at IS NULL AND pdf_sha256 IS NOT NULL AND valid_until >= ?4 AND type IN ('proposal', 'estimate')";

/** The same live link, by its hash (?LINK): this offer, this contact, an offer link, not revoked, not expired. */
const linkLive = (link: string, now: string, doc: string, contact: string) =>
  `EXISTS (SELECT 1 FROM offer_links l WHERE l.token_hash = ${link} AND l.purpose = 'offer' AND l.revoked_at IS NULL AND l.expires_at > ${now} AND l.client_id = ${doc}.client_id AND l.version_group_id = ${doc}.version_group_id AND l.contact_id = ${contact})`;

/** Placeholders shared by the accept and decline statements. */
export const P = {
  client: "?1",
  doc: "?2",
  contact: "?3",
  now: "?4",
  today: "?5",
  link: "?6",
} as const;

const contactLive = (client: string, contact: string) =>
  `EXISTS (SELECT 1 FROM contacts c WHERE c.id = ${contact} AND c.client_id = ${client} AND c.portal_access = 1 AND c.anonymised_at IS NULL)`;

/**
 * Statement 1 of an accept: the evidence row, written only if the offer is open in every way. ?1 client, ?2 document, ?3 contact,
 * ?4 now, ?5 today (IST), ?6 link hash (null on a session), ?7 acceptance id, ?8 session id (null on a link), ?9 typed name,
 * ?10 ip, ?11 user agent, ?12 country, ?13 via. The address comes from the contact row, never from the request. RETURNING gives
 * the answer without a second read.
 */
export const ACCEPT_INSERT_SQL = `INSERT INTO acceptances (id, document_id, contact_id, session_id, typed_name, email, accepted_at, ip, user_agent, country, pdf_sha256, terms_version_id, certificate_r2_key, via, offer_link_hash, snapshot_sha256) SELECT ?7, d.id, c.id, ?8, ?9, c.email, ?4, ?10, ?11, ?12, d.pdf_sha256, d.terms_version_id, substr(d.pdf_r2_key, 1, length(d.pdf_r2_key) - 4) || '-certificate.pdf', ?13, ?6, d.snapshot_sha256 FROM documents d JOIN contacts c ON c.id = ?3 AND c.client_id = d.client_id AND c.portal_access = 1 AND c.anonymised_at IS NULL WHERE d.id = ?2 AND d.client_id = ?1 AND d.type IN ${QUOTES} AND d.frozen_at IS NOT NULL AND d.status IN ('sent', 'viewed') AND d.pdf_sha256 IS NOT NULL AND d.pdf_r2_key IS NOT NULL AND d.valid_until >= ?5 AND ${NEWEST} AND NOT EXISTS (SELECT 1 FROM documents g WHERE g.version_group_id = d.version_group_id AND g.status IN ('accepted', 'converted')) AND (?6 IS NULL OR ${linkLive("?6", "?4", "d", "c.id")}) RETURNING email, accepted_at, pdf_sha256`;

/** Statement 2: the document follows its acceptance row. ?1 client, ?2 document, ?3 contact, ?4 now, ?7 acceptance id. */
export const ACCEPT_UPDATE_SQL =
  "UPDATE documents SET status = 'accepted', decided_at = ?4, decided_contact_id = ?3, viewed_at = coalesce(viewed_at, ?4) WHERE id = ?2 AND client_id = ?1 AND EXISTS (SELECT 1 FROM acceptances WHERE id = ?7)";

/** Statement 3: the audit row (ids and codes only, never the typed name or the address). ?1 client, ?2 document, ?3 contact, ?7 acceptance, ?13 via, ?14 audit id, ?15 request id, ?10 ip, ?11 ua. */
export const ACCEPT_AUDIT_SQL = `INSERT INTO audit_log (id, actor_type, actor_id, role, action, entity_type, entity_id, summary, ip, user_agent, request_id) SELECT ?14, 'contact', ?3, NULL, 'document.accept', 'document', d.id, json_object('documentId', d.id, 'version', d.version, 'via', ?13, 'pdfSha12', substr(d.pdf_sha256, 1, 12)), ?10, ?11, ?15 FROM documents d WHERE d.id = ?2 AND d.client_id = ?1 AND EXISTS (SELECT 1 FROM acceptances WHERE id = ?7)`;

/**
 * A decline: one conditional UPDATE. ?1 client, ?2 document, ?3 contact, ?4 now, ?5 today, ?6 link hash (null on a session),
 * ?7 reason code, ?8 note (null). The decision columns are set once (trigger); a second decline matches nothing.
 */
export const DECLINE_UPDATE_SQL = `UPDATE documents AS d SET status = 'rejected', decided_at = ?4, decision_reason = ?7, decision_note = ?8, decided_contact_id = ?3 WHERE d.id = ?2 AND d.client_id = ?1 AND d.type IN ${QUOTES} AND d.frozen_at IS NOT NULL AND d.status IN ('sent', 'viewed') AND d.pdf_sha256 IS NOT NULL AND d.valid_until >= ?5 AND ${NEWEST} AND ${contactLive("?1", "?3")} AND (?6 IS NULL OR ${linkLive("?6", "?4", "d", "?3")})`;

/** The decline's audit row, directly after the UPDATE (guarded by `changes()`): the reason CODE, never the note. ?1 client, ?2 document, ?3 contact, ?7 reason, ?9 via, ?10 ip, ?11 ua, ?14 audit id, ?15 request id. */
export const DECLINE_AUDIT_SQL = `INSERT INTO audit_log (id, actor_type, actor_id, role, action, entity_type, entity_id, summary, ip, user_agent, request_id) SELECT ?14, 'contact', ?3, NULL, 'document.decline', 'document', d.id, json_object('documentId', d.id, 'version', d.version, 'reason', ?7, 'via', ?9), ?10, ?11, ?15 FROM documents d WHERE d.id = ?2 AND d.client_id = ?1 AND changes() > 0`;

/** The id of the newest frozen version of `d`'s group above `d` (rendered or not), looked up once and joined by primary key. */
const NEWEST_ABOVE_ID =
  "(SELECT n.id FROM documents n WHERE n.version_group_id = d.version_group_id AND n.version > d.version AND n.frozen_at IS NOT NULL ORDER BY n.version DESC LIMIT 1)";

/**
 * When an accept or a decline wrote nothing: one read that picks the reason. ?1 client, ?2 document, ?3 the link's group (null on a session):
 * a link never learns the state of another offer of the same organisation. `latest_id` is the newest frozen version above this one and
 * `latest_pdf` its PDF hash: null while that version is still being rendered (FX-3, A4 9: `newer_version_pending`, not a `superseded` that
 * would point at a page the portal cannot show yet). Both come from one row `l`, found by one lookup (FX-3 fix round, item 7).
 */
export const REREAD_SQL = `SELECT d.status, d.pdf_sha256, d.valid_until, l.id AS latest_id, l.pdf_sha256 AS latest_pdf, a.typed_name, a.email AS a_email, a.accepted_at, a.contact_id AS a_contact, a.pdf_sha256 AS a_sha FROM documents d LEFT JOIN documents l ON l.id = ${NEWEST_ABOVE_ID} LEFT JOIN acceptances a ON a.document_id = d.id WHERE d.id = ?2 AND d.client_id = ?1 AND (?3 IS NULL OR d.version_group_id = ?3) AND d.type IN ${QUOTES} AND d.frozen_at IS NOT NULL`;

export type Reread = {
  status: string;
  pdf_sha256: string | null;
  valid_until: string | null;
  latest_id: string | null;
  /** The newest version's PDF hash; null while it is being rendered. Absent in rows read before FX-3 (treated as rendered). */
  latest_pdf?: string | null;
  typed_name: string | null;
  a_email: string | null;
  accepted_at: number | null;
  a_contact: string | null;
  a_sha: string | null;
};

/** Why an accept or a decline wrote nothing. */
export type Refusal =
  | { code: "not_found"; status: 404 }
  | { code: "pdf_pending"; status: 409 }
  | { code: "superseded"; status: 409; latestId: string }
  /** FX-3 (A4 9): a newer version is frozen but its PDF is not made yet, so there is nothing to open; try again shortly. */
  | { code: "newer_version_pending"; status: 409 }
  | { code: "expired"; status: 409 }
  | { code: "already_accepted"; status: 409; name: string; at: number }
  | { code: "already_decided"; status: 409 };

export type Replay = {
  replay: true;
  typedName: string;
  email: string;
  acceptedAt: number;
  fingerprint: string;
};

/**
 * The reason, in this order: not found, an acceptance on this very version (a safe replay for the same contact, a refusal for another), the PDF
 * not ready, a newer version (still being rendered: `newer_version_pending`; rendered: `superseded` with its id), declined, expired. An accepted
 * offer is final, so its acceptance comes before the date check.
 */
export function refusalOf(r: Reread | null, contactId: string, today: string): Refusal | Replay {
  if (!r) return { code: "not_found", status: 404 };
  if (r.accepted_at !== null && r.typed_name !== null) {
    if (r.a_contact === contactId && r.a_email !== null && r.a_sha !== null)
      return {
        replay: true,
        typedName: r.typed_name,
        email: r.a_email,
        acceptedAt: r.accepted_at,
        fingerprint: r.a_sha,
      };
    return { code: "already_accepted", status: 409, name: r.typed_name, at: r.accepted_at };
  }
  if (r.pdf_sha256 === null) return { code: "pdf_pending", status: 409 };
  if (r.latest_id !== null)
    return r.latest_pdf === null
      ? { code: "newer_version_pending", status: 409 }
      : { code: "superseded", status: 409, latestId: r.latest_id };
  if (r.status === "rejected") return { code: "already_decided", status: 409 };
  if (r.status === "expired" || (r.valid_until !== null && r.valid_until < today))
    return { code: "expired", status: 409 };
  return { code: "not_found", status: 404 };
}

/** A download's file name: the number and version with every character outside A-Z a-z 0-9 . - turned into "-". */
export function pdfFileName(numberDisplay: string | null, version: number, suffix = ""): string {
  const stem =
    (numberDisplay ?? "document").replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
  return `${stem}-v${version}${suffix}.pdf`;
}

/** The two-letter country of the request, or null. Cloudflare sets it; it is evidence, never trusted for anything else. */
export const countryOf = (raw: Request): string | null => {
  const cf = (raw as unknown as { cf?: { country?: unknown } }).cf;
  return typeof cf?.country === "string" ? clipHeader(cf.country, 2) : null;
};
