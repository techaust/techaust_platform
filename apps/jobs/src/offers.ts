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
// VERIFY WITH CA/LEGAL: the confirmation link and the stored address of the person who accepted.
import {
  approvalNotifyMessage,
  type EmailMessage,
  formatDate,
  formatIstDateTime,
  formatMoney,
  money,
  type OfferAcceptedMessage,
  type OfferSendMessage,
  offerAcceptedMessage,
  offerDecidedMessage,
  offerSendMessage,
  parseIsoDate,
} from "@techaust/core";
import {
  ATTACHMENT_KEY,
  confirmationLinkExpiry,
  mintOfferToken,
  offerLinkExpiry,
  offerLinkUrl,
  todayIst,
} from "@techaust/core/offers";
import type { OfferSweepMessage, PdfCertificateMessage } from "@techaust/core/pdf-jobs";
import { logEvent } from "./log.ts";

/** The jobs Env (PORTAL_URL arrived with M4.4 phase 2). */
type OfferEnv = Env;

export type OfferSendResult = "queued" | "missing" | "refused" | "pdf_missing" | "invalid";
export type OfferDecidedResult = "noted" | "missing" | "ignored" | "invalid";
export type OfferAcceptedResult = "queued" | "missing" | "certificate_missing" | "none" | "invalid";
export type ApprovalNotifyResult = "queued" | "missing" | "none" | "ignored" | "invalid";

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const adminBase = (env: Env) => env.ADMIN_URL.replace(/\/+$/, "");
const portalBase = (env: OfferEnv) => (env.PORTAL_URL ?? "").replace(/\/+$/, "");
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
  "SELECT s.id, s.document_id, s.version_group_id, s.client_id, s.contact_id, s.attach_pdf, s.queued_at, s.cancelled_at, d.status, d.valid_until, d.type, d.title, d.number_display, d.version, d.total_minor, d.currency, d.pdf_sha256, d.pdf_r2_key, d.issuer, c.id AS live_contact, c.name AS contact_name, lower(c.email) AS contact_email FROM document_sends s JOIN documents d ON d.id = s.document_id LEFT JOIN contacts c ON c.id = s.contact_id AND c.client_id = s.client_id AND c.portal_access = 1 AND c.anonymised_at IS NULL WHERE s.id = ?1";

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
  // Refused (acknowledged): links were revoked, the person lost access or was removed, or the offer is not open any more. The row is marked
  // cancelled, so the offer page shows "not sent" instead of "queued" forever (a send that was already cancelled stays as it is).
  if (
    row.cancelled_at !== null ||
    !row.live_contact ||
    !row.contact_email ||
    !["sent", "viewed"].includes(row.status) ||
    (row.valid_until !== null && row.valid_until < todayIst(now)) ||
    row.valid_until === null
  ) {
    logEvent("offer_send.refused", {
      why: row.cancelled_at !== null ? "cancelled" : !row.live_contact ? "contact" : "document",
    });
    if (row.cancelled_at === null) await markNotSent(env, sendId, now);
    return "refused";
  }
  if (row.pdf_sha256 === null || row.pdf_r2_key === null) {
    logEvent("offer_send.pdf_missing");
    return "pdf_missing";
  }
  const { token, hash } = await mintOfferToken();
  // One batch: the link (only while the contact is still live and the send is not cancelled) and the row's queued stamp (set once).
  const [linked] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO offer_links (token_hash, send_id, document_id, version_group_id, client_id, contact_id, email, purpose, expires_at, created_at)
       SELECT ?1, s.id, s.document_id, s.version_group_id, s.client_id, c.id, lower(c.email), 'offer', ?3, ?4
       FROM document_sends s JOIN contacts c ON c.id = s.contact_id AND c.client_id = s.client_id AND c.portal_access = 1 AND c.anonymised_at IS NULL
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
      first_name: first(row.contact_name ?? ""),
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
    "SELECT id, status, title, version, issuer FROM documents WHERE id = ?1 AND type IN ('proposal', 'estimate')",
  )
    .bind(documentId)
    .first()) as {
    id: string;
    status: string;
    title: string | null;
    version: number;
    issuer: string | null;
  } | null;
  if (!doc) {
    logEvent("offer_decided.missing");
    return "missing";
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
     WHERE u.status = 'active' AND (u.role = 'owner' OR u.id = ?5)`,
  )
    .bind(`offer.${decision}`, documentId, title, `/documents/${documentId}`, senderId)
    .run();
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
  "SELECT a.id, a.kind, a.status, a.reason, a.note, a.document_id, a.requested_by, d.title, d.version, d.total_minor, d.currency, ru.id AS requester_id, ru.email AS requester_email, ru.name AS requester_name, ru.status AS requester_status, du.name AS decider_name FROM approvals a JOIN documents d ON d.id = a.document_id LEFT JOIN staff_users ru ON ru.id = a.requested_by LEFT JOIN staff_users du ON du.id = a.decided_by WHERE a.id = ?1";
const OWNERS_READ =
  "SELECT id, email FROM staff_users WHERE role = 'owner' AND status = 'active' ORDER BY id";

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
        requester_email: string | null;
        requester_name: string | null;
        requester_status: string | null;
        decider_name: string | null;
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
    for (const o of (owners?.results ?? []) as { email: string }[])
      messages.push({
        template: "approval.requested",
        to: o.email,
        data: {
          requester_name: a.requester_name ?? "",
          // [Placeholder, 07-N] the words for what is being approved.
          request_reason: a.kind === "discount" ? "a discount" : a.kind,
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
    if (a.requester_email && a.requester_status === "active")
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

/**
 * The offer's PDF now exists: queue `offer.send` for every recipient still waiting (`queued_at IS NULL`), then stamp them. Idempotent: a
 * second call finds nothing, and a call that died between the two steps queues the same rows again (the email is claimed once by `email_log`).
 * A document that was never sent to anyone (an estimate staff only download) has no rows and costs one read.
 */
export async function queueWaitingSends(
  env: OfferEnv,
  documentId: string,
  now = Date.now(),
): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM document_sends WHERE document_id = ?1 AND queued_at IS NULL AND cancelled_at IS NULL AND contact_id IS NOT NULL ORDER BY id LIMIT 20",
  )
    .bind(documentId)
    .all<{ id: string }>();
  if (results.length === 0) return 0;
  await env.EMAIL_QUEUE.sendBatch(
    results.map((r) => ({ body: { kind: "offer.send", sendId: r.id } satisfies OfferSendMessage })),
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
    AND d.status IN ('sent', 'viewed') AND d.valid_until >= ?2
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
  const [sends, certs] = await env.DB.batch([
    env.DB.prepare(WAITING_SENDS_SQL).bind(msg.asOf - OFFER_SWEEP_LOOKBACK_MS, todayIst(msg.asOf)),
    env.DB.prepare(UNCERTIFIED_SQL).bind(msg.asOf - OFFER_SWEEP_GRACE_MS, msg.asOf - OFFER_SWEEP_LOOKBACK_MS),
  ]);
  const sendIds = (sends?.results ?? []) as { id: string }[];
  const certIds = (certs?.results ?? []) as { id: string }[];
  if (sendIds.length > 0)
    await env.EMAIL_QUEUE.sendBatch(
      sendIds.map((r) => ({ body: { kind: "offer.send", sendId: r.id } satisfies OfferSendMessage })),
    );
  if (certIds.length > 0)
    await env.PDF_QUEUE.sendBatch(
      certIds.map((r) => ({
        body: { v: 1, kind: "pdf.certificate", acceptanceId: r.id, hop: 0 } satisfies PdfCertificateMessage,
      })),
    );
  logEvent("offer.sweep", { sends: sendIds.length, certificates: certIds.length });
  return { sends: sendIds.length, certificates: certIds.length };
}
