// Every word the M4.5 portal screens show (the shell, home, proposals and estimates, accept and decline), in three groups:
// - WORDS: taken from an approved source, named on each line (the M4.5 brief, docs/04, docs/06, docs/07 or the M1.6 copy.ts);
// - N: docs/07-content-appendix/N-m4.5-portal-offers.md word for word (approved by the owner with 07-Q, 2026-10-26);
//   shown as written;
// - PENDING: lines 07-N didn't have, approved word for word in 07-Q (POR1 to POR4), shown without a tag (the name keeps the
//   history of where they came from).
// English (India/UK spelling), "and" never "&", no banned phrases (07 §1.3). Acceptance and evidence wording: Researched 2026-10-28, 08-C RB-19, RB-20 (the ground for recording the IP address and browser: Settled by the lead on the safest reading, 2026-10-30 (08-C RB-12): DPDP s.7(a) with the Rule 6 log duty; GDPR Art. 6(1)(f) for EU and UK persons; the acceptance record is kept with the offer, RB-37 (b)).
import type { OfferKind, OfferStatus } from "./api.ts";
import { COPY } from "./copy.ts";

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
  // docs/07 §8: the proposal email's button, used for the same step in the portal (docs/13, 2026-10-25).
  reviewAndAccept: "Review and accept",
  // docs/06 §5.4 (owner decision 2026-10-24).
  allNeeded: "All fields are needed unless marked optional",
  // docs/07 §8: the footer line of every email, reused as the portal's footer.
  footer: "TecHaust Technologies · Balurghat, West Bengal, India · contact@techaust.com",
  // docs/07-A §7 (the website terms, "Client portal"): what accepting means and what is recorded. 07-Y item 13 (owner 2026-10-29): it says
  // "estimate" when the document is an estimate (`kind` is `kindWord`'s "proposal" or "estimate").
  binding: (kind: string) =>
    `Accepting ${kind === "estimate" ? "an estimate" : "a proposal"} in the portal (typing your name and clicking Accept) forms a binding agreement on the terms of that ${kind === "estimate" ? "estimate" : "proposal"}, and we keep a record of it (name, email, time, IP address, browser and a fingerprint of the document).`,
  kind: { proposal: "Proposal", estimate: "Estimate" } satisfies Record<OfferKind, string>,
  // The brief (Screens 3): the six states a client sees ("Declined" is the client's word, docs/13 2026-10-25).
  status: {
    sent: "Sent",
    viewed: "Viewed",
    accepted: "Accepted",
    declined: "Declined",
    expired: "Expired",
    revised: "Revised",
  } satisfies Record<OfferStatus, string>,
  // docs/06 §7.3 to §7.4 (the layouts) and the PDF's own words (07-P §1, `@techaust/pdf/copy`) for the cover and the cards.
  doc: {
    version: "Version",
    validUntil: "Valid until",
    total: "Total",
    number: "No.",
  },
} as const;

/** 07-N, word for word (PENDING the owner's approval). `{…}` parts are filled here. */
export const N = {
  // §1 Portal home and lists.
  account: "Your account",
  menu: "Menu",
  closeMenu: "Close menu",
  back: "Back",
  continue: "Continue",
  awaitingTitle: "Awaiting your decision",
  emptyTitle: "Nothing is waiting for your decision.",
  emptyBody: "When we send you a proposal or an estimate, it appears here. We email you each time too.",
  decidedTitle: "Decided",
  decidedEmpty: "Proposals and estimates you accept or decline are kept here.",
  backToList: "All proposals and estimates",
  alsoTitle: "Also in your portal",
  soon: {
    invoices: "Your invoices and payments will appear here.",
    projects: "Your projects and their milestones will appear here.",
    profile: "Your contact details will appear here.",
  },

  // §2 The proposal page.
  inScope: "In scope",
  outOfScope: "Out of scope",
  date: "Date",
  contactAtTecHaust: "Your contact at TecHaust",
  inWords: "Amount in words",
  contents: "Contents",
  docNav: "Document sections",
  preparing: "A new version is being prepared. We'll email you when it's ready.",
  superseded: (kind: string, n: number | string) =>
    `There's a newer version of this ${kind}. You're seeing version ${n}, the latest.`,
  expired: (kind: string, on: string) =>
    `This ${kind} expired on ${on}. Reply to our email or contact us if you'd still like to go ahead.`,
  token:
    "You opened this from an email link. You can review and accept it here, or sign in to see everything we've sent you.",
  signIn: "Sign in",
  pdfPreparing: "The PDF is being prepared. Check back in a minute.",

  // §3 Accept and decline.
  acceptIntro:
    "To accept, type your full name and tick the box. We record your acceptance against this exact version.",
  fullName: "Full name",
  nameHint: "As it should appear on the acceptance record.",
  nameMissing: "Type your full name.",
  readTerms: "Read the terms",
  agreeMissing: "Tick the box to confirm you agree to the terms.",
  errorsTitle: "Check these before you accept:",
  declineHint: "Not going ahead? You can decline instead and tell us why.",
  decline: "Decline",
  confirmTitle: (kind: string) => `Accept this ${kind}?`,
  confirmLead: "Please check the details below.",
  accepting: "Accepting…",
  acceptedTitle: (kind: string) => `You accepted this ${kind}`,
  acceptedByOtherTitle: (name: string, kind: string) => `${name} accepted this ${kind}`,
  fields: {
    acceptedBy: "Accepted by",
    email: "Email",
    when: "Date and time",
    // 07-ZA item 19 (owner 2026-10-30): the accepted PDF's fingerprint, told apart from the paper's "Content fingerprint".
    fingerprint: "PDF fingerprint",
    declinedBy: "Declined by",
    reason: "Reason",
  },
  locked: "This version is locked: it can't be changed or accepted again.",
  next: "What happens next: we'll confirm the start date with you and send the first invoice.",
  declineTitle: "Why are you declining?",
  /** The words of the decline codes (`DECLINE_REASONS` in @techaust/core/offers; "other" is WORDS.other). */
  reasons: {
    price: "The price doesn't fit our budget",
    timing: "The timing doesn't work for us",
    other_option: "We've chosen another option",
    not_needed: "We've decided not to go ahead",
    other: "Other",
  },
  otherLabel: "Tell us the reason",
  otherMissing: "Tell us the reason.",
  reasonMissing: "Choose a reason.",
  noteLabel: "Anything else we should know (optional)",
  declineConfirmTitle: (kind: string) => `Decline this ${kind}?`,
  declineConfirmBody: "We'll let the team know. You can still contact us if anything changes.",
  declining: "Declining…",
  declinedTitle: (kind: string) => `You declined this ${kind}`,
  declinedBody: "Thank you for telling us. We'll be in touch only if you ask us to.",

  // §7 Errors, by the API's code.
  errors: {
    pdf_pending: "The PDF is still being made. Try again in a minute.",
    certificate_pending: "The certificate is still being made. Try again in a minute.",
    superseded: "There's a newer version. Open the latest one.",
    expired: "This has expired and can't be accepted.",
    already_accepted: "This has already been accepted.",
    already_decided: "A decision has already been recorded.",
  },
} as const;

/**
 * Lines 07-N didn't have, approved word for word in 07-Q §3 (Portal, POR1 to POR4).
 */
export const PENDING = {
  // A typed name the server refuses for a reason the form can't catch first (07-N has "Type your full name." for an empty one).
  nameTooLong: "Shorten the name to 120 characters or fewer.",
  nameInvalid: "Take out any symbols or hidden characters, then type the name again.",
  // A label for "the next page of the list" (more than 50 proposals and estimates).
  showMore: "Show more",
  // Too many failed link checks from one network (a 429 on the email link; copy.ts has only the sign-in wording).
  linkRateLimited: (wait: string) =>
    `Too many attempts from this network. Wait ${wait}, then open the link again.`,
} as const;

/**
 * 07-A §9 (2026-10-28, from 08-C): the short notices at the point where data is collected. The lawful ground for recording the IP address and browser
 * is settled (Settled by the lead on the safest reading, 2026-10-30 (08-C RB-12): DPDP s.7(a) with the Rule 6 log duty; GDPR Art. 6(1)(f) for EU and UK persons; the acceptance record is kept with the offer, RB-37 (b)); the evidence an acceptance keeps is Researched 2026-10-28, BSA 2023 s.63(4) (08-C RB-19).
 */
export const NOTICES = {
  /** Above the Accept button of the confirmation step. */
  accept:
    "When you accept, we record your typed name, the time, your IP address and browser, and a fingerprint of this exact document, as the record of your acceptance.",
  /** Under the sign-in button: the sentence, then "See our [Privacy notice]." with the link on the privacy page of this environment's website (sign-in.tsx). */
  signIn: "We record the time, your IP address and browser when you sign in, as a security record.",
  signInSee: "See our",
  privacyNotice: "Privacy notice",
} as const;

/**
 * 07-X (M5 owner fixes, docs/07-content-appendix/X-m5-owner-fixes.md): lines APPROVED by the owner on 2026-10-29 (switched on in FX-5), shown with the "[Placeholder] " mark before the
 * designer's recommended words until the page is approved (then `APPROVED_07X` turns true and the marks go).
 */
export const APPROVED_07X = true;
const X = (line: string): string => (APPROVED_07X ? line : `[Placeholder] ${line}`);
export const OFFER_LINK = {
  /** §5.1 (sweep finding 7): an offer's email link that has ended, in the pattern of 07-U §3's invoice line. */
  ended: X(
    "This link no longer works. Sign in to your client portal to see your proposals and estimates, or ask us for a new link at contact@techaust.com.",
  ),
} as const;
