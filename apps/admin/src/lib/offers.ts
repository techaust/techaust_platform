// What the M4.5 staff screens add to a proposal or estimate (ADM-PROP-07..10): sending to chosen contacts, the delivery of each email,
// the acceptance record and its certificate, a decline's reason, "Start project", sending again and revoking the links. The shapes are
// the API's (apps/admin/worker/document-offer.ts `OfferSection`, document-links.ts, document-start.ts); the words are 07-N §3, §6 and §7
// (approved with 07-Q) and, where 07-N had no line, `OFFER_PENDING` (its 07-Q words, no tag).
// Pure, so the copy and the rules are tested without a browser. Money is formatted only, never worked out.
import { RequestError } from "../api.ts";
import { docErrorText } from "./documents.ts";
import { REASON_LABEL, reasonText } from "./offer-words.ts";

// ---- the API's shapes ----------------------------------------------------------------------------------------------------------

export type DeliveryState =
  | "waiting_pdf"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed"
  | "skipped"
  | "not_sent";

export type DeliveryRow = {
  id: string;
  version: number;
  /** "send" (the first send of a version) or "resend". */
  kind: string;
  contactName: string | null;
  email: string | null;
  attachPdf: boolean;
  state: DeliveryState;
  at: number;
};

export type AcceptanceRecord = {
  id: string;
  documentId: string;
  contactName: string | null;
  typedName: string;
  email: string;
  acceptedAt: number;
  via: string | null;
  country: string | null;
  pdfSha256: string;
  snapshotSha256: string | null;
  /** The owner only (LD8): the evidence an owner may need. */
  ip?: string | null;
  userAgent?: string | null;
};

export type Decision = {
  status: string;
  at: number;
  reason: string | null;
  note: string | null;
  contactName: string | null;
};

export type StartProjectInfo = {
  project: { id: string; code: string } | null;
  milestones: number;
  firstInstalment: { type: string; amountMinor: number; pctBp: number; trigger: string } | null;
  reason?: string;
  missing?: string[];
};

/** What GET /documents/:id adds for a sent offer (M4.5). Absent on an older answer: treat as empty. */
export type OfferSection = {
  delivery?: DeliveryRow[];
  acceptance?: AcceptanceRecord | null;
  certificate?: { state: "none" | "pending" | "ready" };
  decision?: Decision | null;
  startProject?: StartProjectInfo | null;
};

export type StartResult = {
  projectId: string;
  code: string;
  draftId: string | null;
  created: boolean;
};

/** The most contacts one send may name (MAX_RECIPIENTS in apps/admin/worker/document-links.ts). */
export const MAX_RECIPIENTS = 5;

// ---- 07-N, word for word (approved, 07-Q) -----------------------------------------------------------------------------------

export const OFFER_COPY = {
  // §6 Send dialog.
  sendTitle: (numberOrTitle: string, version: number) => `Send ${numberOrTitle} v${version}`,
  sendTo: "Send to",
  sendToHint: "Contacts with portal access. Each gets their own link.",
  attach: "Attach the PDF",
  attachHint: "Off by default: the email links to the portal.",
  /** 07-Q Q13: the hint when the client's own setting starts the switch On. */
  attachHintOn: "On for this client: the PDF goes with the email.",
  message: "The message",
  noPortal: "Has no portal access yet",
  /** The owner's words (batch review M8): no contact can receive it, so Send is off; the line links to the client's Contacts tab. */
  noneWithPortal: "No contact of this client has portal access yet. Turn it on for a contact first.",
  contactsTab: "Contacts",
  /** 07-Q Q12: under the delivery list. */
  viewedHint: "Viewed means the link was opened. Email security scanners can open links too.",
  chooseOne: "Choose at least one contact.",
  sending: "Sending…",
  sentTo: (n: number) => (n === 1 ? "Sent to 1 contact." : `Sent to ${n} contacts.`),
  // §6 Delivery list.
  deliveryNote: "The email goes once the PDF is ready, usually within a minute.",
  // §6 Record panel.
  thisVersion: "This version",
  acceptance: "Acceptance",
  // §6 Start project.
  startTitle: "Start the project?",
  startBody:
    "This creates the project and its milestones from the payment schedule, and a draft of the first instalment for you to issue.",
  nothingSent: "Nothing is sent to the client.",
  starting: "Starting…",
  started: (code: string) => `Project ${code} started.`,
  // §3, the labels of a record (the client's words, the same facts for staff).
  acceptedBy: "Accepted by",
  email: "Email",
  when: "Date and time",
  fingerprint: "Document fingerprint",
  declinedBy: "Declined by",
  reason: REASON_LABEL,
  // The brief (ADM-PROP-08, Screens 4) and the portal's own label for the same file.
  downloadCertificate: "Download the acceptance certificate",
  startProject: "Start project",
  // 07-N §5: the certificate's labels used on the record.
  ip: "IP address",
  browser: "Browser",
} as const;

/**
 * The email as the dialog previews it: 07 §8 (subject, core sentence, "Review and accept", "Questions?") and 07-N §4 (the facts and the
 * PDF note), the same words packages/email sends (`offerSent`). The template is the source; a test keeps the two equal.
 */
export const EMAIL_PREVIEW = {
  from: "TecHaust Technologies, hello@techaust.com",
  subject: (kind: string, title: string, number: string, version: number) =>
    `${kind === "estimate" ? "Estimate" : "Proposal"}: ${title} (${number} v${version})`,
  lead: (kind: string, firstName: string, validUntil: string) =>
    kind === "estimate"
      ? `Hi ${firstName}, your estimate is ready. It covers the line items, price and payment terms, and it's valid until ${validUntil}.`
      : `Hi ${firstName}, your proposal is ready. It covers scope, timeline, price and payment schedule, and it's valid until ${validUntil}.`,
  facts: { number: "Number", total: "Total", validUntil: "Valid until" },
  button: "Review and accept",
  attached: "The PDF is attached.",
  linked: "You can download the PDF from the same page.",
  questions: "Questions? Just reply to this email.",
} as const;

/** The preview's PDF line for the switch's position (the send dialog always sends the switch, so this is the line that goes). */
export const pdfNote = (attached: boolean): string =>
  attached ? EMAIL_PREVIEW.attached : EMAIL_PREVIEW.linked;

/** 07-N §6: the four delivery words it has. */
const DELIVERY_N: Partial<Record<DeliveryState, string>> = {
  waiting_pdf: "Waiting for the PDF",
  queued: "Queued",
  sent: "Sent",
  failed: "Failed",
};

/** 07-N §7, by API code (the M4.5 codes; the M4.3 ones stay with `docErrorText`). */
export const OFFER_ERRORS: Record<string, string> = {
  pdf_pending: "The PDF is still being made. Try again in a minute.",
  certificate_pending: "The certificate is still being made. Try again in a minute.",
  superseded: "There's a newer version. Open the latest one.",
  expired: "This has expired and can't be accepted.",
  already_accepted: "This has already been accepted.",
  already_decided: "A decision has already been recorded.",
  recipient_invalid: "This contact can't receive it: no portal access or no email address.",
  recipients_required: "Choose at least one contact.",
  recipients_too_many: `Choose up to ${MAX_RECIPIENTS} contacts.`,
  not_a_proposal: "Only an accepted proposal can start a project.",
  no_advance_step: "The payment schedule has no first instalment to bill.",
  instalment_sac_merged: "The first instalment combines more than 10 service codes; check it before issuing.",
};

// ---- lines 07-N lacked, approved word for word in 07-Q (2026-10-26) -------------------------------------------------------

export const OFFER_PENDING = {
  deliveryHeading: "Emails",
  /** The delivery states 07-N §6 leaves out. */
  delivery: {
    sending: "Sending",
    delivered: "Delivered",
    bounced: "Bounced",
    complained: "Marked as spam",
    skipped: "Not sent",
    not_sent: "Not sent",
  } as Partial<Record<DeliveryState, string>>,
  resent: "Sent again",
  withPdf: "PDF attached",
  sendAgain: "Send again",
  revoke: "Revoke links",
  revokeTitle: "Revoke the links?",
  revokeBody:
    "Every link we emailed for this offer stops working at once, and emails still waiting to go are not sent. The client can still sign in to the portal.",
  revoking: "Revoking…",
  revoked: (links: number, cancelled: number) =>
    `${links === 1 ? "1 link" : `${links} links`} revoked, ${cancelled === 1 ? "1 waiting email" : `${cancelled} waiting emails`} stopped.`,
  via: "Accepted through",
  viaLink: "The emailed link",
  viaSession: "The portal, signed in",
  country: "Country",
  certificatePending: "The certificate is being made.",
  declinedHeading: "Declined",
  milestones: "Milestones",
  firstInstalment: "First instalment",
  instalmentType: {
    proforma: "Proforma invoice (draft)",
    tax_invoice: "Tax invoice (draft)",
    export_invoice: "Export invoice (draft)",
  } as Record<string, string>,
  openProject: "Open the project",
  missingFields: (fields: string) => `Fill in the client's ${fields} first.`,
  notResendable: "Only the latest sent version, still open, can be sent again.",
  instalmentFailed: "The first instalment can't be worked out from this client's details.",
} as const;

/** The word for a delivery state. */
export const deliveryLabel = (state: DeliveryState): string =>
  DELIVERY_N[state] ?? OFFER_PENDING.delivery[state] ?? state;

/** A delivery state's tone for its pill (icon + text, never colour alone). */
export function deliveryTone(state: DeliveryState): {
  tone: "neutral" | "success" | "warning" | "danger" | "info" | "muted";
  icon: "clock" | "send" | "check" | "ban" | "inbox";
} {
  switch (state) {
    case "waiting_pdf":
    case "queued":
    case "sending":
      return { tone: "neutral", icon: "clock" };
    case "sent":
      return { tone: "info", icon: "send" };
    case "delivered":
      return { tone: "success", icon: "check" };
    case "bounced":
    case "complained":
    case "failed":
      return { tone: "danger", icon: "ban" };
    default:
      return { tone: "muted", icon: "ban" };
  }
}

export { reasonText };

/** The words of a client field a start-project plan lacks (the API's `missing`). */
const FIELD_WORDS: Record<string, string> = { country: "country", gstin: "GSTIN", state_code: "state" };
export const missingText = (missing: readonly string[]) =>
  OFFER_PENDING.missingFields(missing.map((f) => FIELD_WORDS[f] ?? f).join(" and "));

/** The sentence for a failed M4.5 request: 07-N by code, then the pending lines, then M4.3's (07-O) sentences. */
export function offerErrorText(e: unknown): string {
  if (e instanceof RequestError) {
    const n = OFFER_ERRORS[e.code];
    if (n) return n;
    if (e.code === "not_resendable") return OFFER_PENDING.notResendable;
    if (e.code === "instalment_failed")
      return e.extra.missing?.length ? missingText(e.extra.missing) : OFFER_PENDING.instalmentFailed;
  }
  return docErrorText(e);
}

/** The same failure with the sentence as its message (the confirm dialog shows the message as it is). */
export const mappedOfferError = (e: unknown): unknown =>
  e instanceof RequestError
    ? new RequestError(e.status, e.code, offerErrorText(e), e.requestId, e.fields, e.paths, e.needs, e.extra)
    : e;

/** The first 12 hex characters of a SHA-256 (as the PDF panel and the portal show it). */
export const shortSha = (sha: string) => sha.slice(0, 12);

/**
 * The contacts the send dialog offers: live ones only, those with portal access first (they can be chosen), then those without (shown
 * with "Has no portal access yet"). Billing contacts with access are ticked to start with, at most `MAX_RECIPIENTS`.
 */
export function recipientChoices<
  C extends {
    id: string;
    portalAccess: boolean;
    isBilling: boolean;
    anonymisedAt: number | null;
    isPrimary: boolean;
  },
>(contacts: readonly C[]): { choices: C[]; ticked: string[] } {
  const live = contacts.filter((c) => c.anonymisedAt === null);
  const can = live.filter((c) => c.portalAccess);
  const cannot = live.filter((c) => !c.portalAccess);
  let ticked = can.filter((c) => c.isBilling).map((c) => c.id);
  // No billing contact with access: the primary contact, when it has access, is the natural first choice.
  if (ticked.length === 0) ticked = can.filter((c) => c.isPrimary).map((c) => c.id);
  return { choices: [...can, ...cannot], ticked: ticked.slice(0, MAX_RECIPIENTS) };
}

/** Whether the version can be sent again: the latest sent version, still open (sent or viewed, not past its last day). */
export const canResend = (v: { status: string; validUntil: string | null }, today: string, latest: boolean) =>
  latest &&
  (v.status === "sent" || v.status === "viewed") &&
  (v.validUntil === null || v.validUntil >= today);
