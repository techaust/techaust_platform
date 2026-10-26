// M4.5 staff screens' pure rules and words [ADM-PROP-07, ADM-PROP-08, ADM-PROP-09, ADM-PROP-10]: 07-N word for word, the recipients the
// send dialog offers, the delivery words, the error sentences by code, and the email preview equal to what packages/email sends.
import { describe, expect, it } from "vitest";
import { offerSent } from "../../../../packages/email/src/offers.ts";
import { RequestError } from "../api.ts";
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
  shortSha,
} from "./offers.ts";
import { PLACEHOLDER_TAG } from "./projects.ts";

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
      expect(deliveryLabel(s).startsWith(PLACEHOLDER_TAG)).toBe(true);
    expect(OFFER_PENDING.sendAgain.startsWith(PLACEHOLDER_TAG)).toBe(true);
    expect(OFFER_PENDING.revoke.startsWith(PLACEHOLDER_TAG)).toBe(true);
    expect(missingText(["country", "gstin"])).toBe(
      `${PLACEHOLDER_TAG} Fill in the client's country and GSTIN first.`,
    );
    expect(
      offerErrorText(
        new RequestError(409, "instalment_failed", "x", null, [], [], [], { missing: ["state_code"] }),
      ),
    ).toBe(`${PLACEHOLDER_TAG} Fill in the client's state first.`);
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
        expect(sent.text).toContain(`${EMAIL_PREVIEW.facts.validUntil}: ${base.valid_until}`);
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
