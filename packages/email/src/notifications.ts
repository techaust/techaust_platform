// M7.2's emails (run file docs/runs/m7.2-notifications.md D, G, H): the owners' weekly digest (JOB-CRON-03, non-transactional), a staff notification email
// (ADM-G-09, one per bell row), the client's refund email (ADM-PAY-08, Q4 A) and the unfinished sign-in alert (Q3 A), in the house layout (`securityEmail`:
// the badge logo, the verdigris rule, the subject as the heading, light and dark, the plain-text twin). The designer's look (section G):
//   - digest: 07 §8's core text, then the week's figures as a ledger (label left, the value large with tabular figures, one line per currency), the
//     dashboard button, and the non-transactional footer (06 §6): S2 and the S3 switch-off link sit in the footer above the 07 §8 line, never in the body;
//   - staff notification: the bell's title is the subject and the heading (said once), the admin button, and S4 (why you got it, with its settings link)
//     in the footer, as the digest's "why" line;
//   - refund: C2, C3 when a credit note records it, and C4's portal button;
//   - unfinished sign-in: the time bold in the body, then the advice, which is the email's one instruction (the lead's triage of review 1, finding 2: 07-G's
//     "Not you?" block is left out of this template only, since the advice already says what to do if it wasn't you).
// The words come from `@techaust/core/copy-zq` (07-ZQ): the client lines show "[Placeholder]" until the owner approves them; the staff lines are approved.
//
// Data (every value a string, filled by the jobs Worker; the keys are pinned below and by the fixtures):
//   digest.weekly          week_label, pipeline, invoiced, collected, overdue, new_leads, reminders_due, dashboard_url, settings_url, unsubscribe_url
//   staff.notification     first_name, title, url, group, settings_url
//   refund.sent            first_name, amount, document_number, date, credit_note_number ("" when none), url
//   staff.signin_unfinished first_name, time
// `unsubscribe_url` is read only by the consumer (the RFC 8058 headers); the footer's switch-off link goes to the admin's Notifications page (`settings_url`, L8).
import {
  DIGEST_COPY,
  NOTIFICATION_COPY,
  REFUND_EMAIL_COPY,
  SIGNIN_UNFINISHED_COPY,
} from "@techaust/core/copy-zq";
import { escapeHtml, headerValue } from "./headers.ts";
import {
  footerLink,
  type LayoutOptions,
  type Para,
  para,
  type Rendered,
  securityEmail,
} from "./templates.ts";

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

export const SIGNIN_UNFINISHED_KEYS = ["first_name", "time"] as const;
export type SigninUnfinishedData = Record<(typeof SIGNIN_UNFINISHED_KEYS)[number], string>;

/** A sentence with a value inside it set bold and kept on one line (the time of a security email, 07-G's look); the plain text is the sentence as it is. */
function withBold(sentence: string, value: string): Para {
  const at = value ? sentence.indexOf(value) : -1;
  if (at === -1) return para(sentence);
  return {
    text: sentence,
    html: `${escapeHtml(sentence.slice(0, at))}<strong style="font-weight:600;white-space:nowrap;">${escapeHtml(value)}</strong>${escapeHtml(sentence.slice(at + value.length))}`,
  };
}

/** `digest.weekly` (07 §8): the core text, the week's figures as a ledger, the dashboard button, then the non-transactional footer (S2, S3). */
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
    before: [para(C.intro)],
    figures: { rows, text: rows.map(([k, v]) => `${k}: ${v}`).join("\n") },
    action: { label: C.button, url: d.dashboard_url },
    footer: [para(C.why), footerLink("", C.switchOff, d.settings_url)],
  });
}

/** `staff.notification`: the bell's approved title as the subject and heading, the admin button, then S4 in the footer. */
export function staffNotification(d: StaffNotificationData, opts: LayoutOptions): Rendered {
  const C = NOTIFICATION_COPY;
  return securityEmail(headerValue(d.title), opts, {
    before: [],
    action: { label: C.button, url: d.url },
    footer: [footerLink(C.footer(d.group), C.settingsLink, d.settings_url)],
  });
}

/** `refund.sent` (C1 to C4): the refund, the credit note when one records it, the portal button. */
export function refundSent(d: RefundSentData, opts: LayoutOptions): Rendered {
  const C = REFUND_EMAIL_COPY;
  return securityEmail(headerValue(C.subject(d.amount, d.document_number)), opts, {
    before: [
      withBold(C.body(d.first_name, d.amount, d.document_number, d.date), d.amount),
      ...(d.credit_note_number ? [para(C.creditNote(d.credit_note_number))] : []),
    ],
    action: { label: C.button, url: d.url },
  });
}

/** `staff.signin_unfinished` (Q3 A, S15): what happened (the time bold) and the one thing to do (no 07-G "Not you?" block: review 1, finding 2). */
export function staffSigninUnfinished(d: SigninUnfinishedData, opts: LayoutOptions): Rendered {
  const C = SIGNIN_UNFINISHED_COPY;
  return securityEmail(headerValue(C.subject), opts, {
    before: [withBold(C.body(d.first_name, d.time), d.time), para(C.advice)],
  });
}
