// What ends a contact's client-portal access, and what keeps a contact from being erased (M3.3, ADM-CLI-02, ADM-CLI-05,
// POR-01). They return prepared statements for the caller's own `db.batch()`, each written only while the caller's guard holds
// (the request's audit row), so the access ends in the same batch as the change that asked for it. Researched 2026-10-29,
// DPDP s.8(5), s.12(3), s.17(1)(a) (08-C RB-37); its open parts: Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37): accepted offers are kept as long as the tax records; for a never-accepted sent offer the person's data is erased in the frozen copy on request (T7; until then erase is refused).
// Subpath export (`@techaust/db/contact-access`) so a Worker importing it doesn't pull in the Drizzle schema.
import type { GuardSql } from "./log.ts";

/**
 * A condition on `contacts c JOIN clients cl`: this person appears on something the law makes us keep, so they cannot be ERASED
 * (they can still be anonymised). True when:
 * - they accepted a proposal (an acceptance names the contact and is append-only evidence), or declined one (`documents.decided_contact_id`,
 *   M4.5: the reason and the note are on a frozen document), or
 * - a frozen (issued) document of their client names their email as the recipient, or names them (M4.3: a sent proposal or estimate
 *   is addressed to a contact, `recipient.contactId`, whatever the email now is), or
 * - the client is an individual and has any frozen document (the document is that person's, whatever the snapshot's email says).
 * Kept up to date by M4.3 (proposals and estimates sent), M5 (invoices): every new way a document can name a person is added here.
 */
export const CONTACT_ON_ISSUED_DOCUMENT_SQL =
  "(EXISTS (SELECT 1 FROM acceptances a WHERE a.contact_id = c.id) OR EXISTS (SELECT 1 FROM documents d2 WHERE d2.decided_contact_id = c.id) OR EXISTS (SELECT 1 FROM documents d WHERE d.client_id = c.client_id AND d.frozen_at IS NOT NULL AND (cl.type = 'individual' OR lower(json_extract(d.recipient, '$.email')) = c.email OR json_extract(d.recipient, '$.contactId') = c.id)))";

/**
 * A condition on `contacts c`: a lead of this person (made from the contact, or by its email at its client or at none) is under a legal hold, so the
 * person can be neither erased nor anonymised (the erase route's audit-first row, its "why" read, and the T7 redaction read, which answers the hold
 * before `too_many_offers`).
 */
export const HELD_LEAD_SQL =
  "EXISTS (SELECT 1 FROM leads l WHERE l.legal_hold = 1 AND (l.contact_id = c.id OR (l.contact_email = c.email AND (l.client_id IS NULL OR l.client_id = c.client_id))))";

/**
 * Portal access off, or a changed email: every live session of the contact is revoked, every unused sign-in link deleted, and (M4.5, docs/13
 * row 192) every live offer link of the contact revoked. (Turning access back on does not revive a revoked session or link: a revoked
 * one stays revoked, and the person is sent a new link by a new send.)
 */
export function revokeContactAccess(
  db: D1Database,
  contactId: string,
  t: number,
  g: GuardSql,
): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE client_sessions SET revoked_at = ?2 WHERE contact_id = ?1 AND revoked_at IS NULL AND ${g.sql(3)}`,
      )
      .bind(contactId, t, ...g.params),
    db
      .prepare(`DELETE FROM magic_link_tokens WHERE contact_id = ?1 AND used_at IS NULL AND ${g.sql(2)}`)
      .bind(contactId, ...g.params),
    db
      .prepare(
        `UPDATE offer_links SET revoked_at = ?2 WHERE contact_id = ?1 AND revoked_at IS NULL AND ${g.sql(3)}`,
      )
      .bind(contactId, t, ...g.params),
    // M5.4 (POR-06): the contact's invoice links end too (the portal read also joins the live contact, so this is the record of it).
    db
      .prepare(
        `UPDATE doc_access_tokens SET revoked_at = ?2 WHERE contact_id = ?1 AND revoked_at IS NULL AND ${g.sql(3)}`,
      )
      .bind(contactId, t, ...g.params),
  ];
}

/**
 * Erase or anonymise: the contact's sessions and sign-in links (used or not) are deleted outright, and (M4.5) so are their offer links (each
 * holds the person's address); the `document_sends` rows they were sent as keep existing without a contact or an address (the trigger allows
 * only that change), so the history "this offer was sent to N people" stays true.
 */
export function deleteContactAccess(db: D1Database, contactId: string, g: GuardSql): D1PreparedStatement[] {
  return [
    db
      .prepare(`DELETE FROM client_sessions WHERE contact_id = ?1 AND ${g.sql(2)}`)
      .bind(contactId, ...g.params),
    db
      .prepare(`DELETE FROM magic_link_tokens WHERE contact_id = ?1 AND ${g.sql(2)}`)
      .bind(contactId, ...g.params),
    db.prepare(`DELETE FROM offer_links WHERE contact_id = ?1 AND ${g.sql(2)}`).bind(contactId, ...g.params),
    // M5.4: and their invoice links (each holds the person's address).
    db
      .prepare(`DELETE FROM doc_access_tokens WHERE contact_id = ?1 AND ${g.sql(2)}`)
      .bind(contactId, ...g.params),
    db
      .prepare(
        `UPDATE document_sends SET contact_id = NULL, email = NULL WHERE contact_id = ?1 AND ${g.sql(2)}`,
      )
      .bind(contactId, ...g.params),
  ];
}
