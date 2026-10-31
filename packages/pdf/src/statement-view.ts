// The statement of account's view (M5.5b stage B, LD79; ADM-CLI-04, JOB-PDF-01): the rows the jobs Worker reads, formatted into the designer's layout contract (`StatementLayoutView`, `layout/statement.ts`).
// Kept out of `types.ts` and `view.ts` on purpose: those two are the portal's view entry and must never reach a layout (test/m45.test.ts). Jobs only.
import { formatMoney, money } from "@techaust/core/money";
import { placeOfSupplyLabel } from "@techaust/core/pdf-jobs";
import { footerLine } from "./footer.ts";
import { countryName, shortIsoDate } from "./format.ts";
import type { StatementLayoutView } from "./layout/statement.ts";
import type { Address } from "./types.ts";

/** One line of a statement as the jobs Worker reads it: the amount is positive and the kind says which side it is on (`@techaust/core/statement`). */
export type StatementInputEntry = {
  kind: "tax_invoice" | "export_invoice" | "debit_note" | "credit_note" | "receipt" | "tds";
  /** ISO date (IST): the issue date, or the day the money arrived. */
  date: string;
  /** The document's printed number (a receipt shows the number of the invoice it paid). */
  number: string;
  amountMinor: number;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
  /** A credit or debit note: the invoice it is against (FX-4: debit notes too). */
  againstNumber?: string | null;
};

/** Everything `statementView` needs: the company block frozen at the request, the client as it is now, the range and the lines. */
export type StatementViewInput = {
  company: {
    tradeName: string;
    legalName: string | null;
    address: string | null;
    gstin: string | null;
    stateCode: string;
    logo: string;
    email?: string;
  };
  client: {
    /** The client's code (the page footer carries it beside the page count). */
    code: string;
    legalName: string;
    address?: Partial<Address> | null;
    gstin?: string | null;
  };
  currency: "INR" | "USD";
  from: string;
  to: string;
  openingMinor: number;
  entries: readonly StatementInputEntry[];
  debitMinor: number;
  creditMinor: number;
  closingMinor: number;
  /** The address the footer sends questions to (Settings "Email" senders, billing). */
  billingEmail: string;
  /** The IST date the PDF was made, ISO. Part of the content hash: identical data is reused within one IST day only. */
  generatedOn: string;
};

/**
 * The pre-formatted statement: the designer's layout contract (`layout/statement.ts`), so the jobs Worker's view and the page cannot drift apart. Every value a layout prints is already a string
 * (no arithmetic at layout time); the words are the layout's (`STATEMENT_PDF_COPY`).
 */
export type StatementView = StatementLayoutView;

// ---- the statement of account (M5.5b, LD79; ADM-CLI-04; Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28) for what a statement lists, Q58) --------------------------------------------

/** The layout the page is made by: part of the content hash (`statementViewSha256`), so a new layout makes a new PDF for the same data. The designer bumps it with the layout. */
export const STATEMENT_LAYOUT_ID = "statement-2"; // M6.1: the lines come from the ledger (payments and TDS lines), so a cached statement made before is never reused

const addressLinesOf = (a: Partial<Address> | null | undefined): string[] => {
  if (!a) return [];
  const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const place = [clean(a.city), clean(a.state), clean(a.postalCode)].filter((p) => p !== "").join(", ");
  return [clean(a.line1), clean(a.line2), place, a.country ? countryName(clean(a.country)) : ""].filter(
    (l) => l !== "",
  );
};

/**
 * The pre-formatted statement, in the shape the layout asks for (`StatementLayoutView`). Pure: the same input always gives the same view. Money is formatted by core from the integers the database gave
 * (no arithmetic here); an amount that is not a safe integer throws (a bug, never a rounded figure), and the jobs Worker marks the row failed. Dates are the PDFs' short form. `generatedOn` is the only
 * value that varies between makings of identical data.
 */
export function statementView(input: StatementViewInput): StatementView {
  const fmt = (minor: number): string => formatMoney(money(minor, input.currency));
  const co = input.company;
  const from = shortIsoDate(input.from);
  const to = shortIsoDate(input.to);
  const companyLines = [
    co.legalName && co.legalName !== co.tradeName ? co.legalName : "",
    co.address ?? "",
    co.gstin ? `GSTIN ${co.gstin}` : "",
    `State ${placeOfSupplyLabel(co.stateCode, "intra")}`,
    input.billingEmail,
  ].filter((l) => l !== "");
  const clientLines = [
    ...addressLinesOf(input.client.address),
    input.client.gstin ? `GSTIN ${input.client.gstin}` : "",
  ].filter((l) => l !== "");
  return {
    title: `Statement of account ${input.client.code} ${from} to ${to}`,
    logo: co.logo,
    company: { name: co.tradeName, lines: companyLines },
    client: { name: input.client.legalName, lines: clientLines },
    clientCode: input.client.code,
    period: { from, to },
    currency: input.currency,
    opening: fmt(input.openingMinor),
    debits: fmt(input.debitMinor),
    credits: fmt(input.creditMinor),
    closing: fmt(input.closingMinor),
    amountDue: input.closingMinor > 0 ? fmt(input.closingMinor) : null,
    entries: input.entries.map((e) => ({
      date: shortIsoDate(e.date),
      number: e.number,
      kind: e.kind,
      againstNumber: e.againstNumber ?? null,
      debit: e.debitMinor === 0 ? null : fmt(e.debitMinor),
      credit: e.creditMinor === 0 ? null : fmt(e.creditMinor),
      balance: fmt(e.balanceMinor),
    })),
    generatedOn: shortIsoDate(input.generatedOn),
    email: input.billingEmail,
    footerBrand: footerLine(input.billingEmail),
  };
}
