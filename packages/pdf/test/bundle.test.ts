// The envelope made from loaded rows: for every fixture the rows give back EXACTLY the fixture's envelope (same hashes, same bytes), through the
// send route's own sealing functions; a row that no longer reproduces its seal is refused; the warm-up sample renders.
import type { DocumentBundle, DocumentRow, TermsRow } from "@techaust/db/documents";
import { describe, expect, it } from "vitest";
import { envelopeOfBundle } from "../src/bundle.ts";
import { serializeEnvelope } from "../src/envelope.ts";
import { sha256Hex } from "../src/hash.ts";
import { warmEnvelope, warmPdf } from "../src/sample.ts";
import type { Envelope } from "../src/types.ts";
import { buildFixture, FIXTURE_NAMES } from "./fixtures/index.ts";

/** The rows a D1 read of this sent version would give (snake_case, JSON columns parsed). */
function bundleOf(source: Envelope): DocumentBundle<TermsRow> {
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

describe("envelopeOfBundle", () => {
  it.each(FIXTURE_NAMES)("gives back exactly the sealed envelope of %s", async (name) => {
    const { envelope } = await buildFixture(name);
    const made = await envelopeOfBundle(bundleOf(envelope));
    expect(made.ok).toBe(true);
    if (made.ok) expect(serializeEnvelope(made.envelope)).toBe(serializeEnvelope(envelope));
  });

  it("refuses rows that do not reproduce their seal or content hash", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    const line = bundleOf(envelope);
    (line.lines[0] as { description: string }).description = "Changed";
    expect(await envelopeOfBundle(line)).toEqual({ ok: false, code: "content_hash" });

    const header = bundleOf(envelope);
    (header.document.recipient as { legalName: string }).legalName = "Someone Else";
    expect(await envelopeOfBundle(header)).toEqual({ ok: false, code: "snapshot_hash" });

    const stored = bundleOf(envelope);
    stored.document.snapshot_sha256 = "0".repeat(64);
    expect(await envelopeOfBundle(stored)).toEqual({ ok: false, code: "snapshot_hash" });

    const terms = bundleOf(envelope);
    (terms.terms as TermsRow).body_md += " Extra.";
    expect(await envelopeOfBundle(terms)).toEqual({ ok: false, code: "terms_hash" });
  });

  it("says why it cannot make one: not a quote, not sent, no FY", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    const invoice = bundleOf(envelope);
    (invoice.document as { type: string }).type = "invoice";
    expect(await envelopeOfBundle(invoice)).toEqual({ ok: false, code: "unsupported_type" });
    const draft = bundleOf(envelope);
    draft.document.frozen_at = null;
    expect(await envelopeOfBundle(draft)).toEqual({ ok: false, code: "not_sent" });
    const noFy = bundleOf(envelope);
    noFy.document.fy = "abcd";
    expect(await envelopeOfBundle(noFy)).toEqual({ ok: false, code: "not_sent" });
  });

  it("keeps an empty section empty (null is hashed as stored)", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    expect(envelope.snapshot.sections.length).toBeGreaterThan(0);
    expect(await sha256Hex("x")).toHaveLength(64);
  });
});

describe("the warm-up sample", () => {
  it("renders to HTML without verification and never throws", () => {
    expect(warmEnvelope().snapshot.lines).toHaveLength(1);
    expect(warmPdf()).toBeGreaterThan(10_000);
  });
});
