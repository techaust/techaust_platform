// M7.1 (the full client portal): the staff lines of the admin screens [ADM-PAY-05, POR-09, POR-11; run file docs/runs/m7.1-portal.md G.7, H, L10, L25]: S1
// (the Payments "Notices" tab, its dismiss and "Record payment" from a notice), S2 (the client page's Requests panel and its close), S4 (the open-notice warning
// on void and withdraw), S6 (the close dialogs' "no personal data" hint) and S7 (the fixed note of a notice dismissed after the Owner issued the tax invoice for
// the payment received). Staff-only words, drafted by the designer under the lead's delegation in the plain style of the M6 screens, unmarked (the `ZO_UI`
// pattern) and listed in the run file's designer report. S3 (bells) is jobs' and S5 (audit labels) is lib/audit.ts. Every refusal is worded from its code.

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** A window event the Notices tab and the Requests panel fire when they change something, so the counts that hint at them follow at once. */
export const NOTICES_CHANGED = "ta:notices-changed";
export const REQUESTS_CHANGED = "ta:requests-changed";

export const ZP_UI = {
  // ---- S1: the Notices tab ----
  noticesTab: "Notices",
  noticesCount: (n: number) => plural(n, "1 open notice", `${n} open notices`),
  noticesLede:
    "What clients tell us they paid, from the portal or an invoice link. A notice is not a payment: check the bank, then record the payment from it, or dismiss it.",
  noticeStatus: { open: "Open", recorded: "Recorded", dismissed: "Dismissed" } as Record<string, string>,
  colTold: "Told us",
  colClient: "Client",
  colDocument: "Invoice",
  colAmount: "Amount",
  colPaidOn: "Paid on",
  colReference: "Reference",
  colFrom: "From",
  colStatus: "Status",
  colActions: "Actions",
  via: { portal: "Portal", link: "Invoice link" } as Record<string, string>,
  noticeNote: "Their note",
  closedBy: (name: string, date: string) => `${name}, ${date}`,
  noticesEmptyOpen: "No open notices. When a client tells us they paid, it appears here.",
  noticesEmpty: "No notices here.",
  recordFromNotice: "Record payment",
  dismiss: "Dismiss",
  dismissTitle: "Dismiss this notice?",
  dismissBody:
    "The notice stays on record as dismissed and nothing changes on the invoice. Dismiss it when no such payment reached the bank, or when it was recorded another way.",
  dismissNoteLabel: "Why it is dismissed (optional)",
  dismissConfirm: "Dismiss notice",
  dismissed: "Notice dismissed.",
  /** L25: the Owner's way for a notice on a proforma (the existing advance flow), then the dismiss with S7's note. */
  /**
   * S9 (review M3, replacing S1's "Issue the tax invoice for the payment received" as the visible label): the Notices row's label, and the words its
   * accessible name adds after it (so the name starts with what is seen: "Issue tax invoice for the payment received, {amount} {number}").
   */
  issueFromNoticeShort: "Issue tax invoice",
  issueFromNoticeRest: "for the payment received",
  advanceDoneDismissFailed:
    "The tax invoice was issued, but the notice is still open. Dismiss it from the Notices tab.",
  /** In "Record payment" opened from a notice: what was prefilled, and that the bank comes first. */
  fromNotice: (client: string, date: string) =>
    `Filled in from ${client}'s notice of ${date}. Check the money reached the bank before you record it.`,
  /** `notice.recorded` false: the payment went in, the notice didn't move (someone changed it between the read and the write). */
  noticeNotMoved:
    "The payment was recorded, but the notice is still open: it changed while you were recording. Check it on the Notices tab.",
  noticeRecorded: "The notice is marked as recorded.",
  /** S8 (review M2): 409 `notice_mismatch` with `reason: "document"`, under the notice's invoice row: the payment must go on it, at least in part. */
  noticeOnDocument: "The notice is about this invoice: put the payment, or part of it, on this invoice.",

  /**
   * S10 (review M5): the Recorded tab's line for the payment recorded from a notice, by that payment's status now. A rejected or withdrawn payment says so
   * plainly (the notice stays "Recorded": it was recorded, and no money moved on it); the others name the status in 07-ZH line 27's words.
   */
  noticePayment: (statusLabel: string) => `Payment: ${statusLabel}`,
  noticePaymentUndone: {
    rejected: "Payment rejected later",
    withdrawn: "Payment withdrawn later",
  } as Record<string, string>,
  /** S11 (review M5): the reject and withdraw dialogs of an entry recorded from a client's notice. `via` is S1's "Portal" or "Invoice link". */
  entryFromNotice: (action: "reject" | "withdraw", date: string, via: string) =>
    `This entry was recorded from the client's notice of ${date} (${via}). If you ${action} it, the notice stays on the Notices tab's Recorded list, shown with this entry as ${action === "reject" ? "rejected" : "withdrawn"}. Tell the client if they still owe the money.`,

  // ---- S2: the client page's Requests panel ----
  requestsTab: "Requests",
  requestsCount: (n: number) => plural(n, "1 open client request", `${n} open client requests`),
  requestsLede:
    "What this client's contacts asked for from the portal. Answer by email, then close the request with what was done.",
  kind: {
    contact_change: "Change to a person's portal access",
    data_access: "Copy of their personal data",
    data_correction: "Correction of their personal data",
    data_erasure: "Erasure of their personal data",
    grievance: "Concern about how we handle their data",
  } as Record<string, string>,
  colRequest: "Request",
  colSent: "Sent",
  requestStatus: { open: "Open", closed: "Closed" } as Record<string, string>,
  outcome: { done: "Done", declined: "Declined" } as Record<string, string>,
  closeNoteRow: "Note",
  ownerOnly: "Only the Owner can close a request about personal data.",
  requestsEmpty: "No requests from this client's contacts yet.",
  requestsEmptyOpen: "No open requests.",
  showClosed: "Show closed requests",
  showOpen: "Show open requests only",
  close: "Close",
  closeTitle: "Close this request?",
  closeOutcome: "Outcome",
  closeDone: "Done: we did what was asked",
  closeDeclined: "Declined: we can't do what was asked",
  closeDeclinedHint: "Tell the person why by email; this note is for our records.",
  closeNoteLabel: "Note for the record (optional)",
  closeConfirm: "Close request",
  closeOutcomeMissing: "Choose Done or Declined.",
  closed: "Request closed.",
  /** S6: under both close dialogs' note. */
  noPersonalData: "Don't include personal data.",

  // ---- S4: the warning on void and withdraw (never a block, L10) ----
  noticeWarning: (n: number, action: "void" | "withdraw") =>
    `${plural(n, "The client says they have paid this document (1 open notice", `The client says they have paid this document (${n} open notices`)} on the Payments › Notices tab). Check the bank before you ${action === "void" ? "void it" : "withdraw it"}. The notice doesn't stop the ${action === "void" ? "void" : "withdrawal"}.`,

  // ---- S7: the fixed note when a proforma's notice is dismissed after its tax invoice was issued (L25) ----
  advanceDismissNote: "Tax invoice for the payment received issued from this notice.",
} as const;
