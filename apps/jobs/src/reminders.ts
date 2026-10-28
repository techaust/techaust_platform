// Payment reminders in the jobs Worker (M5.4; ADM-INV-13, LD60, LD64; Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28) for which documents are chased).
//
//   cron (every IST hour) -> `reminder.scan` on the leads queue -> `processReminderScan`: outside the settings window it does nothing; inside it, `REMINDER_DUE_SQL` lists the due rows that are
//     still waiting (50 a page) and each becomes one `reminder.send` on the email queue (a full page also queues the next scan);
//   `reminder.send` -> `processReminderSend`: ONE reminder. Outside the window it is acknowledged and WRITES NOTHING (the row stays pending; the next scan in the window finds it again).
//     Inside it, ONE batch claims the row (`REMINDER_CLAIM_SQL`: every stop rule is in that statement), supersedes the earlier due offsets of the same document and mints one personal link
//     per live recipient (at most 5). Only then are the emails queued (`sendBatch`, entity = the reminder), and the first one's log id is written to the row.
//   A claim that is refused is judged by `skipReasonOf` (the claim's twin) and a final reason is written to the row, so the scan never reads it again.
//   A failure AFTER the claim and BEFORE the emails are queued gives the claim back (`sent_at` NULL again, only while this claim still holds and no email is recorded). Once `sendBatch` has
//   succeeded nothing is given back: the emails are deduplicated by `email_log` (template, reminder, address), so even a redelivery after an ambiguous failure sends once.
import { type EmailMessage, reminderSendMessage } from "@techaust/core";
import {
  inWindow,
  isFinalSkip,
  type ReminderFacts,
  reminderWindowFromStored,
  skipReasonOf,
} from "@techaust/core/invoices";
import { invoiceLinkExpiry, invoiceLinkUrl, mintOfferToken } from "@techaust/core/offers";
import {
  REMINDER_CLAIM_SQL,
  REMINDER_DUE_SQL,
  REMINDER_FACTS_SQL,
  REMINDER_SKIP_SQL,
  SUPERSEDE_SQL,
} from "@techaust/db/billing";
import { portalBase, storedValue, TERMS_READ } from "./billing-shared.ts";
import { emailLogId } from "./email.ts";
import { type DocFacts, documentData, NOTE_FACTS_SQL, reminderKind, reminderWhen } from "./invoice-mail.ts";
import { logEvent } from "./log.ts";

export type ReminderScanResult = { listed: number; continued: boolean; outsideWindow: boolean };
export type ReminderSendResult =
  | "sent"
  | "missing"
  | "invalid"
  | "already"
  | "outside_window"
  | "skipped"
  | "refused"
  | "no_recipient";

// ---- reminder.scan -------------------------------------------------------------------------------------------------------------

export async function processReminderScan(
  env: Env,
  body: { after: { at: number; id: string } | null },
  now = Date.now(),
): Promise<ReminderScanResult> {
  const terms = await env.DB.prepare(TERMS_READ).all<{ value: string }>();
  if (!inWindow(now, reminderWindowFromStored(storedValue(terms)))) {
    logEvent("reminder.scan", { outsideWindow: true });
    return { listed: 0, continued: false, outsideWindow: true };
  }
  const [at, id] = body.after ? [body.after.at, body.after.id] : [-1, ""];
  const { results } = await env.DB.prepare(REMINDER_DUE_SQL)
    .bind(now, at, id)
    .all<{ id: string; due_at: number }>();
  if (results.length === 0) {
    logEvent("reminder.scan", { listed: 0 });
    return { listed: 0, continued: false, outsideWindow: false };
  }
  await env.EMAIL_QUEUE.sendBatch(
    results.map((r) => ({ body: { kind: "reminder.send", reminderId: r.id } })),
  );
  const last = results[results.length - 1];
  const continued = results.length === 50 && last !== undefined;
  if (continued)
    await env.LEADS_QUEUE.send({ kind: "reminder.scan", after: { at: last.due_at, id: last.id } });
  logEvent("reminder.scan", { listed: results.length, continued });
  return { listed: results.length, continued, outsideWindow: false };
}

// ---- reminder.send -------------------------------------------------------------------------------------------------------------

/** ONE read batch by the reminder's id: the window's settings row, the reminder with its document, and up to 5 live recipients. `?1` reminder id. */
const REMINDER_READ = `SELECT r.id, r.document_id, r.offset_days, r.sent_at, r.skipped_reason, d.client_id, d.type, d.number_display, d.issue_date, d.due_date, d.total_minor, d.balance_minor, d.currency, d.issuer,
    (SELECT p.number_display FROM documents p WHERE p.id = d.parent_id) AS parent_number, ${NOTE_FACTS_SQL}
  FROM reminders r JOIN documents d ON d.id = r.document_id WHERE r.id = ?1`;
const RECIPIENTS_READ = `SELECT c.id, c.name, lower(c.email) AS email
  FROM reminders r JOIN documents d ON d.id = r.document_id
    JOIN contacts c ON c.client_id = d.client_id AND c.portal_access = 1 AND c.can_see_finance = 1 AND c.anonymised_at IS NULL
      AND c.id IN (SELECT s.contact_id FROM document_sends s WHERE s.document_id = d.id AND s.cancelled_at IS NULL AND s.contact_id IS NOT NULL)
  WHERE r.id = ?1 ORDER BY c.id LIMIT 5`;

/**
 * One reminder link per live recipient, minted in the claim's batch and ONLY while the claim holds in it (`r.sent_at = ?5`, nothing recorded yet), bound to the contact and the address
 * as it is now. `?1` token hash, `?2` expiry, `?3` reminder id, `?4` contact id, `?5` the claim's time.
 */
const REMINDER_LINK_SQL = `INSERT INTO doc_access_tokens (token_hash, document_id, purpose, expires_at, contact_id, client_id, email, send_id)
  SELECT ?1, d.id, 'view_pay', ?2, c.id, d.client_id, lower(c.email), NULL
  FROM reminders r JOIN documents d ON d.id = r.document_id
    JOIN contacts c ON c.id = ?4 AND c.client_id = d.client_id AND c.portal_access = 1 AND c.can_see_finance = 1 AND c.anonymised_at IS NULL
  WHERE r.id = ?3 AND r.sent_at = ?5 AND r.email_log_id IS NULL`;

/** Gives the claim back: only while this very claim still holds and no email is recorded (the trigger allows exactly that move). */
const GIVE_BACK_SQL =
  "UPDATE reminders SET sent_at = NULL WHERE id = ?1 AND sent_at = ?2 AND email_log_id IS NULL";

type ReminderRow = DocFacts & {
  id: string;
  document_id: string;
  offset_days: number;
  sent_at: number | null;
  skipped_reason: string | null;
  client_id: string;
};
type Recipient = { id: string; name: string; email: string };
type Facts = {
  sent_at: number | null;
  skipped_reason: string | null;
  due_at: number;
  frozen: number;
  type: string;
  status: string;
  balance_minor: number;
  voided: number;
  client_anonymised: number;
  policy_enabled: number;
  has_recipient: number;
  later_due: number;
};

const factsOf = (f: Facts): ReminderFacts => ({
  sentAt: f.sent_at,
  skippedReason: f.skipped_reason,
  dueAt: f.due_at,
  frozen: f.frozen === 1,
  type: f.type,
  status: f.status,
  balanceMinor: f.balance_minor,
  voided: f.voided === 1,
  clientAnonymised: f.client_anonymised === 1,
  policyEnabled: f.policy_enabled === 1,
  hasRecipient: f.has_recipient === 1,
  laterDue: f.later_due === 1,
});

export async function processReminderSend(
  env: Env,
  body: unknown,
  now = Date.now(),
): Promise<ReminderSendResult> {
  const parsed = reminderSendMessage.safeParse(body);
  if (!parsed.success) {
    logEvent("reminder_send.invalid_message");
    return "invalid";
  }
  const { reminderId } = parsed.data;
  const [terms, found, who] = await env.DB.batch([
    env.DB.prepare(TERMS_READ),
    env.DB.prepare(REMINDER_READ).bind(reminderId),
    env.DB.prepare(RECIPIENTS_READ).bind(reminderId),
  ]);
  const row = found?.results[0] as ReminderRow | undefined;
  if (!row) {
    logEvent("reminder_send.missing");
    return "missing";
  }
  // Sent, skipped for good or paused already: nothing to do (a paused row comes back to the scan when it is resumed).
  if (row.sent_at !== null || row.skipped_reason !== null) {
    logEvent("reminder_send.already");
    return "already";
  }
  // Outside the window nothing is written: the row stays pending and the next scan in the window lists it again (LD64).
  if (!inWindow(now, reminderWindowFromStored(storedValue(terms)))) {
    logEvent("reminder_send.outside_window");
    return "outside_window";
  }
  const recipients = (who?.results ?? []) as Recipient[];

  // The tokens first (their hashes are made before the batch), then ONE batch: the claim, the supersede and a link per recipient.
  const minted = await Promise.all(recipients.map(async (r) => ({ r, ...(await mintOfferToken()) })));
  const expires = invoiceLinkExpiry(now);
  const results = await env.DB.batch([
    env.DB.prepare(REMINDER_CLAIM_SQL).bind(reminderId, now),
    env.DB.prepare(SUPERSEDE_SQL).bind(reminderId, now),
    ...minted.map((m) => env.DB.prepare(REMINDER_LINK_SQL).bind(m.hash, expires, reminderId, m.r.id, now)),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1) return refused(env, reminderId, now);

  const linked = minted.filter((_, i) => results[2 + i]?.meta.changes === 1);
  if (linked.length === 0) {
    // Everyone lost access between the read and the claim: nobody to write to. Give the claim back (the stop rule then decides next time).
    await giveBack(env, reminderId, now);
    logEvent("reminder_send.no_recipient");
    return "no_recipient";
  }
  const when = reminderWhen(row.offset_days);
  const messages: EmailMessage[] = linked.map((m) => ({
    template: "reminder.sent",
    to: m.r.email,
    data: {
      ...documentData(row, {
        name: m.r.name,
        url: invoiceLinkUrl(portalBase(env), m.token),
        attached: false,
      }),
      ...when,
      kind: reminderKind(row.type),
    },
    entity: { type: "reminder", id: reminderId },
  }));
  try {
    await env.EMAIL_QUEUE.sendBatch(messages.map((m) => ({ body: m })));
  } catch (e) {
    // Not queued (or not known to be): give the claim back so the redelivery can send. Safe even if the queue did take them: the email is deduplicated.
    await giveBack(env, reminderId, now);
    throw e;
  }
  // After a successful sendBatch nothing is given back. The first email's log id is the row's reference (the other recipients' rows share its entity).
  const first = messages[0];
  if (first)
    await env.DB.prepare("UPDATE reminders SET email_log_id = ?2 WHERE id = ?1 AND email_log_id IS NULL")
      .bind(reminderId, emailLogId(first))
      .run()
      .catch(() => logEvent("reminder_send.log_id_not_written"));
  logEvent("reminder_send.sent", { offset: row.offset_days, emails: messages.length });
  return "sent";
}

async function giveBack(env: Env, reminderId: string, claimedAt: number): Promise<void> {
  await env.DB.prepare(GIVE_BACK_SQL)
    .bind(reminderId, claimedAt)
    .run()
    .catch(() => logEvent("reminder_send.give_back_failed"));
}

/** The claim changed nothing: say why with the twin of the claim, and write a FINAL reason to the row once (a pause or a later due offset that is itself sent is not one). */
async function refused(env: Env, reminderId: string, now: number): Promise<ReminderSendResult> {
  const f = await env.DB.prepare(REMINDER_FACTS_SQL).bind(reminderId, now).first<Facts>();
  if (!f) return "missing";
  const reason = skipReasonOf(factsOf(f), now);
  if (reason === "sent" || reason === "paused" || reason === null) {
    logEvent("reminder_send.already", { reason: reason ?? "claimed_elsewhere" });
    return "already";
  }
  if (isFinalSkip(reason)) await env.DB.prepare(REMINDER_SKIP_SQL).bind(reminderId, reason).run();
  logEvent("reminder_send.skipped", { reason });
  return "skipped";
}
