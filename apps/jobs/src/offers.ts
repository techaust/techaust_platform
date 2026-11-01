// The expansion messages of M4.5 (ADM-PROP-07, ADM-PROP-08, ADM-APR-01, ADM-MAIL-01): `offer.send`, `offer.decided`, `offer.accepted` and
// `approval.notify`. Routed from queue.ts (`processOfferMessage`). Each is ONE unit of work: read in one D1 batch, write in one batch,
// queue ordinary `EmailMessage`s with `sendBatch`/`send`, return a result string. The ordinary email consumer then claims each email once by
// `email_log` (template, entity, address), so a redelivery of any of these sends nothing twice. No address, name, token or note is logged.
//
//   offer.send     one recipient (a `document_sends` row): refuses when the contact lost access, the offer is not open any more or past its last
//                  valid day; waits (returns "pdf_missing", the message is retried) while the PDF does not exist; else mints the link and queues the
//                  email (with the PDF attached when the row says so). A redelivery mints another link and never revokes the first.
//   offer.decided  the bell for the sender and the active owners (accepted or declined); nothing for the client.
//   offer.accepted the confirmation emails, once the certificate exists: to the accepting contact (with a confirmation link) and to TecHaust.
//   approval.notify the M4.3 approval emails: requested to the active owners, decided to the requester.
//
// Researched 2026-10-28, BSA 2023 s.63(4) (08-C RB-19): the confirmation link and the stored address of the person who accepted.
import {
  approvalNotifyMessage,
  type EmailMessage,
  formatDate,
  formatIstDateTime,
  formatMoney,
  type InvoiceSendMessage,
  money,
  type OfferAcceptedMessage,
  type OfferSendMessage,
  offerAcceptedMessage,
  offerDecidedMessage,
  offerSendMessage,
  parseIsoDate,
} from "@techaust/core";
import { guardFigures } from "@techaust/core/documents";
import { INVOICE_FLOW_TYPES, isInvoiceFlowType } from "@techaust/core/invoices";
import {
  ATTACHMENT_KEY,
  confirmationLinkExpiry,
  firstNameOf,
  mintOfferToken,
  offerLinkExpiry,
  offerLinkUrl,
  todayIst,
} from "@techaust/core/offers";
import type { OfferSweepMessage, PdfCertificateMessage } from "@techaust/core/pdf-jobs";
import { portalBase } from "./billing-shared.ts";
import { logEvent } from "./log.ts";

/** The jobs Env (PORTAL_URL arrived with M4.4 phase 2). */
type OfferEnv = Env;

export type OfferSendResult = "queued" | "missing" | "refused" | "pdf_missing" | "invalid";
export type OfferDecidedResult = "noted" | "missing" | "ignored" | "invalid";
export type OfferAcceptedResult = "queued" | "missing" | "certificate_missing" | "none" | "invalid";
export type ApprovalNotifyResult = "queued" | "missing" | "none" | "ignored" | "invalid";

/** 07-N §3's words for a decline's reason codes (the portal and admin show the same). */
const DECLINE_WORDS: Record<string, string> = {
  price: "The price doesn't fit our budget",
  timing: "The timing doesn't work for us",
  other_option: "We've chosen another option",
  not_needed: "We've decided not to go ahead",
  other: "Other",
};
/** Basis points as a percentage ("12.5", "15"), as the admin shows them. */
const percentText = (bp: number) => {
  const frac = String(bp % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return frac ? `${Math.trunc(bp / 100)}.${frac}` : String(Math.trunc(bp / 100));
};
const adminBase = (env: Env) => env.ADMIN_URL.replace(/\/+$/, "");
const fileName = (numberDisplay: string, version: number) =>
  `${numberDisplay.replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "document"}-v${version}.pdf`;
const dateText = (iso: string | null) => {
  const d = iso ? parseIsoDate(iso) : null;
  return d ? formatDate(d) : "";
};
const issuerOf = (json: string | null): { senderId: string | null; senderName: string } => {
  try {
    const i = JSON.parse(json ?? "null") as { sender?: { staffId?: unknown; name?: unknown } } | null;
    return {
      senderId: typeof i?.sender?.staffId === "string" ? i.sender.staffId : null,
      senderName: typeof i?.sender?.name === "string" ? i.sender.name : "",
    };
  } catch {
    return { senderId: null, senderName: "" };
  }
};

// ---- offer.send ---------------------------------------------------------------------------------------------------------------

const SEND_READ =
  "SELECT s.id, s.document_id, s.version_group_id, s.client_id, s.contact_id, s.attach_pdf, s.queued_at, s.cancelled_at, d.status, d.valid_until, d.type, d.title, d.number_display, d.version, d.total_minor, d.currency, d.pdf_sha256, d.pdf_r2_key, d.issuer, d.redacted_at, c.id AS live_contact, c.name AS contact_name, lower(c.email) AS contact_email FROM document_sends s JOIN documents d ON d.id = s.document_id LEFT JOIN contacts c ON c.id = s.contact_id AND c.client_id = s.client_id AND c.portal_access = 1 AND c.anonymised_at IS NULL WHERE s.id = ?1";

type SendRow = {
  id: string;
  document_id: string;
  version_group_id: string;
  client_id: string;
  contact_id: string | null;
  attach_pdf: number;
  queued_at: number | null;
  cancelled_at: number | null;
  status: string;
  valid_until: string | null;
  type: string;
  title: string | null;
  number_display: string | null;
  version: number;
  total_minor: number;
  currency: string;
  pdf_sha256: string | null;
  pdf_r2_key: string | null;
  issuer: string | null;
  redacted_at: number | null;
  live_contact: string | null;
  contact_name: string | null;
  contact_email: string | null;
};

/** Marks a send as never going out (set once, by the trigger's rule); the offer page then shows `not_sent`. */
async function markNotSent(env: OfferEnv, sendId: string, now: number): Promise<void> {
  await env.DB.prepare("UPDATE document_sends SET cancelled_at = ?2 WHERE id = ?1 AND cancelled_at IS NULL")
    .bind(sendId, now)
    .run();
}

export async function processOfferSend(
  env: OfferEnv,
  body: unknown,
  now = Date.now(),
): Promise<OfferSendResult> {
  const parsed = offerSendMessage.safeParse(body);
  if (!parsed.success) {
    logEvent("offer_send.invalid_message");
    return "invalid";
  }
  const { sendId } = parsed.data;
  const row = (await env.DB.prepare(SEND_READ).bind(sendId).first()) as SendRow | null;
  if (!row) {
    logEvent("offer_send.missing");
    return "missing";
  }
  // LD56: a send of an invoice, proforma, credit note or debit note is `invoice.send`'s. The refusal below would mark it cancelled for good (an invoice is never "open"), so a
  // row of the other family is left alone: nothing is written and nothing is queued.
  if (isInvoiceFlowType(row.type)) {
    logEvent("offer_send.wrong_family");
    return "invalid";
  }
  // Refused (acknowledged): links were revoked, the person lost access or was removed, or the offer is not open any more. The row is marked
  // cancelled, so the offer page shows "not sent" instead of "queued" forever (a send that was already cancelled stays as it is). T7 (Q1 = A, owner
  // 2026-10-31; Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37)): an offer whose personal details were erased is withdrawn, so it is
  // never emailed (the anonymise batch cancels only its sends never queued; a queued send without a link is refused here, and so is a redelivery of one
  // that has a link).
  if (
    row.cancelled_at !== null ||
    row.redacted_at !== null ||
    !row.live_contact ||
    !row.contact_email ||
    !["sent", "viewed"].includes(row.status) ||
    (row.valid_until !== null && row.valid_until < todayIst(now)) ||
    row.valid_until === null
  ) {
    logEvent("offer_send.refused", {
      why:
        row.cancelled_at !== null
          ? "cancelled"
          : row.redacted_at !== null
            ? "redacted"
            : !row.live_contact
              ? "contact"
              : "document",
    });
    if (row.cancelled_at === null) await markNotSent(env, sendId, now);
    return "refused";
  }
  if (row.pdf_sha256 === null || row.pdf_r2_key === null) {
    logEvent("offer_send.pdf_missing");
    return "pdf_missing";
  }
  const { token, hash } = await mintOfferToken();
  // One batch: the link (only while the contact is still live, the send is not cancelled and the offer was not erased in between) and the row's queued
  // stamp (set once).
  const [linked] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO offer_links (token_hash, send_id, document_id, version_group_id, client_id, contact_id, email, purpose, expires_at, created_at)
       SELECT ?1, s.id, s.document_id, s.version_group_id, s.client_id, c.id, lower(c.email), 'offer', ?3, ?4
       FROM document_sends s JOIN contacts c ON c.id = s.contact_id AND c.client_id = s.client_id AND c.portal_access = 1 AND c.anonymised_at IS NULL
       JOIN documents d ON d.id = s.document_id AND d.redacted_at IS NULL
       WHERE s.id = ?2 AND s.cancelled_at IS NULL`,
    ).bind(hash, sendId, offerLinkExpiry(row.valid_until), now),
    env.DB.prepare("UPDATE document_sends SET queued_at = coalesce(queued_at, ?2) WHERE id = ?1").bind(
      sendId,
      now,
    ),
  ]);
  // Nothing is emailed unless the link row exists: a contact who lost access, or links revoked, between the read and the write.
  if (linked?.meta.changes !== 1) {
    logEvent("offer_send.refused", { why: "link_not_written" });
    await markNotSent(env, sendId, now);
    return "refused";
  }
  const number = row.number_display ?? "";
  const attach = row.attach_pdf === 1 && ATTACHMENT_KEY.test(row.pdf_r2_key);
  const message: EmailMessage = {
    template: "offer.sent",
    to: row.contact_email,
    data: {
      first_name: firstNameOf(row.contact_name ?? ""),
      kind: row.type,
      title: row.title ?? "",
      number,
      version: String(row.version),
      valid_until: dateText(row.valid_until),
      total: formatMoney(money(row.total_minor, row.currency === "USD" ? "USD" : "INR")),
      url: offerLinkUrl(portalBase(env), token),
      attached: attach ? "1" : "0",
      sender_name: issuerOf(row.issuer).senderName,
    },
    entity: { type: "document_send", id: sendId },
    ...(attach ? { attachment: { key: row.pdf_r2_key, filename: fileName(number, row.version) } } : {}),
  };
  await env.EMAIL_QUEUE.send(message);
  logEvent("offer_send.queued", { attached: attach });
  return "queued";
}

// ---- offer.decided -------------------------------------------------------------------------------------------------------------

export async function processOfferDecided(env: OfferEnv, body: unknown): Promise<OfferDecidedResult> {
  const parsed = offerDecidedMessage.safeParse(body);
  if (!parsed.success) {
    logEvent("offer_decided.invalid_message");
    return "invalid";
  }
  const { documentId, decision } = parsed.data;
  const doc = (await env.DB.prepare(
    "SELECT d.id, d.status, d.title, d.version, d.issuer, d.number_display, d.decision_reason, d.decision_note, d.redacted_at, c.name AS decided_name FROM documents d LEFT JOIN contacts c ON c.id = d.decided_contact_id WHERE d.id = ?1 AND d.type IN ('proposal', 'estimate')",
  )
    .bind(documentId)
    .first()) as {
    id: string;
    status: string;
    title: string | null;
    version: number;
    issuer: string | null;
    number_display: string | null;
    decision_reason: string | null;
    decision_note: string | null;
    redacted_at: number | null;
    decided_name: string | null;
  } | null;
  if (!doc) {
    logEvent("offer_decided.missing");
    return "missing";
  }
  // T7 (review row 3; Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37)): an offer whose personal details were erased is withdrawn,
  // so a late or redelivered decision rings no bell and emails no one about it (the anonymise batch deleted its bells).
  if (doc.redacted_at !== null) {
    logEvent("offer_decided.ignored", { decision, why: "redacted" });
    return "ignored";
  }
  // The message names the decision; the row must agree, so a stray message never invents a bell.
  if (doc.status !== (decision === "accepted" ? "accepted" : "rejected")) {
    logEvent("offer_decided.ignored", { decision });
    return "ignored";
  }
  const { senderId } = issuerOf(doc.issuer);
  const label = `${doc.title ?? "Untitled"} v${doc.version}`.slice(0, 150);
  // 07-N §6 (PENDING the owner's approval): the bell titles. One row per person (the sender and each active owner); `(user, kind,
  // entity)` is unique.
  const title = decision === "accepted" ? `Accepted: ${label}` : `Declined: ${label}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
     SELECT 'n_' || lower(hex(randomblob(16))), u.id, ?1, 'document', ?2, ?3, ?4 FROM staff_users u
     WHERE u.status = 'active' AND (u.role = 'owner' OR u.id = ?5) AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = ?2 AND d.redacted_at IS NOT NULL)`,
  )
    .bind(`offer.${decision}`, documentId, title, `/documents/${documentId}`, senderId)
    .run();
  // 07-N §4 "Declined email, TecHaust side": to the sender and the active owners, once each (the email consumer claims
  // template + document + address, so a redelivery sends nothing twice).
  if (decision === "declined") {
    const staff = ((await env.DB.prepare(STAFF_READ).bind(senderId).all()).results ?? []) as {
      email: string;
    }[];
    if (staff.length > 0)
      await env.EMAIL_QUEUE.sendBatch(
        staff.map((s) => ({
          body: {
            template: "offer.declined.staff",
            to: s.email,
            data: {
              name: doc.decided_name ?? "",
              title: doc.title ?? "",
              number: doc.number_display ?? "",
              version: String(doc.version),
              reason: DECLINE_WORDS[doc.decision_reason ?? ""] ?? doc.decision_reason ?? "",
              note: doc.decision_note ?? "",
              url: `${adminBase(env)}/documents/${documentId}`,
            },
            entity: { type: "document", id: documentId },
          } satisfies EmailMessage,
        })),
      );
  }
  logEvent("offer_decided.noted", { decision });
  return "noted";
}

// ---- offer.accepted ------------------------------------------------------------------------------------------------------------

const ACCEPTED_READ =
  "SELECT a.id, a.document_id, a.contact_id, a.typed_name, a.email, a.accepted_at, d.type, d.title, d.number_display, d.version, d.version_group_id, d.client_id, d.issuer, c.id AS live_contact, c.portal_access, ce.rendered_at FROM acceptances a JOIN documents d ON d.id = a.document_id LEFT JOIN contacts c ON c.id = a.contact_id AND c.anonymised_at IS NULL LEFT JOIN acceptance_certificates ce ON ce.acceptance_id = a.id WHERE a.id = ?1";
const STAFF_READ =
  "SELECT id, email, name FROM staff_users WHERE status = 'active' AND (role = 'owner' OR id = ?1) ORDER BY id";

export async function processOfferAccepted(
  env: OfferEnv,
  body: unknown,
  now = Date.now(),
): Promise<OfferAcceptedResult> {
  const parsed = offerAcceptedMessage.safeParse(body);
  if (!parsed.success) {
    logEvent("offer_accepted.invalid_message");
    return "invalid";
  }
  const { acceptanceId } = parsed.data;
  const a = (await env.DB.prepare(ACCEPTED_READ).bind(acceptanceId).first()) as {
    id: string;
    document_id: string;
    contact_id: string;
    typed_name: string;
    email: string;
    accepted_at: number;
    type: string;
    title: string | null;
    number_display: string | null;
    version: number;
    version_group_id: string;
    client_id: string;
    issuer: string | null;
    live_contact: string | null;
    portal_access: number | null;
    rendered_at: number | null;
  } | null;
  if (!a) {
    logEvent("offer_accepted.missing");
    return "missing";
  }
  // The confirmation links both PDFs, so it waits for the certificate (the message is retried, and the sweep covers a lost one).
  if (a.rendered_at === null) {
    logEvent("offer_accepted.certificate_missing");
    return "certificate_missing";
  }
  const { senderId } = issuerOf(a.issuer);
  const staff = ((await env.DB.prepare(STAFF_READ).bind(senderId).all()).results ?? []) as {
    id: string;
    email: string;
    name: string;
  }[];

  const common = {
    typed_name: a.typed_name,
    // The address the acceptance was recorded with (07-N §4: the TecHaust-side body names it).
    email: a.email,
    accepted_at_ist: formatIstDateTime(a.accepted_at),
    title: a.title ?? "",
    number: a.number_display ?? "",
    version: String(a.version),
    // 07-Y item 13 (owner 2026-10-29): the client's email says "estimate" for an estimate.
    kind: a.type,
    // 07-N §4 (PENDING the owner's approval): what happens next.
    next_step: "we'll confirm the start date with you and send the first invoice",
  };
  const entity = { type: "acceptance", id: acceptanceId };
  const messages: EmailMessage[] = [];
  const told = new Set<string>();
  const add = (to: string, template: EmailMessage["template"], url: string) => {
    const key = to.toLowerCase();
    if (told.has(key)) return;
    told.add(key);
    messages.push({ template, to, data: { ...common, url }, entity });
  };

  // The person who accepted (unless their details were removed since): a confirmation link when they can still use the portal.
  if (a.live_contact) {
    let url = portalBase(env);
    if (a.portal_access === 1) {
      const { token, hash } = await mintOfferToken();
      // The link is bound to the contact's CURRENT address and the mail goes to the address recorded at acceptance, so it is minted only when
      // they are still the same (else the person holding that old address would receive a link for someone else's mailbox).
      const written = await env.DB.prepare(
        `INSERT INTO offer_links (token_hash, acceptance_id, document_id, version_group_id, client_id, contact_id, email, purpose, expires_at, created_at)
         SELECT ?1, a.id, a.document_id, ?3, ?4, c.id, lower(c.email), 'confirmation', ?5, ?6 FROM acceptances a JOIN contacts c ON c.id = a.contact_id
         WHERE a.id = ?2 AND c.portal_access = 1 AND c.anonymised_at IS NULL AND lower(c.email) = lower(a.email)`,
      )
        .bind(hash, acceptanceId, a.version_group_id, a.client_id, confirmationLinkExpiry(a.accepted_at), now)
        .run();
      if (written.meta.changes === 1) url = offerLinkUrl(portalBase(env), token);
    }
    add(a.email, "offer.accepted.client", url);
  }
  for (const s of staff) add(s.email, "offer.accepted.staff", `${adminBase(env)}/documents/${a.document_id}`);

  if (messages.length === 0) {
    logEvent("offer_accepted.nobody");
    return "none";
  }
  await env.EMAIL_QUEUE.sendBatch(messages.map((m) => ({ body: m })));
  logEvent("offer_accepted.queued", { emails: messages.length });
  return "queued";
}

// ---- approval.notify -----------------------------------------------------------------------------------------------------------

const APPROVAL_READ =
  "SELECT a.id, a.kind, a.status, a.reason, a.note, a.document_id, a.requested_by, d.title, d.version, d.total_minor, d.currency, d.catalogue_reference_minor AS reference_minor, (SELECT coalesce(sum(l.taxable_minor), 0) FROM document_lines l WHERE l.document_id = d.id AND l.catalogue_item_id IS NOT NULL) AS taxable_minor, ru.id AS requester_id, ru.email AS requester_email, ru.name AS requester_name, ru.status AS requester_status, du.name AS decider_name, d.type AS document_type, (SELECT p.number_display FROM documents p WHERE p.id = d.parent_id) AS parent_number, d.number_display, cl.display_name AS client_name, (cl.anonymised_at IS NOT NULL) AS client_gone FROM approvals a JOIN documents d ON d.id = a.document_id JOIN clients cl ON cl.id = d.client_id LEFT JOIN staff_users ru ON ru.id = a.requested_by LEFT JOIN staff_users du ON du.id = a.decided_by WHERE a.id = ?1";
const OWNERS_READ =
  "SELECT id, email FROM staff_users WHERE role = 'owner' AND status = 'active' ORDER BY id";

type IssueApprovalFacts = {
  status: string;
  reason: string | null;
  note: string | null;
  document_id: string;
  total_minor: number;
  currency: string;
  requester_name: string | null;
  decider_name: string | null;
  number_display: string | null;
  client_name: string;
  /** `documents.type` of the document (read by `APPROVAL_READ`): a credit or debit note carries its words in the emails (M5.3). */
  document_type?: string;
  /** M5.3: the number of the invoice a note is against (null for an invoice; the emails of notes name it, 07-T §8). */
  parent_number?: string | null;
};

/**
 * M5.3: the document's words in an issue email. An invoice is exactly what it was (no new key, the same strings); a credit or debit note adds `document_type` and
 * `parent_number` (07-T §8: the approval email names the invoice) and names itself in `title` and `request_reason` (the templates' variants are the designer's, `@techaust/email`).
 */
const noteWords = (a: IssueApprovalFacts) =>
  a.document_type === "credit_note" || a.document_type === "debit_note"
    ? {
        documentType: a.document_type === "credit_note" ? "credit note" : "debit note",
      }
    : null;

/**
 * The two emails of an invoice issue request (07-R §3; the same layout as the 07-O discount emails). They go out under the existing template keys with
 * `kind: "issue"` and the facts the issue wording needs (`client_name`, `number`), so no template key is added to the settings' list. The words of
 * 07-R §3 are the designer's template (`staffApprovalIssueRequested` / `staffApprovalIssueDecided` in `@techaust/email`): its `approval.requested` and
 * `approval.decided` cases take this branch when `data.kind === "issue"`.
 */
const issueRequestedEmail = (
  env: OfferEnv,
  a: IssueApprovalFacts,
  to: string,
  approvalId: string,
): EmailMessage => ({
  template: "approval.requested",
  to,
  data: {
    kind: "issue",
    requester_name: a.requester_name ?? "",
    client_name: a.client_name,
    request_reason: noteWords(a) ? `issuing a ${noteWords(a)?.documentType}` : "issuing an invoice",
    title: noteWords(a)
      ? `${noteWords(a)?.documentType} for ${a.client_name}`
      : `Invoice for ${a.client_name}`,
    ...(noteWords(a)
      ? { document_type: noteWords(a)?.documentType ?? "", parent_number: a.parent_number ?? "" }
      : {}),
    version: "1",
    amount: formatMoney(money(a.total_minor, a.currency === "USD" ? "USD" : "INR")),
    admin_url: `${adminBase(env)}/approvals/${approvalId}?kind=issue`,
  },
  entity: { type: "approval", id: approvalId },
});

const issueDecidedEmail = (
  env: OfferEnv,
  a: IssueApprovalFacts,
  to: string,
  approvalId: string,
): EmailMessage => ({
  template: "approval.decided",
  to,
  data: {
    kind: "issue",
    decision: a.status === "approved" ? "Approved" : "Rejected",
    approver_name: a.decider_name ?? "",
    client_name: a.client_name,
    // The number exists only once the invoice was issued (an approved request); a rejected one has none.
    number: a.status === "approved" ? (a.number_display ?? "") : "",
    title: noteWords(a)
      ? `${noteWords(a)?.documentType} for ${a.client_name}`
      : `Invoice for ${a.client_name}`,
    ...(noteWords(a)
      ? { document_type: noteWords(a)?.documentType ?? "", parent_number: a.parent_number ?? "" }
      : {}),
    version: "1",
    decision_note: a.note ?? "",
    admin_url: `${adminBase(env)}/invoices/${a.document_id}`,
  },
  entity: { type: "approval", id: approvalId },
});

export async function processApprovalNotify(env: OfferEnv, body: unknown): Promise<ApprovalNotifyResult> {
  const parsed = approvalNotifyMessage.safeParse(body);
  if (!parsed.success) {
    logEvent("approval_notify.invalid_message");
    return "invalid";
  }
  const { approvalId, event } = parsed.data;
  const [approval, owners] = await env.DB.batch([
    env.DB.prepare(APPROVAL_READ).bind(approvalId),
    env.DB.prepare(OWNERS_READ),
  ]);
  const a = approval?.results[0] as
    | {
        id: string;
        kind: string;
        status: string;
        reason: string | null;
        note: string | null;
        document_id: string;
        title: string | null;
        version: number;
        total_minor: number;
        currency: string;
        reference_minor: number | null;
        taxable_minor: number;
        requester_email: string | null;
        requester_name: string | null;
        requester_status: string | null;
        decider_name: string | null;
        number_display: string | null;
        parent_number: string | null;
        client_name: string;
        client_gone: number;
      }
    | undefined;
  if (!a) {
    logEvent("approval_notify.missing");
    return "missing";
  }
  const title = a.title ?? "Untitled";
  const entity = { type: "approval", id: approvalId };
  const messages: EmailMessage[] = [];
  if (event === "requested") {
    if (a.status !== "pending") {
      logEvent("approval_notify.ignored", { event });
      return "ignored";
    }
    // An issue request (M5.1, 07-R §3) is about an invoice for a client, not a titled version. An anonymised client is never named in an email.
    for (const o of (owners?.results ?? []) as { email: string }[])
      if (a.kind === "issue") {
        if (a.client_gone === 1) continue;
        messages.push(issueRequestedEmail(env, a, o.email, approvalId));
      } else
        messages.push({
          template: "approval.requested",
          to: o.email,
          data: {
            requester_name: a.requester_name ?? "",
            // 07-O's guard line: "{n} % off catalogue prices" (the stored reference against the stored taxable values).
            request_reason:
              a.kind === "discount"
                ? `${percentText(guardFigures(a.reference_minor ?? 0, a.taxable_minor).discountBp)} % off catalogue prices`
                : a.kind,
            title,
            version: String(a.version),
            amount: formatMoney(money(a.total_minor, a.currency === "USD" ? "USD" : "INR")),
            admin_url: `${adminBase(env)}/approvals/${approvalId}`,
          },
          entity,
        });
  } else {
    if (a.status !== "approved" && a.status !== "rejected") {
      logEvent("approval_notify.ignored", { event });
      return "ignored";
    }
    if (a.kind === "issue") {
      if (a.client_gone !== 1 && a.requester_email && a.requester_status === "active")
        messages.push(issueDecidedEmail(env, a, a.requester_email, approvalId));
    } else if (a.requester_email && a.requester_status === "active")
      messages.push({
        template: "approval.decided",
        to: a.requester_email,
        data: {
          decision: a.status === "approved" ? "Approved" : "Rejected",
          approver_name: a.decider_name ?? "",
          title,
          version: String(a.version),
          decision_note: a.note ?? "",
          admin_url: `${adminBase(env)}/documents/${a.document_id}`,
        },
        entity,
      });
  }
  if (messages.length === 0) {
    logEvent("approval_notify.nobody", { event });
    return "none";
  }
  await env.EMAIL_QUEUE.sendBatch(messages.map((m) => ({ body: m })));
  logEvent("approval_notify.queued", { event, emails: messages.length });
  return "queued";
}

// ---- the dispatcher the email queue calls ------------------------------------------------------------------------------------

/** What the queue does with the message: `retry` (come back later: the PDF or the certificate is not stored yet) or `ack`. */
export type OfferMessageVerdict = "ack" | "retry";

/** Routes one expansion body (`isOfferExpansionKind` already said it is one of ours) to its consumer. An unreadable body is acknowledged. */
export async function processOfferMessage(
  env: OfferEnv,
  body: { kind: string },
  now = Date.now(),
): Promise<OfferMessageVerdict> {
  switch (body.kind) {
    case "offer.send":
      return (await processOfferSend(env, body, now)) === "pdf_missing" ? "retry" : "ack";
    case "offer.decided":
      await processOfferDecided(env, body);
      return "ack";
    case "offer.accepted":
      return (await processOfferAccepted(env, body, now)) === "certificate_missing" ? "retry" : "ack";
    default:
      await processApprovalNotify(env, body);
      return "ack";
  }
}

// ---- after a PDF is stored (called by pdf.ts `onRendered`) ------------------------------------------------------------------

/** LD56: the expansion message of one send row, by the document's type: an invoice, proforma, credit note or debit note is `invoice.send`; a proposal or estimate is `offer.send`. */
export const sendMessageFor = (
  documentType: string,
  sendId: string,
): OfferSendMessage | InvoiceSendMessage =>
  isInvoiceFlowType(documentType) ? { kind: "invoice.send", sendId } : { kind: "offer.send", sendId };

/**
 * The document's PDF now exists: queue `offer.send` (a proposal or estimate) or `invoice.send` (an invoice, proforma or note, LD56) for every recipient still waiting (`queued_at IS NULL`), then stamp them. Idempotent: a
 * second call finds nothing, and a call that died between the two steps queues the same rows again (the email is claimed once by `email_log`).
 * A document that was never sent to anyone (an estimate staff only download) has no rows and costs one read.
 */
export async function queueWaitingSends(
  env: OfferEnv,
  documentId: string,
  now = Date.now(),
): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT s.id, d.type FROM document_sends s JOIN documents d ON d.id = s.document_id WHERE s.document_id = ?1 AND s.queued_at IS NULL AND s.cancelled_at IS NULL AND s.contact_id IS NOT NULL ORDER BY s.id LIMIT 20",
  )
    .bind(documentId)
    .all<{ id: string; type: string }>();
  if (results.length === 0) return 0;
  // LD56: the message follows the document's family. One document has one type, so the rows of one call all go the same way.
  await env.EMAIL_QUEUE.sendBatch(
    results.map((r) => ({
      body: sendMessageFor(r.type, r.id),
    })),
  );
  await env.DB.prepare(
    "UPDATE document_sends SET queued_at = ?2 WHERE document_id = ?1 AND queued_at IS NULL AND id IN (SELECT value FROM json_each(?3))",
  )
    .bind(documentId, now, JSON.stringify(results.map((r) => r.id)))
    .run();
  logEvent("offer.sends_queued", { count: results.length });
  return results.length;
}

/** The certificate is stored: the confirmation emails can follow (`offer.accepted`). */
export async function queueAcceptedConfirmation(env: OfferEnv, acceptanceId: string): Promise<void> {
  await env.EMAIL_QUEUE.send({ kind: "offer.accepted", acceptanceId } satisfies OfferAcceptedMessage);
}

// ---- offer.sweep ----------------------------------------------------------------------------------------------------------------

/** A sweep looks back this far only, so a row that can never be sent (the contact left) does not fill every run. */
export const OFFER_SWEEP_LOOKBACK_MS = 14 * 86_400_000;
/** An acceptance gets this long for its own certificate message before the sweep steps in. */
export const OFFER_SWEEP_GRACE_MS = 600_000;
export const OFFER_SWEEP_LIMIT = 20;

/** ?1 oldest created_at taken, ?2 today (IST). Forced onto the partial index `document_sends_waiting`: EXPLAIN-tested. */
export const WAITING_SENDS_SQL = `SELECT s.id FROM document_sends s INDEXED BY document_sends_waiting JOIN documents d ON d.id = s.document_id
  WHERE s.queued_at IS NULL AND s.cancelled_at IS NULL AND s.contact_id IS NOT NULL AND s.created_at >= ?1 AND d.pdf_sha256 IS NOT NULL
    AND d.type IN ('proposal', 'estimate') AND d.status IN ('sent', 'viewed') AND d.valid_until >= ?2
  ORDER BY s.created_at LIMIT ${OFFER_SWEEP_LIMIT}`;

/**
 * LD56: the same read for the invoice family (an issued, not void, document of an invoice type whose PDF is stored); `?1` oldest created_at taken. Same partial index. A send
 * whose document was voided or never got a PDF is not listed (a void invoice is never emailed; the render step queues the send when the PDF exists).
 */
export const WAITING_INVOICE_SENDS_SQL = `SELECT s.id FROM document_sends s INDEXED BY document_sends_waiting JOIN documents d ON d.id = s.document_id
  WHERE s.queued_at IS NULL AND s.cancelled_at IS NULL AND s.contact_id IS NOT NULL AND s.created_at >= ?1 AND d.pdf_sha256 IS NOT NULL
    AND d.type IN (${INVOICE_FLOW_TYPES.map((t) => `'${t}'`).join(", ")}) AND d.frozen_at IS NOT NULL AND d.status <> 'void' AND d.voided_at IS NULL
  ORDER BY s.created_at LIMIT ${OFFER_SWEEP_LIMIT}`;

/** ?1 newest accepted_at taken, ?2 oldest. Forced onto `acceptances_accepted_at`: EXPLAIN-tested. */
export const UNCERTIFIED_SQL = `SELECT a.id FROM acceptances a INDEXED BY acceptances_accepted_at
  WHERE a.accepted_at <= ?1 AND a.accepted_at >= ?2 AND a.certificate_r2_key IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM acceptance_certificates ce WHERE ce.acceptance_id = a.id)
  ORDER BY a.accepted_at LIMIT ${OFFER_SWEEP_LIMIT}`;

/**
 * Handles one `offer.sweep` (from the daily cron, which reads no D1): at most 20 waiting send rows whose PDF exists become `offer.send`, and at
 * most 20 acceptances older than 10 minutes without a certificate become `pdf.certificate`. One read batch, two `sendBatch`es at most.
 */
export async function processOfferSweep(
  env: OfferEnv,
  msg: OfferSweepMessage,
): Promise<{ sends: number; certificates: number }> {
  const [sends, certs, invoiceSends] = await env.DB.batch([
    env.DB.prepare(WAITING_SENDS_SQL).bind(msg.asOf - OFFER_SWEEP_LOOKBACK_MS, todayIst(msg.asOf)),
    env.DB.prepare(UNCERTIFIED_SQL).bind(msg.asOf - OFFER_SWEEP_GRACE_MS, msg.asOf - OFFER_SWEEP_LOOKBACK_MS),
    env.DB.prepare(WAITING_INVOICE_SENDS_SQL).bind(msg.asOf - OFFER_SWEEP_LOOKBACK_MS),
  ]);
  const offerIds = (sends?.results ?? []) as { id: string }[];
  const invoiceIds = (invoiceSends?.results ?? []) as { id: string }[];
  const certIds = (certs?.results ?? []) as { id: string }[];
  // At most 20 + 20 messages in one `sendBatch` (LD56: each row's message follows its document's family; the two reads never overlap).
  const sendMessages = [
    ...offerIds.map((r) => ({ body: { kind: "offer.send", sendId: r.id } satisfies OfferSendMessage })),
    ...invoiceIds.map((r) => ({ body: { kind: "invoice.send", sendId: r.id } satisfies InvoiceSendMessage })),
  ];
  const sendIds = [...offerIds, ...invoiceIds];
  if (sendMessages.length > 0) await env.EMAIL_QUEUE.sendBatch(sendMessages);
  if (certIds.length > 0)
    await env.PDF_QUEUE.sendBatch(
      certIds.map((r) => ({
        body: { v: 1, kind: "pdf.certificate", acceptanceId: r.id, hop: 0 } satisfies PdfCertificateMessage,
      })),
    );
  logEvent("offer.sweep", { sends: sendIds.length, certificates: certIds.length });
  return { sends: sendIds.length, certificates: certIds.length };
}
