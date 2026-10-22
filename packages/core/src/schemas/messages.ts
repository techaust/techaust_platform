// Queue messages and the form's extra fields (M2.4). The web Worker validates a submission and puts a `LeadMessage`
// on the `leads` queue; the jobs Worker validates it again before touching the database. An `EmailMessage` goes on
// the `email` queue (docs/05 §11.1). No raw IP address appears in any of them: only `ipHash` (FRM-02).
import { z } from "zod";
import { LEAD_REF } from "../lead-ref.ts";
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

export const EMAIL_TEMPLATES = ["lead.acknowledgement", "lead.alert"] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export const emailMessage = z.object({
  template: z.enum(EMAIL_TEMPLATES),
  to: z.email().max(254),
  /** Template variables: strings only. */
  data: z.record(z.string(), z.string().max(5_000)),
  /** What the email is about; with `template` it identifies the email, so a redelivery sends nothing twice. */
  entity: z.object({ type: z.string().min(1).max(40), id: z.string().min(1).max(80) }),
});
export type EmailMessage = z.infer<typeof emailMessage>;
