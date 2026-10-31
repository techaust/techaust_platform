// M4.5 staff screens' pure rules and words [ADM-PROP-07, ADM-PROP-08, ADM-PROP-09, ADM-PROP-10]: 07-N word for word, the recipients the
// send dialog offers, the delivery words, the error sentences by code, and the email preview equal to what packages/email sends.
import { describe, expect, it } from "vitest";
import { offerSent } from "../../../../packages/email/src/offers.ts";
import { RequestError } from "../api.ts";
import { DOC_ERRORS } from "./documents.ts";

/** The mark a line not yet approved would carry (none should). */
const PLACEHOLDER_TAG = "[Placeholder]";

import { reasonText } from "./offer-words.ts";
import {
  canResend,
  deliveryLabel,
  EMAIL_PREVIEW,
  MAX_RECIPIENTS,
  missingText,
  OFFER_COPY,
  OFFER_ERRORS,
  OFFER_PENDING,
  offerErrorText,
  pdfNote,
  recipientChoices,
  STAFF_REPLY_COPY,
  shortSha,
  staffReplyText,
} from "./offers.ts";

const contact = (
  id: string,
  o: Partial<{ portalAccess: boolean; isBilling: boolean; isPrimary: boolean; anonymisedAt: number | null }>,
) => ({
  id,
  portalAccess: true,
  isBilling: false,
  isPrimary: false,
  anonymisedAt: null,
  ...o,
});

describe("07-N word for word", () => {
  it("send dialog, delivery, start project (§6)", () => {
    expect(OFFER_COPY.sendTitle("TH/PRP/2627/0003", 2)).toBe("Send TH/PRP/2627/0003 v2");
    expect(OFFER_COPY.sendToHint).toBe("Contacts with portal access. Each gets their own link.");
    expect(OFFER_COPY.attachHint).toBe("Off by default: the email links to the portal.");
    expect(OFFER_COPY.noPortal).toBe("Has no portal access yet");
    expect(OFFER_COPY.sentTo(3)).toBe("Sent to 3 contacts.");
    expect(OFFER_COPY.deliveryNote).toBe("The email goes once the PDF is ready, usually within a minute.");
    expect(OFFER_COPY.startBody).toBe(
      "This creates the project and its milestones from the payment schedule, and a draft of the first instalment for you to issue.",
    );
    expect(OFFER_COPY.started("PRJ-0007")).toBe("Project PRJ-0007 started.");
    expect(deliveryLabel("waiting_pdf")).toBe("Waiting for the PDF");
    expect(deliveryLabel("queued")).toBe("Queued");
    expect(deliveryLabel("sent")).toBe("Sent");
    expect(deliveryLabel("failed")).toBe("Failed");
  });

  it("errors by code (§7)", () => {
    expect(OFFER_ERRORS.recipients_too_many).toBe(`Choose up to ${MAX_RECIPIENTS} contacts.`);
    expect(offerErrorText(new RequestError(409, "recipient_invalid", "x"))).toBe(
      "This contact can't receive it: no portal access or no email address.",
    );
    expect(offerErrorText(new RequestError(409, "no_advance_step", "x"))).toBe(
      "The payment schedule has no first instalment to bill.",
    );
    // An M4.3 code still reads in 07-O's words.
    expect(offerErrorText(new RequestError(409, "stale_version", "x"))).toBe(
      "Someone else saved this at the same moment. Reload and try again.",
    );
    // FX-3 round 2, item 11 re-check: the send dialog's 409 `series_full` (document-send.ts) reads the 07-Y line through `docErrorText`
    expect(
      offerErrorText(
        new RequestError(409, "series_full", "This numbering series has no numbers left this year"),
      ),
    ).toBe(DOC_ERRORS.series_full);
  });

  it("the client's decline reasons (§3)", () => {
    expect(reasonText("timing")).toBe("The timing doesn't work for us");
    expect(reasonText("other")).toBe("Other");
    expect(reasonText("made_up")).toBe("made_up");
    expect(reasonText(null)).toBe("");
  });
});

describe("lines 07-N doesn't have carry a visible tag", () => {
  it("delivery states, actions and the missing-field sentence", () => {
    for (const s of ["sending", "delivered", "bounced", "complained", "skipped", "not_sent"] as const)
      expect(deliveryLabel(s).includes(PLACEHOLDER_TAG)).toBe(false);
    expect(OFFER_PENDING.sendAgain.includes(PLACEHOLDER_TAG)).toBe(false);
    expect(OFFER_PENDING.revoke.includes(PLACEHOLDER_TAG)).toBe(false);
    expect(missingText(["country", "gstin"])).toBe(`Fill in the client's country and GSTIN first.`);
    expect(
      offerErrorText(
        new RequestError(409, "instalment_failed", "x", null, [], [], [], { missing: ["state_code"] }),
      ),
    ).toBe(`Fill in the client's state first.`);
  });
});

describe("the send dialog's recipients", () => {
  it("billing contacts with access are ticked; no access and anonymised contacts can't be", () => {
    const r = recipientChoices([
      contact("a", { isBilling: true }),
      contact("b", { portalAccess: false, isBilling: true }),
      contact("c", {}),
      contact("d", { anonymisedAt: 1 }),
    ]);
    expect(r.choices.map((c) => c.id)).toEqual(["a", "c", "b"]);
    expect(r.ticked).toEqual(["a"]);
  });
  it("without a billing contact the primary one is ticked; never more than five", () => {
    expect(recipientChoices([contact("a", {}), contact("p", { isPrimary: true })]).ticked).toEqual(["p"]);
    const many = Array.from({ length: 7 }, (_, i) => contact(`b${i}`, { isBilling: true }));
    expect(recipientChoices(many).ticked).toHaveLength(MAX_RECIPIENTS);
  });
  it("sweep finding 4: the draft's own contact is the one ticked when it has portal access", () => {
    const list = [contact("a", { isBilling: true }), contact("t", {}), contact("n", { portalAccess: false })];
    expect(recipientChoices(list, "t").ticked).toEqual(["t"]);
    // Without access (or unknown), the usual choice stands.
    expect(recipientChoices(list, "n").ticked).toEqual(["a"]);
    expect(recipientChoices(list, "gone").ticked).toEqual(["a"]);
    expect(recipientChoices(list, null).ticked).toEqual(["a"]);
    expect(recipientChoices(list, "t").choices.map((c) => c.id)).toEqual(["a", "t", "n"]);
  });
  it("only the latest sent version, still open, can be sent again", () => {
    expect(canResend({ status: "sent", validUntil: "2026-11-10" }, "2026-11-10", true)).toBe(true);
    expect(canResend({ status: "viewed", validUntil: "2026-11-10" }, "2026-11-11", true)).toBe(false);
    expect(canResend({ status: "accepted", validUntil: "2026-11-10" }, "2026-11-01", true)).toBe(false);
    expect(canResend({ status: "sent", validUntil: "2026-11-10" }, "2026-11-01", false)).toBe(false);
  });
  it("fingerprints are shown by their first 12 characters", () => {
    expect(shortSha("3f9a1c0b7e24d5a6")).toBe("3f9a1c0b7e24");
  });
});

describe("the email preview is the email packages/email sends", () => {
  const base = {
    first_name: "Asha",
    title: "Website rebuild",
    number: "TH/PRP/2627/0001",
    version: "2",
    valid_until: "30 Nov 2026",
    total: "₹1,00,000.00",
    url: "https://portal.example.test/o#t=abc",
    sender_name: "Sample",
  };
  for (const kind of ["proposal", "estimate"] as const) {
    for (const attached of ["0", "1"]) {
      it(`${kind}, PDF ${attached === "1" ? "attached" : "linked"}`, () => {
        const sent = offerSent({ ...base, kind, attached }, { assetBase: "https://a.example.test/" });
        expect(sent.subject).toBe(EMAIL_PREVIEW.subject(kind, base.title, base.number, 2));
        expect(sent.text).toContain(EMAIL_PREVIEW.lead(kind, "Asha", base.valid_until));
        expect(sent.text).toContain(`${EMAIL_PREVIEW.facts.number}: ${base.number} v2`);
        expect(sent.text).toContain(`${EMAIL_PREVIEW.facts.total}: ${base.total}`);
        expect(sent.text).toContain(
          `${EMAIL_PREVIEW.facts.validUntil}: ${EMAIL_PREVIEW.validUntilValue(base.valid_until)}`,
        );
        // 07-ZE line 3 (T6): version 2's paragraph, right after the lead sentence
        const replaces = EMAIL_PREVIEW.replaces(2);
        expect(replaces).not.toBeNull();
        expect(sent.text).toContain(`${EMAIL_PREVIEW.lead(kind, "Asha", base.valid_until)}\n\n${replaces}`);
        const one = offerSent(
          { ...base, kind, attached, version: "1" },
          { assetBase: "https://a.example.test/" },
        );
        expect(EMAIL_PREVIEW.replaces(1)).toBeNull();
        expect(one.text).not.toContain("This is version");
        expect(sent.text).toContain(`${EMAIL_PREVIEW.button}: ${base.url}`);
        expect(sent.text).toContain(attached === "1" ? EMAIL_PREVIEW.attached : EMAIL_PREVIEW.linked);
        expect(sent.text).toContain(EMAIL_PREVIEW.questions);
      });
    }
  }
  // Review fix 2: the switch starts from the document read's `attachPdfDefault` (every sending role gets it, Sales included) and is
  // always sent, so the preview's PDF line is the line of the email that goes, whatever the client's setting.
  for (const attachPdfDefault of [false, true]) {
    it(`the untouched switch (client setting ${attachPdfDefault ? "on" : "off"}) previews the line that is sent`, () => {
      const sent = offerSent(
        { ...base, kind: "proposal", attached: attachPdfDefault ? "1" : "0" },
        { assetBase: "https://a.example.test/" },
      );
      expect(sent.text).toContain(pdfNote(attachPdfDefault));
      expect(sent.text).not.toContain(pdfNote(!attachPdfDefault));
    });
  }
});

describe("07-ZE in the preview (T6): (IST) on the validity date, the version line, the closing line", () => {
  it("are 07-ZE's words", () => {
    expect(EMAIL_PREVIEW.lead("proposal", "Asha", "30 Nov 2026")).toBe(
      "Hi Asha, your proposal is ready, with the price and payment schedule. It's valid until 30 Nov 2026 (IST).",
    );
    expect(EMAIL_PREVIEW.validUntilValue("30 Nov 2026")).toBe("30 Nov 2026 (IST)");
    // a draft without validity days: the lead prints "…" with no lone "(IST)" (review finding 2)
    expect(EMAIL_PREVIEW.lead("estimate", "Asha", null)).toBe(
      "Hi Asha, your estimate is ready. It covers the line items, price and payment terms, and it's valid until ….",
    );
    expect(EMAIL_PREVIEW.replaces(3)).toBe(
      "This is version 3. It replaces version 2 and any earlier version, which can no longer be accepted.",
    );
    expect(EMAIL_PREVIEW.questions).toBe(
      "Questions? Just reply to this email. To accept, use Review and accept: a reply by email isn't an acceptance.",
    );
  });
});

describe("the staff reply to an acceptance by email (07-ZE line 5; owner's Q2: A, 2026-10-31)", () => {
  const doc = {
    type: "proposal" as const,
    status: "sent" as const,
    number: "TH/PRP/2627/0001",
    version: 2,
    client: {
      id: "c1",
      code: "C0001",
      name: "Sample client",
      type: "business",
      gstStatus: "registered",
      stateCode: "19",
      country: "IN",
      currency: "INR" as const,
      anonymised: false,
    },
    contact: { id: "k1", name: "  Asha  Rao ", email: "asha@example.test", anonymised: false },
  };
  const filled = (origin: string) =>
    `Thank you, Asha. To accept TH/PRP/2627/0001 v2, please use the Review and accept button in our email, or sign in at ${origin}, and click Accept there. As our terms say, a reply by email isn't an acceptance, so we haven't treated it as one. If it has expired or we've sent a newer version, tell us and we'll send you the current one.`;

  it("the box's labels are the owner's words, with no placeholder mark", () => {
    expect(STAFF_REPLY_COPY).toEqual({ heading: "Client accepted by email?", copy: "Copy reply" });
    expect(JSON.stringify(STAFF_REPLY_COPY)).not.toContain(PLACEHOLDER_TAG);
  });

  it("fills 07-ZE line 5 with the first name, the number, the version and the portal of this build", () => {
    // the test build's constant is the local portal (vitest.config.ts, from wrangler.jsonc's top-level vars.PORTAL_ORIGIN)
    expect(staffReplyText(doc)).toBe(filled("http://localhost:5174"));
    expect(staffReplyText(doc, "https://portal.techaust.com")).toBe(filled("https://portal.techaust.com"));
    expect(staffReplyText({ ...doc, type: "estimate", status: "viewed", version: 1 })).toContain(
      "To accept TH/PRP/2627/0001 v1, please",
    );
    // past its last day: the reply's last sentence covers it
    expect(staffReplyText({ ...doc, status: "expired" })).toBe(filled("http://localhost:5174"));
  });

  it("is null where the box isn't shown", () => {
    for (const status of ["draft", "accepted", "rejected", "revised"] as const)
      expect(staffReplyText({ ...doc, status })).toBeNull();
    expect(staffReplyText({ ...doc, number: null })).toBeNull();
    expect(staffReplyText({ ...doc, contact: null })).toBeNull();
    expect(staffReplyText({ ...doc, contact: { ...doc.contact, anonymised: true } })).toBeNull();
    expect(staffReplyText({ ...doc, client: { ...doc.client, anonymised: true } })).toBeNull();
    expect(staffReplyText({ ...doc, contact: { ...doc.contact, name: "   " } })).toBeNull();
    expect(staffReplyText(doc, "")).toBeNull();
    // an invoice-family type never gets it (the shape is shared with nothing else, but the guard is cheap)
    expect(staffReplyText({ ...doc, type: "invoice" as unknown as "proposal" })).toBeNull();
  });
});
