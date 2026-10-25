// M4.5 plain skeletons: the proposal and estimate emails and the two approval emails (ADM-PROP-07, ADM-PROP-08, ADM-APR-01, ADM-MAIL-01).
// Words: 07 §8 (subjects and core sentences, "Review and accept" per docs/13) and 07-O (approval emails name the document by title and
// version). Everything not in 07 §8 is a visible "[Placeholder]" until 07-N is approved; the designer finishes the layout to the
// approved preview. Same layout helpers as the security emails; every variable is escaped before it reaches HTML.
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
  sender_name: string;
};

const isEstimate = (kind: string) => kind === "estimate";

/** The proposal or estimate sent to a contact (from hello@): 07 §8 subject and core sentence. */
export function offerSent(d: OfferSentData, opts: LayoutOptions): Rendered {
  const estimate = isEstimate(d.kind);
  const subject = headerValue(
    `${estimate ? "Estimate" : "Proposal"}: ${d.title} (${d.number} v${d.version})`,
  );
  const covers = estimate
    ? "the line items, price and payment terms"
    : "scope, timeline, price and payment schedule";
  const lead = `Hi ${d.first_name}, your ${estimate ? "estimate" : "proposal"} is ready. It covers ${covers}, and it's valid until ${d.valid_until}.`;
  const before: Para[] = [para(lead)];
  const after: Para[] = [];
  if (d.attached === "1") after.push(para("[Placeholder] The PDF is attached."));
  after.push(para("Questions? Just reply to this email."));
  if (d.sender_name) after.push(para(`[Placeholder] ${d.sender_name}`));
  return securityEmail(subject, opts, {
    before,
    facts: {
      rows: [
        ["[Placeholder] Total", d.total],
        ["[Placeholder] Valid until", d.valid_until],
      ],
      text: `[Placeholder] Total: ${d.total}\n[Placeholder] Valid until: ${d.valid_until}`,
    },
    after,
    action: { label: "Review and accept", url: d.url },
  });
}

export type OfferAcceptedData = {
  typed_name: string;
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

/** The confirmation to the client (07 §8 "Proposal accepted"): sent once the certificate exists. */
export function offerAcceptedClient(d: OfferAcceptedData, opts: LayoutOptions): Rendered {
  return securityEmail(acceptedSubject(d), opts, {
    before: [
      para(
        `Thank you, ${d.typed_name}. Your acceptance was recorded on ${d.accepted_at_ist}. Links to the accepted proposal and the acceptance certificate are below.`,
      ),
      para(`Next: ${d.next_step}.`),
    ],
    action: { label: "[Placeholder] Open in the portal", url: d.url },
  });
}

/** The same acceptance to TecHaust (the sender and the active owners): 07 §8 gives the subject; the body is a placeholder. */
export function offerAcceptedStaff(d: OfferAcceptedData, opts: LayoutOptions): Rendered {
  return securityEmail(acceptedSubject(d), opts, {
    before: [
      para(
        `[Placeholder] ${d.typed_name} accepted ${d.title} (${d.number} v${d.version}) on ${d.accepted_at_ist}.`,
      ),
    ],
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
  const before = [para(`${d.approver_name} has ${d.decision} your request for ${d.title} v${d.version}.`)];
  if (d.decision_note) before.push(para(`Note: ${d.decision_note}.`));
  return securityEmail(subject, opts, { before, action: { label: "Open in admin", url: d.admin_url } });
}
