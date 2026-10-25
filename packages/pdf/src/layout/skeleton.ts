// The PLAIN FUNCTIONAL SKELETON of the proposal and estimate (M4.4 phase 1). It prints every field of the view correctly and nothing
// more: the designer replaces this file and `styles.ts` with the real layout (docs/06 §7.1 to §7.4) and keeps the contract:
//   data-testid="rupee"      the rupee sign (INR documents) or the rupee sign inside the INR note (USD documents)
//   data-testid="status"     the status as text
//   data-testid="total"      the grand total value
//   data-testid="integrity"  the document id and fingerprint line
// Every dynamic string goes through `esc`; Markdown goes through `markdownToHtml` (escaped, safe links only).

import { esc } from "../escape.ts";
import { PDF_LOGOS } from "../generated/assets.ts";
import { markdownToHtml } from "../markdown-html.ts";
import type { PdfView } from "../types.ts";

const RUPEE = "₹";

function logoHtml(view: PdfView): string {
  const svg = (PDF_LOGOS as Record<string, string | undefined>)[view.logo];
  return svg ? `<div class="logo">${svg}</div>` : `<div class="logo-text">${esc(view.supplier.name)}</div>`;
}

const lines = (items: readonly string[]) => items.map((l) => `<div>${esc(l)}</div>`).join("");

function currencyProbe(view: PdfView): string {
  return view.currency === "INR"
    ? `All amounts in <span data-testid="rupee">${RUPEE}</span> (INR).`
    : `All amounts in <span data-testid="currency-symbol">$</span> (${esc(view.currency)}).`;
}

function inrNoteHtml(view: PdfView): string {
  if (view.inrNote === null) return "";
  const [first = "", ...rest] = view.inrNote.split(RUPEE);
  const text = `${esc(first)}<span data-testid="rupee">${RUPEE}</span>${rest.map(esc).join(RUPEE)}`;
  return `<p class="note">${text}</p>`;
}

function itemsTable(view: PdfView): string {
  const rows = view.lines
    .map(
      (l) =>
        `<tr><td class="num">${esc(l.n)}</td><td>${esc(l.description)}${
          l.detail ? `<div class="muted">${esc(l.detail)}</div>` : ""
        }${l.sac ? `<div class="muted">SAC ${esc(l.sac)}</div>` : ""}</td><td class="r">${esc(l.qty)} ${esc(l.unit)}</td><td class="r">${esc(
          l.rate,
        )}</td><td class="r">${l.discount ? esc(l.discount) : ""}</td><td class="r">${esc(l.gstRate)}</td><td class="r">${esc(
          l.taxable,
        )}</td><td class="r">${esc(l.total)}</td></tr>`,
    )
    .join("");
  return `<table class="items"><thead><tr><th>No</th><th>Description</th><th class="r">Quantity</th><th class="r">Rate</th><th class="r">Discount</th><th class="r">GST</th><th class="r">Taxable value</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function totalsTable(view: PdfView): string {
  const rows = view.totals
    .map((t) =>
      t.strong
        ? `<tr class="grand"><th>${esc(t.label)}</th><td class="r" data-testid="total">${esc(t.value)}</td></tr>`
        : `<tr><th>${esc(t.label)}</th><td class="r">${esc(t.value)}</td></tr>`,
    )
    .join("");
  return `<table class="totals">${rows}</table>`;
}

function summaryTable(view: PdfView): string {
  if (view.summary.length === 0) return "";
  const rows = view.summary
    .map(
      (r) =>
        `<tr><td>${esc(r.rate)}</td><td>${r.sac ? esc(r.sac) : ""}</td><td class="r">${esc(r.taxable)}</td><td class="r">${esc(r.cgst)}</td><td class="r">${esc(
          r.sgst,
        )}</td><td class="r">${esc(r.igst)}</td></tr>`,
    )
    .join("");
  return `<h2>Tax summary</h2><table class="summary"><thead><tr><th>GST rate</th><th>SAC</th><th class="r">Taxable value</th><th class="r">CGST</th><th class="r">SGST</th><th class="r">IGST</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function scheduleTable(view: PdfView): string {
  if (view.schedule.length === 0) return "";
  const rows = view.schedule
    .map(
      (s) =>
        `<tr><td>${esc(s.label)}${s.detail ? `<div class="muted">${esc(s.detail)}</div>` : ""}</td><td>${esc(s.when)}${
          s.date ? ` (${esc(s.date)})` : ""
        }</td><td class="r">${esc(s.share)}</td><td class="r">${esc(s.amount)}</td></tr>`,
    )
    .join("");
  return `<h2>Payment schedule</h2><table class="schedule"><thead><tr><th>Step</th><th>When</th><th class="r">Share</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** The body of the document (inside `<body>`). */
export function skeletonBody(view: PdfView): string {
  const supplier = `<div class="supplier"><strong>${esc(view.supplier.name)}</strong>${lines(view.supplier.lines)}</div>`;
  const recipient = `<div class="recipient"><div class="label">Prepared for</div><strong>${esc(view.recipient.name)}</strong>${
    view.recipient.attention ? `<div>Attention: ${esc(view.recipient.attention)}</div>` : ""
  }${lines(view.recipient.lines)}</div>`;
  const meta = `<table class="meta"><tr><th>Number</th><td>${esc(view.numberDisplay)}</td></tr><tr><th>Version</th><td>${esc(
    view.versionLabel,
  )}</td></tr><tr><th>Status</th><td><span data-testid="status">${esc(view.statusText)}</span></td></tr><tr><th>Date</th><td>${esc(
    view.issueDate,
  )}</td></tr><tr><th>Valid until</th><td>${esc(view.validUntil)}</td></tr><tr><th>Place of supply</th><td>${esc(view.placeOfSupply)}</td></tr></table>`;
  const sections = view.sections
    .map(
      (s) =>
        `<section class="sec sec-${esc(s.kind)}"><h2>${esc(s.title)}</h2>${markdownToHtml(s.bodyMd)}</section>`,
    )
    .join("");
  return `<header class="head">${logoHtml(view)}${supplier}</header>
<h1>${esc(view.docLabel)}${view.documentTitle ? `: ${esc(view.documentTitle)}` : ""}</h1>
${view.notice ? `<p class="notice">${esc(view.notice)}</p>` : ""}
<div class="parties">${recipient}${meta}</div>
<p class="note">${currencyProbe(view)}</p>
${sections}
<h2>Estimate</h2>
${itemsTable(view)}
${totalsTable(view)}
<p class="words">${esc(view.words)}</p>
${inrNoteHtml(view)}
${summaryTable(view)}
${scheduleTable(view)}
<section class="terms"><h2>${esc(view.terms.title)}</h2>${markdownToHtml(view.terms.bodyMd)}</section>
<footer class="foot"><div data-testid="integrity">${esc(view.integrity)}</div><div>${esc(view.footer.contact)}. Sent from ${esc(view.footer.sender)}.</div></footer>`;
}
