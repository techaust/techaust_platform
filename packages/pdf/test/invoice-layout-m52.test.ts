// The M5.2 invoice types in the designed layout (layout/invoice.ts; docs/06 §7.3; words 07-S §1, §2, §8): the export invoice (LUT and IGST routes),
// the proforma, and the tax or export invoice issued for a payment received. The statutory lines are held as LITERALS (fixtures), never imported
// from core. The gate of the M5.2 review (LD33): the jobs Worker's own check, `missingStatutoryLine`, passes on what this layout prints for a LUT
// export, an IGST export, a proforma and an export invoice for a payment received. VERIFY WITH CA/LEGAL for every rule printed.
import { describe, expect, it } from "vitest";
import { TECHAUST_PDF_FONT_DATA } from "../src/generated/assets.ts";
import { hasTextNode, missingStatutoryLine } from "../src/invoice-integrity.ts";
import type { InvoiceEnvelope, InvoiceView } from "../src/invoice-types.ts";
import { toInvoiceView } from "../src/invoice-view.ts";
import { EXPORT_PDF_COPY, PROFORMA_PDF_COPY } from "../src/layout/copy.ts";
import { swiftRows, titleOf } from "../src/layout/invoice.ts";
import { renderDocumentHtml } from "../src/render.ts";
import { DEFAULT_VIEW_CONFIG } from "../src/view.ts";
import { buildInvoiceFixture, TYPED_FIXTURE_NAMES } from "./fixtures/invoice.ts";
import {
  buildInvoiceLayoutFixture,
  type InvoiceLayoutFixture,
  LAYOUT_ARN,
  LAYOUT_ENDORSEMENT,
  LAYOUT_EXPORT_NOTE,
  LAYOUT_PROFORMA_NOTICE,
} from "./fixtures/invoice-layout.ts";

const body = (h: string) => h.slice(h.indexOf("<body>"));
const between = (h: string, from: string, to: string) =>
  h.slice(h.indexOf(from), h.indexOf(to, h.indexOf(from) + 1));
const clone = (e: InvoiceEnvelope): InvoiceEnvelope => JSON.parse(JSON.stringify(e)) as InvoiceEnvelope;

async function built(name: InvoiceLayoutFixture) {
  const { envelope, signature } = await buildInvoiceLayoutFixture(name);
  const view = toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, { signature, portalLink: "portal.example.test" });
  return { envelope, view, html: renderDocumentHtml(view) };
}

describe("the export invoice (07-S §1)", () => {
  it("under LUT: the title and copy mark, the frozen endorsement as one text node, the LUT line, the country, the place of supply, the delivery address", async () => {
    const { html, view } = await built("export-lut");
    const h = body(html);
    expect(view.type).toBe("export_invoice");
    expect(h).toContain('<h1 class="masthead__title">Export Invoice</h1>');
    expect(h).toContain('data-testid="copy-label">ORIGINAL FOR RECIPIENT</p>');
    expect(h).toContain(`<p class="inv-band__line" data-testid="endorsement">${LAYOUT_ENDORSEMENT.lut}</p>`);
    expect(hasTextNode(h, LAYOUT_ENDORSEMENT.lut)).toBe(true);
    expect(h).toContain(`data-testid="lut">LUT ARN: ${LAYOUT_ARN} (FY 2026-27)</p>`);
    expect(h).toContain("<dt>Place of supply</dt><dd>Outside India (96)</dd>");
    expect(h).not.toContain("<dt>State code</dt>");
    expect(h).toContain("<dt>Country of destination</dt><dd>United States</dd>");
    const billedTo = between(h, ">Billed to<", "party--doc");
    expect(billedTo).toContain(">Address of delivery<");
    expect(billedTo).toContain("9 Sample Delivery Street");
    expect(billedTo).toContain("100 Sample Avenue, Suite 4");
    // the band sits under the title, before the parties
    expect(h.indexOf('data-testid="endorsement"')).toBeLessThan(h.indexOf('class="parties"'));
    expect(h.indexOf("masthead__title")).toBeLessThan(h.indexOf('data-testid="endorsement"'));
    expect(h).toContain('class="doc doc--invoice doc--tax-invoice doc--export-invoice"');
  });

  it("the totals are in USD, then the INR block under them: the rate with its source and date, the taxable value; no IGST in INR on the LUT route", async () => {
    const { html, view } = await built("export-lut");
    const h = body(html);
    expect(view.currency).toBe("USD");
    expect(h).toMatch(/data-testid="total"><span data-testid="currency-symbol">\$<\/span>/);
    const inr = between(h, 'data-testid="inr"', "inv-sign");
    expect(inr).toContain(">Value in INR<");
    expect(inr).toContain(
      'Exchange rate: 1 USD = <span data-testid="rupee">₹</span>84.2156 (FBIL reference rate, 27 Oct 26)',
    );
    expect(inr).toContain(">Taxable value in INR<");
    expect(inr).toContain(`>${view.inr?.taxable}<`);
    expect(inr).not.toContain("IGST in INR");
    expect(h.indexOf('data-testid="total"')).toBeLessThan(h.indexOf('data-testid="inr"'));
  });

  it("how to pay: the SWIFT block under 07-S's labels, the purpose code, the reference; no INR bank lines", async () => {
    const { html } = await built("export-lut");
    const pay = between(body(html), 'class="accept inv-pay"', "</div></div>");
    for (const must of [
      ">How to pay<",
      "International wire (SWIFT) to:",
      "<dt>Beneficiary</dt><dd>Sample Proprietor</dd>",
      "<dt>Account number</dt><dd>SAMPLEUSD000123</dd>",
      "<dt>SWIFT/BIC</dt><dd>SAMPINBBXXX</dd>",
      "<dt>Bank and branch</dt><dd>Sample Bank, Sample Branch, Kolkata</dd>",
      "<dt>Bank address</dt><dd>3 Sample Bank Street, Kolkata 700001, India</dd>",
      "<dt>Intermediary bank</dt><dd>Sample Intermediary Bank, New York (SAMPUS33)</dd>",
      ">Purpose code: P0802<",
      "Please quote TH/EXP/2627/0012 as the payment reference.",
    ])
      expect(pay, must).toContain(must);
    expect(pay).not.toContain("NEFT");
    expect(pay).not.toContain("IFSC");
  });

  it("with IGST paid: the IGST endorsement, no LUT line, the IGST in INR, and the extra export note after the endorsement", async () => {
    const { html, view } = await built("export-igst");
    const h = body(html);
    expect(h).toContain(`data-testid="endorsement">${LAYOUT_ENDORSEMENT.igst_paid}</p>`);
    expect(h).not.toContain(LAYOUT_ENDORSEMENT.lut);
    expect(h).not.toContain('data-testid="lut"');
    expect(h).toContain(`data-testid="export-note"><p>${LAYOUT_EXPORT_NOTE}</p></div>`);
    expect(h.indexOf('data-testid="endorsement"')).toBeLessThan(h.indexOf('data-testid="export-note"'));
    expect(h).toContain(">IGST in INR<");
    expect(view.inr?.igst).not.toBeNull();
    expect(h).toContain('<th scope="colgroup" colspan="2" class="inv-head">IGST</th>');
    // no delivery address on the snapshot: no block, nothing invented
    expect(h).not.toContain("Address of delivery");
    // the optional SWIFT parts are left out, never printed empty
    expect(h).not.toContain("Bank address");
    expect(h).not.toContain("Intermediary bank");
    expect(h).not.toContain("Purpose code");
  });

  it("country names from en-GB print as frozen: the curly apostrophe and accents, and an '&' in a name is escaped once", async () => {
    const { html } = await built("export-igst");
    const h = body(html);
    expect(h).toContain("<dt>Country of destination</dt><dd>Côte d’Ivoire</dd>");
    expect(h).toContain("Sample Abidjan Services &amp; Trading SARL");
    expect(h).not.toContain("&amp;amp;");
    const { envelope } = await buildInvoiceLayoutFixture("export-igst");
    const e = clone(envelope);
    (e.snapshot.header.export as { countryName: string }).countryName = "Bosnia & Herzegovina";
    expect(body(renderDocumentHtml(toInvoiceView(e, DEFAULT_VIEW_CONFIG)))).toContain(
      "<dd>Bosnia &amp; Herzegovina</dd>",
    );
  });

  it("the endorsement printed is the frozen text, never a constant", async () => {
    const { envelope } = await buildInvoiceLayoutFixture("export-lut");
    const e = clone(envelope);
    (e.snapshot.header.export as { endorsement: string }).endorsement = "SAMPLE FROZEN ENDORSEMENT";
    const h = body(renderDocumentHtml(toInvoiceView(e, DEFAULT_VIEW_CONFIG)));
    expect(h).toContain('data-testid="endorsement">SAMPLE FROZEN ENDORSEMENT</p>');
    expect(h).not.toContain(LAYOUT_ENDORSEMENT.lut);
  });

  it("swiftRows: 07-S's labels in a wire form's order; empty optional parts are dropped", () => {
    expect(
      swiftRows({
        beneficiary: "B",
        accountNo: "1",
        swift: "S",
        bank: "K",
        bankAddress: null,
        intermediary: " ",
        purposeCode: "P0802",
      }),
    ).toEqual([
      { label: EXPORT_PDF_COPY.payment.beneficiary, value: "B" },
      { label: "Account number", value: "1" },
      { label: "SWIFT/BIC", value: "S" },
      { label: "Bank and branch", value: "K" },
    ]);
  });
});

describe("the proforma (07-S §2)", () => {
  it("its title, the frozen notice under it as one text node, no copy mark and no empty paragraph, 'Proforma number', 'Proforma date', 'Valid until'", async () => {
    const { html, view } = await built("proforma");
    const h = body(html);
    expect(view.copyLabel).toBeNull();
    expect(h).toContain('<h1 class="masthead__title">Proforma Invoice</h1></div></header>');
    expect(h).not.toContain("ORIGINAL FOR RECIPIENT");
    expect(h).not.toContain('data-testid="copy-label"');
    expect(h).not.toContain('<p class="inv-copy"');
    expect(h).toContain(`<p class="inv-band__line" data-testid="notice">${LAYOUT_PROFORMA_NOTICE}</p>`);
    expect(hasTextNode(h, LAYOUT_PROFORMA_NOTICE)).toBe(true);
    expect(h).toContain(`<p class="label">${PROFORMA_PDF_COPY.header.number}</p>`);
    expect(h).toContain("<dt>Proforma date</dt><dd>28 Oct 26</dd>");
    expect(h).toContain("<dt>Valid until</dt><dd>04 Nov 26</dd>");
    expect(h).not.toContain("<dt>Due date</dt>");
    expect(h).not.toContain(">Invoice number<");
    expect(h).toContain("TH/PI/2627/0012");
    expect(h).toContain('class="doc doc--invoice doc--tax-invoice doc--proforma"');
  });

  it("everything else as the tax invoice: the lines, the tax summary, the words, the reverse-charge line, balance due, how to pay, the signatory", async () => {
    const h = body((await built("proforma")).html);
    for (const must of [
      ">Tax summary<",
      "Amount in words: Rupees",
      'data-testid="reverse-charge"',
      ">Balance due<",
      "Bank transfer (NEFT, RTGS or IMPS) to:",
      "Please quote TH/PI/2627/0012 as the payment reference.",
      'data-testid="signatory">Authorised signatory<',
    ])
      expect(h, must).toContain(must);
    expect(h).not.toContain('data-testid="endorsement"');
  });
});

describe("the invoice issued for a payment received (07-S §8, Q9)", () => {
  it("a tax invoice: the line under the title names the proforma, its date and the day the money arrived; it prints no balance due and no 'How to pay'", async () => {
    const { html, view } = await built("advance");
    const h = body(html);
    expect(view.advance).not.toBeNull();
    expect(h).toContain(
      'data-testid="advance">Against proforma TH/PI/2627/0004 of 20 Oct 26, payment received on 27 Oct 26.</p>',
    );
    expect(h.indexOf('data-testid="advance"')).toBeLessThan(h.indexOf('class="parties"'));
    expect(h).toContain('<h1 class="masthead__title">Tax Invoice</h1>');
    expect(h).toContain("ORIGINAL FOR RECIPIENT");
    expect(h).not.toContain("Balance due");
    expect(h).not.toContain("How to pay");
    expect(h).not.toContain("payment reference");
    expect(h).toContain('data-testid="signatory"');
    expect(h).not.toContain('data-testid="endorsement"');
  });

  it("an export invoice: the endorsement band, then the line about the payment", async () => {
    const h = body((await built("advance-export")).html);
    expect(h).toContain(`data-testid="endorsement">${LAYOUT_ENDORSEMENT.lut}</p>`);
    expect(h).toContain("Against proforma TH/PI/2627/0004 of 20 Oct 26, payment received on 27 Oct 26.");
    expect(h.indexOf('data-testid="endorsement"')).toBeLessThan(h.indexOf('data-testid="advance"'));
    expect(h).not.toContain("How to pay");
    expect(h).toContain(">Value in INR<");
  });
});

describe("LD33 gate: the jobs Worker's statutory-line check passes on this layout", () => {
  const gate: InvoiceLayoutFixture[] = ["export-lut", "export-igst", "proforma", "advance-export"];
  it.each(gate)("%s: missingStatutoryLine finds nothing missing", async (name) => {
    const { envelope, html } = await built(name);
    expect(missingStatutoryLine(envelope, html)).toBeNull();
  });

  it.each(TYPED_FIXTURE_NAMES)(
    "the builder's %s fixture (sealed by the issue route's functions) passes too",
    async (name) => {
      const { envelope } = await buildInvoiceFixture(name);
      const html = renderDocumentHtml(toInvoiceView(envelope, DEFAULT_VIEW_CONFIG));
      expect(missingStatutoryLine(envelope, html)).toBeNull();
    },
  );

  it("and it would refuse this layout if the frozen line were changed after the page was made (the check reads the envelope, not the page)", async () => {
    const { envelope, html } = await built("export-lut");
    const e = clone(envelope);
    (e.snapshot.header.export as { endorsement: string }).endorsement = `${LAYOUT_ENDORSEMENT.lut}S`;
    expect(missingStatutoryLine(e, html)).toBe("endorsement");
    const pro = await built("proforma");
    const p = clone(pro.envelope);
    (p.snapshot.header.proforma as { notice: string }).notice = "Sample other notice.";
    expect(missingStatutoryLine(p, pro.html)).toBe("notice");
  });
});

describe("the fonts cover every country name en-GB can freeze", () => {
  /** The code points the Latin face of the embedded font declares (its unicode-range). */
  function latinRanges(): [number, number][] {
    const faces = TECHAUST_PDF_FONT_DATA.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    const ranges: [number, number][] = [];
    for (const f of faces) {
      const m = /unicode-range:\s*([^;]+);/.exec(f);
      for (const part of (m?.[1] ?? "").split(",")) {
        const [a, b] = part.trim().replace("U+", "").split("-");
        if (!a) continue;
        ranges.push([Number.parseInt(a, 16), Number.parseInt(b ?? a, 16)]);
      }
    }
    return ranges;
  }

  it("every character of every region name (AA to ZZ) is inside a face's unicode-range: '&', accents, Å, ü, the curly apostrophe", () => {
    const ranges = latinRanges();
    const covered = (cp: number) => ranges.some(([a, b]) => cp >= a && cp <= b);
    const names = new Intl.DisplayNames(["en-GB"], { type: "region" });
    const missing: string[] = [];
    let seen = 0;
    for (let a = 65; a <= 90; a++)
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        let name: string | undefined;
        try {
          name = names.of(code);
        } catch {
          continue;
        }
        if (!name || name === code) continue;
        seen++;
        for (const ch of name) if (!covered(ch.codePointAt(0) as number)) missing.push(`${code}: ${name}`);
      }
    expect(seen).toBeGreaterThan(200);
    expect(missing).toEqual([]);
    for (const name of [
      "Côte d’Ivoire",
      "Curaçao",
      "Åland Islands",
      "Türkiye",
      "Antigua & Barbuda",
      "São Tomé & Príncipe",
    ])
      for (const ch of name) expect(covered(ch.codePointAt(0) as number), `${name}: ${ch}`).toBe(true);
  });
});

describe("titles", () => {
  it("titleOf: the tax invoice, the export invoice and the proforma by 07-R and 07-S", async () => {
    const v = (await built("short")).view;
    expect(titleOf(v)).toBe("Tax Invoice");
    expect(titleOf({ ...v, type: "export_invoice" } as InvoiceView)).toBe("Export Invoice");
    expect(titleOf({ ...v, type: "proforma" } as InvoiceView)).toBe("Proforma Invoice");
  });

  it("the PDF metadata title carries the type, the number and the client", async () => {
    expect((await built("export-lut")).html).toContain(
      "<title>Export Invoice TH/EXP/2627/0012 – Sample Overseas</title>",
    );
    expect((await built("proforma")).html).toContain(
      "<title>Proforma Invoice TH/PI/2627/0012 – Sample Client</title>",
    );
  });
});
