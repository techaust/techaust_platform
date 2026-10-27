// M5.3 emails: the issue request of a credit or debit note and its decision, to staff (07-T §8 "Approval emails, notes"; the layout of the M5.1
// invoice emails). The data is what the jobs Worker queues (apps/jobs/src/offers.ts): the invoice's keys plus `document_type` and `parent_number`.
import { describe, expect, it } from "vitest";
import {
  renderEmail,
  SENDERS,
  staffApprovalIssueDecided,
  staffApprovalIssueRequested,
} from "../src/index.ts";

const opts = { assetBase: "https://assets.example.test/brand/" };

const requested = {
  kind: "issue",
  requester_name: "Sample Staff",
  client_name: "Sample Client",
  request_reason: "issuing a credit note",
  title: "credit note for Sample Client",
  document_type: "credit note",
  parent_number: "TH/INV/2627/0007",
  version: "1",
  amount: "₹9,440.00",
  admin_url: "https://admin.example.test/approvals/apr_sample_1?kind=issue",
};

const decided = {
  kind: "issue",
  decision: "Approved",
  approver_name: "Sample Owner",
  title: "credit note for Sample Client",
  document_type: "credit note",
  parent_number: "TH/INV/2627/0007",
  version: "1",
  client_name: "Sample Client",
  number: "TH/CN/2627/0001",
  decision_note: "",
  admin_url: "https://admin.example.test/invoices/doc_sample_1",
};

describe("approval.requested for a note [ADM-INV-11, ADM-APR-01]", () => {
  it("a credit note: the 07-T §8 subject and sentence (with the invoice it is against), from no-reply@", () => {
    const r = renderEmail("approval.requested", requested, opts);
    expect(r.subject).toBe("Credit note issue requested for Sample Client");
    expect(r.from).toEqual(SENDERS.noReply);
    expect(r.text).toContain(
      "Sample Staff asked you to issue a draft credit note for Sample Client, total ₹9,440.00, against invoice TH/INV/2627/0007. Open the approvals queue to issue or reject it.",
    );
    expect(r.text).toContain("Open in admin: https://admin.example.test/approvals/apr_sample_1?kind=issue");
  });

  it("a debit note", () => {
    const r = renderEmail("approval.requested", { ...requested, document_type: "debit note" }, opts);
    expect(r.subject).toBe("Debit note issue requested for Sample Client");
    expect(r.text).toContain(
      "asked you to issue a draft debit note for Sample Client, total ₹9,440.00, against invoice",
    );
  });

  it("an invoice's email is unchanged; an unknown document word reads as an invoice", () => {
    const { document_type: _t, parent_number: _p, ...invoice } = requested;
    expect(renderEmail("approval.requested", invoice, opts).subject).toBe(
      "Invoice issue requested for Sample Client",
    );
    expect(renderEmail("approval.requested", { ...requested, document_type: "proforma" }, opts).subject).toBe(
      "Invoice issue requested for Sample Client",
    );
    expect(staffApprovalIssueRequested({ ...requested }, opts).subject).toBe(
      renderEmail("approval.requested", requested, opts).subject,
    );
  });

  it("escapes the invoice number and the names in the HTML", () => {
    const r = renderEmail("approval.requested", { ...requested, parent_number: "<i>x</i>" }, opts);
    expect(r.html).not.toContain("<i>x</i>");
    expect(r.html).toContain("&lt;i&gt;x&lt;/i&gt;");
  });
});

describe("approval.decided for a note [ADM-INV-11, ADM-APR-02]", () => {
  it("issued: 07-R §3's words with the note's word", () => {
    const r = renderEmail("approval.decided", decided, opts);
    expect(r.subject).toBe("Your credit note for Sample Client: Issued as TH/CN/2627/0001");
    expect(r.text).toContain("The owner issued it as TH/CN/2627/0001.");
  });

  it("rejected, a debit note, with the reason", () => {
    const r = staffApprovalIssueDecided(
      {
        ...decided,
        document_type: "debit note",
        decision: "Rejected",
        number: "",
        decision_note: "Check the amount",
      },
      opts,
    );
    expect(r.subject).toBe("Your debit note for Sample Client: Rejected");
    expect(r.text).toContain("The owner rejected the request.");
    expect(r.text).toContain("Reason: Check the amount.");
  });

  it("an invoice's decision is unchanged", () => {
    const { document_type: _t, parent_number: _p, ...invoice } = decided;
    expect(renderEmail("approval.decided", { ...invoice, number: "TH/INV/2627/0012" }, opts).subject).toBe(
      "Your invoice for Sample Client: Issued as TH/INV/2627/0012",
    );
  });
});
