// M4.5 emails: proposal and estimate sent, the acceptance emails, the approval emails (07 §8 and 07-O words), and the SES attachment.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderEmail, SENDERS, sesTransport, toBase64 } from "../src/index.ts";

const opts = { assetBase: "https://assets.example.test/brand/" };
const sent = {
  first_name: "Asha",
  kind: "proposal",
  title: "Website rebuild",
  number: "TH/PRP/2627/0001",
  version: "2",
  valid_until: "30 Nov 2026",
  total: "₹1,00,000.00",
  url: "https://portal.example.test/o#t=abc",
  attached: "1",
  sender_name: "Sample Sender",
};

describe("offer.sent [ADM-PROP-07, ADM-MAIL-01]", () => {
  it("proposal: the 07 section 8 subject and core sentence, hello@ with Reply-To hello@", () => {
    const r = renderEmail("offer.sent", sent, opts);
    expect(r.subject).toBe("Proposal: Website rebuild (TH/PRP/2627/0001 v2)");
    expect(r.from).toEqual(SENDERS.hello);
    expect(r.replyTo).toBe("hello@techaust.com");
    expect(r.text).toContain(
      "Hi Asha, your proposal is ready. It covers scope, timeline, price and payment schedule, and it's valid until 30 Nov 2026.",
    );
    expect(r.text).toContain("Review and accept: https://portal.example.test/o#t=abc");
    expect(r.text).toContain("Questions? Just reply to this email.");
    expect(r.html).toContain("Review and accept");
  });
  it("estimate: its own subject and sentence", () => {
    const r = renderEmail("offer.sent", { ...sent, kind: "estimate" }, opts);
    expect(r.subject).toBe("Estimate: Website rebuild (TH/PRP/2627/0001 v2)");
    expect(r.text).toContain("your estimate is ready. It covers the line items, price and payment terms,");
  });
  it("07-N section 4: the facts, then the button, then the PDF note (attached or on the same page)", () => {
    const r = renderEmail("offer.sent", sent, opts);
    expect(r.text).toContain("Number: TH/PRP/2627/0001 v2\nTotal: ₹1,00,000.00\nValid until: 30 Nov 2026");
    expect(r.text).toContain("The PDF is attached.");
    expect(r.text.indexOf("Review and accept:")).toBeLessThan(r.text.indexOf("The PDF is attached."));
    expect(r.text.indexOf("The PDF is attached.")).toBeLessThan(r.text.indexOf("Questions?"));
    const linked = renderEmail("offer.sent", { ...sent, attached: "0" }, opts).text;
    expect(linked).not.toContain("PDF is attached");
    expect(linked).toContain("You can download the PDF from the same page.");
    expect(r.text).not.toContain("[Placeholder]");
  });
  it("escapes every value and cannot inject a header through the title", () => {
    const r = renderEmail("offer.sent", { ...sent, title: "<script>x</script>\r\nBcc: a@b.c" }, opts);
    expect(r.html).not.toContain("<script>x</script>");
    expect(r.subject).not.toMatch(/[\r\n]/);
  });
});

describe("acceptance emails", () => {
  const acc = {
    typed_name: "Asha Rao",
    accepted_at_ist: "26 Oct 2026, 10:30 IST",
    title: "Website rebuild",
    number: "TH/PRP/2627/0001",
    version: "2",
    url: "https://portal.example.test/o#t=c",
    next_step: "we'll confirm the start date with you",
  };
  it("client: 07 section 8 subject and sentences, one link", () => {
    const r = renderEmail("offer.accepted.client", acc, opts);
    expect(r.subject).toBe("Accepted: Website rebuild (TH/PRP/2627/0001 v2)");
    expect(r.text).toContain(
      "Thank you, Asha Rao. Your acceptance was recorded on 26 Oct 2026, 10:30 IST. Links to the accepted proposal and the acceptance certificate are below.",
    );
    expect(r.text).toContain("Next: we'll confirm the start date with you.");
    expect(r.text).toContain(acc.url);
    expect(r.from).toEqual(SENDERS.hello);
  });
  it("staff: the same subject, the 07-N section 4 body and the admin link", () => {
    const r = renderEmail(
      "offer.accepted.staff",
      { ...acc, email: "asha@example.test", url: "https://admin.example.test/documents/1" },
      opts,
    );
    expect(r.subject).toBe("Accepted: Website rebuild (TH/PRP/2627/0001 v2)");
    expect(r.text).toContain(
      "Asha Rao (asha@example.test) accepted TH/PRP/2627/0001 v2 on 26 Oct 2026, 10:30 IST.",
    );
    expect(r.text).toContain("Open in admin: https://admin.example.test/documents/1");
    expect(r.text).not.toContain("[Placeholder]");
    // Without the address (an older message), the sentence still reads.
    expect(renderEmail("offer.accepted.staff", acc, opts).text).toContain(
      "Asha Rao accepted TH/PRP/2627/0001 v2 on",
    );
  });
});

describe("declined email to TecHaust (07-N section 4)", () => {
  const data = {
    name: "Asha Rao",
    title: "Website rebuild",
    number: "TH/PRP/2627/0001",
    version: "2",
    reason: "The timing doesn't work for us",
    note: "",
    url: "https://admin.example.test/documents/1",
  };
  it("subject and body word for word; the note sentence only when there is a note", () => {
    const r = renderEmail("offer.declined.staff", data, opts);
    expect(r.subject).toBe("Declined: Website rebuild (TH/PRP/2627/0001 v2)");
    expect(r.text).toContain(
      "Asha Rao declined TH/PRP/2627/0001 v2. Reason: The timing doesn't work for us.",
    );
    expect(r.text).not.toContain("Note:");
    expect(r.text).toContain("Open in admin: https://admin.example.test/documents/1");
    expect(r.text).not.toContain("[Placeholder]");
    expect(renderEmail("offer.declined.staff", { ...data, note: "Next year" }, opts).text).toContain(
      "us. Note: Next year.",
    );
    const ends = renderEmail("offer.declined.staff", { ...data, note: "Maybe next year?" }, opts).text;
    expect(ends).toContain("Note: Maybe next year?");
    expect(ends).not.toContain("year?.");
  });
  it("escapes the name and the note in the HTML", () => {
    const r = renderEmail("offer.declined.staff", { ...data, name: "<b>x</b>", note: "<i>y</i>" }, opts);
    expect(r.html).not.toContain("<b>x</b>");
    expect(r.html).not.toContain("<i>y</i>");
  });
});

describe("approval emails (07 section 8, 07-O: title and version, not the number)", () => {
  it("requested", () => {
    const r = renderEmail(
      "approval.requested",
      {
        requester_name: "Sam",
        request_reason: "a 15 % discount",
        title: "Website rebuild",
        version: "1",
        amount: "₹85,000.00",
        admin_url: "https://admin.example.test/approvals",
      },
      opts,
    );
    expect(r.subject).toBe("Approval needed: Website rebuild v1");
    expect(r.text).toContain("Sam asks you to approve a 15 % discount for Website rebuild v1 (₹85,000.00).");
    expect(r.text).toContain("Your decision applies to this version only.");
  });
  it("decided: the note line only when there is a note", () => {
    const base = {
      decision: "Approved",
      approver_name: "Rupak",
      title: "Website rebuild",
      version: "1",
      admin_url: "https://admin.example.test/documents/1",
    };
    const withNote = renderEmail("approval.decided", { ...base, decision_note: "Fine" }, opts);
    expect(withNote.subject).toBe("Approved: Website rebuild v1");
    expect(withNote.text).toContain("Rupak has Approved your request for Website rebuild v1.");
    expect(withNote.text).toContain("Note: Fine.");
    expect(renderEmail("approval.decided", { ...base, decision_note: "" }, opts).text).not.toContain("Note:");
  });
});

describe("toBase64 and the SES attachment", () => {
  afterEach(() => vi.restoreAllMocks());
  it("matches Buffer's base64 over a large buffer (the chunked fallback)", () => {
    const bytes = new Uint8Array(100_003).map((_, i) => (i * 31) % 251);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(toBase64(new Uint8Array(0))).toBe("");
  });
  it("uses the native method when the runtime has it", () => {
    const bytes = Object.assign(new Uint8Array([1, 2, 3]), { toBase64: () => "native" });
    expect(toBase64(bytes)).toBe("native");
  });
  it("sends Simple.Attachments with BASE64 content, and nothing when there are none", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json({ MessageId: "m" }));
    const base = {
      from: { name: "T", address: "hello@techaust.com" },
      to: "a@example.test",
      subject: "s",
      html: "<p>x</p>",
      text: "x",
    };
    const cfg = { accessKeyId: "AKIATEST", secretAccessKey: "secret", region: "ap-south-1" };
    await sesTransport(cfg).send({
      ...base,
      attachments: [
        { fileName: "p-v1.pdf", contentType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) },
      ],
    });
    const body = JSON.parse(await requestBody(spy, 0));
    expect(body.Content.Simple.Attachments).toEqual([
      {
        RawContent: Buffer.from("%PDF").toString("base64"),
        FileName: "p-v1.pdf",
        ContentType: "application/pdf",
        ContentDisposition: "ATTACHMENT",
        ContentTransferEncoding: "BASE64",
      },
    ]);
    await sesTransport(cfg).send(base);
    const plain = JSON.parse(await requestBody(spy, 1));
    expect(plain.Content.Simple.Attachments).toBeUndefined();
  });
});

async function requestBody(spy: { mock: { calls: unknown[][] } }, n: number): Promise<string> {
  const req = spy.mock.calls[n]?.[0];
  if (!(req instanceof Request)) throw new Error("no request");
  return req.text();
}
