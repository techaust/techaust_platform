// The queue entry point: routes a batch to its consumer by queue name (`techaust-<env>-leads`, `-leads-dlq`, `-email`,
// `-email-dlq`). Each message is acknowledged on success and retried when its consumer throws or asks for a retry;
// after 5 tries the queue moves it to the dead-letter queue (wrangler.jsonc).
import { isPurgeMessage, isPurgeScanMessage } from "@techaust/core";
import { CLAIM_TIMEOUT_MS, processDeadLetter, processEmail } from "./email.ts";
import { processLead } from "./leads.ts";
import { logEvent, noteInvocation } from "./log.ts";
import { enqueueDue, purgeLead } from "./purge.ts";
import { processStaffAlert } from "./staff-alerts.ts";

/** A staff alert (`{ kind: "staff.alert", auditId }`) shares the email queue with ordinary emails (M2.4b). */
const isStaffAlert = (body: unknown) =>
  typeof body === "object" && body !== null && (body as { kind?: unknown }).kind === "staff.alert";

/**
 * A dead-lettered message whose alert could not be sent is retried with long, growing delays (5 minutes, doubling, at
 * most 4 hours) and is never dropped quietly: the consumer's `max_retries` is the queue maximum (wrangler.jsonc), so the
 * Free plan's 24-hour message retention is the only limit left, and each failure writes a log line with the reference.
 */
export const dlqRetryDelay = (attempts: number): number =>
  Math.min(4 * 3_600, 300 * 2 ** Math.max(0, attempts - 1));

export async function handleQueue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  noteInvocation();
  const queue = batch.queue;
  const isDlq = queue.endsWith("-leads-dlq") || queue.endsWith("-email-dlq");
  for (const message of batch.messages) {
    try {
      if (isDlq && (isPurgeMessage(message.body) || isPurgeScanMessage(message.body))) {
        // A clean-up message that ran out of tries: the next daily run enqueues the lead again, so no alert and no retry.
        logEvent("lead.purge_dead_letter", { queue });
        message.ack();
      } else if (isDlq) {
        if (await processDeadLetter(env, queue, message.body)) message.ack();
        else message.retry({ delaySeconds: dlqRetryDelay(message.attempts) });
      } else if (queue.endsWith("-leads") && isPurgeScanMessage(message.body)) {
        await enqueueDue(env, message.body.asOf, message.body.cursor);
        message.ack();
      } else if (queue.endsWith("-leads") && isPurgeMessage(message.body)) {
        await purgeLead(env, message.body.leadId);
        message.ack();
      } else if (queue.endsWith("-leads")) {
        await processLead(env, message.body);
        message.ack();
      } else if (queue.endsWith("-email") && isStaffAlert(message.body)) {
        // Expanded into ordinary emails; an alert that cannot be read or has no row is acknowledged (a retry cannot help).
        await processStaffAlert(env, message.body);
        message.ack();
      } else if (queue.endsWith("-email")) {
        const result = await processEmail(env, message.body);
        if (result === "retry") message.retry({ delaySeconds: 30 });
        // Another claim holds the email: come back once that claim would have gone stale (it counts as a try, so a claim
        // that never clears still ends in the dead-letter queue and its alert).
        else if (result === "busy") message.retry({ delaySeconds: CLAIM_TIMEOUT_MS / 1_000 + 30 });
        else message.ack();
      } else {
        logEvent("queue.unknown", { queue });
        message.ack();
      }
    } catch (e) {
      // A database or network error: let the queue redeliver. The error text may carry values, so only its type is logged.
      logEvent("queue.error", {
        queue,
        attempts: message.attempts,
        error: e instanceof Error ? e.name : "unknown",
      });
      message.retry({
        delaySeconds: isDlq ? dlqRetryDelay(message.attempts) : Math.min(300, 10 * 2 ** message.attempts),
      });
    }
  }
}
