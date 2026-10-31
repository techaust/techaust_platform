// T4 and T10 (rt2; ADM-INV-01, ADM-INV-06): the envelope, view and integrity logic of the signature rule and the Udyam line. A present Udyam block has the sealed
// shape (two non-blank strings, never today's format rule) and is only on a tax invoice (else the envelope is refused); the view gives the layout 07-ZC line 6; the gate refuses a page that does not print it as ONE text
// node; a credit or debit note and an invoice for a payment received need a frozen signature (`signatureMissing`, the jobs refusal). The layouts (designed and skeleton)
// print the line under the GSTIN line, and the F1 cases below prove it on the real HTML.
import { invoiceSnapshotSha256, isUdyam } from "@techaust/core/invoices";
import { describe, expect, it } from "vitest";
import {
  invoiceSnapshotInputOf,
  parseInvoiceEnvelope,
  serializeInvoiceEnvelope,
  verifyInvoiceEnvelope,
} from "../src/invoice-envelope.ts";
import { missingStatutoryLine, requiresSignature, signatureMissing } from "../src/invoice-integrity.ts";
import type { InvoiceEnvelope, InvoiceView } from "../src/invoice-types.ts";
import { toInvoiceView } from "../src/invoice-view.ts";
import { UDYAM_COPY } from "../src/layout/copy.ts";
import { supplierLinesHtml, TAX_INVOICE_CSS } from "../src/layout/invoice.ts";
import { invoiceBody } from "../src/layout/invoice-skeleton.ts";
import { renderDocumentHtml } from "../src/render.ts";
import { DEFAULT_VIEW_CONFIG } from "../src/view.ts";
import { buildInvoiceFixture } from "./fixtures/invoice.ts";
import { buildNoteFixture } from "./fixtures/notes.ts";

const UDYAM = { number: "UDYAM-WB-01-0012345", category: "micro" } as const;
const LINE = "Udyam Registration No. UDYAM-WB-01-0012345 (Micro enterprise)";
const clone = (e: InvoiceEnvelope): InvoiceEnvelope => JSON.parse(JSON.stringify(e)) as InvoiceEnvelope;
const reseal = async (e: InvoiceEnvelope): Promise<InvoiceEnvelope> => {
  const r = clone(e);
  r.snapshotSha256 = await invoiceSnapshotSha256(invoiceSnapshotInputOf(r));
  return r;
};
/** The envelope with a Udyam block in its issuer (resealed, as the issue route would have sealed it). */
const withUdyam = async (e: InvoiceEnvelope, udyam: unknown = UDYAM): Promise<InvoiceEnvelope> => {
  const c = clone(e);
  (c.snapshot.header.issuer.company as Record<string, unknown>).udyam = udyam;
  return reseal(c);
};
/** A page with the line as one text node (what the designer's layout must print), and pages that split or reword it. */
const page = (body: string) => `<html><body><div class="supplier">${body}</div></body></html>`;
/** The first party block of a page ("From": the supplier), up to the next one. */
const supplierBlock = (html: string): string => {
  const at = html.indexOf('<div class="party">');
  const next = html.indexOf('<div class="party', at + 1);
  return html.slice(at, next < 0 ? undefined : next);
};

describe("07-ZC line 6 and the category words (approved 2026-10-31)", () => {
  it("prints the number and the category's words; the three categories are line 5's options", () => {
    expect(UDYAM_COPY.line(UDYAM.number, UDYAM.category)).toBe(LINE);
    expect(UDYAM_COPY.categories).toEqual({
      micro: "Micro enterprise",
      small: "Small enterprise",
      medium: "Medium enterprise",
    });
    expect(UDYAM_COPY.line("UDYAM-WB-01-0012345", "medium")).toBe(
      "Udyam Registration No. UDYAM-WB-01-0012345 (Medium enterprise)",
    );
    // a sealed category line 5 has no words for prints as stored (own keys only: "toString" is not a category)
    expect(UDYAM_COPY.line("UDYAM-WB-01-0012345", "tiny")).toBe(
      "Udyam Registration No. UDYAM-WB-01-0012345 (tiny)",
    );
    expect(UDYAM_COPY.line("UDYAM-WB-01-0012345", "toString")).toBe(
      "Udyam Registration No. UDYAM-WB-01-0012345 (toString)",
    );
  });
});

describe("the envelope [T10, L6]", () => {
  it("a tax invoice with a Udyam block stores, reads back and verifies; without one it is unchanged", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    expect(envelope.snapshot.header.issuer.company).not.toHaveProperty("udyam");
    const sealed = await withUdyam(envelope);
    const parsed = parseInvoiceEnvelope(serializeInvoiceEnvelope(sealed));
    expect(parsed?.snapshot.header.issuer.company.udyam).toEqual(UDYAM);
    expect(await verifyInvoiceEnvelope(parsed as InvoiceEnvelope)).toEqual({ ok: true });
    // the block is under the seal: another category without a reseal fails the snapshot hash
    const changed = clone(sealed);
    (changed.snapshot.header.issuer.company as Record<string, unknown>).udyam = {
      ...UDYAM,
      category: "small",
    };
    expect(await verifyInvoiceEnvelope(changed)).toEqual({ ok: false, code: "snapshot_hash" });
    // an envelope without the key is still an envelope and verifies (every earlier invoice)
    expect(
      await verifyInvoiceEnvelope(
        parseInvoiceEnvelope(serializeInvoiceEnvelope(envelope)) as InvoiceEnvelope,
      ),
    ).toEqual({
      ok: true,
    });
  });

  it("a block sealed under an older format or category list still parses, verifies, views and passes the gate (final re-check; OPEN 08-C RB-39)", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    // numbers and categories today's rule (`isUdyam`) refuses, as a later change of the format or the categories would leave an invoice sealed before it
    for (const [old, line] of [
      [
        { number: "UDYAM-WB-001-00123456", category: "micro" },
        "Udyam Registration No. UDYAM-WB-001-00123456 (Micro enterprise)",
      ],
      [
        { number: "UDYAM-WB-01-0012345", category: "tiny" },
        "Udyam Registration No. UDYAM-WB-01-0012345 (tiny)",
      ],
      [
        { number: "udyam-wb-01-001234", category: "Large" },
        "Udyam Registration No. udyam-wb-01-001234 (Large)",
      ],
      // a key that is not line 5's own words, even an inherited property's name, prints as stored
      [
        { number: "UDYAM-WB-01-0012345", category: "constructor" },
        "Udyam Registration No. UDYAM-WB-01-0012345 (constructor)",
      ],
    ] as const) {
      expect(isUdyam(old), JSON.stringify(old)).toBe(false);
      const sealed = await withUdyam(envelope, old);
      const parsed = parseInvoiceEnvelope(serializeInvoiceEnvelope(sealed));
      expect(parsed, JSON.stringify(old)).not.toBeNull();
      expect(parsed?.snapshot.header.issuer.company.udyam).toEqual(old);
      expect(await verifyInvoiceEnvelope(parsed as InvoiceEnvelope), JSON.stringify(old)).toEqual({
        ok: true,
      });
      const view = toInvoiceView(parsed as InvoiceEnvelope, DEFAULT_VIEW_CONFIG);
      expect(view.supplier.udyam).toBe(line);
      // the designed layout prints it as ONE text node, so the gate passes the page
      const html = renderDocumentHtml(view);
      expect(html.split(line), JSON.stringify(old)).toHaveLength(2);
      expect(missingStatutoryLine(parsed as InvoiceEnvelope, html), JSON.stringify(old)).toBeNull();
      // the seal still protects it: another value without a reseal fails the snapshot hash
      const changed = clone(parsed as InvoiceEnvelope);
      (changed.snapshot.header.issuer.company as Record<string, unknown>).udyam = {
        ...old,
        number: "UDYAM-WB-01-0099999",
      };
      expect(await verifyInvoiceEnvelope(changed)).toEqual({ ok: false, code: "snapshot_hash" });
    }
  });

  it("a block of the wrong shape is not an envelope (null): empty, blank or too long values, a value not a string, a missing or extra key, null, a string", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    for (const bad of [
      { number: "", category: "micro" },
      { number: "UDYAM-WB-01-0012345", category: "" },
      { number: "  ", category: "micro" },
      { number: "U".repeat(41), category: "micro" },
      { number: "UDYAM-WB-01-0012345", category: "m".repeat(41) },
      { number: 12345, category: "micro" },
      { number: "UDYAM-WB-01-0012345", category: 1 },
      { number: "UDYAM-WB-01-0012345", category: "micro", extra: 1 },
      { number: "UDYAM-WB-01-0012345" },
      {},
      null,
      "UDYAM-WB-01-0012345",
    ]) {
      const e = await withUdyam(envelope, bad);
      expect(parseInvoiceEnvelope(serializeInvoiceEnvelope(e)), JSON.stringify(bad)).toBeNull();
    }
    // the bound itself is accepted
    const atBound = await withUdyam(envelope, { number: "U".repeat(40), category: "m".repeat(40) });
    expect(parseInvoiceEnvelope(serializeInvoiceEnvelope(atBound))).not.toBeNull();
  });

  it("a block on an export invoice, a proforma or a note is a mismatch, even resealed", async () => {
    for (const name of ["export_lut", "proforma", "advance_export"] as const) {
      const { envelope } = await buildInvoiceFixture(name);
      expect(await verifyInvoiceEnvelope(await withUdyam(envelope)), name).toEqual({
        ok: false,
        code: "mismatch",
      });
    }
    for (const name of ["credit_lines", "debit"] as const) {
      const { envelope } = await buildNoteFixture(name);
      expect(await verifyInvoiceEnvelope(await withUdyam(envelope)), name).toEqual({
        ok: false,
        code: "mismatch",
      });
    }
    // the advance tax invoice is a tax invoice: it may carry one
    const { envelope } = await buildInvoiceFixture("advance");
    expect(await verifyInvoiceEnvelope(await withUdyam(envelope))).toEqual({ ok: true });
  });
});

describe("the view and the gate [T10]", () => {
  it("the view gives 07-ZC line 6 from the frozen block, and null without one", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    expect(toInvoiceView(envelope, DEFAULT_VIEW_CONFIG).supplier.udyam).toBeNull();
    const sealed = await withUdyam(envelope, { number: "UDYAM-WB-01-0012345", category: "small" });
    expect(toInvoiceView(sealed, DEFAULT_VIEW_CONFIG).supplier.udyam).toBe(
      "Udyam Registration No. UDYAM-WB-01-0012345 (Small enterprise)",
    );
  });

  it("a sealed number must be on the page as ONE text node; absent, split or reworded is refused as `udyam`; no key needs nothing", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    const sealed = await withUdyam(envelope);
    expect(missingStatutoryLine(sealed, page(`<p>${LINE}</p>`))).toBeNull();
    expect(missingStatutoryLine(sealed, page(`<p>\n  ${LINE}\n</p>`))).toBeNull();
    expect(missingStatutoryLine(sealed, page("<p>GSTIN 19ABCDE1234F1ZX</p>"))).toBe("udyam");
    expect(
      missingStatutoryLine(
        sealed,
        page("<p>Udyam Registration No. <b>UDYAM-WB-01-0012345</b> (Micro enterprise)</p>"),
      ),
    ).toBe("udyam");
    expect(
      missingStatutoryLine(
        sealed,
        page("<p>Udyam Registration No. UDYAM-WB-01-0012345 (Small enterprise)</p>"),
      ),
    ).toBe("udyam");
    expect(missingStatutoryLine(sealed, page(`<p>${LINE} and more</p>`))).toBe("udyam");
    // without the key nothing is asked of the page
    expect(missingStatutoryLine(envelope, page("<p>no line</p>"))).toBeNull();
  });

  it("the designed layout prints it once, as ONE text node, right under the GSTIN line, so the gate passes it [F1]", async () => {
    for (const name of ["intra", "advance"] as const) {
      const { envelope } = await buildInvoiceFixture(name);
      const sealed = await withUdyam(envelope);
      const view = toInvoiceView(sealed, DEFAULT_VIEW_CONFIG);
      const html = renderDocumentHtml(view);
      expect(html, name).toContain(`>${LINE}<`);
      expect(html.split(LINE), name).toHaveLength(2);
      expect(missingStatutoryLine(sealed, html), name).toBeNull();
      // in the supplier block ("From"), the paragraph after the registration line and before the email line
      const from = supplierBlock(html);
      const registration = view.supplier.lines[view.supplier.registrationAt] ?? "";
      expect(registration.startsWith("GSTIN "), name).toBe(true);
      const after = from.indexOf("GSTIN");
      expect(after, name).toBeGreaterThan(-1);
      expect(from.indexOf(LINE), name).toBeGreaterThan(after);
      expect(from.indexOf(LINE), name).toBeLessThan(from.indexOf("billing@example.test"));
      expect(from, name).toContain(`<p class="party__line inv-udyam" data-testid="udyam">${LINE}</p>`);
      // the line breaks only at its spaces, never after a hyphen of the number (the measured 12em), a rule of the tax invoice layout's own CSS (code review 6)
      expect(TAX_INVOICE_CSS).toContain(
        ".doc--tax-invoice .inv-udyam { max-width: 12em; overflow-wrap: normal; }",
      );
      expect(html, name).toContain(
        ".doc--tax-invoice .inv-udyam { max-width: 12em; overflow-wrap: normal; }",
      );
      expect(html, name).not.toContain(".doc--invoice .inv-udyam");
    }
  });

  it("registrationAt is the index the registration line was pushed at, not the first line with its words (second review 5c)", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    const sealed = await withUdyam(envelope);
    const plain = toInvoiceView(sealed, DEFAULT_VIEW_CONFIG).supplier;
    const registration = plain.lines[plain.registrationAt] ?? "";
    expect(registration.startsWith("GSTIN "), registration).toBe(true);
    // an earlier line (the address) with the very same words: the Udyam line still goes under the real registration line
    const twin = clone(sealed);
    (twin.snapshot.header.issuer.company as Record<string, unknown>).address = registration;
    const view = toInvoiceView(await reseal(twin), DEFAULT_VIEW_CONFIG);
    const s = view.supplier;
    const first = s.lines.indexOf(registration);
    expect(s.lines.lastIndexOf(registration)).toBeGreaterThan(first);
    expect(s.registrationAt).toBe(s.lines.lastIndexOf(registration));
    const out = supplierLinesHtml(view, (t) => `<p>${t}</p>`).split("</p>");
    expect(out[s.registrationAt]).toBe(`<p>${registration}`);
    expect(out[s.registrationAt + 1]).toContain(LINE);
    expect(out[first + 1]).not.toContain(LINE);
  });

  it("the skeleton (a type the designed layout does not know) prints it the same way [F1]", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    const sealed = await withUdyam(envelope);
    const view = toInvoiceView(sealed, DEFAULT_VIEW_CONFIG);
    const body = invoiceBody({ ...view, type: "receipt_voucher" });
    expect(body).not.toContain("doc--tax-invoice");
    expect(body).toContain(`>${LINE}<`);
    expect(body.split(LINE)).toHaveLength(2);
    expect(missingStatutoryLine(sealed, body)).toBeNull();
    expect(supplierBlock(body).indexOf(LINE)).toBeGreaterThan(supplierBlock(body).indexOf("GSTIN"));
  });

  it("without the key neither layout prints a Udyam line, and nothing is asked of the page", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    const view = toInvoiceView(envelope, DEFAULT_VIEW_CONFIG);
    const html = renderDocumentHtml(view);
    expect(html).not.toContain("Udyam");
    expect(html).not.toContain('data-testid="udyam"');
    expect(invoiceBody({ ...view, type: "receipt_voucher" })).not.toContain("Udyam");
    expect(missingStatutoryLine(envelope, html)).toBeNull();
  });

  it("a view without a registration line puts the Udyam line after the supplier's last line", () => {
    const html = supplierLinesHtml(
      {
        supplier: { name: "S", legalName: null, lines: ["A", "B"], registrationAt: -1, udyam: LINE },
      } as InvoiceView,
      (t) => `<p>${t}</p>`,
    );
    expect(html).toBe(`<p>A</p><p>B</p><p class="party__line inv-udyam" data-testid="udyam">${LINE}</p>`);
  });
});

describe("the signature an envelope must carry [T4, L4]", () => {
  it("notes and invoices for a payment received require it; a plain tax or export invoice and a proforma do not", async () => {
    for (const name of ["credit_lines", "debit", "credit_usd_lut", "debit_usd_lut"] as const) {
      const { envelope } = await buildNoteFixture(name);
      expect(requiresSignature(envelope), name).toBe(true);
      expect(signatureMissing(envelope), name).toBe(false);
    }
    for (const name of ["advance", "advance_export"] as const) {
      const { envelope } = await buildInvoiceFixture(name);
      expect(requiresSignature(envelope), name).toBe(true);
      expect(signatureMissing(envelope), name).toBe(false);
    }
    for (const name of ["intra", "export_lut", "proforma"] as const) {
      const { envelope } = await buildInvoiceFixture(name);
      expect(requiresSignature(envelope), name).toBe(false);
      const off = clone(envelope);
      off.snapshot.header.issuer.signature = null;
      off.snapshot.header.issuer.signatory = false;
      expect(signatureMissing(off), name).toBe(false);
    }
  });

  it("no reference, or the switch-off marker, on an envelope that must be signed is missing", async () => {
    const cases = [
      (await buildNoteFixture("credit_lines")).envelope,
      (await buildNoteFixture("debit")).envelope,
      (await buildInvoiceFixture("advance")).envelope,
      (await buildInvoiceFixture("advance_export")).envelope,
    ];
    for (const e of cases) {
      const none = clone(e);
      none.snapshot.header.issuer.signature = null;
      expect(signatureMissing(none), e.type).toBe(true);
      const off = clone(e);
      off.snapshot.header.issuer.signatory = false;
      expect(signatureMissing(off), e.type).toBe(true);
    }
  });
});
