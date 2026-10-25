// The JSON of one proposal or estimate for the editor (M4.3): the same shape for GET, and for what a save answers. A draft is worked out
// again from its parts (so the person always sees today's tax); a sent version is read back from what was frozen (`computed`).
// The screens (M4.3 designer) read this; M4.4 and M4.5 read the database through `loadDocument`, not this.
import type { CalendarDate } from "@techaust/core/dates";
import { approvalState, catalogueGuard, type GuardLine } from "@techaust/core/documents";
import type { ComputedDocument } from "@techaust/core/tax";
import type { DocumentBundle } from "@techaust/db/documents";
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

export type ContactFacts = { id: string; name: string; email: string; anonymised_at: number | null };

const guardLines = (s: DocState): GuardLine[] =>
  s.lines.map((l) => ({
    catalogueItemId: l.catalogueItemId,
    catalogueRateMinor: l.catalogueRateMinor,
    qtyMilli: l.qtyMilli,
  }));

export type ViewInput = {
  bundle: DocumentBundle;
  client: ClientRow;
  contact: ContactFacts | null;
  newestTermsId: string | null;
  /** Needed to work a draft out; a sent version does not need it. */
  settings: QuoteSettings | null;
  today: CalendarDate;
  /** A save already worked the draft out: pass it (and the state it built) instead of computing twice. */
  prepared?: { state: DocState; computation: Computation };
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
  const latest = bundle.approvals[0] ?? null;
  const approval = approvalState(
    latest ? { status: latest.status, contentSha256: latest.content_sha256 } : null,
    d.content_sha256,
  );
  const lineAt = (i2: number) => computed?.lines[i2];
  return {
    id: d.id,
    type: d.type,
    status: d.status,
    version: d.version,
    versionGroupId: d.version_group_id,
    number: d.number_display,
    title: d.title,
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
      name: client.display_name,
      type: client.type,
      gstStatus: client.gst_status,
      stateCode: client.state_code,
      country: client.country,
      currency: client.currency,
      anonymised: clientGone,
    },
    contact: contact
      ? { id: contact.id, name: contact.name, email: contact.email, anonymised: contactGone }
      : null,
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
      title: s.title,
      bodyMd: s.bodyMd,
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
    totals: computed
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
      : null,
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
    approval: {
      state: approval,
      id: latest?.id ?? null,
      requestedBy: latest?.requested_by ?? null,
      requestedAt: latest?.created_at ?? null,
      decidedBy: latest?.decided_by ?? null,
      decidedAt: latest?.decided_at ?? null,
      note: latest?.note ?? null,
    },
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
