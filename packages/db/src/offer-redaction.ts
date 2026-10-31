// T7 (08-C RB-37(a); Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37)): which frozen offers lose a person's details when that person is
// anonymised. One condition, written once, for the admin read, the batch guard that proves the set did not change, and the batch's own UPDATE. Subpath export
// (`@techaust/db/offer-redaction`): pure SQL text, no I/O.

/**
 * A frozen proposal or estimate `d` of the client of contact `c` (client row `cl`) that was never accepted, not yet redacted, and names the contact: addressed
 * to them (the frozen `contactId`, the frozen email matching their live one, or `contact_id`), decided by them, or (an individual client's last live contact)
 * any offer of that client. An accepted or converted offer, one with an acceptance row, a draft and every invoice-family type are out: those are kept whole
 * (08-C RB-37(b)). Served by `documents_client_type_status` (the client and type come first).
 */
export const REDACTABLE_OFFER_SQL = (d: string, c: string, cl: string): string =>
  `${d}.client_id = ${c}.client_id AND ${d}.type IN ('proposal', 'estimate') AND ${d}.frozen_at IS NOT NULL AND ${d}.redacted_at IS NULL` +
  ` AND ${d}.status NOT IN ('accepted', 'converted') AND NOT EXISTS (SELECT 1 FROM acceptances a WHERE a.document_id = ${d}.id)` +
  ` AND (json_extract(${d}.recipient, '$.contactId') = ${c}.id OR lower(json_extract(${d}.recipient, '$.email')) = lower(${c}.email)` +
  ` OR ${d}.contact_id = ${c}.id OR ${d}.decided_contact_id = ${c}.id` +
  ` OR (${cl}.type = 'individual' AND ${LAST_LIVE_SQL(c)}))`;

/** Contact `c` is the last live (not anonymised) contact of its client. */
export const LAST_LIVE_SQL = (c: string): string =>
  `NOT EXISTS (SELECT 1 FROM contacts o WHERE o.client_id = ${c}.client_id AND o.id <> ${c}.id AND o.anonymised_at IS NULL)`;

/** At most this many offers are redacted by one anonymise request (the Free plan's 10 ms CPU; L5); more is 409 `too_many_offers` and nothing is written. */
export const MAX_REDACTED_OFFERS = 10;
