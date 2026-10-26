// The data of an acceptance certificate (M4.5; ADM-PROP-08, docs/08 L-11): what the evidence record says, read in ONE batch and shaped as strings the
// certificate prints. The page itself (a plain skeleton in `packages/pdf/src/layout/certificate-skeleton.ts`, finished by the designer) takes this view and nothing else, escapes every
// value, and loads no external file. Routed from `pdf.certificate` (pdf.ts, stage B).
//
// The certificate shows the IP address, the user agent and the country because they ARE the evidence (docs/08 L-11). VERIFY WITH CA/LEGAL: showing
// them on a document the client downloads, and the Browser Run processing of the name, address and IP (processor terms, location).
import { formatIstDateTime, formatMoney, money } from "@techaust/core";
import type { CertificateView } from "@techaust/pdf";

export type { CertificateView };

export type CertificateRow = {
  number_display: string | null;
  version: number;
  type: string;
  title: string | null;
  /** The frozen total (minor units) and currency of the document. */
  total_minor: number;
  currency: string;
  client_legal_name: string;
  typed_name: string;
  email: string;
  accepted_at: number;
  ip: string | null;
  user_agent: string | null;
  country: string | null;
  via: string | null;
  pdf_sha256: string;
  snapshot_sha256: string | null;
  terms_version: number | null;
  terms_sha256: string | null;
  certificate_r2_key: string | null;
  /** When the certificate row was written; null while there is none. */
  rendered_at: number | null;
};

/**
 * ?1 acceptance id: the acceptance, its document, the client and the terms version, in one row. The legal name is the one frozen in the document's
 * recipient block (what the offer itself says); the live client record is only the fallback for an old document without one.
 */
export const CERTIFICATE_READ =
  "SELECT d.number_display, d.version, d.type, d.title, d.total_minor, d.currency, coalesce(nullif(CASE WHEN json_valid(d.recipient) THEN json_extract(d.recipient, '$.legalName') END, ''), cl.legal_name) AS client_legal_name, a.typed_name, a.email, a.accepted_at, a.ip, a.user_agent, a.country, a.via, a.pdf_sha256, a.snapshot_sha256, t.version AS terms_version, t.sha256 AS terms_sha256, a.certificate_r2_key, ce.rendered_at FROM acceptances a JOIN documents d ON d.id = a.document_id JOIN clients cl ON cl.id = d.client_id LEFT JOIN terms_versions t ON t.id = a.terms_version_id LEFT JOIN acceptance_certificates ce ON ce.acceptance_id = a.id WHERE a.id = ?1";

const DASH = "–";
const orDash = (v: string | null | undefined) => (v && v.trim() !== "" ? v : DASH);

/** "2026-10-26 05:00:00 UTC". */
export const utcText = (ms: number): string =>
  `${new Date(ms).toISOString().slice(0, 19).replace("T", " ")} UTC`;

/** The certificate's view from the stored row. Pure: the same row always gives the same text. */
export function buildCertificateView(r: CertificateRow): CertificateView {
  return {
    number: r.number_display ?? DASH,
    version: String(r.version),
    kind: r.type === "estimate" ? "Estimate" : "Proposal",
    title: orDash(r.title),
    total: formatMoney(money(r.total_minor, r.currency === "USD" ? "USD" : "INR")),
    clientLegalName: r.client_legal_name,
    typedName: r.typed_name,
    email: r.email,
    acceptedAtIst: formatIstDateTime(r.accepted_at),
    acceptedAtUtc: utcText(r.accepted_at),
    ip: orDash(r.ip),
    userAgent: orDash(r.user_agent),
    country: orDash(r.country),
    via: r.via === "link" ? "link" : "session",
    pdfSha256: r.pdf_sha256,
    snapshotSha256: orDash(r.snapshot_sha256),
    termsVersion: r.terms_version === null ? DASH : String(r.terms_version),
    termsSha256: orDash(r.terms_sha256),
  };
}

export async function readCertificateView(
  db: D1Database,
  acceptanceId: string,
): Promise<{ view: CertificateView; key: string; rendered: boolean } | null> {
  const row = await db.prepare(CERTIFICATE_READ).bind(acceptanceId).first<CertificateRow>();
  if (!row?.certificate_r2_key) return null;
  return { view: buildCertificateView(row), key: row.certificate_r2_key, rendered: row.rendered_at !== null };
}
