// The rows a D1 read of a sent version would give, rebuilt from a fixture envelope (tests and the CPU proxy).
import type { DocumentBundle, DocumentRow, TermsRow } from "@techaust/db/documents";
import type { Envelope } from "../../src/types.ts";

/** The rows a D1 read of this sent version would give (snake_case, JSON columns parsed). */
export function bundleOf(source: Envelope): DocumentBundle<TermsRow> {
  const e = structuredClone(source);
  const s = e.snapshot;
  const h = s.header;
  const document = {
    id: e.documentId,
    type: e.type,
    status: "sent",
    client_id: h.document.clientId,
    version_group_id: h.document.versionGroupId,
    version: e.version,
    series: e.series,
    fy: e.fy.slice(2, 4) + e.fy.slice(5, 7),
    number: e.number,
    number_display: e.numberDisplay,
    currency: h.document.currency,
    issue_date: h.document.issueDate,
    valid_until: h.document.validUntil,
    terms_version_id: h.terms.id,
    snapshot_sha256: e.snapshotSha256,
    frozen_at: e.sentAt,
    title: h.document.title,
    contact_id: h.recipient.contactId ?? null,
    validity_days: h.document.validityDays,
    discount_kind: h.document.discountKind,
    discount_value: h.document.discountValue,
    export_mode: h.document.exportMode,
    content_sha256: h.document.contentSha256,
    sent_at: e.sentAt,
    recipient: h.recipient,
    issuer: h.issuer,
    computed: JSON.parse(s.computedJson),
  } as unknown as DocumentRow;
  return {
    document,
    lines: s.lines.map((l, i) => ({
      id: `l${i}`,
      position: i,
      catalogue_item_id: l.catalogueItemId,
      description: l.description,
      detail: l.detail,
      sac: l.sac,
      qty_milli: l.qtyMilli,
      unit: l.unit,
      rate_minor: l.rateMinor,
      discount_kind: l.discountKind,
      discount_value: l.discountValue,
      gst_rate_bp: l.gstRateBp,
      catalogue_rate_minor: l.catalogueRateMinor,
      catalogue_line: l.catalogueLine,
    })) as unknown as DocumentBundle<TermsRow>["lines"],
    sections: s.sections.map((x, i) => ({
      id: `s${i}`,
      kind: x.kind,
      position: i,
      hidden: x.hidden ? 1 : 0,
      title: x.title,
      body_md: x.bodyMd,
    })),
    schedule: s.schedule.map((x, i) => ({
      id: `p${i}`,
      position: i,
      label: x.label,
      trigger: x.trigger,
      pct_bp: x.pctBp,
      amount_minor: h.instalmentAmounts[i] ?? 0,
      detail: x.detail,
      target_date: x.targetDate,
    })),
    versions: [],
    terms: {
      id: s.terms.id,
      kind: "proposal",
      version: s.terms.version,
      sha256: s.terms.sha256,
      body_md: s.terms.bodyMd,
    },
    approvals: [],
  };
}
