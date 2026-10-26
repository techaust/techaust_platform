// The proposal and estimate layout (M4.4; docs/06 §7.1 to §7.4). One system for both: a 12-column A4 page, the shared header (the logo,
// the verdigris rule, then "From", "Prepared for" and "Document"), sections with their heading hung in the first three columns and the
// text in the other nine, and the money (lines, totals, tax summary, schedule) across all twelve. A proposal opens with a cover page.
//
// The contract the tests and the visual suite rely on (kept from the phase 1 skeleton):
//   data-testid="rupee"            the rupee sign of the grand total (INR), or the one inside the INR note (USD documents)
//   data-testid="currency-symbol"  the dollar sign of a USD grand total
//   data-testid="status"           the status as text
//   data-testid="total"            the grand total value
//   data-testid="integrity"        the document ID and content fingerprint line (end of the document)
//
// No logic beyond formatting: every value is a pre-formatted string of the view. Every dynamic string goes through `esc`; Markdown goes
// through `markdownBlocks` (escaped, safe links only). Wording: ./copy.ts (07-P).
import { esc } from "../escape.ts";
import { PDF_LOGOS } from "../generated/assets.ts";
import { markdownBlocks } from "../markdown-html.ts";
import type { PdfView, ViewSection, ViewStep } from "../types.ts";
import { PDF_COPY as C } from "./copy.ts";

const RUPEE = "₹";

const p = (cls: string, text: string) => `<p class="${cls}">${esc(text)}</p>`;

/** A block line whose parts are joined by " · " (e.g. "GSTIN … · State …") wraps only between the parts; other lines wrap freely. */
const partsLine = (cls: string, text: string) =>
  !text.includes(" · ")
    ? p(cls, text)
    : `<p class="${cls}">${text
        .split(" · ")
        .map((part) => `<span class="keep">${esc(part)}</span>`)
        .join(" · ")}</p>`;

/** The frozen logo file; an empty or unknown name falls back to the primary logo. The trade name is never typeset in its place (brand rule). */
function logoHtml(view: PdfView): string {
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

/** The INR note of a USD document, its rupee sign marked for the visual suite. */
function inrNoteHtml(note: string): string {
  const at = note.indexOf(RUPEE);
  if (at < 0) return esc(note);
  return `${esc(note.slice(0, at))}<span data-testid="rupee">${RUPEE}</span>${esc(note.slice(at + 1))}`;
}

const isInr = (view: PdfView) => view.currency === "INR";

// ---- header ---------------------------------------------------------------------------------------------------------------

/** The logo, the kind of document and the verdigris rule. `tag` is "h1" where the kind is the page's main heading, else "p". */
function masthead(view: PdfView, withTitle: boolean, tag: "h1" | "p" = "h1"): string {
  return `<header class="masthead">${logoHtml(view)}${
    withTitle ? `<${tag} class="masthead__title">${esc(view.docLabel)}</${tag}>` : ""
  }</header>`;
}

function parties(view: PdfView): string {
  const from = `<div class="party"><p class="label">${C.blocks.from}</p>${p("party__name", view.supplier.name)}${view.supplier.lines
    .map((l) => partsLine("party__line", l))
    .join("")}</div>`;
  const to = `<div class="party"><p class="label">${C.blocks.preparedFor}</p>${p("party__name", view.recipient.name)}${view.recipient.lines
    .map((l) => partsLine("party__line", l))
    .join("")}${p("party__line", C.placeOfSupply(view.placeOfSupply))}${
    view.recipient.attention ? p("party__line party__attention", view.recipient.attention) : ""
  }</div>`;
  const fact = (term: string, value: string) => `<div><dt>${esc(term)}</dt><dd>${esc(value)}</dd></div>`;
  const doc = `<div class="party party--doc"><p class="label">${C.blocks.document} <span class="status" data-testid="status">${esc(
    view.statusText,
  )}</span></p><dl class="facts">${fact(C.document.number, `${view.numberDisplay} v${view.version}`)}${fact(
    C.document.date,
    view.issueDate,
  )}${fact(C.document.validUntil, view.validUntil)}${fact(C.document.currency, view.currency)}</dl></div>`;
  return `<section class="parties" aria-label="${esc(view.docLabel)}">${from}${to}${doc}</section>`;
}

// ---- the money --------------------------------------------------------------------------------------------------------------

function itemsTable(view: PdfView): string {
  // The discount column is printed only when a line has a discount (an empty column would only take width from the description).
  const withDiscount = view.lines.some((l) => l.discount !== null);
  const rows = view.lines
    .map(
      (l) =>
        `<tr><td class="c-n num">${esc(l.n)}</td><td class="c-desc"><span class="desc">${esc(l.description)}</span>${
          l.detail ? `<span class="sub">${esc(l.detail)}</span>` : ""
        }${l.sac ? `<span class="sub">${C.lines.sac} ${esc(l.sac)}</span>` : ""}</td><td class="num">${esc(l.qty)}</td><td>${esc(
          l.unit,
        )}</td><td class="num">${esc(l.rate)}</td>${withDiscount ? `<td class="num">${l.discount ? esc(l.discount) : ""}</td>` : ""}<td class="num">${esc(
          l.taxable,
        )}</td><td class="num">${esc(l.gstRate)}</td></tr>`,
    )
    .join("");
  const L = C.lines;
  const head = [
    `<th scope="col" class="c-n">${L.n}</th>`,
    `<th scope="col" class="c-desc">${L.description}</th>`,
    `<th scope="col" class="num c-qty">${L.qty}</th>`,
    `<th scope="col" class="c-unit">${L.unit}</th>`,
    `<th scope="col" class="num c-rate">${L.rate}</th>`,
    withDiscount ? `<th scope="col" class="num c-disc">${L.discount}</th>` : "",
    `<th scope="col" class="num c-taxable">${L.taxable}</th>`,
    `<th scope="col" class="num c-gst">${L.gst}</th>`,
  ].join("");
  return `<table class="grid items"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function totalsBlock(view: PdfView): string {
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
    `<p class="words">${esc(C.words(view.words))}</p>`,
    isInr(view) ? p("note", C.inrNote) : p("note", C.usdNote),
    view.inrNote ? `<p class="note">${inrNoteHtml(view.inrNote)}</p>` : "",
  ].join("");
  return `<div class="totals"><div class="totals__notes">${notes}</div><table class="totals__table">${rows}</table></div>`;
}

function summaryTable(view: PdfView): string {
  if (view.summary.length === 0) return "";
  const keys = new Set(view.totals.map((t) => t.key));
  const intra = keys.has("cgst");
  const S = C.summary;
  const head = intra
    ? `<th scope="col" class="num c-amt">${S.cgst}</th><th scope="col" class="num c-amt">${S.sgst}</th>`
    : `<th scope="col" class="num c-amt">${S.igst}</th>`;
  const rows = view.summary
    .map(
      (r) =>
        `<tr><td>${r.sac ? esc(r.sac) : ""}</td><td class="num">${esc(r.rate)}</td><td class="num">${esc(r.taxable)}</td>${
          intra
            ? `<td class="num">${esc(r.cgst)}</td><td class="num">${esc(r.sgst)}</td>`
            : `<td class="num">${esc(r.igst)}</td>`
        }</tr>`,
    )
    .join("");
  return `<div class="block"><h3>${S.heading}</h3><table class="grid summary"><thead><tr><th scope="col" class="c-sac">${C.lines.sac}</th><th scope="col" class="num c-rate">${C.lines.gst}</th><th scope="col" class="num c-amt">${S.taxable}</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** The payment schedule. Without a timeline table in the document, what each instalment brings and its date ride along here. */
function scheduleTable(view: PdfView, withDetail: boolean): string {
  if (view.schedule.length === 0) return "";
  const S = C.schedule;
  const rows = view.schedule
    .map(
      (s) =>
        `<tr><td>${esc(s.label)}${withDetail && s.detail ? `<span class="sub">${esc(s.detail)}</span>` : ""}</td><td>${esc(s.when)}${
          withDetail && s.date ? ` (${esc(s.date)})` : ""
        }</td><td class="num">${esc(s.share)}</td><td class="num">${esc(s.amount)}</td></tr>`,
    )
    .join("");
  return `<div class="block"><h3>${S.heading}</h3><table class="grid schedule"><thead><tr><th scope="col">${S.instalment}</th><th scope="col">${S.when}</th><th scope="col" class="num c-share">${S.share}</th><th scope="col" class="num c-amount">${S.amount}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function timelineTable(steps: readonly ViewStep[]): string {
  if (steps.length === 0) return "";
  const T = C.timeline;
  const rows = steps
    .map(
      (s) =>
        `<tr><td>${esc(s.label)}</td><td>${s.detail ? esc(s.detail) : ""}</td><td>${s.date ? esc(s.date) : ""}</td><td class="num">${esc(
          s.share,
        )}</td></tr>`,
    )
    .join("");
  return `<table class="grid timeline"><thead><tr><th scope="col">${T.milestone}</th><th scope="col">${T.whatYouGet}</th><th scope="col" class="c-date">${T.targetDate}</th><th scope="col" class="num c-pay">${T.payment}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function moneyBlock(view: PdfView, hasTimeline: boolean): string {
  return `<div class="money">${itemsTable(view)}${totalsBlock(view)}${summaryTable(view)}${scheduleTable(view, !hasTimeline)}</div>`;
}

function acceptanceBox(view: PdfView): string {
  return `<div class="accept"><div class="accept__inner"><p class="accept__online">${esc(C.acceptance.online)} <span class="accept__link">${esc(
    view.portalLink,
  )}</span></p>${p("accept__record", C.acceptance.record)}</div></div>`;
}

// ---- sections ---------------------------------------------------------------------------------------------------------------

/** A section: the heading kept with its first block (in the rail and the text columns), then the rest of the text, then `extra`. */
function sectionHtml(
  kind: string,
  title: string,
  bodyMd: string,
  extra: { body?: string; wide?: string },
): string {
  const [first = "", ...rest] = markdownBlocks(bodyMd);
  return `<section class="sec sec--${esc(kind)}"><div class="sec__head"><h2>${esc(title)}</h2><div class="sec__first">${first}</div></div>${
    rest.length ? `<div class="sec__text">${rest.join("")}</div>` : ""
  }${extra.body ? `<div class="sec__text">${extra.body}</div>` : ""}${extra.wide ? `<div class="sec__wide">${extra.wide}</div>` : ""}</section>`;
}

function termsExtra(view: PdfView, sectionBody: string): string {
  const line = sectionBody.trim() === "" ? p("terms__line", C.termsLine(view.terms.version)) : "";
  return `${line}<div class="terms">${markdownBlocks(view.terms.bodyMd).join("")}</div>`;
}

function sectionsHtml(view: PdfView, sections: readonly ViewSection[]): string {
  const hasTimeline = sections.some((s) => s.kind === "timeline") && view.schedule.length > 0;
  const kinds = new Set(sections.map((s) => s.kind));
  const out = sections.map((s) => {
    switch (s.kind) {
      case "timeline":
        return sectionHtml(s.kind, s.title, s.bodyMd, { body: timelineTable(view.schedule) });
      case "estimate":
        return sectionHtml(s.kind, s.title, s.bodyMd, { wide: moneyBlock(view, hasTimeline) });
      case "terms":
        return sectionHtml(s.kind, s.title, s.bodyMd, { body: termsExtra(view, s.bodyMd) });
      case "acceptance":
        return sectionHtml(s.kind, s.title, s.bodyMd, { body: acceptanceBox(view) });
      default:
        return sectionHtml(s.kind, s.title, s.bodyMd, {});
    }
  });
  // The three parts every document carries, even if a section went missing.
  if (!kinds.has("estimate"))
    out.push(sectionHtml("estimate", C.headings.investment, "", { wide: moneyBlock(view, hasTimeline) }));
  if (!kinds.has("terms"))
    out.push(sectionHtml("terms", C.headings.terms, "", { body: termsExtra(view, "") }));
  if (!kinds.has("acceptance"))
    out.push(sectionHtml("acceptance", C.headings.acceptance, "", { body: acceptanceBox(view) }));
  return out.join("\n");
}

// ---- the two documents --------------------------------------------------------------------------------------------------------

function coverHtml(view: PdfView, cover: ViewSection | undefined): string {
  // The masthead carries the kind ("Proposal"), as on the inner pages; the page itself belongs to the document's own title.
  const title = view.documentTitle ?? view.docLabel;
  const lede = cover ? markdownBlocks(cover.bodyMd).join("") : "";
  const meta = [
    view.issueDate,
    view.versionLabel,
    `${C.document.validUntil} ${view.validUntil}`,
    view.numberDisplay,
  ]
    .map((m) => `<li>${esc(m)}</li>`)
    .join("");
  return `<section class="cover" aria-label="${esc(view.docLabel)}">${masthead(view, true, "p")}<div class="cover__main"><h1 class="cover__title">${esc(
    title,
  )}</h1>${lede ? `<div class="cover__lede">${lede}</div>` : ""}</div><div class="cover__facts"><p class="cover__for"><span class="cover__for-label">${
    C.cover.preparedFor
  }</span> <span class="cover__client">${esc(view.recipient.name)}</span></p><ul class="cover__meta">${meta}</ul>${p(
    "cover__contact",
    C.cover.contact(view.footer.contact),
  )}</div></section>`;
}

function integrityHtml(view: PdfView): string {
  return `<p class="integrity" data-testid="integrity">${esc(view.integrity)}</p>`;
}

/** The body of a proposal: the cover page, then the shared header (logo, title, rule, the three blocks), then the sections. */
function proposalBody(view: PdfView): string {
  const cover = view.sections.find((s) => s.kind === "cover");
  const rest = view.sections.filter((s) => s.kind !== "cover");
  return `<div class="doc doc--proposal">${coverHtml(view, cover)}
${masthead(view, true, "p")}
${parties(view)}
${sectionsHtml(view, rest)}
${integrityHtml(view)}</div>`;
}

/** The body of an estimate: the header with its title, the document's own title and notice, the sections. */
function estimateBody(view: PdfView): string {
  const sections = view.sections.filter((s) => s.kind !== "cover");
  return `<div class="doc doc--estimate">${masthead(view, true)}
${parties(view)}
${view.documentTitle ? p("doc-title", view.documentTitle) : ""}
${view.notice ? p("notice", view.notice) : ""}
${sectionsHtml(view, sections)}
${integrityHtml(view)}</div>`;
}

/** The body of the document (inside `<body>`). */
export function documentBody(view: PdfView): string {
  return view.type === "proposal" ? proposalBody(view) : estimateBody(view);
}
