// T11: the deed's unsigned PDF HTML, the builder's placeholder layout (layout/deed.ts): every part of core `deedText` in order, escaped, the empty signature
// space after the signature sentence (L5), the stamp-duty footer (OPEN (08-C RB-21)), nothing external, and the placeholder flag that keeps jobs from storing it
// outside local. The designer replaces the layout and these expectations. Names and amounts are invented test data. [RB-38(a), RB-21]
import { type DeedSnapshot, deedText } from "@techaust/core/deeds";
import { describe, expect, it } from "vitest";
import { DEED_LAYOUT_PLACEHOLDER, esc, renderDeedHtml } from "../src/index.ts";

const snapshot: DeedSnapshot = {
  layout: "deed-v1",
  madeOn: "2026-11-01",
  supplier: { address: "1 Example Road, Balurghat, West Bengal 733101", gstin: "19ABCDE1234F1Z5" },
  client: { legalName: "Example <Traders> & Co", address: "4 Sample Street, Kolkata, India", reg: null },
  offer: { docType: "proposal", number: "TH/PRP/2627/0007", version: 2, acceptedOn: "2026-10-05" },
  payment: { invoiceNumbers: ["TH/INV/2627/0009"], amountPaidMinor: 100_000, currency: "INR" },
  schedule1: { deliverables: "Website source", location: "Git repository", deliveredDates: "28 Oct 2026" },
  schedule2: { tools: "None", thirdParty: "Astro (MIT licence)" },
};

describe("the deed's placeholder layout [T11]", () => {
  const t = deedText(snapshot, "TH/DA/2627/0001");
  const html = renderDeedHtml(t);

  it("prints the title, the parties, every clause, the signature sentence, both Schedules and the stamp-duty footer, in order", () => {
    const at = (s: string) => {
      const i = html.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      at("Deed of assignment of copyright · No. TH/DA/2627/0001"),
      at("Example &lt;Traders&gt; &amp; Co"),
      ...t.clauses.map((c) => at(esc(`${c.n}. ${c.heading}`))),
      at("Signed by the assignor with an Aadhaar-based electronic signature (eSign)"),
      at("Schedule 1, the work"),
      at("Schedule 2, not assigned"),
      at("Stamp duty: Not stamped at signing."),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain("<Traders>");
  });

  it("leaves the signature space empty, loads nothing external, and is marked a placeholder", () => {
    expect(html).toMatch(/<div class="sign-space"><\/div>/);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).toContain("[Placeholder] layout");
    expect(DEED_LAYOUT_PLACEHOLDER).toBe(true);
  });
});
