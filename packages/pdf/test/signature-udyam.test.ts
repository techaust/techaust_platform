// T4 and T10 (rt2; ADM-INV-01, ADM-INV-06): the envelope, view and integrity logic of the signature rule and the Udyam line. A present Udyam block has the canonical
// shape and is only on a tax invoice (else the envelope is refused); the view gives the layout 07-ZC line 6; the gate refuses a page that does not print it as ONE text
// node; a credit or debit note and an invoice for a payment received need a frozen signature (`signatureMissing`, the jobs refusal). The layout itself is the designer's:
// the cases that need the real layout to print the line are in the designer's tests.
import { invoiceSnapshotSha256 } from "@techaust/core/invoices";
import { describe, expect, it } from "vitest";
import {
  invoiceSnapshotInputOf,
  parseInvoiceEnvelope,
  serializeInvoiceEnvelope,
  verifyInvoiceEnvelope,
} from "../src/invoice-envelope.ts";
import { missingStatutoryLine, requiresSignature, signatureMissing } from "../src/invoice-integrity.ts";
import type { InvoiceEnvelope } from "../src/invoice-types.ts";
import { toInvoiceView } from "../src/invoice-view.ts";
import { UDYAM_COPY } from "../src/layout/copy.ts";
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

  it("a malformed block is not an envelope (null): lower case, a short number, an unknown category, an extra key, null, a string", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    for (const bad of [
      { number: "udyam-wb-01-0012345", category: "micro" },
      { number: "UDYAM-WB-01-001234", category: "micro" },
      { number: "UDYAM-WB-01-0012345", category: "large" },
      { number: "UDYAM-WB-01-0012345", category: "micro", extra: 1 },
      { number: "UDYAM-WB-01-0012345" },
      null,
      "UDYAM-WB-01-0012345",
    ]) {
      const e = await withUdyam(envelope, bad);
      expect(parseInvoiceEnvelope(serializeInvoiceEnvelope(e)), JSON.stringify(bad)).toBeNull();
    }
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

  it("the real layout of today does not print it yet, so the gate refuses a sealed invoice (the designer's layout must print it)", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    const sealed = await withUdyam(envelope);
    const html = renderDocumentHtml(toInvoiceView(sealed, DEFAULT_VIEW_CONFIG));
    const printed = html.includes(`>${LINE}<`);
    expect(missingStatutoryLine(sealed, html)).toBe(printed ? null : "udyam");
    // and an invoice without the key is not affected by the new check
    expect(
      missingStatutoryLine(envelope, renderDocumentHtml(toInvoiceView(envelope, DEFAULT_VIEW_CONFIG))),
    ).toBeNull();
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
