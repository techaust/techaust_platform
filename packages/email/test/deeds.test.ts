// T11: the `deed.signed` email to the client's portal contacts, in 07-ZJ's words (lines 8 to 11; marked "[Placeholder]" until the lead approves them): the
// subject names the accepted version, the first paragraph says what was signed and where it is, the facts name the deed and the version, the button is
// "Open in the portal" with the link in the text twin, the closing line; from hello@; every value escaped. [RB-38(a), POR-05]
import { describe, expect, it } from "vitest";
import { APPROVED_07ZJ_EMAIL, DEED_SIGNED_KEYS, renderEmail, SENDERS } from "../src/index.ts";

const opts = { assetBase: "https://assets.example.test/brand/" };
const data = {
  first_name: "Asha",
  number: "TH/DA/2627/0001",
  offer_type: "proposal",
  offer_number: "TH/PRP/2627/0007",
  offer_version: "2",
  url: "https://portal.example.test/proposals/abc",
};
const mark = (s: string) => (APPROVED_07ZJ_EMAIL ? s : `[Placeholder] ${s}`);

describe("deed.signed [T11]", () => {
  it("says 07-ZJ's lines, names the deed and the accepted version, and links the portal page; from hello@", () => {
    const r = renderEmail("deed.signed", data, opts);
    expect(r.subject).toBe(mark("Signed deed of assignment: TH/PRP/2627/0007 v2"));
    expect(r.from).toEqual(SENDERS.hello);
    expect(r.text).toContain(
      mark(
        "Hi Asha, we've signed the deed that assigns the copyright in the work under proposal TH/PRP/2627/0007 v2 to you. It's on that proposal's page in the portal, ready to download.",
      ),
    );
    expect(r.text).toContain(`${mark("Deed number")}: TH/DA/2627/0001`);
    expect(r.text).toContain(`${mark("For")}: Proposal TH/PRP/2627/0007 v2`);
    expect(r.text).toContain("Open in the portal: https://portal.example.test/proposals/abc");
    expect(r.text).toContain(mark("Keep a copy with your records. Questions? Just reply to this email."));
    expect(r.html).toContain('href="https://portal.example.test/proposals/abc"');
    expect(DEED_SIGNED_KEYS).toEqual(Object.keys(data));
  });

  it("says estimate for an estimate, and never claims anything was reviewed by a lawyer", () => {
    const r = renderEmail(
      "deed.signed",
      { ...data, offer_type: "estimate", offer_number: "TH/EST/2627/0002" },
      opts,
    );
    expect(r.text).toContain("under estimate TH/EST/2627/0002 v2");
    expect(r.text).toContain("that estimate's page");
    expect(r.text).toContain("For: Estimate TH/EST/2627/0002 v2".replace("For", mark("For")));
    expect(r.text.toLowerCase()).not.toMatch(/lawyer|legal review|reviewed/);
  });

  it("escapes the values", () => {
    const r = renderEmail("deed.signed", { ...data, first_name: "<b>Asha</b>" }, opts);
    expect(r.html).not.toContain("<b>Asha</b>");
    expect(r.html).toContain("&lt;b&gt;Asha&lt;/b&gt;");
  });
});
