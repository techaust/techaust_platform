// M7.4's words (data-protection tooling; run file docs/runs/m7.4-data-protection.md H, L25, L31, L32), in ONE place for the jobs Worker, the email template, the
// admin and the portal; the next free 07 appendix letter is ZR (07-ZQ is M7.2's). Two kinds of line:
//   - the CLIENT lines C1 to C7 and the Rule 9 contact block are the owner's: until the owner approves them word for word they show the "[Placeholder] " mark,
//     and the jobs Worker queues no `request.received` email outside "local" while `APPROVED_07ZR` is false (the M6.5 receipt gate's pattern,
//     `requestCopyGate` in apps/jobs/src/requests.ts), so no portal request is marked acknowledged by an email that wasn't sent;
//   - the STAFF lines S1 to S10 the brief gives word for word, approved by the lead under the owner's delegation, are plain; the two bell kind words for the
//     new kinds (S3's list) are the builder's drafts for the lead, plain like M7.1's.
// No line is legal wording invented here: the Rule 9 block is 07-A §8's Grievance Officer block word for word (the brief says "§7": §8 is the block itself);
// Researched 2026-11-06, DPDP Rules 2025 r.14(3); SPDI r.5(9); privacy notice 07-A §§7–8 (08-C RB-47).

/** The owner's approval of the client lines C1 to C7 and the Rule 9 block (07-ZR). Not yet approved. */
export const APPROVED_07ZR: boolean = false;
const zr = (line: string): string => (APPROVED_07ZR ? line : `[Placeholder] ${line}`);

/**
 * The Rule 9 contact block: 07-A §8 word for word ("**Rupak Sarkar**, Founder, TecHaust Technologies · privacy@techaust.com · {{postal_address}}."). The postal
 * address is the owner's open input (07-A placeholders); until `site.postalAddress` exists it stays the marked gap.
 */
export const RULE9_BLOCK = (postalAddress: string | null): string =>
  zr(
    `Rupak Sarkar, Founder, TecHaust Technologies · privacy@techaust.com · ${postalAddress && postalAddress !== "" ? postalAddress : "[Placeholder] postal address"}.`,
  );

/** C5, C6: the portal's labels of the two new kinds (beside 07-ZP C19's five). */
export const NEW_KIND_LABELS = {
  consent_withdrawal: zr("Withdraw my consent"),
  nomination: zr("Nominate someone to act for me"),
} as const;

/** 07-ZP C19's approved labels of M7.1's five kinds, with C5 and C6: what C3 names the request by. */
export const REQUEST_KIND_LABELS: Record<string, string> = {
  contact_change: "Add, remove or change a person's access",
  data_access: "Get a copy of my personal data",
  data_correction: "Correct my personal data",
  data_erasure: "Erase my personal data",
  grievance: "Raise a concern about how we handle my data",
  ...NEW_KIND_LABELS,
};

/** The portal's own requests (E). */
export const PORTAL_REQUEST_COPY = {
  /** C1 (replaces 07-ZP C21): the reply date is `due_at` in IST. */
  replyBy: (date: string) => zr(`We'll reply by email by ${date}.`),
} as const;

/** The acknowledgement email `request.received` (C2 to C4, L32: the Rule 9 block in every reply). */
export const REQUEST_RECEIVED_COPY = {
  /** C2 */
  subject: zr("We've received your request"),
  /** C3 */
  body: (kindLabel: string, date: string, dueDate: string) =>
    zr(`We received your "${kindLabel}" request on ${date}. We'll reply by ${dueDate}.`),
  /** C4: the house sign-off (07 §8, the lead acknowledgement's ending). */
  closing: zr("— TecHaust Technologies"),
} as const;

/** C7 (L31; the analyst's idea, not final wording): the privacy page's line on the keyed form kept after an erasure. For the owner with C1 to C6. */
export const PRIVACY_KEYED_FORM_LINE = zr(
  "If you ask us to erase your data, we keep only a scrambled form of your email address for 3 years, so that we don't email you and can show what you agreed to.",
);

// ---- staff lines (S1 to S10; lead's delegation) -----------------------------------------------------------------------------------------------------------------

export const STAFF_COPY = {
  /** S1 */
  legalHoldOn:
    "Legal hold is on. Nothing about this record can be erased, anonymised or deleted until the hold is lifted.",
  /** S2 */
  turnOnRealDeletion: "Turn on real deletion. Until then the clean-up only reports what it would delete.",
  /** S9 */
  liftTitle:
    "Allow emails again to an erased address. Use this only when the person has asked us to contact them again.",
  liftToast: "Emails to this address are allowed again.",
  liftNotFound: "This address isn't on the erased list.",
} as const;

/** A bell names a record by its client code or lead ref (13 2026-10-26); a request naming only an address has neither: the gap stays marked for the lead. */
export const requestRef = (clientCode: string | null, leadRef: string | null): string =>
  clientCode ?? leadRef ?? "[Placeholder] an address not in our records";

export const BELL_COPY = {
  /** S3 */
  reportReady: "The clean-up trial report is ready to review.",
  /** S3's pair for a live run that skipped held rows (`retention.done_with_holds`; builder's draft for the lead). */
  doneWithHolds: "The clean-up ran. Some records were kept because a legal hold stands on them.",
  /** S4 */
  overdue: (ref: string) => `A data request from ${ref} is past its reply date.`,
  /** S5 */
  dueSoon: (ref: string, days: number) => `A data request from ${ref} is due in ${days} days.`,
  /** S6 */
  ackOverdue: (ref: string) => `A request from ${ref} hasn't been acknowledged within 48 hours.`,
  /** S7 */
  r2Stuck: "Some stored files couldn't be deleted. A developer needs to look.",
  /** S10 (L25) */
  erasedSkip: (ref: string) =>
    `Emails to ${ref} are stopped because the address was erased. If they've asked to hear from us again, allow emails again in Settings › Data retention.`,
} as const;

/** S3's kind words for the two new kinds (builder's drafts for the lead, beside M7.1's in apps/jobs/src/portal-alerts.ts). */
export const NEW_KIND_BELL_WORDS = {
  consent_withdrawal: "withdrawal of their consent",
  nomination: "nomination of someone to act for them",
} as const;
