// M5.1: the two staff emails of an invoice issue request (ADM-INV-02, ADM-APR-01, ADM-APR-02), in the layout of the M4.5 discount approval
// emails (./offers.ts `approvalRequested` / `approvalDecided`: the subject as the heading, the sentence, "Open in admin"), each with its
// plain-text twin. Words: 07-R §3 "Approval emails" (PENDING the owner's word-for-word approval). A draft invoice has no number, so the
// request names the client and the total; the decision names the number it was issued as. Sent from no-reply@ (07-R §3). Every variable is
// escaped before it reaches HTML (`securityEmail`).
import { headerValue } from "./headers.ts";
import { type LayoutOptions, type Para, para, type Rendered, securityEmail } from "./templates.ts";

export type IssueRequestedData = {
  requester_name: string;
  client_name: string;
  /** The draft's total, formatted by the sender with core's `formatMoney` (never added up here). */
  total: string;
  /** The approvals queue (or the request) in admin. */
  admin_url: string;
};

/** To each owner: 07-R §3 "Request". */
export function staffApprovalIssueRequested(d: IssueRequestedData, opts: LayoutOptions): Rendered {
  const subject = headerValue(`Invoice issue requested for ${d.client_name}`);
  return securityEmail(subject, opts, {
    before: [
      para(
        `${d.requester_name} asked you to issue a draft invoice for ${d.client_name}, total ${d.total}. Open the approvals queue to issue or reject it.`,
      ),
    ],
    action: { label: "Open in admin", url: d.admin_url },
  });
}

export type IssueDecidedData = {
  /** "approved" (the invoice was issued) or "rejected". */
  decision: string;
  client_name: string;
  /** The number it was issued as (approved only). */
  number: string;
  /** The owner's reason; the line is left out when empty. */
  decision_note: string;
  /** The invoice (approved) or the draft (rejected) in admin. */
  admin_url: string;
};

/** A typed reason as a sentence: the full stop is added only when it does not already end in one. */
const sentence = (text: string): string =>
  /[.!?]$/.test(text.trimEnd()) ? text.trimEnd() : `${text.trimEnd()}.`;

/** To the requester: 07-R §3 "Decided"; the reason line only when the owner gave one. */
export function staffApprovalIssueDecided(d: IssueDecidedData, opts: LayoutOptions): Rendered {
  const issued = d.decision === "approved";
  const subject = headerValue(
    `Your invoice for ${d.client_name}: ${issued ? `Issued as ${d.number}` : "Rejected"}`,
  );
  const before: Para[] = [para(`The owner ${issued ? `issued it as ${d.number}` : "rejected the request"}.`)];
  if (d.decision_note.trim() !== "") before.push(para(`Reason: ${sentence(d.decision_note)}`));
  return securityEmail(subject, opts, { before, action: { label: "Open in admin", url: d.admin_url } });
}
