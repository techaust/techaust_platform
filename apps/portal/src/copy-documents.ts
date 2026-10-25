// Every word the M4.5 portal screens show (the shell, home, proposals and estimates, accept and decline), in two groups:
// - WORDS: taken from a source, which is named on each line (the M4.5 brief, docs/04, docs/06, docs/07 or the M1.6 copy.ts);
// - PENDING: drafted for the preview and shown with a visible "[Placeholder]" tag (components/pending.tsx) until the lead's
//   07-N is approved word for word by the owner. Nothing in PENDING is final; 07-N replaces it.
// English (India/UK spelling), "and" never "&", no banned phrases (07 §1.3).
import { COPY } from "./copy.ts";
import type { DocKind, DocStatus } from "./lib/document-view.ts";

export const WORDS = {
  // The brief (Screens 1): the navigation and the later sections' state.
  nav: {
    home: "Home",
    documents: "Proposals and estimates",
    invoices: "Invoices",
    projects: "Projects",
    profile: "Profile",
  },
  comingSoon: "Coming soon",
  // The admin shell's skip link (M3.1).
  skip: "Skip to content",
  // copy.ts (M1.6).
  signedInAs: COPY.home.signedInAs,
  signOut: COPY.home.signOut,
  signingOut: COPY.home.signingOut,
  allDevices: COPY.home.allDevices,
  allDevicesHint: COPY.home.allDevicesHint,
  confirmAllTitle: COPY.home.confirmTitle,
  confirmAllBody: COPY.home.confirmBody,
  cancel: COPY.home.cancel,
  notFound: COPY.notFound,
  signIn: COPY.signIn.title,
  // The brief (Screens 2 to 5) and ADM-PROP-08.
  view: "View",
  downloadPdf: "Download PDF",
  accept: "Accept",
  agree: "I have read and agree to the terms",
  downloadAccepted: "Download the accepted PDF",
  downloadCertificate: "Download the acceptance certificate",
  other: "Other",
  // docs/07 §8: the proposal email's button, used for the same step in the portal.
  reviewAndAccept: "Review and accept",
  // docs/06 §5.4 (owner decision 2026-10-24).
  allNeeded: "All fields are needed unless marked optional",
  // docs/07 §8: the footer line of every email, reused as the portal's footer.
  footer: "TecHaust Technologies · Balurghat, West Bengal, India · contact@techaust.com",
  // docs/07-A §7 (the website terms, "Client portal"): what accepting means and what is recorded.
  binding:
    "Accepting a proposal in the portal (typing your name and clicking Accept) forms a binding agreement on the terms of that proposal, and we keep a record of it (name, email, time, IP address, browser and a fingerprint of the document).",
  kind: { proposal: "Proposal", estimate: "Estimate" } satisfies Record<DocKind, string>,
  // The brief (Screens 3): the six states a client sees.
  status: {
    sent: "Sent",
    viewed: "Viewed",
    accepted: "Accepted",
    declined: "Declined",
    expired: "Expired",
    revised: "Revised",
  } satisfies Record<DocStatus, string>,
  // docs/06 §7.4 (the proposal layout) and §7.3 (the tables).
  doc: {
    preparedFor: "Prepared for",
    version: "Version",
    validUntil: "Valid until",
    summary: "Summary",
    goals: "Your goals",
    scope: "Scope",
    deliverables: "Deliverables",
    timeline: "Timeline",
    investment: "Investment",
    schedule: "Payment schedule",
    assumptions: "Assumptions and exclusions",
    terms: "Terms",
    acceptance: "Acceptance",
    milestone: "Milestone",
    whatYouGet: "What you get",
    targetDate: "Target date",
    paymentPct: "Payment %",
    lineNo: "#",
    description: "Description",
    qty: "Qty",
    unit: "Unit",
    rate: "Rate",
    discount: "Discount",
    taxable: "Taxable value",
    gstPct: "GST %",
    sac: "SAC",
    taxSummary: "Tax summary by SAC and rate",
    cgst: "CGST",
    sgst: "SGST",
    igst: "IGST",
    subtotal: "Sub-total",
    roundOff: "Round-off",
    total: "Total",
    zeroRated: "Zero-rated (LUT)",
    instalment: "Instalment",
    trigger: "Trigger",
    pct: "%",
    amount: "Amount",
    estimateNote: "This is an estimate, not a tax invoice.",
    gstin: "GSTIN",
    placeOfSupply: "Place of supply",
    number: "No.",
  },
} as const;

export const PENDING = {
  // Labels derived from the brief's wording, not yet in 07.
  fullName: "Full name",
  decline: "Decline",
  account: "Your account",
  menu: "Menu",
  closeMenu: "Close menu",
  back: "Back",
  continue: "Continue",
  inScope: "In scope",
  outOfScope: "Out of scope",
  date: "Date",
  contactAtTecHaust: "Your contact at TecHaust",
  inWords: "Amount in words",
  contents: "Contents",
  backToList: "All proposals and estimates",
  docNav: "Document sections",
  fields: {
    acceptedBy: "Accepted by",
    email: "Email",
    when: "Date and time",
    fingerprint: "Document fingerprint",
    declinedBy: "Declined by",
    reason: "Reason",
  },

  // Home and the list (POR-04, POR-05).
  awaitingTitle: "Awaiting your decision",
  emptyTitle: "Nothing is waiting for your decision",
  emptyBody: "When we send you a proposal or an estimate, it appears here. We email you each time too.",
  decidedTitle: "Decided",
  decidedEmpty: "Proposals and estimates you accept or decline are kept here.",
  alsoTitle: "Also in your portal",
  soon: {
    invoices: "Your invoices, receipts and payments will appear here in a later update of the portal.",
    projects: "Your projects, milestones and shared files will appear here in a later update of the portal.",
    profile: (org: string) =>
      `Your contact details, and the other people at ${org} who use the portal, will appear here in a later update.`,
  },

  // The proposal view (POR-05).
  replaced: (old: number, latest: number, on: string) =>
    `The link you opened was for version ${old}. We sent version ${latest} on ${on}, and that's the one shown here.`,
  expired: (kind: string, on: string) =>
    `This ${kind} expired on ${on}, so it can no longer be accepted. To go ahead, reply to the email it came with and we'll send a new version.`,
  token:
    "You opened this document from an email link, so only this document is shown. Sign in to see all your proposals and invoices.",

  // Accept (ADM-PROP-08).
  acceptIntro: (kind: string) =>
    `To accept this ${kind}, type your full name as it should appear on the record, and confirm that you agree to the terms.`,
  nameHint: "As it should appear on the acceptance record.",
  readTerms: "Read the terms",
  nameMissing: "Type your full name.",
  agreeMissing: "Tick the box to confirm you agree to the terms.",
  errorsTitle: "Check these before you accept:",
  declineHint: (kind: string) => `Not going ahead? Tell us why, and we can revise the ${kind}.`,
  confirmTitle: (kind: string) => `Accept this ${kind}?`,
  confirmLead: "Please check the details below.",
  accepting: "Accepting…",
  acceptedTitle: (kind: string) => `You accepted this ${kind}`,
  acceptedByOtherTitle: (kind: string, name: string) => `${name} accepted this ${kind}`,
  locked: "This version is locked: it can't be changed or accepted again.",
  next: "What happens next: we'll confirm the start date with you and send the first invoice.",

  // Decline (ADM-PROP-10).
  declineTitle: "Why are you declining?",
  reasons: [
    "The price is more than we planned",
    "The timeline doesn't suit us",
    "We're going ahead with another option",
    "We no longer need this work",
  ],
  reasonLegend: "Reason",
  noteLabel: "Anything else we should know (optional)",
  otherLabel: "Tell us the reason",
  reasonMissing: "Choose a reason.",
  otherMissing: "Tell us the reason.",
  declineConfirmTitle: (kind: string) => `Decline this ${kind}?`,
  declineConfirmBody:
    "We'll let the team know and keep your reason with the document. You can still ask us for a revised version.",
  declining: "Declining…",
  declinedTitle: (kind: string) => `You declined this ${kind}`,
  declinedBody: (kind: string) =>
    `Thank you for letting us know. If you'd like a revised ${kind}, reply to the email it came with.`,
} as const;
