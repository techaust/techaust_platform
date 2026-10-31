// Queue messages and the form's extra fields (M2.4). The web Worker validates a submission and puts a `LeadMessage`
// on the `leads` queue; the jobs Worker validates it again before touching the database. An `EmailMessage` goes on
// the `email` queue (docs/05 §11.1). No raw IP address appears in any of them: only `ipHash` (FRM-02).
import * as z from "zod";
import { EMAIL_TEMPLATES } from "../email-templates.ts";
import { LEAD_REF } from "../lead-ref.ts";
import { ATTACHMENT_KEY } from "../offers.ts";
import { contactForm, quoteForm } from "./forms.ts";

/** Names of the fields the form pages post besides the visitor's answers (the designer's step uses these). */
export const FORM_FIELDS = {
  honeypot: "company_website",
  /** Milliseconds the form was open, measured by the page (`performance.now()`), so a wrong device clock can't matter. */
  elapsed: "form_elapsed_ms",
  turnstile: "cf-turnstile-response",
} as const;

/** A form must have been open at least this long before it can be sent (FRM-03). */
export const MIN_FILL_MS = 3_000;

export const FORM_KINDS = ["contact", "quote"] as const;
export type FormKind = (typeof FORM_KINDS)[number];
/** Stored with each lead (`leads.form_version`); bump when a form's questions change. */
export const FORM_VERSIONS: Record<FormKind, string> = { contact: "contact-1", quote: "quote-1" };

const empty = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const text = (max: number) => z.string().trim().min(1).max(max);
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const NO_CONTROL = /^[^\u0000-\u001f\u007f-\u009f]*$/;

const SLUG = /^[a-z0-9-]{1,30}$/;

/** Attribution and consent fields posted with the form (FRM-05, FRM-06). Anything else is ignored. */
export const formMeta = z.object({
  noticeVersion: z.string().regex(/^\d{1,3}(\.\d{1,3}){0,2}$/, { error: "Missing notice version" }),
  sourcePage: z.preprocess(
    empty,
    z
      .string()
      .max(200)
      .regex(/^\/[^\s]*$/)
      .regex(NO_CONTROL)
      .optional(),
  ),
  referrerHost: z.preprocess(
    empty,
    z
      .string()
      .max(253)
      .regex(/^[a-z0-9.-]+$/i)
      .optional(),
  ),
  currency: z.preprocess(empty, z.enum(["INR", "USD"]).optional()),
  /** `?type=pilot` and `?plan=<tier>` of the quote link (lower-case slugs). */
  type: z.preprocess(empty, z.string().regex(SLUG).optional()),
  plan: z.preprocess(empty, z.string().regex(SLUG).optional()),
  utm: z
    .object({
      source: z.preprocess(empty, text(100).regex(NO_CONTROL).optional()),
      medium: z.preprocess(empty, text(100).regex(NO_CONTROL).optional()),
      campaign: z.preprocess(empty, text(100).regex(NO_CONTROL).optional()),
      term: z.preprocess(empty, text(100).regex(NO_CONTROL).optional()),
      content: z.preprocess(empty, text(100).regex(NO_CONTROL).optional()),
    })
    .default({}),
});
export type FormMeta = z.infer<typeof formMeta>;

const messageBase = {
  ref: z.string().regex(LEAD_REF),
  /** HMAC-SHA-256 (hex) of the visitor's address under FORMS_IP_PEPPER. */
  ipHash: z.string().regex(/^[0-9a-f]{64}$/),
  formVersion: z.string().min(1).max(30),
  noticeVersion: formMeta.shape.noticeVersion,
  sourcePage: formMeta.shape.sourcePage,
  referrerHost: formMeta.shape.referrerHost,
  utm: formMeta.shape.utm,
  currency: formMeta.shape.currency,
  type: formMeta.shape.type,
  plan: formMeta.shape.plan,
  /** UTC ms when the Worker accepted the submission. */
  submittedAt: z.int().positive(),
};

export const leadMessage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("contact"), payload: contactForm, ...messageBase }),
  z.object({ kind: z.literal("quote"), payload: quoteForm, ...messageBase }),
]);
export type LeadMessage = z.infer<typeof leadMessage>;

export { EMAIL_TEMPLATES, type EmailTemplate } from "../email-templates.ts";

/**
 * A file on an email (M4.5): a key in the DOCS bucket. The key must match the allow-list (a sent proposal or estimate PDF, or its
 * certificate), so a crafted message can never make the consumer read another object. The consumer checks the size (5 MB) and
 * sends the email link-only when the object is missing or too large.
 */
export const emailAttachment = z.object({
  key: z.string().max(120).regex(ATTACHMENT_KEY),
  filename: z
    .string()
    .max(100)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*.pdf$/),
});
export type EmailAttachment = z.infer<typeof emailAttachment>;

export const emailMessage = z.object({
  template: z.enum(EMAIL_TEMPLATES),
  to: z.email().max(254),
  /** Template variables: strings only. */
  data: z.record(z.string(), z.string().max(5_000)),
  /** What the email is about; with `template` it identifies the email, so a redelivery sends nothing twice. */
  entity: z.object({ type: z.string().min(1).max(40), id: z.string().min(1).max(80) }),
  /** M4.5: attach a stored PDF (see `emailAttachment`). */
  attachment: emailAttachment.optional(),
});
export type EmailMessage = z.infer<typeof emailMessage>;

/**
 * A staff security alert on the email queue (M2.4b, ADM-AUTH-09). The admin Worker puts ONLY the audit row's ID here: no
 * address, name or device text leaves it, and its sign-in paths gain no D1 read. The jobs Worker expands it into
 * ordinary `EmailMessage`s (the member, and for a lockout every active owner).
 */
export const staffAlertMessage = z.object({ kind: z.literal("staff.alert"), auditId: z.uuid() });
export type StaffAlertMessage = z.infer<typeof staffAlertMessage>;

/**
 * M4.5 expansion messages on the `email` queue. Ids only, never an address or a name: the jobs Worker reads the rows and queues
 * ordinary `EmailMessage`s. `offer.send` is one recipient (a `document_sends` row); `offer.decided` writes the bell rows and
 * nothing for the client; `offer.accepted` sends the confirmation once the certificate exists; `approval.notify` is the M4.3
 * approval emails (requested: to the active owners; decided: to the requester).
 */
export const offerSendMessage = z.object({ kind: z.literal("offer.send"), sendId: z.uuid() });
export const offerDecidedMessage = z.object({
  kind: z.literal("offer.decided"),
  documentId: z.uuid(),
  decision: z.enum(["accepted", "declined"]),
});
export const offerAcceptedMessage = z.object({ kind: z.literal("offer.accepted"), acceptanceId: z.uuid() });
export const approvalNotifyMessage = z.object({
  kind: z.literal("approval.notify"),
  approvalId: z.uuid(),
  event: z.enum(["requested", "decided"]),
});
export type OfferSendMessage = z.infer<typeof offerSendMessage>;
export type OfferDecidedMessage = z.infer<typeof offerDecidedMessage>;
export type OfferAcceptedMessage = z.infer<typeof offerAcceptedMessage>;
export type ApprovalNotifyMessage = z.infer<typeof approvalNotifyMessage>;
export type OfferExpansionMessage =
  | OfferSendMessage
  | OfferDecidedMessage
  | OfferAcceptedMessage
  | ApprovalNotifyMessage;

export const OFFER_EXPANSION_KINDS = [
  "offer.send",
  "offer.decided",
  "offer.accepted",
  "approval.notify",
] as const;
/** True for a body of the M4.5 expansion family (valid or not), so a malformed one is never handed to the ordinary email consumer. */
export const isOfferExpansionKind = (body: unknown): body is { kind: OfferExpansionMessage["kind"] } =>
  typeof body === "object" &&
  body !== null &&
  OFFER_EXPANSION_KINDS.includes((body as { kind: OfferExpansionMessage["kind"] }).kind);

/**
 * M5.4 invoice messages on the `email` queue (ids only, like the offer ones; a body of this family, valid or not, is never handed to the ordinary
 * email consumer). `invoice.send` is one recipient of an issued invoice, proforma, credit note or debit note (a `document_sends` row, LD55, LD56);
 * `reminder.send` is one reminder row (`reminders`), which the consumer claims once and expands to its recipients.
 */
export const invoiceSendMessage = z.object({ kind: z.literal("invoice.send"), sendId: z.uuid() });
export const reminderSendMessage = z.object({ kind: z.literal("reminder.send"), reminderId: z.uuid() });
export type InvoiceSendMessage = z.infer<typeof invoiceSendMessage>;
export type ReminderSendMessage = z.infer<typeof reminderSendMessage>;
export type InvoiceExpansionMessage = InvoiceSendMessage | ReminderSendMessage;
export const INVOICE_EXPANSION_KINDS = ["invoice.send", "reminder.send"] as const;
/** True for a body of the M5.4 invoice family (valid or not). */
export const isInvoiceExpansionKind = (body: unknown): body is { kind: InvoiceExpansionMessage["kind"] } =>
  typeof body === "object" &&
  body !== null &&
  INVOICE_EXPANSION_KINDS.includes((body as { kind: InvoiceExpansionMessage["kind"] }).kind);

/** What the `email` queue carries: an email to send, or a message to expand into emails. */
export type EmailQueueMessage =
  | EmailMessage
  | StaffAlertMessage
  | OfferExpansionMessage
  | InvoiceExpansionMessage;

// ---- M5.4 billing messages on the `leads` queue (the jobs Worker's general work queue; the cron only enqueues) -----------------------------------------------------------
// One unit of work per message (Free plan). Ids and cursors only: no clock, no period, no amount (`draftCarePlan` and `issueCareDraft` use their own).
const id64 = z.string().min(1).max(64);
const cursor = z.object({ at: z.int().nonnegative(), id: id64 });

/** `care.scan`: the next page (50) of active plans whose current period is not billed; `after` is the last row's `(created_at, id)` of the previous page (keyset, as `CARE_DUE_SQL` reads it). */
export const careScanMessage = z.object({ kind: z.literal("care.scan"), after: cursor.nullable() });
/** `care.bill`: draft one plan's invoice for its current period (the admin API's `draftCarePlan`). */
export const careBillMessage = z.object({ kind: z.literal("care.bill"), planId: id64 });
/** `care.issue`: issue one care draft automatically (the admin API's `issueCareDraft`). */
export const careIssueMessage = z.object({ kind: z.literal("care.issue"), documentId: id64 });
/**
 * `alerts.daily`: the owners' 09:00 IST alerts. `first` (only the cron's message) starts both lists and also does the LUT check; a continuation (`first` false) carries one cursor per list for the
 * unbilled and proforma-due lists past 50 rows, and on a continuation a null cursor means that list is FINISHED.
 */
export const alertsDailyMessage = z.object({
  kind: z.literal("alerts.daily"),
  first: z.boolean(),
  unbilledAfter: cursor.nullable(),
  proformaAfter: cursor.nullable(),
});
/** `reminder.scan`: the due reminders, 50 at a time; `after` is the last row's `(due_at, id)`. */
export const reminderScanMessage = z.object({ kind: z.literal("reminder.scan"), after: cursor.nullable() });
export type CareScanMessage = z.infer<typeof careScanMessage>;
export type CareBillMessage = z.infer<typeof careBillMessage>;
export type CareIssueMessage = z.infer<typeof careIssueMessage>;
export type AlertsDailyMessage = z.infer<typeof alertsDailyMessage>;
export type ReminderScanMessage = z.infer<typeof reminderScanMessage>;
export type BillingMessage =
  | CareScanMessage
  | CareBillMessage
  | CareIssueMessage
  | AlertsDailyMessage
  | ReminderScanMessage;
export const BILLING_KINDS = [
  "care.scan",
  "care.bill",
  "care.issue",
  "alerts.daily",
  "reminder.scan",
] as const;
// ---- M5.5b report messages on the `leads` queue (one unit of work each; the 09:00 IST tick only enqueues, no D1 read in the cron; LD76) ----
/**
 * `realisation.scan`: the export realisation alerts (ADM-REP-07, Q54). `after` is the last row's `(issue_date, id)` of the previous page of 50 (keyset, as
 * `REALISATION_SCAN_SQL` reads it); the first message of a day has none.
 */
export const realisationScanMessage = z.object({
  v: z.literal(1),
  kind: z.literal("realisation.scan"),
  after: z.object({ d: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), id: id64 }).optional(),
});
/** `edf.reminder`: the monthly Export Declaration Form reminder for the invoice month `year`-`month` (Q55); sent on IST days 5 to 7, once per owner per month. */
export const edfReminderMessage = z.object({
  v: z.literal(1),
  kind: z.literal("edf.reminder"),
  year: z.int().min(2000).max(9999),
  month: z.int().min(1).max(12),
});
/**
 * `statement.purge`: the daily clean-up of the statement PDF cache (Q57; `statement_pdfs` is a cache, not a record): rows older than 30 days and the rows of anonymised clients, with
 * their R2 objects, at most 50 a message. `asOf` is the cron's scheduled time (UTC ms); `after` is the last row's id of the previous page (keyset on the primary key).
 */
export const statementPurgeMessage = z.object({
  v: z.literal(1),
  kind: z.literal("statement.purge"),
  asOf: z.int().min(0),
  after: id64.optional(),
});
export type RealisationScanMessage = z.infer<typeof realisationScanMessage>;
export type EdfReminderMessage = z.infer<typeof edfReminderMessage>;
export type StatementPurgeMessage = z.infer<typeof statementPurgeMessage>;
export type ReportMessage = RealisationScanMessage | EdfReminderMessage | StatementPurgeMessage;
export const REPORT_KINDS = ["realisation.scan", "edf.reminder", "statement.purge"] as const;
/** True for a body of the M5.5b report family (valid or not), so a malformed one can never become a lead. */
export const isReportKind = (body: unknown): body is { kind: ReportMessage["kind"] } =>
  typeof body === "object" &&
  body !== null &&
  REPORT_KINDS.includes((body as { kind: ReportMessage["kind"] }).kind);

// ---- M6.2 gateway messages on the `leads` queue (L9: the existing queue, no new hosted queue; one unit of work each; the hourly tick only enqueues the sweep) ----
/** `gateway.event`: process one stored, verified webhook event (the admin finance Worker's `processEvent`). Its id only: the event row holds the rest. */
export const gatewayEventMessage = z.object({ kind: z.literal("gateway.event"), eventId: id64 });
/** `gateway.advance`: issue the tax invoice for one proforma payment received online (`issueGatewayAdvance`; L6, its own message). */
export const gatewayAdvanceMessage = z.object({ kind: z.literal("gateway.advance"), paymentId: id64 });
/** `gateway.sweep`: re-enqueue up to 20 events stuck in `received` for 15 minutes (fewer than 10 attempts). `asOf` is the cron's scheduled time (UTC ms). */
export const gatewaySweepMessage = z.object({ kind: z.literal("gateway.sweep"), asOf: z.int().min(0) });
export type GatewayEventMessage = z.infer<typeof gatewayEventMessage>;
export type GatewayAdvanceMessage = z.infer<typeof gatewayAdvanceMessage>;
export type GatewaySweepMessage = z.infer<typeof gatewaySweepMessage>;
export type GatewayMessage = GatewayEventMessage | GatewayAdvanceMessage | GatewaySweepMessage;
export const GATEWAY_KINDS = ["gateway.event", "gateway.advance", "gateway.sweep"] as const;
/** True for a body of the M6.2 gateway family (valid or not), so a malformed one can never become a lead (the consumer routes these before the lead fall-through). */
export const isGatewayKind = (body: unknown): body is { kind: GatewayMessage["kind"] } =>
  typeof body === "object" &&
  body !== null &&
  GATEWAY_KINDS.includes((body as { kind: GatewayMessage["kind"] }).kind);

/** True for a body of the M5.4 billing family (valid or not), so a malformed one can never become a lead. */
export const isBillingKind = (body: unknown): body is { kind: BillingMessage["kind"] } =>
  typeof body === "object" &&
  body !== null &&
  BILLING_KINDS.includes((body as { kind: BillingMessage["kind"] }).kind);
