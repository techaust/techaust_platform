// The invoice layout (M5.1 phase 2 for the tax invoice; M5.2 adds the export invoice, the proforma and the invoice issued for a payment received;
// docs/06 §7.1 to §7.3, §7.5; wording 07-R §6 and 07-S §1, §2, §8 in ./copy.ts). The same system as the proposal and estimate layout (./document.ts,
// ./styles.ts): the 12-column A4 page, the shared header (logo, title, the verdigris rule, then three blocks), the money across all twelve columns, ink
// on white. What is the invoice's own:
//   - the title carries its Rule 48(2) copy mark ("ORIGINAL FOR RECIPIENT") under it, as 06 §7.2 draws it (a proforma has none: it is no tax invoice);
//   - the third header block is the invoice's identity: the number set larger than anything else in the header (an invoice is known by its
//     number), then the dates and the place of supply with its State code;
//   - the statutory line of an export invoice (the Rule 46 endorsement) and of a proforma (its notice) sits right under the title, across the page, in
//     the one band the layout has: an ink bar on its left, the line in semibold. It is printed as ONE text node, exactly as frozen (LD33: the jobs
//     Worker refuses a page without it); the LUT line and the extra export note follow it inside the band;
//   - the tax summary prints each head with its own rate and amount (CGST and SGST for an intra-state supply, IGST otherwise);
//   - "How to pay" sits beside the total, in the system's one call-to-action box (an ink outline with the mark's 45° cut, as the proposal's
//     acceptance box), with the signatory under the total; the tax summary and the notes follow as the detail. A USD invoice's INR values sit under
//     its total (the eye reads the amount, then what it is in rupees), and its box holds the SWIFT details.
//   - an invoice issued for a payment received is already paid: it says against which proforma and when the money arrived, and prints neither a
//     balance due nor how to pay.
//   - M5.3: a credit or debit note is this same page (07-T §1). Its band holds the reason (Rule 53(1A): the nature of the correction) and, on an
//     export note, the LUT line; the identity block says which invoice it corrects, the invoice's number in a `<dd>` of its own (ONE text node:
//     LD54, the jobs Worker refuses a page without it), then that invoice's date; each line says the invoice line it is against; the total is
//     "Total credited" or "Total added" and the effect sentence sits beside it, where an invoice says how to pay. A credit note owes nothing: no due
//     date, no balance and no bank block. A debit note is paid like an invoice: due date, balance due, how to pay. A USD note prints the rate of
//     its invoice.
//
// Rule 46 (docs/08-research-appendix/A §3, §8; Researched 2026-10-28, Rule 46 CGST Rules (08-C RA-05)), every field the view carries is printed:
//   (a) supplier name, address, GSTIN (and principal place)   (b) number   (c) date   (d) recipient name, address, GSTIN when registered
//   (e) recipient State name and code   (g) SAC   (h) description   quantity and unit   (j) value and discount   (k) taxable value
//   (l) rate and (m) amount per head (the tax summary)   (n) place of supply with its State   (o) the address of delivery when it differs
//   (p) the reverse-charge statement exactly as frozen   (q) the signatory, with the signature image only when set and verified   Rule 48(2): the
//   copy mark.   Exports: the endorsement as frozen, the LUT, the country of destination, the INR values with the rate, its date and source.
//   Also the due date (a proforma's "Valid until"), the amount in words, the bank block the invoice froze, and the notes pinned at issue.
//
// No logic beyond formatting: every value is a pre-formatted string of the view. Every dynamic string goes through `esc`; Markdown through
// `markdownBlocks`. Data-testids (the tests and the visual suite rely on them): `rupee`, `currency-symbol`, `total`, `integrity`,
// `reverse-charge`, `copy-label`, `signature`, `signatory`, `endorsement`, `notice`, `lut`, `export-note`, `advance`, `inr`, `balance-due`.
import { isStateCode, STATE_CODES } from "@techaust/core/gstin";
import { esc } from "../escape.ts";
import { PDF_LOGOS } from "../generated/assets.ts";
import type { InvoiceView, InvoiceViewBank, InvoiceViewSwift } from "../invoice-types.ts";
import { EXPORT_PLACE_OF_SUPPLY } from "../invoice-view.ts";
import { markdownBlocks } from "../markdown-html.ts";
import {
  advanceLine,
  INVOICE_PDF_COPY as C,
  EXPORT_PDF_COPY as E,
  NOTE_PDF_COPY as N,
  PROFORMA_PDF_COPY as P,
} from "./copy.ts";

const RUPEE = "₹";

/** The invoice-family types this layout prints (every one since M5.3: the skeleton is left for an unknown type only). */
export const DESIGNED_INVOICE_TYPES: readonly string[] = [
  "tax_invoice",
  "export_invoice",
  "proforma",
  "credit_note",
  "debit_note",
];

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
const isProforma = (view: InvoiceView) => view.type === "proforma";
/** Paid at issue (the invoice for a payment received, Q9): nothing is left to pay. */
const isPaid = (view: InvoiceView) => view.advance !== null;
/** M5.3: a credit note owes nothing (its balance is 0, it has no due date and no bank block); a debit note is its own payable. */
const isCredit = (view: InvoiceView) => view.note?.kind === "credit";
/** Nothing is asked of the client: no balance row, no "How to pay". */
const owesNothing = (view: InvoiceView) => isPaid(view) || isCredit(view);

/** The document's title (07-R §6, 07-S §1, §2). */
export function titleOf(view: InvoiceView): string {
  if (view.note) return N[view.note.kind].title;
  if (view.type === "export_invoice") return E.title;
  if (isProforma(view)) return P.title;
  return C.title;
}

/**
 * "West Bengal (19)" as its State name and code, for the two header facts. Only a real State or Union territory code splits (core
 * `isStateCode`, never 97 "Other Territory" and never 96, which is no State: an overseas proforma prints "Outside India (96)" whole, as 07-S §1
 * and every export invoice do); anything else stays whole, with no code.
 */
export function splitPlaceOfSupply(label: string): { name: string; code: string | null } {
  const m = /^(.+) \((\d{2})\)$/.exec(label);
  const code = m?.[2];
  if (!m || code === undefined || !isStateCode(code) || STATE_CODES[code].kind === "other")
    return { name: label, code: null };
  return { name: m[1] as string, code };
}

// ---- header -------------------------------------------------------------------------------------------------------------------------

function masthead(view: InvoiceView): string {
  // The copy mark only when the view sets one (a proforma has none): no empty paragraph.
  const copy = view.copyLabel ? p("inv-copy", view.copyLabel, ' data-testid="copy-label"') : "";
  return `<header class="masthead">${logoHtml(view)}<div class="inv-heading"><h1 class="masthead__title">${esc(
    titleOf(view),
  )}</h1>${copy}</div></header>`;
}

/**
 * The statutory band under the title: an export invoice's endorsement (then its LUT line and the extra export note), a proforma's notice. The
 * endorsement and the notice are each ONE text node, the frozen text escaped and nothing else (LD33). Empty for a tax invoice.
 */
function statutoryBand(view: InvoiceView): string {
  const x = view.export;
  if (x) {
    const lut = x.lut ? p("inv-band__sub", E.lut(x.lut.arn, x.lut.fyLabel), ' data-testid="lut"') : "";
    const note =
      x.declaration && x.declaration.text.trim() !== ""
        ? `<div class="inv-band__note" data-testid="export-note">${markdownBlocks(x.declaration.text).join("")}</div>`
        : "";
    return `<section class="inv-band" aria-label="${esc(E.title)}">${p(
      "inv-band__line",
      x.endorsement,
      ' data-testid="endorsement"',
    )}${lut}${note}</section>`;
  }
  if (view.proforma)
    return `<section class="inv-band" aria-label="${esc(P.title)}">${p(
      "inv-band__line",
      view.proforma.notice,
      ' data-testid="notice"',
    )}</section>`;
  if (view.note) return noteBand(view.note);
  return "";
}

/**
 * A note's band: the reason (07-T §1 "Reason: {reason}"). "Other" is the words typed for it; any other reason is its label, with the words typed
 * after it on a line of their own when there are some. An export note under LUT carries its invoice's LUT line after it (Researched 2026-10-28, Rule 96A CGST Rules (08-C RA-19)).
 */
function noteBand(note: NonNullable<InvoiceView["note"]>): string {
  const typed = note.reason.text.trim();
  const other = note.reason.code === "other" && typed !== "";
  const reason = p("inv-band__line", N.reason(other ? typed : note.reason.label), ' data-testid="reason"');
  const detail = !other && typed !== "" ? p("inv-band__sub inv-band__reason", typed) : "";
  const lut =
    note.route?.mode === "lut" && note.route.lut
      ? p("inv-band__sub", E.lut(note.route.lut.arn, note.route.lut.fyLabel), ' data-testid="lut"')
      : "";
  return `<section class="inv-band" aria-label="${esc(note.title)}">${reason}${detail}${lut}</section>`;
}

/** The invoice issued for a payment received: against which proforma, and when the money arrived (07-S §8). */
function advanceHtml(view: InvoiceView): string {
  const a = view.advance;
  if (!a) return "";
  return p(
    "inv-advance",
    advanceLine(a.proformaNumber, a.proformaDate, a.receivedOn, a.igstNoLutFy),
    ' data-testid="advance"',
  );
}

/**
 * The supplier's lines, with the Udyam line (07-ZC line 6, T10) right under the "GSTIN … · State …" line: ONE text node in its own paragraph, never split
 * into parts (the jobs gate `missingStatutoryLine` refuses the PDF otherwise). A view without a registration line puts it after the last line. Shared with the
 * skeleton, so both layouts print it the same way.
 */
export function supplierLinesHtml(view: InvoiceView, line: (text: string) => string): string {
  const { lines, registrationAt, udyam } = view.supplier;
  const out = lines.map(line);
  if (udyam !== null) {
    const at = registrationAt >= 0 && registrationAt < lines.length ? registrationAt + 1 : lines.length;
    out.splice(at, 0, p("party__line inv-udyam", udyam, ' data-testid="udyam"'));
  }
  return out.join("");
}

const fact = (term: string, value: string, cls = "") =>
  `<div${cls ? ` class="${cls}"` : ""}><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`;

function parties(view: InvoiceView): string {
  const R = C.parties;
  const from = `<div class="party"><p class="label">${R.from}</p>${p("party__name", view.supplier.name)}${supplierLinesHtml(
    view,
    (l) => partsLine("party__line", l),
  )}</div>`;

  const r = view.recipient;
  const ids = [r.gstin ? fact(R.gstin, r.gstin) : "", r.state ? fact(R.state, r.state) : ""].join("");
  const delivery = view.export?.deliveryAddress;
  const deliveryHtml =
    delivery && delivery.length > 0
      ? `<div class="inv-delivery"><p class="label">${E.addressOfDelivery}</p>${delivery
          .map((l) => p("party__line", l))
          .join("")}</div>`
      : "";
  const to = `<div class="party"><p class="label">${R.billedTo}</p>${p("party__name", r.name)}${r.lines
    .map((l) => partsLine("party__line", l))
    .join(
      "",
    )}${ids ? `<dl class="inv-ids">${ids}</dl>` : ""}${r.attention ? p("party__line party__attention", r.attention) : ""}${deliveryHtml}</div>`;

  return `<section class="parties" aria-label="${esc(titleOf(view))}">${from}${to}${docBlock(view)}</section>`;
}

/** The third header block: the number first and largest, then the dates and where the supply is. */
function docBlock(view: InvoiceView): string {
  const H = C.header;
  const pro = view.proforma;
  const note = view.note;
  const numberLabel = note ? N[note.kind].number : pro ? P.header.number : H.number;
  // A note says which invoice it corrects: the invoice's number is the whole of its `<dd>` (one text node, LD54), then that invoice's date. A
  // credit note has no due date (nothing is owed on it); a debit note is due like an invoice.
  const dates = note
    ? `${fact(N.header.date, view.issueDate)}<div><dt>${N.header.againstInvoice}</dt><dd data-testid="parent-number">${esc(
        note.parent.number,
      )}</dd></div>${fact(N.header.invoiceDate, note.parent.date)}${
        note.kind === "debit" && view.dueDate !== "" ? fact(H.dueDate, view.dueDate) : ""
      }`
    : pro
      ? `${fact(P.header.date, view.issueDate)}${fact(P.header.validUntil, pro.validUntil)}`
      : `${fact(H.date, view.issueDate)}${fact(H.dueDate, view.dueDate)}`;
  let place: string;
  if (view.export) {
    // "Outside India (96)" stays whole (07-S §1), and the country of destination follows it.
    place = `${fact(E.placeOfSupply, view.export.placeOfSupply, "wrap")}${fact(
      E.countryOfDestination,
      view.export.countryName,
      "wrap",
    )}`;
  } else if (view.note?.route) {
    // A note on an export invoice says what its invoice says (07-S §1: "Outside India (96)", whole); the country stays on the invoice.
    place = fact(E.placeOfSupply, EXPORT_PLACE_OF_SUPPLY, "wrap");
  } else {
    const pos = splitPlaceOfSupply(view.placeOfSupply);
    place = `${fact(H.placeOfSupply, pos.name, "wrap")}${pos.code ? fact(H.stateCode, pos.code) : ""}`;
  }
  return `<div class="party party--doc inv-doc"><p class="label">${numberLabel}</p><p class="inv-number">${esc(
    view.numberDisplay,
  )}</p><dl class="facts inv-facts">${dates}${place}</dl></div>`;
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
        }${l.againstLine !== undefined ? `<span class="sub inv-against">${esc(N.againstLine(l.againstLine))}</span>` : ""}</td><td class="c-sac">${l.sac ? esc(l.sac) : ""}</td><td class="num">${esc(l.qty)} <span class="unit">${esc(l.unit)}</span></td><td class="num">${esc(l.rate)}</td>${
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

/** The tax head keys of the totals rows. */
const HEAD_KEYS: readonly string[] = ["cgst", "sgst", "igst"];

/**
 * A tax head's label: "CGST (estimate)" on a proforma sealed with the estimate marker (FX-4, A5 5; Researched 2026-10-28, s.31 CGST Act, Rule 46
 * (08-C RA-28)), else the head as it is. A proforma sealed before FX-4 has no marker and prints exactly as it did.
 */
function headLabel(view: InvoiceView, head: string): string {
  return view.proforma?.gstEstimate ? P.estimate(head) : head;
}

function totalsBlock(view: InvoiceView): string {
  const rows = view.totals
    .map((row) => (HEAD_KEYS.includes(row.key) ? { ...row, label: headLabel(view, row.label) } : row))
    .map((t) =>
      t.strong
        ? `<tr class="grand"><th scope="row">${esc(t.label)}</th><td class="num" data-testid="total">${amountHtml(
            t.value,
            view.currency === "INR" ? "rupee" : "currency-symbol",
          )}</td></tr>`
        : `<tr><th scope="row">${esc(t.label)}</th><td class="num">${esc(t.value)}</td></tr>`,
    )
    .join("");
  // Paid at issue (Q9), or a credit note: no balance is due, so the row is left out rather than printing the total as owed.
  const due = owesNothing(view)
    ? ""
    : `<tr class="due"><th scope="row">${esc(C.balanceDue)}</th><td class="num" data-testid="balance-due">${esc(view.balanceDue)}</td></tr>`;
  // Beside the total: the amount in words, the reverse-charge statement as frozen, then how to pay it (the eye goes from the total to the box);
  // under the total its INR values (a USD invoice), then, level with the foot of the box, the signatory.
  // A note's effect on its invoice comes first beside its total (07-T §1), then what an invoice prints there.
  const effect = view.note
    ? p(
        "inv-effect",
        N[view.note.kind].effect(view.note.effect.parentNumber, view.note.effect.total),
        ' data-testid="effect"',
      )
    : "";
  const notes = `${effect}${p("words", C.words(view.words))}${p("inv-rc", view.reverseCharge, ' data-testid="reverse-charge"')}${
    owesNothing(view) ? "" : payBox(view)
  }`;
  return `<div class="totals inv-totals"><div class="totals__notes">${notes}</div><div class="inv-side"><table class="totals__table">${rows}${due}</table>${inrBlock(
    view,
  )}${signatory(view)}</div></div>`;
}

/** The INR values of a USD invoice (07-S §1): the rate with its source and date, the taxable value and, on the IGST route only, the IGST. */
function inrBlock(view: InvoiceView): string {
  const i = view.inr;
  if (!i) return "";
  // A note is at its invoice's rate, and says so (07-T §1, §8); an invoice names the rate's source and date (07-S §1).
  const rate = view.note?.fx
    ? N.rate(view.note.fx.rate, view.note.fx.parentNumber)
    : E.inr.rate(i.rate, i.source, i.date);
  const at = rate.indexOf(RUPEE);
  // The first rupee sign of the block in its own span, so the visual suite can ask its font on a USD invoice too.
  const rateHtml = `${esc(rate.slice(0, at))}<span data-testid="rupee">${RUPEE}</span>${esc(rate.slice(at + 1))}`;
  const row = (label: string, value: string) =>
    `<tr><th scope="row">${esc(label)}</th><td class="num">${esc(value)}</td></tr>`;
  return `<div class="inv-inr" data-testid="inr"><h3>${E.inr.heading}</h3><p class="inv-inr__rate">${rateHtml}</p><table class="totals__table inv-inr__table">${row(
    E.inr.taxable,
    i.taxable,
  )}${i.igst !== null ? row(E.inr.igst, i.igst) : ""}</table></div>`;
}

function summaryTable(view: InvoiceView): string {
  if (view.summary.length === 0) return "";
  const S = C.summary;
  const heads = (intra(view) ? [S.cgst, S.sgst] : [S.igst]).map((h) => headLabel(view, h));
  const keys = intra(view) ? (["cgst", "sgst"] as const) : (["igst"] as const);
  const group = heads.map((h) => `<th scope="colgroup" colspan="2" class="inv-head">${esc(h)}</th>`).join("");
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
  const B = C.payment;
  const value = (label: string) => bank.find((b) => b.label === label)?.value ?? null;
  const rename: Record<string, string> = {
    "Account name": B.accountName,
    "Account number": B.accountNumber,
    IFSC: B.ifsc,
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
      if (joined) out.push({ label: B.bankAndBranch, value: joined });
      continue;
    }
    out.push({ label: rename[b.label] ?? b.label, value: b.value });
  }
  return out;
}

/** The frozen SWIFT details under 07-S §1's labels, in the order a bank's wire form asks for them; an empty value is left out. */
export function swiftRows(s: InvoiceViewSwift): { label: string; value: string }[] {
  const W = E.payment;
  return [
    { label: W.beneficiary, value: s.beneficiary },
    { label: W.accountNumber, value: s.accountNo },
    { label: W.swiftBic, value: s.swift },
    { label: W.bankAndBranch, value: s.bank },
    { label: W.bankAddress, value: s.bankAddress ?? "" },
    { label: W.intermediary, value: s.intermediary ?? "" },
  ].filter((r) => r.value.trim() !== "");
}

const rowsDl = (rows: { label: string; value: string }[]) =>
  `<dl class="inv-bank">${rows.map((b) => `<div><dt>${esc(b.label)}</dt><dd>${esc(b.value)}</dd></div>`).join("")}</dl>`;

function payBox(view: InvoiceView): string {
  const B = C.payment;
  const portal = view.portalLink;
  let bank = "";
  if (view.swift) {
    bank = `${p("inv-pay__intro", E.payment.swift)}${rowsDl(swiftRows(view.swift))}${
      view.swift.purposeCode ? p("inv-pay__purpose", E.payment.purposeCode(view.swift.purposeCode)) : ""
    }`;
  } else if (view.bank) bank = `${p("inv-pay__intro", B.bank)}${rowsDl(bankRows(view.bank))}`;
  return `<div class="accept inv-pay"><h3>${B.heading}</h3>${bank}${p("inv-pay__ref", B.reference(view.numberDisplay))}${
    portal
      ? `<p class="inv-pay__portal">${esc(B.portal(""))}<span class="accept__link">${esc(portal)}</span></p>`
      : ""
  }</div>`;
}

function signatory(view: InvoiceView): string {
  if (!view.showSignatory) return "";
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

/** The modifier class of the document (the base class `doc--tax-invoice` carries the whole designed invoice system). */
const modifierOf = (view: InvoiceView) =>
  view.note
    ? ` doc--note doc--${view.note.kind}-note`
    : view.type === "export_invoice"
      ? " doc--export-invoice"
      : isProforma(view)
        ? " doc--proforma"
        : "";

/** The body of a tax invoice, an export invoice, a proforma, a credit note or a debit note (inside `<body>`). */
export function taxInvoiceBody(view: InvoiceView): string {
  return `<div class="doc doc--invoice doc--tax-invoice${modifierOf(view)}">${masthead(view)}
${statutoryBand(view)}${advanceHtml(view)}
${parties(view)}
<div class="money">${itemsTable(view)}${totalsBlock(view)}${summaryTable(view)}</div>
${notesBlock(view)}
<p class="integrity" data-testid="integrity">${esc(view.integrity)}</p></div>`;
}

/**
 * What the invoice layout adds to the shared template CSS (./styles.ts), all under `.doc--tax-invoice` (the class every designed invoice carries).
 * Sizes, colours and fonts are the print tokens; the lengths are column widths and spacing on the 178 mm text width. Bold is 600 (the fonts stop there).
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

/* the statutory band under the title (an export's endorsement, a proforma's notice): an ink bar, the line in semibold, the LUT and the note after it */
.doc--tax-invoice .inv-band {
  margin: 0 0 5mm;
  padding: 0.6mm 0 0.6mm 3.4mm;
  border-left: 0.8mm solid var(--color-text);
  break-inside: avoid;
}
.doc--tax-invoice .inv-band__line {
  margin: 0;
  max-width: 150mm;
  font-size: var(--print-table);
  line-height: 1.4;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--color-text);
  text-wrap: pretty;
}
.doc--tax-invoice .inv-band__sub { margin: 1.2mm 0 0; font-size: var(--print-table); line-height: 1.4; font-variant-numeric: tabular-nums lining-nums; }
.doc--tax-invoice .inv-band__note { margin: 1.6mm 0 0; max-width: 150mm; font-size: var(--print-table); line-height: 1.4; color: var(--color-text-muted); }
.doc--tax-invoice .inv-band__note p { margin: 0 0 1mm; }
.doc--tax-invoice .inv-band__note p:last-child { margin-bottom: 0; }

.doc--tax-invoice .inv-band__reason { max-width: 150mm; overflow-wrap: anywhere; }

/* a note: the invoice line each line is against, and the effect on the invoice beside the total */
.doc--tax-invoice .inv-items .inv-against { font-variant-numeric: tabular-nums lining-nums; }
.doc--tax-invoice .totals__notes .inv-effect { margin: 0 0 2.4mm; font-weight: 600; text-wrap: pretty; }

/* the invoice for a payment received: against which proforma, and when */
.doc--tax-invoice .inv-advance { margin: 0 0 5mm; font-size: var(--print-table); line-height: 1.4; font-weight: 500; }

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

/* the client's GSTIN and State, as label and value under the address; the address of delivery under them */
.doc--tax-invoice .inv-ids { margin: 1.6mm 0 0; display: grid; grid-template-columns: auto 1fr; column-gap: 2.4mm; row-gap: 0.4mm; }
.doc--tax-invoice .inv-ids div { display: contents; }
.doc--tax-invoice .inv-ids dt { color: var(--color-text-muted); }
.doc--tax-invoice .inv-ids dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums lining-nums; }
.doc--tax-invoice .inv-delivery { margin-top: 2.4mm; }
.doc--tax-invoice .inv-delivery .label { margin-bottom: 0.8mm; }

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

/* a USD invoice's INR values, under its total: a thin rule, the heading, the rate line, then the figures */
.doc--tax-invoice .inv-inr { margin-top: -4mm; padding-top: 2mm; border-top: 0.2mm solid var(--color-border); font-size: var(--print-table); line-height: 1.4; }
.doc--tax-invoice .inv-inr h3 { font-size: var(--print-table); line-height: 1.4; font-weight: 600; margin: 0 0 0.6mm; }
.doc--tax-invoice .inv-inr__rate { margin: 0 0 0.8mm; color: var(--color-text-muted); font-variant-numeric: tabular-nums lining-nums; text-wrap: balance; }
.doc--tax-invoice .inv-inr__table { width: 100%; }

/* paying: the call-to-action box under the words, beside the totals */
.doc--tax-invoice .inv-pay { margin: 4mm 0 0; padding-right: 9mm; font-size: var(--print-table); line-height: 1.4; }
.doc--tax-invoice .inv-pay h3 { font-size: var(--print-body); line-height: var(--print-body-leading); font-weight: 600; margin: 0 0 1.6mm; }
.doc--tax-invoice .inv-pay p { text-wrap: wrap; }
.doc--tax-invoice .inv-pay__intro { margin: 0 0 1mm; }
.doc--tax-invoice .inv-bank { margin: 0 0 2.4mm; display: grid; grid-template-columns: auto 1fr; column-gap: 4mm; row-gap: 0.4mm; }
.doc--tax-invoice .inv-bank div { display: contents; }
.doc--tax-invoice .inv-bank dt { color: var(--color-text-muted); }
.doc--tax-invoice .inv-bank dd { margin: 0; font-weight: 500; overflow-wrap: anywhere; font-variant-numeric: tabular-nums lining-nums; }
.doc--tax-invoice .inv-pay__purpose { margin: -1mm 0 2.4mm; font-weight: 500; }
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
