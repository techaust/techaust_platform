// `invoice.send` (M5.4; ADM-INV-15, POR-06, LD55, LD56, LD63, LD64): ONE recipient of an issued invoice, proforma, credit note or debit note (a `document_sends` row). Routed from queue.ts
// (`processInvoiceMessage`). One unit of work: read in one D1 batch, write in one batch, queue one ordinary `EmailMessage`. The email consumer then claims the email once by `email_log`
// (template, entity = the send row, address), so a redelivery sends nothing twice.
//
//   refuses (acknowledged; the row is marked cancelled so the screens say "not sent") when the send was cancelled (links revoked), the person lost portal access or was erased, the document
//     is void or not issued, or the client was anonymised;
//   waits (`pdf_missing`, the message is retried) while the PDF does not exist (the render step and the daily sweep queue it again);
//   an automatic send (`kind` auto, the care-plan issue) outside the settings window (default 09:00 to 19:00 IST) is acknowledged and sent AGAIN with `delaySeconds` until the window
//     opens (a new message, never `message.retry`, which would spend one of the five tries); a send by a person (`send`, `resend`) is never held back;
//   else ONE batch mints the personal link (`doc_access_tokens`, bound to the contact, 180 days) and stamps `queued_at`, and the email is queued with the PDF attached when the row says so.
// A redelivery mints another link and revokes none (the email is deduplicated, so only the first link is ever sent). A redelivery after "Revoke links" mints nothing: the revoke does
// not cancel a send that already has a link, so `LINK_SQL` refuses a send with a revoked link of its own, and the row is marked not sent.
import { type EmailMessage, invoiceSendMessage } from "@techaust/core";
import { isInvoiceFlowType, reminderWindowFromStored, windowDelaySeconds } from "@techaust/core/invoices";
import { ATTACHMENT_KEY, invoiceLinkExpiry, invoiceLinkUrl, mintOfferToken } from "@techaust/core/offers";
import { portalBase, storedValue, TERMS_READ } from "./billing-shared.ts";
import { type DocFacts, documentData, NOTE_FACTS_SQL, pdfFileName, SEND_TEMPLATE } from "./invoice-mail.ts";
import { logEvent } from "./log.ts";

export type InvoiceSendResult = "queued" | "missing" | "refused" | "pdf_missing" | "invalid" | "delayed";

/** ONE read batch: the send, its document and live contact, and the settings row the window comes from. `?1` the send id. */
const SEND_READ =
  "SELECT s.id, s.document_id, s.client_id, s.contact_id, s.attach_pdf, s.kind, s.cancelled_at, d.type, d.status, d.number_display, d.issue_date, d.due_date, d.total_minor, d.balance_minor, d.currency, d.issuer, d.pdf_sha256, d.pdf_r2_key, d.frozen_at IS NOT NULL AS frozen, d.voided_at IS NOT NULL AS voided, (SELECT p.number_display FROM documents p WHERE p.id = d.parent_id) AS parent_number, " +
  NOTE_FACTS_SQL +
  ", (cl.anonymised_at IS NOT NULL) AS client_gone, c.id AS live_contact, c.name AS contact_name, lower(c.email) AS contact_email FROM document_sends s JOIN documents d ON d.id = s.document_id JOIN clients cl ON cl.id = s.client_id LEFT JOIN contacts c ON c.id = s.contact_id AND c.client_id = s.client_id AND c.portal_access = 1 AND c.can_see_finance = 1 AND c.anonymised_at IS NULL WHERE s.id = ?1";

type SendRow = DocFacts & {
  id: string;
  document_id: string;
  client_id: string;
  contact_id: string | null;
  attach_pdf: number;
  kind: string;
  cancelled_at: number | null;
  status: string;
  pdf_sha256: string | null;
  pdf_r2_key: string | null;
  frozen: number;
  voided: number;
  client_gone: number;
  live_contact: string | null;
  contact_name: string | null;
  contact_email: string | null;
};

/**
 * The link, inserted only while the send is not cancelled, no link of this send was revoked ("Revoke links" cancels only the sends without a link, so a retry after an
 * email queue failure, or a redelivery, must not mint a live link after the revoke), the contact still has portal access, the document is issued and not void and the
 * client is not anonymised (`doc_access_tokens_bound_insert`, 0044, enforces the binding itself); its `changes` is 1 only then. `?1` token hash, `?2` send id, `?3` expiry.
 */
const LINK_SQL = `INSERT INTO doc_access_tokens (token_hash, document_id, purpose, expires_at, contact_id, client_id, email, send_id)
  SELECT ?1, d.id, 'view_pay', ?3, c.id, d.client_id, lower(c.email), s.id
  FROM document_sends s JOIN documents d ON d.id = s.document_id JOIN clients cl ON cl.id = s.client_id
    JOIN contacts c ON c.id = s.contact_id AND c.client_id = s.client_id AND c.portal_access = 1 AND c.can_see_finance = 1 AND c.anonymised_at IS NULL
  WHERE s.id = ?2 AND s.cancelled_at IS NULL AND d.frozen_at IS NOT NULL AND d.voided_at IS NULL AND d.status <> 'void' AND cl.anonymised_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM doc_access_tokens r WHERE r.document_id = d.id AND r.send_id = s.id AND r.revoked_at IS NOT NULL)`;

/** Marks a send as never going out (set once); the screens then show "not sent" instead of "queued" for ever. */
async function markNotSent(env: Env, sendId: string, now: number): Promise<void> {
  await env.DB.prepare("UPDATE document_sends SET cancelled_at = ?2 WHERE id = ?1 AND cancelled_at IS NULL")
    .bind(sendId, now)
    .run();
}

export async function processInvoiceSend(
  env: Env,
  body: unknown,
  now = Date.now(),
): Promise<InvoiceSendResult> {
  const parsed = invoiceSendMessage.safeParse(body);
  if (!parsed.success) {
    logEvent("invoice_send.invalid_message");
    return "invalid";
  }
  const { sendId } = parsed.data;
  const [found, terms] = await env.DB.batch([
    env.DB.prepare(SEND_READ).bind(sendId),
    env.DB.prepare(TERMS_READ),
  ]);
  const row = found?.results[0] as SendRow | undefined;
  if (!row) {
    logEvent("invoice_send.missing");
    return "missing";
  }
  // The other family's rows are `offer.send`'s: left alone, nothing written (LD56).
  if (!isInvoiceFlowType(row.type)) {
    logEvent("invoice_send.wrong_family");
    return "invalid";
  }
  if (
    row.cancelled_at !== null ||
    !row.live_contact ||
    !row.contact_email ||
    row.frozen !== 1 ||
    row.voided === 1 ||
    row.status === "void" ||
    row.client_gone === 1
  ) {
    logEvent("invoice_send.refused", {
      why: row.cancelled_at !== null ? "cancelled" : !row.live_contact ? "contact" : "document",
    });
    if (row.cancelled_at === null) await markNotSent(env, sendId, now);
    return "refused";
  }
  if (row.pdf_sha256 === null || row.pdf_r2_key === null) {
    logEvent("invoice_send.pdf_missing");
    return "pdf_missing";
  }
  // Q48 / LD64: an AUTOMATIC send waits for the window; a send by a person never does.
  if (row.kind === "auto") {
    const delay = windowDelaySeconds(now, reminderWindowFromStored(storedValue(terms)));
    if (delay > 0) {
      await env.EMAIL_QUEUE.send({ kind: "invoice.send", sendId }, { delaySeconds: delay });
      logEvent("invoice_send.delayed", { delaySeconds: delay });
      return "delayed";
    }
  }

  const { token, hash } = await mintOfferToken();
  const [linked] = await env.DB.batch([
    env.DB.prepare(LINK_SQL).bind(hash, sendId, invoiceLinkExpiry(now)),
    env.DB.prepare("UPDATE document_sends SET queued_at = coalesce(queued_at, ?2) WHERE id = ?1").bind(
      sendId,
      now,
    ),
  ]);
  // Nothing is emailed unless the link row exists: a contact who lost access, links revoked (before the read or after it) or a void between the read and the write.
  if (linked?.meta.changes !== 1) {
    logEvent("invoice_send.refused", { why: "link_not_written" });
    await markNotSent(env, sendId, now);
    return "refused";
  }
  const attach = row.attach_pdf === 1 && ATTACHMENT_KEY.test(row.pdf_r2_key);
  const message: EmailMessage = {
    template: SEND_TEMPLATE[row.type],
    to: row.contact_email,
    data: documentData(row, {
      name: row.contact_name,
      url: invoiceLinkUrl(portalBase(env), token),
      attached: attach,
    }),
    entity: { type: "document_send", id: sendId },
    ...(attach ? { attachment: { key: row.pdf_r2_key, filename: pdfFileName(row.number_display) } } : {}),
  };
  await env.EMAIL_QUEUE.send(message);
  logEvent("invoice_send.queued", { template: message.template, attached: attach });
  return "queued";
}
