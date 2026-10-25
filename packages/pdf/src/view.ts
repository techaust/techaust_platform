// The envelope as a pre-formatted view: every value a template prints is already a string. No arithmetic happens here (a scanner test
// bans the operators on money): amounts come from the frozen `computed` text, formatted by core. An empty supplier field is left out.
// VERIFY WITH CA/LEGAL: the supplier lines, the place-of-supply label, the tax preview rows and the estimate notice wording.
import { formatMoney, isCurrency, type Money, money, negate, percentFromBp } from "@techaust/core";
import { placeOfSupplyLabel } from "@techaust/core/pdf-jobs";
import type { ComputedDocument } from "@techaust/core/tax";
import { countryName, formatMicros, formatQty, shortIsoDate } from "./format.ts";
import type {
  Address,
  Envelope,
  PdfView,
  RecipientSnap,
  ViewConfig,
  ViewLine,
  ViewSection,
  ViewStep,
  ViewSummaryRow,
  ViewTotalRow,
} from "./types.ts";

export const DEFAULT_VIEW_CONFIG: ViewConfig = { contactEmail: "hello@techaust.com" };

const DASH = "–";

const SECTION_TITLES: Record<string, string> = {
  cover: "Cover",
  summary: "Summary",
  problem_goals: "Problem and goals",
  scope: "Scope",
  deliverables: "Deliverables",
  timeline: "Timeline",
  team: "Team",
  how_we_work: "How we work",
  estimate: "Estimate",
  assumptions_exclusions: "Assumptions and exclusions",
  terms: "Terms",
  acceptance: "Acceptance",
  custom: "Additional notes",
};

const WHEN: Record<string, string> = {
  on_accept: "On acceptance",
  delivery: "On delivery",
  monthly: "Monthly in advance",
};

const nonEmpty = (s: string | null | undefined): s is string => typeof s === "string" && s.trim() !== "";

function addressLines(a: Address | undefined): string[] {
  if (!a) return [];
  const place = [a.city, a.state, a.postalCode].filter(nonEmpty).join(", ");
  return [a.line1, a.line2, place, countryName(a.country)].filter(nonEmpty);
}

function recipientOf(r: RecipientSnap): PdfView["recipient"] {
  const name = nonEmpty(r.displayName) ? r.displayName : r.legalName;
  const lines = [
    r.legalName !== name ? r.legalName : null,
    ...addressLines(r.address),
    nonEmpty(r.gstin) ? `GSTIN ${r.gstin}` : null,
  ].filter(nonEmpty);
  return { name, attention: nonEmpty(r.contactName) ? r.contactName : null, lines };
}

function totalsOf(c: ComputedDocument, m: (n: number) => string): ViewTotalRow[] {
  const rows: ViewTotalRow[] = [{ key: "subtotal", label: "Subtotal", value: m(c.subtotalMinor) }];
  if (c.discountMinor !== 0) {
    rows.push({
      key: "discount",
      label: "Discount",
      value: formatMoney(negate(money(c.discountMinor, c.currency))),
    });
  }
  rows.push({ key: "taxable", label: "Taxable value", value: m(c.taxableMinor) });
  if (c.supply.type === "intra") {
    rows.push({ key: "cgst", label: "CGST", value: m(c.cgstMinor) });
    rows.push({ key: "sgst", label: "SGST", value: m(c.sgstMinor) });
  } else if (c.supply.type === "inter" || c.supply.type === "export_igst") {
    rows.push({ key: "igst", label: "IGST", value: m(c.igstMinor) });
  }
  if (c.roundOffMinor !== 0) rows.push({ key: "round_off", label: "Round off", value: m(c.roundOffMinor) });
  rows.push({ key: "total", label: `Total (${c.currency})`, value: m(c.totalMinor), strong: true });
  return rows;
}

/** Builds the view of a verified envelope. `cfg` carries the few things that are not in the envelope. */
export function toPdfView(envelope: Envelope, cfg: ViewConfig = DEFAULT_VIEW_CONFIG): PdfView {
  const { snapshot: s } = envelope;
  const header = s.header;
  const computed = JSON.parse(s.computedJson) as ComputedDocument;
  if (!isCurrency(computed.currency)) throw new RangeError("view: unknown currency");
  if (computed.lines.length !== s.lines.length)
    throw new RangeError("view: lines do not match the computed result");
  const cur = computed.currency;
  const m = (n: number): string => formatMoney(money(n, cur));
  const docLabel = envelope.type === "proposal" ? "Proposal" : "Estimate";

  const lines: ViewLine[] = s.lines.map((l, i) => {
    const c = computed.lines[i] as ComputedDocument["lines"][number];
    let discount: string | null = null;
    if (l.discountKind === "percent" && l.discountValue !== null)
      discount = `${percentFromBp(l.discountValue)}%`;
    else if (l.discountKind === "fixed" && l.discountValue !== null) discount = m(l.discountValue);
    return {
      n: String(i + 1),
      description: l.description,
      detail: nonEmpty(l.detail) ? l.detail : null,
      sac: nonEmpty(l.sac) ? l.sac : null,
      qty: formatQty(l.qtyMilli),
      unit: l.unit,
      rate: m(l.rateMinor),
      discount,
      gstRate: c.effectiveRateBp === 0 ? "Nil" : `${percentFromBp(c.effectiveRateBp)}%`,
      taxable: m(c.taxableMinor),
      total: m(c.lineTotalMinor),
    };
  });

  const anyTax = computed.cgstMinor !== 0 || computed.sgstMinor !== 0 || computed.igstMinor !== 0;
  const summary: ViewSummaryRow[] = anyTax
    ? computed.summary.map((r) => ({
        rate: r.effectiveRateBp === 0 ? "Nil" : `${percentFromBp(r.effectiveRateBp)}%`,
        sac: nonEmpty(r.sac) ? r.sac : null,
        taxable: m(r.taxableMinor),
        cgst: m(r.cgstMinor),
        sgst: m(r.sgstMinor),
        igst: m(r.igstMinor),
      }))
    : [];

  let inrNote: string | null = null;
  if (cur !== "INR" && computed.inr !== null && computed.fxRateMicros !== null) {
    const inr: Money = money(computed.inr.totalMinor, "INR");
    inrNote = `Indicative total in INR: ${formatMoney(inr)} (1 ${cur} = ₹${formatMicros(computed.fxRateMicros)}).`;
  }

  const schedule: ViewStep[] = s.schedule.map((st, i) => ({
    label: st.label,
    when: WHEN[st.trigger] ?? st.label,
    share: `${percentFromBp(st.pctBp)}%`,
    amount: m(header.instalmentAmounts[i] ?? 0),
    detail: nonEmpty(st.detail) ? st.detail : null,
    date: st.targetDate ? shortIsoDate(st.targetDate) : null,
  }));

  const sections: ViewSection[] = s.sections
    .filter((x) => !x.hidden)
    .map((x) => ({
      kind: x.kind,
      title: nonEmpty(x.title) ? x.title : (SECTION_TITLES[x.kind] ?? "Section"),
      bodyMd: x.bodyMd,
    }));

  const company = header.issuer.company;
  const recipient = recipientOf(header.recipient);
  const supplierLines = [
    nonEmpty(company.legalName) && company.legalName !== company.tradeName ? company.legalName : null,
    company.address,
    nonEmpty(company.gstin) ? `GSTIN ${company.gstin}` : null,
  ].filter(nonEmpty);

  return {
    type: envelope.type,
    docLabel,
    title: `${docLabel} ${envelope.numberDisplay} v${envelope.version} ${DASH} ${recipient.name}`,
    numberDisplay: envelope.numberDisplay,
    versionLabel: `Version ${envelope.version}`,
    statusText: "Sent",
    notice: envelope.type === "estimate" ? "This is an estimate, not a tax invoice." : null,
    issueDate: shortIsoDate(header.document.issueDate),
    validUntil: shortIsoDate(header.document.validUntil),
    validityNote: `Valid until ${shortIsoDate(header.document.validUntil)}`,
    logo: company.logo,
    supplier: { name: company.tradeName, lines: supplierLines },
    recipient,
    placeOfSupply: placeOfSupplyLabel(header.supply.placeOfSupplyCode, header.supply.type),
    currency: cur,
    documentTitle: nonEmpty(header.document.title) ? header.document.title : null,
    lines,
    totals: totalsOf(computed, m),
    summary,
    words: computed.words,
    inrNote,
    schedule,
    sections,
    terms: { title: `Terms, version ${s.terms.version}`, bodyMd: s.terms.bodyMd },
    integrity: `Document ${envelope.documentId}, fingerprint ${envelope.snapshotSha256.slice(0, 12)}`,
    footer: {
      sender: cfg.contactEmail,
      contact: `${header.issuer.sender.name}, ${header.issuer.sender.email}`,
    },
  };
}
