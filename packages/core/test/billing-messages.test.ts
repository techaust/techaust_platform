// The M5.4 queue messages [JOB-Q-01, LD56, LD57]: ids and cursors only, a body of the family is never taken for a lead or an ordinary email.
import { describe, expect, it } from "vitest";
import { INVOICE_EMAIL_DATA, isInvoiceEmailTemplate } from "../src/invoice-email.ts";
import {
  alertsDailyMessage,
  BILLING_KINDS,
  careBillMessage,
  careIssueMessage,
  careScanMessage,
  EMAIL_TEMPLATES,
  emailMessage,
  INVOICE_EXPANSION_KINDS,
  invoiceSendMessage,
  isBillingKind,
  isInvoiceExpansionKind,
  isOfferExpansionKind,
  leadMessage,
  reminderScanMessage,
  reminderSendMessage,
} from "../src/schemas/messages.ts";

const id = "01890000-0000-7000-8000-000000000001";

describe("invoice expansion messages (email queue)", () => {
  it("invoice.send and reminder.send carry one id and nothing else is kept", () => {
    expect(invoiceSendMessage.parse({ kind: "invoice.send", sendId: id, to: "x@example.com" })).toEqual({
      kind: "invoice.send",
      sendId: id,
    });
    expect(reminderSendMessage.parse({ kind: "reminder.send", reminderId: id, extra: 1 })).toEqual({
      kind: "reminder.send",
      reminderId: id,
    });
    for (const bad of [
      {},
      { kind: "invoice.send" },
      { kind: "invoice.send", sendId: "nope" },
      { kind: "invoice.send", sendId: 5 },
    ])
      expect(invoiceSendMessage.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(reminderSendMessage.safeParse({ kind: "reminder.send", reminderId: "" }).success).toBe(false);
  });
  it("the family guard says yes to the two kinds, valid or not, and no to everything else (an ordinary email, an offer, junk)", () => {
    expect(INVOICE_EXPANSION_KINDS).toEqual(["invoice.send", "reminder.send"]);
    expect(isInvoiceExpansionKind({ kind: "invoice.send" })).toBe(true);
    expect(isInvoiceExpansionKind({ kind: "reminder.send", reminderId: "junk" })).toBe(true);
    for (const other of [
      null,
      undefined,
      "invoice.send",
      7,
      [],
      {},
      { kind: "offer.send" },
      { template: "invoice.sent", to: "a@example.com", data: {}, entity: { type: "t", id: "1" } },
    ])
      expect(isInvoiceExpansionKind(other)).toBe(false);
    // and the offer guard does not claim them (the M4.5 consumer would cancel an invoice send)
    expect(isOfferExpansionKind({ kind: "invoice.send" })).toBe(false);
    expect(isOfferExpansionKind({ kind: "reminder.send" })).toBe(false);
  });
});

describe("billing messages (leads queue)", () => {
  it("care.scan, care.bill, care.issue, alerts.daily and reminder.scan parse; they carry no clock and no amount", () => {
    expect(careScanMessage.parse({ kind: "care.scan", after: null })).toEqual({
      kind: "care.scan",
      after: null,
    });
    expect(
      careScanMessage.parse({ kind: "care.scan", after: { at: 7, id: "plan-1" }, today: "2026-11-05" }),
    ).toEqual({
      kind: "care.scan",
      after: { at: 7, id: "plan-1" },
    });
    expect(careBillMessage.parse({ kind: "care.bill", planId: id, amount: 5 })).toEqual({
      kind: "care.bill",
      planId: id,
    });
    expect(careIssueMessage.parse({ kind: "care.issue", documentId: id })).toEqual({
      kind: "care.issue",
      documentId: id,
    });
    expect(
      alertsDailyMessage.parse({
        kind: "alerts.daily",
        first: false,
        unbilledAfter: { at: 5, id },
        proformaAfter: null,
      }),
    ).toEqual({ kind: "alerts.daily", first: false, unbilledAfter: { at: 5, id }, proformaAfter: null });
    expect(reminderScanMessage.parse({ kind: "reminder.scan", after: { at: 9, id } })).toEqual({
      kind: "reminder.scan",
      after: { at: 9, id },
    });
  });
  it("bad bodies fail", () => {
    for (const bad of [
      { kind: "care.scan" },
      { kind: "care.scan", after: 4 },
      { kind: "care.scan", after: "plan-1" },
      { kind: "care.scan", after: { at: -1, id: "p" } },
      { kind: "care.bill", planId: "x".repeat(65) },
      { kind: "care.issue" },
    ])
      expect(
        [careScanMessage, careBillMessage, careIssueMessage].some((s) => s.safeParse(bad).success),
        JSON.stringify(bad),
      ).toBe(false);
    expect(alertsDailyMessage.safeParse({ kind: "alerts.daily", first: true }).success).toBe(false);
    expect(
      alertsDailyMessage.safeParse({
        kind: "alerts.daily",
        first: true,
        unbilledAfter: { at: -1, id },
        proformaAfter: null,
      }).success,
    ).toBe(false);
    expect(reminderScanMessage.safeParse({ kind: "reminder.scan", after: { at: 1.5, id } }).success).toBe(
      false,
    );
  });
  it("no body of the family, valid or not, is ever a lead (every kind is claimed by the guard; no lead schema accepts one)", () => {
    expect(BILLING_KINDS).toEqual(["care.scan", "care.bill", "care.issue", "alerts.daily", "reminder.scan"]);
    const bodies = [
      { kind: "care.scan", after: null },
      { kind: "care.scan" },
      { kind: "care.bill", planId: id },
      { kind: "care.bill", planId: 1 },
      { kind: "care.issue", documentId: id },
      { kind: "alerts.daily", first: true, unbilledAfter: null, proformaAfter: null },
      { kind: "alerts.daily" },
      { kind: "reminder.scan", after: null },
      { kind: "reminder.scan", after: "x" },
    ];
    for (const b of bodies) {
      expect(isBillingKind(b), JSON.stringify(b)).toBe(true);
      expect(leadMessage.safeParse(b).success, JSON.stringify(b)).toBe(false);
      expect(emailMessage.safeParse(b).success).toBe(false);
    }
    for (const other of [null, 1, "care.scan", {}, { kind: "contact" }, { kind: "quote" }])
      expect(isBillingKind(other)).toBe(false);
  });
});

describe("the M5.4 email templates", () => {
  it("are queued with the keys of INVOICE_EMAIL_DATA, every one a template of the list", () => {
    for (const t of Object.keys(INVOICE_EMAIL_DATA)) {
      expect(EMAIL_TEMPLATES).toContain(t);
      expect(isInvoiceEmailTemplate(t)).toBe(true);
    }
    expect(Object.keys(INVOICE_EMAIL_DATA).sort()).toEqual(
      [
        "alert.proforma_due",
        "alert.unbilled",
        "credit_note.sent",
        "debit_note.sent",
        "invoice.sent",
        "lut.reminder",
        "proforma.sent",
        "reminder.sent",
      ].sort(),
    );
    expect(isInvoiceEmailTemplate("offer.sent")).toBe(false);
    expect(INVOICE_EMAIL_DATA["reminder.sent"]).toEqual(
      expect.arrayContaining(["offset_days", "when", "kind", "url", "number"]),
    );
  });
  it("an invoice email with a PDF attached passes the message schema (the key is an invoice key)", () => {
    expect(
      emailMessage.safeParse({
        template: "invoice.sent",
        to: "a@example.com",
        data: { number: "TH/INV/2627/0001" },
        entity: { type: "document_send", id },
        attachment: { key: "docs/tax_invoice/2026-27/12345-v1.pdf", filename: "TH-INV-2627-12345.pdf" },
      }).success,
    ).toBe(true);
  });
});
