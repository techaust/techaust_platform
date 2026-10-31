// The invoice screens' pure rules [ADM-INV-01..04, -07, ADM-APR-01/02, ADM-PRJ-02]: 07-R word for word, the badges, each blocker's line and where it
// is fixed, the series preview, the errors by code, and what an autosave sends (only the contact, the discount and the lines; never a number, a
// status, a type or a due date) and how its answer lands (the server's ids by position; typing kept).
import { ISSUE_BLOCKER_CODES } from "@techaust/core/invoices";
import { decide, ROLES } from "@techaust/core/permissions";
import { PROFORMA_PDF_COPY } from "@techaust/pdf/copy";
import { describe, expect, it, vi } from "vitest";
import { RequestError } from "../api.ts";
import moneySource from "../routes/documents/money.tsx?raw";
import editorSource from "../routes/invoices/editor.tsx?raw";
import readSource from "../routes/invoices/read.tsx?raw";
import { APPROVED_07Y, PLACEHOLDER_MARK } from "./copy-y.ts";
import { APPROVED_07Z } from "./copy-z.ts";
import { INVT_COPY } from "./invoice-types.ts";
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
  INV_NO_MATCH,
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
  SUPPLIER_COPY_LABEL,
  SUPPLIER_COPY_NONE,
  seriesPreview,
  showsGstEstimate,
  splitAtPlace,
  splitSentences,
  supplierCopyLine,
  taxHeadEstimate,
  typeLabel,
  voidBlockedText,
  voidErrorText,
  voidRefusalStalesPage,
  voidTitle,
} from "./invoices.ts";
import { canDownloadSupplierCopy, fetchSupplierCopy, type InvoiceView } from "./invoices-api.ts";

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
  defaultDueDays: 7,
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
    expect(dueNote("03 Nov 2026", 7, 7)).toBe(
      "Due 03 Nov 2026: 7 days after the issue date (the client's terms, or Net 7).",
    );
    // FX-5 review L6: "Net N" is the setting's number (here 14), whatever the client's own days
    expect(dueNote("10 Nov 2026", 14, 14)).toBe(
      "Due 10 Nov 2026: 14 days after the issue date (the client's terms, or Net 14).",
    );
    expect(dueNote("20 Nov 2026", 24, 14)).toBe(
      "Due 20 Nov 2026: 24 days after the issue date (the client's terms, or Net 14).",
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
    // 07-ZA item 9: a proforma's dialog names a proforma.
    expect(voidTitle("TH/PI/2627/0001", "proforma")).toBe("Void proforma TH/PI/2627/0001");
    expect(milestoneHasInvoice(null)).toBe("This milestone already has a draft invoice.");
    expect(milestoneHasInvoice("TH/INV/2627/0001")).toBe(
      "This milestone already has invoice TH/INV/2627/0001.",
    );
    expect(convertedToInvoice(null)).toBe("Converted to a draft invoice.");
    expect(convertedToInvoice("TH/INV/2627/0001")).toBe("Converted to invoice TH/INV/2627/0001.");
    expect(INV_COPY.voidReasonEmpty).toBe("Enter a reason for voiding.");
    // 07-ZA item 18: the reason box names what is voided.
    expect(INV_COPY.voidReason).toBe("Reason (required, kept with the invoice)");
    expect(INV_COPY.voidProformaReason).toBe("Reason (required, kept with the proforma)");
    // 07-R's four, then M5.2's Converted (07-S §6) and Paid (docs/06 §5.5), then M5.3's two (07-T §6; changed on purpose)
    expect(BADGE_LABELS).toEqual({
      draft: "Draft",
      issued: "Issued",
      overdue: "Overdue",
      void: "Void",
      converted: "Converted",
      paid: "Paid",
      partly_credited: "Partly credited",
      credited: "Credited",
      // ADM-INV-10: 07-ZF 8 (owner 2026-10-31)
      withdrawn: "Withdrawn",
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
    for (const code of ISSUE_BLOCKER_CODES) expect(blockerLine({ code, line: 2 }, "INR")).not.toBe(code);
    expect(blockerLine({ code: "line_sac_missing", line: 3 }, "INR")).toBe(
      "Line 3 needs a 6-digit SAC code.",
    );
    expect(blockerLine({ code: "currency_mismatch" }, "USD")).toBe(
      "The invoice currency must be the client's currency (USD).",
    );
    expect(blockerLine({ code: "something_new" }, "INR")).toBe("something_new");
  });

  it("links each blocker to where it is fixed", () => {
    expect(blockerTarget({ code: "supplier_gstin" }, "c1")).toEqual({
      kind: "page",
      to: "/settings/company",
      place: "Settings › Company",
    });
    expect(blockerTarget({ code: "reverse_charge_text" }, "c1")).toMatchObject({ to: "/settings/tax" });
    // T4 (rt2): 07-ZC line 1, linked to Settings › Company
    expect(blockerTarget({ code: "signature_missing" }, "c1")).toEqual({
      kind: "page",
      to: "/settings/company",
      place: "Settings › Company",
    });
    expect(blockerLine({ code: "signature_missing" }, "INR")).toBe(
      "Add the signature in Settings › Company. Credit notes, debit notes and invoices for a payment received always carry it.",
    );
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

  it("FX-5 (owner decision 2026-10-30, 08-C RA-10): a document the client opened says so (07-Z §1, marked until approved); a payment or a credit still wins", () => {
    const invoiceLine =
      "The client has opened this invoice in the portal, so it can't be voided. Use a credit note instead.";
    const mark = APPROVED_07Z ? "" : "[Placeholder] ";
    expect(voidBlockedText(["viewed_by_client"])).toBe(`${mark}${invoiceLine}`);
    expect(voidBlockedText(["already_emailed", "viewed_by_client"])).toBe(`${mark}${invoiceLine}`);
    expect(voidBlockedText(["has_payment", "viewed_by_client"])).toBe(INV_ERRORS.void_not_allowed);
    expect(voidBlockedText(["viewed_by_client", "return_period_closed"])).toBe(
      INV_ERRORS.return_period_closed,
    );
    // ADM-INV-10: 07-ZF 15 (owner 2026-10-31) replaced 07-Z §1's proforma line
    expect(voidBlockedText(["viewed_by_client"], "proforma")).toBe(
      "The client has opened this proforma in the portal, so it can't be voided. Withdraw it instead.",
    );
    expect(voidBlockedText(["has_payment", "viewed_by_client"], "proforma")).toBe(
      INVT_COPY.proformaVoidBlocked,
    );
    // the dialog's sentence for the route's 409 (a view that landed while the dialog was open)
    expect(invErrorText(new RequestError(409, "viewed_by_client", "x"))).toBe(`${mark}${invoiceLine}`);
    // the void dialog names the document's own type; other failures keep invErrorText's sentence
    const viewed = new RequestError(409, "viewed_by_client", "x");
    expect(voidErrorText(viewed, "proforma")).toBe(
      "The client has opened this proforma in the portal, so it can't be voided. Withdraw it instead.",
    );
    expect(voidErrorText(viewed, "proforma")).not.toContain("credit note");
    expect(voidErrorText(viewed, "tax_invoice")).toBe(`${mark}${invoiceLine}`);
    expect(voidErrorText(viewed)).toBe(`${mark}${invoiceLine}`);
    const closed = new RequestError(409, "return_period_closed", "x");
    expect(voidErrorText(closed, "proforma")).toBe(invErrorText(closed));
    // re-check finding 2: a proforma refused for a payment or a converted invoice keeps its own line, never the invoice's credit note
    const notAllowed = new RequestError(409, "void_not_allowed", "x");
    expect(voidErrorText(notAllowed, "proforma")).toBe(INVT_COPY.proformaVoidBlocked);
    expect(voidErrorText(notAllowed, "proforma")).not.toContain("credit note");
    expect(voidErrorText(notAllowed, "tax_invoice")).toBe(invErrorText(notAllowed));
    // review L2, re-check finding 3: any refused void (409) makes the page behind the dialog stale (it reloads when the dialog closes)
    expect(voidRefusalStalesPage(viewed)).toBe(true);
    expect(voidRefusalStalesPage(closed)).toBe(true);
    expect(voidRefusalStalesPage(notAllowed)).toBe(true);
    expect(voidRefusalStalesPage(new RequestError(409, "already_void", "x"))).toBe(true);
    expect(voidRefusalStalesPage(new RequestError(400, "invalid", "x"))).toBe(false);
    expect(voidRefusalStalesPage(new RequestError(0, "network", "x"))).toBe(false);
    expect(voidRefusalStalesPage(new Error("viewed_by_client"))).toBe(false);
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

  it("the rate-date line names the day it was judged against: the invoice's, or the day the payment was received (S §8)", () => {
    expect(blockerLine({ code: "fx_date_invalid", date: "2027-04-02" }, "USD", { maxAgeDays: 4 })).toBe(
      "Use the rate published on 02 Apr 2027. If none was published that day, use the last one published before it, at most 4 days earlier.",
    );
    // as a 400, the server's words are 07-S's line (the day and the limit are in them)
    expect(
      invErrorText(
        new RequestError(
          400,
          "fx_same_day_exists",
          "A rate was published on 02 Apr 2027, so use that day's rate.",
          null,
        ),
      ),
    ).toBe("A rate was published on 02 Apr 2027, so use that day's rate.");
    expect(invErrorText(new RequestError(400, "fx_date_invalid", "Server words", null))).toBe(
      "Server words.",
    );
  });

  it("step 5: the supplier copy's label and the filtered list's title (R §7, 07-W §1)", () => {
    expect(SUPPLIER_COPY_LABEL).toBe("Download supplier copy");
    expect(INV_NO_MATCH).toBe("No invoices match these filters");
  });

  it("the supplier copy is offered from core's matrix row and core's document types: Owner and Accountant, never a proforma (review 2026-10-28, finding 9)", () => {
    for (const type of ["tax_invoice", "export_invoice", "credit_note", "debit_note"]) {
      expect(canDownloadSupplierCopy("owner", type), type).toBe(true);
      expect(canDownloadSupplierCopy("accountant", type), type).toBe(true);
      for (const role of ["staff", "sales"] as const) expect(canDownloadSupplierCopy(role, type)).toBe(false);
    }
    for (const role of ROLES) {
      expect(canDownloadSupplierCopy(role, "proforma"), role).toBe(false);
      expect(canDownloadSupplierCopy(role, "proposal"), role).toBe(false);
    }
    // the same answer as the matrix and the document rule, whichever role
    for (const role of ROLES)
      expect(canDownloadSupplierCopy(role, "tax_invoice")).toBe(
        decide(role, "invoices.supplierCopy") !== "deny",
      );
  });

  it("asking for the supplier copy while an ask for the same document is out is not a second request (finding 8)", async () => {
    const out: ((r: Response) => void)[] = [];
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => out.push(resolve)));
    try {
      const first = fetchSupplierCopy("doc-1");
      const second = fetchSupplierCopy("doc-1");
      const other = fetchSupplierCopy("doc-2");
      // two documents, two requests; the second ask of doc-1 joined the first
      expect(out).toHaveLength(2);
      const pending = () =>
        new Response(JSON.stringify({ error: { code: "pdf_pending" } }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      out[0]?.(pending());
      out[1]?.(new Response(JSON.stringify({ state: "making" }), { status: 202 }));
      expect(await first).toEqual({ state: "no_original" });
      expect(await second).toEqual({ state: "no_original" });
      expect(await other).toEqual({ state: "pending" });
      // once it has answered, the next ask is a new request
      const again = fetchSupplierCopy("doc-1");
      expect(out).toHaveLength(3);
      out[2]?.(new Response("x", { status: 500 }));
      expect(await again).toEqual({ state: "failed" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("FX-4 (early check M1): 409 pdf_pending is its own state, never 'being prepared'; 202 is; another 409 fails; the PDF is ready", async () => {
    const answers: Record<string, () => Response> = {
      making: () => new Response(JSON.stringify({ state: "making" }), { status: 202 }),
      noOriginal: () =>
        new Response(JSON.stringify({ error: { code: "pdf_pending" } }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      otherConflict: () =>
        new Response(JSON.stringify({ error: { code: "stale_version" } }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ready: () =>
        new Response("%PDF-1.7", {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'attachment; filename="TH-INV-2627-0003-supplier-copy.pdf"',
          },
        }),
      offline: () => {
        throw new TypeError("network");
      },
    };
    let next = "making";
    vi.stubGlobal("fetch", async () => (answers[next] as () => Response)());
    try {
      expect(await fetchSupplierCopy("d")).toEqual({ state: "pending" });
      next = "noOriginal";
      expect(await fetchSupplierCopy("d")).toEqual({ state: "no_original" });
      next = "otherConflict";
      expect(await fetchSupplierCopy("d")).toEqual({ state: "failed" });
      next = "offline";
      expect(await fetchSupplierCopy("d")).toEqual({ state: "failed" });
      next = "ready";
      const r = await fetchSupplierCopy("d");
      expect(r.state).toBe("ready");
      expect(r.state === "ready" && r.filename).toBe("TH-INV-2627-0003-supplier-copy.pdf");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("FX-4 (early check M1, review L2): only an anonymised client's 409 leaves a line under the supplier copy (07-Y, marked)", () => {
    const mark = APPROVED_07Y ? "" : `${PLACEHOLDER_MARK} `;
    expect(SUPPLIER_COPY_NONE).toBe(
      `${mark}No supplier copy was made before this client was anonymised, and none can be made now.`,
    );
    expect(supplierCopyLine("no_original", true)).toBe(SUPPLIER_COPY_NONE);
    // a live client's button shows only once its PDF is ready, so a 409 there is a plain failure (the toast), never a line
    expect(supplierCopyLine("no_original", false)).toBeNull();
    for (const state of ["ready", "pending", "failed"]) expect(supplierCopyLine(state, true)).toBeNull();
    // never the "being prepared" words of a copy on its way
    expect(SUPPLIER_COPY_NONE).not.toContain(INV_COPY.pdfPreparing);
  });

  it("a proforma's void refused for a reason other than a payment says it was emailed", () => {
    // ADM-INV-10: 07-ZF 16 (owner 2026-10-31)
    expect(voidBlockedText(["emailed"], "proforma")).toBe(
      "This proforma has been emailed to the client, so it can't be voided. Withdraw it instead.",
    );
  });
});

describe("FX-4 review M1 (A5 5): a marked proforma's tax heads read as estimates, in the PDF's words", () => {
  it("the head is the PDF's own wording, so the screen and the PDF never differ", () => {
    expect(taxHeadEstimate("CGST")).toBe("CGST (estimate)");
    for (const h of ["CGST", "SGST", "IGST"]) expect(taxHeadEstimate(h)).toBe(PROFORMA_PDF_COPY.estimate(h));
  });
  it("only a proforma with the marker; one sealed before FX-4, or any other type, keeps the plain heads", () => {
    expect(showsGstEstimate({ type: "proforma", proforma: { gstEstimate: true } })).toBe(true);
    expect(showsGstEstimate({ type: "proforma", proforma: { gstEstimate: false } })).toBe(false);
    expect(showsGstEstimate({ type: "proforma", proforma: {} })).toBe(false);
    expect(showsGstEstimate({ type: "proforma", proforma: null })).toBe(false);
    expect(showsGstEstimate({ type: "proforma" })).toBe(false);
    for (const type of ["tax_invoice", "export_invoice", "credit_note", "debit_note"])
      expect(showsGstEstimate({ type, proforma: { gstEstimate: true } })).toBe(false);
  });
  it("the invoice editor and the invoice page pass the marker to TaxPreview, which names the heads by it", () => {
    for (const src of [editorSource, readSource]) expect(src).toMatch(/estimate=\{showsGstEstimate\(v\)\}/);
    expect(moneySource).toMatch(/props\.estimate \? taxHeadEstimate\(DOC_COPY\[k\]\) : DOC_COPY\[k\]/);
  });
});
