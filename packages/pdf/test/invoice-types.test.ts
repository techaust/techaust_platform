// M5.2 stage B1 and the first line of B2 (LD25, LD33, LD37; VERIFY WITH CA/LEGAL): the invoice envelope and its view carry the optional header keys of an export
// invoice, a proforma and the invoice made for money received; an M5.1 envelope with none of them still parses and verifies; the statutory lines are
// held here as LITERALS (not imported from core) so a change of the constants fails a test until a person has looked at it.
import { invoiceSnapshotSha256 } from "@techaust/core/invoices";
import { describe, expect, it } from "vitest";
import { esc } from "../src/escape.ts";
import { invoiceEnvelopeOfBundle } from "../src/invoice-bundle.ts";
import {
  buildInvoiceEnvelope,
  invoiceDraftOf,
  invoiceSnapshotInputOf,
  parseInvoiceEnvelope,
  serializeInvoiceEnvelope,
  verifyInvoiceEnvelope,
} from "../src/invoice-envelope.ts";
import { hasTextNode, missingStatutoryLine } from "../src/invoice-integrity.ts";
import type { InvoiceEnvelope } from "../src/invoice-types.ts";
import { toInvoiceView } from "../src/invoice-view.ts";
import { DEFAULT_VIEW_CONFIG } from "../src/view.ts";
import {
  buildInvoiceFixture,
  EXPORT_NOTE_TEXT,
  invoiceBundleOf,
  LITERAL_ENDORSEMENT,
  LITERAL_PROFORMA_NOTICE,
  SAMPLE_ADVANCE,
  SAMPLE_ARN,
  TYPED_FIXTURE_NAMES,
} from "./fixtures/invoice.ts";

const clone = (e: InvoiceEnvelope): InvoiceEnvelope => JSON.parse(JSON.stringify(e)) as InvoiceEnvelope;
const view = (e: InvoiceEnvelope) => toInvoiceView(e, DEFAULT_VIEW_CONFIG);

describe("the envelope of the M5.2 types [LD25, LD37]", () => {
  it.each(TYPED_FIXTURE_NAMES)(
    "%s: stores, reads back and verifies; the same invoice gives the same bytes; the rows' frozen header_extras give the very same envelope",
    async (name) => {
      const { envelope } = await buildInvoiceFixture(name);
      const text = serializeInvoiceEnvelope(envelope);
      expect(serializeInvoiceEnvelope(buildInvoiceEnvelope(envelope))).toBe(text);
      const back = parseInvoiceEnvelope(text);
      expect(back).not.toBeNull();
      expect(await verifyInvoiceEnvelope(back as InvoiceEnvelope)).toEqual({ ok: true });
      // the snapshot step: rows (with `header_extras` and the rate columns) -> the same envelope, byte for byte
      const made = await invoiceEnvelopeOfBundle(invoiceBundleOf(envelope));
      expect(made.ok).toBe(true);
      expect(made.ok && serializeInvoiceEnvelope(made.envelope)).toBe(text);
    },
  );

  it("an M5.1 envelope has none of the new header keys, still parses, and still verifies", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    expect(Object.keys(envelope.snapshot.header).sort()).toEqual([
      "computedSha256",
      "document",
      "issuer",
      "recipient",
      "supply",
    ]);
    const back = parseInvoiceEnvelope(serializeInvoiceEnvelope(envelope));
    expect(back).not.toBeNull();
    expect(await verifyInvoiceEnvelope(back as InvoiceEnvelope)).toEqual({ ok: true });
    expect(invoiceDraftOf(back as InvoiceEnvelope)).not.toHaveProperty("fx");
  });

  it("each type carries only the keys it needs", async () => {
    const keys = async (n: (typeof TYPED_FIXTURE_NAMES)[number]) =>
      Object.keys((await buildInvoiceFixture(n)).envelope.snapshot.header)
        .filter((k) => ["export", "fx", "proforma", "advance"].includes(k))
        .sort();
    expect(await keys("export_lut")).toEqual(["export", "fx"]);
    expect(await keys("export_igst")).toEqual(["export", "fx"]);
    expect(await keys("proforma")).toEqual(["proforma"]);
    expect(await keys("advance")).toEqual(["advance"]);
    expect(await keys("advance_export")).toEqual(["advance", "export", "fx"]);
  });

  it("the sealed export part is the literal endorsement, the LUT of the issue FY and the country; the IGST route has no LUT", async () => {
    const lut = (await buildInvoiceFixture("export_lut")).envelope.snapshot.header.export;
    expect(lut).toEqual({
      mode: "lut",
      endorsement: LITERAL_ENDORSEMENT.lut,
      lut: { fy: "2627", arn: SAMPLE_ARN },
      countryCode: "US",
      countryName: "United States",
      declarationRef: null,
    });
    const igst = (await buildInvoiceFixture("export_igst")).envelope.snapshot.header.export;
    expect(igst).toMatchObject({ mode: "igst_paid", endorsement: LITERAL_ENDORSEMENT.igst_paid, lut: null });
    expect((await buildInvoiceFixture("proforma")).envelope.snapshot.header.proforma).toEqual({
      notice: LITERAL_PROFORMA_NOTICE,
    });
  });

  it("the extra export note: its frozen text is in the envelope and the view; changed text or a missing text is refused", async () => {
    const e = (await buildInvoiceFixture("export_note")).envelope;
    expect(e.snapshot.header.export?.declarationText).toBe(EXPORT_NOTE_TEXT);
    expect(view(e).export?.declaration).toEqual({
      id: "note-1",
      version: 1,
      sha256: e.snapshot.header.export?.declarationRef?.sha256,
      text: EXPORT_NOTE_TEXT,
    });
    // the text moves after sealing: the seal catches it
    const forged = clone(e);
    (forged.snapshot.header.export as { declarationText: string }).declarationText = "A different note.";
    expect(await verifyInvoiceEnvelope(forged)).toEqual({ ok: false, code: "snapshot_hash" });
    // the seal is rebuilt around the new text: the note's own SHA-256 still catches it
    const resealed = clone(forged);
    resealed.snapshotSha256 = await invoiceSnapshotSha256(invoiceSnapshotInputOf(resealed));
    expect(await verifyInvoiceEnvelope(resealed)).toEqual({ ok: false, code: "terms_hash" });
    // a ref with no text, or a text with no ref, is not an envelope
    const noText = JSON.parse(serializeInvoiceEnvelope(e)) as {
      snapshot: { header: { export: Record<string, unknown> } };
    };
    delete noText.snapshot.header.export.declarationText;
    expect(parseInvoiceEnvelope(JSON.stringify(noText))).toBeNull();
    const orphan = JSON.parse(
      serializeInvoiceEnvelope((await buildInvoiceFixture("export_lut")).envelope),
    ) as {
      snapshot: { header: { export: Record<string, unknown> } };
    };
    orphan.snapshot.header.export.declarationText = "x";
    expect(parseInvoiceEnvelope(JSON.stringify(orphan))).toBeNull();
  });

  it("the copy mark: ORIGINAL FOR RECIPIENT on an export invoice, null on a proforma", async () => {
    expect(view((await buildInvoiceFixture("export_lut")).envelope).copyLabel).toBe("ORIGINAL FOR RECIPIENT");
    expect(view((await buildInvoiceFixture("proforma")).envelope).copyLabel).toBeNull();
  });

  it("every sealed part is covered by the hash: one changed character of the endorsement, the ARN, the country, the notice, the rate or the advance reference fails verification", async () => {
    const lutEnv = (await buildInvoiceFixture("export_lut")).envelope;
    const tampered = async (
      e: InvoiceEnvelope,
      mutate: (h: InvoiceEnvelope["snapshot"]["header"]) => void,
    ) => {
      const c = clone(e);
      mutate(c.snapshot.header);
      return verifyInvoiceEnvelope(c);
    };
    const bad = { ok: false, code: "snapshot_hash" } as const;
    expect(await tampered(lutEnv, (h) => ((h.export as { endorsement: string }).endorsement += "."))).toEqual(
      bad,
    );
    expect(await tampered(lutEnv, (h) => ((h.export as { lut: { arn: string } }).lut.arn += "X"))).toEqual(
      bad,
    );
    expect(
      await tampered(lutEnv, (h) => ((h.export as { countryName: string }).countryName = "USA")),
    ).toEqual(bad);
    expect(await tampered(lutEnv, (h) => ((h.fx as { rateMicros: number }).rateMicros += 1))).toEqual(bad);
    const pf = (await buildInvoiceFixture("proforma")).envelope;
    expect(await tampered(pf, (h) => ((h.proforma as { notice: string }).notice = "Tax invoice"))).toEqual(
      bad,
    );
    const adv = (await buildInvoiceFixture("advance")).envelope;
    expect(await tampered(adv, (h) => ((h.advance as { receiptId: string }).receiptId = "other"))).toEqual(
      bad,
    );
  });

  it("an export invoice without its export part, or a proforma without its notice, is not an envelope to print from", async () => {
    const lutEnv = clone((await buildInvoiceFixture("export_lut")).envelope);
    delete (lutEnv.snapshot.header as { export?: unknown }).export;
    expect(await verifyInvoiceEnvelope(lutEnv)).toEqual({ ok: false, code: "mismatch" });
    const pf = clone((await buildInvoiceFixture("proforma")).envelope);
    delete (pf.snapshot.header as { proforma?: unknown }).proforma;
    expect(await verifyInvoiceEnvelope(pf)).toEqual({ ok: false, code: "mismatch" });
  });

  it("the rate is part of the content hash a verifier recomputes (the draft carries it), and a header with the rate removed fails", async () => {
    const { envelope } = await buildInvoiceFixture("export_lut");
    expect(invoiceDraftOf(envelope).fx).toEqual({
      rateMicros: 83_123_400,
      date: "2026-10-27",
      source: "FBIL reference rate",
    });
    // dropping the key from the header: the seal no longer matches
    const c = clone(envelope);
    delete (c.snapshot.header as { fx?: unknown }).fx;
    expect((await verifyInvoiceEnvelope(c)).ok).toBe(false);
  });

  it("refuses an optional part of the wrong shape", async () => {
    const text = serializeInvoiceEnvelope((await buildInvoiceFixture("export_lut")).envelope);
    const bad = (mutate: (h: Record<string, unknown>) => void) => {
      const e = JSON.parse(text) as { snapshot: { header: Record<string, unknown> } };
      mutate(e.snapshot.header);
      return parseInvoiceEnvelope(JSON.stringify(e));
    };
    expect(bad((h) => (h.export = 5))).toBeNull();
    expect(bad((h) => (h.export = { mode: "other", endorsement: "x" }))).toBeNull();
    expect(bad((h) => (h.export = { ...(h.export as object), lut: { fy: 2627 } }))).toBeNull();
    expect(bad((h) => (h.export = { ...(h.export as object), declarationRef: 3 }))).toBeNull();
    expect(bad((h) => (h.fx = { rateMicros: "83" }))).toBeNull();
    expect(bad((h) => (h.proforma = { notice: 3 }))).toBeNull();
    expect(bad((h) => (h.advance = { proformaId: "x" }))).toBeNull();
    expect(bad((h) => ((h.recipient as Record<string, unknown>).deliveryAddress = "x"))).toBeNull();
    expect(bad(() => undefined)).not.toBeNull();
  });
});

describe("the view of the M5.2 types", () => {
  it("an export invoice under LUT: the endorsement byte for byte, the LUT line data, the country, the address of delivery, the INR block and the SWIFT details", async () => {
    const v = view((await buildInvoiceFixture("export_lut")).envelope);
    expect(v.docLabel).toBe("Export Invoice");
    expect(v.export).toEqual({
      mode: "lut",
      endorsement: LITERAL_ENDORSEMENT.lut,
      lut: { fy: "2627", fyLabel: "2026-27", arn: SAMPLE_ARN },
      countryName: "United States",
      placeOfSupply: "Outside India (96)",
      deliveryAddress: ["9 Delivery Road", "Chicago, IL, 60601", "United States"],
      declaration: null,
    });
    expect(v.currency).toBe("USD");
    expect(v.inr).toMatchObject({ rate: "83.1234", source: "FBIL reference rate", igst: null });
    expect(v.inr?.date).toMatch(/27 Oct/);
    expect(v.inr?.taxable).toMatch(/^₹/);
    expect(v.swift).toEqual({
      beneficiary: "Sample Proprietor",
      accountNo: "SAMPLEUSD0001",
      swift: "SAMPINBBXXX",
      bank: "SAMPLE BANK, Sample branch",
      bankAddress: "3 Sample Bank Street, Kolkata",
      intermediary: "Sample Intermediary Bank, New York",
      purposeCode: "P0802",
    });
    expect(v.bank).toBeNull(); // a USD document has no INR block
    expect(v.proforma).toBeNull();
    expect(v.advance).toBeNull();
  });

  it("an export invoice with IGST paid: the other endorsement, no LUT, and the INR block carries the IGST", async () => {
    const v = view((await buildInvoiceFixture("export_igst")).envelope);
    expect(v.export).toMatchObject({
      mode: "igst_paid",
      endorsement: LITERAL_ENDORSEMENT.igst_paid,
      lut: null,
    });
    expect(v.inr?.igst).toMatch(/^₹/);
    expect(v.totals.some((t) => t.key === "igst")).toBe(true);
  });

  it("a proforma: its notice, its title, its valid-until day (the due date); nothing of an export", async () => {
    const v = view((await buildInvoiceFixture("proforma")).envelope);
    expect(v.docLabel).toBe("Proforma Invoice");
    expect(v.proforma?.notice).toBe(LITERAL_PROFORMA_NOTICE);
    expect(v.proforma?.validUntil).toBe(v.dueDate);
    expect(v.export).toBeNull();
    expect(v.inr).toBeNull();
    expect(v.swift).toBeNull();
    expect(v.advance).toBeNull();
  });

  it("the invoice made for money received: the proforma's number and date and the day the money arrived; an overseas one keeps its export part", async () => {
    const v = view((await buildInvoiceFixture("advance")).envelope);
    expect(v.docLabel).toBe("Tax Invoice");
    expect(v.advance).toEqual({
      proformaNumber: SAMPLE_ADVANCE.proformaNumber,
      proformaDate: "20 Oct 26",
      receivedOn: "27 Oct 26",
    });
    const x = view((await buildInvoiceFixture("advance_export")).envelope);
    expect(x.advance?.proformaNumber).toBe(SAMPLE_ADVANCE.proformaNumber);
    expect(x.export?.endorsement).toBe(LITERAL_ENDORSEMENT.lut);
  });

  it("an M5.1 tax invoice has none of the new parts", async () => {
    const v = view((await buildInvoiceFixture("intra")).envelope);
    expect(v.docLabel).toBe("Tax Invoice");
    expect([v.export, v.inr, v.swift, v.proforma, v.advance]).toEqual([null, null, null, null, null]);
  });

  it("what is shown is what was frozen: the view reads the sealed header, so another country name or ARN in the rows cannot change it", async () => {
    const { envelope } = await buildInvoiceFixture("export_lut");
    const c = clone(envelope);
    (c.snapshot.header.recipient as { country: string }).country = "DE"; // live data moved on; the header's export part is what prints
    expect(view(c).export?.countryName).toBe("United States");
    expect(view(c).export?.lut?.arn).toBe(SAMPLE_ARN);
  });
});

describe("the statutory line before rendering [LD33]", () => {
  const page = (inner: string) => `<html><body><main>${inner}</main></body></html>`;

  it("an export invoice passes when its frozen endorsement is one text node, whatever the element or the white space around it", async () => {
    const { envelope } = await buildInvoiceFixture("export_lut");
    const e = LITERAL_ENDORSEMENT.lut;
    expect(missingStatutoryLine(envelope, page(`<p class="endorsement">${e}</p>`))).toBeNull();
    expect(missingStatutoryLine(envelope, page(`<div>\n  ${e}\n</div>`))).toBeNull();
    expect(hasTextNode(page(`<p>${e}</p>`), e)).toBe(true);
  });

  it("one character changed, a different route's line, the line split over two elements, the line inside a longer text, or nothing: refused as `endorsement`", async () => {
    const { envelope } = await buildInvoiceFixture("export_lut");
    const e = LITERAL_ENDORSEMENT.lut;
    const refused = (html: string) => missingStatutoryLine(envelope, page(html));
    expect(refused(`<p>${e.replace("UNDER BOND", "UNDER BONDS")}</p>`)).toBe("endorsement");
    expect(refused(`<p>${e.slice(0, -1)}</p>`)).toBe("endorsement");
    expect(refused(`<p>${LITERAL_ENDORSEMENT.igst_paid}</p>`)).toBe("endorsement");
    expect(refused(`<p>${e.slice(0, 40)}</p><p>${e.slice(40)}</p>`)).toBe("endorsement");
    expect(refused(`<p>Note: ${e}</p>`)).toBe("endorsement");
    expect(refused(`<p>${e.toLowerCase()}</p>`)).toBe("endorsement");
    expect(refused("<p>Export Invoice</p>")).toBe("endorsement");
  });

  it("a proforma passes with its frozen notice and is refused as `notice` without it, or with one character changed", async () => {
    const { envelope } = await buildInvoiceFixture("proforma");
    const n = LITERAL_PROFORMA_NOTICE;
    expect(missingStatutoryLine(envelope, page(`<p>${n}</p>`))).toBeNull();
    expect(missingStatutoryLine(envelope, page(`<p>${n.replace(".", "")}</p>`))).toBe("notice");
    expect(missingStatutoryLine(envelope, page(`<p>${n}!</p>`))).toBe("notice");
    expect(missingStatutoryLine(envelope, page("<p>Proforma Invoice</p>"))).toBe("notice");
  });

  it("the line is judged as the layout escapes it, and the check reads the frozen header (not the view)", async () => {
    const { envelope } = await buildInvoiceFixture("export_lut");
    const c = clone(envelope);
    (c.snapshot.header.export as { endorsement: string }).endorsement = `A & B "C" <D> 'E'`;
    expect(missingStatutoryLine(c, page(`<p>${esc(`A & B "C" <D> 'E'`)}</p>`))).toBeNull();
    expect(missingStatutoryLine(c, page(`<p>A & B "C" <D> 'E'</p>`))).toBe("endorsement");
    expect(hasTextNode(page("<p></p>"), "")).toBe(false);
  });

  it("a tax invoice and an invoice made for money received need no such line; an export without its export part is refused", async () => {
    expect(missingStatutoryLine((await buildInvoiceFixture("intra")).envelope, page(""))).toBeNull();
    expect(missingStatutoryLine((await buildInvoiceFixture("advance")).envelope, page(""))).toBeNull();
    const c = clone((await buildInvoiceFixture("export_lut")).envelope);
    delete (c.snapshot.header as { export?: unknown }).export;
    expect(missingStatutoryLine(c, page(`<p>${LITERAL_ENDORSEMENT.lut}</p>`))).toBe("endorsement");
  });
});
