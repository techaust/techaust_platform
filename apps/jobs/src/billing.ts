// The M5.4 billing family on the leads queue, routed from queue.ts BEFORE the lead fall-through (a body of this family, valid or not, can never become a lead): `care.scan`, `care.bill`,
// `care.issue`, `alerts.daily` and `reminder.scan` (ADM-CARE-02, ADM-INV-13, ADM-INV-19, LD57, LD61). Each is ONE unit of work. An unreadable body is logged and acknowledged (a retry cannot help).
// The cron side is `enqueueHourly`: ONE `sendBatch`, no D1 read, by the IST hour of the scheduled time.
import {
  type BillingMessage,
  careBillMessage,
  careIssueMessage,
  careScanMessage,
  reminderScanMessage,
} from "@techaust/core";
import { istHourOf } from "@techaust/core/invoices";
import { processAlertsDaily } from "./alerts.ts";
import { processCareBill, processCareDeadLetter, processCareIssue, processCareScan } from "./care-billing.ts";
import { logEvent } from "./log.ts";
import { processReminderScan } from "./reminders.ts";

/** The hourly cron (`30 * * * *` UTC is the top of every IST hour). */
export const HOURLY_CRON = "30 * * * *";
/** IST hour of the care-plan scan and of the owners' alerts. */
export const CARE_SCAN_HOUR_IST = 6;
export const ALERTS_HOUR_IST = 9;

/** What the hourly cron queues for a tick: the reminder scan every hour, the care scan at 06:00 IST and the owners' alerts at 09:00 IST. Pure. */
export function hourlyMessages(scheduledTime: number): BillingMessage[] {
  const hour = istHourOf(scheduledTime);
  return [
    ...(hour === CARE_SCAN_HOUR_IST ? [{ kind: "care.scan", after: null } satisfies BillingMessage] : []),
    ...(hour === ALERTS_HOUR_IST
      ? [
          {
            kind: "alerts.daily",
            first: true,
            unbilledAfter: null,
            proformaAfter: null,
          } satisfies BillingMessage,
        ]
      : []),
    { kind: "reminder.scan", after: null },
  ];
}

/** The hourly tick: one `sendBatch` on the leads queue, nothing read. */
export async function enqueueHourly(env: Env, scheduledTime: number): Promise<number> {
  const messages = hourlyMessages(scheduledTime);
  await env.LEADS_QUEUE.sendBatch(messages.map((body) => ({ body })));
  return messages.length;
}

const skip = (kind: string) => logEvent("billing.invalid_message", { kind });

/** Handles one body of the billing family (`isBillingKind` already said so). */
export async function processBilling(env: Env, body: { kind: string }, now = Date.now()): Promise<void> {
  switch (body.kind) {
    case "care.scan": {
      const m = careScanMessage.safeParse(body);
      if (m.success) await processCareScan(env, m.data, now);
      else skip(body.kind);
      return;
    }
    case "care.bill": {
      const m = careBillMessage.safeParse(body);
      if (m.success) await processCareBill(env, m.data);
      else skip(body.kind);
      return;
    }
    case "care.issue": {
      const m = careIssueMessage.safeParse(body);
      if (m.success) await processCareIssue(env, m.data);
      else skip(body.kind);
      return;
    }
    case "alerts.daily": {
      await processAlertsDaily(env, body, now);
      return;
    }
    default: {
      const m = reminderScanMessage.safeParse(body);
      if (m.success) await processReminderScan(env, m.data, now);
      else skip(body.kind);
    }
  }
}

/**
 * A billing message that ran out of tries. `care.bill` and `care.issue` ring the owners' bell once per plan (or draft) per IST day; the scans and the alerts only log: the next hourly or daily run
 * lists the same work again, so no alert and no retry.
 */
export async function processBillingDeadLetter(
  env: Env,
  body: { kind: string },
  now = Date.now(),
): Promise<void> {
  const bill = careBillMessage.safeParse(body);
  if (bill.success) return processCareDeadLetter(env, bill.data, now);
  const issue = careIssueMessage.safeParse(body);
  if (issue.success) return processCareDeadLetter(env, issue.data, now);
  logEvent("billing.dead_letter", { kind: body.kind });
}
