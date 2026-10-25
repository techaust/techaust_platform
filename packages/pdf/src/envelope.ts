// The R2 envelope: the frozen copy a PDF is rendered from (lead decision L4). Written with `JSON.stringify` in a fixed key order, so the
// same document always gives the same bytes. Verification recomputes every hash it can from the envelope itself:
//   - snapshotSha256 = core `snapshotSha256` of the header's parts (M4.3, the very function the send route sealed it with)
//   - header.computedSha256 = sha256(computedJson)
//   - header.terms.sha256 = sha256(terms.bodyMd), and the header terms equal the snapshot terms
//   - header.document.contentSha256 = core `contentHash` of lines, sections, schedule and the computed result (the send route's own).
import { contentHash, type DraftContent, type SnapshotInput, snapshotSha256 } from "@techaust/core/documents";
import { SCHEDULE_TRIGGERS } from "@techaust/core/schedule-text";
import type { ComputedDocument } from "@techaust/core/tax";
import { sha256Hex } from "./hash.ts";
import type { Envelope, RecipientSnap, SnapshotHeader } from "./types.ts";

export type VerifyCode =
  | "version"
  | "mismatch"
  | "snapshot_hash"
  | "computed_hash"
  | "computed_json"
  | "terms_hash"
  | "content_hash";
export type VerifyResult = { ok: true } | { ok: false; code: VerifyCode };

/** A copy with its keys in sorted order and no undefined values: fixed bytes for any object the send route froze (unknown keys are kept, so the hash still matches). */
function sorted<T extends object>(o: T): T {
  return Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [
        k,
        typeof v === "object" && v !== null && !Array.isArray(v) ? sorted(v as object) : v,
      ]),
  ) as T;
}

const recipient = (r: RecipientSnap): RecipientSnap => sorted(r);

function header(h: SnapshotHeader): SnapshotHeader {
  const d = h.document;
  const c = h.issuer.company;
  return {
    document: {
      type: d.type,
      clientId: d.clientId,
      versionGroupId: d.versionGroupId,
      version: d.version,
      currency: d.currency,
      title: d.title,
      issueDate: d.issueDate,
      validUntil: d.validUntil,
      validityDays: d.validityDays,
      contentSha256: d.contentSha256,
      discountKind: d.discountKind,
      discountValue: d.discountValue,
      exportMode: d.exportMode,
    },
    supply: {
      type: h.supply.type,
      placeOfSupplyCode: h.supply.placeOfSupplyCode,
      supplierStateCode: h.supply.supplierStateCode,
    },
    recipient: recipient(h.recipient),
    issuer: {
      company: {
        tradeName: c.tradeName,
        legalName: c.legalName,
        address: c.address,
        gstin: c.gstin,
        stateCode: c.stateCode,
        logo: c.logo,
      },
      sender: { staffId: h.issuer.sender.staffId, name: h.issuer.sender.name, email: h.issuer.sender.email },
    },
    terms: { id: h.terms.id, version: h.terms.version, sha256: h.terms.sha256 },
    instalmentAmounts: [...h.instalmentAmounts],
    computedSha256: h.computedSha256,
  };
}

/** The envelope with every key in its fixed place (a copy; the input is not changed). */
export function buildEnvelope(e: Omit<Envelope, "v"> & { v?: 1 }): Envelope {
  const s = e.snapshot;
  return {
    v: 1,
    documentId: e.documentId,
    type: e.type,
    version: e.version,
    number: e.number,
    numberDisplay: e.numberDisplay,
    series: e.series,
    fy: e.fy,
    sentAt: e.sentAt,
    snapshotSha256: e.snapshotSha256,
    snapshot: {
      v: 2,
      header: header(s.header),
      computedJson: s.computedJson,
      lines: s.lines.map((l) => ({
        catalogueItemId: l.catalogueItemId,
        description: l.description,
        detail: l.detail,
        sac: l.sac,
        qtyMilli: l.qtyMilli,
        unit: l.unit,
        rateMinor: l.rateMinor,
        discountKind: l.discountKind,
        discountValue: l.discountValue,
        gstRateBp: l.gstRateBp,
        catalogueRateMinor: l.catalogueRateMinor,
        catalogueLine: l.catalogueLine,
      })),
      sections: s.sections.map((x) => ({ kind: x.kind, title: x.title, bodyMd: x.bodyMd, hidden: x.hidden })),
      schedule: s.schedule.map((x) => ({
        label: x.label,
        trigger: x.trigger,
        pctBp: x.pctBp,
        detail: x.detail,
        targetDate: x.targetDate,
      })),
      terms: { id: s.terms.id, version: s.terms.version, sha256: s.terms.sha256, bodyMd: s.terms.bodyMd },
    },
  };
}

/** The text stored in R2. */
export const serializeEnvelope = (e: Envelope): string => JSON.stringify(buildEnvelope(e));

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Parses stored text; null unless it has the envelope's shape (version 1, a snapshot of format 2 and its parts). */
export function parseEnvelope(text: string): Envelope | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(v) || v.v !== 1 || typeof v.documentId !== "string" || typeof v.snapshotSha256 !== "string")
    return null;
  const s = v.snapshot;
  if (!isObj(s) || s.v !== 2 || typeof s.computedJson !== "string" || !isObj(s.header) || !isObj(s.terms))
    return null;
  if (!Array.isArray(s.lines) || !Array.isArray(s.sections) || !Array.isArray(s.schedule)) return null;
  if (!isObj(s.header.document) || !isObj(s.header.issuer) || !isObj(s.header.recipient)) return null;
  if (!isObj(s.header.supply) || !isObj(s.header.terms)) return null;
  if (typeof v.type !== "string" || typeof v.version !== "number" || typeof v.number !== "number")
    return null;
  return v as unknown as Envelope;
}

const triggerOf = (v: string): DraftContent["schedule"][number]["trigger"] =>
  SCHEDULE_TRIGGERS.find((t) => t === v) ?? "on_accept";

/** The draft a content hash is computed over, from an envelope (the same mapping as `draftContentOfBundle`). */
export function draftOf(e: Envelope): DraftContent {
  const h = e.snapshot.header;
  return {
    type: h.document.type,
    clientId: h.document.clientId,
    contactId: h.recipient.contactId ?? null,
    title: h.document.title,
    currency: h.document.currency,
    validityDays: h.document.validityDays,
    termsVersionId: h.terms.id,
    discountKind: h.document.discountKind,
    discountValue: h.document.discountValue,
    exportMode: h.document.exportMode,
    lines: e.snapshot.lines,
    sections: e.snapshot.sections,
    schedule: e.snapshot.schedule.map((x) => ({ ...x, trigger: triggerOf(x.trigger) })),
  };
}

/** The input of the seal, rebuilt from the envelope's header. */
export const snapshotInputOf = (e: Envelope): SnapshotInput => {
  const h = e.snapshot.header;
  return {
    document: h.document,
    supply: h.supply,
    recipient: h.recipient,
    issuer: h.issuer,
    terms: h.terms,
    instalmentAmounts: h.instalmentAmounts,
    computedSha256: h.computedSha256,
  };
};

/** Recomputes every hash of the envelope. A render never starts from an envelope that fails. */
export async function verifyEnvelope(e: Envelope): Promise<VerifyResult> {
  const s = e.snapshot;
  const h = s.header;
  if (e.v !== 1 || s.v !== 2) return { ok: false, code: "version" };
  if (
    e.type !== h.document.type ||
    e.version !== h.document.version ||
    s.terms.id !== h.terms.id ||
    s.terms.version !== h.terms.version ||
    s.terms.sha256 !== h.terms.sha256
  ) {
    return { ok: false, code: "mismatch" };
  }
  if ((await snapshotSha256(snapshotInputOf(e))) !== e.snapshotSha256) {
    return { ok: false, code: "snapshot_hash" };
  }
  if ((await sha256Hex(s.computedJson)) !== h.computedSha256) return { ok: false, code: "computed_hash" };
  if ((await sha256Hex(s.terms.bodyMd)) !== s.terms.sha256) return { ok: false, code: "terms_hash" };
  let computed: ComputedDocument;
  try {
    computed = JSON.parse(s.computedJson) as ComputedDocument;
  } catch {
    return { ok: false, code: "computed_json" };
  }
  if ((await contentHash(draftOf(e), computed)) !== h.document.contentSha256) {
    return { ok: false, code: "content_hash" };
  }
  return { ok: true };
}
