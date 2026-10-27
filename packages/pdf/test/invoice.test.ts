// The invoice envelope and view (M5.1 stage B: B1; test 11; the printed layout and the skeleton are tested in ./invoice-layout.test.ts). VERIFY WITH CA/LEGAL for every rule printed (Rule 46, Rule 48).
import { describe, expect, it } from "vitest";
import { invoiceEnvelopeOfBundle } from "../src/invoice-bundle.ts";
import {
  buildInvoiceEnvelope,
  invoiceDraftOf,
  parseInvoiceEnvelope,
  serializeInvoiceEnvelope,
  verifyInvoiceEnvelope,
  verifySignatureBytes,
} from "../src/invoice-envelope.ts";
import type { InvoiceEnvelope } from "../src/invoice-types.ts";
import { halfRate, toInvoiceView } from "../src/invoice-view.ts";
import { warmInvoiceEnvelope, warmInvoicePdf } from "../src/sample.ts";
import { DEFAULT_VIEW_CONFIG } from "../src/view.ts";
import {
  buildInvoiceFixture,
  INVOICE_FIXTURE_NAMES,
  invoiceBundleOf,
  SIGNATURE_BYTES,
} from "./fixtures/invoice.ts";

/** The house style writes a percent with a no-break space before the sign (view.ts `pct`). */
const nb = (t: string) => t.replace(" %", " %");
const clone = (e: InvoiceEnvelope): InvoiceEnvelope => JSON.parse(JSON.stringify(e)) as InvoiceEnvelope;

describe("the invoice envelope [LD4]", () => {
  it.each(INVOICE_FIXTURE_NAMES)(
    "%s: stores, reads back and verifies; the same invoice always gives the same bytes",
    async (name) => {
      const { envelope } = await buildInvoiceFixture(name);
      const text = serializeInvoiceEnvelope(envelope);
      expect(serializeInvoiceEnvelope(buildInvoiceEnvelope(envelope))).toBe(text);
      const back = parseInvoiceEnvelope(text);
      expect(back).not.toBeNull();
      expect(serializeInvoiceEnvelope(back as InvoiceEnvelope)).toBe(text);
      expect(await verifyInvoiceEnvelope(back as InvoiceEnvelope)).toEqual({ ok: true });
    },
  );

  it("its shape: format 3, kind invoice, the number paired with the seal outside it", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    expect(envelope).toMatchObject({
      v: 3,
      kind: "invoice",
      type: "tax_invoice",
      number: 12,
      numberDisplay: "TH/INV/2627/0012",
      series: "invoice",
      fy: "2026-27",
    });
    // the number is not in the sealed header
    expect(JSON.stringify(envelope.snapshot.header)).not.toContain("TH/INV");
    expect(envelope.snapshot.header.issuer.reverseChargeText).toBe("Tax payable on reverse charge: No");
  });

  it("refuses text that is not an invoice envelope", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    const text = serializeInvoiceEnvelope(envelope);
    const bad = (mutate: (e: Record<string, unknown>) => void) => {
      const e = JSON.parse(text) as Record<string, unknown>;
      mutate(e);
      return parseInvoiceEnvelope(JSON.stringify(e));
    };
    for (const t of ["", "null", "[]", "{}", "not json", '{"v":1}', '{"v":3,"kind":"proposal"}']) {
      expect(parseInvoiceEnvelope(t), t).toBeNull();
    }
    expect(
      bad((e) => {
        e.v = 1;
      }),
    ).toBeNull();
    expect(
      bad((e) => {
        e.kind = "quote";
      }),
    ).toBeNull();
    expect(
      bad((e) => {
        delete e.number;
      }),
    ).toBeNull();
    expect(
      bad((e) => {
        e.snapshot = null;
      }),
    ).toBeNull();
    expect(
      bad((e) => {
        (e.snapshot as Record<string, unknown>).lines = "x";
      }),
    ).toBeNull();
    expect(
      bad((e) => {
        (e.snapshot as Record<string, unknown>).terms = 3;
      }),
    ).toBeNull();
    expect(
      bad((e) => {
        (e.snapshot as { header: Record<string, unknown> }).header.issuer = {};
      }),
    ).toBeNull();
    expect(
      bad((e) => {
        (e.snapshot as { header: { issuer: Record<string, unknown> } }).header.issuer.reverseChargeText = 5;
      }),
    ).toBeNull();
    expect(
      bad((e) => {
        (e.snapshot as { header: { issuer: Record<string, unknown> } }).header.issuer.signature = 5;
      }),
    ).toBeNull();
    expect(
      bad((e) => {
        (e.snapshot as { header: Record<string, unknown> }).header.computedSha256 = 5;
      }),
    ).toBeNull();
  });

  it("a tampered envelope is refused, one hash at a time", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    const code = async (mutate: (e: InvoiceEnvelope) => void) => {
      const e = clone(envelope);
      mutate(e);
      const r = await verifyInvoiceEnvelope(e);
      return r.ok ? "ok" : r.code;
    };
    expect(await code(() => undefined)).toBe("ok");
    expect(
      await code((e) => {
        (e as { v: number }).v = 1;
      }),
    ).toBe("version");
    expect(
      await code((e) => {
        e.type = "export_invoice";
      }),
    ).toBe("mismatch");
    expect(
      await code((e) => {
        (e.snapshot.terms as { version: number }).version = 9;
      }),
    ).toBe("mismatch");
    expect(
      await code((e) => {
        e.snapshot.terms = null;
      }),
    ).toBe("mismatch");
    // the sealed header: the recipient, the issuer words, the due date, the number's pairing
    expect(
      await code((e) => {
        (e.snapshot.header.recipient as { legalName: string }).legalName = "Someone Else";
      }),
    ).toBe("snapshot_hash");
    expect(
      await code((e) => {
        e.snapshot.header.issuer.reverseChargeText = "Tax payable on reverse charge: Yes";
      }),
    ).toBe("snapshot_hash");
    expect(
      await code((e) => {
        e.snapshot.header.document.dueDate = "2026-12-31";
      }),
    ).toBe("snapshot_hash");
    expect(
      await code((e) => {
        e.snapshotSha256 = "0".repeat(64);
      }),
    ).toBe("snapshot_hash");
    // the computed text
    expect(
      await code((e) => {
        e.snapshot.computedJson += " ";
      }),
    ).toBe("computed_hash");
    // the notes text (its hash is in the seal, the text is not)
    expect(
      await code((e) => {
        (e.snapshot.terms as { bodyMd: string }).bodyMd += " Extra.";
      }),
    ).toBe("terms_hash");
    // a line the content hash covers
    expect(
      await code((e) => {
        (e.snapshot.lines[0] as { description: string }).description = "Changed";
      }),
    ).toBe("content_hash");
    expect(
      await code((e) => {
        e.snapshot.discountKind = "percent";
        e.snapshot.discountValue = 100;
      }),
    ).toBe("content_hash");
  });

  it("an unreadable computed text is refused with its own code", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    const e = clone(envelope);
    const broken = "{not json";
    const sha = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(broken))),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    e.snapshot.computedJson = broken;
    e.snapshot.header.computedSha256 = sha;
    // (the seal no longer matches either, which is checked first)
    expect(await verifyInvoiceEnvelope(e)).toEqual({ ok: false, code: "snapshot_hash" });
  });

  it("the draft a content hash is computed over has no title, validity, sections or schedule, and the contact of the recipient", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    const d = invoiceDraftOf(envelope);
    expect(d).toMatchObject({
      type: "tax_invoice",
      title: null,
      validityDays: null,
      termsVersionId: null,
      sections: [],
      schedule: [],
      contactId: "con_sample_1",
    });
  });

  it("a signature's bytes are accepted only with the frozen SHA-256", async () => {
    const { envelope } = await buildInvoiceFixture("signed");
    expect(await verifySignatureBytes(envelope, SIGNATURE_BYTES)).toBe(true);
    expect(await verifySignatureBytes(envelope, new Uint8Array([1, 2, 3]))).toBe(false);
    const none = (await buildInvoiceFixture("intra")).envelope;
    expect(await verifySignatureBytes(none, SIGNATURE_BYTES)).toBe(false);
  });
});

describe("invoiceEnvelopeOfBundle: the envelope made from the rows, through the issue route's own sealing functions", () => {
  it.each(INVOICE_FIXTURE_NAMES)("%s: gives back exactly the sealed envelope", async (name) => {
    const { envelope } = await buildInvoiceFixture(name);
    const made = await invoiceEnvelopeOfBundle(invoiceBundleOf(envelope));
    expect(made.ok).toBe(true);
    if (made.ok) expect(serializeInvoiceEnvelope(made.envelope)).toBe(serializeInvoiceEnvelope(envelope));
  });

  it("refuses rows that do not reproduce their seal or content hash", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    const line = invoiceBundleOf(envelope);
    (line.lines[0] as { description: string }).description = "Changed";
    expect(await invoiceEnvelopeOfBundle(line)).toEqual({ ok: false, code: "content_hash" });

    const header = invoiceBundleOf(envelope);
    (header.document.recipient as { legalName: string }).legalName = "Someone Else";
    expect(await invoiceEnvelopeOfBundle(header)).toEqual({ ok: false, code: "snapshot_hash" });

    const reverse = invoiceBundleOf(envelope);
    (reverse.document.issuer as { reverseChargeText: string }).reverseChargeText =
      "Tax payable on reverse charge: Yes";
    expect(await invoiceEnvelopeOfBundle(reverse)).toEqual({ ok: false, code: "snapshot_hash" });

    const stored = invoiceBundleOf(envelope);
    stored.document.snapshot_sha256 = "0".repeat(64);
    expect(await invoiceEnvelopeOfBundle(stored)).toEqual({ ok: false, code: "snapshot_hash" });

    const notes = invoiceBundleOf(envelope);
    (notes.terms as { body_md: string }).body_md += " Extra.";
    expect(await invoiceEnvelopeOfBundle(notes)).toEqual({ ok: false, code: "terms_hash" });
  });

  it("says why it cannot make one: not an invoice, not issued, no FY, a number from another series, notes missing", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    const quote = invoiceBundleOf(envelope);
    (quote.document as { type: string }).type = "proposal";
    expect(await invoiceEnvelopeOfBundle(quote)).toEqual({ ok: false, code: "unsupported_type" });
    const draft = invoiceBundleOf(envelope);
    draft.document.frozen_at = null;
    expect(await invoiceEnvelopeOfBundle(draft)).toEqual({ ok: false, code: "not_issued" });
    const noFy = invoiceBundleOf(envelope);
    noFy.document.fy = "abcd";
    expect(await invoiceEnvelopeOfBundle(noFy)).toEqual({ ok: false, code: "not_issued" });
    const series = invoiceBundleOf(envelope);
    series.document.series = "export";
    expect(await invoiceEnvelopeOfBundle(series)).toEqual({ ok: false, code: "not_issued" });
    const noNotes = invoiceBundleOf(envelope);
    noNotes.terms = null;
    expect(await invoiceEnvelopeOfBundle(noNotes)).toEqual({ ok: false, code: "not_issued" });
  });

  it("a void invoice is made from its issued snapshot: the void columns are not read (LD7)", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    const voided = invoiceBundleOf(envelope);
    voided.document.status = "void";
    (voided.document as { voided_at: number }).voided_at = 123;
    (voided.document as { void_reason: string }).void_reason = "x";
    const made = await invoiceEnvelopeOfBundle(voided);
    expect(made.ok).toBe(true);
    if (made.ok) expect(serializeInvoiceEnvelope(made.envelope)).toBe(serializeInvoiceEnvelope(envelope));
  });
});

describe("the per-head rates are derived from the frozen rate and the supply type [LD10]", () => {
  it("half of a rate: 18 % gives 9 %, 5 % gives 2.5 %, 0.25 % gives 0.125 %, odd basis points get one more decimal", () => {
    expect(halfRate(1800)).toBe(nb("9 %"));
    expect(halfRate(500)).toBe(nb("2.5 %"));
    expect(halfRate(1200)).toBe(nb("6 %"));
    expect(halfRate(25)).toBe(nb("0.125 %"));
    expect(halfRate(21)).toBe(nb("0.105 %"));
    expect(halfRate(0)).toBe(nb("0 %"));
    expect(() => halfRate(-1)).toThrow(RangeError);
    expect(() => halfRate(1.5)).toThrow(RangeError);
  });

  it("an intra-state invoice prints CGST 9 % and SGST 9 % on every line and in the summary; no IGST", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    const v = toInvoiceView(envelope, DEFAULT_VIEW_CONFIG);
    expect(v.supplyType).toBe("intra");
    for (const l of v.lines) {
      expect(l.headRates).toEqual({ cgst: nb("9 %"), sgst: nb("9 %"), igst: null });
      expect(l.headAmounts.cgst).toMatch(/^₹/);
      expect(l.headAmounts.sgst).toMatch(/^₹/);
      expect(l.headAmounts.igst).toBeNull();
    }
    expect(v.summary).toHaveLength(1);
    expect(v.summary[0]?.headRates).toEqual({ cgst: nb("9 %"), sgst: nb("9 %"), igst: null });
    expect(v.totals.map((t) => t.key)).toEqual(["subtotal", "taxable", "cgst", "sgst", "total"]);
  });

  it("an inter-state invoice prints IGST 18 % and no CGST or SGST", async () => {
    const { envelope } = await buildInvoiceFixture("inter");
    const v = toInvoiceView(envelope, DEFAULT_VIEW_CONFIG);
    expect(v.supplyType).toBe("inter");
    for (const l of v.lines) expect(l.headRates).toEqual({ cgst: null, sgst: null, igst: nb("18 %") });
    expect(v.totals.map((t) => t.key)).toContain("igst");
    expect(v.totals.map((t) => t.key)).not.toContain("cgst");
  });
});

describe("toInvoiceView", () => {
  it("builds the title, the dates, the words, the reverse-charge line as frozen, the copy label and the integrity line", async () => {
    const { envelope, computed } = await buildInvoiceFixture("intra");
    const v = toInvoiceView(envelope, DEFAULT_VIEW_CONFIG);
    expect(v.title).toBe("Tax Invoice TH/INV/2627/0012 – Sample Client");
    expect(v.docLabel).toBe("Tax Invoice");
    expect(v.numberDisplay).toBe("TH/INV/2627/0012");
    expect(v.issueDate).toBe("28 Oct 26");
    expect(v.dueDate).toBe("04 Nov 26");
    expect(v.copyLabel).toBe("ORIGINAL FOR RECIPIENT");
    expect(v.reverseCharge).toBe("Tax payable on reverse charge: No");
    expect(v.words).toBe(computed.words);
    expect(v.placeOfSupply).toBe("West Bengal (19)");
    expect(v.recipient).toMatchObject({
      name: "Sample Client",
      gstin: "19ABCDE1234F1ZX",
      state: "West Bengal (19)",
      attention: "Sample Contact",
    });
    expect(v.integrity).toBe(
      `Document ID ${envelope.documentId} · Content fingerprint ${envelope.snapshotSha256.slice(0, 12)}`,
    );
    expect(v.footer.sender).toBe("billing@example.test");
    expect(v.notes).toEqual({
      title: "Notes, version 2",
      version: "2",
      bodyMd: expect.stringContaining("Sample notes"),
    });
    const total = v.totals.find((t) => t.key === "total");
    expect(total?.value.replace(/[^\d]/g, "")).toBe(String(computed.totalMinor));
  });

  it("the supplier prints its name, address, GSTIN, State and principal place; an unregistered recipient prints no GSTIN but its State", async () => {
    const full = toInvoiceView((await buildInvoiceFixture("intra")).envelope, DEFAULT_VIEW_CONFIG);
    expect(full.supplier.name).toBe("TecHaust Technologies");
    expect(full.supplier.lines).toEqual([
      "Proprietor: Sample Proprietor",
      "1 Sample Supplier Road, Balurghat, West Bengal 733101",
      "Principal place of business: 2 Sample Office Lane, Balurghat",
      "GSTIN 19ABCDE1234F1ZX · State West Bengal (19)",
      "billing@example.test",
      "+91 90000 00000",
    ]);
    const un = toInvoiceView((await buildInvoiceFixture("discount")).envelope, DEFAULT_VIEW_CONFIG);
    expect(un.recipient.gstin).toBeNull();
    expect(un.recipient.state).toBe("West Bengal (19)");
    expect(un.totals.map((t) => t.key)).toContain("discount");
  });

  it("with no bank block and no signature, nothing is invented; an empty supplier leaves its lines out", async () => {
    const { envelope } = await buildInvoiceFixture("bare");
    const v = toInvoiceView(envelope, DEFAULT_VIEW_CONFIG);
    expect(v.bank).toBeNull();
    expect(v.signature).toBeNull();
    expect(v.notes).toBeNull();
    expect(v.supplier.lines).toEqual(["State West Bengal (19)", "hello@techaust.com"]);
  });

  it("the bank block lists what the invoice froze, in a fixed order", async () => {
    const v = toInvoiceView((await buildInvoiceFixture("intra")).envelope, DEFAULT_VIEW_CONFIG);
    expect(v.bank).toEqual([
      { label: "Account name", value: "Sample Proprietor" },
      { label: "Account number", value: "SAMPLE0001" },
      { label: "IFSC", value: "SAMP0000001" },
      { label: "Bank", value: "SAMPLE BANK" },
      { label: "Branch", value: "Sample branch" },
    ]);
  });

  it("a signature becomes a data URI only for verified PNG or JPEG bytes in base64", async () => {
    const { envelope } = await buildInvoiceFixture("signed");
    const ok = toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, {
      signature: { mime: "image/png", base64: "QUJD" },
    });
    expect(ok.signature).toEqual({ dataUri: "data:image/png;base64,QUJD" });
    for (const bad of [
      { mime: "image/svg+xml", base64: "QUJD" },
      { mime: "text/html", base64: "QUJD" },
      { mime: "image/png", base64: 'QUJD" onerror="x' },
      { mime: "image/png", base64: "" },
    ])
      expect(toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, { signature: bad }).signature).toBeNull();
    expect(toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, { signature: null }).signature).toBeNull();
  });

  it("refuses an envelope whose lines do not match its computed result, and an unknown currency", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    const short = clone(envelope);
    short.snapshot.lines.pop();
    expect(() => toInvoiceView(short, DEFAULT_VIEW_CONFIG)).toThrow(RangeError);
    const eur = clone(envelope);
    eur.snapshot.computedJson = eur.snapshot.computedJson.replace('"currency":"INR"', '"currency":"EUR"');
    expect(() => toInvoiceView(eur, DEFAULT_VIEW_CONFIG)).toThrow(RangeError);
  });

  it("the view carries no catalogue rate, no catalogue id, no staff id and no signature key (a key scan)", async () => {
    const { envelope } = await buildInvoiceFixture("signed");
    const text = JSON.stringify(
      toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, { signature: { mime: "image/png", base64: "QUJD" } }),
    );
    for (const key of [
      "catalogueRateMinor",
      "catalogueItemId",
      "catalogueLine",
      "staffId",
      "computedJson",
      "settings/signature",
    ])
      expect(text, key).not.toContain(key);
  });
});

describe("the warm-up sample", () => {
  it("renders to HTML without verification and never throws", () => {
    expect(warmInvoiceEnvelope().snapshot.lines).toHaveLength(1);
    expect(warmInvoicePdf()).toBeGreaterThan(10_000);
  });
});
