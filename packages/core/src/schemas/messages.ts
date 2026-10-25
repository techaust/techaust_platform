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

/** What the `email` queue carries: an email to send, or a message to expand into emails. */
export type EmailQueueMessage = EmailMessage | StaffAlertMessage | OfferExpansionMessage;
