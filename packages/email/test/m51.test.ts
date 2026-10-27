// M5.1 emails: the invoice issue request and its decision, to staff (07-R §3 "Approval emails"; the layout of the M4.5 discount approval emails).
import { describe, expect, it } from "vitest";
import {
  NO_REPLY_REPLY_TO,
  renderEmail,
  SENDERS,
  staffApprovalIssueDecided,
  staffApprovalIssueRequested,
} from "../src/index.ts";

const opts = { assetBase: "https://assets.example.test/brand/" };

const requested = {
  requester_name: "Sample Staff",
  client_name: "Sample Client",
  total: "₹59,000.00",
  admin_url: "https://admin.example.test/approvals/apr_sample_1?kind=issue",
};

const decided = {
  decision: "approved",
  client_name: "Sample Client",
  number: "TH/INV/2627/0012",
  decision_note: "",
  admin_url: "https://admin.example.test/invoices/doc_sample_1",
};

describe("approval.issue.requested [ADM-INV-02, ADM-APR-01]", () => {
  it("the 07-R subject and sentence, from no-reply@ with Reply-To contact@, and the admin button", () => {
    const r = renderEmail("approval.issue.requested", requested, opts);
    expect(r.subject).toBe("Invoice issue requested for Sample Client");
    expect(r.from).toEqual(SENDERS.noReply);
    expect(r.replyTo).toBe(NO_REPLY_REPLY_TO);
    expect(r.text).toContain(
      "Sample Staff asked you to issue a draft invoice for Sample Client, total ₹59,000.00. Open the approvals queue to issue or reject it.",
    );
    expect(r.text).toContain("Open in admin: https://admin.example.test/approvals/apr_sample_1?kind=issue");
    expect(r.html).toContain("Open in admin");
    expect(r.html).toContain("https://admin.example.test/approvals/apr_sample_1?kind=issue");
  });

  it("is the same function the package exports (the jobs Worker may call it directly)", () => {
    expect(staffApprovalIssueRequested(requested, opts).subject).toBe(
      renderEmail("approval.issue.requested", requested, opts).subject,
    );
  });

  it("escapes the names in the HTML and keeps a line break out of the subject", () => {
    const r = renderEmail(
      "approval.issue.requested",
      { ...requested, requester_name: "<b>x</b>", client_name: "A & B\r\nBcc: z@example.test" },
      opts,
    );
    expect(r.html).not.toContain("<b>x</b>");
    expect(r.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(r.subject).not.toMatch(/[\r\n]/);
  });
});

describe("approval.issue.decided [ADM-INV-02, ADM-APR-02]", () => {
  it("issued: the subject and sentence name the number; no reason line without a reason", () => {
    const r = renderEmail("approval.issue.decided", decided, opts);
    expect(r.subject).toBe("Your invoice for Sample Client: Issued as TH/INV/2627/0012");
    expect(r.from).toEqual(SENDERS.noReply);
    expect(r.text).toContain("The owner issued it as TH/INV/2627/0012.");
    expect(r.text).not.toContain("Reason:");
    expect(r.text).toContain("Open in admin: https://admin.example.test/invoices/doc_sample_1");
  });

  it("rejected: the 07-R words, and the reason as a sentence when the owner gave one", () => {
    const r = renderEmail(
      "approval.issue.decided",
      { ...decided, decision: "rejected", number: "", decision_note: "Wrong contact" },
      opts,
    );
    expect(r.subject).toBe("Your invoice for Sample Client: Rejected");
    expect(r.text).toContain("The owner rejected the request.");
    expect(r.text).toContain("Reason: Wrong contact.");
    const ended = staffApprovalIssueDecided(
      { ...decided, decision: "rejected", number: "", decision_note: "Check the lines first." },
      opts,
    );
    expect(ended.text).toContain("Reason: Check the lines first.");
    expect(ended.text).not.toContain("first..");
  });

  it("a reason of only spaces is no reason", () => {
    const r = renderEmail("approval.issue.decided", { ...decided, decision_note: "   " }, opts);
    expect(r.text).not.toContain("Reason:");
  });

  it("light and dark, like every brand email (the colour scheme and the dark rules are in the HTML)", () => {
    const r = renderEmail("approval.issue.decided", decided, opts);
    expect(r.html).toContain("prefers-color-scheme: dark");
    expect(r.html).toContain("https://assets.example.test/brand/");
  });
});
