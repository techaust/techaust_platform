// The statement of account's view and content hash [ADM-CLI-04, JOB-PDF-01; M5.5b, LD79; VERIFY WITH CA/LEGAL for what a statement lists]: pure formatting from integers into the designer's layout contract
// (`StatementLayoutView`), a content hash that ignores the day it was made but not the data or the layout, and the page the designer's layout makes from it. All names, numbers and amounts are invented.
import { describe, expect, it } from "vitest";
import { renderStatementHtml, statementViewSha256 } from "../src/render.ts";
import {
  STATEMENT_LAYOUT_ID,
  type StatementView,
  type StatementViewInput,
  statementView,
} from "../src/statement-view.ts";

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
    code: "T0042",
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
  it("formats every amount from its integer, in the statement's currency, and leaves the empty side null", () => {
    const v: StatementView = statementView(input());
    expect(v.opening).toBe("₹5,000.00");
    expect(v.closing).toBe("₹15,620.00");
    expect(v.debits).toBe("₹11,800.00");
    expect(v.credits).toBe("₹1,180.00");
    expect(v.amountDue).toBe("₹15,620.00");
    expect(v.entries.map((e) => [e.date, e.number, e.kind, e.debit, e.credit, e.balance])).toEqual([
      ["05 Oct 26", "TH/INV/2627/0001", "tax_invoice", "₹11,800.00", null, "₹16,800.00"],
      ["12 Oct 26", "TH/CN/2627/0001", "credit_note", null, "₹1,180.00", "₹15,620.00"],
    ]);
    // 07-V §6: the credit note names the invoice it is against
    expect(v.entries[1]?.againstNumber).toBe("TH/INV/2627/0001");
    expect(v.entries[0]?.againstNumber).toBeNull();
    expect(v.period).toEqual({ from: "01 Oct 26", to: "31 Oct 26" });
    expect(v.generatedOn).toBe("28 Oct 26");
    expect(v.title).toBe("Statement of account T0042 01 Oct 26 to 31 Oct 26");
    expect(v.clientCode).toBe("T0042");
    expect(v.email).toBe("billing@example.test");
    expect(v.footerBrand).toBe("TecHaust Technologies · techaust.com · billing@example.test");
    expect(v.logo).toBe("logo-primary-color.svg");
    expect(v.company.lines).toEqual([
      "TecHaust Technologies (Sample)",
      "1 Sample Road, Balurghat, West Bengal",
      "GSTIN 19AAAAA0000A1Z5",
      "State West Bengal (19)",
      "billing@example.test",
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
        client: { code: "T1", legalName: "A", address: null, gstin: null },
      }),
    );
    expect(v.company.lines).toEqual(["State West Bengal (19)", "billing@example.test"]);
    expect(v.client.lines).toEqual([]);
  });

  it("an amount that is not a whole number of minor units is refused, never rounded", () => {
    expect(() => statementView(input({ closingMinor: 1.5 }))).toThrow();
  });
});

describe("statementViewSha256", () => {
  it("depends on the IST day it was made (finding 5), the data and the address", async () => {
    const a = await statementViewSha256(statementView(input()));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    // the same day: the same hash; another day: another one (a later request renders afresh)
    expect(await statementViewSha256(statementView(input({ generatedOn: "2026-10-28" })))).toBe(a);
    expect(await statementViewSha256(statementView(input({ generatedOn: "2026-11-30" })))).not.toBe(a);
    expect(await statementViewSha256(statementView(input({ closingMinor: 15_621_00 })))).not.toBe(a);
    expect(await statementViewSha256(statementView(input({ billingEmail: "other@example.test" })))).not.toBe(
      a,
    );
  });

  it("the layout id is part of the hash: the same view under another layout id would be another object", async () => {
    expect(STATEMENT_LAYOUT_ID).toBe("statement-1");
    const v = statementView(input());
    const content = v;
    const { canonicalJson, sha256Hex } = await import("../src/hash.ts");
    expect(await statementViewSha256(v)).toBe(
      await sha256Hex(canonicalJson({ layout: "statement-1", ...content })),
    );
    expect(await statementViewSha256(v)).not.toBe(
      await sha256Hex(canonicalJson({ layout: "statement-2", ...content })),
    );
  });
});

describe("the page the designer's layout makes from the view", () => {
  it("prints the view: the credit note names its invoice, the amount due, the billing address and the day it was made", () => {
    const html = renderStatementHtml(statementView(input()));
    const body = html.replace(/<style>[\s\S]*?<\/style>/, "");
    expect(body).toContain("Statement of account");
    expect(body).toContain("Credit note against TH/INV/2627/0001");
    expect(body).toContain("TH/CN/2627/0001");
    expect(body).toContain("Write to billing@example.test.");
    expect(body).toContain("Generated on 28 Oct 26.");
    expect((body.match(/data-testid="entry"/g) ?? []).length).toBe(2);
    expect(body).toContain('data-testid="amount-due"');
  });

  it("a settled statement has no amount due line", () => {
    const html = renderStatementHtml(statementView(input({ closingMinor: 0 })));
    expect(html).not.toContain('data-testid="amount-due"');
  });
});
