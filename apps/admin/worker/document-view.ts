// The JSON of one proposal or estimate for the editor (M4.3): the same shape for GET, and for what a save answers. A draft is worked out
// again from its parts (so the person always sees today's tax); a sent version is read back from what was frozen (`computed`).
// The screens (M4.3 designer) read this; M4.4 and M4.5 read the database through `loadDocument`, not this.
import type { CalendarDate } from "@techaust/core/dates";
import { approvalState, catalogueGuard, type GuardLine } from "@techaust/core/documents";
import type { ComputedDocument } from "@techaust/core/tax";
import { nameOrLegal } from "@techaust/core/text";
import type { DocumentBundle, TermsRef } from "@techaust/db/documents";
import type { RecipientSnapshot } from "@techaust/db/issue";
import {
  type Blocker,
  type ClientRow,
  type Computation,
  computeQuote,
  type DocState,
  type QuoteSettings,
  sendBlockers,
  stateOfBundle,
  taxContext,
  taxInputOf,
} from "./quote-model.ts";

/**
 * What the staff view shows in place of the name of a client or contact whose personal details were removed (owner, 2026-10-26;
 * VERIFY WITH CA/LEGAL). Only the VIEW changes: the frozen snapshot in the database stays as it was sent, as evidence of the offer.
 */
export const ANONYMISED_LABEL = "Anonymised client";

/**
 * A sent version's recipient block as the staff view shows it. When the client was anonymised, every personal field (names, email, GSTIN,
 * address) is replaced; when only the contact was, the contact's name and email are (the business named on the offer is not personal).
 * What is not personal stays: the country, the client type, the GST status, the state, and the contact's id.
 */
export function viewRecipient(r: RecipientSnapshot, clientGone: boolean, contactGone: boolean) {
  if (!clientGone && !contactGone) return r;
  // A contact is on the snapshot only if it names one (an email alone never adds a contact line to the view).
  const hasContact = r.contactId !== undefined || r.contactName !== undefined;
  const contact = hasContact ? { email: null, contactName: ANONYMISED_LABEL } : { email: null };
  if (!clientGone) return { ...r, ...contact, anonymised: true };
  return {
    ...r,
    legalName: ANONYMISED_LABEL,
    displayName: ANONYMISED_LABEL,
    gstin: null,
    address: null,
    ...contact,
    anonymised: true,
  };
}

/**
 * The personal values of a frozen recipient that the view must also take out of the document's own text (owner, 2026-10-26;
 * VERIFY WITH CA/LEGAL): the templates write the client name and the contact into the sections at draft time (`{{client.name}}`,
 * `{{client.contact}}`), and that text is frozen at send. Client gone: the legal name, display name, contact name and email. Only
 * the contact gone: the contact's name and email (the business named on the offer is not personal). Blank values are skipped.
 */
export function redactionNames(r: RecipientSnapshot, clientGone: boolean, contactGone: boolean): string[] {
  const values: (string | null | undefined)[] = [];
  if (clientGone) values.push(r.legalName, r.displayName);
  if (clientGone || contactGone) values.push(r.contactName, r.email);
  return [...new Set(values.map((v) => v?.trim() ?? "").filter((v) => v !== ""))];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Builds the function that replaces every exact occurrence of the given names with `ANONYMISED_LABEL`, in one pass, longest name first
 * (so a name that holds another is replaced whole, and the label is never searched again), only where it stands as a whole word: a
 * client named "Ram" leaves "Ramp-up" alone. VIEW ONLY: the stored text is not touched.
 * Staff-typed free text that only mentions a person in other words is not redacted (owner, 2026-10-26, VERIFY WITH CA/LEGAL).
 */
export function redactor(names: string[]): (text: string | null) => string | null {
  if (names.length === 0) return (text) => text;
  const alternation = [...names]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternation})(?![\\p{L}\\p{N}_])`, "gu");
  return (text: string | null) => (text === null ? null : text.replace(re, ANONYMISED_LABEL));
}

export type ContactFacts = { id: string; name: string; email: string; anonymised_at: number | null };

const guardLines = (s: DocState): GuardLine[] =>
  s.lines.map((l) => ({
    catalogueItemId: l.catalogueItemId,
    catalogueRateMinor: l.catalogueRateMinor,
    qtyMilli: l.qtyMilli,
  }));

/** The name a sent version was addressed to: the display name, else the legal name (an empty or blank display name counts as missing). */
export const nameOfRecipient = (r: { displayName?: string | null; legalName: string }): string =>
  nameOrLegal(r.displayName, r.legalName);

/** The totals block shared by the full view and the save answer. */
const totalsOf = (computed: ComputedDocument | null) =>
  computed
    ? {
        subtotalMinor: computed.subtotalMinor,
        discountMinor: computed.discountMinor,
        taxableMinor: computed.taxableMinor,
        cgstMinor: computed.cgstMinor,
        sgstMinor: computed.sgstMinor,
        igstMinor: computed.igstMinor,
        roundOffMinor: computed.roundOffMinor,
        totalMinor: computed.totalMinor,
        words: computed.words,
        totalInrMinor: computed.inr?.totalMinor ?? null,
      }
    : null;

/** The lines the discount guard ignores (not from the catalogue), with their taxable value: the approval screen lists them (owner, O-Q1). */
export const customLinesOf = (state: DocState, computed: ComputedDocument | null) =>
  state.lines.flatMap((l, n) =>
    l.catalogueItemId === null
      ? [{ id: l.id, position: n + 1, taxableMinor: computed?.lines[n]?.taxableMinor ?? null }]
      : [],
  );

const approvalOf = (bundle: DocumentBundle<TermsRef>, contentSha256: string | null) => {
  const latest = bundle.approvals[0] ?? null;
  return {
    state: approvalState(
      latest ? { status: latest.status, contentSha256: latest.content_sha256 } : null,
      contentSha256,
    ),
    id: latest?.id ?? null,
    requestedBy: latest?.requested_by ?? null,
    requestedByName: latest?.requested_by_name ?? null,
    requestedAt: latest?.created_at ?? null,
    decidedBy: latest?.decided_by ?? null,
    decidedByName: latest?.decided_by_name ?? null,
    decidedAt: latest?.decided_at ?? null,
    note: latest?.note ?? null,
  };
};

/**
 * The PDF of this version (M4.4): `none` for a draft, `pending` once sent until the jobs Worker has stored it, `ready` after. `sha256` is the
 * SHA-256 of the file (acceptance evidence, M4.5); `fingerprint` is its first 12 hex characters, for the screen.
 */
export const pdfOf = (d: { frozen_at: number | null; pdf_sha256: string | null }) => ({
  state:
    d.frozen_at === null
      ? ("none" as const)
      : d.pdf_sha256 === null
        ? ("pending" as const)
        : ("ready" as const),
  sha256: d.pdf_sha256,
  fingerprint: d.pdf_sha256 === null ? null : d.pdf_sha256.slice(0, 12),
});

export type ViewInput = {
  bundle: DocumentBundle<TermsRef>;
  client: ClientRow;
  contact: ContactFacts | null;
  newestTermsId: string | null;
  /** The newest proposal terms' version number (the editor's "Newer terms (version n) exist"). */
  newestTermsVersion?: number | null;
  /** Needed to work a draft out; a sent version does not need it. */
  settings: QuoteSettings | null;
  today: CalendarDate;
  /** A save already worked the draft out: pass it (and the state it built) instead of computing twice. */
  prepared?: { state: DocState; computation: Computation };
  /** What an accepted estimate became (an invoice draft or a care plan), or null: read with the document, in the same D1 call. */
  convertedTo?: { kind: "invoice" | "care_plan"; id: string } | null;
};

export async function documentView(i: ViewInput) {
  const { bundle, client, contact } = i;
  const d = bundle.document;
  const frozen = d.frozen_at !== null;
  const state = i.prepared?.state ?? stateOfBundle(bundle);
  let computation: Computation | null = i.prepared?.computation ?? null;
  if (!frozen && !computation && i.settings)
    computation = await computeQuote(state, taxInputOf(client), taxContext(i.settings), i.today);
  const computed: ComputedDocument | null = frozen ? d.computed : (computation?.computed ?? null);
  const guard = computation?.guard ?? (computed ? catalogueGuard(guardLines(state), computed) : null);
  const clientGone = client.anonymised_at !== null;
  const contactGone = contact !== null && contact.anonymised_at !== null;
  const blockers: Blocker[] =
    !frozen && computation ? sendBlockers(state, computation, { clientGone, contactGone }) : [];
  const lineAt = (i2: number) => computed?.lines[i2];
  // A sent version shows who it was addressed to AS SENT (the frozen `recipient` and `issuer`), never today's client record (M4.3 review 1).
  // A draft shows the live client and contact. The ids and the code are the same either way.
  // When the client, or the contact the offer was addressed to, was anonymised, the view shows "Anonymised client" and no name, email,
  // GSTIN or address; the stored snapshot is never touched (owner, 2026-10-26; VERIFY WITH CA/LEGAL).
  const snapshot = frozen ? d.recipient : null;
  const snapshotContactGone =
    snapshot !== null &&
    (snapshot.contactId !== undefined || snapshot.contactName !== undefined) &&
    (contact === null || contact.anonymised_at !== null);
  const recipient = snapshot ? viewRecipient(snapshot, clientGone, snapshotContactGone) : null;
  const issuer = frozen ? d.issuer : null;
  // The same values taken out of the frozen text (section texts and titles, and the document title).
  const redact =
    snapshot && (clientGone || snapshotContactGone)
      ? redactor(redactionNames(snapshot, clientGone, snapshotContactGone))
      : (text: string | null) => text;
  const frozenContact =
    recipient && recipient.contactName !== undefined
      ? {
          id: recipient.contactId ?? contact?.id ?? null,
          name: recipient.contactName,
          email: recipient.email ?? null,
          anonymised: clientGone || snapshotContactGone,
        }
      : null;
  return {
    id: d.id,
    type: d.type,
    status: d.status,
    version: d.version,
    versionGroupId: d.version_group_id,
    number: d.number_display,
    title: redact(d.title),
    currency: d.currency,
    validityDays: d.validity_days,
    validUntil: d.valid_until,
    issueDate: d.issue_date,
    sentAt: d.sent_at,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    contentSha256: d.content_sha256,
    frozen,
    client: {
      id: client.id,
      code: client.code,
      name: clientGone ? ANONYMISED_LABEL : recipient ? nameOfRecipient(recipient) : client.display_name,
      type: recipient?.clientType ?? client.type,
      gstStatus: recipient?.gstStatus ?? client.gst_status,
      stateCode: recipient ? (recipient.stateCode ?? null) : client.state_code,
      country: recipient ? recipient.country : client.country,
      currency: client.currency,
      anonymised: clientGone,
    },
    contact: recipient
      ? frozenContact
      : contact
        ? { id: contact.id, name: contact.name, email: contact.email, anonymised: contactGone }
        : null,
    /** The frozen blocks of a sent version, as sealed (null for a draft). */
    recipient,
    issuer,
    discount:
      d.discount_kind === null || d.discount_value === null
        ? null
        : { kind: d.discount_kind, value: d.discount_value },
    exportMode: d.export_mode,
    lines: state.lines.map((l, n) => ({
      id: l.id,
      position: n + 1,
      catalogueItemId: l.catalogueItemId,
      // Read-only: the catalogue price when the line was added (the discount guard's reference). A request cannot set it.
      catalogueRateMinor: l.catalogueRateMinor,
      // Read-only: the catalogue default line this line came from (a care tier, say), or null.
      catalogueLine: l.catalogueLine,
      description: l.description,
      detail: l.detail,
      sac: l.sac,
      qtyMilli: l.qtyMilli,
      unit: l.unit,
      rateMinor: l.rateMinor,
      discount:
        l.discountKind === null || l.discountValue === null
          ? null
          : { kind: l.discountKind, value: l.discountValue },
      gstRateBp: l.gstRateBp,
      taxableMinor: lineAt(n)?.taxableMinor ?? null,
      cgstMinor: lineAt(n)?.cgstMinor ?? null,
      sgstMinor: lineAt(n)?.sgstMinor ?? null,
      igstMinor: lineAt(n)?.igstMinor ?? null,
      lineTotalMinor: lineAt(n)?.lineTotalMinor ?? null,
    })),
    sections: state.sections.map((s, n) => ({
      id: s.id,
      position: n + 1,
      kind: s.kind,
      hidden: s.hidden,
      title: redact(s.title),
      bodyMd: redact(s.bodyMd),
    })),
    schedule: state.schedule.map((s, n) => ({
      id: s.id,
      position: n + 1,
      label: s.label,
      trigger: s.trigger,
      pctBp: s.pctBp,
      amountMinor:
        frozen || !computation
          ? (bundle.schedule[n]?.amount_minor ?? null)
          : (computation.instalments?.[n]?.amountMinor ?? null),
      detail: s.detail,
      targetDate: s.targetDate,
    })),
    totals: totalsOf(computed),
    supply: computed?.supply ?? null,
    summary: computed?.summary ?? null,
    guard: guard
      ? {
          ...guard,
          // Lines that are not from the catalogue are ignored by the guard on both sides; the approval screen lists them (owner, O-Q1).
          customLines: state.lines.flatMap((l, n) =>
            l.catalogueItemId === null
              ? [
                  {
                    position: n + 1,
                    description: l.description,
                    taxableMinor: lineAt(n)?.taxableMinor ?? null,
                  },
                ]
              : [],
          ),
        }
      : null,
    approval: approvalOf(bundle, d.content_sha256),
    pdf: pdfOf(d),
    /** For an accepted estimate that was converted: the invoice draft or care plan it became (the screen links to it and hides both conversions). */
    convertedTo: i.convertedTo ?? null,
    versions: bundle.versions.map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      number: v.number_display,
      sentAt: v.sent_at,
      validUntil: v.valid_until,
      totalMinor: v.total_minor,
      current: v.id === d.id,
    })),
    terms: bundle.terms
      ? { id: bundle.terms.id, version: bundle.terms.version, sha256: bundle.terms.sha256 }
      : null,
    termsOutdated:
      !frozen &&
      d.terms_version_id !== null &&
      i.newestTermsId !== null &&
      i.newestTermsId !== d.terms_version_id,
    newestTermsVersion: i.newestTermsVersion ?? null,
    errors: !frozen && computation ? computation.errors : [],
    warnings: !frozen && computation ? computation.warnings : [],
    blockers,
    // The placeholders still in the text (`{{client.name}}`): the editor lists them; a document with any cannot be sent.
    unresolved: blockers.find((b) => b.code === "unresolved_placeholders")?.names ?? [],
    canSend: !frozen && computation !== null && blockers.length === 0,
    // The stored hash is behind the content (a tax setting or the client's record changed): save once to bring them together.
    needsResave: !frozen && computation !== null && computation.hash !== d.content_sha256,
  };
}

export type DocumentView = Awaited<ReturnType<typeof documentView>>;

// ---- the answer to a save (slim) ---------------------------------------------------------------------------------------------

export type SaveAnswerInput = {
  bundle: DocumentBundle<TermsRef>;
  newestTermsId: string | null;
  newestTermsVersion?: number | null;
  state: DocState;
  computation: Computation;
  clientGone: boolean;
  contactGone: boolean;
};

/**
 * What a PATCH answers. The screen already holds what it sent, so this carries only what the server decided: the new `updatedAt` and
 * `contentSha256`, the worked-out figures (totals, supply, tax summary, each line's tax and total, each instalment), the ids (the
 * server makes an id for every new line, section and step; all three lists come back in order), the discount guard, the approval,
 * the blockers, errors and warnings. It never repeats a section's text, a line's description or detail, a step's label or a title:
 * saving 100 lines and 30,000 characters of sections answers in about 8 KB instead of about 60 KB.
 */
export function saveAnswer(i: SaveAnswerInput) {
  const { bundle, state, computation } = i;
  const d = bundle.document;
  const computed = computation.computed;
  const blockers = sendBlockers(state, computation, { clientGone: i.clientGone, contactGone: i.contactGone });
  return {
    id: d.id,
    updatedAt: d.updated_at,
    contentSha256: d.content_sha256,
    totals: totalsOf(computed),
    supply: computed?.supply ?? null,
    summary: computed?.summary ?? null,
    lines: state.lines.map((l, n) => ({
      id: l.id,
      position: n + 1,
      taxableMinor: computed?.lines[n]?.taxableMinor ?? null,
      cgstMinor: computed?.lines[n]?.cgstMinor ?? null,
      sgstMinor: computed?.lines[n]?.sgstMinor ?? null,
      igstMinor: computed?.lines[n]?.igstMinor ?? null,
      lineTotalMinor: computed?.lines[n]?.lineTotalMinor ?? null,
    })),
    sections: state.sections.map((x, n) => ({ id: x.id, position: n + 1 })),
    schedule: state.schedule.map((x, n) => ({
      id: x.id,
      position: n + 1,
      amountMinor: computation.instalments?.[n]?.amountMinor ?? null,
    })),
    guard: { ...computation.guard, customLines: customLinesOf(state, computed) },
    approval: approvalOf(bundle, d.content_sha256),
    terms: bundle.terms
      ? { id: bundle.terms.id, version: bundle.terms.version, sha256: bundle.terms.sha256 }
      : null,
    termsOutdated:
      d.terms_version_id !== null && i.newestTermsId !== null && i.newestTermsId !== d.terms_version_id,
    newestTermsVersion: i.newestTermsVersion ?? null,
    errors: computation.errors,
    warnings: computation.warnings,
    blockers,
    unresolved: blockers.find((b) => b.code === "unresolved_placeholders")?.names ?? [],
    canSend: computed !== null && blockers.length === 0,
    // Always false right after a save (the hash was just worked out from this very content); present so the shape matches GET.
    needsResave: false,
  };
}

export type SaveAnswer = ReturnType<typeof saveAnswer>;
