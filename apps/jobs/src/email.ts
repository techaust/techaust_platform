// The email consumer (docs/05 §11.1) and the DLQ alerts. Every later sender (magic links, staff alerts, invoices)
// reuses this path. One message = one email:
//   validate -> create the `email_log` row (idempotent) -> claim it with a conditional UPDATE -> suppression and
//   (staging) allow-list checks -> render -> send.
// `email_log.status`: queued -> sending -> sent | skipped | failed. A retryable SES answer puts the row back to
// `queued` and the queue redelivers; a permanent one is `failed` and acknowledged.
import {
  type EmailMessage,
  emailMessage,
  isInvoiceExpansionKind,
  isOfferExpansionKind,
  leadMessage,
  stableId,
  staffAlertMessage,
} from "@techaust/core";
import { jobFailedTitle } from "@techaust/core/copy-zq";
import { BELL_COPY } from "@techaust/core/copy-zr";
import { istDate, toIsoDate } from "@techaust/core/dates";
import { parseRefundNotify, parseRefundReversed } from "@techaust/core/notifications";
import { ATTACHMENT_MAX_BYTES } from "@techaust/core/offers";
import {
  type Attachment,
  dlqAlert,
  hasNativeBase64,
  logTransport,
  type Rendered,
  renderEmail,
  SENDERS,
  sesTransport,
  type Transport,
  unsubscribeHeaders,
} from "@techaust/email";
import { erasureHashOf } from "./erasure.ts";
import { alertData, leadId } from "./leads.ts";
import { logEvent } from "./log.ts";

/** A `sending` claim older than this is taken as abandoned (the isolate died mid-send) and can be claimed again. */
export const CLAIM_TIMEOUT_MS = 5 * 60_000;

export type EmailResult = "sent" | "skipped" | "failed" | "duplicate" | "busy" | "retry" | "invalid";

/** The transport named by EMAIL_TRANSPORT: `ses`, or `log` (the default: nothing leaves the machine). */
export function transportFor(env: Env): Transport {
  if (env.EMAIL_TRANSPORT === "ses") {
    return sesTransport({
      accessKeyId: env.SES_ACCESS_KEY_ID,
      secretAccessKey: env.SES_SECRET_ACCESS_KEY,
      region: env.SES_REGION,
      configurationSet: env.SES_CONFIGURATION_SET,
    });
  }
  return logTransport();
}

const list = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** The log row's id: one per (template, entity, recipient), so a redelivered message cannot send twice. */
export const emailLogId = (m: Pick<EmailMessage, "template" | "to" | "entity">) =>
  stableId(`email:${m.template}:${m.entity.type}:${m.entity.id}:${m.to.toLowerCase()}`);

async function setStatus(
  db: D1Database,
  id: string,
  status: "sent" | "skipped" | "failed" | "queued",
  extra: { error?: string; sesMessageId?: string } = {},
  now = Date.now(),
) {
  await db
    .prepare(
      "UPDATE email_log SET status = ?2, error = ?3, ses_message_id = ?4, updated_at = ?5 WHERE id = ?1",
    )
    .bind(id, status, extra.error ?? null, extra.sesMessageId ?? null, now)
    .run();
}

export async function processEmail(
  env: Env,
  body: unknown,
  transport: Transport = transportFor(env),
  now = Date.now(),
  /** The queue's delivery count (1 = first). A redelivery sends link-only: an attachment that costs too much CPU would fail every time. */
  attempts = 1,
): Promise<EmailResult> {
  const parsed = emailMessage.safeParse(body);
  if (!parsed.success) {
    logEvent("email.invalid_message", { issues: parsed.error.issues.length });
    return "invalid";
  }
  const m = parsed.data;
  const to = m.to.toLowerCase();
  const id = emailLogId(m);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO email_log (id, to_email, template, entity_type, entity_id, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'queued', ?6, ?6)`,
  )
    .bind(id, to, m.template, m.entity.type, m.entity.id, now)
    .run();
  // The claim: one conditional UPDATE. Only the delivery that changes the row (queued -> sending, or an abandoned
  // `sending` claim older than 5 minutes) goes on to send; every other delivery, concurrent or a redelivery after the
  // email was sent, finds nothing to claim and sends nothing.
  const claim = await env.DB.prepare(
    `UPDATE email_log SET status = 'sending', updated_at = ?2
     WHERE id = ?1 AND (status = 'queued' OR (status = 'sending' AND updated_at < ?3))`,
  )
    .bind(id, now, now - CLAIM_TIMEOUT_MS)
    .run();
  if (claim.meta.changes !== 1) {
    // Only an email that has ended (sent, skipped or failed) is a duplicate. A row still `sending` is another delivery's
    // claim, or one abandoned by a delivery that threw: the queue retries after the claim has gone stale
    // (queue.ts), so the email is sent once either way and never silently dropped.
    const row = await env.DB.prepare("SELECT status FROM email_log WHERE id = ?1")
      .bind(id)
      .first<{ status: string }>();
    if (row?.status === "sending") {
      logEvent("email.busy", { template: m.template });
      return "busy";
    }
    logEvent("email.duplicate", { template: m.template });
    return "duplicate";
  }

  try {
    return await sendClaimed(env, m, to, id, transport, now, attempts);
  } catch (e) {
    // A database or network error before the email was handed to SES: give the claim back so the redelivery can send
    // at once (best effort; if this write fails too, the claim goes stale after 5 minutes and is taken again).
    await setStatus(env.DB, id, "queued", { error: "retry: error" }, now).catch(() => undefined);
    throw e;
  }
}

/**
 * The PDF an email carries (M4.5, ADM-PROP-07), or undefined when it goes link-only: no `DOCS` binding, the object is missing, it is over
 * the cap (the Free plan's 10 ms CPU: reading, base64 and signing the body all count), or this runtime has no native base64 (the fallback
 * costs about 37 ms per MB), or this is a redelivery (`attempts` above 1: a first try that ran out of CPU would do so again, and the link is
 * enough). Only keys on the allow-list reach here (the message schema). The reason is logged, never the key. One R2 read: the size comes with it.
 */
export async function attachmentFor(
  env: Env,
  a: { key: string; filename: string },
  attempts = 1,
): Promise<Attachment | undefined> {
  const docs: R2Bucket | undefined = env.DOCS;
  const skip = (why: string) => {
    logEvent("email.attachment_skipped", { why });
    return undefined;
  };
  if (!docs) return skip("no_binding");
  if (attempts > 1) return skip("redelivery");
  if (!hasNativeBase64()) return skip("no_native_base64");
  const object = await docs.get(a.key);
  if (!object) return skip("missing");
  if (object.size > ATTACHMENT_MAX_BYTES) {
    await object.body.cancel();
    return skip("too_large");
  }
  return {
    fileName: a.filename,
    contentType: "application/pdf",
    bytes: new Uint8Array(await object.arrayBuffer()),
  };
}

/**
 * L25 (S10): an email skipped as erased while a live record holds the address (a contact neither anonymised nor erased, or an unconverted lead not erased)
 * rings the active Owners once per record and IST day, by its client code or lead ref, never the address. One read and one write, only on this rare path.
 */
export const ERASED_HOLDER_SQL = `SELECT
    (SELECT json_object('id', c.client_id, 'ref', k.code) FROM contacts c JOIN clients k ON k.id = c.client_id
      WHERE c.email = ?1 AND c.anonymised_at IS NULL AND c.erased_hash IS NULL LIMIT 1) AS contact,
    (SELECT json_object('id', l.id, 'ref', l.ref) FROM leads l
      WHERE lower(l.contact_email) = ?1 AND l.client_id IS NULL AND l.erased_hash IS NULL LIMIT 1) AS lead`;
export const ERASED_SKIP_BELL_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), u.id, 'email.erased_skip', ?1, ?2, ?3, ?4 FROM staff_users u WHERE u.role = 'owner' AND u.status = 'active'`;

async function bellErasedSkip(env: Env, to: string, now: number): Promise<void> {
  const row = await env.DB.prepare(ERASED_HOLDER_SQL)
    .bind(to.trim().toLowerCase())
    .first<{ contact: string | null; lead: string | null }>();
  const holder = row?.contact
    ? { type: "client", ...(JSON.parse(row.contact) as { id: string; ref: string }) }
    : row?.lead
      ? { type: "lead", ...(JSON.parse(row.lead) as { id: string; ref: string }) }
      : null;
  if (!holder) return;
  const day = toIsoDate(istDate(now));
  await env.DB.prepare(ERASED_SKIP_BELL_SQL)
    .bind(
      holder.type,
      `${holder.id}:${day}`,
      BELL_COPY.erasedSkip(holder.ref),
      holder.type === "client" ? `/clients/${holder.id}` : `/leads/${holder.id}`,
    )
    .run();
}

async function sendClaimed(
  env: Env,
  m: EmailMessage,
  to: string,
  id: string,
  transport: Transport,
  now: number,
  attempts: number,
): Promise<EmailResult> {
  // A sign-in link that ran out while it waited (queue delay, retries) is never sent: the person asks for a new one.
  if (m.template === "portal.magic_link") {
    const expiresAt = Number(m.data.expires_at);
    if (Number.isFinite(expiresAt) && now > expiresAt) {
      await setStatus(env.DB, id, "skipped", { error: "expired" }, now);
      logEvent("email.skipped", { template: m.template, why: "expired" });
      return "skipped";
    }
  }
  // One read: the suppression list, and (M7.2, the M3.3 follow-up) whether a sign-in link's token row still exists. A link whose row is gone (the contact was
  // erased, or the token cleaned up) is never sent.
  const magic = m.template === "portal.magic_link" && m.entity.type === "magic_link" ? m.entity.id : null;
  // M7.4 (D.9, T7 F3; Settled by the lead on the safest reading, 2026-11-06 (08-C RB-46)): an erased address is stopped by its keyed hash (`h:` + HMAC), in the
  // same read (+0 reads).
  const erasedKey = `h:${await erasureHashOf(env, to)}`;
  const check = await env.DB.prepare(
    `SELECT EXISTS (SELECT 1 FROM email_suppressions WHERE email = ?1) AS suppressed,
       CASE WHEN ?2 IS NULL THEN 1 ELSE EXISTS (SELECT 1 FROM magic_link_tokens WHERE token_hash = ?2) END AS live,
       EXISTS (SELECT 1 FROM email_suppressions WHERE email = ?3) AS erased`,
  )
    .bind(to, magic, erasedKey)
    .first<{ suppressed: number; live: number; erased: number }>();
  if (check?.live === 0) {
    await setStatus(env.DB, id, "skipped", { error: "token_gone" }, now);
    logEvent("email.skipped", { template: m.template, why: "token_gone" });
    return "skipped";
  }
  if (check?.erased === 1) {
    await setStatus(env.DB, id, "skipped", { error: "erased" }, now);
    logEvent("email.skipped", { template: m.template, why: "erased" });
    await bellErasedSkip(env, to, now);
    return "skipped";
  }
  if (check?.suppressed === 1) {
    await setStatus(env.DB, id, "skipped", { error: "suppressed" }, now);
    logEvent("email.skipped", { template: m.template, why: "suppressed" });
    return "skipped";
  }
  // Staging never emails strangers (the SES sandbox allows only verified inboxes anyway).
  if (env.ENVIRONMENT === "staging" && !list(env.EMAIL_ALLOWED_RECIPIENTS).includes(to)) {
    await setStatus(env.DB, id, "skipped", { error: "recipient not in allow-list" }, now);
    logEvent("email.skipped", { template: m.template, why: "not_allowed" });
    return "skipped";
  }

  // A stored PDF on the email (M4.5): read from DOCS, or the email goes link-only (and says so: `attached` becomes "0").
  let data = m.data;
  let attachments: Attachment[] | undefined;
  if (m.attachment) {
    const file = await attachmentFor(env, m.attachment, attempts);
    if (file) attachments = [file];
    else data = { ...m.data, attached: "0" };
  }

  let rendered: ReturnType<typeof renderEmail>;
  try {
    rendered = renderEmail(m.template, data, { assetBase: env.EMAIL_ASSET_BASE });
  } catch {
    await setStatus(env.DB, id, "failed", { error: "render failed" }, now);
    logEvent("email.failed", { template: m.template, why: "render" });
    return "failed";
  }

  // M7.2 (C.4, L6, L8): every send carries the `env` tag (the SES hook applies only events of its own environment); only a non-transactional email (the weekly
  // digest) carries the one-click headers, and only when its `unsubscribe_url` is exactly this Worker's `/u?t=` link, and goes on the marketing configuration set.
  const headers = rendered.nonTransactional
    ? unsubscribeHeaders(data.unsubscribe_url, env.PUBLIC_HOOKS_URL)
    : undefined;
  const result = await transport.send({
    from: rendered.from,
    to,
    replyTo: rendered.replyTo,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    ...(attachments ? { attachments } : {}),
    ...(headers ? { headers } : {}),
    ...(rendered.nonTransactional && env.SES_MARKETING_CONFIGURATION_SET
      ? { configurationSet: env.SES_MARKETING_CONFIGURATION_SET }
      : {}),
    tags: { env: env.ENVIRONMENT },
  });
  if (result.kind === "sent") {
    // The email has left. If the status write fails, the message must NOT be retried (that would send it again): the
    // row stays `sending`, which no later delivery claims for 5 minutes, and the delivery is acknowledged.
    try {
      await setStatus(env.DB, id, "sent", { sesMessageId: result.messageId }, now);
    } catch (e) {
      logEvent("email.status_write_failed", {
        template: m.template,
        error: e instanceof Error ? e.name : "unknown",
      });
    }
    logEvent("email.sent", { template: m.template });
    return "sent";
  }
  if (result.kind === "permanent") {
    await setStatus(env.DB, id, "failed", { error: result.error }, now);
    logEvent("email.failed", { template: m.template, why: result.error });
    return "failed";
  }
  // A retry answer includes the transport's 8 s timeout (packages/email/src/transport.ts). SES may have accepted the email before the timeout fired, so the retry
  // can send it twice: at-least-once delivery is ACCEPTED (full audit A6 4, FX-1); a lost transactional email is the worse outcome. The backoff is the queue's
  // (`emailRetryDelay` in queue.ts: 60 s doubling to 1 h, 10 tries).
  await setStatus(env.DB, id, "queued", { error: `retry: ${result.error}` }, now);
  logEvent("email.retry", { template: m.template, why: result.error });
  return "retry";
}

/** Early check finding 4: a dead letter marks only an email that never left as failed, keeping the message id (`?1` the row, `?2` now). */
export const DEAD_LETTER_SQL =
  "UPDATE email_log SET status = 'failed', error = 'dead-lettered', updated_at = ?2 WHERE id = ?1 AND status IN ('queued', 'sending')";

/**
 * The owners' `job.failed` bell (`?1` `<queue>:<IST day>`, `?2` the title, `?3` the link): one per owner, queue and IST day (the unique `(user_id, kind,
 * entity_id)`).
 */
export const JOB_FAILED_BELL_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), o.id, 'job.failed', 'queue', ?1, ?2, ?3 FROM staff_users o WHERE o.role = 'owner' AND o.status = 'active'`;

/**
 * Full audit M6–M7 AU11 (B6 L5): how the dead-letter alert names the M7.2 jobs that used to get only the generic alert (builder's words for the lead; never
 * an id, a name or an address).
 */
export const DEAD_LETTER_KIND_NAMES: Readonly<Record<string, string>> = {
  "refund.notify": "refund email to a client",
  // AU61 (review L2): the email about a refund that came back (AU1); builder's words for the lead.
  "refund.reversed": "the email telling a client their refund came back",
  "staff.notify": "staff notification email",
  "digest.weekly": "owners' weekly digest",
  "signin.unfinished": "unfinished sign-in alert",
  "bells.sweep": "hourly staff email check",
};

/** AU11 L5: the owners' bell of a refund email that ran out of tries (builder's draft for the lead), naming the client by its code only. */
export const REFUND_EMAIL_FAILED_BELL =
  "The email about a refund to {client_code} couldn't be sent. Tell the client about the refund yourself.";

/**
 * AU11 L5: one bell per active owner and refund (`?1` the refund, `?2` the title with `{client_code}`), unique per member, kind and refund; nothing for a
 * refund that is not ours any more.
 */
export const REFUND_EMAIL_FAILED_BELL_SQL = `INSERT OR IGNORE INTO notifications (id, user_id, kind, entity_type, entity_id, title, link)
  SELECT 'n_' || lower(hex(randomblob(16))), u.id, 'refund.email_failed', 'refund', r.id, replace(?2, '{client_code}', k.code), '/payments?tab=refunds'
  FROM payment_refunds r JOIN clients k ON k.id = r.client_id JOIN staff_users u ON u.role = 'owner' AND u.status = 'active'
  WHERE r.id = ?1`;

/** Where the `job.failed` bell opens (the lead's answer to review 1): the email queue's on the email log's failed emails; the others on the dashboard. */
export const jobFailedLink = (queue: string): string =>
  queue.endsWith("-email-dlq") ? "/emails?status=failed" : "/";

/**
 * A dead-lettered message: one log line without personal data and an alert to LEAD_ALERT_TO, sent directly through the
 * transport (not the email queue), so a broken email queue cannot swallow it. False when the alert could not be sent.
 */
export async function processDeadLetter(
  env: Env,
  queue: string,
  body: unknown,
  transport: Transport = transportFor(env),
): Promise<boolean> {
  const opts = { assetBase: env.EMAIL_ASSET_BASE };
  let rendered: Rendered | undefined;
  let ref: string | undefined;

  // A dead-lettered lead must not be lost (NFR-7): the alert carries the whole lead summary, the same content and
  // recipient as the normal `lead.alert`, with the queue in the subject. The log line carries the reference only.
  const lead = queue.endsWith("-leads-dlq") ? leadMessage.safeParse(body) : undefined;
  if (lead?.success) {
    // After a reference clash the lead is stored under a new reference: name the stored one when it exists.
    const stored = await env.DB.prepare("SELECT ref FROM leads WHERE id = ?1")
      .bind(leadId(lead.data))
      .first<{ ref: string }>()
      .catch(() => null);
    ref = stored?.ref ?? lead.data.ref;
    rendered = renderEmail("lead.alert", { ...alertData(env, lead.data, ref), failed_queue: queue }, opts);
  } else if (queue.endsWith("-email-dlq")) {
    // A failed email: which template and which lead (its reference), never the address, the link or the text. A failed
    // staff alert is named as "staff alert": its audit ID, the member and the summary stay out of the alert.
    const email = emailMessage.safeParse(body);
    if (!email.success && staffAlertMessage.safeParse(body).success) {
      rendered = dlqAlert({ queue, admin_url: env.ADMIN_URL, template: "staff alert" }, opts);
    } else if (!email.success && isOfferExpansionKind(body)) {
      // M4.5: which step failed, never the ids, the names or the addresses.
      const template = {
        "offer.send": "offer email",
        "offer.accepted": "acceptance confirmation",
        "approval.notify": "approval notice",
      }[body.kind as string];
      rendered = dlqAlert({ queue, admin_url: env.ADMIN_URL, template: template ?? "offer message" }, opts);
    } else if (!email.success && isInvoiceExpansionKind(body)) {
      // M5.4: which step failed, never the ids, the names or the addresses. A reminder that dead-letters may have been claimed without its emails going out: the owners hear of it here.
      const template = body.kind === "invoice.send" ? "invoice email" : "payment reminder";
      rendered = dlqAlert({ queue, admin_url: env.ADMIN_URL, template }, opts);
    } else if (email.success) {
      ref = email.data.entity.type === "lead" ? email.data.entity.id : undefined;
      // The email's log row ends as failed, so it never reads as still pending (best effort). M7.2 (early check finding 4): only a row that never left (queued
      // or sending); a row SES took (sent, or moved on by its events) keeps its status and its message id, which the SES hook matches on.
      await env.DB.prepare(DEAD_LETTER_SQL)
        .bind(emailLogId(email.data), Date.now())
        .run()
        .catch(() => undefined);
      rendered = dlqAlert({ queue, admin_url: env.ADMIN_URL, template: email.data.template, ref }, opts);
    }
  }
  // Full audit M6–M7 AU11 (B6 L5): the M7.2 kinds are named in the alert (never their ids); a refund email that ran out of tries also rings the owners with
  // the client's code, since the hourly sweep's 75-minute window has passed by then and the client would never hear of the refund.
  const kind = (body as { kind?: unknown } | null)?.kind;
  const named = typeof kind === "string" ? DEAD_LETTER_KIND_NAMES[kind] : undefined;
  if (!rendered && named) {
    rendered = dlqAlert({ queue, admin_url: env.ADMIN_URL, template: named }, opts);
    if (kind === "refund.notify" || kind === "refund.reversed") {
      // AU61 (review L2): a returned-refund email that ran out of tries rings the same refund bell (one per owner and refund).
      const m = kind === "refund.notify" ? parseRefundNotify(body) : parseRefundReversed(body);
      if (m)
        await env.DB.prepare(REFUND_EMAIL_FAILED_BELL_SQL)
          .bind(m.refundId, REFUND_EMAIL_FAILED_BELL)
          .run()
          .catch(() => logEvent("refund_notify.dead_letter_bell_failed", {}));
    }
  }
  logEvent("queue.dead_letter", {
    queue,
    ref,
    readable: rendered !== undefined,
    ...(named ? { kind: named } : {}),
  });
  rendered ??= dlqAlert({ queue, admin_url: env.ADMIN_URL }, opts);
  // M7.2 (run file D, L13): the owners' bell `job.failed`, once per queue per IST day (best effort; the alert email below is the record).
  await env.DB.prepare(JOB_FAILED_BELL_SQL)
    .bind(`${queue}:${toIsoDate(istDate(Date.now()))}`, jobFailedTitle(queue), jobFailedLink(queue))
    .run()
    .catch(() => logEvent("queue.dead_letter_bell_failed", { queue }));

  const r = await transport.send({
    from: SENDERS.hello,
    to: env.LEAD_ALERT_TO,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  if (r.kind !== "sent") logEvent("queue.dead_letter_alert_failed", { queue, ref, why: r.error });
  return r.kind === "sent";
}
