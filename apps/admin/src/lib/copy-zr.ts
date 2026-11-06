// M7.4 (data-protection tooling; ADM-SET-09, ADM-CLI-05, FRM-05, POR-11; run file docs/runs/m7.4-data-protection.md G, H): the staff words of the admin's
// screens. The brief's S1, S2 and S9 come word for word from `@techaust/core/copy-zr` (`STAFF_COPY`, approved by the lead under the owner's delegation); every
// other line here is the DESIGNER's staff line for the lead (07-ZR "Designer's staff lines for the lead"), in the plain style of the M6 and M7 screens,
// unmarked (the `ZP_UI` pattern) and listed in the run file's designer report. No client line and no legal wording is written here: the client lines C1 to C7
// stay in core behind `APPROVED_07ZR`. English (India/UK spelling), "and" never "&", no banned phrases (07 §1.3). Pure, so the words are tested without a
// browser.
import { STAFF_COPY } from "@techaust/core/copy-zr";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The window event the inbox, the client's Requests tab and the lead page fire when they change a request, so the navigation's count follows at once. */
export { REQUESTS_CHANGED } from "./copy-zp.ts";

// ---- G.1 the requests inbox ---------------------------------------------------------------------------------------------------------------------------------

export { ZR_NAV } from "./copy-zr-nav.ts";

export const ZR_REQ = {
  title: "Requests",
  lede: "Every request about personal data or portal access, from the portal, email, post, phone or in person, with the day we must reply by.",
  logButton: "Log a request",
  showLabel: "Show",
  show: {
    open: "Open",
    overdue: "Overdue",
    due_soon: "Due within 5 days",
    ack_overdue: "Not acknowledged",
    closed: "Closed",
  } as Record<string, string>,
  kindLabel: "Kind",
  allKinds: "All kinds",
  colRequest: "Request",
  colFrom: "From",
  colReceived: "Received",
  colReplyBy: "Reply by",
  colStatus: "Status",
  open: "Open",
  openFor: (kind: string) => `Open ${kind}`,
  empty: {
    open: "No open requests.",
    overdue: "No request is past its reply date.",
    due_soon: "No request is due in the next 5 days.",
    ack_overdue: "Every open request has been acknowledged.",
    closed: "No closed requests yet.",
  } as Record<string, string>,
  emptyHint: "Requests from the client portal arrive here by themselves. Log the ones that come another way.",
  /** The staff names of the seven kinds (M7.1's five as approved in 07-ZP S2, then the two M7.4 kinds in the bells' words). */
  kind: {
    contact_change: "Change to a person's portal access",
    data_access: "Copy of their personal data",
    data_correction: "Correction of their personal data",
    data_erasure: "Erasure of their personal data",
    grievance: "Concern about how we handle their data",
    consent_withdrawal: "Withdrawal of their consent",
    nomination: "Nomination of someone to act for them",
  } as Record<string, string>,
  channel: {
    portal: "Client portal",
    email: "Email",
    post: "Post",
    phone: "Phone",
    in_person: "In person",
  } as Record<string, string>,
  state: {
    open: "Open",
    ack_overdue: "Not acknowledged",
    due_soon: "Due soon",
    overdue: "Overdue",
    closed: "Closed",
  } as Record<string, string>,
  daysLeft: (n: number) =>
    n === 0
      ? "Due today"
      : n > 0
        ? plural(n, "1 day left", `${n} days left`)
        : plural(-n, "1 day overdue", `${-n} days overdue`),
  /** The reply clock's accessible summary (the bar itself is hidden from assistive tech). */
  clockText: (received: string, due: string, left: string) =>
    `Received ${received}, reply by ${due}: ${left}.`,
  leadSubject: (ref: string) => `Lead ${ref}`,
  leadGone: "A lead since erased",
  contactGone: "A contact since erased",
  unmatched: "Not matched to a record",
  wholeClient: "The client as a whole",
  ackLate: "Not acknowledged within 48 hours",
} as const;

// ---- G.1 "Log a request" -----------------------------------------------------------------------------------------------------------------------------------

export const ZR_LOG = {
  title: "Log a request",
  intro:
    "For a request that reached us by email, post, phone or in person. Requests from the client portal are logged by themselves.",
  kind: "What they asked for",
  kindMissing: "Choose what they asked for.",
  channel: "How it reached us",
  channelMissing: "Choose how it reached us.",
  receivedOn: "Received on",
  receivedHint: "The day it reached us. The reply date counts from it.",
  receivedMissing: "Enter the day it reached us.",
  receivedFuture: "The day can't be in the future.",
  who: "Who it's from",
  whoMissing: "Choose who it's from.",
  subject: {
    contact: "A client's contact",
    lead: "A lead",
    email: "Someone not in our records",
    client: "A client as a whole",
  } as Record<string, string>,
  find: "Find them",
  findHint: {
    contact: "Type the start of their email address.",
    lead: "Type the start of the lead reference or their email address.",
    client: "Type the start of the client code or name.",
  } as Record<string, string>,
  findButton: "Find",
  findShort: "Type at least 2 characters.",
  findNone: "Nothing matches. Check the spelling, or log it as someone not in our records.",
  findFailed: "The search didn't work. Try again.",
  pickMissing: "Choose who it's from in the list.",
  change: "Change",
  chosen: "Chosen",
  email: "Their email address",
  emailMissing: "Enter their email address.",
  emailInvalid: "Enter the address as name@example.com.",
  erasureUnmatched:
    "An erasure request from someone not in our records can only be declined. If you find them later, log the request again against their contact or lead.",
  erasureWholeClient: "An erasure request is about one person: choose their contact or lead.",
  details: "Details",
  detailsHint: "What they asked for, in a line or two. Don't copy passwords or bank details into it.",
  detailsMissing: "Say briefly what they asked for.",
  detailsTooLong: "Keep it under 1,000 characters.",
  submit: "Log request",
  logged: "Request logged.",
  refused: {
    lead_converted: "This lead became a client. Log the request against its contact.",
    request_open: "This person already has an open request of this kind. Answer that one first.",
    anonymised: "This record was erased or anonymised. Log the request as someone not in our records.",
    not_found: "That record no longer exists. Find them again.",
    received_on_invalid: "The day can't be in the future.",
  } as Record<string, string>,
} as const;

// ---- G.1 one request: its steps and its close ---------------------------------------------------------------------------------------------------------------

export const ZR_DETAIL = {
  from: "From",
  received: "Received",
  channel: "How it reached us",
  replyBy: "Reply by",
  details: "Their words",
  noDetails: "No details given.",
  steps: "Steps",
  stepReceived: "Received",
  stepAck: "Acknowledged",
  stepIdentity: "Identity checked",
  stepClosed: "Closed",
  ackButton: "Mark as acknowledged",
  ackHint: "Once you've told them we have their request.",
  identityButton: "Record the identity check",
  identityHint: "Once you're sure the request comes from the person it's about.",
  identityByPortal: "By their sign-in to the client portal",
  stepNotYet: "Not yet",
  stepDone: "Done",
  ackDone: "Marked as acknowledged.",
  identityDone: "Identity check recorded.",
  stepAlready: "That step was already recorded. The request has been refreshed.",
  closedState: (outcome: string, date: string) => `${outcome} on ${date}`,
  closedBy: (name: string) => `by ${name}`,
  declineReasonRow: "Why it was declined",
  actionRow: "Fulfilled by",
  exportSentRow: "Export emailed",
  noteRow: "Note",
  erasureGuide: "Erase or anonymise them first, then close this request and link that action.",
  openContact: "Open the client's contacts",
  openLead: "Open the lead",
  ownerOnly: "Only the Owner can close a request about personal data.",
  closeButton: "Close request",
  back: "Back to the request",
  notInList: "This request isn't in the list shown. It may be closed: choose Closed under Show.",
  dialogTitle: (kind: string) => kind,
} as const;

export const ZR_CLOSE = {
  title: "Close this request?",
  outcome: "Outcome",
  done: "Done: we did what was asked",
  declined: "Declined: we can't do what was asked",
  outcomeMissing: "Choose Done or Declined.",
  identityFirst: "Record the identity check before closing this as done.",
  unmatchedErasure:
    "Nothing in our records was erased against this address, so this request can only be declined.",
  reason: "Why it's declined",
  reasonMissing: "Choose why it's declined.",
  reasons: {
    legal_hold: "A legal hold stands on their records",
    law_requires_keeping: "The law requires us to keep the data",
    identity_not_confirmed: "We couldn't confirm who they are",
    duplicate: "It repeats another request",
    not_on_record: "We hold no data about them",
    other: "Another reason",
  } as Record<string, string>,
  declinedHint: "Tell them why by email; the note is for our records.",
  action: "The erase or anonymise that fulfilled it",
  actionMissing: "Choose the erase or anonymise that fulfilled it.",
  actionLoading: "Looking for the erase or anonymise…",
  actionNone:
    "No erase or anonymise of this person since the request arrived. Do that first, then close the request.",
  actionFailed: "The list of erasures didn't load. Try again.",
  actionOption: (what: "erase" | "anonymise", date: string, by: string | null) =>
    `${what === "erase" ? "Erased" : "Anonymised"} on ${date}${by ? `, by ${by}` : ""}`,
  exportSent: "We emailed them the export",
  exportSentHint:
    "Download the export from their contact or lead, email it to the address we hold, then tick this.",
  exportSentOn: "Emailed on",
  exportSentMissing: "Enter the day you emailed it.",
  exportSentFuture: "The day can't be in the future.",
  note: "Note for the record",
  noPersonalData: "Don't include personal data.",
  confirm: "Close request",
  closed: "Request closed.",
  refused: {
    identity_not_checked: "Record the identity check before closing this as done.",
    action_missing: "Link the erase or anonymise of this person, made after the request arrived.",
    action_required: "Choose the erase or anonymise that fulfilled it.",
    decline_reason_required: "Choose why it's declined.",
    decline_reason_not_allowed: "That reason doesn't fit this request. Choose another.",
    export_sent_not_allowed:
      "Only a done request for a copy of their data records when the export was emailed.",
    request_closed: "This request is already closed. The list has been refreshed.",
    close_refused: "The request changed while you were closing it. Check it and try again.",
  } as Record<string, string>,
} as const;

// ---- G.2 legal hold ----------------------------------------------------------------------------------------------------------------------------------------

export const ZR_HOLD = {
  title: "Legal hold",
  /** S1 (the brief's words): the banner and the panel's "on" line. */
  on: STAFF_COPY.legalHoldOn,
  off: "No legal hold. This record can be erased, anonymised or deleted as usual.",
  onPill: "Legal hold",
  set: "Set a legal hold",
  lift: "Lift the legal hold",
  menuItem: "Legal hold",
  setTitle: (name: string) => `Set a legal hold on ${name}?`,
  liftTitle: (name: string) => `Lift the legal hold on ${name}?`,
  setBody:
    "While the hold stands, nothing about this record can be erased, anonymised or deleted, and the nightly clean-up passes it by. Use it while records are needed for a tax assessment, an audit or a dispute.",
  liftBody: "Erasure, anonymisation and the nightly clean-up apply to this record again from now.",
  reason: "Reason",
  reasonHint:
    "What the hold is for, for example the notice or case it relates to. Kept in the hold's history.",
  reasonMissing: "Enter the reason.",
  reasonTooLong: "Keep it under 500 characters.",
  confirmSet: "Set legal hold",
  confirmLift: "Lift legal hold",
  setDone: "Legal hold set.",
  liftDone: "Legal hold lifted.",
  history: "History",
  historyEmpty: "No hold has been set on this record.",
  historySet: (name: string) => `Set by ${name}`,
  historyLift: (name: string) => `Lifted by ${name}`,
  someone: "a former staff member",
  loadFailed: "The hold's history didn't load.",
  refused: {
    hold_unchanged: "The hold was already in that state. The page has been refreshed.",
    anonymised: "This contact was anonymised. Hold its client instead.",
  } as Record<string, string>,
} as const;

// ---- G.3 and G.7 Settings › Data retention -----------------------------------------------------------------------------------------------------------------

export const ZR_RETENTION = {
  rows: {
    requests: {
      label: "Closed data requests",
      desc: "Kept this long after they're closed. Never below 12 months.",
      error: "Keep closed data requests at least 12 months.",
    },
    consent: {
      label: "Consent records",
      desc: "What a person agreed to, kept this long after their enquiry or contact is gone. Never below 12 months.",
      error: "Keep consent records at least 12 months.",
    },
  },
  cleanTitle: "Nightly clean-up",
  cleanLede:
    "Each night the clean-up finds what is past the periods above. Financial records and anything under a legal hold are never deleted.",
  switchLabel: "Real deletion",
  /** S2 (the brief's words), under the switch while the clean-up is in trial mode. */
  trialLine: STAFF_COPY.turnOnRealDeletion,
  liveLine: (date: string, name: string | null) =>
    `Real deletion has been on since ${date}${name ? `, turned on by ${name}` : ""}. The clean-up deletes what its report lists.`,
  modeTrial: "Trial",
  modeLive: "Real deletion",
  noTrial: "There's no trial report yet. The first one arrives after tonight's clean-up.",
  staleTrial:
    "The last trial report is more than 7 days old. Wait for tonight's, then turn real deletion on.",
  onTitle: "Turn on real deletion?",
  onBody:
    "From tonight, the clean-up deletes what its report lists: records past the periods above. Financial records and records under a legal hold are kept. Deleted records can't be brought back.",
  onConfirm: "Turn on real deletion",
  offTitle: "Turn off real deletion?",
  offBody: "The clean-up goes back to reporting what it would delete. Nothing more is deleted from tonight.",
  offConfirm: "Turn off real deletion",
  onDone: "Real deletion is on.",
  offDone: "Real deletion is off. The clean-up only reports.",
  unchanged: "Real deletion was already in that state. The page has been refreshed.",
  reportTitle: "Clean-up reports",
  reportLede:
    "The last five runs. A trial run counts what a real run would delete; nothing is deleted in a trial.",
  reportEmpty: "No clean-up has run yet. The first report arrives after tonight's run.",
  reportFailed: "The clean-up reports didn't load.",
  runPicker: "Run",
  runLabel: (date: string, mode: string) => `${date}, ${mode === "live" ? "real deletion" : "trial"}`,
  running: "Still running",
  colWhat: "Records",
  colDue: (live: boolean) => (live ? "Deleted" : "Would delete"),
  colHeld: "Kept for a legal hold",
  colOldest: "Oldest",
  none: "None",
  partsPending: "Not counted yet",
  family: {
    email_log: "Email log",
    email_events: "Email delivery updates",
    access_log: "Access log",
    audit_ip: "IP addresses and browsers in the audit log",
    sessions: "Expired sign-in sessions and links",
    counters: "Sign-in and form counters",
    bells: "Notifications",
    stats: "Daily figures per care plan",
    requests: "Closed data requests",
    consent: "Consent records",
    runs: "Old clean-up reports",
  } as Record<string, string>,
  auditIpNote: "Audit entries stay; only their IP address and browser are removed.",
  leadsTitle: "Leads due for deletion in the next 14 days",
  leadsEmpty: "None.",
  leadsWhen: (date: string) => `on ${date}`,
  leadsTrial: "In trial mode they are reported, not deleted.",
  /** S9 (the brief's words): the title, the toast and the not-found error. */
  liftTitle: STAFF_COPY.liftTitle,
  liftToast: STAFF_COPY.liftToast,
  liftNotFound: STAFF_COPY.liftNotFound,
  liftHeading: "Allow emails again to an erased address",
  liftField: "Email address",
  liftButton: "Allow emails again",
  liftConfirmTitle: (email: string) => `Allow emails again to ${email}?`,
  liftConfirmBody:
    "This removes the stop written when the person's data was erased. We keep no copy of the address.",
  emailMissing: "Enter the email address.",
  emailInvalid: "Enter the address as name@example.com.",
} as const;

// ---- G.4 a lead's data tools -------------------------------------------------------------------------------------------------------------------------------

export const ZR_LEAD = {
  menu: "Data tools",
  menuFor: (name: string) => ` for ${name}`,
  export: "Export their data",
  withdraw: "Withdraw marketing consent",
  log: "Log a request",
  erase: "Erase this lead",
  exportTitle: (name: string) => `Export ${name}'s data`,
  exportExplainer:
    "Download everything we hold about this enquirer as a file, to answer their data request: the enquiry, its history, the emails we sent them and their consent records.",
  exportParts: {
    summary: "The enquiry",
    lead_activities: "Enquiry history",
    email_log: "Emails sent",
    consent_receipts: "Consent records",
  } as Record<string, string>,
  eraseTitle: (name: string) => `Erase ${name}?`,
  eraseBody: (name: string, email: string) =>
    `This deletes ${name}'s enquiry and its history, and every other enquiry from ${email} that didn't become a client. A scrambled form of the address is kept only so we don't email them again. This can't be undone.`,
  eraseConvertedHint: "This lead became a client: erase or anonymise its contact instead.",
  eraseConfirm: "Erase lead",
  erased: (refs: string[]) =>
    refs.length <= 1 ? "Lead erased." : `${refs.length} leads erased: ${refs.join(", ")}.`,
  refused: {
    legal_hold: "A legal hold stands on this person. Lift it before erasing.",
    lead_converted: "This lead became a client. Erase or anonymise its contact instead.",
    too_many_leads: (refs: string[]) =>
      `This person has too many enquiries to erase at once${refs.length ? ` (${refs.slice(0, 5).join(", ")}${refs.length > 5 ? " and more" : ""})` : ""}. Ask your developer to help.`,
    stale_version: "This lead changed. Reload and try again.",
  },
  withdrawTitle: (name: string) => `Withdraw ${name}'s marketing consent?`,
  withdrawBody:
    "Their consent record shows it withdrawn from today, and the withdrawal is added to their consent history.",
  withdrawConfirm: "Withdraw consent",
  withdrawn: "Consent withdrawn.",
  nothingToWithdraw: "This lead has no consent to withdraw.",
} as const;

// ---- G.5 the erase dialog's "in parts" state (F5) ----------------------------------------------------------------------------------------------------------

export const ZR_PARTS = {
  explain:
    "This person is named on more than 10 offers, so they're anonymised in parts: their details come off 10 offers at a time, then they're anonymised. Nothing has changed yet.",
  start: "Anonymise in parts",
  progress: (n: number) => `Details removed from ${plural(n, "1 offer", `${n} offers`)} so far.`,
  finishing: "Anonymising the contact…",
  stop: "Stop",
  stopped: (n: number) =>
    `Stopped. Details were removed from ${plural(n, "1 offer", `${n} offers`)}; the contact isn't anonymised yet. Continue when you're ready.`,
  continue: "Continue",
  failed: (n: number) =>
    `The anonymising stopped. Details were removed from ${plural(n, "1 offer", `${n} offers`)}; the contact isn't anonymised yet.`,
} as const;
