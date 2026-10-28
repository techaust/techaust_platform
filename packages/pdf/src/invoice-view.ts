// The invoice envelope as a pre-formatted view (M5.1 stage B; LD10): every value a template prints is already a string. Amounts come from the frozen
// `computed` text, formatted by core; nothing is added up here. The per-head rates are DERIVED from the frozen rate and the supply type (LD10): an
// intra-state supply prints half of the rate under CGST and half under SGST, anything else prints the whole rate under IGST (Researched 2026-10-28, Rule 46 CGST Rules (08-C RA-05)).
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
  InvoiceViewNote,
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
  // 07-T §1 (pending the owner's approval): the titles of the notes.
  credit_note: "Credit Note",
  debit_note: "Debit Note",
};

/** 07-T §3: the label of each reason a person can pick (the code is what is frozen; `other` is then described in words). Q35 (owner 2026-10-28): a debit note has three (07-T §9). */
const REASON_LABELS: Readonly<Record<string, string>> = {
  price_correction: "Price correction",
  service_not_delivered: "Service not delivered",
  service_deficient: "Service deficient",
  discount_after_sale: "Discount after sale",
  tax_charged_too_low: "Tax charged too low",
  other: "Other",
};

/** 07-S §1: the place of supply line of an export invoice (code 96: outside India). */
export const EXPORT_PLACE_OF_SUPPLY = "Outside India (96)";

/** Rule 48(2): the copy a PDF is. */
export const ORIGINAL_FOR_RECIPIENT = "ORIGINAL FOR RECIPIENT";
/** Rule 48(2): the mark of the stored copy the supplier keeps; it is never emailed, attached or linked to a client (owner 2026-10-28, Q11). */
export const DUPLICATE_FOR_SUPPLIER = "DUPLICATE FOR SUPPLIER";

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
  opts: {
    signature?: VerifiedSignature | null;
    portalLink?: string | null;
    /** `supplier`: the stored DUPLICATE FOR SUPPLIER copy (a proforma has no copy mark either way). Default: the original for the recipient. */
    copy?: "recipient" | "supplier";
  } = {},
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

  // M5.3: a note's request, as sealed (the verifier has already proved there is one take per line)
  const noteOf = header.noteOf;
  const lines: InvoiceViewLine[] = s.lines.map((l, i) => {
    const c = computed.lines[i] as ComputedDocument["lines"][number];
    let discount: string | null = null;
    if (l.discountKind === "percent" && l.discountValue !== null) discount = pct(l.discountValue);
    else if (l.discountKind === "fixed" && l.discountValue !== null) discount = m(l.discountValue);
    const take = noteOf?.request.takes[i];
    return {
      n: String(i + 1),
      ...(take ? { againstLine: take.line + 1 } : {}),
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

  // M5.3: a credit or debit note's facts, from the sealed `noteOf` only. The invoice's route and LUT travel with it (the note copies them at issue; Researched 2026-10-28, s.34(3) CGST Act, Rule 53 (08-C RA-22)).
  const noteView: InvoiceViewNote | null = noteOf
    ? {
        kind: noteOf.kind,
        title: docLabel,
        parent: {
          number: noteOf.parent.number,
          date: shortIsoDate(noteOf.parent.issueDate),
          type: noteOf.parent.type,
        },
        reason: {
          code: noteOf.reason.code,
          label: REASON_LABELS[noteOf.reason.code] ?? noteOf.reason.code,
          text: noteOf.reason.text,
        },
        totalLabel: noteOf.kind === "credit" ? "credited" : "added",
        effect: {
          direction: noteOf.kind === "credit" ? "reduces" : "increases",
          parentNumber: noteOf.parent.number,
          total: m(computed.totalMinor),
        },
        fx: header.fx
          ? { rate: formatFxRate(header.fx.rateMicros), parentNumber: noteOf.parent.number }
          : null,
        route:
          header.document.exportMode === "lut" || header.document.exportMode === "igst_paid"
            ? {
                mode: header.document.exportMode,
                lut: noteOf.parent.lut
                  ? {
                      fy: noteOf.parent.lut.fy,
                      fyLabel: fyLabelOfToken(noteOf.parent.lut.fy) ?? noteOf.parent.lut.fy,
                      arn: noteOf.parent.lut.arn,
                    }
                  : null,
              }
            : null,
      }
    : null;
  // The total's label says which way it goes (07-T §1: "Total credited" / "Total added").
  const totals = totalsOf(computed, m).map((row) =>
    noteView && row.key === "total"
      ? { ...row, label: noteView.totalLabel === "credited" ? "Total credited" : "Total added" }
      : row,
  );

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
    dueDate: header.document.dueDate === null ? "" : shortIsoDate(header.document.dueDate),
    copyLabel:
      envelope.type === "proforma"
        ? null
        : opts.copy === "supplier"
          ? DUPLICATE_FOR_SUPPLIER
          : ORIGINAL_FOR_RECIPIENT,
    logo: company.logo,
    supplier: {
      name: company.tradeName,
      legalName: nonEmpty(company.legalName) ? company.legalName : null,
      lines: supplierLines,
    },
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
    totals,
    summary,
    words: computed.words,
    reverseCharge: header.issuer.reverseChargeText,
    bank,
    export: exportView,
    inr,
    swift,
    proforma: header.proforma
      ? {
          notice: header.proforma.notice,
          validUntil: header.document.dueDate === null ? "" : shortIsoDate(header.document.dueDate),
        }
      : null,
    advance: header.advance
      ? {
          proformaNumber: header.advance.proformaNumber,
          proformaDate: shortIsoDate(header.advance.proformaIssueDate),
          receivedOn: shortIsoDate(header.advance.receivedOn),
          igstNoLutFy: header.advance.igstNoLutFy ?? null,
        }
      : null,
    note: noteView,
    notes: s.terms
      ? {
          title: `Notes, version ${s.terms.version}`,
          version: String(s.terms.version),
          bodyMd: s.terms.bodyMd,
        }
      : null,
    signature,
    showSignatory: header.issuer.signatory !== false,
    // at issue nothing has been paid, so the balance is the total (LD17); an invoice made for money received is paid at issue: nothing is due (the layout leaves the row out)
    // (a credit note owes nothing either: its balance is 0, M5.3; a debit note is its own payable and owes its total)
    balanceDue: m(header.advance || noteOf?.kind === "credit" ? 0 : computed.totalMinor),
    portalLink: nonEmpty(opts.portalLink) ? opts.portalLink : null,
    integrity: `Document ID ${envelope.documentId} · Content fingerprint ${envelope.snapshotSha256.slice(0, 12)}`,
    footer: {
      sender: emailOnDocuments,
      brand: footerLine(emailOnDocuments),
      contact: `${header.issuer.sender.name}, ${header.issuer.sender.email}`,
    },
  };
}
