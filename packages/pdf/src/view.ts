// The envelope as a pre-formatted view: every value a template prints is already a string. No arithmetic happens here (a scanner test
// bans the operators on money): amounts come from the frozen `computed` text, formatted by core. An empty supplier field is left out.
// VERIFY WITH CA/LEGAL: the supplier lines, the place-of-supply label, the tax preview rows and the estimate notice wording.
import { formatMoney, isCurrency, type Money, money, negate } from "@techaust/core/money";
import { placeOfSupplyLabel } from "@techaust/core/pdf-jobs";
import { percentFromBp } from "@techaust/core/schedule-text";
import type { ComputedDocument } from "@techaust/core/tax";
import { DEFAULT_CONTACT_EMAIL, footerLine } from "./footer.ts";
import { countryName, formatMicros, formatQty, longIsoDate, shortIsoDate } from "./format.ts";
import type {
  Address,
  Envelope,
  PdfView,
  RecipientSnap,
  StatementView,
  StatementViewInput,
  ViewConfig,
  ViewLine,
  ViewSection,
  ViewStep,
  ViewSummaryRow,
  ViewTotalRow,
} from "./types.ts";

export const DEFAULT_VIEW_CONFIG: ViewConfig = {
  contactEmail: DEFAULT_CONTACT_EMAIL,
  portalLink: "portal.techaust.com",
};

export { footerLine };

const DASH = "–";
/** "18 %": the house style puts a space before the sign; a no-break space keeps the two together on the page. */
export const pct = (bp: number): string => `${percentFromBp(bp)} %`;

const SECTION_TITLES: Record<string, string> = {
  cover: "Cover",
  summary: "Summary",
  problem_goals: "Your goals",
  scope: "Scope",
  deliverables: "Deliverables",
  timeline: "Timeline",
  team: "Team",
  how_we_work: "How we work",
  estimate: "Investment",
  assumptions_exclusions: "Assumptions and exclusions",
  terms: "Terms",
  acceptance: "Acceptance",
  custom: "Additional notes",
};

const WHEN: Record<string, string> = {
  on_accept: "On acceptance",
  milestone: "At a milestone",
  delivery: "On delivery",
  monthly: "Monthly in advance",
};

export const nonEmpty = (s: string | null | undefined): s is string =>
  typeof s === "string" && s.trim() !== "";

export function addressLines(a: Address | undefined): string[] {
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

export function totalsOf(c: ComputedDocument, m: (n: number) => string): ViewTotalRow[] {
  const rows: ViewTotalRow[] = [{ key: "subtotal", label: "Sub-total", value: m(c.subtotalMinor) }];
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
  if (c.roundOffMinor !== 0) rows.push({ key: "round_off", label: "Round-off", value: m(c.roundOffMinor) });
  rows.push({ key: "total", label: "Total", value: m(c.totalMinor), strong: true });
  return rows;
}

/** Builds the view of a verified envelope. `cfg` carries the few things that are not in the envelope. */
export function toPdfView(
  envelope: Envelope,
  cfg: ViewConfig = DEFAULT_VIEW_CONFIG,
  opts: { longDates?: boolean } = {},
): PdfView {
  // The PDF prints "06 Oct 26"; the portal's screen passes `longDates` for "06 Oct 2026" (07-Q M10).
  const dateOf = opts.longDates ? longIsoDate : shortIsoDate;
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
    if (l.discountKind === "percent" && l.discountValue !== null) discount = pct(l.discountValue);
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
      gstRate: c.effectiveRateBp === 0 ? "Nil" : pct(c.effectiveRateBp),
      taxable: m(c.taxableMinor),
      total: m(c.lineTotalMinor),
    };
  });

  const anyTax = computed.cgstMinor !== 0 || computed.sgstMinor !== 0 || computed.igstMinor !== 0;
  const summary: ViewSummaryRow[] = anyTax
    ? computed.summary.map((r) => ({
        rate: r.effectiveRateBp === 0 ? "Nil" : pct(r.effectiveRateBp),
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
    share: pct(st.pctBp),
    amount: m(header.instalmentAmounts[i] ?? 0),
    detail: nonEmpty(st.detail) ? st.detail : null,
    date: st.targetDate ? dateOf(st.targetDate) : null,
  }));

  const sections: ViewSection[] = s.sections
    .filter((x) => !x.hidden)
    .map((x) => ({
      kind: x.kind,
      title: nonEmpty(x.title) ? x.title : (SECTION_TITLES[x.kind] ?? "Section"),
      bodyMd: x.bodyMd ?? "",
    }));

  const company = header.issuer.company;
  // Settings "Email on documents" as frozen at send (07-Q Q11); a version sent before that field existed prints the default.
  const emailOnDocuments = nonEmpty(company.email) ? company.email : cfg.contactEmail;
  const recipient = recipientOf(header.recipient);
  // 07-P §1: "Proprietor: {legal name}" · the address · "GSTIN {gstin} · State {state} ({code})" · the sender address. A field still
  // empty in Settings is left out (the state is never empty: it has a default).
  const registration = [
    nonEmpty(company.gstin) ? `GSTIN ${company.gstin}` : null,
    `State ${placeOfSupplyLabel(company.stateCode, "intra")}`,
  ]
    .filter(nonEmpty)
    .join(" · ");
  const supplierLines = [
    nonEmpty(company.legalName) && company.legalName !== company.tradeName
      ? `Proprietor: ${company.legalName}`
      : null,
    company.address,
    registration,
    emailOnDocuments,
  ].filter(nonEmpty);

  return {
    type: envelope.type,
    docLabel,
    title: `${docLabel} ${envelope.numberDisplay} v${envelope.version} ${DASH} ${recipient.name}`,
    numberDisplay: envelope.numberDisplay,
    versionLabel: `Version ${envelope.version}`,
    version: String(envelope.version),
    statusText: "Sent",
    notice: envelope.type === "estimate" ? "This is an estimate, not a tax invoice." : null,
    issueDate: dateOf(header.document.issueDate),
    validUntil: dateOf(header.document.validUntil),
    validityNote: `Valid until ${dateOf(header.document.validUntil)}`,
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
    terms: {
      title: `Terms, version ${s.terms.version}`,
      version: String(s.terms.version),
      bodyMd: s.terms.bodyMd,
    },
    integrity: `Document ID ${envelope.documentId} · Content fingerprint ${envelope.snapshotSha256.slice(0, 12)}`,
    portalLink: cfg.portalLink ?? "portal.techaust.com",
    footer: {
      sender: emailOnDocuments,
      brand: footerLine(emailOnDocuments),
      contact: `${header.issuer.sender.name}, ${header.issuer.sender.email}`,
    },
  };
}

// ---- the statement of account (M5.5b, LD79; ADM-CLI-04; VERIFY WITH CA/LEGAL for what a statement lists, Q58) --------------------------------------------

/** The layout the skeleton prints with; the designer's layout gives its own id, so the same data gets a new PDF once the page changes. */
export const STATEMENT_SKELETON_LAYOUT = "statement-skeleton-1";

const addressLinesOf = (a: Partial<Address> | null | undefined): string[] => {
  if (!a) return [];
  const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const place = [clean(a.city), clean(a.state), clean(a.postalCode)].filter((p) => p !== "").join(", ");
  return [clean(a.line1), clean(a.line2), place, a.country ? countryName(clean(a.country)) : ""].filter(
    (l) => l !== "",
  );
};

/**
 * The pre-formatted statement. Pure: the same input always gives the same view. Money is formatted by core from the integers the database gave (no arithmetic
 * here); an amount that is not a safe integer throws (a bug, never a rounded figure), and the jobs Worker marks the row failed. `generatedOn` is the only value
 * that varies between makings of identical data.
 */
export function statementView(input: StatementViewInput, layout = STATEMENT_SKELETON_LAYOUT): StatementView {
  const fmt = (minor: number): string => formatMoney(money(minor, input.currency));
  const co = input.company;
  const companyLines = [
    co.legalName && co.legalName !== co.tradeName ? co.legalName : "",
    co.address ?? "",
    co.gstin ? `GSTIN ${co.gstin}` : "",
  ].filter((l) => l !== "");
  const clientLines = [
    ...addressLinesOf(input.client.address),
    input.client.gstin ? `GSTIN ${input.client.gstin}` : "",
  ].filter((l) => l !== "");
  return {
    layout,
    company: { name: co.tradeName, lines: companyLines, logo: co.logo },
    client: { name: input.client.legalName, lines: clientLines },
    from: longIsoDate(input.from),
    to: longIsoDate(input.to),
    currency: input.currency,
    opening: fmt(input.openingMinor),
    closing: fmt(input.closingMinor),
    totalDebits: fmt(input.debitMinor),
    totalCredits: fmt(input.creditMinor),
    amountDue: input.closingMinor > 0 ? fmt(input.closingMinor) : null,
    entries: input.entries.map((e) => ({
      kind: e.kind,
      date: shortIsoDate(e.date),
      document: e.number,
      againstNumber: e.againstNumber ?? null,
      debit: e.debitMinor === 0 ? "" : fmt(e.debitMinor),
      credit: e.creditMinor === 0 ? "" : fmt(e.creditMinor),
      balance: fmt(e.balanceMinor),
    })),
    billingEmail: input.billingEmail,
    generatedOn: longIsoDate(input.generatedOn),
  };
}
