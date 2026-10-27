// M5.4 portal invoice rules (lib/invoices.ts, copy-invoices.ts): the status a client reads, quantities as text, the 07-U marks, and the invoice
// link's token (taken from `/i#t=`, stripped from the address, kept for the tab only).
import { describe, expect, it } from "vitest";
import { APPROVED_07U, documentWord, INV, PLACEHOLDER } from "../copy-invoices.ts";
import { clientStatus, minusMoneyText, moneyText, qtyText, takeInvoiceToken, typeLabel } from "./invoices.ts";

const M = `${PLACEHOLDER} `;

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
  it("07-U words are marked until the owner approves them; the PDF's words are not", () => {
    expect(APPROVED_07U).toBe(false);
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
