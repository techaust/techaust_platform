// Small reads and helpers the invoice send, the offer send and the reminders share (M5.4; review L6): one copy of the settings row they read, the lenient reader of its stored value,
// the portal's base URL, and the not-sent mark of a send (test-hardening review L5).

/** The `payment_terms` settings row the reminder window comes from. */
export const TERMS_READ = "SELECT value FROM settings WHERE key = 'payment_terms'";

/** The row's JSON read without zod (an unreadable or missing row is `null`, which core reads as the default window). */
export const storedValue = (rows: unknown): unknown => {
  try {
    const value = (rows as { results: { value: string }[] } | undefined)?.results[0]?.value;
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

/** The portal's origin without a trailing slash (links are built on it). */
export const portalBase = (env: { PORTAL_URL?: string }): string =>
  (env.PORTAL_URL ?? "").replace(/\/+$/, "");

// A send whose email already has its log row (the email consumer took it: sent, delivered or failed) keeps that state: a redelivery refused after "Revoke links"
// must not relabel an email that went as "Cancelled" (test-hardening, lead decision 2026-11-01). `email_log_entity` index.
export const MARK_NOT_SENT_SQL = `UPDATE document_sends SET cancelled_at = ?2 WHERE id = ?1 AND cancelled_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM email_log e WHERE e.entity_type = 'document_send' AND e.entity_id = document_sends.id)`;

/** Marks a send of either family as never going out (set once; the trigger's rule); the screens then show "not sent" instead of "queued" for ever. */
export async function markNotSent(env: { DB: D1Database }, sendId: string, now: number): Promise<void> {
  await env.DB.prepare(MARK_NOT_SENT_SQL).bind(sendId, now).run();
}
