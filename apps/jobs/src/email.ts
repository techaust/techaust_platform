// The email consumer (docs/05 §11.1) and the DLQ alerts. Every later sender (magic links, staff alerts, invoices)
// reuses this path. One message = one email:
//   validate -> claim the `email_log` row (idempotent) -> suppression and (staging) allow-list checks -> render -> send.
// `email_log.status`: queued -> sent | skipped | failed. A retryable SES answer leaves the row `queued` and the queue
// redelivers; a permanent one is `failed` and acknowledged.
import { type EmailMessage, emailMessage, stableId } from "@techaust/core";
import { dlqAlert, logTransport, renderEmail, SENDERS, sesTransport, type Transport } from "@techaust/email";
import { logEvent } from "./log.ts";

export type EmailResult = "sent" | "skipped" | "failed" | "duplicate" | "retry" | "invalid";

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
  const row = await env.DB.prepare("SELECT status FROM email_log WHERE id = ?1")
    .bind(id)
    .first<{ status: string }>();
  if (row && row.status !== "queued") {
    logEvent("email.duplicate", { template: m.template, status: row.status });
    return "duplicate";
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

  let rendered: ReturnType<typeof renderEmail>;
  try {
    rendered = renderEmail(m.template, m.data);
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
  });
  if (result.kind === "sent") {
    await setStatus(env.DB, id, "sent", { sesMessageId: result.messageId }, now);
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
  transport: Transport = transportFor(env),
): Promise<boolean> {
  logEvent("queue.dead_letter", { queue });
  const alert = dlqAlert({ queue, admin_url: env.ADMIN_URL });
  const r = await transport.send({
    from: SENDERS.hello,
    to: env.LEAD_ALERT_TO,
    subject: alert.subject,
    html: alert.html,
    text: alert.text,
  });
  if (r.kind !== "sent") logEvent("queue.dead_letter_alert_failed", { queue, why: r.error });
  return r.kind === "sent";
}
