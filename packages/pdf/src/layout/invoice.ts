// The tax invoice layout (M5.1 phase 2; docs/06 §7.1 to §7.3, §7.5; wording 07-R §6 in ./copy.ts). The same system as the proposal and estimate
// layout (./document.ts, ./styles.ts): the 12-column A4 page, the shared header (logo, title, the verdigris rule, then three blocks), the money
// across all twelve columns, ink on white. What is the invoice's own:
//   - the title carries its Rule 48(2) copy mark ("ORIGINAL FOR RECIPIENT") under it, as 06 §7.2 draws it;
//   - the third header block is the invoice's identity: the number set larger than anything else in the header (an invoice is known by its
//     number), then the dates and the place of supply with its State code;
//   - the tax summary prints each head with its own rate and amount (CGST and SGST for an intra-state supply, IGST otherwise);
//   - "How to pay" sits beside the total, in the system's one call-to-action box (an ink outline with the mark's 45° cut, as the proposal's
//     acceptance box), with the signatory under the total; the tax summary and the notes follow as the detail.
//
// Rule 46 (docs/08-research-appendix/A §3; VERIFY WITH CA/LEGAL), every field the view carries is printed:
//   (a) supplier name, address, GSTIN (and principal place)   (b) number   (c) date   (d) recipient name, address, GSTIN when registered
//   (e) recipient State name and code   (g) SAC   (h) description   quantity and unit   (j) value and discount   (k) taxable value
//   (l) rate and (m) amount per head (the tax summary)   (n) place of supply with its State   (p) the reverse-charge statement exactly as frozen
//   (q) the signatory, with the signature image only when set and verified   Rule 48(2): the copy mark.   Also the due date, the amount in
//   words, the INR bank block when the invoice froze one, and the notes pinned at issue.
//
// No logic beyond formatting: every value is a pre-formatted string of the view. Every dynamic string goes through `esc`; Markdown through
// `markdownBlocks`. Data-testids (the tests and the visual suite rely on them): `rupee`, `currency-symbol`, `total`, `integrity`,
// `reverse-charge`, `copy-label`, `signature`, `signatory`.
import { esc } from "../escape.ts";
import { PDF_LOGOS } from "../generated/assets.ts";
import type { InvoiceView, InvoiceViewBank } from "../invoice-types.ts";
import { markdownBlocks } from "../markdown-html.ts";
import { INVOICE_PDF_COPY as C } from "./copy.ts";

const RUPEE = "₹";

const p = (cls: string, text: string, attrs = "") => `<p class="${cls}"${attrs}>${esc(text)}</p>`;

/**
 * A block line whose parts are joined by " · " (e.g. "GSTIN … · State …") breaks only between the parts, and the separator is dropped there: the
 * party column is narrow, so a wrapped line would leave " ·" dangling at its end (re-check). Each part stays whole on its own line.
 */
const partsLine = (cls: string, text: string) =>
  !text.includes(" · ")
    ? p(cls, text)
    : `<p class="${cls}">${text
        .split(" · ")
        .map((part) => `<span class="keep">${esc(part)}</span>`)
        .join("<br>")}</p>`;

function logoHtml(view: InvoiceView): string {
  const logos = PDF_LOGOS as Record<string, string | undefined>;
  const svg = logos[view.logo] ?? logos["logo-primary-color.svg"] ?? "";
  return `<div class="masthead__logo">${svg}</div>`;
}

/** A formatted amount with its currency sign in its own span (the visual suite asks the font of that glyph). */
function amountHtml(value: string, testid: string): string {
  const sign = value.includes(RUPEE) ? RUPEE : value.includes("$") ? "$" : null;
  if (sign === null) return esc(value);
  const at = value.indexOf(sign);
  return `${esc(value.slice(0, at))}<span data-testid="${testid}">${sign}</span>${esc(value.slice(at + 1))}`;
}

const intra = (view: InvoiceView) => view.supplyType === "intra";

/** "West Bengal (19)" as its State name and code, for the two header facts; anything else stays whole, with no code. */
export function splitPlaceOfSupply(label: string): { name: string; code: string | null } {
  const m = /^(.+) \((\d{2})\)$/.exec(label);
  return m ? { name: m[1] as string, code: m[2] as string } : { name: label, code: null };
}

// ---- header -------------------------------------------------------------------------------------------------------------------------

function masthead(view: InvoiceView): string {
  return `<header class="masthead">${logoHtml(view)}<div class="inv-heading"><h1 class="masthead__title">${C.title}</h1>${p(
    "inv-copy",
    view.copyLabel,
    ' data-testid="copy-label"',
  )}</div></header>`;
}

const fact = (term: string, value: string, cls = "") =>
  `<div${cls ? ` class="${cls}"` : ""}><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`;

function parties(view: InvoiceView): string {
  const P = C.parties;
  const from = `<div class="party"><p class="label">${P.from}</p>${p("party__name", view.supplier.name)}${view.supplier.lines
    .map((l) => partsLine("party__line", l))
    .join("")}</div>`;

  const r = view.recipient;
  const ids = [r.gstin ? fact(P.gstin, r.gstin) : "", r.state ? fact(P.state, r.state) : ""].join("");
  const to = `<div class="party"><p class="label">${P.billedTo}</p>${p("party__name", r.name)}${r.lines
    .map((l) => partsLine("party__line", l))
    .join(
      "",
    )}${ids ? `<dl class="inv-ids">${ids}</dl>` : ""}${r.attention ? p("party__line party__attention", r.attention) : ""}</div>`;

  const H = C.header;
  const pos = splitPlaceOfSupply(view.placeOfSupply);
  const doc = `<div class="party party--doc inv-doc"><p class="label">${H.number}</p><p class="inv-number">${esc(view.numberDisplay)}</p><dl class="facts inv-facts">${fact(
    H.date,
    view.issueDate,
  )}${fact(H.dueDate, view.dueDate)}${fact(H.placeOfSupply, pos.name, "wrap")}${pos.code ? fact(H.stateCode, pos.code) : ""}</dl></div>`;
  return `<section class="parties" aria-label="${esc(C.title)}">${from}${to}${doc}</section>`;
}

// ---- the money ----------------------------------------------------------------------------------------------------------------------

function itemsTable(view: InvoiceView): string {
  const L = C.lines;
  // The discount column is printed only when a line has one (an empty column would only take width from the description).
  const withDiscount = view.lines.some((l) => l.discount !== null);
  const rows = view.lines
    .map(
      (l) =>
        `<tr><td class="c-n num">${esc(l.n)}</td><td class="c-desc"><span class="desc">${esc(l.description)}</span>${
          l.detail ? `<span class="sub">${esc(l.detail)}</span>` : ""
        }</td><td class="c-sac">${l.sac ? esc(l.sac) : ""}</td><td class="num">${esc(l.qty)} <span class="unit">${esc(l.unit)}</span></td><td class="num">${esc(l.rate)}</td>${
          withDiscount ? `<td class="num">${l.discount ? esc(l.discount) : ""}</td>` : ""
        }<td class="num">${esc(l.taxable)}</td></tr>`,
    )
    .join("");
  const th = (cls: string, text: string) => `<th scope="col" class="${cls}">${text}</th>`;
  const head = [
    th("c-n", L.n),
    th("c-desc", L.description),
    th("c-sac", L.sac),
    th("num c-qty", L.qty),
    th("num c-rate", L.rate),
    withDiscount ? th("num c-disc", L.discount) : "",
    th("num c-taxable", L.taxable),
  ].join("");
  return `<table class="grid items inv-items"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function totalsBlock(view: InvoiceView): string {
  const rows = view.totals
    .map((t) =>
      t.strong
        ? `<tr class="grand"><th scope="row">${esc(t.label)}</th><td class="num" data-testid="total">${amountHtml(
            t.value,
            view.currency === "INR" ? "rupee" : "currency-symbol",
          )}</td></tr>`
        : `<tr><th scope="row">${esc(t.label)}</th><td class="num">${esc(t.value)}</td></tr>`,
    )
    .join("");
  const due = `<tr class="due"><th scope="row">${esc(C.balanceDue)}</th><td class="num" data-testid="balance-due">${esc(view.balanceDue)}</td></tr>`;
  // Beside the total: the amount in words, the reverse-charge statement as frozen, then how to pay it (the eye goes from the total to the box);
  // under the total, level with the foot of the box, the signatory.
  const notes = `${p("words", C.words(view.words))}${p("inv-rc", view.reverseCharge, ' data-testid="reverse-charge"')}${payBox(view)}`;
  return `<div class="totals inv-totals"><div class="totals__notes">${notes}</div><div class="inv-side"><table class="totals__table">${rows}${due}</table>${signatory(
    view,
  )}</div></div>`;
}

function summaryTable(view: InvoiceView): string {
  if (view.summary.length === 0) return "";
  const S = C.summary;
  const heads = intra(view) ? [S.cgst, S.sgst] : [S.igst];
  const keys = intra(view) ? (["cgst", "sgst"] as const) : (["igst"] as const);
  const group = heads.map((h) => `<th scope="colgroup" colspan="2" class="inv-head">${h}</th>`).join("");
  const sub = heads
    .map(
      () =>
        `<th scope="col" class="num c-hrate">${S.rate}</th><th scope="col" class="num c-hamt">${S.amount}</th>`,
    )
    .join("");
  const cell = (v: string | null) => `<td class="num">${v === null ? "" : esc(v)}</td>`;
  const rows = view.summary
    .map(
      (r) =>
        `<tr><td class="c-sac">${r.sac ? esc(r.sac) : ""}</td><td class="num">${esc(r.taxable)}</td>${keys
          .map((k) => `${cell(r.headRates[k])}${cell(r.headAmounts[k])}`)
          .join("")}</tr>`,
    )
    .join("");
  const cols = `<colgroup><col class="c-sac"><col class="c-staxable">${keys.map(() => '<col class="c-hrate"><col class="c-hamt">').join("")}</colgroup>`;
  return `<div class="block inv-summary-block"><h3>${S.heading}</h3><table class="grid summary inv-summary inv-summary--${
    intra(view) ? "intra" : "inter"
  }">${cols}<thead><tr class="inv-group"><th scope="col" rowspan="2" class="c-sac">${S.sac}</th><th scope="col" rowspan="2" class="num">${
    S.taxable
  }</th>${group}</tr><tr>${sub}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---- paying and signing -------------------------------------------------------------------------------------------------------------

/** The frozen bank block under 07-R's labels: "Bank" and "Branch" print together as "Bank and branch"; a label 07-R has no word for stays as the view gave it. */
export function bankRows(bank: InvoiceViewBank): { label: string; value: string }[] {
  const P = C.payment;
  const value = (label: string) => bank.find((b) => b.label === label)?.value ?? null;
  const rename: Record<string, string> = {
    "Account name": P.accountName,
    "Account number": P.accountNumber,
    IFSC: P.ifsc,
  };
  const out: { label: string; value: string }[] = [];
  let bankDone = false;
  for (const b of bank) {
    if (b.label === "Bank" || b.label === "Branch") {
      if (bankDone) continue;
      bankDone = true;
      const joined = [value("Bank"), value("Branch")]
        .filter((v): v is string => v !== null && v !== "")
        .join(", ");
      if (joined) out.push({ label: P.bankAndBranch, value: joined });
      continue;
    }
    out.push({ label: rename[b.label] ?? b.label, value: b.value });
  }
  return out;
}

function payBox(view: InvoiceView): string {
  const P = C.payment;
  const portal = view.portalLink;
  const bank = view.bank
    ? `${p("inv-pay__intro", P.bank)}<dl class="inv-bank">${bankRows(view.bank)
        .map((b) => `<div><dt>${esc(b.label)}</dt><dd>${esc(b.value)}</dd></div>`)
        .join("")}</dl>`
    : "";
  return `<div class="accept inv-pay"><h3>${P.heading}</h3>${bank}${p("inv-pay__ref", P.reference(view.numberDisplay))}${
    portal
      ? `<p class="inv-pay__portal">${esc(P.portal(""))}<span class="accept__link">${esc(portal)}</span></p>`
      : ""
  }</div>`;
}

function signatory(view: InvoiceView): string {
  const S = C.signature;
  const legal = view.supplier.legalName;
  const name = legal && legal.trim() !== "" ? legal : view.supplier.name;
  const image = view.signature
    ? `<img data-testid="signature" class="inv-sign__img" alt="" src="${esc(view.signature.dataUri)}">`
    : `<div class="inv-sign__space"></div>`;
  return `<div class="inv-sign">${p("inv-sign__for", S.for(name))}${image}${p("inv-sign__role", S.signatory, ' data-testid="signatory"')}</div>`;
}

function notesBlock(view: InvoiceView): string {
  if (!view.notes) return "";
  return `<div class="block inv-notes"><h3>${esc(view.notes.title)}</h3><div class="terms">${markdownBlocks(view.notes.bodyMd).join("")}</div></div>`;
}

/** The body of a tax invoice (inside `<body>`). */
export function taxInvoiceBody(view: InvoiceView): string {
  return `<div class="doc doc--invoice doc--tax-invoice">${masthead(view)}
${parties(view)}
<div class="money">${itemsTable(view)}${totalsBlock(view)}${summaryTable(view)}</div>
${notesBlock(view)}
<p class="integrity" data-testid="integrity">${esc(view.integrity)}</p></div>`;
}

/**
 * What the tax invoice adds to the shared template CSS (./styles.ts), all under `.doc--tax-invoice`. Sizes, colours and fonts are the print
 * tokens; the lengths are column widths and spacing on the 178 mm text width. Bold is 600 (the fonts stop there).
 */
export const TAX_INVOICE_CSS = `
.doc--tax-invoice { font-size: var(--print-body); line-height: var(--print-body-leading); }

/* the title and its Rule 48(2) copy mark, right-aligned over the rule */
.doc--tax-invoice .inv-heading { text-align: right; }
.doc--tax-invoice .inv-copy {
  margin: 2mm 0 0;
  font-size: var(--print-small);
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--color-text);
}

/* the third header block: the number first and largest, then the facts */
.doc--tax-invoice .inv-number {
  margin: 0 0 2.4mm;
  font-size: var(--print-totals);
  line-height: 1.15;
  font-weight: 600;
  font-variant-numeric: tabular-nums lining-nums;
  white-space: nowrap;
  letter-spacing: 0.01em;
}
.doc--tax-invoice .inv-facts .wrap dd { white-space: normal; overflow-wrap: anywhere; }

/* the client's GSTIN and State, as label and value under the address */
.doc--tax-invoice .inv-ids { margin: 1.6mm 0 0; display: grid; grid-template-columns: auto 1fr; column-gap: 2.4mm; row-gap: 0.4mm; }
.doc--tax-invoice .inv-ids div { display: contents; }
.doc--tax-invoice .inv-ids dt { color: var(--color-text-muted); }
.doc--tax-invoice .inv-ids dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums lining-nums; }

.doc--tax-invoice .parties { padding-bottom: 4mm; }
.doc--tax-invoice .money { margin-top: 4mm; }
.doc--tax-invoice .inv-summary-block { margin-top: 5mm; }

/* lines: # · Description · SAC · Qty (with its unit) · Rate · Discount · Taxable value */
.doc--tax-invoice .inv-items .c-sac { width: 13mm; font-variant-numeric: tabular-nums lining-nums; }
.doc--tax-invoice .inv-items .c-qty { width: 18mm; }
.doc--tax-invoice .inv-items .c-rate { width: 22mm; }
.doc--tax-invoice .inv-items .c-disc { width: 15mm; }
.doc--tax-invoice .inv-items .c-taxable { width: 25mm; }
.doc--tax-invoice .inv-items .unit { font-size: var(--print-small); color: var(--color-text-muted); }

.doc--tax-invoice .totals { break-before: avoid; align-items: start; }
.doc--tax-invoice .totals__notes .inv-rc { margin: 0; font-weight: 500; }

/* the tax summary: each head over its own rate and amount */
.doc--tax-invoice .inv-summary col.c-sac { width: auto; }
.doc--tax-invoice .inv-summary col.c-staxable { width: 30mm; }
.doc--tax-invoice .inv-summary col.c-hrate { width: 15mm; }
.doc--tax-invoice .inv-summary col.c-hamt { width: 28mm; }
.doc--tax-invoice .inv-summary thead .inv-group th { border-bottom: 0.2mm solid var(--color-border); padding-bottom: 1mm; }
.doc--tax-invoice .inv-summary thead .inv-group th[rowspan] { border-bottom: 0.3mm solid var(--color-text); }
.doc--tax-invoice .inv-summary thead th.inv-head { color: var(--color-text); text-align: center; }
.doc--tax-invoice .inv-summary thead tr + tr th { padding-top: 1mm; }

/* paying: the call-to-action box under the words, beside the totals */
.doc--tax-invoice .inv-pay { margin: 4mm 0 0; padding-right: 9mm; font-size: var(--print-table); line-height: 1.4; }
.doc--tax-invoice .inv-pay h3 { font-size: var(--print-body); line-height: var(--print-body-leading); font-weight: 600; margin: 0 0 1.6mm; }
.doc--tax-invoice .inv-pay p { text-wrap: wrap; }
.doc--tax-invoice .inv-pay__intro { margin: 0 0 1mm; }
.doc--tax-invoice .inv-bank { margin: 0 0 2.4mm; display: grid; grid-template-columns: auto 1fr; column-gap: 4mm; row-gap: 0.4mm; }
.doc--tax-invoice .inv-bank div { display: contents; }
.doc--tax-invoice .inv-bank dt { color: var(--color-text-muted); }
.doc--tax-invoice .inv-bank dd { margin: 0; font-weight: 500; overflow-wrap: anywhere; font-variant-numeric: tabular-nums lining-nums; }
.doc--tax-invoice .inv-pay__ref { margin: 0; font-weight: 600; }
.doc--tax-invoice .inv-pay__portal { margin: 1mm 0 0; }

/* under the total, level with the foot of the box: the signatory */
.doc--tax-invoice .inv-side { grid-column: 8 / -1; align-self: stretch; display: flex; flex-direction: column; gap: 8mm; }
.doc--tax-invoice .inv-side .totals__table { grid-column: auto; }
.doc--tax-invoice .inv-notes { break-inside: auto; }
.doc--tax-invoice .inv-notes h3 { margin: 0 0 1.6mm; }
.doc--tax-invoice .inv-notes .terms { max-width: 132mm; }
.doc--tax-invoice .inv-sign { margin-top: auto; text-align: right; font-size: var(--print-table); line-height: 1.4; }
.doc--tax-invoice .inv-sign__for { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.doc--tax-invoice .inv-sign__img { display: block; margin: 2mm 0 1.6mm auto; max-height: 16mm; max-width: 52mm; }
.doc--tax-invoice .inv-sign__space { height: 14mm; }
.doc--tax-invoice .inv-sign__role { margin: 0 0 0 auto; max-width: 52mm; padding-top: 1.2mm; border-top: 0.2mm solid var(--color-text); color: var(--color-text-muted); }

`;
