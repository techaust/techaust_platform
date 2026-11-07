// The statement of account layout (layout/statement.ts; M5.5b, ADM-CLI-04, JOB-PDF-01; docs/06 §7.1 to §7.3; words 07-V §6.1): the title, the period
// and currency, the four figures (the closing on the double rule), "Amount due" only when the client owes something, the ledger with the opening and
// closing rows, every line kind in 07-V's words, the billing@ lines and the page footer, escaping, the CSP and no network reference; short, long (200
// entries) and long-name fixtures. Sample data only, clearly fake.
import { STATEMENT_REFUND_RETURNED_NOTE, STATEMENT_REFUND_RETURNED_WORD } from "@techaust/core/copy-zu";
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
  returnedNote: null,
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

// AU45 (07-ZU): an overpayment refunded on 03 Nov that the card network returned on 05 Dec. Sample data only: the refund id is made up.
const returned: StatementLayoutView = {
  ...base,
  period: { from: "01 Nov 26", to: "31 Dec 26" },
  opening: "₹0.00",
  debits: "₹1,20,000.00",
  credits: "₹1,40,000.00",
  closing: "−₹20,000.00",
  amountDue: null,
  entries: [
    {
      date: "02 Nov 26",
      number: "TH/INV/2627/0007",
      kind: "tax_invoice",
      againstNumber: null,
      debit: "₹1,00,000.00",
      credit: null,
      balance: "₹1,00,000.00",
    },
    {
      date: "02 Nov 26",
      number: "TH/INV/2627/0007",
      kind: "receipt",
      againstNumber: null,
      debit: null,
      credit: "₹1,20,000.00",
      balance: "−₹20,000.00",
    },
    {
      date: "03 Nov 26",
      number: "rfnd_SAMPLE0001",
      kind: "refund",
      againstNumber: null,
      debit: "₹20,000.00",
      credit: null,
      balance: "₹0.00",
    },
    {
      date: "05 Dec 26",
      number: "rfnd_SAMPLE0001",
      kind: "refund_returned",
      againstNumber: null,
      debit: null,
      credit: "₹20,000.00",
      balance: "−₹20,000.00",
    },
  ],
  returnedNote: STATEMENT_REFUND_RETURNED_NOTE,
};

describe("AU45: a refund that came back (07-ZU)", () => {
  const rowOf = (html: string, details: string): string =>
    (html.match(/<tr data-testid="entry">[\s\S]*?<\/tr>/g) ?? []).find((r) =>
      r.includes(`<td class="c-details">${details}</td>`),
    ) ?? "";

  it("prints like the refund it reverses: the refund id, U1 as its details, the amount in the Credit column", () => {
    expect(detailsOf("refund_returned", null)).toBe("Refund came back");
    expect(detailsOf("refund_returned", null)).toBe(STATEMENT_REFUND_RETURNED_WORD);
    const html = body(renderStatementHtml(returned));
    const back = rowOf(html, "Refund came back");
    expect(back).toBe(
      '<tr data-testid="entry"><td class="c-date">05 Dec 26</td><td class="c-doc">rfnd_SAMPLE0001</td><td class="c-details">Refund came back</td><td class="num"></td><td class="num">₹20,000.00</td><td class="num">−₹20,000.00</td></tr>',
    );
    // the refund itself stays a debit, on the day it went out
    expect(rowOf(html, C.kinds.refund)).toContain(
      '<td class="c-date">03 Nov 26</td><td class="c-doc">rfnd_SAMPLE0001</td>',
    );
    expect(rowOf(html, C.kinds.refund)).toContain('<td class="num">₹20,000.00</td><td class="num"></td>');
  });

  it("prints U2 once, first in the last lines (it travels with the closing row), and never without the kind", () => {
    const html = body(renderStatementHtml(returned));
    expect(html.split(STATEMENT_REFUND_RETURNED_NOTE).length - 1).toBe(1);
    expect((html.match(/data-testid="returned-note"/g) ?? []).length).toBe(1);
    expect(html).toContain(
      `<footer class="stm-foot"><p class="stm-note" data-testid="returned-note">${STATEMENT_REFUND_RETURNED_NOTE}</p><p class="stm-questions">`,
    );
    expect(html.indexOf("returned-note")).toBeGreaterThan(html.indexOf("stm-edge--closing"));
    expect(STATEMENT_CSS).toMatch(/\.stm-foot \{[^}]*break-inside: avoid; break-before: avoid;/);
    const none = body(renderStatementHtml(base));
    expect(none).not.toContain("returned-note");
    expect(none).not.toContain(STATEMENT_REFUND_RETURNED_NOTE);
  });

  it("escapes the note", () => {
    const html = body(renderStatementHtml({ ...returned, returnedNote: 'Sample <b>note</b> & "quotes"' }));
    expect(html).not.toContain("<b>note</b>");
    expect(html).toContain("Sample &lt;b&gt;note&lt;/b&gt; &amp; &quot;quotes&quot;");
  });

  it("a closing below zero with the note: the closing on the double rule, no Amount due", () => {
    const html = body(renderStatementHtml(returned));
    expect(html).toContain('data-testid="closing">−<span data-testid="rupee">₹</span>20,000.00</dd>');
    expect(html).not.toContain('data-testid="amount-due"');
    expect(html).toContain("Closing balance");
    expect(html).toContain(STATEMENT_REFUND_RETURNED_NOTE);
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
