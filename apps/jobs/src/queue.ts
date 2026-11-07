// The queue entry point: routes a batch to its consumer by queue name (`techaust-<env>-leads`, `-leads-dlq`, `-email`,
// `-email-dlq`). Each message is acknowledged on success and retried when its consumer throws or asks for a retry;
// after its queue's `max_retries` (5; the email queue 10, FX-1) the queue moves it to the dead-letter queue (wrangler.jsonc).
import {
  isBillingKind,
  isDeedExpansionKind,
  isGatewayKind,
  isInvoiceExpansionKind,
  isOfferExpansionKind,
  isPurgeMessage,
  isPurgeScanMessage,
  isRefundKind,
  isReportKind,
} from "@techaust/core";
import { isDigestKind } from "@techaust/core/digest";
import { isDpKind } from "@techaust/core/dp-jobs";
import { isExpireKind, isExpireMessage } from "@techaust/core/expiry";
import { isLutCheckKind, isLutCheckMessage } from "@techaust/core/invoices";
import {
  isBellsSweepKind,
  isRefundNotifyKind,
  isRefundReversedKind,
  isSigninUnfinishedKind,
  isStaffNotifyKind,
} from "@techaust/core/notifications";
import { isPdfKind, isPdfMessage, isReceiptKind } from "@techaust/core/pdf-jobs";
import { isPortalAlertKind } from "@techaust/core/portal";
import { isStatsKind, isStatsMessage } from "@techaust/core/stats";
import { isUsageKind } from "@techaust/core/usage";
import { processBilling, processBillingDeadLetter } from "./billing.ts";
import { processDeedPdf, processDeedSigned } from "./deed-pdf.ts";
import { processDigest } from "./digest.ts";
import { CLAIM_TIMEOUT_MS, processDeadLetter, processEmail } from "./email.ts";
import { isErasureKeyMissing } from "./erasure.ts";
import { logExpireDeadLetter, processExpire, skipExpire } from "./expire.ts";
import { processGateway, processGatewayDeadLetter } from "./gateway.ts";
import { processInvoiceSend } from "./invoice-send.ts";
import { processLead } from "./leads.ts";
import { firstRun, logEvent, noteInvocation } from "./log.ts";
import { logLutCheckDeadLetter, processLutCheck, skipLutCheck } from "./lut-check.ts";
import { processOfferMessage } from "./offers.ts";
import { processPdf, processPdfDeadLetter } from "./pdf.ts";
import { processPortalAlert } from "./portal-alerts.ts";
import { enqueueDue, processStatementPurge, purgeLead } from "./purge.ts";
import { processReceipt, processReceiptDeadLetter } from "./receipts.ts";
import { processRefundNotify, processRefundReversed } from "./refund-notify.ts";
import { processRefundDeadLetter, processRefundFamily } from "./refunds.ts";
import { processReminderSend } from "./reminders.ts";
import { processEdfReminder, processRealisationScan } from "./reports.ts";
import { processDp, processDpDeadLetter } from "./retention.ts";
import { processSigninUnfinished } from "./signin-unfinished.ts";
import { processStaffAlert } from "./staff-alerts.ts";
import { processBellsSweep, processStaffNotify } from "./staff-notify.ts";
import { processStatementDeadLetter, processStatementPdf } from "./statement-pdf.ts";
import { logStatsDeadLetter, processStats, skipStats } from "./stats.ts";
import { processUsage } from "./usage.ts";

/** A staff alert (`{ kind: "staff.alert", auditId }`) shares the email queue with ordinary emails (M2.4b). */
const isStaffAlert = (body: unknown) =>
  typeof body === "object" && body !== null && (body as { kind?: unknown }).kind === "staff.alert";

/** A body's `kind` (or an email's `template`) for a log line, only when it is a plain code: never a value from the message itself. */
const kindOf = (body: unknown): string | undefined => {
  if (typeof body !== "object" || body === null) return undefined;
  const k =
    (body as { kind?: unknown; template?: unknown }).kind ?? (body as { template?: unknown }).template;
  return typeof k === "string" && /^[a-z0-9._-]{1,40}$/.test(k) ? k : undefined;
};

/**
 * A dead-lettered message whose alert could not be sent is retried with long, growing delays (5 minutes, doubling, at
 * most 4 hours) and is never dropped quietly: the consumer's `max_retries` is the queue maximum (wrangler.jsonc), so the
 * Free plan's 24-hour message retention is the only limit left, and each failure writes a log line with the reference.
 */
export const dlqRetryDelay = (attempts: number): number =>
  Math.min(4 * 3_600, 300 * 2 ** Math.max(0, attempts - 1));

/**
 * FX-1 (A6 4): an email that SES answered with a retry (throttling, a 5xx, a network error or the 8 s timeout), or whose consumer threw, comes back after 60 s,
 * doubling each try up to 1 hour. With the email queue's `max_retries` of 10 (wrangler.jsonc) that rides out about 4 to 5 hours of SES trouble before the dead
 * letter; a fixed 30 s with 5 tries gave up after about 2 minutes.
 */
export const EMAIL_RETRY_FIRST_S = 60;
export const EMAIL_RETRY_MAX_S = 3_600;
export const emailRetryDelay = (attempts: number): number =>
  Math.min(EMAIL_RETRY_MAX_S, EMAIL_RETRY_FIRST_S * 2 ** Math.max(0, attempts - 1));

export async function handleQueue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  noteInvocation();
  const queue = batch.queue;
  const isPdfDlq = queue.endsWith("-pdf-dlq");
  const isDlq = queue.endsWith("-leads-dlq") || queue.endsWith("-email-dlq") || isPdfDlq;
  const q = queue.replace(/^techaust-(?:local-|staging-)?/, "");
  for (const message of batch.messages) {
    // M7.5 L20: one line per message with its kind (a code, never a value) and `f: 1` on that queue and kind's first run in this isolate, so the staging CPU
    // gate reads first runs per kind (the isolate count `n` alone can't tell them apart).
    const k = kindOf(message.body) ?? "other";
    logEvent("q", { q, k, f: firstRun(`q ${q} ${k}`) });
    try {
      if (isPdfDlq) {
        // The PDF family has its own dead-letter queue: a bell for the owners, then done (the daily sweep tries the document again).
        // A statement PDF that ran out of tries marks its row failed and rings the person who asked, once (M5.5b).
        // M6.5: a receipt message that ran out of tries: a render counts a failed IST day (the third stops the hourly sweep's retries and rings the owners once,
        // review part 1, finding 4); an issue or a sweep is only logged (the hourly `receipt.sweep` asks again).
        if (isReceiptKind(message.body)) await processReceiptDeadLetter(env, message.body);
        else if (isPdfMessage(message.body) && message.body.kind === "pdf.statement")
          await processStatementDeadLetter(env, message.body);
        else await processPdfDeadLetter(env, message.body);
        message.ack();
      } else if (queue.endsWith("-pdf") && isReceiptKind(message.body)) {
        // M6.5 (L3, L34): a receipt's issue (BillingJobs RPC), the sweep, or its PDF. Before the other PDF kinds (receipts.ts imports pdf.ts). During the M6.5
        // deploy (jobs deploys after the admin Workers), an older jobs Worker logs an unknown PDF kind and acknowledges it; the hourly sweep issues it again.
        await processReceipt(env, message.body);
        message.ack();
      } else if (queue.endsWith("-pdf") && isPdfMessage(message.body) && message.body.kind === "pdf.deed") {
        // T11: a deed's unsigned PDF (seal check, adopt or render, store once). Before the other PDF kinds (deed-pdf.ts imports pdf.ts).
        await processDeedPdf(env, message.body);
        message.ack();
      } else if (
        queue.endsWith("-pdf") &&
        isPdfMessage(message.body) &&
        message.body.kind === "pdf.statement"
      ) {
        // The statement of account (M5.5b, LD79): read, view, content hash, adopt or render, store once. Before the other PDF kinds (statement-pdf.ts imports pdf.ts, so pdf.ts cannot route it).
        await processStatementPdf(env, message.body);
        message.ack();
      } else if (queue.endsWith("-pdf")) {
        // Snapshot, render and sweep (M4.4). A body of the family this version cannot use is logged and acknowledged inside.
        await processPdf(env, message.body);
        message.ack();
      } else if (isDlq && (isPurgeMessage(message.body) || isPurgeScanMessage(message.body))) {
        // A clean-up message that ran out of tries: the next daily run enqueues the lead again, so no alert and no retry.
        logEvent("lead.purge_dead_letter", { queue });
        message.ack();
      } else if (isDlq && isDeedExpansionKind(message.body)) {
        // T11: a signed-deed email expansion that ran out of tries: logged (the deed itself is signed and in the portal; the email is the only thing missing).
        logEvent("deed.signed_dead_letter", { queue });
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
      } else if (isDlq && isReportKind(message.body)) {
        // M5.5b: a realisation scan, an EDF reminder or a statement purge that ran out of tries is only logged: the next daily run lists the same work again (the bells and the email log make a repeat harmless).
        logEvent("report.dead_letter", { queue, kind: message.body.kind });
        message.ack();
      } else if (isDlq && isRefundKind(message.body)) {
        // M6.5: a refund check that ran out of tries becomes a `refund_stuck` review item with the owners' bell; the sweep and the fetch only log.
        await processRefundDeadLetter(env, message.body);
        message.ack();
      } else if (isDlq && isDpKind(message.body)) {
        // M7.4 (D): a clean-up, drain, sweep, hash or clock message that ran out of tries: logged; the next night (or hour) repeats it. A live clean-up page
        // also rings the Owners' `job.failed` bell, once per run and family (early check 2, low 6).
        await processDpDeadLetter(env, queue, message.body);
        message.ack();
      } else if (isDlq && isUsageKind(message.body)) {
        // M7.5 D1: a usage reading that ran out of tries is only logged: the day stays unrecorded (the tile shows a gap), tomorrow's run reads the next day.
        logEvent("usage.dead_letter", { queue });
        message.ack();
      } else if (isDlq && isPortalAlertKind(message.body)) {
        // M7.1 (L9): a portal bell that ran out of tries: the request or notice itself is stored and shows in the admin's lists, so no alert and no retry.
        logEvent("portal_alert.dead_letter", { queue });
        message.ack();
      } else if (isDlq && isGatewayKind(message.body)) {
        // M6.2: an event or an automatic tax invoice that ran out of tries: the event failed, a `dead_letter` review item, the owners' bell (once).
        await processGatewayDeadLetter(env, message.body);
        message.ack();
      } else if (isDlq && isBillingKind(message.body)) {
        // M5.4: a care bill or issue that ran out of tries rings the owners' bell (once per plan per IST day); the scans and the daily alerts are listed again by the next run.
        await processBillingDeadLetter(env, message.body);
        message.ack();
      } else if (isDlq) {
        if (await processDeadLetter(env, queue, message.body)) message.ack();
        else message.retry({ delaySeconds: dlqRetryDelay(message.attempts) });
      } else if (queue.endsWith("-leads") && isGatewayKind(message.body)) {
        // M6.2 (L9): the gateway family rides the leads queue and is routed first, so a body of it (valid or not) can never become a lead.
        const verdict = await processGateway(env, message.body, message.attempts);
        if (verdict === "ack") message.ack();
        else message.retry({ delaySeconds: verdict.retry });
      } else if (queue.endsWith("-leads") && isRefundKind(message.body)) {
        // M6.5 (run file D): refund checks, the refund sweep and the settlement fetch, before the lead fall-through (a body of this family never becomes a lead).
        const verdict = await processRefundFamily(env, message.body, message.attempts);
        if (verdict === "ack") message.ack();
        else message.retry({ delaySeconds: verdict.retry });
      } else if (queue.endsWith("-leads") && isDpKind(message.body)) {
        // M7.4 (D): the clean-up, the R2 outbox and sweeps, the consent hash fill, the request clock; before the lead fall-through (a body of this family,
        // valid or not, can never become a lead).
        await processDp(env, message.body);
        message.ack();
      } else if (queue.endsWith("-leads") && isUsageKind(message.body)) {
        // M7.5 D1 (Q4 A): the day's Free-plan usage (one GraphQL fetch, one batch); before the lead fall-through (a body of this kind never becomes a lead).
        if ((await processUsage(env, message.body)) === "retry") message.retry({ delaySeconds: 300 });
        else message.ack();
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
      } else if (queue.endsWith("-leads") && isBillingKind(message.body)) {
        // M5.4 (care scan and bill and issue, the owners' alerts, the reminder scan): before the lead fall-through, so a body of this family (valid or not) can never become a lead.
        await processBilling(env, message.body);
        message.ack();
      } else if (queue.endsWith("-leads") && isReportKind(message.body)) {
        // M5.5b (the realisation scan and the EDF reminder from the 09:00 IST tick, the statement purge from the daily one): before the lead fall-through, so a body of this family (valid or not) can never become a lead.
        if (message.body.kind === "realisation.scan") await processRealisationScan(env, message.body);
        else if (message.body.kind === "edf.reminder") await processEdfReminder(env, message.body);
        else await processStatementPurge(env, message.body);
        message.ack();
      } else if (queue.endsWith("-leads") && isDigestKind(message.body)) {
        // M7.2 (JOB-CRON-03, L7): the owners' weekly digest, before the lead fall-through (a body of this family, valid or not, can never become a lead).
        await processDigest(env, message.body);
        message.ack();
      } else if (queue.endsWith("-leads") && isSigninUnfinishedKind(message.body)) {
        // M7.2 (Q3 A): the hourly scan of unfinished staff sign-ins, before the lead fall-through.
        await processSigninUnfinished(env, message.body);
        message.ack();
      } else if (queue.endsWith("-leads") && isBellsSweepKind(message.body)) {
        // M7.2 (L9): the hourly safety net of the staff notification emails, before the lead fall-through.
        await processBellsSweep(env, message.body);
        message.ack();
      } else if (queue.endsWith("-leads") && isPdfKind(message.body)) {
        // A PDF body belongs on the PDF queue; here it is logged and dropped, so it can never become a lead.
        logEvent("pdf.wrong_queue", { queue });
        message.ack();
      } else if (queue.endsWith("-leads")) {
        await processLead(env, message.body);
        message.ack();
      } else if (queue.endsWith("-email") && isStaffNotifyKind(message.body)) {
        // M7.2 (L9): one bell's staff emails by the members' switches, BEFORE the generic path (a body of this family, valid or not, is never sent as an email;
        // one that can't be read is acknowledged).
        await processStaffNotify(env, message.body);
        message.ack();
      } else if (queue.endsWith("-email") && isRefundNotifyKind(message.body)) {
        // M7.2 (Q4 A): one refund's client emails, before the generic path (a window wait is a NEW delayed message made inside, never a retry).
        await processRefundNotify(env, message.body);
        message.ack();
      } else if (queue.endsWith("-email") && isRefundReversedKind(message.body)) {
        // M6–M7 audit AU1: a refund that came back, the client's email (held behind 07-ZT's gate), before the generic path as `refund.notify`.
        await processRefundReversed(env, message.body);
        message.ack();
      } else if (queue.endsWith("-email") && isStaffAlert(message.body)) {
        // Expanded into ordinary emails; an alert that cannot be read or has no row is acknowledged (a retry cannot help).
        await processStaffAlert(env, message.body);
        message.ack();
      } else if (queue.endsWith("-email") && isPortalAlertKind(message.body)) {
        // M7.1 (L9): a portal request or notice, expanded into staff bells (no email in M7.1, L16). A body of this family (valid or not) is never sent as an
        // email; one that cannot be read or names no portal row is acknowledged (a retry cannot help).
        await processPortalAlert(env, message.body);
        message.ack();
      } else if (queue.endsWith("-email") && isDeedExpansionKind(message.body)) {
        // T11: the signed deed is in the portal: one email per portal contact. A body of this family (valid or not) is never sent as an email.
        await processDeedSigned(env, message.body);
        message.ack();
      } else if (queue.endsWith("-email") && isOfferExpansionKind(message.body)) {
        // M4.5: expanded into ordinary emails and bells before the generic path, so a body of this family (valid or not) is never sent as an email.
        // The PDF or the certificate is not stored yet: come back in a minute (it counts as a try; the sweep is the safety net).
        const verdict = await processOfferMessage(env, message.body);
        if (verdict === "retry") message.retry({ delaySeconds: 60 });
        else message.ack();
      } else if (queue.endsWith("-email") && isInvoiceExpansionKind(message.body)) {
        // M5.4: an invoice send or a reminder, expanded into ordinary emails before the generic path (a body of this family, valid or not, is never sent as an email). The PDF is not stored yet:
        // come back in a minute (the render step and the daily sweep are the safety net). A window wait is a NEW message with a delay, made inside the consumer, never a retry.
        if (message.body.kind === "invoice.send") {
          const result = await processInvoiceSend(env, message.body);
          if (result === "pdf_missing") message.retry({ delaySeconds: 60 });
          else message.ack();
        } else {
          await processReminderSend(env, message.body);
          message.ack();
        }
      } else if (queue.endsWith("-email")) {
        const result = await processEmail(env, message.body, undefined, undefined, message.attempts);
        if (result === "retry") message.retry({ delaySeconds: emailRetryDelay(message.attempts) });
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
      // Early check 2, low 4: a Worker without ERASURE_HASH_KEY has its own event (it never clears by itself: the owner's H1 step sets the key), still retried,
      // so an email to an erased address is never sent for want of the key.
      if (isErasureKeyMissing(e))
        logEvent("erasure.key_missing", {
          queue,
          attempts: message.attempts,
          kind: kindOf(message.body),
          f: 1,
        });
      else
        logEvent("queue.error", {
          queue,
          attempts: message.attempts,
          error: e instanceof Error ? e.name : "unknown",
        });
      // The email queue uses the email backoff here too (FX-1, A6 4); the other queues keep their short one.
      message.retry({
        delaySeconds: isDlq
          ? dlqRetryDelay(message.attempts)
          : queue.endsWith("-email")
            ? emailRetryDelay(message.attempts)
            : Math.min(300, 10 * 2 ** message.attempts),
      });
    }
  }
}
