// The queue entry point: routes a batch to its consumer by queue name (`techaust-<env>-leads`, `-leads-dlq`, `-email`,
// `-email-dlq`). Each message is acknowledged on success and retried when its consumer throws or asks for a retry;
// after 5 tries the queue moves it to the dead-letter queue (wrangler.jsonc).
import { isOfferExpansionKind, isPurgeMessage, isPurgeScanMessage } from "@techaust/core";
import { isExpireKind, isExpireMessage } from "@techaust/core/expiry";
import { isLutCheckKind, isLutCheckMessage } from "@techaust/core/invoices";
import { isPdfKind } from "@techaust/core/pdf-jobs";
import { isStatsKind, isStatsMessage } from "@techaust/core/stats";
import { CLAIM_TIMEOUT_MS, processDeadLetter, processEmail } from "./email.ts";
import { logExpireDeadLetter, processExpire, skipExpire } from "./expire.ts";
import { processLead } from "./leads.ts";
import { logEvent, noteInvocation } from "./log.ts";
import { logLutCheckDeadLetter, processLutCheck, skipLutCheck } from "./lut-check.ts";
import { processOfferMessage } from "./offers.ts";
import { processPdf, processPdfDeadLetter } from "./pdf.ts";
import { enqueueDue, purgeLead } from "./purge.ts";
import { processStaffAlert } from "./staff-alerts.ts";
import { logStatsDeadLetter, processStats, skipStats } from "./stats.ts";

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
  const isPdfDlq = queue.endsWith("-pdf-dlq");
  const isDlq = queue.endsWith("-leads-dlq") || queue.endsWith("-email-dlq") || isPdfDlq;
  for (const message of batch.messages) {
    try {
      if (isPdfDlq) {
        // The PDF family has its own dead-letter queue: a bell for the owners, then done (the daily sweep tries the document again).
        await processPdfDeadLetter(env, message.body);
        message.ack();
      } else if (queue.endsWith("-pdf")) {
        // Snapshot, render and sweep (M4.4). A body of the family this version cannot use is logged and acknowledged inside.
        await processPdf(env, message.body);
        message.ack();
      } else if (isDlq && (isPurgeMessage(message.body) || isPurgeScanMessage(message.body))) {
        // A clean-up message that ran out of tries: the next daily run enqueues the lead again, so no alert and no retry.
        logEvent("lead.purge_dead_letter", { queue });
        message.ack();
      } else if (isDlq && isOfferExpansionKind(message.body) && message.body.kind === "offer.decided") {
        // A bell that ran out of tries: the decision itself is stored and shows on the proposal page, so no alert and no retry.
        logEvent("offer.decided_dead_letter", { queue });
        message.ack();
      } else if (isDlq && isStatsKind(message.body)) {
        // A statistics message that ran out of tries: the next night records its date again, so no alert and no retry.
        logStatsDeadLetter(queue, message.body);
        message.ack();
      } else if (isDlq && isExpireKind(message.body)) {
        // An expiry message that ran out of tries: the next daily run picks the same offers up again, so no alert and no retry.
        logExpireDeadLetter(queue);
        message.ack();
      } else if (isDlq && isLutCheckKind(message.body)) {
        // A LUT check that ran out of tries: tomorrow's run checks again, so no alert and no retry.
        logLutCheckDeadLetter(queue);
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
      } else if (queue.endsWith("-leads") && isStatsKind(message.body)) {
        // Before the lead fall-through, so a statistics body (valid or not) can never become a lead.
        if (isStatsMessage(message.body)) await processStats(env, message.body);
        else skipStats(message.body);
        message.ack();
      } else if (queue.endsWith("-leads") && isExpireKind(message.body)) {
        // After the statistics, before the lead fall-through, so an expiry body (valid or not) can never become a lead.
        if (isExpireMessage(message.body)) await processExpire(env, message.body);
        else skipExpire();
        message.ack();
      } else if (queue.endsWith("-leads") && isLutCheckKind(message.body)) {
        // The daily LUT check (M5.2): before the lead fall-through, so a `lut.check` body (valid or not) can never become a lead.
        if (isLutCheckMessage(message.body)) await processLutCheck(env, message.body);
        else skipLutCheck();
        message.ack();
      } else if (queue.endsWith("-leads") && isPdfKind(message.body)) {
        // A PDF body belongs on the PDF queue; here it is logged and dropped, so it can never become a lead.
        logEvent("pdf.wrong_queue", { queue });
        message.ack();
      } else if (queue.endsWith("-leads")) {
        await processLead(env, message.body);
        message.ack();
      } else if (queue.endsWith("-email") && isStaffAlert(message.body)) {
        // Expanded into ordinary emails; an alert that cannot be read or has no row is acknowledged (a retry cannot help).
        await processStaffAlert(env, message.body);
        message.ack();
      } else if (queue.endsWith("-email") && isOfferExpansionKind(message.body)) {
        // M4.5: expanded into ordinary emails and bells before the generic path, so a body of this family (valid or not) is never sent as an email.
        // The PDF or the certificate is not stored yet: come back in a minute (it counts as a try; the sweep is the safety net).
        const verdict = await processOfferMessage(env, message.body);
        if (verdict === "retry") message.retry({ delaySeconds: 60 });
        else message.ack();
      } else if (queue.endsWith("-email")) {
        const result = await processEmail(env, message.body, undefined, undefined, message.attempts);
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
