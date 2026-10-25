// The email consumer (docs/05 §11.1) and the DLQ alerts. Every later sender (magic links, staff alerts, invoices)
// reuses this path. One message = one email:
//   validate -> create the `email_log` row (idempotent) -> claim it with a conditional UPDATE -> suppression and
//   (staging) allow-list checks -> render -> send.
// `email_log.status`: queued -> sending -> sent | skipped | failed. A retryable SES answer puts the row back to
// `queued` and the queue redelivers; a permanent one is `failed` and acknowledged.
import {
  type EmailMessage,
  emailMessage,
  isOfferExpansionKind,
  leadMessage,
  stableId,
  staffAlertMessage,
} from "@techaust/core";
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
} from "@techaust/email";
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
    return await sendClaimed(env, m, to, id, transport, now);
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
 * costs about 37 ms per MB). Only keys on the allow-list reach here (the message schema). The reason is logged, never the key.
 */
export async function attachmentFor(
  env: Env,
  a: { key: string; filename: string },
): Promise<Attachment | undefined> {
  const docs: R2Bucket | undefined = env.DOCS;
  const skip = (why: string) => {
    logEvent("email.attachment_skipped", { why });
    return undefined;
  };
  if (!docs) return skip("no_binding");
  if (!hasNativeBase64()) return skip("no_native_base64");
  const head = await docs.head(a.key);
  if (!head) return skip("missing");
  if (head.size > ATTACHMENT_MAX_BYTES) return skip("too_large");
  const object = await docs.get(a.key);
  if (!object) return skip("missing");
  return {
    fileName: a.filename,
    contentType: "application/pdf",
    bytes: new Uint8Array(await object.arrayBuffer()),
  };
}

async function sendClaimed(
  env: Env,
  m: EmailMessage,
  to: string,
  id: string,
  transport: Transport,
  now: number,
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
  const suppressed = await env.DB.prepare("SELECT 1 AS x FROM email_suppressions WHERE email = ?1")
    .bind(to)
    .first();
  if (suppressed) {
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
    const file = await attachmentFor(env, m.attachment);
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

  const result = await transport.send({
    from: rendered.from,
    to,
    replyTo: rendered.replyTo,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    ...(attachments ? { attachments } : {}),
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
  await setStatus(env.DB, id, "queued", { error: `retry: ${result.error}` }, now);
  logEvent("email.retry", { template: m.template, why: result.error });
  return "retry";
}

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
    } else if (email.success) {
      ref = email.data.entity.type === "lead" ? email.data.entity.id : undefined;
      // The email's log row ends as failed, so it never reads as still pending (best effort).
      await setStatus(env.DB, emailLogId(email.data), "failed", { error: "dead-lettered" }, Date.now()).catch(
        () => undefined,
      );
      rendered = dlqAlert({ queue, admin_url: env.ADMIN_URL, template: email.data.template, ref }, opts);
    }
  }
  logEvent("queue.dead_letter", { queue, ref, readable: rendered !== undefined });
  rendered ??= dlqAlert({ queue, admin_url: env.ADMIN_URL }, opts);

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
