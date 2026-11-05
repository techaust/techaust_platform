// M7.2 (notifications and digest): the staff lines of the admin screens [ADM-G-09, ADM-MAIL-01, ADM-MAIL-02, ADM-PAY-09; run file docs/runs/m7.2-notifications.md
// G1 to G7, H S6, S12, S13]: the Notifications page under the account (Q1 A, Q2 A), the email log and its detail, the contact's "Emails stopped" badge and the
// Owner's "Allow emails again", the suppressed recipients of the send pickers, the Emails panels' delivery words and "Send receipt again". Staff-only words,
// drafted by the designer under the lead's delegation in the plain style of the M6 and M7.1 screens, unmarked (the `ZO_UI`, `ZP_UI` pattern) and listed in
// the run file's designer report. Words the brief gives (S12 status labels) and B2's drafts (S6 group names, S13 reasons) are read from
// `@techaust/core/copy-zq` and `@techaust/core/email-events`, never retyped. Every refusal is worded from its error code (`ZQ_ERRORS`).
import { RequestError } from "../api.ts";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Upper-cases the first letter of a group name ("online payment" → "Online payment"), keeping a "[Placeholder] " mark in front. */
export const sentenceStart = (s: string): string => {
  const mark = "[Placeholder] ";
  const body = s.startsWith(mark) ? s.slice(mark.length) : s;
  return `${s.startsWith(mark) ? mark : ""}${body.charAt(0).toUpperCase()}${body.slice(1)}`;
};

export const ZQ_UI = {
  // ---- G1: Your account › Notifications ----
  prefsTitle: "Notifications",
  prefsLede:
    "Choose which alerts also come to you by email. The bell in the top bar shows every alert, whatever you choose here.",
  prefsEmailsHeading: "Alert emails",
  prefsEmailsHint: "Each email links to the record in the admin.",
  prefsHint: {
    offerViewed: "When a client opens a proposal or estimate. Off unless you switch it on.",
    paymentReceived: "When a client pays an invoice or payment request online.",
    approvals: "When a payment someone recorded waits for your check.",
    hookFailed: "When a payment gateway or the email service can't reach us, or a payment needs review.",
  },
  prefsOwnerOnly: "Payment and connection alerts go to owners only.",
  digestHeading: "Weekly digest",
  digestHint:
    "An email every Monday at 09:00 IST with the pipeline, invoices, payments, overdue invoices, new leads and reminders due.",
  digestOffOneClick: "You switched the digest off from its email. Switch it on here to get it again.",
  prefsSaved: "Notification settings saved.",
  prefsStale: "These settings changed in another window since you opened them.",
  accountLink: "Notifications",
  accountLinkHint: "Choose which alerts also come to you by email.",

  // ---- G2: the email log ----
  logTitle: "Emails",
  logLede:
    "Every email the admin sent or tried to send, newest first, with what the receiving mail server reported back. Times in IST.",
  settingsLink: "Open the email log",
  settingsLinkHint: "Every email sent, and the addresses whose emails are stopped.",
  filterStatus: "Status",
  filterTemplate: "Email",
  filterSince: "Sent on or after",
  filterTo: "Recipient",
  filterToHint: "The full address, for example name@example.com.",
  filterToButton: "Find",
  filterToInvalid: "Enter a full email address, for example name@example.com.",
  allStatuses: "All statuses",
  allTemplates: "All emails",
  clearFilters: "Clear filters",
  colWhen: "Sent",
  colTo: "To",
  colTemplate: "Email",
  colStatus: "Status",
  colLastEvent: "Last update",
  noEvent: "None yet",
  onThisPage: (n: number) => `${plural(n, "1 email", `${n} emails`)} on this page`,
  emptyTitle: "No emails yet",
  emptyBody: "Emails appear here as the admin sends them.",
  emptyFilteredTitle: "No emails match these filters",
  emptyFilteredBody: "Try another status or an earlier date, or clear the filters.",
  newer: "Newer emails",
  older: "Older emails",
  openEmail: (to: string) => `Open the email to ${to}`,

  // ---- G2: one email ----
  detailCrumb: "Emails",
  detailTitle: (template: string) => template,
  factTo: "To",
  factStatus: "Status",
  factQueued: "Queued",
  factLastEvent: "Last update",
  factRecord: "Record",
  factError: "What went wrong",
  eventsHeading: "Delivery updates",
  eventsHint: "What the receiving mail server reported, as Amazon SES passed it on.",
  eventsNone: "No delivery updates yet. They usually arrive within a few minutes of sending.",
  eventType: {
    delivery: "Delivered",
    bounce: "Bounced",
    complaint: "Marked as spam",
    other: "Other update",
  } as Record<string, string>,
  bounceType: {
    permanent: "Permanent: the address doesn't exist or refuses mail",
    transient: "Temporary: the mailbox was full or the server was busy",
    undetermined: "The mail server didn't say why",
  } as Record<string, string>,
  eventOutcome: {
    applied: "",
    stale: "Arrived after a later update, so the status didn't change.",
    unknown_message: "Didn't match a sent email.",
    wrong_env: "Meant for another copy of the admin, so ignored.",
    ignored_type: "Not an update the admin tracks.",
  } as Record<string, string>,
  bounceDetail: (sub: string) => `Reason given: ${sub}`,
  notFound: "This email isn't in the log. It may have been removed after the retention period.",

  // ---- G3: suppression (the email detail and the contact) ----
  stopped: "Emails stopped",
  stoppedSince: (reason: string, date: string) => `${reason}, since ${date}`,
  stoppedLine: (reason: string, date: string) =>
    `Emails to this address are stopped. ${reason}, since ${date}. Nothing is sent to it until an owner allows emails again.`,
  allowAgain: "Allow emails again",
  allowAgainFor: (who: string) => ` to ${who}`,
  allowTitle: "Allow emails to this address again?",
  allowBody: (address: string) =>
    `Emails to ${address} start going again with the next one the admin sends. Do this only when you know the address works now, for example after the person told you their mailbox is fixed.`,
  allowSesCaution:
    "Amazon SES keeps its own list of addresses that bounced or marked mail as spam. An address on that list may still be refused, and the email log then shows it as not sent.",
  allowing: "Allowing…",
  allowed: (address: string) => `Emails to ${address} are allowed again.`,

  // ---- G4: the send pickers ----
  pickerStopped: (reason: string) => `Emails to this address are stopped (${reason}).`,
  pickerStoppedOwner: "An owner can allow them again on the contact.",

  // ---- G7: Send receipt again ----
  sendReceipt: "Send receipt again",
  sendReceiptTitle: (number: string) => `Send receipt ${number} again`,
  sendReceiptIntro:
    "The receipt email goes again, with the receipt as it was issued, to each contact you choose. It goes straight away.",
  sendReceiptTo: "Send to",
  sendReceiptToHint: "Contacts with portal access who can see finance. Choose up to 5.",
  sendReceiptNoneCan:
    "No contact at this client can get receipts: they need portal access and Can see finance.",
  sendReceiptContacts: "Open the client's contacts",
  sendReceiptNoPortal: "No portal access",
  sendReceiptNoFinance: "Can't see finance",
  sendReceiptRefused: "This contact can't get the receipt now: it needs portal access and Can see finance.",
  sendReceiptChooseOne: "Choose at least one contact.",
  sendReceiptTooMany: "Choose at most 5 contacts.",
  sendReceiptSend: "Send receipt",
  sendReceiptSending: "Sending…",
  sendReceiptSent: (n: number) => `Receipt sent again to ${plural(n, "1 contact", `${n} contacts`)}.`,
  cancel: "Cancel",
  loading: "Loading…",
} as const;

/** Every refusal of the M7.2 routes, by its code (C.1, C.2). */
export const ZQ_ERRORS: Record<string, string> = {
  stale_version:
    "This was changed in another window since you opened it. Reload to see the latest, then try again.",
  digest_owner_only: "The weekly digest goes to owners only.",
  not_suppressed: "Emails to this address aren't stopped any more. Reload to see the latest.",
  client_anonymised: "This client has been anonymised, so nothing can be changed or sent.",
  receipt_void: "This receipt was voided, so it can't be sent.",
  recipient_invalid:
    "Some contacts can't get this receipt: they need portal access and Can see finance. They're marked below.",
  forbidden: "You don't have access to do this.",
  not_found: "This isn't there any more. Reload to see the latest.",
};

/** The words for a refusal of these routes: by code, else the server's own message, else a generic line. */
export function zqErrorText(e: unknown): string {
  if (e instanceof RequestError) {
    const byCode = Object.hasOwn(ZQ_ERRORS, e.code) ? ZQ_ERRORS[e.code] : undefined;
    if (byCode) return byCode;
    if (e.status === 403) return ZQ_ERRORS.forbidden ?? "";
    if (e.status === 404) return ZQ_ERRORS.not_found ?? "";
    if (e.code === "network")
      return "The admin couldn't reach the server. Check your connection, then try again.";
    if (e.message) return e.message.endsWith(".") ? e.message : `${e.message}.`;
  }
  return "Something went wrong. Try again in a moment.";
}
