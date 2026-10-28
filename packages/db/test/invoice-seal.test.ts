// The seal of an issued invoice (M5.1, LD4): the Rule 46(p) reverse-charge statement is part of the frozen issuer block, so it is part of the
// hash too (the analyst's early check, required 1). Researched 2026-10-28, ss.13 and 31 CGST Act, Rules 50 and 51 (08-C RA-17).
import { describe, expect, it } from "vitest";
import { type InvoiceSealParts, invoiceSealOf } from "../src/documents.ts";
import type { InvoiceIssuerSnapshot } from "../src/schema/documents.ts";

const issuer: InvoiceIssuerSnapshot = {
  company: {
    tradeName: "TecHaust Technologies",
    legalName: "Rupak Sarkar trading as TecHaust Technologies",
    address: "1 Example Road",
    gstin: null,
    stateCode: "19",
    logo: "logo-primary-color.svg",
  },
  bank: { inr: null },
  signature: null,
  reverseChargeText: "Tax payable on reverse charge: No",
  sender: { staffId: "s1", name: "Owner", email: "billing@example.com" },
};

const parts = (over: Partial<InvoiceSealParts> = {}): InvoiceSealParts => ({
  document: {
    type: "tax_invoice",
    clientId: "c1",
    currency: "INR",
    issueDate: "2026-10-28",
    dueDate: "2026-11-04",
    contentSha256: "a".repeat(64),
    termsRef: null,
    exportMode: null,
  },
  computed: { supply: { type: "intra", placeOfSupplyCode: "19", supplierStateCode: "19" } } as never,
  recipient: { legalName: "Client", country: "IN" } as never,
  issuer,
  ...over,
});

describe("the reverse-charge statement is sealed with the invoice [ADM-INV-03]", () => {
  it("the statement is in the sealed header, and changing one word changes the snapshot hash", async () => {
    const a = await invoiceSealOf(parts());
    expect(JSON.stringify(a.input.issuer)).toContain("Tax payable on reverse charge: No");
    const b = await invoiceSealOf(
      parts({ issuer: { ...issuer, reverseChargeText: "Tax payable on reverse charge: Yes" } }),
    );
    expect(b.snapshotSha256).not.toBe(a.snapshotSha256);
    expect(b.computedSha256).toBe(a.computedSha256);
    // the same statement seals to the same hash
    expect((await invoiceSealOf(parts())).snapshotSha256).toBe(a.snapshotSha256);
  });
});
