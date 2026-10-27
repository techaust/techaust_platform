// M5.1: the two staff emails of an invoice issue request (ADM-INV-02, ADM-APR-01, ADM-APR-02), in the layout of the M4.5 discount approval
// emails (./offers.ts `approvalRequested` / `approvalDecided`: the subject as the heading, the sentence, "Open in admin"), each with its
// plain-text twin. Words: 07-R §3 "Approval emails" (PENDING the owner's word-for-word approval). A draft invoice has no number, so the
// request names the client and the total; the decision names the number it was issued as. Sent from no-reply@ (07-R §3). Every variable is
// escaped before it reaches HTML (`securityEmail`). The jobs Worker queues them under the discount emails' keys with `kind: "issue"` in the data
// (`approval.requested`, `approval.decided`), so the Settings list of templates is unchanged; `renderEmail` picks these for that kind.
//
// M5.3: the same two emails for a credit or debit note (07-T §8 "Approval emails, notes"; PENDING approval). The jobs Worker adds `document_type`
// ("credit note" or "debit note") and `parent_number` (the invoice the note is against) only for a note, so an invoice's email is unchanged. Any
// other `document_type` is not a note: the invoice's words are used.
import { headerValue } from "./headers.ts";
import { type LayoutOptions, type Para, para, type Rendered, securityEmail } from "./templates.ts";

/** The two document words a note's email may carry (07-T §8 "{credit/debit} note"); anything else reads as an invoice. */
const NOTE_WORDS = ["credit note", "debit note"] as const;
type NoteWord = (typeof NOTE_WORDS)[number];
const noteWordOf = (v: string | undefined): NoteWord | null =>
  (NOTE_WORDS as readonly string[]).includes(v ?? "") ? (v as NoteWord) : null;
/** "credit note" at the start of a subject: "Credit note". */
const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

export type IssueRequestedData = {
  requester_name: string;
  client_name: string;
  /** The draft's total, formatted by the sender with core's `formatMoney` (never added up here); named as in the discount email. */
  amount: string;
  /** The approvals queue (or the request) in admin. */
  admin_url: string;
  /** M5.3: "credit note" or "debit note" for a note (absent for an invoice). */
  document_type?: string | undefined;
  /** M5.3: the number of the invoice the note is against (a note only). */
  parent_number?: string | undefined;
};

/** To each owner: 07-R §3 "Request"; a note's own words, 07-T §8. */
export function staffApprovalIssueRequested(d: IssueRequestedData, opts: LayoutOptions): Rendered {
  const note = noteWordOf(d.document_type);
  if (note)
    return securityEmail(headerValue(`${capital(note)} issue requested for ${d.client_name}`), opts, {
      before: [
        para(
          `${d.requester_name} asked you to issue a draft ${note} for ${d.client_name}, total ${d.amount}, against invoice ${d.parent_number ?? ""}. Open the approvals queue to issue or reject it.`,
        ),
      ],
      action: { label: "Open in admin", url: d.admin_url },
    });
  const subject = headerValue(`Invoice issue requested for ${d.client_name}`);
  return securityEmail(subject, opts, {
    before: [
      para(
        `${d.requester_name} asked you to issue a draft invoice for ${d.client_name}, total ${d.amount}. Open the approvals queue to issue or reject it.`,
      ),
    ],
    action: { label: "Open in admin", url: d.admin_url },
  });
}

export type IssueDecidedData = {
  /** "Approved" (the invoice was issued) or "Rejected", as the discount email's `decision`; the case does not matter. */
  decision: string;
  client_name: string;
  /** The number it was issued as (approved only). */
  number: string;
  /** The owner's reason; the line is left out when empty. */
  decision_note: string;
  /** The invoice (approved) or the draft (rejected) in admin. */
  admin_url: string;
  /** M5.3: "credit note" or "debit note" for a note (absent for an invoice): 07-R §3's words with "{credit/debit} note" (07-T §8). */
  document_type?: string | undefined;
};

/** A typed reason as a sentence: the full stop is added only when it does not already end in one. */
const sentence = (text: string): string =>
  /[.!?]$/.test(text.trimEnd()) ? text.trimEnd() : `${text.trimEnd()}.`;

/** To the requester: 07-R §3 "Decided" (a note: the same with "{credit/debit} note", 07-T §8); the reason line only when the owner gave one. */
export function staffApprovalIssueDecided(d: IssueDecidedData, opts: LayoutOptions): Rendered {
  const issued = d.decision.toLowerCase() === "approved";
  const what = noteWordOf(d.document_type) ?? "invoice";
  const subject = headerValue(
    `Your ${what} for ${d.client_name}: ${issued ? `Issued as ${d.number}` : "Rejected"}`,
  );
  const before: Para[] = [para(`The owner ${issued ? `issued it as ${d.number}` : "rejected the request"}.`)];
  if (d.decision_note.trim() !== "") before.push(para(`Reason: ${sentence(d.decision_note)}`));
  return securityEmail(subject, opts, { before, action: { label: "Open in admin", url: d.admin_url } });
}
