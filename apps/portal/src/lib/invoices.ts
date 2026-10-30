// What the invoice screens share (M5.4; POR-06, Q49, LD62): the status a client reads, amounts and quantities as text, and the invoice link's token.
// Nothing here adds up money: every amount is the server's (minor units from the frozen row), formatted through core; the status is chosen from the
// server's status, balance and due date, never computed from amounts.
import { istDate, toIsoDate } from "@techaust/core/dates";
import { formatMoney, money, negate } from "@techaust/core/money";
import type { InvoiceSummary } from "../api.ts";
import { INV } from "../copy-invoices.ts";

/** An amount of the document's currency, as core formats it (₹23,600.00, $1,200.00). */
export const moneyText = (minor: number, currency: string) =>
  formatMoney(money(minor, currency === "USD" ? "USD" : "INR"));

/** A deduction as the PDF prints it (core's `negate`, never a sum here): the discount line. */
export const minusMoneyText = (minor: number, currency: string) =>
  formatMoney(negate(money(minor, currency === "USD" ? "USD" : "INR")));

/** Milli-units as a decimal text: 1000 is "1", 1500 is "1.5" (the PDF's own rule). */
export function qtyText(qtyMilli: number): string {
  const s = String(Math.abs(qtyMilli)).padStart(4, "0");
  const whole = s.slice(0, -3);
  const frac = s.slice(-3).replace(/0+$/, "");
  return `${qtyMilli < 0 ? "-" : ""}${whole}${frac === "" ? "" : `.${frac}`}`;
}

/** 07-U §3's five statuses; a credit note owes nothing, so it has none of its own. */
export type ClientInvoiceStatus = "due" | "overdue" | "paid" | "credited" | "void" | null;

/** Today in IST as `YYYY-MM-DD` (the due dates are IST days). */
export const todayIst = (now = Date.now()): string => toIsoDate(istDate(now));

export function clientStatus(
  d: { type: string; status: string; balanceMinor: number; dueDate: string | null },
  today: string,
): ClientInvoiceStatus {
  if (d.status === "void") return "void";
  if (d.type === "credit_note") return null;
  if (d.balanceMinor > 0) return d.dueDate !== null && d.dueDate < today ? "overdue" : "due";
  if (d.status === "credited") return "credited";
  return "paid";
}

export const statusLabel = (s: Exclude<ClientInvoiceStatus, null>) => INV.status[s];

/**
 * A note's frozen reason as its PDF prints it (07-T §1, `packages/pdf/src/layout/invoice.ts`): "Reason: {label}", with the words typed for it on a line
 * of their own; for "Other", the words typed are the reason itself. Nothing for a document that isn't a note (final sweep P15).
 */
export function noteReasonLines(
  r: InvoiceSummary["noteReason"],
): { line: string; detail: string | null } | null {
  if (!r) return null;
  const typed = r.text.trim();
  const other = r.code === "other" && typed !== "";
  return {
    line: INV.pdf.reason(other ? typed : INV.pdf.reasonLabel(r.code)),
    detail: !other && typed !== "" ? typed : null,
  };
}

/**
 * The totals under the lines, as the PDF lists them (only the heads that apply; Total last and strong). Every amount is the server's, formatted here.
 * FX-4 review M1 (A5 5): a proforma sealed with the estimate marker (`gstEstimate`) names its tax heads "CGST (estimate)" as its PDF does; one sealed
 * before FX-4 (no marker, or an older API without the field) keeps the plain heads.
 */
export function totalsRows(d: Pick<InvoiceSummary, "type" | "currency" | "totals" | "gstEstimate">) {
  const t = d.totals;
  const m = (n: number) => moneyText(n, d.currency);
  const head = (h: string) => (d.type === "proforma" && d.gstEstimate === true ? INV.pdf.estimateHead(h) : h);
  const rows: { label: string; value: string; strong?: boolean }[] = [];
  if (t.discountMinor !== 0) {
    rows.push({ label: INV.pdf.totals.subtotal, value: m(t.subtotalMinor) });
    rows.push({ label: INV.pdf.totals.discount, value: minusMoneyText(t.discountMinor, d.currency) });
  }
  rows.push({ label: INV.pdf.totals.taxable, value: m(t.taxableMinor) });
  if (t.cgstMinor !== 0 || t.sgstMinor !== 0) {
    rows.push({ label: head(INV.pdf.totals.cgst), value: m(t.cgstMinor) });
    rows.push({ label: head(INV.pdf.totals.sgst), value: m(t.sgstMinor) });
  }
  if (t.igstMinor !== 0) rows.push({ label: head(INV.pdf.totals.igst), value: m(t.igstMinor) });
  if (t.roundOffMinor !== 0) rows.push({ label: INV.pdf.totals.roundOff, value: m(t.roundOffMinor) });
  rows.push({ label: INV.pdf.totals.total, value: m(t.totalMinor), strong: true });
  return rows;
}
export const typeLabel = (type: string) => INV.types[type] ?? INV.types.tax_invoice ?? type;

// ---- The invoice link (POR-06) ---------------------------------------------------------------------------------------------------------------
// The email's link is `<portal>/i#t=<token>` (`invoiceLinkUrl` in @techaust/core/offers): the fragment never reaches a server or a log. As the offer
// link (lib/offers.ts): read once before the app renders, stripped from the address bar and the history entry, kept for this tab only, and sent only
// in a request BODY.

export const INVOICE_LINK_PATH = "/i";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const KEY = "ta.invoice-link";

type Loc = { pathname: string; search: string; hash: string };
type Hist = { replaceState: (data: unknown, unused: string, url?: string) => void };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Reads `#t=` on the link's path and strips the fragment; a token of the wrong shape is no token. */
export function takeInvoiceToken(loc: Loc, hist: Hist, store: Store | null): string | null {
  if (loc.pathname !== INVOICE_LINK_PATH) return null;
  const { hash, pathname, search } = loc;
  if (hash) hist.replaceState(null, "", pathname + search);
  const t = new URLSearchParams(hash.replace(/^#/, "")).get("t");
  if (t && TOKEN.test(t)) {
    try {
      store?.setItem(KEY, t);
    } catch {
      // Storage refused (private mode): the token still works in memory for this page.
    }
    return t;
  }
  try {
    const kept = store?.getItem(KEY) ?? null;
    return kept && TOKEN.test(kept) ? kept : null;
  } catch {
    return null;
  }
}

let invoiceToken: string | null = null;

/** main.tsx calls this once, before the router is created. */
export function captureInvoiceToken(loc: Loc = location, hist: Hist = history) {
  let store: Store | null = null;
  try {
    store = window.sessionStorage;
  } catch {
    store = null;
  }
  invoiceToken = takeInvoiceToken(loc, hist, store);
}

export const capturedInvoiceToken = () => invoiceToken;

/** `TH/INV/2627/0007` → `TH-INV-2627-0007.pdf` (only when the server sends no name). */
export const invoicePdfName = (numberDisplay: string | null) =>
  `${(numberDisplay ?? "invoice").replaceAll("/", "-")}.pdf`;
