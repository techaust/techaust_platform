// M6.5 (ADM-PAY-09, JOB-PDF-01; run file D, G8, L4): the payment receipt's PDF. THE BUILDER'S PLACEHOLDER LAYOUT: the designer designs the page (G8: both
// currencies, long names, 10 "Applied to" lines, the credit remainder) after early check 2. Until then `RECEIPT_LAYOUT_PLACEHOLDER` is true and the jobs Worker
// renders receipts only where `ENVIRONMENT` is "local", so nothing placeholder is ever stored write-once on staging or production (the deed's rule, T11).
//
// The words are 07-ZO's (`RECEIPT_COPY`, `@techaust/core/copy-zo`; "[Placeholder]" until the owner approves them). The page is not a tax document and is never
// titled a voucher; it carries no tax line, no signature block and no stamp (Researched 2026-11-03, s.31(3)(d) CGST Act and Rule 50 CGST Rules (08-C RA-39);
// OPEN (08-C RB-21): is an emailed, computer-generated receipt chargeable to stamp duty?). Every value goes through `esc`; nothing is loaded from outside.
// The contract the tests rely on: data-testid="receipt-title", "receipt-number", "receipt-amount", "receipt-words", "receipt-applied" (one per line),
// "receipt-credit", "receipt-notice".
import { RECEIPT_COPY } from "@techaust/core/copy-zo";
import { esc } from "../escape.ts";
import { PDF_PRINT_CSS, TECHAUST_PDF_FONT_DATA } from "../generated/assets.ts";

/** True while the page is the builder's placeholder (the designer's layout turns it false and takes a new layout id). */
export const RECEIPT_LAYOUT_PLACEHOLDER = true;
/** The layout's id: core `RECEIPT_LAYOUT_ID` is the id of the SEALED data shape; this is the page's (logged with each render). */
export const RECEIPT_PDF_LAYOUT_ID = "receipt-page-0";

const DOCUMENT_CSP = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";

/** What the page prints, every value already formatted (`receiptView`). */
export type ReceiptLayoutView = {
  number: string;
  issuedOn: string;
  issuer: { name: string; lines: readonly string[] };
  receivedFrom: { name: string; gstin: string | null };
  amount: string;
  amountWords: string;
  receivedOn: string;
  paidBy: string;
  reference: string | null;
  appliedTo: readonly { number: string; amount: string }[];
  appliedMore: number;
  heldAsCredit: string | null;
};

const row = (label: string, value: string, testid = "") =>
  `<tr${testid ? ` data-testid="${testid}"` : ""}><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;

/** The whole HTML document of a receipt's PDF. */
export function renderReceiptHtml(v: ReceiptLayoutView): string {
  const C = RECEIPT_COPY;
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_CSP}">
<title>${esc(`${C.title} ${v.number}`)}</title>
<style>
${TECHAUST_PDF_FONT_DATA}
${PDF_PRINT_CSS}
body { margin: 0; font-family: var(--font-sans); font-size: var(--print-body); line-height: var(--print-body-leading); }
table { border-collapse: collapse; width: 100%; margin-top: 4mm; }
th { text-align: left; font-weight: 500; width: 40%; padding: 1mm 0; color: var(--color-text-muted); }
td { padding: 1mm 0; overflow-wrap: anywhere; }
h1 { font-family: var(--font-display); font-size: var(--print-title); margin: 0 0 4mm; }
.notice { margin-top: 8mm; font-size: var(--print-small); color: var(--color-text-muted); }
</style>
</head>
<body>
<p>${esc(v.issuer.name)}</p>
${v.issuer.lines.map((l) => `<p>${esc(l)}</p>`).join("\n")}
<h1 data-testid="receipt-title">${esc(C.title)}</h1>
<table>
${row(C.number, v.number, "receipt-number")}
${row(C.date, v.issuedOn)}
${row(C.receivedFrom, v.receivedFrom.gstin ? `${v.receivedFrom.name} (${v.receivedFrom.gstin})` : v.receivedFrom.name)}
${row(C.amountReceived, v.amount, "receipt-amount")}
${row(C.amountInWords, v.amountWords, "receipt-words")}
${row(C.receivedOn, v.receivedOn)}
${row(C.paidBy, v.paidBy)}
${v.reference ? row(C.reference, v.reference) : ""}
</table>
${
  v.appliedTo.length > 0
    ? `<table><tr><th>${esc(C.appliedTo)}: ${esc(C.invoice)}</th><td>${esc(C.amount)}</td></tr>
${v.appliedTo.map((a) => `<tr data-testid="receipt-applied"><th>${esc(a.number)}</th><td>${esc(a.amount)}</td></tr>`).join("\n")}
${v.appliedMore > 0 ? `<tr><th>${esc(C.appliedMore(v.appliedMore))}</th><td></td></tr>` : ""}
</table>`
    : ""
}
${v.heldAsCredit ? `<table>${row(C.heldAsCredit, v.heldAsCredit, "receipt-credit")}</table>` : ""}
<p class="notice" data-testid="receipt-notice">${esc(C.notTaxInvoice)} ${esc(C.computerGenerated)}</p>
</body>
</html>
`;
}
