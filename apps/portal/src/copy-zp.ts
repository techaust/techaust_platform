// M7.1 (the full client portal; POR-04, POR-06 to POR-11): the client lines C1 to C24 of docs/07-content-appendix/ZP-m7.1-portal.md, word for word, approved
// by the owner on 2026-11-05 (`APPROVED_07ZP`; the copy-y.ts pattern: while it was false every line showed the "[Placeholder] " mark). C25 is withdrawn (L27).
// `GAP` holds G1 to G12, the lines the screens needed that the run file's section H lacked, in the owner-approved 07-ZP words (unmarked); a newer gap line
// is written as `[Placeholder] …` until the owner gives its words. English (India/UK spelling), "and" never "&", no banned phrases (07 §1.3). No line names
// a card or bank field: there are none (ADM-PAY-12; Researched 2026-10-28, 08-C RB-07).

export const APPROVED_07ZP = true;
const P = (line: string): string => (APPROVED_07ZP ? line : `[Placeholder] ${line}`);

export const ZP = {
  /** C1: the navigation. */
  navReceipts: P("Receipts"),
  /** C2. */
  toPayTitle: P("Invoices to pay"),
  toPayEmpty: P("Nothing to pay right now."),
  /** C3. */
  receiptsTitle: P("Recent receipts"),
  allReceipts: P("All receipts"),
  receiptsEmpty: P("Receipts for your payments appear here."),
  /** C4 (07-N's projects line is the empty state). */
  projectsTitle: P("Your projects"),
  /** C5. */
  sharedTitle: P("Shared with you"),
  sharedLede: P("Notes and files we share with you appear here."),
  sharedEmpty: P("Nothing shared yet."),
  /** C6: a project's status, by its code. */
  projectStatus: {
    planned: P("Planned"),
    active: P("In progress"),
    on_hold: P("On hold"),
    completed: P("Completed"),
    cancelled: P("Cancelled"),
  } as Record<string, string>,
  /** C7: a milestone's status, by its code. */
  milestoneStatus: {
    pending: P("Upcoming"),
    ready_to_bill: P("Delivered"),
    invoiced: P("Invoiced"),
    paid: P("Paid"),
  } as Record<string, string>,
  /** C8. */
  started: (date: string) => P(`Started ${date}`),
  target: (date: string) => P(`Target date ${date}`),
  milestones: P("Milestones"),
  due: (date: string) => P(`Due ${date}`),
  viewInvoice: P("View invoice"),
  /** C9. */
  notes: P("Notes"),
  fromTecHaust: (date: string) => P(`From TecHaust, ${date}`),
  updated: (date: string) => P(`Updated ${date}`),
  notesEmpty: P("No shared notes yet."),
  /** C10. */
  files: P("Files"),
  fileName: P("Name"),
  fileSize: P("Size"),
  fileAdded: P("Added"),
  download: P("Download"),
  filesEmpty: P("No shared files yet."),
  fileGone: P("This file is no longer shared. Ask us if you still need it."),
  /** C11. */
  receiptsList: P("Receipts and credit notes"),
  colNumber: P("Number"),
  colDate: P("Date"),
  colAmount: P("Amount"),
  colFor: P("For"),
  downloadPdf: P("Download PDF"),
  receiptsListEmpty: P("No receipts yet. You get one for every payment we confirm."),
  /** C12: the chooser's bank-transfer way (with 07-U's "How to pay" line under it). */
  bankTransfer: P("Bank transfer"),
  /** C13: "I've paid" and its dialog. */
  paid: P("I've paid"),
  paidTitle: P("Tell us about your payment"),
  amountPaid: P("Amount paid"),
  datePaid: P("Date paid"),
  reference: P("Transaction reference (UTR or similar)"),
  note: P("Note (optional)"),
  noCardHint: P("Never type card or bank account numbers here."),
  send: P("Send"),
  cancel: P("Cancel"),
  /** C14. */
  paidThanks: P(
    "Thanks. We'll check our bank and confirm the payment. Until then the balance stays as it is.",
  ),
  /** C15: a notice refused, by the API's code. */
  noticeErrors: {
    amount_above_balance: (amount: string) => P(`That's more than the balance due (${amount}).`),
    date_in_future: P("The date can't be in the future."),
    date_before_issue: P("The date can't be before the invoice date."),
    notice_duplicate: P("We already have a notice with this reference."),
    notice_open_limit: P("You've told us about 3 payments for this document. We'll confirm them soon."),
    not_payable: P("This document can't take a payment notice."),
  },
  /** C16. */
  profileTitle: P("Profile"),
  yourDetails: P("Your details"),
  name: P("Name"),
  phone: P("Phone (optional)"),
  email: P("Email"),
  emailHint: P("You sign in with this email. To change it, send us a request below."),
  save: P("Save"),
  saved: P("Saved."),
  /** C17: 409 `stale_version`. */
  stale: P("Your details changed in another window. Reload to see them."),
  /** C18. */
  colleaguesTitle: (organisation: string) => P(`People from ${organisation} with portal access`),
  you: P("(you)"),
  /** C19: the requests and their five kinds, by code. */
  requestsTitle: P("Requests"),
  newRequest: P("New request"),
  kinds: {
    contact_change: P("Add, remove or change a person's access"),
    data_access: P("Get a copy of my personal data"),
    data_correction: P("Correct my personal data"),
    data_erasure: P("Erase my personal data"),
    grievance: P("Raise a concern about how we handle my data"),
  } as Record<string, string>,
  /** C20. */
  details: P("Details"),
  detailsHint: P("Tell us what you need. Don't include passwords, card or bank account numbers."),
  /** C21 (M7.4 C1 replaces it once the 30-day clock exists). */
  requestSent: P("Request sent. We'll reply by email within 30 days."),
  /** C22: shown with a `data_erasure` request (Researched 2026-10-28, RA-25; RB-37). */
  erasureKept: P("Some records, such as invoices, must be kept by law even after an erasure request."),
  /** C23. */
  open: P("Open"),
  closedOn: (date: string) => P(`Closed ${date}`),
  done: P("Done"),
  declined: P("Declined"),
  /** C24: 409 `request_open`, 429 `too_many_requests`. */
  requestOpen: P("You already have an open request of this kind. We'll answer it first."),
  tooManyRequests: P(
    "You've sent several requests today. Try again tomorrow, or email contact@techaust.com.",
  ),
} as const;

/**
 * Lines a screen needs that section H lacked: G1 to G12 in the owner-approved 07-ZP words (2026-11-05), unmarked (G11 and G12 came from review 1, L4 and M1).
 * A later gap line keeps the "[Placeholder] " mark until the owner gives its words.
 */
export const GAP = {
  /** G1: a receipt applied to more invoices than the list names (`for.more`). */
  forMore: (n: number) => `and ${n} more`,
  /** G2: the name left empty on Profile. */
  nameMissing: "Enter your name.",
  /** G3: a name or phone the server refuses (400 `bad_request` on save). */
  detailsRefused: "We couldn't save these details. Check your name and phone number.",
  /** G4: no kind chosen in the new-request dialog. */
  kindMissing: "Choose what your request is about.",
  /** G5: details left empty where the kind needs them, or over 1,000 characters. */
  detailsMissing: "Tell us a little about what you need.",
  detailsTooLong: "Keep it under 1,000 characters.",
  /** G6: "I've paid" without an amount, or one that can't be read. */
  amountMissing: "Enter the amount you paid.",
  amountUnread: "Enter the amount in numbers, for example 23,600.00.",
  /** G7: "I've paid" without a date (an unreadable one is G9). */
  dateMissing: "Enter the date you paid.",
  /** G8: "I've paid" without a reference, or one the server refuses (400 `bad_request` naming the reference). */
  referenceMissing: "Enter the transaction reference from your bank.",
  referenceRefused: "We couldn't read this reference. Check it and try again.",
  /** G9: the date field's own lines (as approved for staff). */
  dateInvalid: "Enter the date as DD/MM/YYYY, for example 26/10/2026.",
  choosePicker: "Choose a date",
  /** G10: a project page with no milestones. */
  milestonesEmpty: "No milestones yet.",
  /** G11 (review L4; owner-approved 2026-11-05): a shared file's size, "512 bytes", "248 KB", "1.8 MB" (`sizeText` in lib/m71.ts). */
  fileSize: (size: string) => size,
  /**
   * G12 (review M1; reworded by the owner 2026-11-05, re-check 6): "I've paid" with a note the server refuses (400 naming the note). The box already stops
   * more than 300 characters, so a refusal means a pasted control character. Never the reference's G8.
   */
  noteRefused: "We couldn't save this note. Remove any unusual characters and try again.",
} as const;

/**
 * Lines a screen needs that the owner hasn't given yet: each shows the "[Placeholder] " mark (scripts/check-prod-readiness.mjs blocks production while one
 * is on a page). Kept out of `zpAllText` (every approved line is unmarked).
 */
export const ZP_PENDING = {
  // TODO(07-ZP, owner's copy page, audit AU14 / B3 M6): the words for Profile › Requests with no request yet.
  requestsEmpty: "[Placeholder] Requests empty line (owner's words, 07-ZP)",
} as const;

/** Every line as text, for the tests (banned words, no "&"). */
export const zpAllText = (): readonly string[] => {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "function") out.push(String((v as (a: string) => string)("1")));
    else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
  };
  walk(ZP);
  walk(GAP);
  return out;
};
