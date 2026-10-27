// M5.3 stage B1 (ADM-INV-11, ADM-INV-01 "Debit Note", LD39, LD52, LD54; VERIFY WITH CA/LEGAL): the envelope and the view of a credit and a debit note. A note carries
// `header.noteOf` (and no other type does); a credit note has no due date and no bank block; the view gives the layout the note's facts (the invoice's number and date, the
// reason, "Against line {n}", the effect line's data, the rate and the LUT of an export note); an M5.1 or M5.2 envelope still parses and verifies; and the page must carry
// the frozen number of the invoice as ONE text node (the gate the jobs Worker calls).
import { invoiceSnapshotSha256 } from "@techaust/core/invoices";
import { describe, expect, it } from "vitest";
import { invoiceEnvelopeOfBundle } from "../src/invoice-bundle.ts";
import {
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
  INVOICE_FIXTURE_NAMES,
  invoiceBundleOf,
  TYPED_FIXTURE_NAMES,
} from "./fixtures/invoice.ts";
import { buildNoteFixture, NOTE_FIXTURE_NAMES, PARENT_DATE, PARENT_NUMBER } from "./fixtures/notes.ts";

const clone = (e: InvoiceEnvelope): InvoiceEnvelope => JSON.parse(JSON.stringify(e)) as InvoiceEnvelope;
const view = (e: InvoiceEnvelope) => toInvoiceView(e, DEFAULT_VIEW_CONFIG);
const reseal = async (e: InvoiceEnvelope): Promise<InvoiceEnvelope> => {
  const r = clone(e);
  r.snapshotSha256 = await invoiceSnapshotSha256(invoiceSnapshotInputOf(r));
  return r;
};

describe("the envelope of a note [LD39]", () => {
  it.each(NOTE_FIXTURE_NAMES)(
    "%s: stores, reads back and verifies; the rows' frozen header_extras give the very same envelope",
    async (name) => {
      const { envelope } = await buildNoteFixture(name);
      const text = serializeInvoiceEnvelope(envelope);
      const back = parseInvoiceEnvelope(text);
      expect(back).not.toBeNull();
      expect(await verifyInvoiceEnvelope(back as InvoiceEnvelope)).toEqual({ ok: true });
      // the snapshot step: rows (header_extras with noteOf, a null due date on a credit note, the rate columns) -> the same envelope, byte for byte
      const made = await invoiceEnvelopeOfBundle(invoiceBundleOf(envelope));
      expect(made.ok, JSON.stringify(made)).toBe(true);
      expect(made.ok && serializeInvoiceEnvelope(made.envelope)).toBe(text);
    },
  );

  it("a note carries noteOf, a credit note has no due date, a debit note has one; the credit note's bank is frozen as none", async () => {
    const cn = (await buildNoteFixture("credit_lines")).envelope.snapshot.header;
    expect(cn.noteOf?.kind).toBe("credit");
    expect(cn.document.dueDate).toBeNull();
    expect(cn.issuer.bank).toEqual({ inr: null });
    const dn = (await buildNoteFixture("debit")).envelope.snapshot.header;
    expect(dn.noteOf?.kind).toBe("debit");
    expect(dn.document.dueDate).toBe("2026-11-04");
    expect(dn.issuer.bank.inr).not.toBeNull();
  });

  it("every M5.1 and M5.2 envelope has no noteOf, still parses and still verifies", async () => {
    for (const name of [...INVOICE_FIXTURE_NAMES, ...TYPED_FIXTURE_NAMES]) {
      const { envelope } = await buildInvoiceFixture(name);
      expect(envelope.snapshot.header).not.toHaveProperty("noteOf");
      const back = parseInvoiceEnvelope(serializeInvoiceEnvelope(envelope));
      expect(back, name).not.toBeNull();
      expect(await verifyInvoiceEnvelope(back as InvoiceEnvelope), name).toEqual({ ok: true });
      expect(invoiceDraftOf(back as InvoiceEnvelope)).not.toHaveProperty("note");
    }
  });

  it("noteOf on any other type, or no noteOf on a note, is refused; so is a kind that is not the type's, a due date on a credit note or none on a debit note", async () => {
    // noteOf on a tax invoice (the seal is rebuilt around it: the shape check refuses first)
    const inv = clone((await buildInvoiceFixture("intra")).envelope);
    inv.snapshot.header.noteOf = (await buildNoteFixture("credit_lines")).noteOf;
    expect(await verifyInvoiceEnvelope(await reseal(inv))).toEqual({ ok: false, code: "mismatch" });
    // a note without its request
    const noNote = clone((await buildNoteFixture("credit_lines")).envelope);
    delete noNote.snapshot.header.noteOf;
    expect(await verifyInvoiceEnvelope(await reseal(noNote))).toEqual({ ok: false, code: "mismatch" });
    // a debit note's request in a credit note's envelope
    const wrongKind = clone((await buildNoteFixture("credit_lines")).envelope);
    (wrongKind.snapshot.header.noteOf as { kind: string }).kind = "debit";
    expect(await verifyInvoiceEnvelope(await reseal(wrongKind))).toEqual({ ok: false, code: "mismatch" });
    // a due date on a credit note, none on a debit note
    const dueOnCredit = clone((await buildNoteFixture("credit_lines")).envelope);
    dueOnCredit.snapshot.header.document.dueDate = "2026-11-04";
    expect(await verifyInvoiceEnvelope(await reseal(dueOnCredit))).toEqual({ ok: false, code: "mismatch" });
    const noDueOnDebit = clone((await buildNoteFixture("debit")).envelope);
    noDueOnDebit.snapshot.header.document.dueDate = null;
    expect(await verifyInvoiceEnvelope(await reseal(noDueOnDebit))).toEqual({ ok: false, code: "mismatch" });
    // a take for every line, no more and no fewer
    const fewer = clone((await buildNoteFixture("credit_lines")).envelope);
    fewer.snapshot.header.noteOf?.request.takes.pop();
    expect(await verifyInvoiceEnvelope(await reseal(fewer))).toEqual({ ok: false, code: "mismatch" });
  });

  it("anything changed in the request after the seal fails the seal: the reason, a take, the invoice's number", async () => {
    const { envelope } = await buildNoteFixture("credit_lines");
    const edits: ((h: InvoiceEnvelope["snapshot"]["header"]) => void)[] = [
      (h) => {
        (h.noteOf as { reason: { text: string } }).reason.text = "something else";
      },
      (h) => {
        (h.noteOf?.request.takes[0] as { taxableMinor: number }).taxableMinor += 1;
      },
      (h) => {
        (h.noteOf?.parent as { number: string }).number = "TH/INV/2627/0099";
      },
    ];
    for (const edit of edits) {
      const forged = clone(envelope);
      edit(forged.snapshot.header);
      expect(await verifyInvoiceEnvelope(forged)).toEqual({ ok: false, code: "snapshot_hash" });
    }
  });

  it("the amount typed is part of the content hash: a resealed envelope with another amount fails the content check", async () => {
    const { envelope } = await buildNoteFixture("credit_amount");
    expect(envelope.snapshot.header.noteOf?.request.grossMinor).toBe(590_000);
    expect(invoiceDraftOf(envelope).note?.grossMinor).toBe(590_000);
    const forged = clone(envelope);
    (forged.snapshot.header.noteOf?.request as { grossMinor: number }).grossMinor = 590_001;
    expect(await verifyInvoiceEnvelope(await reseal(forged))).toEqual({ ok: false, code: "content_hash" });
  });

  it("a malformed noteOf is not an envelope", async () => {
    const e = JSON.parse(serializeInvoiceEnvelope((await buildNoteFixture("credit_lines")).envelope)) as {
      snapshot: { header: { noteOf: Record<string, unknown> } };
    };
    for (const bad of [
      { ...e.snapshot.header.noteOf, kind: "other" },
      { ...e.snapshot.header.noteOf, request: { mode: "lines", takes: "x" } },
      { ...e.snapshot.header.noteOf, parent: null },
      { ...e.snapshot.header.noteOf, reason: { code: 1, text: "" } },
    ]) {
      const copy = structuredClone(e);
      copy.snapshot.header.noteOf = bad;
      expect(parseInvoiceEnvelope(JSON.stringify(copy))).toBeNull();
    }
  });
});

describe("the view of a note [07-T §1, §8; LD52]", () => {
  it("a credit note by lines: the title, the invoice's number and date, the reason, 'Against line {n}', the effect line and the total's label; no due date, no bank", async () => {
    const { envelope, computed } = await buildNoteFixture("credit_lines");
    const v = view(envelope);
    expect(v.docLabel).toBe("Credit Note");
    expect(v.title).toContain("Credit Note TH/CN/2627/0001");
    expect(v.copyLabel).toBe("ORIGINAL FOR RECIPIENT");
    expect(v.dueDate).toBe("");
    expect(v.bank).toBeNull();
    expect(v.notes).toBeNull();
    expect(v.lines.map((l) => l.againstLine)).toEqual([1, 2]);
    expect(v.balanceDue).toBe("₹0.00");
    expect(v.note).toEqual({
      kind: "credit",
      title: "Credit Note",
      parent: { number: PARENT_NUMBER, date: "20 Oct 26", type: "tax_invoice" },
      reason: { code: "price_correction", label: "Price correction", text: "" },
      totalLabel: "credited",
      effect: { direction: "reduces", parentNumber: PARENT_NUMBER, total: v.totals.at(-1)?.value },
      fx: null,
      route: null,
    });
    expect(v.totals.at(-1)).toMatchObject({ key: "total", label: "Total credited", strong: true });
    expect(computed.totalMinor).toBeGreaterThan(0);
    expect(PARENT_DATE).toBe("2026-10-20");
  });

  it("a note taken from one line of a longer invoice names that line, as the invoice numbers it", async () => {
    const v = view((await buildNoteFixture("credit_usd_lut")).envelope);
    expect(v.lines).toHaveLength(1);
    expect(v.lines[0]?.againstLine).toBe(2);
  });

  it("amount mode and full mode: the same view parts (the reason's words and the request's mode are the note's own)", async () => {
    const amount = view((await buildNoteFixture("credit_amount")).envelope);
    expect(amount.note?.reason).toEqual({
      code: "service_deficient",
      label: "Service deficient",
      text: "Two of the five screens were not delivered.",
    });
    const full = view((await buildNoteFixture("credit_full")).envelope);
    expect(full.lines.map((l) => l.againstLine)).toEqual([1, 2]);
    expect(full.note?.reason.label).toBe("Service not delivered");
    const other = view((await buildNoteFixture("credit_other")).envelope);
    expect(other.note?.reason).toEqual({
      code: "other",
      label: "Other",
      text: "Duplicate charge for the hosting month of October.",
    });
  });

  it("a debit note: its own title, label and effect; it keeps its due date and its bank and owes its total", async () => {
    const v = view((await buildNoteFixture("debit")).envelope);
    expect(v.docLabel).toBe("Debit Note");
    expect(v.dueDate).toBe("04 Nov 26");
    expect(v.bank).not.toBeNull();
    expect(v.note).toMatchObject({
      kind: "debit",
      totalLabel: "added",
      effect: { direction: "increases", parentNumber: PARENT_NUMBER },
    });
    expect(v.totals.at(-1)).toMatchObject({ key: "total", label: "Total added" });
    expect(v.balanceDue).toBe(v.totals.at(-1)?.value);
  });

  it("an export credit note: the invoice's rate and number, its route and (on the LUT route) the LUT letter; the IGST route has none", async () => {
    const lut = view((await buildNoteFixture("credit_usd_lut")).envelope);
    expect(lut.currency).toBe("USD");
    expect(lut.note?.fx).toEqual({ rate: "83.1234", parentNumber: PARENT_NUMBER });
    expect(lut.note?.route).toEqual({
      mode: "lut",
      lut: { fy: "2627", fyLabel: "2026-27", arn: "AD0000000000001" },
    });
    expect(lut.note?.parent.type).toBe("export_invoice");
    expect(lut.inr?.rate).toBe("83.1234");
    const igst = view((await buildNoteFixture("credit_usd_igst")).envelope);
    expect(igst.note?.route).toEqual({ mode: "igst_paid", lut: null });
    expect(igst.inr?.igst).not.toBeNull();
    // a debit note on an export invoice uses the invoice's route and rate too
    const dn = view((await buildNoteFixture("debit_usd_lut")).envelope);
    expect(dn.note?.fx).toEqual({ rate: "83.1234", parentNumber: PARENT_NUMBER });
    expect(dn.note?.route?.mode).toBe("lut");
    expect(dn.swift).not.toBeNull();
  });

  it("every other type's view has no note and is unchanged in the new fields", async () => {
    for (const name of [...INVOICE_FIXTURE_NAMES, ...TYPED_FIXTURE_NAMES]) {
      const v = view((await buildInvoiceFixture(name)).envelope);
      expect(v.note, name).toBeNull();
      for (const l of v.lines) expect(l, name).not.toHaveProperty("againstLine");
    }
  });
});

describe("the page names the invoice a note is against, as one text node [LD54]", () => {
  it("a page with the frozen number as the whole content of a node passes; one without it, or with it split, does not", async () => {
    for (const name of NOTE_FIXTURE_NAMES) {
      const { envelope } = await buildNoteFixture(name);
      expect(missingStatutoryLine(envelope, "<p>nothing</p>"), name).toBe("parent_number");
      expect(missingStatutoryLine(envelope, `<dd>${PARENT_NUMBER}</dd>`), name).toBeNull();
      expect(
        missingStatutoryLine(envelope, `<p>${PARENT_NUMBER.slice(0, 8)}<b>${PARENT_NUMBER.slice(8)}</b></p>`),
        name,
      ).toBe("parent_number");
      // mentioned inside a sentence is not the number as a node of its own
      expect(
        missingStatutoryLine(envelope, `<p>Against invoice ${PARENT_NUMBER} dated 20 Oct</p>`),
        name,
      ).toBe("parent_number");
    }
    expect(hasTextNode(`<dd> ${PARENT_NUMBER} </dd>`, PARENT_NUMBER)).toBe(true);
  });

  it("the number checked is the SEALED one (not the view's and not a live setting)", async () => {
    const { envelope } = await buildNoteFixture("credit_lines");
    expect(missingStatutoryLine(envelope, "<dd>TH/INV/2627/0099</dd>")).toBe("parent_number");
  });

  it("an invoice that is not a note needs nothing new", async () => {
    const { envelope } = await buildInvoiceFixture("intra");
    expect(missingStatutoryLine(envelope, "<p>nothing</p>")).toBeNull();
  });
});
