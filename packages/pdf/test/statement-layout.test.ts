// The statement of account layout (layout/statement.ts; M5.5b, ADM-CLI-04, JOB-PDF-01; docs/06 §7.1 to §7.3; words 07-V §6.1): the title, the period
// and currency, the four figures (the closing on the double rule), "Amount due" only when the client owes something, the ledger with the opening and
// closing rows, every line kind in 07-V's words, the billing@ lines and the page footer, escaping, the CSP and no network reference; short, long (200
// entries) and long-name fixtures. Sample data only, clearly fake.
import { describe, expect, it } from "vitest";
import { footerLine } from "../src/footer.ts";
import { STATEMENT_PDF_COPY as C } from "../src/layout/copy.ts";
import {
  detailsOf,
  renderStatementHtml,
  STATEMENT_CSS,
  type StatementLayoutView,
  statementPageCss,
} from "../src/layout/statement.ts";
import { DOCUMENT_CSP } from "../src/render.ts";

const body = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, "");

const base: StatementLayoutView = {
  title: "Statement of account SAMPLE01 01 Apr 26 to 28 Oct 26",
  logo: "logo-primary-color.svg",
  company: {
    name: "TecHaust Technologies",
    lines: [
      "Sample address line (fake), Balurghat, West Bengal 733101",
      "GSTIN 19ABCDE1234F1ZX · State West Bengal (19)",
      "billing@techaust.com",
    ],
  },
  client: {
    name: "Sample client A (fake)",
    lines: ["1 Sample Road, Kolkata, West Bengal 700001", "GSTIN 19ABCDE1234F1ZX"],
  },
  clientCode: "SAMPLE01",
  period: { from: "01 Apr 26", to: "28 Oct 26" },
  currency: "INR",
  opening: "₹0.00",
  debits: "₹1,41,600.00",
  credits: "₹23,600.00",
  closing: "₹1,18,000.00",
  amountDue: "₹1,18,000.00",
  entries: [
    {
      date: "02 May 26",
      number: "TH/INV/2627/0001",
      kind: "tax_invoice",
      againstNumber: null,
      debit: "₹1,18,000.00",
      credit: null,
      balance: "₹1,18,000.00",
    },
    {
      date: "10 Jun 26",
      number: "TH/DN/2627/0001",
      kind: "debit_note",
      againstNumber: null,
      debit: "₹23,600.00",
      credit: null,
      balance: "₹1,41,600.00",
    },
    {
      date: "20 Jun 26",
      number: "TH/CN/2627/0001",
      kind: "credit_note",
      againstNumber: "TH/INV/2627/0001",
      debit: null,
      credit: "₹23,600.00",
      balance: "₹1,18,000.00",
    },
  ],
  generatedOn: "28 Oct 26",
  email: "billing@techaust.com",
  footerBrand: footerLine("billing@techaust.com"),
};

describe("the statement page", () => {
  it("prints the title, the period and the currency in 07-V's words", () => {
    const html = body(renderStatementHtml(base));
    expect(html).toContain(`<h1 class="masthead__title">${C.title}</h1>`);
    expect(html).toContain("Period: 01 Apr 26 to 28 Oct 26");
    expect(html).toContain("Currency: INR");
    expect(html).toContain("<title>Statement of account SAMPLE01 01 Apr 26 to 28 Oct 26</title>");
  });

  it("prints the four figures with the closing balance on the double rule, and Amount due beside them", () => {
    const html = body(renderStatementHtml(base));
    for (const w of [C.opening, C.debits, C.credits, C.closing]) expect(html).toContain(`<dt>${w}</dt>`);
    expect(html).toContain('<div class="stm-fig stm-fig--closing">');
    expect(html).toContain('data-testid="amount-due">Amount due: ₹1,18,000.00</p>');
    expect(STATEMENT_CSS).toContain("double var(--color-text)");
  });

  it("prints no Amount due when nothing is owed (07-V: only above zero)", () => {
    const html = body(renderStatementHtml({ ...base, closing: "₹0.00", amountDue: null }));
    expect(html).not.toContain("Amount due");
  });

  it("lists the opening row, every entry in order with 07-V's details, then the closing row", () => {
    const html = body(renderStatementHtml(base));
    expect((html.match(/data-testid="entry"/g) ?? []).length).toBe(3);
    const order = [
      "Opening balance",
      "TH/INV/2627/0001",
      "TH/DN/2627/0001",
      "TH/CN/2627/0001",
      "Closing balance",
    ].map((s) => html.indexOf(s, html.indexOf("<table")));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain("Credit note against TH/INV/2627/0001");
    for (const h of Object.values(C.columns)) expect(html).toContain(`>${h}</th>`);
  });

  it("names every kind; a credit note without its invoice prints no guessed words", () => {
    expect(detailsOf("tax_invoice", null)).toBe("Invoice");
    expect(detailsOf("export_invoice", null)).toBe("Export invoice");
    expect(detailsOf("debit_note", null)).toBe("Debit note");
    expect(detailsOf("receipt", null)).toBe("Payment received");
    expect(detailsOf("credit_note", "TH/INV/2627/0002")).toBe("Credit note against TH/INV/2627/0002");
    expect(detailsOf("credit_note", null)).toBe("");
    // FX-4 (A5 7): a debit note names its invoice when the view has the number (07-Y, pending), else keeps 07-V's "Debit note"
    expect(detailsOf("debit_note", "TH/INV/2627/0002")).toBe("Debit note against TH/INV/2627/0002");
  });

  it("ends with the billing@ question and the day it was made; the page footer names billing@ and counts pages", () => {
    const html = body(renderStatementHtml(base));
    expect(html).toContain("Questions about this statement? Write to billing@techaust.com.");
    expect(html).toContain('data-testid="generated">Generated on 28 Oct 26.</p>');
    const page = statementPageCss(base);
    expect(page).toContain("billing@techaust.com");
    expect(page).toContain("counter(pages)");
    expect(page).toContain("SAMPLE01");
  });

  it("puts each currency sign in its own span (a USD statement too)", () => {
    expect(body(renderStatementHtml(base))).toContain('<span data-testid="rupee">₹</span>');
    const usd = body(
      renderStatementHtml({
        ...base,
        currency: "USD",
        opening: "$0.00",
        debits: "$10.00",
        credits: "$0.00",
        closing: "$10.00",
        amountDue: "$10.00",
      }),
    );
    expect(usd).toContain('<span data-testid="currency-symbol">$</span>');
    expect(usd).toContain("Currency: USD");
  });
});

describe("safety", () => {
  it("escapes every value; nothing from the data becomes markup", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const html = body(
      renderStatementHtml({
        ...base,
        client: { name: evil, lines: [evil] },
        entries: [{ ...base.entries[0], number: evil } as StatementLayoutView["entries"][number]],
      }),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("has the documents' CSP and no network reference", () => {
    const html = renderStatementHtml(base);
    expect(html).toContain(`content="${DOCUMENT_CSP}"`);
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).not.toMatch(/url\((["'])?https?:/);
  });
});

describe("fixtures: long and long-named", () => {
  it("200 entries (the cap) all print, the header row repeats by the print CSS", () => {
    const entries = Array.from({ length: 200 }, (_, i) => ({
      ...(base.entries[0] as StatementLayoutView["entries"][number]),
      number: `TH/INV/2627/${String(i + 1).padStart(4, "0")}`,
    }));
    const html = body(renderStatementHtml({ ...base, entries }));
    expect((html.match(/data-testid="entry"/g) ?? []).length).toBe(200);
    expect(html).toContain("<thead>");
  });

  it("a very long client name and address wrap inside their block", () => {
    const long =
      "Sample client with an exceptionally long registered business name for testing (fake) Private Limited";
    const html = body(renderStatementHtml({ ...base, client: { name: long, lines: [long, long] } }));
    expect(html).toContain(long);
    expect(STATEMENT_CSS).toContain("overflow-wrap: anywhere");
  });
});
