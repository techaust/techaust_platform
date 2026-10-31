// M5.4 portal invoice rules (lib/invoices.ts, copy-invoices.ts): the status a client reads, quantities as text, 07-U word for word, and the invoice
// link's token (taken from `/i#t=`, stripped from the address, kept for the tab only).

import { PROFORMA_PDF_COPY } from "@techaust/pdf/copy";
import { describe, expect, it } from "vitest";
import { documentWord, INV } from "../copy-invoices.ts";
import {
  clientStatus,
  minusMoneyText,
  moneyText,
  noteReasonLines,
  qtyText,
  takeInvoiceToken,
  totalsRows,
  typeLabel,
} from "./invoices.ts";

describe("FX-4 review M1 (A5 5): a marked proforma's tax heads read as estimates, in the PDF's words [POR-06]", () => {
  const t = (o: Partial<Parameters<typeof totalsRows>[0]["totals"]>) => ({
    subtotalMinor: 100_000,
    discountMinor: 0,
    taxableMinor: 100_000,
    cgstMinor: 0,
    sgstMinor: 0,
    igstMinor: 0,
    roundOffMinor: 0,
    totalMinor: 118_000,
    totalInrMinor: null,
    ...o,
  });
  const intra = t({ cgstMinor: 9_000, sgstMinor: 9_000 });
  const inter = t({ igstMinor: 18_000 });
  const labels = (d: Parameters<typeof totalsRows>[0]) => totalsRows(d).map((r) => r.label);
  it("with the marker: CGST, SGST and IGST each say (estimate), exactly as the PDF prints them", () => {
    expect(labels({ type: "proforma", currency: "INR", totals: intra, gstEstimate: true })).toEqual([
      "Taxable value",
      "CGST (estimate)",
      "SGST (estimate)",
      "Total",
    ]);
    expect(labels({ type: "proforma", currency: "INR", totals: inter, gstEstimate: true })).toEqual([
      "Taxable value",
      PROFORMA_PDF_COPY.estimate("IGST"),
      "Total",
    ]);
  });
  it("a proforma sealed before FX-4 (no marker, or an older API without the field) keeps the plain heads", () => {
    expect(labels({ type: "proforma", currency: "INR", totals: inter, gstEstimate: false })).toContain(
      "IGST",
    );
    expect(labels({ type: "proforma", currency: "INR", totals: intra })).toEqual([
      "Taxable value",
      "CGST",
      "SGST",
      "Total",
    ]);
  });
  it("never on another type, even if a stray flag came with it", () => {
    for (const type of ["tax_invoice", "export_invoice", "debit_note", "credit_note"])
      expect(labels({ type, currency: "INR", totals: intra, gstEstimate: true })).not.toContain(
        "CGST (estimate)",
      );
  });
});

/** 07-U was approved on 2026-10-28 (research and wording): its lines carry no mark. */
const M = "";

describe("the client's status [POR-06]", () => {
  const today = "2026-11-10";
  const d = (o: Partial<{ type: string; status: string; balanceMinor: number; dueDate: string | null }>) => ({
    type: "tax_invoice",
    status: "issued",
    balanceMinor: 100,
    dueDate: "2026-11-12",
    ...o,
  });
  it("due until the due date, overdue the day after, from the balance (never a sum here)", () => {
    expect(clientStatus(d({}), today)).toBe("due");
    expect(clientStatus(d({ dueDate: today }), today)).toBe("due");
    expect(clientStatus(d({ dueDate: "2026-11-09" }), today)).toBe("overdue");
    expect(clientStatus(d({ status: "partially_paid", dueDate: "2026-11-01" }), today)).toBe("overdue");
  });
  it("paid, credited and void; a credit note has no status of its own", () => {
    expect(clientStatus(d({ status: "paid", balanceMinor: 0 }), today)).toBe("paid");
    expect(clientStatus(d({ status: "credited", balanceMinor: 0 }), today)).toBe("credited");
    expect(clientStatus(d({ status: "converted", type: "proforma", balanceMinor: 0 }), today)).toBe("paid");
    expect(clientStatus(d({ status: "converted", type: "proforma", balanceMinor: 50 }), today)).toBe("due");
    expect(clientStatus(d({ status: "void" }), today)).toBe("void");
    expect(clientStatus(d({ type: "credit_note", balanceMinor: 0, dueDate: null }), today)).toBeNull();
  });
  it("ADM-INV-10: a withdrawn payment request reads Withdrawn (its balance is null), never Paid", () => {
    const w = { type: "proforma", status: "withdrawn", balanceMinor: null, dueDate: null };
    expect(clientStatus(w, today)).toBe("withdrawn");
    expect(clientStatus({ ...w, balanceMinor: 100, dueDate: "2026-11-01" }, today)).toBe("withdrawn");
  });
});

describe("text", () => {
  it("quantities from milli-units, as the PDF prints them", () => {
    expect(qtyText(1000)).toBe("1");
    expect(qtyText(1500)).toBe("1.5");
    expect(qtyText(250)).toBe("0.25");
    expect(qtyText(12_000)).toBe("12");
  });
  it("money through core, in the document's currency", () => {
    expect(moneyText(2_360_000, "INR")).toBe("₹23,600.00");
    expect(moneyText(240_000, "USD")).toBe("$2,400.00");
    expect(minusMoneyText(500_000, "INR")).toContain("5,000.00");
    expect(minusMoneyText(500_000, "INR")).not.toBe(moneyText(500_000, "INR"));
  });
  it("07-U and 07-W words carry no mark", () => {
    expect(INV.signInHint).toBe(
      "Sign in to your client portal to see all your invoices and payment requests in one place.",
    );
    expect(INV.empty).toBe(`${M}No invoices yet. When we send you one, it appears here.`);
    expect(INV.howToPay("proforma", "TH/PRO/2627/0002")).toBe(
      `${M}Pay by bank transfer to the account shown on the payment request. Please quote TH/PRO/2627/0002 as the payment reference.`,
    );
    expect(INV.linkEnded).toBe(
      `${M}This link no longer works. Sign in to your client portal to see your invoices, or ask us for a new link at contact@techaust.com.`,
    );
    expect(INV.againstInvoice("TH/INV/2627/0004")).toBe(`${M}Against invoice TH/INV/2627/0004`);
    expect(typeLabel("proforma")).toBe(`${M}Payment request`);
    expect(typeLabel("export_invoice")).toBe(`${M}Export invoice`);
    expect(INV.pdf.howToPay).toBe("How to pay");
    expect(INV.title).toBe("Invoices");
    expect(INV.downloadPdf).toBe("Download PDF");
    expect(documentWord("debit_note")).toBe("debit note");
  });
  it("07-ZA item 11: the Credited row names the credit notes, and never shows empty brackets [POR-06]", () => {
    expect(INV.credited(["TH/CN/2627/0001"])).toBe("Credited (TH/CN/2627/0001)");
    expect(INV.credited(["TH/CN/2627/0001", "TH/CN/2627/0002"])).toBe(
      "Credited (TH/CN/2627/0001, TH/CN/2627/0002)",
    );
    expect(INV.credited([])).toBe("Credited");
  });
  it("a note's reason reads as its PDF prints it, in 07-T §3's words from core's one map [POR-06]", () => {
    expect(noteReasonLines(null)).toBeNull();
    expect(noteReasonLines(undefined)).toBeNull();
    expect(noteReasonLines({ code: "service_deficient", text: "" })).toEqual({
      line: "Reason: Service deficient",
      detail: null,
    });
    expect(noteReasonLines({ code: "price_correction", text: " Rate typed wrong " })).toEqual({
      line: "Reason: Price correction",
      detail: "Rate typed wrong",
    });
    expect(noteReasonLines({ code: "other", text: "Goodwill" })).toEqual({
      line: "Reason: Goodwill",
      detail: null,
    });
    expect(noteReasonLines({ code: "other", text: " " })).toEqual({ line: "Reason: Other", detail: null });
    expect(noteReasonLines({ code: "tax_charged_too_low", text: "" })?.line).toBe(
      "Reason: Tax charged too low",
    );
  });
});

describe("the invoice link's token (POR-06)", () => {
  const token = `I${"a".repeat(42)}`;
  const store = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };
  it("takes #t= on /i, strips the fragment from the address and keeps the token for the tab", () => {
    const replaced: string[] = [];
    const hist = { replaceState: (_d: unknown, _u: string, url?: string) => void replaced.push(url ?? "") };
    const s = store();
    expect(takeInvoiceToken({ pathname: "/i", search: "", hash: `#t=${token}` }, hist, s)).toBe(token);
    expect(replaced).toEqual(["/i"]);
    // a reload of the tab still has it
    expect(takeInvoiceToken({ pathname: "/i", search: "", hash: "" }, hist, s)).toBe(token);
  });
  it("only on /i, and only a token of the right shape", () => {
    const hist = { replaceState: () => undefined };
    expect(takeInvoiceToken({ pathname: "/o", search: "", hash: `#t=${token}` }, hist, store())).toBeNull();
    expect(takeInvoiceToken({ pathname: "/i", search: "", hash: "#t=short" }, hist, store())).toBeNull();
    expect(takeInvoiceToken({ pathname: "/i", search: "", hash: `#t=${token}` }, hist, null)).toBe(token);
  });
});
