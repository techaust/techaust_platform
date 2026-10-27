// The statement of account's view, hash and skeleton page [ADM-CLI-04, JOB-PDF-01; M5.5b, LD79; VERIFY WITH CA/LEGAL for what a statement lists]: pure formatting from integers, a content hash that
// ignores the day it was made but not the data or the layout, and a page that escapes every value and loads nothing from outside. All names, numbers and amounts are invented.
import { describe, expect, it } from "vitest";
import { statementBody, statementCss } from "../src/layout/statement-skeleton.ts";
import { DOCUMENT_CSP, renderStatementHtml, statementViewSha256 } from "../src/render.ts";
import type { StatementViewInput } from "../src/types.ts";
import { STATEMENT_SKELETON_LAYOUT, statementView } from "../src/view.ts";

const input = (over: Partial<StatementViewInput> = {}): StatementViewInput => ({
  company: {
    tradeName: "TecHaust Technologies",
    legalName: "TecHaust Technologies (Sample)",
    address: "1 Sample Road, Balurghat, West Bengal",
    gstin: "19AAAAA0000A1Z5",
    stateCode: "19",
    logo: "logo-primary-color.svg",
  },
  client: {
    legalName: "Sample Client Private Limited",
    address: {
      line1: "12 Test Street",
      city: "Kolkata",
      state: "West Bengal",
      postalCode: "700001",
      country: "IN",
    },
    gstin: "19BBBBB1111B1Z5",
  },
  currency: "INR",
  from: "2026-10-01",
  to: "2026-10-31",
  openingMinor: 5_000_00,
  entries: [
    {
      kind: "tax_invoice",
      date: "2026-10-05",
      number: "TH/INV/2627/0001",
      amountMinor: 11_800_00,
      debitMinor: 11_800_00,
      creditMinor: 0,
      balanceMinor: 16_800_00,
    },
    {
      kind: "credit_note",
      date: "2026-10-12",
      number: "TH/CN/2627/0001",
      amountMinor: 1_180_00,
      debitMinor: 0,
      creditMinor: 1_180_00,
      balanceMinor: 15_620_00,
      againstNumber: "TH/INV/2627/0001",
    },
  ],
  debitMinor: 11_800_00,
  creditMinor: 1_180_00,
  closingMinor: 15_620_00,
  billingEmail: "billing@example.test",
  generatedOn: "2026-10-28",
  ...over,
});

describe("statementView", () => {
  it("formats every amount from its integer, in the statement's currency, and leaves the empty side blank", () => {
    const v = statementView(input());
    expect(v.opening).toBe("₹5,000.00");
    expect(v.closing).toBe("₹15,620.00");
    expect(v.totalDebits).toBe("₹11,800.00");
    expect(v.totalCredits).toBe("₹1,180.00");
    expect(v.amountDue).toBe("₹15,620.00");
    expect(v.entries.map((e) => [e.date, e.document, e.debit, e.credit, e.balance])).toEqual([
      ["05 Oct 26", "TH/INV/2627/0001", "₹11,800.00", "", "₹16,800.00"],
      ["12 Oct 26", "TH/CN/2627/0001", "", "₹1,180.00", "₹15,620.00"],
    ]);
    expect(v.entries[1]?.againstNumber).toBe("TH/INV/2627/0001");
    expect(v.from).toBe("01 Oct 2026");
    expect(v.to).toBe("31 Oct 2026");
    expect(v.generatedOn).toBe("28 Oct 2026");
    expect(v.layout).toBe(STATEMENT_SKELETON_LAYOUT);
    expect(v.company.lines).toEqual([
      "TecHaust Technologies (Sample)",
      "1 Sample Road, Balurghat, West Bengal",
      "GSTIN 19AAAAA0000A1Z5",
    ]);
    expect(v.client.lines).toEqual([
      "12 Test Street",
      "Kolkata, West Bengal, 700001",
      "India",
      "GSTIN 19BBBBB1111B1Z5",
    ]);
  });

  it("a USD statement is in dollars, and a closing balance of zero or below has no amount due", () => {
    const usd = statementView(input({ currency: "USD", closingMinor: 0 }));
    expect(usd.opening).toBe("$5,000.00");
    expect(usd.amountDue).toBeNull();
    expect(statementView(input({ closingMinor: -1_00 })).amountDue).toBeNull();
    expect(statementView(input({ closingMinor: -1_00 })).closing).toBe("−₹1.00");
  });

  it("a company without a separate legal name, address or GSTIN prints only what it has; a client without an address prints none", () => {
    const v = statementView(
      input({
        company: {
          tradeName: "TecHaust",
          legalName: "TecHaust",
          address: null,
          gstin: null,
          stateCode: "19",
          logo: "x.svg",
        },
        client: { legalName: "A", address: null, gstin: null },
      }),
    );
    expect(v.company.lines).toEqual([]);
    expect(v.client.lines).toEqual([]);
  });

  it("an amount that is not a whole number of minor units is refused, never rounded", () => {
    expect(() => statementView(input({ closingMinor: 1.5 }))).toThrow();
  });
});

describe("statementViewSha256", () => {
  it("does not depend on the day it was made, and does depend on the data and on the layout", async () => {
    const a = await statementViewSha256(statementView(input()));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await statementViewSha256(statementView(input({ generatedOn: "2026-11-30" })))).toBe(a);
    expect(await statementViewSha256(statementView(input({ closingMinor: 15_621_00 })))).not.toBe(a);
    expect(await statementViewSha256(statementView(input(), "statement-designed-1"))).not.toBe(a);
    expect(await statementViewSha256(statementView(input({ billingEmail: "other@example.test" })))).not.toBe(
      a,
    );
  });
});

describe("the skeleton page", () => {
  it("prints the words of 07-V and every value, with the credit note naming its invoice", () => {
    const html = renderStatementHtml(statementView(input()));
    const body = html.replace(/<style>[\s\S]*?<\/style>/, "");
    expect(body).toContain("Statement of account");
    expect(body).toContain("Period: 01 Oct 2026 to 31 Oct 2026");
    expect(body).toContain("Currency: INR");
    expect(body).toContain("Credit note against TH/INV/2627/0001");
    expect(body).toContain(">Invoice<");
    expect(body).toContain('data-testid="opening">₹5,000.00<');
    expect(body).toContain('data-testid="closing">₹15,620.00<');
    expect(body).toContain("Amount due: ₹15,620.00");
    expect(body).toContain("Questions about this statement? Write to billing@example.test.");
    expect(body).toContain("Generated on 28 Oct 2026.");
    expect((body.match(/data-testid="entry"/g) ?? []).length).toBe(2);
    expect(html).toContain(DOCUMENT_CSP);
  });

  it("no amount due line for a settled statement, and 'Payment received' for a receipt", () => {
    const v = statementView(
      input({
        closingMinor: 0,
        entries: [
          {
            kind: "receipt",
            date: "2026-10-06",
            number: "TH/INV/2627/0002",
            amountMinor: 590_00,
            debitMinor: 0,
            creditMinor: 590_00,
            balanceMinor: 0,
          },
        ],
      }),
    );
    const body = statementBody(v);
    expect(body).not.toContain("Amount due");
    expect(body).toContain("Payment received");
  });

  it("escapes every dynamic value and loads nothing from outside", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const v = statementView(
      input({
        client: { legalName: evil, address: { line1: evil, city: "x", country: "IN" }, gstin: null },
        billingEmail: `a"b<c>@example.test`,
      }),
    );
    const html = renderStatementHtml(v);
    const body = html.replace(/<style>[\s\S]*?<\/style>/, "");
    expect(body).not.toContain("<img src=x");
    expect(body).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(body).not.toMatch(/(?:src|href)="https?:/);
    // the page footer line is a CSS string: a quote or a backslash in the address cannot end it
    const css = statementCss(v);
    expect(css).toContain("content:");
    expect(css).not.toContain('a"b<c>');
  });
});
