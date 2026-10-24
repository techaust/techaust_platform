// The starting texts for a reply written on the lead page (M3.2, ADM-LEAD-06). Word for word from 07-I
// (docs/07-content-appendix/I-m3.2-lead-replies.md), approved by the owner on 2026-10-24: do not reword them here.
//
// The words are exactly 07-I's; only the line breaks differ (owner, 2026-10-25, "Separate lines": greeting, message and
// sign-off on their own lines). A template only fills the reply box: the sender reads and edits it before sending. `{{name}}` is filled in by the system
// (`fillReplyTemplate`); each `[...]` in `REPLY_GAPS` is a gap the sender must fill: a reply that still holds one is refused (`hasUnfilledGap`).
// Pure data and string functions in core (not in packages/email) because the admin Worker must not import @techaust/email at all
// (CPU budget guard, apps/web/test/signin-config.test.ts); the `lead.reply` email itself is rendered in packages/email.

/** Replies one member may send per hour (the admin Worker counts them in the conditional write; the reply screen says so). */
export const LEAD_REPLIES_PER_HOUR = 20;

export type ReplyTemplate = {
  id: string;
  label: string;
  subject: string;
  body: string;
};

export const REPLY_TEMPLATES: readonly ReplyTemplate[] = [
  {
    id: "book_a_call",
    label: "Book a call",
    subject: "Re: your enquiry ({{ref}})",
    body: "Hi {{first_name}},\n\nthanks for telling us about {{service_or_request}}. The next step is a short call, about 30 minutes, so we can understand what you need and tell you honestly whether we're a good fit. Could you reply with two or three times that suit you? We're available Mon–Sat, 10:00–19:00 IST.\n\nRegards, {{sender_name}}, TecHaust Technologies",
  },
  {
    id: "a_few_questions_first",
    label: "A few questions first",
    subject: "Re: your enquiry ({{ref}})",
    body: "Hi {{first_name}},\n\nthanks for getting in touch about {{service_or_request}}. Before we suggest an approach and a price, it would help to know a little more: [your questions]. A few lines on each is plenty.\n\nRegards, {{sender_name}}, TecHaust Technologies",
  },
  {
    id: "not_the_right_fit",
    label: "Not the right fit",
    subject: "Re: your enquiry ({{ref}})",
    body: "Hi {{first_name}},\n\nthank you for considering us for {{service_or_request}}. Having looked at what you need, we don't think we're the right team for it, and we'd rather tell you now than take up your time. [Optional: a suggestion of where to look instead.] We wish you the best with it.\n\nRegards, {{sender_name}}, TecHaust Technologies",
  },
];

/** The values the system fills (07-I "System fields"). */
export type ReplyVars = {
  /** The first word of the lead's name. */
  first_name: string;
  /** The service name, or the request type, as in the 07-H bell text. */
  service_or_request: string;
  /** The signed-in member's name. */
  sender_name: string;
  /** The lead reference. */
  ref: string;
};

const fill = (text: string, vars: ReplyVars): string =>
  text.replace(
    /\{\{(first_name|service_or_request|sender_name|ref)\}\}/g,
    (_, k: keyof ReplyVars) => vars[k],
  );

/** A template with the system fields filled in; the `[...]` gaps are left for the sender. */
export function fillReplyTemplate(t: ReplyTemplate, vars: ReplyVars): { subject: string; body: string } {
  return { subject: fill(t.subject, vars), body: fill(t.body, vars) };
}

/**
 * The gaps the 07-I templates contain. Only these exact texts block sending: any other square bracket ("See point [1]")
 * is ordinary text. A new template gap must be added here (a test checks every bracket in the templates is listed).
 */
export const REPLY_GAPS: readonly string[] = [
  "[your questions]",
  "[Optional: a suggestion of where to look instead.]",
];
export const hasUnfilledGap = (...texts: string[]): boolean =>
  texts.some((t) => REPLY_GAPS.some((g) => t.includes(g)));

export const replyTemplateById = (id: string): ReplyTemplate | undefined =>
  REPLY_TEMPLATES.find((t) => t.id === id);
