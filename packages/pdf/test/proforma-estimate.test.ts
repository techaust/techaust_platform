// FX-4 (audit A5 5): a proforma's GST is an estimate (Researched 2026-10-28, s.31 CGST Act, Rule 46 (08-C RA-28)). A proforma issued from FX-4 on is
// sealed with `proforma.gstEstimate: true`; its PDF labels each tax head "(estimate)" in the totals and in the tax summary. A proforma sealed before
// FX-4 has no marker and prints exactly as it was. The marker is part of the seal (a tampered marker fails like any other sealed field), and an
// envelope whose marker is anything but the literal `true` is not an envelope. The words are held here as literals (07-Y, PENDING approval).
import { describe, expect, it } from "vitest";
import { invoiceEnvelopeOfBundle } from "../src/invoice-bundle.ts";
import {
  parseInvoiceEnvelope,
  serializeInvoiceEnvelope,
  verifyInvoiceEnvelope,
} from "../src/invoice-envelope.ts";
import { missingStatutoryLine } from "../src/invoice-integrity.ts";
import type { InvoiceEnvelope } from "../src/invoice-types.ts";
import { toInvoiceView } from "../src/invoice-view.ts";
import { PROFORMA_PDF_COPY } from "../src/layout/copy.ts";
import { renderDocumentHtml } from "../src/render.ts";
import { DEFAULT_VIEW_CONFIG } from "../src/view.ts";
import { buildInvoiceFixture, invoiceBundleOf, LITERAL_PROFORMA_NOTICE } from "./fixtures/invoice.ts";

const body = (h: string) => h.slice(h.indexOf("<body>"));
const clone = (e: InvoiceEnvelope): InvoiceEnvelope => JSON.parse(JSON.stringify(e)) as InvoiceEnvelope;
const html = (e: InvoiceEnvelope) => body(renderDocumentHtml(toInvoiceView(e, DEFAULT_VIEW_CONFIG)));
const fresh = async () => (await buildInvoiceFixture("proforma", { gstEstimate: true })).envelope;
const older = async () => (await buildInvoiceFixture("proforma")).envelope;

describe("the proforma GST estimate marker [FX-4 A5 5; 08-C RA-28]", () => {
  it("the words: the head, then '(estimate)' (07-Y, literal here)", () => {
    expect(PROFORMA_PDF_COPY.estimate("CGST")).toBe("CGST (estimate)");
    expect(PROFORMA_PDF_COPY.estimate("IGST")).toBe("IGST (estimate)");
  });

  it("a new proforma carries the marker in its sealed header, verifies, and survives the D1 round trip byte for byte", async () => {
    const e = await fresh();
    expect(e.snapshot.header.proforma).toEqual({ notice: LITERAL_PROFORMA_NOTICE, gstEstimate: true });
    expect(await verifyInvoiceEnvelope(e)).toEqual({ ok: true });
    const text = serializeInvoiceEnvelope(e);
    expect(parseInvoiceEnvelope(text)).not.toBeNull();
    // the rows a D1 read gives (`header_extras` as the freeze writes it) make the same envelope again
    const made = await invoiceEnvelopeOfBundle(invoiceBundleOf(e));
    expect(made.ok).toBe(true);
    expect(made.ok && serializeInvoiceEnvelope(made.envelope)).toBe(text);
  });

  it("an older proforma has no marker and still verifies", async () => {
    const e = await older();
    expect(e.snapshot.header.proforma).toEqual({ notice: LITERAL_PROFORMA_NOTICE });
    expect(await verifyInvoiceEnvelope(e)).toEqual({ ok: true });
    expect(toInvoiceView(e, DEFAULT_VIEW_CONFIG).proforma?.gstEstimate).toBe(false);
  });

  it("the seal covers it: adding, removing or changing the marker fails the snapshot hash", async () => {
    const bad = { ok: false, code: "snapshot_hash" } as const;
    const add = clone(await older());
    (add.snapshot.header.proforma as { gstEstimate?: true }).gstEstimate = true;
    expect(await verifyInvoiceEnvelope(add)).toEqual(bad);
    const drop = clone(await fresh());
    delete (drop.snapshot.header.proforma as { gstEstimate?: true }).gstEstimate;
    expect(await verifyInvoiceEnvelope(drop)).toEqual(bad);
    // and the D1 path: a bundle whose `header_extras` lost the marker no longer matches its `snapshot_sha256`
    const rows = invoiceBundleOf(await fresh());
    rows.document.header_extras = JSON.stringify({ proforma: { notice: LITERAL_PROFORMA_NOTICE } });
    expect(await invoiceEnvelopeOfBundle(rows)).toEqual({ ok: false, code: "snapshot_hash" });
  });

  it("an envelope whose marker is anything but the literal true is not an envelope", async () => {
    const text = serializeInvoiceEnvelope(await fresh());
    const withMarker = (v: unknown) => {
      const e = JSON.parse(text) as { snapshot: { header: { proforma: Record<string, unknown> } } };
      e.snapshot.header.proforma.gstEstimate = v;
      return parseInvoiceEnvelope(JSON.stringify(e));
    };
    for (const v of [false, "true", 1, null, {}]) expect(withMarker(v), String(v)).toBeNull();
    expect(withMarker(true)).not.toBeNull();
  });

  it("the PDF HTML labels every tax head '(estimate)' only with the marker; the notice is still checked", async () => {
    const withIt = html(await fresh());
    const without = html(await older());
    // the totals rows (the fixture is an intra-state supply: CGST and SGST)
    expect(withIt).toContain('<tr><th scope="row">CGST (estimate)</th>');
    expect(withIt).toContain('<tr><th scope="row">SGST (estimate)</th>');
    // the tax summary's column groups
    expect(withIt).toContain('class="inv-head">CGST (estimate)</th>');
    expect(withIt).toContain('class="inv-head">SGST (estimate)</th>');
    expect(without).not.toContain("(estimate)");
    expect(without).toContain('<tr><th scope="row">CGST</th>');
    expect(without).toContain('class="inv-head">CGST</th>');
    // only the heads: the sub-total, the taxable value and the total keep their words
    expect(withIt).not.toContain("Total (estimate)");
    expect(withIt).not.toContain("Taxable value (estimate)");
    expect(missingStatutoryLine(await fresh(), withIt)).toBeNull();
  });

  it("an inter-state proforma labels IGST, in the totals and in the tax summary", async () => {
    const v = toInvoiceView(await fresh(), DEFAULT_VIEW_CONFIG);
    const inter = body(
      renderDocumentHtml({
        ...v,
        supplyType: "inter",
        totals: [
          ...v.totals.filter((t) => t.key !== "cgst" && t.key !== "sgst"),
          { key: "igst", label: "IGST", value: "1" },
        ],
      }),
    );
    expect(inter).toContain('class="inv-head">IGST (estimate)</th>');
    expect(inter).toContain('<tr><th scope="row">IGST (estimate)</th>');
  });

  it("a tax invoice is never labelled", async () => {
    const e = (await buildInvoiceFixture("intra")).envelope;
    const v = toInvoiceView(e, DEFAULT_VIEW_CONFIG);
    expect(v.proforma).toBeNull();
    expect(body(renderDocumentHtml(v))).not.toContain("(estimate)");
  });
});
