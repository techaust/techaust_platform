// The M5.3 credit and debit notes in the designed layout (layout/invoice.ts; docs/06 §7.3; words 07-T §1 and §8): the title and copy mark, the reason
// in the band, the invoice the note corrects (its number as ONE text node: LD54, the jobs Worker's own check `missingStatutoryLine` passes on every
// fixture), each line's "Against line {n}", the total's label and the effect line; a credit note prints no due date, no balance and no bank block, a
// debit note is paid like an invoice; a USD note prints the rate of its invoice. Sample data only (fixtures/notes.ts). Researched 2026-10-28, s.34(3) CGST Act, Rule 53 (08-C RA-22).
import { describe, expect, it } from "vitest";
import {
  parseInvoiceEnvelope,
  serializeInvoiceEnvelope,
  verifyInvoiceEnvelope,
} from "../src/invoice-envelope.ts";
import { missingStatutoryLine } from "../src/invoice-integrity.ts";
import type { InvoiceEnvelope } from "../src/invoice-types.ts";
import { toInvoiceView } from "../src/invoice-view.ts";
import { NOTE_PDF_COPY } from "../src/layout/copy.ts";
import { titleOf } from "../src/layout/invoice.ts";
import { renderDocumentHtml } from "../src/render.ts";
import { DEFAULT_VIEW_CONFIG } from "../src/view.ts";
import { SAMPLE_ARN } from "./fixtures/invoice.ts";
import {
  buildNoteFixture,
  NOTE_FIXTURE_NAMES,
  type NoteFixtureName,
  PARENT_NUMBER,
} from "./fixtures/notes.ts";

const body = (h: string) => h.slice(h.indexOf("<body>"));
const clone = (e: InvoiceEnvelope): InvoiceEnvelope => JSON.parse(JSON.stringify(e)) as InvoiceEnvelope;

async function built(name: NoteFixtureName, opts: Parameters<typeof buildNoteFixture>[1] = {}) {
  const { envelope, noteOf } = await buildNoteFixture(name, opts);
  const view = toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, { portalLink: "portal.example.test" });
  return { envelope, noteOf, view, html: renderDocumentHtml(view) };
}

describe("LD54: the invoice a note corrects, as one text node", () => {
  it.each(NOTE_FIXTURE_NAMES)("%s: the jobs Worker's gate passes on the real layout", async (name) => {
    const { envelope, html } = await built(name);
    expect(missingStatutoryLine(envelope, html)).toBeNull();
    expect(body(html)).toContain(`<dd data-testid="parent-number">${PARENT_NUMBER}</dd>`);
  });

  it("a page that lost the number, or split it, is still refused", async () => {
    const { envelope, html } = await built("credit_lines");
    const without = html.replace(`<dd data-testid="parent-number">${PARENT_NUMBER}</dd>`, "<dd></dd>");
    // the number is also in the effect line, inside a sentence: that is not a node of its own
    expect(without).toContain(PARENT_NUMBER);
    expect(missingStatutoryLine(envelope, without)).toBe("parent_number");
    const split = html.replace(
      `<dd data-testid="parent-number">${PARENT_NUMBER}</dd>`,
      `<dd data-testid="parent-number">TH/INV/<span>2627/0007</span></dd>`,
    );
    expect(missingStatutoryLine(envelope, split)).toBe("parent_number");
  });

  it("a note whose header has no `noteOf` is refused by its type (the number is not looked for only when the header has one)", async () => {
    const { envelope, html } = await built("credit_lines");
    const bare = clone(envelope);
    delete (bare.snapshot.header as { noteOf?: unknown }).noteOf;
    expect(missingStatutoryLine(bare, html)).toBe("parent_number");
    // a tax invoice is not asked for one
    const plain = clone(envelope);
    (plain as { type: string }).type = "tax_invoice";
    expect(missingStatutoryLine(plain, html)).toBeNull();
  });

  it("another invoice's number in the page is refused (the sealed number is what is checked)", async () => {
    const { envelope, html } = await built("debit");
    const other = clone(envelope);
    (other.snapshot.header.noteOf as { parent: { number: string } }).parent.number = "TH/INV/2627/0099";
    expect(missingStatutoryLine(other, html)).toBe("parent_number");
  });
});

describe("a credit note (07-T §1)", () => {
  it("by lines: title, copy mark, the identity block, the reason, Against line {n}, Total credited and the effect line", async () => {
    const { html, view } = await built("credit_lines");
    const h = body(html);
    expect(titleOf(view)).toBe("Credit Note");
    expect(h).toContain('<h1 class="masthead__title">Credit Note</h1>');
    expect(h).toContain('data-testid="copy-label">ORIGINAL FOR RECIPIENT<');
    expect(h).toContain('<div class="doc doc--invoice doc--tax-invoice doc--note doc--credit-note">');
    expect(h).toContain('<p class="label">Credit note number</p>');
    expect(h).toContain("<dt>Date</dt>");
    expect(h).toContain("<dt>Against invoice</dt>");
    expect(h).toContain("<dt>Invoice date</dt><dd>20 Oct 26</dd>");
    expect(h).toContain('data-testid="reason">Reason: Price correction<');
    expect(h).toContain(">Against line 1<");
    expect(h).toContain(">Against line 2<");
    expect(h).toContain('<th scope="row">Total credited</th>');
    expect(h).toContain(
      `data-testid="effect">${NOTE_PDF_COPY.credit.effect(PARENT_NUMBER, view.note?.effect.total ?? "")}<`,
    );
    expect(h).toContain("This credit note reduces the amount due on invoice TH/INV/2627/0007 by ₹");
  });

  it("owes nothing: no due date, no balance due, no How to pay and no bank block", async () => {
    for (const name of [
      "credit_lines",
      "credit_amount",
      "credit_full",
      "credit_usd_lut",
      "credit_other",
    ] as const) {
      const h = body((await built(name)).html);
      expect(h).not.toContain("Due date");
      expect(h).not.toContain('data-testid="balance-due"');
      expect(h).not.toContain("How to pay");
      expect(h).not.toContain("Account number");
      expect(h).not.toContain("SWIFT");
      // the signatory is printed as on the invoice
      expect(h).toContain('data-testid="signatory">Authorised signatory<');
    }
  });

  it("the reason: a code's label, the words typed with it on a line of their own; 'Other' is the words typed", async () => {
    const amount = body((await built("credit_amount")).html);
    expect(amount).toContain('data-testid="reason">Reason: Service deficient<');
    expect(amount).toContain(">Two of the five screens were not delivered.<");
    const other = body((await built("credit_other")).html);
    expect(other).toContain(
      'data-testid="reason">Reason: Duplicate charge for the hosting month of October.<',
    );
    expect(other).not.toContain("Reason: Other");
  });

  it("the reason as typed is escaped", async () => {
    const { envelope } = await buildNoteFixture("credit_other");
    const e = clone(envelope);
    (e.snapshot.header.noteOf as { reason: { text: string } }).reason.text =
      '<script>alert(1)</script> & "x"';
    const h = body(renderDocumentHtml(toInvoiceView(e, DEFAULT_VIEW_CONFIG)));
    expect(h).not.toContain("<script>alert");
    expect(h).toContain("Reason: &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;");
  });

  it("in USD under LUT: the invoice's LUT line in the band, and the rate of the invoice (07-T §1)", async () => {
    const { html, view } = await built("credit_usd_lut");
    const h = body(html);
    expect(h).toContain(`data-testid="lut">LUT ARN: ${SAMPLE_ARN} (FY 2026-27)<`);
    expect(h).toContain(
      `Exchange rate: 1 USD = <span data-testid="rupee">₹</span>${view.note?.fx?.rate} (the rate of invoice ${PARENT_NUMBER})`,
    );
    expect(h).toContain('data-testid="inr"');
    expect(h).not.toContain("FBIL");
    // the place of supply as the export invoice prints it (07-S §1), whole
    expect(h).toContain('<div class="wrap"><dt>Place of supply</dt><dd>Outside India (96)</dd></div>');
  });

  it("rt1 T2 [RA-19 Q39]: a debit note prints its own sealed LUT (its issue day's FY); an older envelope without one prints the invoice's", async () => {
    const { envelope, html } = await built("debit_usd_lut");
    // an envelope sealed before rt1: the invoice's LUT, as it was issued
    expect(body(html)).toContain(`data-testid="lut">LUT ARN: ${SAMPLE_ARN} (FY 2026-27)<`);
    const own = clone(envelope);
    const noteOf = own.snapshot.header.noteOf as { lut?: { fy: string; arn: string } };
    noteOf.lut = { fy: "2728", arn: "AD1903270000002" };
    const view = toInvoiceView(own, DEFAULT_VIEW_CONFIG);
    expect(view.note?.route?.lut).toEqual({ fy: "2728", fyLabel: "2027-28", arn: "AD1903270000002" });
    const h = body(renderDocumentHtml(view));
    expect(h).toContain('data-testid="lut">LUT ARN: AD1903270000002 (FY 2027-28)<');
    expect(h).not.toContain(SAMPLE_ARN);
  });

  it("in USD with IGST paid: no LUT line, the IGST in INR", async () => {
    const h = body((await built("credit_usd_igst")).html);
    expect(h).not.toContain('data-testid="lut"');
    expect(h).toContain("IGST in INR");
    expect(h).toContain('data-testid="reason">Reason: Discount after sale<');
  });
});

describe("a debit note (07-T §1, §8)", () => {
  it("its own title and number label, Total added, the effect line; paid like an invoice", async () => {
    const { html, view } = await built("debit");
    const h = body(html);
    expect(titleOf(view)).toBe("Debit Note");
    expect(h).toContain('<h1 class="masthead__title">Debit Note</h1>');
    expect(h).toContain('<div class="doc doc--invoice doc--tax-invoice doc--note doc--debit-note">');
    expect(h).toContain('<p class="label">Debit note number</p>');
    expect(h).toContain("<dt>Due date</dt><dd>04 Nov 26</dd>");
    expect(h).toContain('<th scope="row">Total added</th>');
    expect(h).toContain('data-testid="balance-due"');
    expect(h).toContain("How to pay");
    expect(h).toContain("Account number");
    expect(h).toContain(">Against line 2<");
    expect(h).toContain("This debit note increases the amount due on invoice TH/INV/2627/0007 by ₹");
  });

  it("in USD: the SWIFT details, the rate of the invoice, the LUT line", async () => {
    const h = body((await built("debit_usd_lut")).html);
    expect(h).toContain("International wire (SWIFT) to:");
    expect(h).toContain(`(the rate of invoice ${PARENT_NUMBER})`);
    expect(h).toContain('data-testid="lut"');
    expect(h).toContain('data-testid="reason">Reason: Extra revision round agreed by email.<');
  });
});

// rt1 F1: an export issued on the settings' route freezes no typed route (`exportMode` null) and its note copies that; the frozen supply type says the route.
describe("rt1 F1 [RA-19, RA-03]: a note on an export issued on the settings' route (no typed route)", () => {
  const PLACE = '<div class="wrap"><dt>Place of supply</dt><dd>Outside India (96)</dd></div>';
  const OWN = { fy: "2728", arn: "AD1903270000002" } as const;

  it("a debit note under LUT prints its own sealed LUT and the export place", async () => {
    const { envelope, view, html } = await built("debit_usd_lut", { route: "settings", noteLut: OWN });
    expect(envelope.snapshot.header.document.exportMode).toBeNull();
    expect(view.note?.route).toEqual({
      mode: "lut",
      lut: { fy: "2728", fyLabel: "2027-28", arn: OWN.arn },
    });
    const h = body(html);
    expect(h).toContain(`data-testid="lut">LUT ARN: ${OWN.arn} (FY 2027-28)<`);
    expect(h).not.toContain(SAMPLE_ARN);
    expect(h).toContain(PLACE);
  });

  it("a credit note under LUT prints its invoice's LUT and the export place", async () => {
    const { envelope, view, html } = await built("credit_usd_lut", { route: "settings" });
    expect(envelope.snapshot.header.document.exportMode).toBeNull();
    expect(view.note?.route?.mode).toBe("lut");
    const h = body(html);
    expect(h).toContain(`data-testid="lut">LUT ARN: ${SAMPLE_ARN} (FY 2026-27)<`);
    expect(h).toContain(PLACE);
  });

  it("a note under IGST paid prints no LUT line and the export place", async () => {
    const { envelope, view, html } = await built("credit_usd_igst", { route: "settings" });
    expect(envelope.snapshot.header.document.exportMode).toBeNull();
    expect(view.note?.route?.mode).toBe("igst_paid");
    const h = body(html);
    expect(h).not.toContain('data-testid="lut"');
    expect(h).toContain(PLACE);
  });

  it("a domestic note still has no route, no LUT line and its state as the place of supply", async () => {
    const { view, html } = await built("debit", { route: "settings" });
    expect(view.note?.route).toBeNull();
    const h = body(html);
    expect(h).not.toContain('data-testid="lut"');
    expect(h).not.toContain("Outside India (96)");
  });
});

// rt1 F4: `noteOf.lut` sealed through the issue route's own seal (`invoiceSealOf`, in the fixture), not patched into a built envelope.
describe("rt1 F4 [RA-19 Q39]: a debit note's own LUT through the real seal", () => {
  it.each(["typed", "settings"] as const)(
    "%s route: the seal verifies, survives a store and read back, and the page prints the sealed LUT",
    async (route) => {
      const own = { fy: "2728", arn: "AD1903270000002" };
      const { envelope, view, html } = await built("debit_usd_lut", { route, noteLut: own });
      expect(envelope.snapshot.header.noteOf?.lut).toEqual(own);
      expect(await verifyInvoiceEnvelope(envelope)).toEqual({ ok: true });
      const back = parseInvoiceEnvelope(serializeInvoiceEnvelope(envelope));
      expect(back?.snapshot.header.noteOf?.lut).toEqual(own);
      expect(await verifyInvoiceEnvelope(back as InvoiceEnvelope)).toEqual({ ok: true });
      expect(view.note?.route?.lut?.arn).toBe(own.arn);
      expect(body(html)).toContain(`data-testid="lut">LUT ARN: ${own.arn} (FY 2027-28)<`);
      expect(missingStatutoryLine(envelope, html)).toBeNull();
    },
  );

  it("a sealed LUT changed after the seal no longer verifies", async () => {
    const { envelope } = await built("debit_usd_lut", {
      noteLut: { fy: "2728", arn: "AD1903270000002" },
    });
    const forged = clone(envelope);
    (forged.snapshot.header.noteOf as { lut: { arn: string } }).lut.arn = "AD1903270000099";
    expect(await verifyInvoiceEnvelope(forged)).toEqual({ ok: false, code: "snapshot_hash" });
  });
});
