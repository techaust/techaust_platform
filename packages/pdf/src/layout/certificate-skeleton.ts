// The PLAIN FUNCTIONAL SKELETON of the acceptance certificate (M4.5, ADM-PROP-08; VERIFY WITH CA/LEGAL). It prints every field of the view
// and nothing more; the M4.5 designer replaces the markup and `CERTIFICATE_CSS` with the real layout and keeps the contract:
//   data-testid="typed-name"  the name the person typed
//   data-testid="time"        the acceptance time, IST and UTC
//   data-testid="sha"         the two fingerprints (the sent PDF, the sent copy)
// Every value goes through `esc`; nothing is loaded from outside (the page's CSP refuses it anyway). The IP address, the user agent and the
// country are printed because they ARE the evidence (docs/08 L-11).
import { esc } from "../escape.ts";

/** What the certificate prints, as text already formatted by the jobs Worker (`buildCertificateView`). */
export type CertificateView = {
  /** "TH/PRP/2627/0003" */
  number: string;
  version: string;
  /** "Proposal" or "Estimate" */
  kind: string;
  title: string;
  clientLegalName: string;
  typedName: string;
  email: string;
  /** "26 Oct 2026, 10:30 IST" and "2026-10-26 05:00:00 UTC": both are printed. */
  acceptedAtIst: string;
  acceptedAtUtc: string;
  ip: string;
  userAgent: string;
  country: string;
  /** "session" (signed in to the portal) or "link" (the emailed link). */
  via: string;
  pdfSha256: string;
  snapshotSha256: string;
  termsVersion: string;
  termsSha256: string;
};

export const CERTIFICATE_CSS = `
body { margin: 0; font-weight: 400; }
h1 { font-size: var(--print-title); margin: 0 0 4mm; }
h2 { font-family: var(--font-display); font-size: 12pt; font-weight: 600; margin: 6mm 0 2mm; }
table { width: 100%; }
th, td { padding: 1.2mm 1.5mm; text-align: left; vertical-align: top; border-bottom: 0.2mm solid var(--color-border); }
th { width: 42mm; font-weight: 400; color: var(--color-text-muted); }
.mono { font-family: var(--font-mono); font-size: var(--print-small); word-break: break-all; }
.note { color: var(--color-text-muted); font-size: var(--print-small); }
`;

const row = (label: string, value: string): string => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;

/** The body of the certificate (inside `<body>`). */
export function certificateBody(v: CertificateView): string {
  return `<h1>Acceptance certificate</h1>
<p class="note">This certificate records that the person named below accepted ${esc(v.kind.toLowerCase())} ${esc(v.number)}, version ${esc(v.version)}.</p>
<h2>The ${esc(v.kind.toLowerCase())}</h2>
<table>
${row("Number", v.number)}${row("Version", v.version)}${row("Title", v.title)}${row("Client", v.clientLegalName)}
</table>
<h2>Who accepted, and when</h2>
<table>
<tr><th>Typed name</th><td data-testid="typed-name">${esc(v.typedName)}</td></tr>
${row("Email address", v.email)}
<tr><th>Time</th><td data-testid="time">${esc(v.acceptedAtIst)} (${esc(v.acceptedAtUtc)})</td></tr>
${row("How", v.via === "link" ? "From the emailed link" : "Signed in to the client portal")}
${row("IP address", v.ip)}${row("Country", v.country)}${row("Browser", v.userAgent)}
</table>
<h2>What was accepted</h2>
<table data-testid="sha">
<tr><th>PDF fingerprint (SHA-256)</th><td class="mono">${esc(v.pdfSha256)}</td></tr>
<tr><th>Sent copy fingerprint</th><td class="mono">${esc(v.snapshotSha256)}</td></tr>
${row("Terms version", v.termsVersion)}
<tr><th>Terms fingerprint</th><td class="mono">${esc(v.termsSha256)}</td></tr>
</table>`;
}
