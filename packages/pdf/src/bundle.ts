// The R2 envelope of a SENT version, made from the rows that were read (the jobs snapshot step; also what the admin test of the real send
// path calls). The seal is checked with the SEND ROUTE'S OWN functions from M4.3 (`@techaust/db/documents`: `sealPartsOfBundle`, `sealOf`,
// `contentHashOfBundle`), not with a copy: a row that does not reproduce its `snapshot_sha256` and `content_sha256` is refused, and
// nothing is written to R2 from it.
import { snapshotHeader } from "@techaust/core/documents";
import { fyLabelOfToken } from "@techaust/core/pdf-jobs";
import {
  contentHashOfBundle,
  type DocumentBundle,
  draftContentOfBundle,
  sealOf,
  sealPartsOfBundle,
  type TermsRow,
} from "@techaust/db/documents";
import { buildEnvelope } from "./envelope.ts";
import { sha256Hex } from "./hash.ts";
import type { Envelope, SnapshotHeader } from "./types.ts";

export type BundleRefusal =
  /** Not a proposal or an estimate (M4.4 renders only those). */
  | "unsupported_type"
  /** Not frozen, or a frozen block, number, series, FY or terms is missing. */
  | "not_sent"
  /** The rows do not reproduce `snapshot_sha256`. */
  | "snapshot_hash"
  /** The rows do not reproduce `content_sha256`. */
  | "content_hash"
  /** The terms text does not match its stored SHA-256. */
  | "terms_hash";

export type BundleResult = { ok: true; envelope: Envelope } | { ok: false; code: BundleRefusal };

/** The envelope of a loaded, sent proposal or estimate, or the reason it cannot be made. */
export async function envelopeOfBundle(b: DocumentBundle<TermsRow>): Promise<BundleResult> {
  const d = b.document;
  if (d.type !== "proposal" && d.type !== "estimate") return { ok: false, code: "unsupported_type" };
  const parts = sealPartsOfBundle(b);
  const draft = draftContentOfBundle(b);
  const contentHash = contentHashOfBundle(b);
  const fy = d.fy === null ? null : fyLabelOfToken(d.fy);
  const terms = b.terms;
  if (
    !parts ||
    !draft ||
    !contentHash ||
    !terms ||
    fy === null ||
    d.series === null ||
    d.number === null ||
    d.number_display === null ||
    d.sent_at === null ||
    d.snapshot_sha256 === null
  ) {
    return { ok: false, code: "not_sent" };
  }
  const seal = await sealOf(parts);
  if (seal.snapshotSha256 !== d.snapshot_sha256) return { ok: false, code: "snapshot_hash" };
  if ((await contentHash) !== d.content_sha256) return { ok: false, code: "content_hash" };
  if ((await sha256Hex(terms.body_md)) !== terms.sha256) return { ok: false, code: "terms_hash" };
  return {
    ok: true,
    envelope: buildEnvelope({
      documentId: d.id,
      type: d.type,
      version: d.version,
      number: d.number,
      numberDisplay: d.number_display,
      series: d.series,
      fy,
      sentAt: d.sent_at,
      snapshotSha256: seal.snapshotSha256,
      snapshot: {
        v: 2,
        header: snapshotHeader(seal.input) as unknown as SnapshotHeader,
        computedJson: seal.computedJson,
        lines: draft.lines.map((l) => ({ ...l })),
        sections: draft.sections.map((x) => ({ ...x })),
        schedule: draft.schedule.map((x) => ({ ...x })),
        terms: { id: terms.id, version: terms.version, sha256: terms.sha256, bodyMd: terms.body_md },
      },
    }),
  };
}
