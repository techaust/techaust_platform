// The invoice screens' pure rules [ADM-INV-01..04, -07, ADM-APR-01/02, ADM-PRJ-02]: 07-R word for word, the badges, each blocker's line and where it
// is fixed, the series preview, the errors by code, and what an autosave sends (only the contact, the discount and the lines; never a number, a
// status, a type or a due date) and how its answer lands (the server's ids by position; typing kept).
import { ISSUE_BLOCKER_CODES } from "@techaust/core/invoices";
import { describe, expect, it } from "vitest";
import { RequestError } from "../api.ts";
import {
  applyInvoiceSave,
  BADGE_LABELS,
  badgeOf,
  blockerLine,
  blockerTarget,
  buildInvoicePatch,
  convertedToInvoice,
  draftLedeFor,
  draftTitle,
  dueNote,
  fromMilestone,
  frozenBanner,
  INV_COPY,
  INV_ERRORS,
  INV_PLACEHOLDER,
  initInvoiceEditor,
  invErrorText,
  invoiceEditor,
  issueBody,
  issuedToast,
  issueLabelFor,
  milestoneBackLine,
  milestoneBillable,
  milestoneHasInvoice,
  requestRow,
  seriesPreview,
  splitAtPlace,
  splitSentences,
  typeLabel,
  voidBlockedText,
  voidTitle,
} from "./invoices.ts";
import type { InvoiceView } from "./invoices-api.ts";

const view = (over: Partial<InvoiceView> = {}): InvoiceView => ({
  id: "inv-1",
  type: "tax_invoice",
  status: "draft",
  number: null,
  series: null,
  fy: null,
  currency: "INR",
  issueDate: null,
  dueDate: null,
  dueDays: 7,
  dueDatePreview: "2026-11-03",
  createdAt: 1,
  updatedAt: 100,
  frozenAt: null,
  contentSha256: "abc",
  frozen: false,
  parentId: null,
  sourceDocumentId: null,
  client: {
    id: "c1",
    code: "SAMPLE-A",
    name: "Sample Client A (sample)",
    gstStatus: "unregistered",
    stateCode: "19",
    country: "IN",
    currency: "INR",
    anonymised: false,
  },
  contact: { id: "k1", name: "Sample contact", email: "a@example.test", anonymised: false },
  recipient: null,
  issuer: null,
  discount: null,
  lines: [
    {
      id: "l1",
      position: 1,
      catalogueItemId: null,
      description: "Sample line",
      detail: null,
      sac: "998314",
      qtyMilli: 1000,
      unit: "fixed",
      rateMinor: 4500000,
      discount: null,
      gstRateBp: 1800,
      taxableMinor: 4500000,
      cgstMinor: 405000,
      sgstMinor: 405000,
      igstMinor: 0,
      lineTotalMinor: 5310000,
    },
  ],
  totals: null,
  supply: null,
  summary: null,
  paidMinor: 0,
  creditedMinor: 0,
  balanceMinor: 0,
  overdue: false,
  errors: [],
  warnings: [],
  blockers: [],
  typeIssuable: true,
  needsResave: false,
  issue: {
    decision: "step-up",
    canIssue: true,
    approval: {
      state: "none",
      id: null,
      requestedBy: null,
      requestedAt: null,
      decidedBy: null,
      decidedAt: null,
      note: null,
    },
    preview: { series: "invoice", fy: "2627", template: "TH/INV/{FY}/{N}", padding: 4 },
  },
  void: { voidedAt: null, reason: null, canVoid: false, blockers: ["not_issued"] },
  pdf: { state: "none", sha256: null, fingerprint: null },
  milestone: null,
  terms: null,
  ...over,
});

describe("07-R copy", () => {
  it("keeps the list, editor, issue and void lines word for word", () => {
    expect(INV_COPY.intro).toBe(
      "Tax invoices you've drafted or issued. A number is given only when an invoice is issued, and an issued invoice can't be changed.",
    );
    expect(INV_COPY.notIssued).toBe("Not issued yet");
    expect(INV_COPY.deleteBody).toBe(
      "Delete this draft? It has no number yet, so nothing is lost from the series.",
    );
    expect(dueNote("03 Nov 2026", 7)).toBe(
      "Due 03 Nov 2026: 7 days after the issue date (the client's terms, or Net 7).",
    );
    expect(fromMilestone("Design", "Rebuild")).toBe(
      'Created from the milestone "Design" of Rebuild. The total matches the milestone amount, GST included.',
    );
    expect(issueBody("TH/INV/2627/…", "TH/INV/2627/0001", "27 Oct 2026")).toBe(
      "This invoice will get the next number in the series (TH/INV/2627/…, for example TH/INV/2627/0001) and the date 27 Oct 2026. Once issued it can't be edited or deleted. Corrections are made with a credit note or a debit note.",
    );
    expect(requestRow("Asha", "Client A", "₹1.00")).toBe(
      "Asha asked to issue a draft invoice for Client A: ₹1.00.",
    );
    expect(frozenBanner("27 Oct 2026", "Asha")).toBe(
      "Issued 27 Oct 2026 by Asha. This invoice is locked: corrections are made with a credit note or a debit note.",
    );
    expect(voidTitle("TH/INV/2627/0001")).toBe("Void invoice TH/INV/2627/0001");
    expect(milestoneHasInvoice(null)).toBe("This milestone already has a draft invoice.");
    expect(milestoneHasInvoice("TH/INV/2627/0001")).toBe(
      "This milestone already has invoice TH/INV/2627/0001.",
    );
    expect(convertedToInvoice(null)).toBe("Converted to a draft invoice.");
    expect(convertedToInvoice("TH/INV/2627/0001")).toBe("Converted to invoice TH/INV/2627/0001.");
    expect(INV_COPY.voidReasonEmpty).toBe("Enter a reason for voiding.");
    // 07-R's four, then M5.2's Converted (07-S §6) and Paid (docs/06 §5.5)
    expect(BADGE_LABELS).toEqual({
      draft: "Draft",
      issued: "Issued",
      overdue: "Overdue",
      void: "Void",
      converted: "Converted",
      paid: "Paid",
    });
  });

  it("a milestone can be invoiced when Ready to bill, or as the pending advance, wherever it sits (re-check A)", () => {
    const m = { status: "ready_to_bill", isAdvance: false, documentId: null };
    expect(milestoneBillable(m)).toBe(true);
    expect(milestoneBillable({ ...m, documentId: "d1" })).toBe(false);
    expect(milestoneBillable({ status: "pending", isAdvance: true, documentId: null })).toBe(true);
    expect(milestoneBillable({ status: "pending", isAdvance: false, documentId: null })).toBe(false);
    expect(milestoneBillable({ status: "invoiced", isAdvance: true, documentId: null })).toBe(false);
  });

  it("after a void, the milestone line follows the status it went back to (07-R §4, re-check B), and milestone_not_ready is 07-R §5", () => {
    expect(milestoneBackLine("pending")).toBe("The milestone is back to Pending.");
    expect(milestoneBackLine("ready_to_bill")).toBe("The milestone is back to Ready to bill.");
    expect(milestoneBackLine("invoiced")).toBeNull();
    expect(milestoneBackLine(null)).toBeNull();
    expect(INV_ERRORS.milestone_not_ready).toBe(
      "Only a milestone that's Ready to bill, or the advance payment of a started project, can be invoiced.",
    );
  });

  it("splits the empty line into a title and a body", () => {
    expect(splitSentences(INV_COPY.empty)).toEqual([
      "No invoices yet",
      "Create one from a client, or from a milestone that's ready to bill.",
    ]);
  });
});

describe("badges and types", () => {
  it("draws Draft, Issued, Overdue (the server's) and Void", () => {
    expect(badgeOf({ status: "draft", overdue: false })).toBe("draft");
    expect(badgeOf({ status: "issued", overdue: false })).toBe("issued");
    expect(badgeOf({ status: "issued", overdue: true })).toBe("overdue");
    expect(badgeOf({ status: "void", overdue: true })).toBe("void");
  });

  it("names the types with core's series labels", () => {
    expect(typeLabel("tax_invoice")).toBe("Tax invoice");
    expect(typeLabel("export_invoice")).toBe("Export invoice");
    expect(typeLabel("proforma")).toBe("Proforma invoice");
  });
});

describe("blockers", () => {
  it("has a 07-R line for every core blocker code", () => {
    for (const code of ISSUE_BLOCKER_CODES)
      expect(blockerLine({ code, line: 2 }, "INR")).not.toBe(INV_PLACEHOLDER);
    expect(blockerLine({ code: "line_sac_missing", line: 3 }, "INR")).toBe(
      "Line 3 needs a 6-digit SAC code.",
    );
    expect(blockerLine({ code: "currency_mismatch" }, "USD")).toBe(
      "The invoice currency must be the client's currency (USD).",
    );
    expect(blockerLine({ code: "something_new" }, "INR")).toBe(INV_PLACEHOLDER);
  });

  it("links each blocker to where it is fixed", () => {
    expect(blockerTarget({ code: "supplier_gstin" }, "c1")).toEqual({
      kind: "page",
      to: "/settings/company",
      place: "Settings › Company",
    });
    expect(blockerTarget({ code: "reverse_charge_text" }, "c1")).toMatchObject({ to: "/settings/tax" });
    expect(blockerTarget({ code: "recipient_address" }, "c 1")).toEqual({
      kind: "page",
      to: "/clients/c%201",
    });
    expect(blockerTarget({ code: "line_description_missing", line: 2 }, "c1")).toEqual({
      kind: "line",
      n: 2,
      field: "description",
    });
    // review finding 15: the SAC blocker goes to the line's SAC field, not its description
    expect(blockerTarget({ code: "line_sac_missing", line: 3 }, "c1")).toEqual({
      kind: "line",
      n: 3,
      field: "sac",
    });
    expect(blockerTarget({ code: "line_sac_missing" }, "c1")).toEqual({ kind: "lines" });
    expect(blockerTarget({ code: "no_lines" }, "c1")).toEqual({ kind: "lines" });
    expect(blockerTarget({ code: "type_not_allowed" }, "c1")).toBeNull();
    expect(splitAtPlace("Add the GSTIN in Settings › Company.", "Settings › Company")).toEqual([
      "Add the GSTIN in ",
      "Settings › Company",
      ".",
    ]);
    expect(splitAtPlace("Add the client's legal name.", undefined)).toBeNull();
  });
});

describe("series preview", () => {
  it("shows the series, the slot and an example, never a real number", () => {
    expect(seriesPreview({ template: "TH/INV/{FY}/{N}", fy: "2627", padding: 4 })).toEqual({
      before: "TH/INV/2627/",
      after: "",
      text: "TH/INV/2627/…",
      example: "TH/INV/2627/0001",
    });
    expect(seriesPreview({ template: "INV-{N}/{FY}", fy: "2627", padding: 3 })).toMatchObject({
      text: "INV-…/2627",
      example: "INV-001/2627",
    });
  });
});

describe("errors", () => {
  it("says each API code in 07-R's words", () => {
    expect(invErrorText(new RequestError(403, "approval_required", "x"))).toBe(INV_ERRORS.approval_required);
    expect(invErrorText(new RequestError(409, "contact_changed", "x"))).toBe(
      "The contact's details changed a moment ago. Try again.",
    );
    expect(
      invErrorText(
        new RequestError(409, "already_issued", "x", null, [], [], [], { number: "TH/INV/2627/0007" }),
      ),
    ).toBe("This invoice was already issued as TH/INV/2627/0007.");
    expect(invErrorText(new RequestError(409, "rare_code", "Server words"))).toBe("Server words.");
  });

  it("says why a void is refused in one sentence", () => {
    expect(voidBlockedText([])).toBeNull();
    expect(voidBlockedText(["already_void"])).toBe(INV_ERRORS.already_void);
    expect(voidBlockedText(["return_period_closed", "already_emailed"])).toBe(
      INV_ERRORS.return_period_closed,
    );
    expect(voidBlockedText(["has_payment"])).toBe(INV_ERRORS.void_not_allowed);
  });

  it("a proforma has its own title, locked banner and void line (07-S §8), never the credit-note advice", () => {
    expect(draftTitle("Client A", "proforma")).toBe("Draft proforma for Client A");
    expect(draftTitle("Client A", "export_invoice")).toBe("Draft invoice for Client A");
    expect(frozenBanner("27 Oct 2026", "Asha", "proforma")).not.toContain("credit note");
    expect(voidBlockedText(["has_child_document"], "proforma")).toBe(
      "This proforma can't be voided because a payment has been recorded against it.",
    );
    expect(voidBlockedText(["has_payment"], "proforma")).toBe(
      "This proforma can't be voided because a payment has been recorded against it.",
    );
    expect(voidBlockedText(["already_void"], "proforma")).toBe(INV_ERRORS.already_void);
    expect(blockerLine({ code: "type_not_allowed" }, "INR")).toBe(
      "This client is outside India, so this needs an export invoice.",
    );
  });
});

describe("autosave", () => {
  it("sends nothing for a clean draft, and the fields once when forced (an out-of-date draft)", () => {
    const s = initInvoiceEditor(view());
    expect(buildInvoicePatch(s)).toEqual({ ok: true, patch: null });
    const forced = buildInvoicePatch(s, true);
    expect(forced.ok && forced.patch).toEqual({
      expectedUpdatedAt: 100,
      fields: { contactId: "k1", discount: null },
    });
  });

  it("sends only the parts that changed, in the API's units, and never a number, status, type or due date", () => {
    let s = initInvoiceEditor(view());
    s = invoiceEditor(s, { type: "fields", patch: { disc: "10" } });
    const b = buildInvoicePatch(s);
    expect(b.ok && b.patch).toEqual({
      expectedUpdatedAt: 100,
      fields: { contactId: "k1", discount: { kind: "percent", value: 1000 } },
    });
    const keys = b.ok && b.patch ? Object.keys(b.patch) : [];
    for (const k of ["number", "status", "type", "dueDate", "contentSha256"]) expect(keys).not.toContain(k);
  });

  it("stops on a line that can't be saved", () => {
    let s = initInvoiceEditor(view());
    const u = s.lines[0]?.uid as string;
    s = invoiceEditor(s, { type: "line", uid: u, patch: { description: " " } });
    expect(buildInvoicePatch(s)).toEqual({ ok: false, error: "Enter a description." });
  });

  it("puts the server's ids on new lines by position and keeps a part edited during the save dirty", () => {
    let s = initInvoiceEditor(view());
    const first = s.lines[0];
    if (!first) throw new Error("fixture");
    const added = { ...first, uid: "new-1", id: null, description: "Added" };
    s = invoiceEditor(s, { type: "lines", lines: [first, added] });
    const b = buildInvoicePatch(s);
    if (!b.ok || !b.patch) throw new Error("expected a patch");
    s = invoiceEditor(s, { type: "fields", patch: { disc: "5" } });
    const answer = view({
      updatedAt: 200,
      lines: [
        ...view().lines,
        { ...view().lines[0], id: "l2", position: 2, description: "Added" } as InvoiceView["lines"][0],
      ],
    });
    const after = applyInvoiceSave(s, answer, b.sent);
    expect(after.updatedAt).toBe(200);
    expect(after.lines.map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(after.status).toBe("idle");
    expect(after.fields.disc).toBe("5");
  });
});

describe("M5.2 re-check: proforma wording and the advance rate date (07-S §8)", () => {
  it("a proforma has its own lede, issue label and toast; an invoice keeps 07-R's", () => {
    expect(draftLedeFor("proforma")).toBe(
      "Drafts can be edited. Issuing gives the next proforma number and locks it.",
    );
    expect(draftLedeFor("tax_invoice")).toBe(INV_COPY.draftLede);
    expect(issueLabelFor("proforma")).toBe("Issue proforma");
    expect(issueLabelFor("export_invoice")).toBe(INV_COPY.issue);
    expect(issuedToast("TH/PI/2627/0001", "proforma")).toBe("Proforma TH/PI/2627/0001 issued.");
    expect(issuedToast("TH/INV/2627/0001")).toBe("Invoice TH/INV/2627/0001 issued.");
  });

  it("the advance's rate-date line names the day the payment was received", () => {
    expect(blockerLine({ code: "fx_date_invalid" }, "USD", { maxAgeDays: 4, advance: true })).toBe(
      "The rate date must be the date the payment was received or up to 4 days before it.",
    );
    expect(blockerLine({ code: "fx_date_invalid" }, "USD", { maxAgeDays: 4 })).toBe(
      "The rate date must be the invoice date or up to 4 days before it.",
    );
  });

  it("a proforma's void refused for a reason other than a payment says it was emailed", () => {
    expect(voidBlockedText(["emailed"], "proforma")).toBe(
      "This proforma has been emailed to the client, so it can't be voided.",
    );
  });
});
