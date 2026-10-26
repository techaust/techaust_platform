// Optional parts of an envelope: every field that may be absent or present, through the envelope code, the view and the HTML.
import { describe, expect, it } from "vitest";
import { buildEnvelope, serializeEnvelope } from "../src/envelope.ts";
import { PDF_LOGOS } from "../src/generated/assets.ts";
import { renderDocumentHtml } from "../src/render.ts";
import type { Envelope } from "../src/types.ts";
import { toPdfView } from "../src/view.ts";
import { buildFixture } from "./fixtures/index.ts";

const base = async (): Promise<Envelope> => structuredClone((await buildFixture("short-intra-inr")).envelope);

describe("a minimal recipient and sparse parts", () => {
  it("copes with no display name, address, contact, GSTIN or optional text", async () => {
    const e = await base();
    e.snapshot.header.recipient = { legalName: "Sample Minimal Client", country: "IN" };
    e.snapshot.header.document.title = null;
    for (const l of e.snapshot.lines) {
      l.detail = null;
      l.sac = null;
      l.discountKind = null;
      l.discountValue = null;
    }
    const v = toPdfView(e);
    expect(v.recipient).toEqual({ name: "Sample Minimal Client", attention: null, lines: [] });
    expect(v.documentTitle).toBeNull();
    expect(v.lines[0]).toMatchObject({ detail: null, sac: null, discount: null });
    const html = renderDocumentHtml(v);
    expect(html).toContain("Sample Minimal Client");
    expect(html).not.toContain("Attention:");
    expect(html).not.toContain("Prepared for</div><strong>undefined");
    expect(serializeEnvelope(e)).not.toContain("displayName");
  });

  it("prints a fixed line discount, a dated schedule step with its detail, and an unknown trigger by its label", async () => {
    const e = await base();
    e.snapshot.lines[0]!.discountKind = "fixed";
    e.snapshot.lines[0]!.discountValue = 100_000;
    e.snapshot.schedule[0]!.detail = "Sample detail";
    e.snapshot.schedule[0]!.targetDate = "2026-11-01";
    e.snapshot.schedule[1]!.trigger = "something_new";
    const v = toPdfView(e);
    expect(v.lines[0]?.discount).toBe("₹1,000.00");
    expect(v.schedule[0]).toMatchObject({ detail: "Sample detail", date: "01 Nov 26" });
    expect(v.schedule[1]?.when).toBe("Midpoint");
    const html = renderDocumentHtml(v);
    expect(html).toContain("Sample detail");
    expect(html).toContain("(01 Nov 26)");
  });

  it("prints a document with no payment schedule and an unknown section kind", async () => {
    const e = await base();
    e.snapshot.schedule = [];
    e.snapshot.header.instalmentAmounts = [];
    e.snapshot.sections.push({ kind: "brand_new", title: null, bodyMd: "Text", hidden: false });
    const v = toPdfView(e);
    expect(v.schedule).toEqual([]);
    expect(v.sections.at(-1)?.title).toBe("Section");
    expect(renderDocumentHtml(v)).not.toContain("Payment schedule");
  });

  it("an instalment with no stored amount shows zero rather than a gap", async () => {
    const e = await base();
    e.snapshot.header.instalmentAmounts = [];
    expect(toPdfView(e).schedule[0]?.amount).toBe("₹0.00");
  });

  it("an overseas address names the country, a state-less address omits the state", async () => {
    const e = await base();
    e.snapshot.header.recipient.address = { line1: "1 Road", city: "Leeds", country: "GB" };
    expect(toPdfView(e).recipient.lines).toContain("Leeds");
    expect(toPdfView(e).recipient.lines).toContain("United Kingdom");
  });

  it("the supplier legal name equal to the trade name is not repeated", async () => {
    const e = await base();
    e.snapshot.header.issuer.company.legalName = "TecHaust Technologies";
    expect(toPdfView(e).supplier.lines).not.toContain("TecHaust Technologies");
  });

  it("a USD document without an FX rate has no INR note", async () => {
    const e = structuredClone((await buildFixture("usd-export")).envelope);
    const c = JSON.parse(e.snapshot.computedJson);
    c.fxRateMicros = null;
    e.snapshot.computedJson = JSON.stringify(c);
    expect(toPdfView(e).inrNote).toBeNull();
    expect(renderDocumentHtml(toPdfView(e))).not.toContain('class="note">Indicative');
  });

  it("the envelope copy keeps every optional recipient and address field", async () => {
    const e = (await buildFixture("long-names")).envelope;
    const copy = buildEnvelope(e);
    expect(copy.snapshot.header.recipient).toEqual(e.snapshot.header.recipient);
    expect(copy.snapshot.header.recipient.address?.line2).toBeDefined();
  });

  it("a view with no logo uses the primary SVG logo", async () => {
    const e = await base();
    e.snapshot.header.issuer.company.logo = "";
    const html = renderDocumentHtml(toPdfView(e));
    expect(html).not.toContain("logo-text");
    expect(html).toContain(`<div class="masthead__logo">${PDF_LOGOS["logo-primary-color.svg"]}</div>`);
  });
});
