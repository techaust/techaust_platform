// T11: the `deed.signed` email to the client's portal contacts, a builder's placeholder until 07-ZJ is approved: every line is marked `[Placeholder]`, the values
// are escaped, the link is the button and the text twin carries it. The designer replaces the words and these expectations. [RB-38(a), POR-05]
import { describe, expect, it } from "vitest";
import { DEED_SIGNED_KEYS, renderEmail, SENDERS } from "../src/index.ts";

const opts = { assetBase: "https://assets.example.test/brand/" };
const data = {
  first_name: "Asha",
  number: "TH/DA/2627/0001",
  offer_type: "proposal",
  offer_number: "TH/PRP/2627/0007",
  offer_version: "2",
  url: "https://portal.example.test/proposals/abc",
};

describe("deed.signed (placeholder) [T11]", () => {
  it("marks every line [Placeholder], names the deed and the offer, and links the portal page; from hello@", () => {
    const r = renderEmail("deed.signed", data, opts);
    expect(r.subject).toBe("[Placeholder] deed.signed TH/DA/2627/0001");
    expect(r.from).toEqual(SENDERS.hello);
    expect(r.text).toContain("[Placeholder] deed.signed: TH/DA/2627/0001, proposal TH/PRP/2627/0007 v2");
    expect(r.text).toContain("https://portal.example.test/proposals/abc");
    expect(r.html).toContain('href="https://portal.example.test/proposals/abc"');
    expect(DEED_SIGNED_KEYS).toEqual(Object.keys(data));
  });

  it("escapes the values", () => {
    const r = renderEmail("deed.signed", { ...data, first_name: "<b>Asha</b>" }, opts);
    expect(r.html).not.toContain("<b>Asha</b>");
    expect(r.html).toContain("&lt;b&gt;Asha&lt;/b&gt;");
  });
});
