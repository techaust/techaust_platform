// The client's refund email (M7.2; ADM-PAY-08, ADM-MAIL-01; Q4 A: every completed refund except card chargebacks, including ones recorded as made outside the
// system; run file docs/runs/m7.2-notifications.md D "Refund email", C.2's recipient rule, L14). Tier A ground: client email recipients. On the email queue, routed
// before the generic path. `refund.notify {refundId}` (ids only) comes from the finance Worker's refund routes (`waitUntil` after the batch that set `succeeded`) and
// from jobs after `GatewayEvents.processEvent` / `checkRefund` answered a refund that succeeded. ONE unit of work:
//   ONE batch: the refund with every rule in SQL (status `succeeded`, origin not `chargeback`, the client not anonymised), its document's number (else the
//   document its payment was last allocated to, else the one its checkout was for, else the payment's receipt's), the credit note that records it (issued only), the terms row (the send window); and the client's live contacts with portal access AND
//   "can see finance" (Researched 2026-10-28, RB-31: finance emails only to finance contacts), the contact's `client_id` the refund's own
//   -> outside the window (default 09:00 to 19:00 IST; Q48: a system email waits) the same message again with `delaySeconds`;
//   -> else one `refund.sent` per contact, entity `{type: "refund", id}`, so a second producer (route and RPC both) or a redelivery sends once; its button opens
//      the refunded invoice in the portal (review 1, finding 13), else the invoice list.
// Not emailed (review 1, finding 13, kept): a refund from credit of a payment confirmed before M6.5 names no document (no invoice, no checkout, no receipt), so
// the consumer answers `none` (`no_document`); the run file records it.
// While 07-ZQ's client lines are unapproved no refund email leaves "local" (`refundCopyGate`, the M6.5 receipt gate's pattern): the message is acknowledged.
import type { EmailMessage } from "@techaust/core";
import { APPROVED_07ZQ } from "@techaust/core/copy-zq";
import { formatDate, parseIsoDate } from "@techaust/core/dates";
import { reminderWindowFromStored, windowDelaySeconds } from "@techaust/core/invoices";
import { formatMoney, money } from "@techaust/core/money";
import { parseRefundNotify, refundNotify } from "@techaust/core/notifications";
import { firstNameOf } from "@techaust/core/offers";
import { portalBase, storedValue, TERMS_READ } from "./billing-shared.ts";
import { logEvent } from "./log.ts";
import { sendChunked } from "./send-batch.ts";

/** At most this many contacts one refund's email goes to (one `sendBatch`). */
export const REFUND_MAIL_MAX = 20;

/** 07-ZQ's client lines approved (one switch); behind an object so a test can stand in for the flipped switch. */
export const refundCopyGate = { approved: (): boolean => APPROVED_07ZQ };

/**
 * The refund, only when it may be emailed: every rule in the WHERE (a row that fails one reads as nothing). The document it names: the refund's own (an
 * invoice's excess), else the one its payment was last allocated to (re-check finding 6: an online payment on a proforma sits on the tax invoice issued for
 * it, while its checkout still names the converted proforma), else its checkout's, else (number only) its receipt's. One seek of `payment_allocations_payment`.
 */
export const REFUND_ROW_SQL = `SELECT r.id, r.client_id, r.amount_minor, r.currency, r.settled_on, r.settled_at,
     coalesce(d.number_display, ad.number_display, cd.number_display, rc.number_display) AS document_number, coalesce(d.id, ad.id, cd.id) AS invoice_id,
     CASE WHEN cn.status <> 'draft' AND cn.number_display IS NOT NULL THEN cn.number_display END AS credit_note_number
   FROM payment_refunds r
   JOIN clients k ON k.id = r.client_id AND k.anonymised_at IS NULL
   LEFT JOIN documents d ON d.id = r.document_id
   LEFT JOIN payments p ON p.id = r.payment_id
   LEFT JOIN documents ad ON ad.id = (SELECT pa.document_id FROM payment_allocations pa INDEXED BY payment_allocations_payment
     WHERE pa.payment_id = p.id AND pa.kind = 'allocate' ORDER BY pa.created_at DESC, pa.id DESC LIMIT 1)
   LEFT JOIN checkout_sessions cs ON cs.id = p.checkout_id
   LEFT JOIN documents cd ON cd.id = cs.document_id
   LEFT JOIN documents rc ON rc.id = p.receipt_document_id
   LEFT JOIN documents cn ON cn.id = r.credit_note_id AND cn.type = 'credit_note'
   WHERE r.id = ?1 AND r.status = 'succeeded' AND r.origin <> 'chargeback'`;

/** The refund's client's finance contacts (the C.2 rule), bound to the refund's own client in SQL. */
export const REFUND_CONTACTS_SQL = `SELECT lower(c.email) AS email, c.name FROM contacts c
   WHERE c.client_id = (SELECT r.client_id FROM payment_refunds r WHERE r.id = ?1)
     AND c.portal_access = 1 AND c.can_see_finance = 1 AND c.anonymised_at IS NULL
   ORDER BY c.is_primary DESC, c.created_at, c.id LIMIT ${REFUND_MAIL_MAX}`;

type RefundRow = {
  id: string;
  client_id: string;
  amount_minor: number;
  currency: "INR" | "USD";
  settled_on: string | null;
  settled_at: number | null;
  document_number: string | null;
  invoice_id: string | null;
  credit_note_number: string | null;
};

export type RefundNotifyResult = "queued" | "none" | "invalid" | "delayed" | "held";

export async function processRefundNotify(
  env: Pick<Env, "DB" | "EMAIL_QUEUE" | "PORTAL_URL" | "ENVIRONMENT">,
  body: unknown,
  now = Date.now(),
): Promise<RefundNotifyResult> {
  const m = parseRefundNotify(body);
  if (!m) {
    logEvent("refund_notify.invalid_message");
    return "invalid";
  }
  const environment: string = env.ENVIRONMENT;
  if (environment !== "local" && !refundCopyGate.approved()) {
    logEvent("refund_notify.held", { why: "copy_unapproved" });
    return "held";
  }
  const [found, contactsRead, terms] = await env.DB.batch([
    env.DB.prepare(REFUND_ROW_SQL).bind(m.refundId),
    env.DB.prepare(REFUND_CONTACTS_SQL).bind(m.refundId),
    env.DB.prepare(TERMS_READ),
  ]);
  const row = found?.results[0] as RefundRow | undefined;
  if (!row || row.document_number === null) {
    logEvent("refund_notify.none", { why: row ? "no_document" : "not_mailable" });
    return "none";
  }
  const contacts = (contactsRead?.results ?? []) as { email: string; name: string }[];
  if (contacts.length === 0) {
    logEvent("refund_notify.none", { why: "no_contact" });
    return "none";
  }
  const delay = windowDelaySeconds(now, reminderWindowFromStored(storedValue(terms)));
  if (delay > 0) {
    await env.EMAIL_QUEUE.send(refundNotify(m.refundId), { delaySeconds: delay });
    logEvent("refund_notify.delayed", { delaySeconds: delay });
    return "delayed";
  }
  const day = row.settled_on ? parseIsoDate(row.settled_on) : null;
  const date = day ? formatDate(day) : (row.settled_on ?? "");
  // Review 1, finding 13: "View invoice" opens the refunded invoice (its excess, the document its payment sits on, or the one its checkout was for); a refund from credit named
  // only by the payment's receipt opens the invoice list, where the receipt is shown on the invoice it paid.
  const url = row.invoice_id
    ? `${portalBase(env)}/invoices/${encodeURIComponent(row.invoice_id)}`
    : `${portalBase(env)}/invoices`;
  const amount = formatMoney(money(row.amount_minor, row.currency));
  const messages: EmailMessage[] = contacts.map((c) => ({
    template: "refund.sent",
    to: c.email,
    data: {
      first_name: firstNameOf(c.name),
      amount,
      document_number: row.document_number as string,
      date,
      credit_note_number: row.credit_note_number ?? "",
      url,
    },
    entity: { type: "refund", id: row.id },
  }));
  await sendChunked(env.EMAIL_QUEUE, messages);
  logEvent("refund_notify.queued", { emails: messages.length });
  return "queued";
}

/**
 * Queue the client's refund email for a refund an RPC just moved to succeeded (M7.2, producers 3 and 4). Review 1, finding 8: a failed send is logged and never
 * thrown: the RPC's work is done and its redelivery answers nothing more (the refund is settled), so `refund.sweep` (`REFUNDS_UNMAILED_SQL`) sends it within the hour.
 */
export async function sendRefundNotify(env: Pick<Env, "EMAIL_QUEUE">, refundId: string): Promise<void> {
  try {
    await env.EMAIL_QUEUE.send(refundNotify(refundId));
  } catch (e) {
    logEvent("refund.notify_send_failed", { error: e instanceof Error ? e.name : "unknown" });
  }
}
