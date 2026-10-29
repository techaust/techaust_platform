// The M5.4 billing family on the leads queue, routed from queue.ts BEFORE the lead fall-through (a body of this family, valid or not, can never become a lead): `care.scan`, `care.bill`,
// `care.issue`, `alerts.daily` and `reminder.scan` (ADM-CARE-02, ADM-INV-13, ADM-INV-19, LD57, LD61). Each is ONE unit of work. An unreadable body is logged and acknowledged (a retry cannot help).
// The cron side is `enqueueHourly`: ONE `sendBatch`, no D1 read, by the IST hour of the scheduled time.
import {
  type BillingMessage,
  careBillMessage,
  careIssueMessage,
  careScanMessage,
  type ReportMessage,
  reminderScanMessage,
} from "@techaust/core";
import { CARE_SCAN_HOUR_IST, CARE_SCAN_REPEAT_HOURS } from "@techaust/core/care-billing";
import { istDate } from "@techaust/core/dates";
import { istHourOf } from "@techaust/core/invoices";
import { processAlertsDaily } from "./alerts.ts";
import { processCareBill, processCareDeadLetter, processCareIssue, processCareScan } from "./care-billing.ts";
import { logEvent } from "./log.ts";
import { processReminderScan } from "./reminders.ts";

/** The hourly cron (`30 * * * *` UTC is the top of every IST hour). */
export const HOURLY_CRON = "30 * * * *";
/** IST hour of the care-plan scan and of the owners' alerts. */
export { CARE_SCAN_HOUR_IST };
export const ALERTS_HOUR_IST = 9;

/** IST days of the month on which the EDF reminder is queued for the previous month (the 5th, and the 6th and 7th to catch a missed tick; the owners' bell makes a repeat a no-op; LD76, Q55). */
export const EDF_REMINDER_DAYS_IST = [5, 6, 7] as const;

/**
 * FX-1 (A6 7): the care scan and the owners' alerts are queued again at the next two IST hours (07:00 and 08:00, 10:00 and 11:00), so one lost tick or one failed
 * message is caught the same morning. Both are idempotent: the care scan lists only plans whose current period is not billed yet (and `draftCarePlan` makes one
 * document per plan and period), and every alert is written once (the email log's entity and the bells' unique key).
 */
export const REPEAT_HOURS = CARE_SCAN_REPEAT_HOURS; // one constant with core, which tells the care page the next billing day (FX-3)
const inWindow = (hour: number, first: number) => hour >= first && hour <= first + REPEAT_HOURS;

/**
 * What the hourly cron queues for a tick: the reminder scan every hour, the care scan at 06:00 IST (again at 07:00 and 08:00), the owners' alerts at 09:00 IST (again
 * at 10:00 and 11:00), and at 09:00 IST only the export realisation scan (M5.5b, LD76) and, on IST days 5 to 7, the EDF reminder for the PREVIOUS month (January's tick
 * names December of the year before). Pure: no D1 read, nothing but the scheduled time.
 */
export function hourlyMessages(scheduledTime: number): (BillingMessage | ReportMessage)[] {
  const hour = istHourOf(scheduledTime);
  const today = istDate(scheduledTime);
  const edf: ReportMessage[] =
    hour === ALERTS_HOUR_IST && (EDF_REMINDER_DAYS_IST as readonly number[]).includes(today.day)
      ? [
          {
            v: 1,
            kind: "edf.reminder",
            year: today.month === 1 ? today.year - 1 : today.year,
            month: today.month === 1 ? 12 : today.month - 1,
          },
        ]
      : [];
  return [
    ...(inWindow(hour, CARE_SCAN_HOUR_IST)
      ? [{ kind: "care.scan", after: null } satisfies BillingMessage]
      : []),
    ...(inWindow(hour, ALERTS_HOUR_IST)
      ? [
          {
            kind: "alerts.daily",
            first: true,
            unbilledAfter: null,
            proformaAfter: null,
          } satisfies BillingMessage,
        ]
      : []),
    ...(hour === ALERTS_HOUR_IST ? [{ v: 1, kind: "realisation.scan" } satisfies ReportMessage] : []),
    ...edf,
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
