// T11: the deed's unsigned PDF HTML (layout/deed.ts, the designed layout): every part of core `deedText` in 07-ZE's order and word for word, escaped; the title
// and its number on two lines with the metadata title whole; the signature sentence ending "TecHaust Technologies." (07-ZJ line 1) over an EMPTY signature
// space (L5: no words in it); the Schedules' typed line breaks kept; the stamp-duty line last (OPEN (08-C RB-21)); the house footer with the deed number;
// nothing external; no "[Placeholder]" anywhere (a deed PDF is stored write-once); and the flag that lets jobs render outside local. Names, numbers and
// amounts are invented test data. [RB-38(a), RB-21]
import { type DeedSnapshot, deedText } from "@techaust/core/deeds";
import { describe, expect, it } from "vitest";
import { DEED_PDF_COPY } from "../src/layout/copy.ts";
import { deedBody, deedTitleParts, unsignedSignatureLine } from "../src/layout/deed.ts";
import { DEED_LAYOUT_PLACEHOLDER, DEED_PDF_LAYOUT_ID, esc, renderDeedHtml } from "../src/index.ts";
import { DEED_FIXTURE_NAMES, deedFixture } from "./fixtures/deed.ts";

const snapshot: DeedSnapshot = {
  layout: "deed-v1",
  madeOn: "2026-11-01",
  supplier: { address: "1 Example Road, Balurghat, West Bengal 733101", gstin: "19ABCDE1234F1Z5" },
  client: { legalName: "Example <Traders> & Co", address: "4 Sample Street, Kolkata, India", reg: null },
  offer: { docType: "proposal", number: "TH/PRP/2627/0007", version: 2, acceptedOn: "2026-10-05" },
  payment: { invoiceNumbers: ["TH/INV/2627/0009"], amountPaidMinor: 100_000, currency: "INR" },
  schedule1: { deliverables: "Website source\nDesign files", location: "Git repository", deliveredDates: "28 Oct 2026" },
  schedule2: { tools: "None", thirdParty: "Astro (MIT licence)" },
};

/** The text of an HTML string as a reader sees it (tags dropped, entities for the five escaped characters read back). */
const textOf = (html: string) =>
  html
    .replace(/<style>[\s\S]*?<\/style>/g, "")
    .replace(/<title>[\s\S]*?<\/title>/g, "")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

describe("the deed's layout [T11]", () => {
  const t = deedText(snapshot, "TH/DA/2627/0001");
  const html = renderDeedHtml(t);
  const text = textOf(html).replace(/\s+/g, " ");

  it("prints every sentence of 07-ZE's filled text, in order and word for word", () => {
    const { title, number } = deedTitleParts(t.title);
    const parts = [
      title,
      number as string,
      t.parties.map((r) => r.text).join(""),
      ...t.clauses.flatMap((c) => [`${c.n}.`, `${c.heading} ${c.body}`]),
      unsignedSignatureLine(t.signatureLead),
      t.schedule1.heading,
      "Website source Design files",
      t.schedule1.location,
      t.schedule1.deliveredDates,
      t.schedule2.heading,
      t.schedule2.tools,
      t.schedule2.thirdParty,
      t.footer,
    ];
    let from = 0;
    for (const p of parts) {
      const at = text.indexOf(p.replace(/\s+/g, " "), from);
      expect(at, p).toBeGreaterThanOrEqual(from);
      from = at + 1;
    }
  });

  it("escapes every value", () => {
    expect(html).not.toContain("<Traders>");
    expect(html).toContain("Example &lt;Traders&gt; &amp; Co");
  });

  it("sets the title and its number on two lines; the metadata title keeps 07-ZE's whole line", () => {
    expect(deedTitleParts(t.title)).toEqual({ title: "Deed of assignment of copyright", number: "No. TH/DA/2627/0001" });
    expect(html).toContain(`<title>${esc(t.title)}</title>`);
    expect(html).toMatch(/data-testid="deed-number">No\. TH\/DA\/2627\/0001</);
    expect(deedTitleParts("No separator")).toEqual({ title: "No separator", number: null });
  });

  it("ends the signature sentence at \"TecHaust Technologies.\" and leaves the space below it empty of words (L5)", () => {
    expect(unsignedSignatureLine(t.signatureLead)).toBe(
      "Signed by the assignor with an Aadhaar-based electronic signature (eSign): Rupak Sarkar, sole proprietor, TecHaust Technologies.",
    );
    expect(unsignedSignatureLine("Already ends.")).toBe("Already ends.");
    const space = /data-testid="deed-sign-space"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    expect(space).toContain("<svg");
    expect(textOf(space).trim()).toBe("");
  });

  it("keeps a Schedule's typed line breaks (pre-line) and prints no labels until 07-ZJ line 2 is approved", () => {
    expect(html).toContain("Website source\nDesign files");
    expect(html).toContain("white-space: pre-line");
    expect(html.match(/data-testid="deed-schedule"/g)).toHaveLength(2);
    if (DEED_PDF_COPY.labels === null) expect(html).not.toContain('class="sched__label"');
    else expect(html).toContain(esc(DEED_PDF_COPY.labels.deliverables));
  });

  it("puts the amount's ₹ in its own span (the visual suite checks its font) and the stamp-duty line last", () => {
    expect(html).toContain('<span data-testid="rupee">₹</span>1,000.00');
    const body = deedBody(t);
    expect(body.lastIndexOf("deed-footer")).toBeGreaterThan(body.lastIndexOf("deed-schedule"));
    expect(text).toContain(
      "Stamp duty: Not stamped at signing. Any stamp duty due will be paid before this deed is produced as evidence.",
    );
  });

  it("has the house footer with the deed number, loads nothing external and carries no placeholder", () => {
    expect(html).toContain("@bottom-left");
    expect(html).toContain("No. TH/DA/2627/0001");
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).not.toMatch(/url\((?!"?data:)/);
    expect(html).not.toContain("[Placeholder]");
    expect(DEED_LAYOUT_PLACEHOLDER).toBe(false);
    expect(DEED_PDF_LAYOUT_ID).toBe("deed-v1");
  });

  it("renders every fixture (a long name and address, four invoices, USD) without a placeholder or an unescaped value", () => {
    for (const name of DEED_FIXTURE_NAMES) {
      const h = renderDeedHtml(deedFixture(name));
      expect(h, name).toContain("Deed of assignment of copyright");
      expect(h, name).not.toContain("[Placeholder]");
      expect(h.match(/data-testid="deed-clause"/g), name).toHaveLength(8);
    }
    expect(renderDeedHtml(deedFixture("usd"))).toContain("$12,500.00");
  });
});
