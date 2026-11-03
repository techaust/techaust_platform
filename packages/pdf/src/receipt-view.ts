// M6.5 (ADM-PAY-09, JOB-PDF-01; run file D, L4): the receipt's sealed `receiptOf` (core `ReceiptOf`) and its number, formatted into the layout's contract
// (`ReceiptLayoutView`, ./layout/receipt.ts). Jobs only. The number sits outside the seal, as an invoice's does. Amounts through core `formatMoney` (en-IN for
// INR, en-US for USD), dates as the PDFs write them.
import { paidByWords } from "@techaust/core/copy-zo";
import { formatMoney, money } from "@techaust/core/money";
import type { ReceiptOf } from "@techaust/core/receipts";
import { DEFAULT_CONTACT_EMAIL, footerLine } from "./footer.ts";
import { shortIsoDate } from "./format.ts";
import type { ReceiptLayoutView } from "./layout/receipt.ts";

export {
  RECEIPT_LAYOUT_PLACEHOLDER,
  RECEIPT_PDF_LAYOUT_ID,
  type ReceiptLayoutView,
  renderReceiptHtml,
} from "./layout/receipt.ts";

/** The page's values from the sealed receipt and its number. */
export function receiptView(r: ReceiptOf, number: string): ReceiptLayoutView {
  const fmt = (minor: number) => formatMoney(money(minor, r.currency));
  return {
    number,
    issuedOn: shortIsoDate(r.issuedOn),
    issuer: {
      name: r.issuer.legalName ?? r.issuer.tradeName,
      lines: [r.issuer.address, r.issuer.gstin ? `GSTIN ${r.issuer.gstin}` : null, r.issuer.email].filter(
        (x): x is string => typeof x === "string" && x !== "",
      ),
    },
    receivedFrom: { name: r.receivedFrom.name, gstin: r.receivedFrom.gstin },
    amount: fmt(r.amountMinor),
    amountWords: r.amountWords,
    receivedOn: shortIsoDate(r.receivedOn),
    paidBy: paidByWords(r.provider, r.mode),
    reference: r.reference,
    appliedTo: r.appliedTo.map((a) => ({ number: a.number, amount: fmt(a.amountMinor) })),
    appliedMore: r.appliedMore,
    heldAsCredit: r.heldAsCreditMinor > 0 ? fmt(r.heldAsCreditMinor) : null,
    logo: "logo-primary-color.svg",
    footerBrand: footerLine(r.issuer.email || DEFAULT_CONTACT_EMAIL),
  };
}
