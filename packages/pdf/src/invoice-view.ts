// The invoice envelope as a pre-formatted view (M5.1 stage B; LD10): every value a template prints is already a string. Amounts come from the frozen
// `computed` text, formatted by core; nothing is added up here. The per-head rates are DERIVED from the frozen rate and the supply type (LD10): an
// intra-state supply prints half of the rate under CGST and half under SGST, anything else prints the whole rate under IGST (VERIFY WITH CA/LEGAL).
// A missing bank block or signature leaves its part out; nothing is invented. A signature image is embedded only when the caller hands in bytes it
// has already verified against the frozen SHA-256 (`verifySignatureBytes`).
import { formatFxRate } from "@techaust/core/invoices";
import { formatMoney, isCurrency, money } from "@techaust/core/money";
import { fyLabelOfToken, placeOfSupplyLabel } from "@techaust/core/pdf-jobs";
import type { ComputedDocument } from "@techaust/core/tax";
import { footerLine } from "./footer.ts";
import { formatQty, shortIsoDate } from "./format.ts";
import type {
  InvoiceEnvelope,
  InvoiceView,
  InvoiceViewBank,
  InvoiceViewExport,
  InvoiceViewInr,
  InvoiceViewLine,
  InvoiceViewSummaryRow,
  InvoiceViewSwift,
  VerifiedSignature,
} from "./invoice-types.ts";
import type { ViewConfig } from "./types.ts";
import { addressLines, nonEmpty, pct, totalsOf } from "./view.ts";

const DASH = "–";

/** The label of each invoice-family type (the wording is the designer's from 07-R; this is the skeleton's). */
const DOC_LABELS: Readonly<Record<string, string>> = {
  tax_invoice: "Tax Invoice",
  // 07-S §1 and §2 (pending the owner's approval): "Export Invoice", "Proforma Invoice".
  export_invoice: "Export Invoice",
  proforma: "Proforma Invoice",
  credit_note: "Credit note",
  debit_note: "Debit note",
};

/** 07-S §1: the place of supply line of an export invoice (code 96: outside India). */
export const EXPORT_PLACE_OF_SUPPLY = "Outside India (96)";

/** Rule 48(2): the copy a PDF is. */
export const ORIGINAL_FOR_RECIPIENT = "ORIGINAL FOR RECIPIENT";

/** Half of a rate in basis points, as the percent text of one head of an intra-state supply: 1800 gives "9 %", 250 gives "1.25 %", 25 gives "0.125 %". */
export function halfRate(bp: number): string {
  if (!Number.isSafeInteger(bp) || bp < 0)
    throw new RangeError(`halfRate: not a rate in basis points: ${bp}`);
  const half = bp >> 1;
  if ((bp & 1) === 0) return pct(half);
  // an odd number of basis points: the half has one more decimal (a half basis point is 0.005 %)
  const whole = Math.trunc(half / 100);
  const frac = `${String(half % 100).padStart(2, "0")}5`;
  return `${whole}.${frac} %`;
}

const NIL = "Nil";

type Heads = { cgst: string | null; sgst: string | null; igst: string | null };
const NO_HEADS: Heads = { cgst: null, sgst: null, igst: null };

/** The rate of each head of one line or summary row, by supply type. A rate of nil prints "Nil" under the heads the supply uses. */
function headRatesOf(intra: boolean, effectiveRateBp: number): Heads {
  if (intra) {
    const r = effectiveRateBp === 0 ? NIL : halfRate(effectiveRateBp);
    return { cgst: r, sgst: r, igst: null };
  }
  return { cgst: null, sgst: null, igst: effectiveRateBp === 0 ? NIL : pct(effectiveRateBp) };
}

function headAmountsOf(
  intra: boolean,
  a: { cgstMinor: number; sgstMinor: number; igstMinor: number },
  m: (n: number) => string,
): Heads {
  return intra
    ? { cgst: m(a.cgstMinor), sgst: m(a.sgstMinor), igst: null }
    : { ...NO_HEADS, igst: m(a.igstMinor) };
}

const SIGNATURE_MIMES: readonly string[] = ["image/png", "image/jpeg"];

/** Builds the view of a verified invoice envelope. `cfg` carries what the envelope does not; `signature` is the verified image, if there is one. */
export function toInvoiceView(
  envelope: InvoiceEnvelope,
  cfg: ViewConfig,
  opts: { signature?: VerifiedSignature | null } = {},
): InvoiceView {
  const { snapshot: s } = envelope;
  const header = s.header;
  const computed = JSON.parse(s.computedJson) as ComputedDocument;
  if (!isCurrency(computed.currency)) throw new RangeError("invoice view: unknown currency");
  if (computed.lines.length !== s.lines.length)
    throw new RangeError("invoice view: lines do not match the computed result");
  const cur = computed.currency;
  const m = (n: number): string => formatMoney(money(n, cur));
  const intra = computed.supply.type === "intra";
  const docLabel = DOC_LABELS[envelope.type] ?? "Invoice";

  const lines: InvoiceViewLine[] = s.lines.map((l, i) => {
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
      gross: m(c.grossMinor),
      taxable: m(c.taxableMinor),
      headRates: headRatesOf(intra, c.effectiveRateBp),
      headAmounts: headAmountsOf(intra, c, m),
      total: m(c.lineTotalMinor),
    };
  });

  const summary: InvoiceViewSummaryRow[] = computed.summary.map((r) => ({
    sac: nonEmpty(r.sac) ? r.sac : null,
    taxable: m(r.taxableMinor),
    headRates: headRatesOf(intra, r.effectiveRateBp),
    headAmounts: headAmountsOf(intra, r, m),
  }));

  const company = header.issuer.company;
  const emailOnDocuments = nonEmpty(company.email) ? company.email : cfg.contactEmail;
  const r = header.recipient;
  const name = nonEmpty(r.displayName) ? r.displayName : r.legalName;
  const stateLabel = nonEmpty(r.stateCode) ? placeOfSupplyLabel(r.stateCode, "intra") : null;
  const gstin = nonEmpty(r.gstin) ? r.gstin : null;
  const recipientLines = [r.legalName !== name ? r.legalName : null, ...addressLines(r.address)].filter(
    nonEmpty,
  );

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
    nonEmpty(company.principalPlace) && company.principalPlace !== company.address
      ? `Principal place of business: ${company.principalPlace}`
      : null,
    registration,
    emailOnDocuments,
    nonEmpty(company.phone) ? company.phone : null,
  ].filter(nonEmpty);

  const b = header.issuer.bank.inr;
  const bank: InvoiceViewBank | null = b
    ? [
        { label: "Account name", value: b.accountName },
        { label: "Account number", value: b.accountNo },
        ...(nonEmpty(b.ifsc) ? [{ label: "IFSC", value: b.ifsc }] : []),
        { label: "Bank", value: b.bankName },
        ...(nonEmpty(b.branch) ? [{ label: "Branch", value: b.branch }] : []),
      ]
    : null;

  // ---- M5.2: only what the sealed header carries (nothing is rebuilt from live settings) ----
  const exp = header.export;
  const exportView: InvoiceViewExport | null = exp
    ? {
        mode: exp.mode,
        endorsement: exp.endorsement,
        lut: exp.lut
          ? { fy: exp.lut.fy, fyLabel: fyLabelOfToken(exp.lut.fy) ?? exp.lut.fy, arn: exp.lut.arn }
          : null,
        countryName: exp.countryName,
        placeOfSupply: EXPORT_PLACE_OF_SUPPLY,
        deliveryAddress: r.deliveryAddress ? addressLines(r.deliveryAddress) : null,
        declaration: exp.declarationRef
          ? {
              id: exp.declarationRef.id,
              version: exp.declarationRef.version,
              sha256: exp.declarationRef.sha256,
              text: exp.declarationText ?? "",
            }
          : null,
      }
    : null;
  const inr: InvoiceViewInr | null =
    header.fx && computed.inr
      ? {
          rate: formatFxRate(header.fx.rateMicros),
          source: header.fx.source,
          date: shortIsoDate(header.fx.date),
          taxable: formatMoney(money(computed.inr.taxableMinor, "INR")),
          igst:
            computed.supply.type === "export_igst" ? formatMoney(money(computed.inr.igstMinor, "INR")) : null,
          total: formatMoney(money(computed.inr.totalMinor, "INR")),
        }
      : null;
  const sw = header.issuer.bank.swift ?? null;
  const swift: InvoiceViewSwift | null = sw
    ? {
        beneficiary: sw.accountName,
        accountNo: sw.accountNo,
        swift: sw.swift,
        bank: [sw.bankName, sw.branch].filter(nonEmpty).join(", "),
        bankAddress: nonEmpty(sw.bankAddress) ? sw.bankAddress : null,
        intermediary: nonEmpty(sw.intermediary) ? sw.intermediary : null,
        purposeCode: nonEmpty(sw.purposeCode) ? sw.purposeCode : null,
      }
    : null;

  const sig = opts.signature ?? null;
  const signature =
    sig && SIGNATURE_MIMES.includes(sig.mime) && /^[A-Za-z0-9+/]+={0,2}$/.test(sig.base64)
      ? { dataUri: `data:${sig.mime};base64,${sig.base64}` }
      : null;

  return {
    kind: "invoice",
    type: envelope.type,
    docLabel,
    title: `${docLabel} ${envelope.numberDisplay} ${DASH} ${name}`,
    numberDisplay: envelope.numberDisplay,
    issueDate: shortIsoDate(header.document.issueDate),
    dueDate: shortIsoDate(header.document.dueDate),
    copyLabel: envelope.type === "proforma" ? null : ORIGINAL_FOR_RECIPIENT,
    logo: company.logo,
    supplier: { name: company.tradeName, lines: supplierLines },
    recipient: {
      name,
      attention: nonEmpty(r.contactName) ? r.contactName : null,
      lines: recipientLines,
      state: stateLabel,
      gstin,
    },
    placeOfSupply: placeOfSupplyLabel(header.supply.placeOfSupplyCode, header.supply.type),
    supplyType: computed.supply.type,
    currency: cur,
    lines,
    totals: totalsOf(computed, m),
    summary,
    words: computed.words,
    reverseCharge: header.issuer.reverseChargeText,
    bank,
    export: exportView,
    inr,
    swift,
    proforma: header.proforma
      ? { notice: header.proforma.notice, validUntil: shortIsoDate(header.document.dueDate) }
      : null,
    advance: header.advance
      ? {
          proformaNumber: header.advance.proformaNumber,
          proformaDate: shortIsoDate(header.advance.proformaIssueDate),
          receivedOn: shortIsoDate(header.advance.receivedOn),
        }
      : null,
    notes: s.terms
      ? {
          title: `Notes, version ${s.terms.version}`,
          version: String(s.terms.version),
          bodyMd: s.terms.bodyMd,
        }
      : null,
    signature,
    integrity: `Document ID ${envelope.documentId} · Content fingerprint ${envelope.snapshotSha256.slice(0, 12)}`,
    footer: {
      sender: emailOnDocuments,
      brand: footerLine(emailOnDocuments),
      contact: `${header.issuer.sender.name}, ${header.issuer.sender.email}`,
    },
  };
}
