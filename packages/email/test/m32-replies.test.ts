// M3.2 lead replies [ADM-LEAD-06]: the three starting texts of 07-I word for word, the system fields, the unfilled-gap rule, and the
// `lead.reply` email (hello@, plain text escaped in the HTML, no unsubscribe line).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderEmail, SENDERS } from "../src/index.ts";
import {
  fillReplyTemplate,
  hasUnfilledGap,
  REPLY_TEMPLATES,
  replyTemplateById,
} from "../src/reply-templates.ts";

const vars = {
  first_name: "Asha",
  service_or_request: "Tally invoicing",
  sender_name: "Rupak Sarkar",
  ref: "L-7K3Q9",
};

describe("07-I reply templates", () => {
  // The owner-approved table is the source: every cell of the file must equal what is registered (quotes stripped).
  const doc = readFileSync(
    join(import.meta.dirname, "../../../docs/07-content-appendix/I-m3.2-lead-replies.md"),
    "utf8",
  );
  const rows = doc
    .split("\n")
    .filter((l) => /^\| (Book a call|A few questions first|Not the right fit) \|/.test(l))
    .map((l) =>
      l.split(" | ").map((c) =>
        c
          .replace(/^\|\s*/, "")
          .replace(/\s*\|$/, "")
          .replace(/^"|"$/g, ""),
      ),
    );

  it("registers exactly the three approved templates, word for word", () => {
    expect(rows).toHaveLength(3);
    expect(REPLY_TEMPLATES.map((t) => [t.label, t.subject, t.body])).toEqual(rows);
  });

  it("fills first_name, service_or_request, sender_name and ref, and leaves the gaps", () => {
    const t = replyTemplateById("a_few_questions_first");
    if (!t) throw new Error("missing template");
    const f = fillReplyTemplate(t, vars);
    expect(f.subject).toBe("Re: your enquiry (L-7K3Q9)");
    expect(f.body).toContain("Hi Asha, thanks for getting in touch about Tally invoicing.");
    expect(f.body).toContain("Regards, Rupak Sarkar, TecHaust Technologies");
    expect(f.body).toContain("[your questions]");
    expect(f.body).not.toContain("{{");
  });

  it("a gap left in the subject or the body is detected; filled text is not", () => {
    for (const t of REPLY_TEMPLATES.filter((x) => x.id !== "book_a_call"))
      expect(hasUnfilledGap(fillReplyTemplate(t, vars).body)).toBe(true);
    const book = replyTemplateById("book_a_call");
    if (!book) throw new Error("missing template");
    expect(hasUnfilledGap(fillReplyTemplate(book, vars).body)).toBe(false);
    expect(hasUnfilledGap("Fine", "no gap here (really)")).toBe(false);
    expect(hasUnfilledGap("Fine", "a [x] gap")).toBe(true);
    expect(hasUnfilledGap("[ ]")).toBe(true);
  });
});

describe("lead.reply email", () => {
  const opts = { assetBase: "https://assets.example.test/brand/" };
  const r = renderEmail(
    "lead.reply",
    { subject: "Re: your enquiry (L-7K3Q9)", body: "Hi <b>Asha</b>,\n\nA second paragraph & more." },
    opts,
  );

  it("is sent from hello@ with Reply-To hello@", () => {
    expect(r.from).toEqual(SENDERS.hello);
    expect(r.replyTo).toBe(SENDERS.hello.address);
    expect(r.subject).toBe("Re: your enquiry (L-7K3Q9)");
  });

  it("sends the text as typed in plain text and escapes it in the HTML, with the 07 section 8 footer and no unsubscribe line", () => {
    expect(r.text).toContain("Hi <b>Asha</b>,\n\nA second paragraph & more.");
    expect(r.html).not.toContain("<b>Asha</b>");
    expect(r.html).toContain("&lt;b&gt;Asha&lt;/b&gt;");
    expect(r.text).toContain("TecHaust Technologies · Balurghat, West Bengal, India · contact@techaust.com");
    expect(`${r.text}${r.html}`).not.toMatch(/unsubscribe|Why you're receiving this/i);
  });

  it("cannot be used to inject a header", () => {
    const x = renderEmail("lead.reply", { subject: "Hi\r\nBcc: x@y.z", body: "Hello" }, opts);
    expect(x.subject).not.toMatch(/[\r\n]/);
  });
});
