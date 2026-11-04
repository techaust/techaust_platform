// M7.2's emails (run file docs/runs/m7.2-notifications.md D, G, H): the owners' weekly digest (JOB-CRON-03, non-transactional), a staff notification email
// (ADM-G-09, one per bell row), the client's refund email (ADM-PAY-08, Q4 A) and the unfinished sign-in alert (Q3 A). These are the BUILDER's plain renderers in
// the house transactional layout (`securityEmail`), so the pipeline, the tests and the Settings test send work; the designer finishes their look (section G).
// The words come from `@techaust/core/copy-zq` (07-ZQ): the client lines and the builder's drafts show "[Placeholder]" until approved.
//
// Data (every value a string, filled by the jobs Worker; the keys are pinned below and by the fixtures):
//   digest.weekly          week_label, pipeline, invoiced, collected, overdue, new_leads, reminders_due, dashboard_url, settings_url, unsubscribe_url
//   staff.notification     first_name, title, url, group, settings_url
//   refund.sent            first_name, amount, document_number, date, credit_note_number ("" when none), url
//   staff.signin_unfinished first_name, time, role
// `unsubscribe_url` is read only by the consumer (the RFC 8058 headers); the footer's switch-off link goes to the admin's Notifications page (`settings_url`, L8).
import {
  DIGEST_COPY,
  NOTIFICATION_COPY,
  REFUND_EMAIL_COPY,
  SIGNIN_UNFINISHED_COPY,
} from "@techaust/core/copy-zq";
import { escapeHtml, headerValue } from "./headers.ts";
import { type LayoutOptions, NOT_YOU, para, type Rendered, securityEmail } from "./templates.ts";

export const DIGEST_KEYS = [
  "week_label",
  "pipeline",
  "invoiced",
  "collected",
  "overdue",
  "new_leads",
  "reminders_due",
  "dashboard_url",
  "settings_url",
  "unsubscribe_url",
] as const;
export type DigestData = Record<(typeof DIGEST_KEYS)[number], string>;

export const STAFF_NOTIFICATION_KEYS = ["first_name", "title", "url", "group", "settings_url"] as const;
export type StaffNotificationData = Record<(typeof STAFF_NOTIFICATION_KEYS)[number], string>;

export const REFUND_SENT_KEYS = [
  "first_name",
  "amount",
  "document_number",
  "date",
  "credit_note_number",
  "url",
] as const;
export type RefundSentData = Record<(typeof REFUND_SENT_KEYS)[number], string>;

export const SIGNIN_UNFINISHED_KEYS = ["first_name", "time", "role"] as const;
export type SigninUnfinishedData = Record<(typeof SIGNIN_UNFINISHED_KEYS)[number], string>;

/** A paragraph that ends with a link (the link's URL repeated in the text twin). */
const linkPara = (lead: string, label: string, url: string) =>
  para(
    `${lead}${lead ? " " : ""}${label}: ${url}`,
    `${escapeHtml(lead)}${lead ? " " : ""}<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`,
  );

/** `digest.weekly` (07 §8): the figures as facts, the dashboard button, then the non-transactional footer (S2, S3). */
export function digestWeekly(d: DigestData, opts: LayoutOptions): Rendered {
  const C = DIGEST_COPY;
  const rows: [string, string][] = [
    [C.pipeline, d.pipeline],
    [C.invoiced, d.invoiced],
    [C.collected, d.collected],
    [C.overdue, d.overdue],
    [C.newLeads, d.new_leads],
    [C.remindersDue, d.reminders_due],
  ];
  return securityEmail(headerValue(C.subject(d.week_label)), opts, {
    before: [],
    facts: { rows, text: rows.map(([k, v]) => `${k}: ${v}`).join("\n") },
    action: { label: C.button, url: d.dashboard_url },
    actionFirst: true,
    after: [para(C.why), linkPara("", C.switchOff, d.settings_url)],
  });
}

/** `staff.notification`: the bell's approved title as the subject and first line, the admin button, then S4's footer. */
export function staffNotification(d: StaffNotificationData, opts: LayoutOptions): Rendered {
  const C = NOTIFICATION_COPY;
  return securityEmail(headerValue(d.title), opts, {
    before: [para(d.title)],
    action: { label: C.button, url: d.url },
    actionFirst: true,
    after: [linkPara(C.footer(d.group), C.settingsLink, d.settings_url)],
  });
}

/** `refund.sent` (C1 to C4): the refund, the credit note when one records it, the portal button. */
export function refundSent(d: RefundSentData, opts: LayoutOptions): Rendered {
  const C = REFUND_EMAIL_COPY;
  return securityEmail(headerValue(C.subject(d.amount, d.document_number)), opts, {
    before: [
      para(C.body(d.first_name, d.amount, d.document_number, d.date)),
      ...(d.credit_note_number ? [para(C.creditNote(d.credit_note_number))] : []),
    ],
    action: { label: C.button, url: d.url },
    actionFirst: true,
  });
}

/** `staff.signin_unfinished` (Q3 A, S15): what happened, what to do, and 07-G's "Not you?" line by role. */
export function staffSigninUnfinished(d: SigninUnfinishedData, opts: LayoutOptions): Rendered {
  const C = SIGNIN_UNFINISHED_COPY;
  return securityEmail(headerValue(C.subject), opts, {
    before: [para(C.body(d.first_name, d.time)), para(C.advice)],
    notYou: d.role === "owner" ? NOT_YOU.owner : NOT_YOU.member,
  });
}
