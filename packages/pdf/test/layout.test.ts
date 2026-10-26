// The proposal and estimate layout (M4.4, docs/06 §7.1 to §7.4): what each document prints and where, the 07-P wording, the page
// footer in CSS margin boxes, and the view config of a Worker. The look itself is checked by the visual suite and by eye.
import { describe, expect, it } from "vitest";
import { portalHost, viewConfigFor } from "../src/config.ts";
import { documentBody } from "../src/layout/document.ts";
import { cssString, pageCss } from "../src/layout/styles.ts";
import { renderDocumentHtml } from "../src/render.ts";
import type { Envelope } from "../src/types.ts";
import { DEFAULT_VIEW_CONFIG, toPdfView } from "../src/view.ts";
import { buildFixture, type FixtureName } from "./fixtures/index.ts";

const envOf = async (name: FixtureName): Promise<Envelope> =>
  structuredClone((await buildFixture(name)).envelope);
const bodyOf = async (name: FixtureName) => documentBody(toPdfView(await envOf(name)));
const count = (html: string, s: string) => html.split(s).length - 1;

describe("the proposal", () => {
  it("opens with a cover page: the document title as the one h1, prepared for, the facts and the contact", async () => {
    const html = await bodyOf("short-intra-inr");
    expect(html.indexOf('class="cover"')).toBeLessThan(html.indexOf('class="parties"'));
    expect(count(html, "<h1")).toBe(1);
    expect(html).toContain('<h1 class="cover__title">Sample proposal for short-intra-inr</h1>');
    expect(html).toContain('Prepared for</span> <span class="cover__client">Sample Client</span>');
    for (const fact of ["26 Oct 26", "Version 2", "Valid until 10 Nov 26", "TH/PRP/2627/0003"])
      expect(html).toContain(`<li>${fact}</li>`);
    expect(html).toContain("Your contact at TecHaust: Sample Proprietor, sender@example.test");
  });

  it("prints the cover section's text on the cover, not again among the sections", async () => {
    const html = await bodyOf("long-inter-inr");
    const cover = html.slice(0, html.indexOf('class="parties"'));
    expect(cover).toContain("Sample paragraph 1 for cover.");
    expect(count(html, "Sample paragraph 1 for cover.")).toBe(1);
    expect(html).not.toContain("sec--cover");
  });

  it("uses the kind as the cover title when the document has no title", async () => {
    const e = await envOf("short-intra-inr");
    e.snapshot.header.document.title = null;
    expect(documentBody(toPdfView(e))).toContain('<h1 class="cover__title">Proposal</h1>');
  });

  it("puts the timeline table in the timeline section and leaves the details out of the schedule", async () => {
    const html = await bodyOf("long-inter-inr");
    const timeline = html.slice(html.indexOf("sec--timeline"), html.indexOf("sec--team"));
    expect(timeline).toContain('<table class="grid timeline">');
    for (const h of ["Milestone", "What you get", "Target date", "Payment"])
      expect(timeline).toContain(`>${h}</th>`);
    expect(timeline).toContain("After the sample design is approved");
    const schedule = html.slice(html.indexOf('class="grid schedule"'));
    expect(schedule.slice(0, schedule.indexOf("</table>"))).not.toContain(
      "After the sample design is approved",
    );
  });
});

describe("the estimate", () => {
  it("has the kind as its h1, the document title, and the notice exactly once", async () => {
    const html = await bodyOf("intra-estimate");
    expect(html).not.toContain('class="cover"');
    expect(html).toContain('<h1 class="masthead__title">Estimate</h1>');
    expect(html).toContain('<p class="doc-title">Sample estimate for intra-estimate</p>');
    expect(count(html, "This is an estimate, not a tax invoice.")).toBe(1);
  });

  it("a proposal carries no estimate notice", async () => {
    expect(await bodyOf("short-intra-inr")).not.toContain("This is an estimate, not a tax invoice.");
  });
});

describe("the header blocks (07-P §1)", () => {
  it("prints From, Prepared for and Document with the number, date, validity and currency", async () => {
    const html = await bodyOf("short-intra-inr");
    for (const label of ["From", "Prepared for"]) expect(html).toContain(`<p class="label">${label}</p>`);
    expect(html).toContain(
      '<p class="label">Document <span class="status" data-testid="status">Sent</span></p>',
    );
    expect(html).toContain("<dt>No.</dt><dd>TH/PRP/2627/0003 v2</dd>");
    expect(html).toContain("<dt>Date</dt><dd>26 Oct 26</dd>");
    expect(html).toContain("<dt>Valid until</dt><dd>10 Nov 26</dd>");
    expect(html).toContain("<dt>Currency</dt><dd>INR</dd>");
    expect(html).toContain("Place of supply: West Bengal (19)");
  });

  it("keeps the parts of a registration line together: it wraps only at the separator", async () => {
    const html = await bodyOf("short-intra-inr");
    expect(html).toContain(
      '<span class="keep">GSTIN 19ABCDE1234F1ZX</span> · <span class="keep">State West Bengal (19)</span>',
    );
  });

  it("leaves out the supplier fields that are empty in Settings", async () => {
    const e = (await buildFixture("short-intra-inr", { bareSupplier: true })).envelope;
    const html = documentBody(toPdfView(e));
    const from = html.slice(
      html.indexOf('<p class="label">From</p>'),
      html.indexOf('<p class="label">Prepared for</p>'),
    );
    expect(from).not.toContain("Proprietor:");
    expect(from).not.toContain("GSTIN");
    expect(from).toContain("State West Bengal (19)");
  });

  it("prints the export place of supply", async () => {
    expect(await bodyOf("usd-export")).toContain("Place of supply: Outside India (96 – Other Territory)");
  });
});

describe("the money (07-P §1)", () => {
  it("prints the line table headings, with the discount column only when a line has a discount", async () => {
    const withDisc = await bodyOf("short-intra-inr");
    for (const h of ["#", "Description", "Qty", "Unit", "Rate", "Discount", "Taxable value", "GST %"])
      expect(withDisc).toContain(`>${h}</th>`);
    const without = await bodyOf("intra-estimate");
    expect(without).not.toContain(">Discount</th>");
    expect(without).toContain(">Taxable value</th>");
  });

  it("prints the SAC on the line's second line", async () => {
    expect(await bodyOf("short-intra-inr")).toContain('<span class="sub">SAC 998314</span>');
  });

  it("prints the totals, the amount in words and the INR note together", async () => {
    const html = await bodyOf("short-intra-inr");
    const totals = html.slice(html.indexOf('class="totals"'), html.indexOf("Tax summary"));
    for (const label of ["Sub-total", "Discount", "Taxable value", "CGST", "SGST", "Round-off", "Total"])
      expect(totals).toContain(`<th scope="row">${label}</th>`);
    expect(totals).toContain("Amount in words: Rupees");
    expect(totals).toContain("Prices exclude GST (18 %).");
    expect(totals).not.toContain("International projects");
  });

  it("prints the tax summary with CGST and SGST inside the state, IGST across states, and none for an export", async () => {
    const intra = await bodyOf("intra-estimate");
    expect(intra).toContain("<h3>Tax summary</h3>");
    expect(intra).toMatch(/>CGST<\/th><th[^>]*>SGST<\/th>/);
    const inter = await bodyOf("inter-estimate");
    expect(inter).toMatch(/>IGST<\/th><\/tr><\/thead>/);
    expect(inter).not.toMatch(/>CGST<\/th>/);
    expect(await bodyOf("usd-export")).not.toContain("Tax summary");
  });

  it("prints the USD note and the indicative INR total on a USD document", async () => {
    const html = await bodyOf("usd-export");
    expect(html).toContain("International projects are invoiced from India in USD as an export of services.");
    expect(html).not.toContain("Prices exclude GST");
    expect(html).toContain('Indicative total in INR: <span data-testid="rupee">₹</span>');
    expect(html).toContain(
      '<td class="num" data-testid="total"><span data-testid="currency-symbol">$</span>',
    );
  });

  it("prints the payment schedule headings", async () => {
    const html = await bodyOf("short-intra-inr");
    expect(html).toContain("<h3>Payment schedule</h3>");
    for (const h of ["Instalment", "When", "Share", "Amount"]) expect(html).toContain(`>${h}</th>`);
  });
});

describe("terms, acceptance and the integrity line", () => {
  it("prints the 07-O terms line only when the terms section has no text of its own", async () => {
    const own = await bodyOf("short-intra-inr");
    expect(own).not.toContain("The terms below are version");
    const e = await envOf("short-intra-inr");
    for (const s of e.snapshot.sections) if (s.kind === "terms") s.bodyMd = "";
    const html = documentBody(toPdfView(e));
    expect(html).toContain(`The terms below are version ${e.snapshot.terms.version} of our proposal terms.`);
    expect(html).toContain("Payment is due as scheduled.");
  });

  it("prints the acceptance box with the portal address", async () => {
    const html = await bodyOf("short-intra-inr");
    expect(html).toContain(
      'Accept online in the TecHaust client portal: <span class="accept__link">portal.techaust.com</span>',
    );
    expect(html).toContain(
      "Your acceptance is recorded on a separate acceptance certificate. This document doesn&#39;t change.",
    );
  });

  it("adds the investment, terms and acceptance parts when a document has no such section", async () => {
    const e = await envOf("short-intra-inr");
    e.snapshot.sections = e.snapshot.sections.filter((s) => s.kind === "summary");
    const html = documentBody(toPdfView(e));
    for (const h of ["Investment", "Terms", "Acceptance"]) expect(html).toContain(`<h2>${h}</h2>`);
    expect(html).toContain('data-testid="total"');
    expect(html).toContain("The terms below are version");
    expect(html).toContain("accept__link");
  });

  it("ends with the integrity line", async () => {
    const html = await bodyOf("long-inter-inr");
    expect(html.trimEnd().endsWith("</p></div>")).toBe(true);
    expect(html.lastIndexOf('data-testid="integrity"')).toBeGreaterThan(html.lastIndexOf("accept__link"));
    expect(html).toMatch(/Document ID doc_sample_long_inter_inr · Content fingerprint [0-9a-f]{12}/);
  });
});

describe("the page footer in CSS margin boxes", () => {
  it("carries the 07-P line, the number and version, and Page X of Y", async () => {
    const css = pageCss(toPdfView(await envOf("short-intra-inr")));
    expect(css).toContain("@bottom-left");
    expect(css).toContain("@bottom-right");
    expect(css).toContain('content: "TecHaust Technologies · techaust.com · hello@techaust.com"');
    expect(css).toContain('"TH/PRP/2627/0003 v2   Page " counter(page) " of " counter(pages)');
    expect(css).toMatch(/url\("data:image\/svg\+xml,[^"]+"\)/);
  });

  it("writes a document's text into CSS only as an escaped string", () => {
    expect(cssString('a"b\\c')).toBe('"a\\22 b\\5c c"');
    expect(cssString("</style><script>")).toBe('"\\3c /style\\3e \\3c script\\3e "');
    expect(cssString("x\ny'z&")).toBe('"x\\a y\\27 z\\26 "');
  });

  it("is part of every rendered document", async () => {
    const html = renderDocumentHtml(toPdfView(await envOf("intra-estimate")));
    expect(html).toContain('"TH/EST/2627/0007 v1   Page " counter(page)');
  });
});

describe("the view config of a Worker", () => {
  it("prints only the host of the portal URL", () => {
    expect(portalHost("https://portal.techaust.com/")).toBe("portal.techaust.com");
    expect(portalHost("http://localhost:5174/")).toBe("localhost:5174");
    expect(portalHost(" https://a.example.test/path?q=1 ")).toBe("a.example.test");
  });

  it("falls back to the default address for an empty or unreadable value", () => {
    for (const v of [undefined, "", "   ", "not a url"]) expect(portalHost(v)).toBeNull();
    expect(viewConfigFor(undefined)).toEqual(DEFAULT_VIEW_CONFIG);
    expect(viewConfigFor("nope").portalLink).toBe("portal.techaust.com");
    expect(viewConfigFor("https://x.example.test/").portalLink).toBe("x.example.test");
    expect(viewConfigFor("https://x.example.test/").contactEmail).toBe("hello@techaust.com");
  });
});
