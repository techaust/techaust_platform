// M4.5: the proposal and estimate emails and the two approval emails (ADM-PROP-07, ADM-PROP-08, ADM-APR-01, ADM-MAIL-01), in the brand
// layout of the M2.4 and M2.4b emails (the verdigris rule under the logo, the subject as the heading, label and value rows, the 48 px
// verdigris button with the plain address under it, light and dark), each with its plain-text twin.
// Words: 07 §8 (subjects and core sentences, "Review and accept" per docs/13), 07-O (approval emails name the document by title and
// version) and 07-N §4 (the fact labels, the PDF note, `next_step` and the TecHaust-side body; PENDING the owner's approval). A line that
// 07-N doesn't have is in 07-Q (approved 2026-10-26). Every variable is escaped before it reaches HTML. T6 (07-ZE lines 1, 3 and 4, approved
// 2026-10-31): the validity date says "(IST)", version 2 onwards says which version it replaces, and the closing line says how to accept; the
// words come from @techaust/core/offers, shared with the PDF, the portal and the admin preview.
import { OFFER_EMAIL_CLOSING, offerReplacesLine, validityDateIst } from "@techaust/core/offers";
import { headerValue } from "./headers.ts";
import { type LayoutOptions, type Para, para, type Rendered, securityEmail } from "./templates.ts";

export type OfferSentData = {
  first_name: string;
  /** "proposal" or "estimate". */
  kind: string;
  title: string;
  number: string;
  version: string;
  valid_until: string;
  /** The total, formatted by the sender (never added up here). */
  total: string;
  /** The offer link. */
  url: string;
  /** "1" when the PDF is attached. */
  attached: string;
  /** Who sent it (kept in the data; 07 §8 has no sign-off line, so the email doesn't print it). */
  sender_name: string;
};

const isEstimate = (kind: string) => kind === "estimate";

/** 07-N §4: the PDF note, with or without the attachment. */
export const PDF_NOTE = {
  attached: "The PDF is attached.",
  linked: "You can download the PDF from the same page.",
} as const;

/** The proposal or estimate sent to a contact (from hello@): 07 §8 subject and core sentence, 07-N §4 facts and PDF note. */
export function offerSent(d: OfferSentData, opts: LayoutOptions): Rendered {
  const estimate = isEstimate(d.kind);
  const subject = headerValue(
    `${estimate ? "Estimate" : "Proposal"}: ${d.title} (${d.number} v${d.version})`,
  );
  // 07-Y item 14 (owner 2026-10-29): the proposal's line no longer says it covers scope and timeline (those sections can be hidden); the
  // estimate's line is unchanged. 07-ZE line 1: the date says "(IST)" here and in the facts (OPEN (08-C RB-35(a)) answered by naming IST).
  const validUntil = validityDateIst(d.valid_until);
  const lead = estimate
    ? `Hi ${d.first_name}, your estimate is ready. It covers the line items, price and payment terms, and it's valid until ${validUntil}.`
    : `Hi ${d.first_name}, your proposal is ready, with the price and payment schedule. It's valid until ${validUntil}.`;
  const rows: [string, string][] = [
    ["Number", `${d.number} v${d.version}`],
    ["Total", d.total],
    ["Valid until", validUntil],
  ];
  // 07-ZE line 3, right after the first paragraph, from version 2 (Researched 2026-10-29, Contract Act s.6 (08-C RB-35); OPEN (08-C
  // RB-35(b)): s.5 not read).
  const replaces = offerReplacesLine(d.version);
  return securityEmail(subject, opts, {
    before: replaces ? [para(lead), para(replaces)] : [para(lead)],
    facts: { rows, text: rows.map(([k, v]) => `${k}: ${v}`).join("\n") },
    action: { label: "Review and accept", url: d.url },
    after: [
      para(d.attached === "1" ? PDF_NOTE.attached : PDF_NOTE.linked),
      // 07-ZE line 4 (Researched 2026-10-31, Contract Act s.7(2) (08-C RB-35)).
      para(OFFER_EMAIL_CLOSING),
    ],
    actionFirst: true,
  });
}

export type OfferAcceptedData = {
  typed_name: string;
  /** The address the acceptance was recorded with (07-N §4, TecHaust side). */
  email?: string;
  accepted_at_ist: string;
  title: string;
  number: string;
  version: string;
  /** Client: the portal link. Staff: the admin page of the document. */
  url: string;
  next_step: string;
  /** "proposal" or "estimate". */
  kind?: string;
};

const acceptedSubject = (d: OfferAcceptedData) =>
  headerValue(`Accepted: ${d.title} (${d.number} v${d.version})`);

/** The next step without a final full stop (07 §8 adds its own). */
const step = (s: string) => s.trim().replace(/\.$/, "");

/** The confirmation to the client (07 §8 "Proposal accepted"): sent once the certificate exists. */
export function offerAcceptedClient(d: OfferAcceptedData, opts: LayoutOptions): Rendered {
  return securityEmail(acceptedSubject(d), opts, {
    before: [
      para(
        // 07-Y item 13 (owner 2026-10-29): "estimate" when the document is an estimate.
        `Thank you, ${d.typed_name}. Your acceptance was recorded on ${d.accepted_at_ist}. Links to the accepted ${d.kind === "estimate" ? "estimate" : "proposal"} and the acceptance certificate are below.`,
      ),
    ],
    // 07-N has no label for this button yet (the link opens the accepted version, with both downloads).
    action: { label: "Open in the portal", url: d.url },
    after: [para(`Next: ${step(d.next_step)}.`)],
    actionFirst: true,
  });
}

/** The same acceptance to TecHaust (the sender and the active owners): 07 §8 subject, 07-N §4 body. */
export function offerAcceptedStaff(d: OfferAcceptedData, opts: LayoutOptions): Rendered {
  const who = d.email ? `${d.typed_name} (${d.email})` : d.typed_name;
  return securityEmail(acceptedSubject(d), opts, {
    before: [para(`${who} accepted ${d.number} v${d.version} on ${d.accepted_at_ist}.`)],
    action: { label: "Open in admin", url: d.url },
  });
}

export type OfferDeclinedData = {
  /** The person who declined (their name as on their contact record). */
  name: string;
  number: string;
  version: string;
  title?: string;
  /** The reason in 07-N §3's words. */
  reason: string;
  /** Optional; the sentence is left out when empty. */
  note: string;
  url: string;
};

/** A typed note as a sentence: the full stop is added only when the note does not already end in one. */
const sentence = (text: string): string =>
  /[.!?]$/.test(text.trimEnd()) ? text.trimEnd() : `${text.trimEnd()}.`;

/** The decline to TecHaust (the sender and the active owners): 07 §8 style subject, 07-N §4 "Declined email, TecHaust side". */
export function offerDeclinedStaff(d: OfferDeclinedData, opts: LayoutOptions): Rendered {
  const subject = headerValue(`Declined: ${d.title ?? ""} (${d.number} v${d.version})`);
  const note = d.note ? ` Note: ${sentence(d.note)}` : "";
  return securityEmail(subject, opts, {
    before: [para(`${d.name} declined ${d.number} v${d.version}. Reason: ${d.reason}.${note}`)],
    action: { label: "Open in admin", url: d.url },
  });
}

export type ApprovalRequestedData = {
  requester_name: string;
  request_reason: string;
  title: string;
  version: string;
  amount: string;
  admin_url: string;
};

/** To the owner: 07 §8, with the document named by title and version (07-O: a draft has no number yet). */
export function approvalRequested(d: ApprovalRequestedData, opts: LayoutOptions): Rendered {
  const subject = headerValue(`Approval needed: ${d.title} v${d.version}`);
  return securityEmail(subject, opts, {
    before: [
      para(
        `${d.requester_name} asks you to approve ${d.request_reason} for ${d.title} v${d.version} (${d.amount}).`,
      ),
    ],
    after: [para("Your decision applies to this version only.")],
    action: { label: "Open in admin", url: d.admin_url },
  });
}

export type ApprovalDecidedData = {
  decision: string;
  approver_name: string;
  title: string;
  version: string;
  decision_note: string;
  admin_url: string;
};

/** To the requester: 07 §8, by title and version; the note line only when there is a note. */
export function approvalDecided(d: ApprovalDecidedData, opts: LayoutOptions): Rendered {
  const subject = headerValue(`${d.decision}: ${d.title} v${d.version}`);
  const before: Para[] = [
    // FX-3 (A4 5): the decision is lower case mid-sentence ("has approved"); the subject keeps its capital ("Approved: …").
    para(`${d.approver_name} has ${d.decision.toLowerCase()} your request for ${d.title} v${d.version}.`),
  ];
  if (d.decision_note) before.push(para(`Note: ${sentence(d.decision_note)}`));
  return securityEmail(subject, opts, { before, action: { label: "Open in admin", url: d.admin_url } });
}
