// The plain invoice skeleton (M5.1 stage B3): every Rule 46 field of a tax invoice printed in a readable order, in the classes the proposal layout
// already styles (so the page is usable now), and nothing designed. The designer builds the real tax invoice layout on this in phase 2
// (`layout/invoice.ts`, docs/06 §7.3, wording from 07-R); until then the words below are the skeleton's own and PENDING that approval, and every
// rule printed is VERIFY WITH CA/LEGAL.
//
// What it prints (Rule 46, docs/08-research-appendix/A §3):
//   (a) the supplier's name, address and GSTIN (and the principal place of business);   (b) the consecutive number;   (c) the date of issue;
//   (d) the recipient's name, address and GSTIN when registered;   (e) the recipient's State name and code;   (g) SAC;   (h) description;
//   quantity and unit;   (j) the total value (sub-total, discount) and (k) the taxable value after discount;   (l) the rate and (m) the amount of
//   tax per head: CGST and SGST for an intra-state supply, IGST otherwise;   (n) the place of supply with its State name;   (p) whether tax is
//   payable on reverse charge, word for word as frozen at issue;   (q) the signatory line, with the signature image only when set and verified.
//   Rule 48(2): "ORIGINAL FOR RECIPIENT".   Also: the amount in words, the due date, the INR bank block when the invoice has one, and the notes.
// Not printed because not modelled: a delivery address different from the place of supply (a services business), cess, the e-invoice QR (Rule 46(r):
// only above the e-invoice threshold).
//
// No logic beyond formatting: every value is a pre-formatted string of the view. Every dynamic string goes through `esc`; Markdown through
// `markdownBlocks`. Data-testids kept from the proposal layout: `rupee`, `currency-symbol`, `total`, `integrity`; new: `reverse-charge`, `copy-label`,
// `signature`, `signatory`.
import { esc } from "../escape.ts";
import { PDF_LOGOS, PDF_SYMBOL } from "../generated/assets.ts";
import type { InvoiceView, InvoiceViewLine } from "../invoice-types.ts";
import { markdownBlocks } from "../markdown-html.ts";
import { cssString } from "./styles.ts";

/** The skeleton's words: 07-R §6 where it has a line (PENDING the owner's word-for-word approval), the rest plain. The designer takes them over in phase 2. */
export const INVOICE_COPY = {
  from: "From",
  billTo: "Billed to",
  document: "Document",
  number: "Invoice number",
  date: "Invoice date",
  dueDate: "Due date",
  currency: "Currency",
  gstin: "GSTIN",
  placeOfSupply: (label: string) => `Place of supply: ${label}`,
  recipientState: (label: string) => `State: ${label}`,
  lines: {
    n: "#",
    description: "Description",
    sac: "SAC",
    qty: "Qty",
    unit: "Unit",
    rate: "Rate",
    discount: "Discount",
    taxable: "Taxable value",
    cgstRate: "CGST %",
    cgst: "CGST",
    sgstRate: "SGST %",
    sgst: "SGST",
    igstRate: "IGST %",
    igst: "IGST",
    total: "Total",
  },
  summary: { heading: "Tax summary", sac: "SAC", taxable: "Taxable value" },
  words: (words: string) => `Amount in words: ${words}`,
  payment: { heading: "How to pay", dueDate: "Due date" },
  signatory: "Authorised signatory",
  forSupplier: (name: string) => `For ${name}`,
  page: { word: "Page", of: "of" },
} as const;

const RUPEE = "₹";
const p = (cls: string, text: string) => `<p class="${cls}">${esc(text)}</p>`;

function logoHtml(view: InvoiceView): string {
  const logos = PDF_LOGOS as Record<string, string | undefined>;
  const svg = logos[view.logo] ?? logos["logo-primary-color.svg"] ?? "";
  return `<div class="masthead__logo">${svg}</div>`;
}

/** A formatted amount with its currency sign in its own span (the visual suite asks the font of that glyph). */
function amountHtml(value: string, testid: string | null): string {
  const sign = value.includes(RUPEE) ? RUPEE : value.includes("$") ? "$" : null;
  if (sign === null || testid === null) return esc(value);
  const at = value.indexOf(sign);
  return `${esc(value.slice(0, at))}<span data-testid="${testid}">${sign}</span>${esc(value.slice(at + 1))}`;
}

const isInr = (view: InvoiceView) => view.currency === "INR";
const intra = (view: InvoiceView) => view.supplyType === "intra";

function masthead(view: InvoiceView): string {
  return `<header class="masthead">${logoHtml(view)}<h1 class="masthead__title">${esc(view.docLabel)}</h1></header>`;
}

function parties(view: InvoiceView): string {
  const C = INVOICE_COPY;
  const line = (t: string) => p("party__line", t);
  const from = `<div class="party"><p class="label">${C.from}</p>${p("party__name", view.supplier.name)}${view.supplier.lines.map(line).join("")}</div>`;
  const r = view.recipient;
  const to = `<div class="party"><p class="label">${C.billTo}</p>${p("party__name", r.name)}${r.lines.map(line).join("")}${
    r.gstin ? line(`${C.gstin} ${r.gstin}`) : ""
  }${r.state ? line(C.recipientState(r.state)) : ""}${line(C.placeOfSupply(view.placeOfSupply))}${
    r.attention ? p("party__line party__attention", r.attention) : ""
  }</div>`;
  const fact = (term: string, value: string) => `<div><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`;
  const doc = `<div class="party party--doc"><p class="label">${C.document}</p><p class="label" data-testid="copy-label">${esc(
    view.copyLabel ?? "",
  )}</p><dl class="facts">${fact(C.number, view.numberDisplay)}${fact(C.date, view.issueDate)}${fact(C.dueDate, view.dueDate)}${fact(
    C.currency,
    view.currency,
  )}</dl></div>`;
  return `<section class="parties" aria-label="${esc(view.docLabel)}">${from}${to}${doc}</section>`;
}

function headCells(view: InvoiceView, l: InvoiceViewLine): string {
  const c = (v: string | null) => `<td class="num">${v === null ? "" : esc(v)}</td>`;
  return intra(view)
    ? `${c(l.headRates.cgst)}${c(l.headAmounts.cgst)}${c(l.headRates.sgst)}${c(l.headAmounts.sgst)}`
    : `${c(l.headRates.igst)}${c(l.headAmounts.igst)}`;
}

function itemsTable(view: InvoiceView): string {
  const L = INVOICE_COPY.lines;
  const withDiscount = view.lines.some((l) => l.discount !== null);
  const rows = view.lines
    .map(
      (l) =>
        `<tr><td class="c-n num">${esc(l.n)}</td><td class="c-desc"><span class="desc">${esc(l.description)}</span>${
          l.detail ? `<span class="sub">${esc(l.detail)}</span>` : ""
        }${l.sac ? `<span class="sub">${L.sac} ${esc(l.sac)}</span>` : ""}</td><td class="num">${esc(l.qty)}</td><td>${esc(l.unit)}</td><td class="num">${esc(
          l.rate,
        )}</td>${withDiscount ? `<td class="num">${l.discount ? esc(l.discount) : ""}</td>` : ""}<td class="num">${esc(l.taxable)}</td>${headCells(
          view,
          l,
        )}<td class="num">${esc(l.total)}</td></tr>`,
    )
    .join("");
  const th = (cls: string, text: string) => `<th scope="col" class="${cls}">${text}</th>`;
  const heads = intra(view)
    ? [th("num", L.cgstRate), th("num", L.cgst), th("num", L.sgstRate), th("num", L.sgst)]
    : [th("num", L.igstRate), th("num", L.igst)];
  const head = [
    th("c-n", L.n),
    th("c-desc", L.description),
    th("num c-qty", L.qty),
    th("c-unit", L.unit),
    th("num c-rate", L.rate),
    withDiscount ? th("num c-disc", L.discount) : "",
    th("num c-taxable", L.taxable),
    ...heads,
    th("num c-taxable", L.total),
  ].join("");
  return `<table class="grid items"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function totalsBlock(view: InvoiceView): string {
  const rows = view.totals
    .map((t) =>
      t.strong
        ? `<tr class="grand"><th scope="row">${esc(t.label)}</th><td class="num" data-testid="total">${amountHtml(
            t.value,
            isInr(view) ? "rupee" : "currency-symbol",
          )}</td></tr>`
        : `<tr><th scope="row">${esc(t.label)}</th><td class="num">${esc(t.value)}</td></tr>`,
    )
    .join("");
  const notes = [
    `<p class="words">${esc(INVOICE_COPY.words(view.words))}</p>`,
    `<p class="note" data-testid="reverse-charge">${esc(view.reverseCharge)}</p>`,
  ].join("");
  return `<div class="totals"><div class="totals__notes">${notes}</div><table class="totals__table">${rows}</table></div>`;
}

function summaryTable(view: InvoiceView): string {
  if (view.summary.length === 0) return "";
  const S = INVOICE_COPY.summary;
  const L = INVOICE_COPY.lines;
  const th = (cls: string, text: string) => `<th scope="col" class="${cls}">${text}</th>`;
  const heads = intra(view)
    ? [th("num", L.cgstRate), th("num", L.cgst), th("num", L.sgstRate), th("num", L.sgst)]
    : [th("num", L.igstRate), th("num", L.igst)];
  const c = (v: string | null) => `<td class="num">${v === null ? "" : esc(v)}</td>`;
  const rows = view.summary
    .map(
      (r) =>
        `<tr><td>${r.sac ? esc(r.sac) : ""}</td><td class="num">${esc(r.taxable)}</td>${
          intra(view)
            ? `${c(r.headRates.cgst)}${c(r.headAmounts.cgst)}${c(r.headRates.sgst)}${c(r.headAmounts.sgst)}`
            : `${c(r.headRates.igst)}${c(r.headAmounts.igst)}`
        }</tr>`,
    )
    .join("");
  return `<div class="block"><h3>${S.heading}</h3><table class="grid summary"><thead><tr>${th("c-sac", S.sac)}${th("num c-amt", S.taxable)}${heads.join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function paymentBlock(view: InvoiceView): string {
  const P = INVOICE_COPY.payment;
  const bank = view.bank
    ? `<dl class="facts">${view.bank.map((b) => `<div><dt>${esc(b.label)}</dt><dd>${esc(b.value)}</dd></div>`).join("")}</dl>`
    : "";
  return `<div class="block"><h3>${P.heading}</h3>${p("party__line", `${P.dueDate}: ${view.dueDate}`)}${bank}</div>`;
}

function signatoryBlock(view: InvoiceView): string {
  const image = view.signature
    ? `<img data-testid="signature" alt="" src="${esc(view.signature.dataUri)}" style="display:block;max-height:18mm;max-width:60mm;margin:2mm 0">`
    : `<div style="height:14mm"></div>`;
  return `<div class="block" style="text-align:right"><p class="party__line">${esc(INVOICE_COPY.forSupplier(view.supplier.name))}</p>${image}<p class="party__line" data-testid="signatory">${INVOICE_COPY.signatory}</p></div>`;
}

function notesBlock(view: InvoiceView): string {
  if (!view.notes) return "";
  return `<div class="block"><h3>${esc(view.notes.title)}</h3><div class="terms">${markdownBlocks(view.notes.bodyMd).join("")}</div></div>`;
}

/** The body of an invoice (inside `<body>`). */
export function invoiceBody(view: InvoiceView): string {
  return `<div class="doc doc--invoice">${masthead(view)}
${parties(view)}
<div class="money">${itemsTable(view)}${totalsBlock(view)}${summaryTable(view)}</div>
${paymentBlock(view)}
${notesBlock(view)}
${signatoryBlock(view)}
<p class="integrity" data-testid="integrity">${esc(view.integrity)}</p></div>`;
}

/** What the skeleton adds to the template CSS: the body size of the document (the proposal layout sets it on its own class). */
export const INVOICE_SKELETON_CSS =
  ".doc--invoice { font-size: var(--print-proposal-body); line-height: var(--print-proposal-leading); }";

const SYMBOL_URI = `data:image/svg+xml,${encodeURIComponent(PDF_SYMBOL)}`;

/** The page footer of an invoice (CSS page-margin boxes, every page): the symbol and the footer line on the left; the number and "Page X of Y" on the right. */
export function invoicePageCss(view: InvoiceView): string {
  const C = INVOICE_COPY;
  return `@page {
  @bottom-left {
    content: ${cssString(view.footer.brand)};
    padding-left: 6mm;
    background: url("${SYMBOL_URI}") no-repeat left center / 3.6mm 3.6mm;
    font-family: var(--font-sans);
    font-size: var(--print-small);
    font-weight: 400;
    line-height: 1;
    color: var(--color-text-muted);
    vertical-align: middle;
    width: 120mm;
  }
  @bottom-right {
    content: ${cssString(`${view.numberDisplay}   ${C.page.word} `)} counter(page) ${cssString(` ${C.page.of} `)} counter(pages);
    white-space: pre;
    font-family: var(--font-sans);
    font-size: var(--print-small);
    font-weight: 400;
    font-variant-numeric: tabular-nums lining-nums;
    line-height: 1;
    color: var(--color-text-muted);
    text-align: right;
    vertical-align: middle;
  }
}`;
}
