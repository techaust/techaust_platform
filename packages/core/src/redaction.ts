// Taking a person's details out of a frozen offer: the staff VIEW of an anonymised client's or contact's sent version (M4.3, owner 2026-10-26), and the STORED
// redaction of a never-accepted proposal or estimate when the person is anonymised (T7; Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37)). One
// rule for both: the values are trimmed, blank and one-character values are skipped, and each is replaced by `ANONYMISED_CLIENT` only where it stands as a whole
// word (`wholeWordPattern`), longest first, in one pass. Pure.
import { ANONYMISED_CLIENT } from "./clients.ts";
import { wholeWordPattern } from "./text.ts";

/** The frozen recipient block of a document as far as this file reads it (the db's `RecipientSnapshot` is assignable to it). */
export type RedactableRecipient = {
  legalName: string;
  displayName?: string;
  gstin?: string;
  stateCode?: string;
  address?: unknown;
  email?: string;
  country: string;
  contactId?: string;
  contactName?: string;
  clientType?: "business" | "individual";
  gstStatus?: "registered" | "unregistered" | "overseas";
  deliveryAddress?: unknown;
};

/** Values shorter than this (after trimming) are never searched for: a one-letter name would take letters out of every text. */
export const MIN_REDACTION_LENGTH = 2;

/** Trimmed, unique, not blank, at least `MIN_REDACTION_LENGTH` characters, in the order given. */
const cleanValues = (values: readonly (string | null | undefined)[]): string[] => [
  ...new Set(values.map((v) => v?.trim() ?? "").filter((v) => v.length >= MIN_REDACTION_LENGTH)),
];

// ---- the staff view (M4.3; the stored snapshot of an ACCEPTED offer is never touched) --------------------------------------------------------------------

/**
 * A sent version's recipient block as the staff view shows it. When the client was anonymised, every personal field (names, email, GSTIN,
 * address) is replaced; when only the contact was, the contact's name and email are (the business named on the offer is not personal).
 * What is not personal stays: the country, the client type, the GST status, the state, and the contact's id.
 */
export function viewRecipient<R extends RedactableRecipient>(
  r: R,
  clientGone: boolean,
  contactGone: boolean,
) {
  if (!clientGone && !contactGone) return r;
  // A contact is on the snapshot only if it names one (an email alone never adds a contact line to the view).
  const hasContact = r.contactId !== undefined || r.contactName !== undefined;
  const contact = hasContact ? { email: null, contactName: ANONYMISED_CLIENT } : { email: null };
  if (!clientGone) return { ...r, ...contact, anonymised: true };
  return {
    ...r,
    legalName: ANONYMISED_CLIENT,
    displayName: ANONYMISED_CLIENT,
    gstin: null,
    address: null,
    ...contact,
    anonymised: true,
  };
}

/**
 * The personal values of a frozen recipient that the view must also take out of the document's own text (owner, 2026-10-26; Researched 2026-10-28, DPDP Act
 * s.8(7) and s.12(3) (08-C RB-11)): the templates write the client name and the contact into the sections at draft time (`{{client.name}}`, `{{client.contact}}`),
 * and that text is frozen at send. Client gone: the legal name, display name, contact name and email. Only the contact gone: the contact's name and email (the
 * business named on the offer is not personal). Blank and one-character values are skipped.
 */
export function redactionNames(r: RedactableRecipient, clientGone: boolean, contactGone: boolean): string[] {
  const values: (string | null | undefined)[] = [];
  if (clientGone) values.push(r.legalName, r.displayName);
  if (clientGone || contactGone) values.push(r.contactName, r.email);
  return cleanValues(values);
}

/**
 * Builds the function that replaces every exact occurrence of the given values with `ANONYMISED_CLIENT`, in one pass, longest first (so a value that holds
 * another is replaced whole, and the label is never searched again), only where it stands as a whole word: a client named "Ram" leaves "Ramp-up" alone.
 * Staff-typed free text that only mentions a person in other words is not redacted (owner, 2026-10-26, Researched 2026-10-28, DPDP Act s.8(7) and s.12(3)
 * (08-C RB-11)).
 */
export function redactor(names: readonly string[]): (text: string | null) => string | null {
  if (names.length === 0) return (text) => text;
  const re = wholeWordPattern(names);
  return (text: string | null) => (text === null ? null : text.replace(re, ANONYMISED_CLIENT));
}

// ---- the stored redaction of a never-accepted offer (T7) --------------------------------------------------------------------------------------------------

/**
 * Whose details an offer loses (T7, L3; Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37)):
 *  - `client`: the contact is an individual client's last live contact, so the client goes too: the whole recipient and every value of both;
 *  - `contact`: the offer is addressed to the contact (a business's contact, or a non-last contact of an individual): their name and email only; the
 *    business's own name, GSTIN and address stay (13, 2026-10-25);
 *  - `decliner`: the contact declined an offer addressed to someone else: the recipient stays; their values come out of the texts.
 */
export type RedactionScope = "client" | "contact" | "decliner";

/** The live contact being anonymised, as read before the batch. */
export type RedactionContact = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
};
/** The live client (read only in client scope). */
export type RedactionClient = { legalName: string | null; displayName: string | null; gstin: string | null };

/**
 * The scope of one offer for the contact being anonymised: `client` when that contact is the individual client's last live one; else `contact` when the offer
 * is addressed to them (its frozen `contactId`, its frozen email equal to their live one, or its `contact_id`); else `decliner`.
 */
export function offerScope(i: {
  lastLiveIndividual: boolean;
  recipient: RedactableRecipient | null;
  documentContactId: string | null;
  contact: Pick<RedactionContact, "id" | "email">;
}): RedactionScope {
  if (i.lastLiveIndividual) return "client";
  const r = i.recipient;
  const email = i.contact.email?.toLowerCase() ?? null;
  const addressed =
    r?.contactId === i.contact.id ||
    (email !== null && r?.email !== undefined && r.email.toLowerCase() === email) ||
    i.documentContactId === i.contact.id;
  return addressed ? "contact" : "decliner";
}

/**
 * The values taken out of one offer's texts, trimmed, unique, blank and one-character values skipped, longest first. Every scope: the contact's live name,
 * email and phone. `contact` adds the recipient's contact name and email (the contact as it was sent); `client` adds the recipient's names, email and GSTIN
 * and the live client's legal name, display name and GSTIN (the view's values when the client is gone, plus the live ones).
 */
export function redactionValues(i: {
  recipient: RedactableRecipient | null;
  contact: RedactionContact;
  client?: RedactionClient | null;
  scope: RedactionScope;
}): string[] {
  const { recipient: r, contact: c, client, scope } = i;
  const values: (string | null | undefined)[] = [c.name, c.email, c.phone];
  if (scope !== "decliner" && r) values.push(r.contactName, r.email);
  if (scope === "client") {
    if (r) values.push(r.legalName, r.displayName, r.gstin);
    if (client) values.push(client.legalName, client.displayName, client.gstin);
  }
  return cleanValues(values).sort((a, b) => b.length - a.length);
}

/**
 * The stored recipient after the redaction, as a new object. `client`: the legal, display and contact names become `ANONYMISED_CLIENT` (a missing display or
 * contact name stays missing); the GSTIN, the addresses and the email are removed (keys absent, never null). `contact`: the contact name becomes
 * `ANONYMISED_CLIENT`, the email is removed. `decliner`: unchanged. Always kept: country, client type, GST status, state code and contact id.
 */
export function redactRecipient<R extends RedactableRecipient>(r: R, scope: RedactionScope): R {
  if (scope === "decliner") return { ...r };
  const { email: _email, ...noEmail } = r;
  const named = r.contactName !== undefined ? { contactName: ANONYMISED_CLIENT } : {};
  if (scope === "contact") return { ...noEmail, ...named } as R;
  const { gstin: _g, address: _a, deliveryAddress: _d, ...rest } = noEmail;
  return {
    ...rest,
    legalName: ANONYMISED_CLIENT,
    ...(r.displayName !== undefined ? { displayName: ANONYMISED_CLIENT } : {}),
    ...named,
  } as R;
}

/** One frozen offer's text, as read: the document row's values and its child rows. */
export type OfferText<R extends RedactableRecipient = RedactableRecipient> = {
  recipient: R | null;
  title: string | null;
  decisionNote: string | null;
  sections: readonly { id: string; title: string | null; bodyMd: string | null }[];
  lines: readonly { id: string; description: string; detail: string | null }[];
  schedule: readonly { id: string; label: string; detail: string | null }[];
};

/** What the batch writes for one offer: the new row values, the CHANGED child rows only, and the field names for the audit row (names only, never values). */
export type OfferRedaction<R extends RedactableRecipient = RedactableRecipient> = {
  recipient: R | null;
  title: string | null;
  sections: { id: string; title: string | null; bodyMd: string | null }[];
  lines: { id: string; description: string; detail: string | null }[];
  schedule: { id: string; label: string; detail: string | null }[];
  fields: string[];
};

/**
 * Redacts one offer (T7; Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37)): the recipient by scope, every text by `values` as whole words,
 * the decision note cleared (the person's own typed words; the reason code stays). `fields` lists what changed (`recipient.<key>`, `title`, `sections.title`,
 * `sections.body_md`, `lines.description`, `lines.detail`, `schedule.label`, `schedule.detail`, `decision_note`) and always ends with `envelope` and `pdf`: the
 * stored objects of every redacted offer are deleted. Idempotent: redacting the result again changes nothing.
 */
export function redactOffer<R extends RedactableRecipient>(
  o: OfferText<R>,
  values: readonly string[],
  scope: RedactionScope,
): OfferRedaction<R> {
  const redact = redactor(values);
  const fields = new Set<string>();
  const recipient = o.recipient ? redactRecipient(o.recipient, scope) : null;
  if (o.recipient && recipient) {
    const before = o.recipient as Record<string, unknown>;
    const after = recipient as Record<string, unknown>;
    for (const key of Object.keys(before))
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) fields.add(`recipient.${key}`);
  }
  const title = redact(o.title);
  if (title !== o.title) fields.add("title");
  const sections = o.sections.flatMap((s) => {
    const t = redact(s.title);
    const b = redact(s.bodyMd);
    if (t !== s.title) fields.add("sections.title");
    if (b !== s.bodyMd) fields.add("sections.body_md");
    return t !== s.title || b !== s.bodyMd ? [{ id: s.id, title: t, bodyMd: b }] : [];
  });
  const lines = o.lines.flatMap((l) => {
    const d = redact(l.description) as string;
    const x = redact(l.detail);
    if (d !== l.description) fields.add("lines.description");
    if (x !== l.detail) fields.add("lines.detail");
    return d !== l.description || x !== l.detail ? [{ id: l.id, description: d, detail: x }] : [];
  });
  const schedule = o.schedule.flatMap((p) => {
    const lb = redact(p.label) as string;
    const x = redact(p.detail);
    if (lb !== p.label) fields.add("schedule.label");
    if (x !== p.detail) fields.add("schedule.detail");
    return lb !== p.label || x !== p.detail ? [{ id: p.id, label: lb, detail: x }] : [];
  });
  if (o.decisionNote !== null) fields.add("decision_note");
  return { recipient, title, sections, lines, schedule, fields: [...fields, "envelope", "pdf"] };
}
