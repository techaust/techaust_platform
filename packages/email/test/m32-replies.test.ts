// M3.2 lead replies [ADM-LEAD-06]: the three starting texts of 07-I word for word, the system fields, the unfilled-gap rule, and the
// `lead.reply` email (hello@, plain text escaped in the HTML, no unsubscribe line).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fillReplyTemplate,
  hasUnfilledGap,
  REPLY_GAPS,
  REPLY_TEMPLATES,
  replyTemplateById,
} from "@techaust/core/reply-templates";
import { describe, expect, it } from "vitest";
import { renderEmail, SENDERS } from "../src/index.ts";

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
    // Words and punctuation are the document's; the line breaks (greeting, message, sign-off on their own lines) are the only difference.
    // The owner's layout (2026-10-25) also starts the message (the first paragraph after the greeting) with a capital letter.
    const oneLine = (x: string) =>
      x.replace(/\n\n(\p{L})/u, (_, c: string) => ` ${c.toLowerCase()}`).replace(/\s*\n+\s*/g, " ");
    expect(REPLY_TEMPLATES.map((t) => [t.label, t.subject, oneLine(t.body)])).toEqual(rows);
    for (const t of REPLY_TEMPLATES) {
      const parts = t.body.split("\n\n");
      expect(parts, t.id).toHaveLength(3);
      expect(parts[0]).toBe("Hi {{first_name}},");
      expect(parts[2]).toBe("Regards,\n{{sender_name}}, TecHaust Technologies");
    }
  });

  it("fills first_name, service_or_request, sender_name and ref, and leaves the gaps", () => {
    const t = replyTemplateById("a_few_questions_first");
    if (!t) throw new Error("missing template");
    const f = fillReplyTemplate(t, vars);
    expect(f.subject).toBe("Re: your enquiry (L-7K3Q9)");
    expect(f.body).toContain("Hi Asha,\n\nThanks for getting in touch about Tally invoicing.");
    expect(f.body).toContain("Regards,\nRupak Sarkar, TecHaust Technologies");
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
    expect(hasUnfilledGap("Fine", "a [x] gap")).toBe(false);
    expect(hasUnfilledGap("See point [1]", "[ ]")).toBe(false);
    expect(hasUnfilledGap("ok", "Hi: [your questions].")).toBe(true);
    expect(hasUnfilledGap("[Optional: a suggestion of where to look instead.]")).toBe(true);
    // every bracket the templates contain is a listed gap
    for (const t of REPLY_TEMPLATES)
      for (const m of `${t.subject} ${t.body}`.match(/\[[^\]]*\]/g) ?? []) expect(REPLY_GAPS, m).toContain(m);
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

  it("lays a filled template out as three paragraphs in the HTML, escaped, and keeps the line breaks in the text", () => {
    const t = replyTemplateById("book_a_call");
    if (!t) throw new Error("missing template");
    const body = fillReplyTemplate(t, { ...vars, first_name: "<i>Asha</i>" }).body;
    const x = renderEmail("lead.reply", { subject: "Re: x", body }, opts);
    expect(x.text).toContain("Hi <i>Asha</i>,\n\nThanks for telling us");
    expect(x.html).toContain("Hi &lt;i&gt;Asha&lt;/i&gt;,");
    expect(x.html).not.toContain("<i>Asha</i>");
    // the greeting, the message and the sign-off are separate blocks
    expect(x.html).not.toMatch(/Asha&lt;\/i&gt;,\s*thanks/);
    expect(x.html).not.toMatch(/IST\.\s*Regards/);
  });

  it("cannot be used to inject a header", () => {
    const x = renderEmail("lead.reply", { subject: "Hi\r\nBcc: x@y.z", body: "Hello" }, opts);
    expect(x.subject).not.toMatch(/[\r\n]/);
  });
});
