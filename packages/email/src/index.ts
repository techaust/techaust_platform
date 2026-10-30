// @techaust/email: templates (HTML + text), header sanitising and the SES v2 client (docs/05 §11.1).

import {
  alertProformaDue,
  alertUnbilled,
  type DocumentEmailData,
  type DocumentKind,
  documentSent,
  lutReminder,
  reminderSent,
} from "./billing.ts";
import { staffApprovalIssueDecided, staffApprovalIssueRequested } from "./invoices.ts";
import {
  approvalDecided,
  approvalRequested,
  offerAcceptedClient,
  offerAcceptedStaff,
  offerDeclinedStaff,
  offerSent,
} from "./offers.ts";
import { edfReminder, realisationAlert } from "./reports.ts";
import {
  type LayoutOptions,
  leadAcknowledgement,
  leadAlert,
  leadReply,
  portalMagicLink,
  type Rendered,
  staffInvite,
  staffLockout,
  staffLockoutOwner,
  staffNewDevice,
  staffTwoFaChange,
  withTestNotice,
} from "./templates.ts";

export * from "./billing.ts";
export * from "./headers.ts";
export * from "./invoices.ts";
export * from "./offers.ts";
export * from "./reports.ts";
export * from "./templates.ts";
export * from "./transport.ts";

/**
 * Senders (docs/05 §11.1): replies go to the matching Zoho mailbox. `noReply` sends the sign-in link and the staff security
 * emails (04 §0 Q-P3-5); replies to them go to `contact@techaust.com` (owner, 2026-10-23).
 */
export const SENDERS = {
  hello: { name: "TecHaust Technologies", address: "hello@techaust.com" },
  noReply: { name: "TecHaust Technologies", address: "no-reply@techaust.com" },
  /** M5.4 (LD65, docs/13 2026-10-07): invoices, proformas, notes and payment reminders; replies go back to billing@. */
  billing: { name: "TecHaust Technologies", address: "billing@techaust.com" },
} as const;

/** The data of a client document email, exactly the keys of `INVOICE_EMAIL_DATA` (@techaust/core/invoices). */
const documentData = (get: (k: string) => string): DocumentEmailData => ({
  first_name: get("first_name"),
  number: get("number"),
  issue_date: get("issue_date"),
  due_date: get("due_date"),
  total: get("total"),
  balance: get("balance"),
  url: get("url"),
  attached: get("attached"),
  parent_number: get("parent_number"),
  sender_name: get("sender_name"),
  reason: get("reason"),
  parent_balance: get("parent_balance"),
});

/** M5.4: the template key of each client document email and the document it names. */
const DOCUMENT_TEMPLATES: Record<string, DocumentKind> = {
  "invoice.sent": "invoice",
  "proforma.sent": "proforma",
  "credit_note.sent": "credit_note",
  "debit_note.sent": "debit_note",
};

/** Where a reply to a `no-reply@` email goes (owner, 2026-10-23). */
export const NO_REPLY_REPLY_TO = "contact@techaust.com";

type Data = Record<string, string>;

const acceptedData = (get: (k: string) => string) => ({
  typed_name: get("typed_name"),
  email: get("email"),
  accepted_at_ist: get("accepted_at_ist"),
  title: get("title"),
  number: get("number"),
  version: get("version"),
  url: get("url"),
  next_step: get("next_step"),
  // 07-Y item 13: "proposal" or "estimate" (empty: a proposal, as older queued messages carry no kind).
  kind: get("kind"),
});

const who = (get: (k: string) => string) => ({ name: get("name"), first_name: get("first_name") });

/**
 * Renders a queued message to its email and picks the sender. A message with `test_name` in its data is a Settings test send
 * (07-H): the subject and a first line say so.
 */
export function renderEmail(
  template: string,
  data: Data,
  opts: LayoutOptions,
): Rendered & { from: { name: string; address: string }; replyTo: string } {
  const r = renderTemplate(template, data, opts);
  const testName = data.test_name;
  return testName ? { ...r, ...withTestNotice(r, testName) } : r;
}

/**
 * Renders a queued message to its email and picks the sender. Unknown templates throw (the consumer acknowledges
 * and logs them `failed`: retrying cannot help).
 */
function renderTemplate(
  template: string,
  data: Data,
  opts: LayoutOptions,
): Rendered & { from: { name: string; address: string }; replyTo: string } {
  const hello = { from: SENDERS.hello, replyTo: SENDERS.hello.address };
  const noReply = { from: SENDERS.noReply, replyTo: NO_REPLY_REPLY_TO };
  const billing = { from: SENDERS.billing, replyTo: SENDERS.billing.address };
  const get = (k: string) => data[k] ?? "";
  const documentKind = DOCUMENT_TEMPLATES[template];
  if (documentKind) return { ...billing, ...documentSent(documentKind, documentData(get), opts) };
  switch (template) {
    case "reminder.sent":
      return {
        ...billing,
        ...reminderSent(
          { ...documentData(get), offset_days: get("offset_days"), when: get("when"), kind: get("kind") },
          opts,
        ),
      };
    case "alert.unbilled":
      return {
        ...noReply,
        ...alertUnbilled(
          {
            owner_first_name: get("owner_first_name"),
            client_name: get("client_name"),
            admin_url: get("admin_url"),
            milestone_title: get("milestone_title"),
            delivered_date: get("delivered_date"),
            days_since: get("days_since"),
          },
          opts,
        ),
      };
    case "alert.proforma_due":
      return {
        ...noReply,
        ...alertProformaDue(
          {
            owner_first_name: get("owner_first_name"),
            client_name: get("client_name"),
            admin_url: get("admin_url"),
            milestone_title: get("milestone_title"),
            delivered_date: get("delivered_date"),
            days_since: get("days_since"),
            proforma_number: get("proforma_number"),
            balance: get("balance"),
          },
          opts,
        ),
      };
    case "lut.reminder":
      return {
        ...noReply,
        ...lutReminder(
          {
            owner_first_name: get("owner_first_name"),
            fy_label: get("fy_label"),
            state: get("state"),
            admin_url: get("admin_url"),
          },
          opts,
        ),
      };
    case "edf.reminder":
      return {
        ...noReply,
        ...edfReminder(
          {
            owner_first_name: get("owner_first_name"),
            month_label: get("month_label"),
            count: get("count"),
            due_date: get("due_date"),
            link: get("link"),
          },
          opts,
        ),
      };
    case "realisation.alert":
      return {
        ...noReply,
        ...realisationAlert(
          {
            owner_first_name: get("owner_first_name"),
            stage: get("stage"),
            number: get("number"),
            client: get("client"),
            currency: get("currency"),
            outstanding: get("outstanding"),
            due_date: get("due_date"),
            link: get("link"),
          },
          opts,
        ),
      };
    case "lead.acknowledgement":
      return {
        ...hello,
        ...leadAcknowledgement(
          {
            first_name: get("first_name"),
            service_name: get("service_name"),
            ref: get("ref"),
            cal_link: get("cal_link"),
          },
          opts,
        ),
      };
    case "lead.alert":
      return {
        ...hello,
        ...leadAlert(
          {
            ref: get("ref"),
            service_name: get("service_name"),
            budget_band: get("budget_band"),
            country: get("country"),
            name: get("name"),
            email: get("email"),
            phone: get("phone"),
            company: get("company"),
            timeline: get("timeline"),
            currency: get("currency"),
            tools: get("tools"),
            call_window: get("call_window"),
            message: get("message"),
            source_page: get("source_page"),
            type: get("type"),
            plan: get("plan"),
            admin_url: get("admin_url"),
            failed_queue: get("failed_queue"),
          },
          opts,
        ),
      };
    case "portal.magic_link":
      return {
        ...noReply,
        ...portalMagicLink(
          {
            url: get("url"),
            org_name: get("org_name"),
            expires_at: get("expires_at"),
            accounts: get("accounts"),
          },
          opts,
        ),
      };
    case "staff.new_device":
      return {
        ...noReply,
        ...staffNewDevice(
          {
            ...who(get),
            time: get("time"),
            device: get("device"),
            location: get("location"),
            role: get("role"),
          },
          opts,
        ),
      };
    case "staff.2fa_change":
      return {
        ...noReply,
        ...staffTwoFaChange(
          { ...who(get), time: get("time"), change: get("change"), role: get("role") },
          opts,
        ),
      };
    case "staff.lockout":
      return { ...noReply, ...staffLockout({ ...who(get), time: get("time"), role: get("role") }, opts) };
    case "staff.lockout_owner":
      return {
        ...noReply,
        ...staffLockoutOwner(
          {
            ...who(get),
            time: get("time"),
            member_name: get("member_name"),
            admin_url: get("admin_url"),
          },
          opts,
        ),
      };
    case "staff.invite":
      return {
        ...noReply,
        ...staffInvite({ inviter_name: get("inviter_name"), role: get("role"), url: get("url") }, opts),
      };
    case "lead.reply":
      return { ...hello, ...leadReply({ subject: get("subject"), body: get("body") }, opts) };
    case "offer.sent":
      return {
        ...hello,
        ...offerSent(
          {
            first_name: get("first_name"),
            kind: get("kind"),
            title: get("title"),
            number: get("number"),
            version: get("version"),
            valid_until: get("valid_until"),
            total: get("total"),
            url: get("url"),
            attached: get("attached"),
            sender_name: get("sender_name"),
          },
          opts,
        ),
      };
    case "offer.accepted.client":
      return { ...hello, ...offerAcceptedClient(acceptedData(get), opts) };
    case "offer.accepted.staff":
      return { ...hello, ...offerAcceptedStaff(acceptedData(get), opts) };
    case "offer.declined.staff":
      return {
        ...hello,
        ...offerDeclinedStaff(
          {
            name: get("name"),
            number: get("number"),
            version: get("version"),
            title: get("title"),
            reason: get("reason"),
            note: get("note"),
            url: get("url"),
          },
          opts,
        ),
      };
    case "approval.requested":
      // M5.1: an invoice issue request rides on the same key with `kind: "issue"` (07-R §3 words, from no-reply@).
      if (get("kind") === "issue")
        return {
          ...noReply,
          ...staffApprovalIssueRequested(
            {
              requester_name: get("requester_name"),
              client_name: get("client_name"),
              amount: get("amount"),
              admin_url: get("admin_url"),
              // M5.3: a credit or debit note names itself and its invoice (07-T §8); absent for an invoice
              document_type: get("document_type"),
              parent_number: get("parent_number"),
            },
            opts,
          ),
        };
      return {
        ...hello,
        ...approvalRequested(
          {
            requester_name: get("requester_name"),
            request_reason: get("request_reason"),
            title: get("title"),
            version: get("version"),
            amount: get("amount"),
            admin_url: get("admin_url"),
          },
          opts,
        ),
      };
    case "approval.decided":
      if (get("kind") === "issue")
        return {
          ...noReply,
          ...staffApprovalIssueDecided(
            {
              decision: get("decision"),
              client_name: get("client_name"),
              number: get("number"),
              decision_note: get("decision_note"),
              admin_url: get("admin_url"),
              document_type: get("document_type"),
            },
            opts,
          ),
        };
      return {
        ...hello,
        ...approvalDecided(
          {
            decision: get("decision"),
            approver_name: get("approver_name"),
            title: get("title"),
            version: get("version"),
            decision_note: get("decision_note"),
            admin_url: get("admin_url"),
          },
          opts,
        ),
      };
    default:
      throw new Error(`Unknown email template: ${template}`);
  }
}
