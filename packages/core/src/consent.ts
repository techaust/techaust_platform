// Consent receipts (M7.4 B.3; FRM-05, ADM-SET-09; run file docs/runs/m7.4-data-protection.md A.3, L30). Pure: the rows the routes and jobs append to
// `consent_receipts` (append-only), built from the consent JSON a lead or contact already carries. The receipt is the s.6(10) proof of notice and consent:
// Researched 2026-10-28, DPDP Act s.6, s.6(10) (08-C RB-28). After an erasure the receipts stay, linked by the keyed hash of the address only, until the
// consent family's cut-off; an `ended` receipt records the end of the lead or contact they belonged to (L30): Settled by the lead on the safest reading,
// 2026-11-06 (08-C RB-46). The keyed hash itself (HMAC-SHA256 with `ERASURE_HASH_KEY`) is computed where the key lives, never here.

/** What a person agreed to (the web forms' purposes, `apps/jobs/src/leads.ts`). */
export const PURPOSES = ["respond_to_enquiry", "marketing_updates"] as const;
export type Purpose = (typeof PURPOSES)[number];

/**
 * `consent_receipts.event` (pinned to the M7.4 trigger): a grant, a withdrawal, and `ended` (L30), the end of the lead or contact the receipts belong to
 * (an erasure, an anonymisation or the routine lead purge), from which the consent family's cut-off counts.
 */
export const CONSENT_EVENTS = ["grant", "withdraw", "ended"] as const;
export type ConsentEvent = (typeof CONSENT_EVENTS)[number];

/**
 * `consent_receipts.source` (pinned to the M7.4 trigger): the website form, staff, the one-click unsubscribe, and for `ended` the erasure triggers or the
 * routine lead purge. `portal` is added only when a portal path writes receipts (A.3).
 */
export const CONSENT_SOURCES = ["web_form", "staff", "unsubscribe", "erasure", "retention"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

/** A lead's consent as the jobs Worker stores it (`leads.consent`; `ConsentReceipt` in `@techaust/db` schema). */
export type LeadConsent = {
  readonly noticeVersion: string;
  readonly purposes: readonly string[];
  readonly at: number;
  readonly ipHash: string;
  readonly marketing: boolean;
  readonly withdrawnAt?: number | null;
};

/** A contact's marketing consent as admin stores it (`contacts.marketing_consent`). */
export type ContactConsent = {
  readonly granted: boolean;
  readonly at: number;
  readonly source: string;
  readonly withdrawnAt?: number;
};

export type ConsentSubject =
  | {
      readonly kind: "lead";
      readonly id: string;
      readonly source: "web" | "manual";
      readonly consent: LeadConsent | null;
    }
  | {
      readonly kind: "contact";
      readonly id: string;
      readonly consent: ContactConsent | null;
      /** The privacy notice version shown when staff recorded the consent (none known: null). */
      readonly noticeVersion: string | null;
    };

/** One `consent_receipts` row without its id and `subject_hash` (the caller adds both). */
export type ConsentReceiptRow = {
  readonly event: ConsentEvent;
  readonly source: ConsentSource;
  readonly noticeVersion: string | null;
  readonly purposes: readonly Purpose[];
  readonly marketing: boolean;
  readonly ipHash: string | null;
  readonly at: number;
  readonly leadId: string | null;
  readonly contactId: string | null;
};

const isPurpose = (v: unknown): v is Purpose =>
  typeof v === "string" && (PURPOSES as readonly string[]).includes(v);
const isMs = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export const isConsentEvent = (v: unknown): v is ConsentEvent =>
  typeof v === "string" && (CONSENT_EVENTS as readonly string[]).includes(v);
export const isConsentSource = (v: unknown): v is ConsentSource =>
  typeof v === "string" && (CONSENT_SOURCES as readonly string[]).includes(v);

/** The known purposes of a stored list, in `PURPOSES` order; null if the list isn't an array or names none. */
function purposesOf(list: unknown): Purpose[] | null {
  if (!Array.isArray(list)) return null;
  const known = PURPOSES.filter((p) => list.some((x) => x === p && isPurpose(x)));
  return known.length > 0 ? known : null;
}

const links = (s: ConsentSubject) =>
  s.kind === "lead" ? { leadId: s.id, contactId: null } : { leadId: null, contactId: s.id };

/**
 * The `grant` receipt of a lead's or contact's consent as stored, or null when there is none (no consent, a malformed one, a contact's that isn't granted).
 * A lead's comes from the website form (`web_form`) or, for a lead staff typed in, `staff`; a contact's is staff's and covers marketing only.
 */
export function receiptOf(subject: ConsentSubject): ConsentReceiptRow | null {
  const c = subject.consent;
  if (c === null || typeof c !== "object") return null;
  if (subject.kind === "lead") {
    const lead = c as LeadConsent;
    const purposes = purposesOf(lead.purposes);
    if (purposes === null || !isMs(lead.at) || typeof lead.noticeVersion !== "string") return null;
    return {
      event: "grant",
      source: subject.source === "web" ? "web_form" : "staff",
      noticeVersion: lead.noticeVersion,
      purposes,
      marketing: lead.marketing === true,
      ipHash: typeof lead.ipHash === "string" && lead.ipHash.length > 0 ? lead.ipHash : null,
      at: lead.at,
      ...links(subject),
    };
  }
  const contact = c as ContactConsent;
  if (contact.granted !== true || !isMs(contact.at)) return null;
  return {
    event: "grant",
    source: "staff",
    noticeVersion: subject.noticeVersion,
    purposes: ["marketing_updates"],
    marketing: true,
    ipHash: null,
    at: contact.at,
    ...links(subject),
  };
}

/**
 * Withdrawing a lead's or contact's consent at `at`: the `withdraw` receipt and the consent JSON to store, or null when there is nothing to withdraw (no
 * consent, a malformed one, or one already withdrawn), which the route answers 409. A lead withdraws every purpose it granted; a contact its marketing.
 */
export function withdrawalOf(
  subject: ConsentSubject,
  at: number,
  source: Extract<ConsentSource, "staff" | "unsubscribe">,
): { receipt: ConsentReceiptRow; consent: LeadConsent | ContactConsent } | null {
  if (!isMs(at)) throw new RangeError(`Expected UTC milliseconds: ${at}`);
  const grant = receiptOf(subject);
  if (grant === null) return null;
  const c = subject.consent as LeadConsent | ContactConsent;
  if (c.withdrawnAt != null) return null;
  const receipt: ConsentReceiptRow = {
    event: "withdraw",
    source,
    noticeVersion: grant.noticeVersion,
    purposes: grant.purposes,
    marketing: false,
    ipHash: null,
    at,
    ...links(subject),
  };
  const consent =
    subject.kind === "lead"
      ? { ...(c as LeadConsent), withdrawnAt: at }
      : { ...(c as ContactConsent), granted: false, withdrawnAt: at };
  return { receipt, consent };
}
