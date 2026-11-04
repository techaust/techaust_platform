// M7.2's words (notifications and digest; run file docs/runs/m7.2-notifications.md H), in ONE place for the jobs Worker, the email templates, the admin and the
// portal; the next free 07 appendix letter is ZQ (07-ZP is M7.1's). Three kinds of line:
//   - the CLIENT lines C1 to C4 (the refund email) are the owner's: until the owner approves them word for word they show the "[Placeholder] " mark, and the
//     jobs Worker sends no `refund.sent` outside "local" while `APPROVED_07ZQ` is false (the M6.5 receipt gate's pattern, `refundCopyGate`);
//   - the STAFF lines the brief gives word for word (S2 to S5, S7 to S12, and the lead's two "isn't a client contact" lines in `@techaust/core/email-events`),
//     drafted by the lead under the owner's delegation, are plain;
//   - the staff lines the brief names but doesn't word (S1, S6, S13, S14, S15, the template labels) are the builder's drafts for the lead and carry the mark
//     (`draft`) until the lead places its own words.
// No line is legal wording (none is invented); 07-A §3.5's "Banks and card networks may take longer" is reused as approved.

/** The owner's approval of the client lines C1 to C4 (not yet asked; run file "Asked later"). */
export const APPROVED_07ZQ: boolean = false;
const zq = (line: string): string => (APPROVED_07ZQ ? line : `[Placeholder] ${line}`);
/** A builder's draft of a staff line, marked until the lead approves it. */
const draft = (line: string): string => `[Placeholder] ${line}`;

// ---- the refund email (C1 to C4; Q4 A: every completed refund except chargebacks) ----------------------------------------------------------------------------

export const REFUND_EMAIL_COPY = {
  /** C1 */
  subject: (amount: string, documentNumber: string) => zq(`Refund of ${amount} for ${documentNumber}`),
  /** C2 */
  body: (firstName: string, amount: string, documentNumber: string, date: string) =>
    zq(
      `Hi ${firstName}, we've refunded ${amount} for ${documentNumber} on ${date}. Banks and card networks may take longer to show it.`,
    ),
  /** C3, only when a credit note records the refund */
  creditNote: (creditNoteNumber: string) => zq(`Credit note ${creditNoteNumber} records this refund.`),
  /** C4 (the existing portal button label) */
  button: "View invoice",
} as const;

// ---- the weekly digest (07 §8, S1 to S3) ------------------------------------------------------------------------------------------------------------------------

export const DIGEST_COPY = {
  /** 07 §8 (approved) */
  subject: (weekLabel: string) => `Your week at TecHaust: ${weekLabel}`,
  /** 07 §8's button (approved) */
  button: "Open dashboard",
  /** S1: the section labels (the dashboard's tiles; the builder's drafts until the designer places the dashboard's own words) */
  pipeline: draft("Pipeline"),
  invoiced: draft("Invoiced this month"),
  collected: draft("Collected this month"),
  overdue: draft("Overdue invoices"),
  newLeads: draft("New leads (last 7 days)"),
  remindersDue: draft("Reminders due (next 7 days)"),
  /** S2 */
  why: "Why you're receiving this: you're an owner of TecHaust admin and the weekly digest is on.",
  /** S3 */
  switchOff: "Switch off the weekly digest",
} as const;

// ---- staff notification emails (S4, S6, S7) ----------------------------------------------------------------------------------------------------------------------

/** S6: the switch groups' names, as the footer sentence (S4) and the Notifications page use them (the builder's drafts). */
export const PREF_GROUP_LABELS = {
  offerViewed: draft("proposal and estimate opened"),
  paymentReceived: draft("online payment"),
  approvals: draft("payment check"),
  hookFailed: draft("connection failure"),
} as const;
export const DIGEST_LABEL = draft("weekly digest");

export const NOTIFICATION_COPY = {
  /** S4 */
  footer: (group: string) =>
    `You get this email because ${group} emails are on in your notification settings.`,
  /** S4 */
  settingsLink: "Change notification settings",
  /** The button of a notification email (the builder's draft) */
  button: draft("Open in admin"),
} as const;

/** S7: the bell of a client opening a proposal or estimate, named by its number, else "Untitled" (13 2026-10-26). */
export const offerViewedTitle = (number: string | null): string =>
  `${number && number !== "" ? number : "Untitled"} was opened by the client`;

/** S8: the owners' bell of a dead-lettered job (one per queue per IST day). */
export const jobFailedTitle = (queue: string): string =>
  `A background job ran out of tries (${queue}). The details are in the alert email.`;

/** S5: the only line `GET /u` answers (it never changes anything). */
export const UNSUBSCRIBE_GET_LINE = "To change your email settings, open Notifications in TecHaust admin.";
/** The line `POST /u` answers after switching the digest off (the builder's draft). */
export const UNSUBSCRIBE_DONE_LINE = draft("The weekly digest is switched off.");

/** S12 (word for word): the email log's status labels. */
export const EMAIL_STATUS_LABELS = {
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Marked as spam",
  failed: "Failed",
  skipped: "Not sent",
} as const;

// ---- the unfinished sign-in (Q3 A; S15, the builder's drafts) ---------------------------------------------------------------------------------------------------

export const SIGNIN_UNFINISHED_COPY = {
  subject: draft("Your TecHaust admin password was used"),
  body: (firstName: string, time: string) =>
    draft(
      `Hi ${firstName}, your TecHaust admin password was used to start a sign-in on ${time}, but the 6-digit code was never entered, so the sign-in wasn't finished.`,
    ),
  advice: draft(
    "If this wasn't you, change your password now: someone else may know it. If it was you, you can ignore this email.",
  ),
  /** The owners' bell (named by the member's name). */
  bell: (memberName: string) => draft(`${memberName}'s password was used, but the sign-in wasn't finished.`),
} as const;

// ---- the template names in Settings › Email (TEMPLATE_NAMES; the builder's drafts) -----------------------------------------------------------------------------

export const M72_TEMPLATE_NAMES = {
  "digest.weekly": draft("Weekly digest (team)"),
  "staff.notification": draft("Notification email (team)"),
  "refund.sent": draft("Refund sent (client)"),
  "staff.signin_unfinished": draft("Unfinished sign-in alert"),
} as const;
