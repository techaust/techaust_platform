// T7 (08-C RB-37(a); Settled by the lead on the safest reading, 2026-10-30 (08-C RB-37)): the one redaction rule for the staff view and the stored redaction of
// a never-accepted offer. [ADM-CLI-05, ADM-PROP-05]
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ANONYMISED_CLIENT } from "../src/clients.ts";
import {
  MIN_REDACTION_LENGTH,
  type OfferText,
  offerScope,
  type RedactableRecipient,
  redactionNames,
  redactionValues,
  redactOffer,
  redactor,
  redactRecipient,
  viewRecipient,
} from "../src/redaction.ts";
import { wholeWordPattern } from "../src/text.ts";

const AC = ANONYMISED_CLIENT;
const contact = { id: "c-asha", name: "Asha Rao", email: "asha@example.test", phone: "+91 90000 11111" };

const individual: RedactableRecipient = {
  legalName: "Asha Rao",
  displayName: "Asha",
  gstin: "19ABCDE1234F1Z5",
  stateCode: "19",
  address: { line1: "1 Park Street", city: "Kolkata" },
  deliveryAddress: { line1: "2 Lake Road" },
  email: "asha@example.test",
  country: "IN",
  contactId: "c-asha",
  contactName: "Asha Rao",
  clientType: "individual",
  gstStatus: "registered",
};
const business: RedactableRecipient = {
  legalName: "Acme Studio Pvt Ltd",
  displayName: "Acme Studio",
  gstin: "19ABCDE1234F1Z5",
  stateCode: "19",
  address: { line1: "1 Park Street" },
  email: "Asha@Example.test",
  country: "IN",
  contactId: "c-asha",
  contactName: "Asha Rao",
  clientType: "business",
  gstStatus: "registered",
};

const offer = (recipient: RedactableRecipient | null, over: Partial<OfferText> = {}): OfferText => ({
  recipient,
  title: "Website for Asha Rao (Acme Studio)",
  decisionNote: null,
  sections: [
    { id: "s1", title: "Prepared for Asha Rao", bodyMd: "Accepted by Asha Rao <asha@example.test>" },
    { id: "s2", title: "Scope", bodyMd: "Ramp-up plan" },
  ],
  lines: [
    { id: "l1", description: "Pages for Acme Studio", detail: "Call +91 90000 11111" },
    { id: "l2", description: "Hosting", detail: null },
  ],
  schedule: [
    { id: "p1", label: "Advance from Asha", detail: null },
    { id: "p2", label: "Balance", detail: "On launch" },
  ],
  ...over,
});

describe("offerScope", () => {
  it("client for an individual's last live contact; contact when addressed by id, email (any case) or contact_id; else decliner", () => {
    const base = { recipient: business, documentContactId: null, contact };
    expect(offerScope({ ...base, lastLiveIndividual: true })).toBe("client");
    expect(offerScope({ ...base, lastLiveIndividual: false })).toBe("contact");
    const byEmail = { ...business, contactId: "other" };
    expect(offerScope({ ...base, recipient: byEmail, lastLiveIndividual: false })).toBe("contact");
    const other = { ...business, contactId: "other", email: "bo@example.test" };
    expect(offerScope({ ...base, recipient: other, lastLiveIndividual: false })).toBe("decliner");
    expect(
      offerScope({ ...base, recipient: other, documentContactId: "c-asha", lastLiveIndividual: false }),
    ).toBe("contact");
    expect(
      offerScope({ ...base, recipient: null, contact: { id: "x", email: null }, lastLiveIndividual: false }),
    ).toBe("decliner");
  });
});

describe("redactionValues", () => {
  it("client scope: the contact's live values, the recipient's names, email and GSTIN, and the live client's; longest first", () => {
    const v = redactionValues({
      recipient: individual,
      contact,
      client: { legalName: "Asha Rao", displayName: "Asha R", gstin: "19ABCDE1234F1Z5" },
      scope: "client",
    });
    expect(v).toEqual([
      "asha@example.test",
      "+91 90000 11111",
      "19ABCDE1234F1Z5",
      "Asha Rao",
      "Asha R",
      "Asha",
    ]);
    for (let i = 1; i < v.length; i++)
      expect((v[i - 1] as string).length).toBeGreaterThanOrEqual((v[i] as string).length);
  });
  it("contact scope: the contact's values and the recipient's contact name and email, never the business's", () => {
    const v = redactionValues({ recipient: business, contact, scope: "contact" });
    expect(v).toContain("Asha@Example.test");
    expect(v).toContain("Asha Rao");
    expect(v).not.toContain("Acme Studio");
    expect(v).not.toContain("19ABCDE1234F1Z5");
  });
  it("decliner scope: the contact's own values only", () => {
    const v = redactionValues({
      recipient: { ...business, contactName: "Bo Sen" },
      contact,
      scope: "decliner",
    });
    expect(v.sort()).toEqual(["+91 90000 11111", "Asha Rao", "asha@example.test"].sort());
  });
  it("skips blank and one-character values and repeats", () => {
    const v = redactionValues({
      recipient: null,
      contact: { id: "x", name: " A ", email: "  ", phone: null },
      scope: "client",
      client: { legalName: "Bo", displayName: "Bo", gstin: null },
    });
    expect(v).toEqual(["Bo"]);
    expect(MIN_REDACTION_LENGTH).toBe(2);
  });
});

describe("redactRecipient", () => {
  it("client: names become the label; GSTIN, addresses and email are removed (absent, never null); the rest is kept", () => {
    const r = redactRecipient(individual, "client");
    expect(r).toEqual({
      legalName: AC,
      displayName: AC,
      stateCode: "19",
      country: "IN",
      contactId: "c-asha",
      contactName: AC,
      clientType: "individual",
      gstStatus: "registered",
    });
    expect(r).not.toHaveProperty("gstin");
    expect(r).not.toHaveProperty("email");
    const bare = redactRecipient({ legalName: "Asha", country: "IN" }, "client");
    expect(bare).toEqual({ legalName: AC, country: "IN" });
  });
  it("contact: only the contact name and email go; the business stays", () => {
    const r = redactRecipient(business, "contact");
    expect(r.legalName).toBe("Acme Studio Pvt Ltd");
    expect(r.gstin).toBe("19ABCDE1234F1Z5");
    expect(r.address).toEqual({ line1: "1 Park Street" });
    expect(r.contactName).toBe(AC);
    expect(r).not.toHaveProperty("email");
    const noName = redactRecipient({ legalName: "L", country: "IN", email: "x@example.test" }, "contact");
    expect(noName).toEqual({ legalName: "L", country: "IN" });
  });
  it("contact at an INDIVIDUAL client: the person's values also leave the legal and display names; the address and GSTIN stay", () => {
    const values = redactionValues({ recipient: individual, contact, scope: "contact" });
    const r = redactRecipient(individual, "contact", { redact: redactor(values) });
    expect(r.legalName).toBe(AC);
    // the display name "Asha" is not one of the contact's values (the live client still holds it): it goes when the client is anonymised
    expect(r.displayName).toBe("Asha");
    expect(r.contactName).toBe(AC);
    expect(r).not.toHaveProperty("email");
    expect(r.gstin).toBe("19ABCDE1234F1Z5");
    expect(r.address).toEqual({ line1: "1 Park Street", city: "Kolkata" });
    // a name that only holds the person's name keeps the rest; no display name stays absent
    const family = redactRecipient(
      { legalName: "ASHA RAO and family", country: "IN", clientType: "individual" },
      "contact",
      { redact: redactor(["Asha Rao"]) },
    );
    expect(family).toEqual({ legalName: `${AC} and family`, country: "IN", clientType: "individual" });
    // the frozen client type decides unless the caller says otherwise (an older snapshot without it)
    const old = { legalName: "Asha Rao", country: "IN" };
    expect(redactRecipient(old, "contact", { redact: redactor(["Asha Rao"]) }).legalName).toBe("Asha Rao");
    expect(
      redactRecipient(old, "contact", { redact: redactor(["Asha Rao"]), individual: true }).legalName,
    ).toBe(AC);
    // without a redactor the names are left as they are
    expect(redactRecipient(individual, "contact").legalName).toBe("Asha Rao");
  });
  it("contact at a BUSINESS client: the business's names stay even when they hold the person's name", () => {
    const named = { ...business, legalName: "Asha Rao Studio LLP", displayName: "Asha Rao Studio" };
    const r = redactRecipient(named, "contact", { redact: redactor(["Asha Rao"]) });
    expect(r.legalName).toBe("Asha Rao Studio LLP");
    expect(r.displayName).toBe("Asha Rao Studio");
  });
  it("decliner: a copy, unchanged", () => {
    const r = redactRecipient(business, "decliner");
    expect(r).toEqual(business);
    expect(r).not.toBe(business);
  });
});

describe("redactOffer", () => {
  it("individual (client scope): every text and the whole recipient; only changed child rows; field names only", () => {
    const values = redactionValues({ recipient: individual, contact, scope: "client" });
    const out = redactOffer(offer(individual, { decisionNote: "Asha Rao: too dear" }), values, "client");
    expect(out.title).toBe(`Website for ${AC} (Acme Studio)`);
    expect(out.sections).toEqual([
      { id: "s1", title: `Prepared for ${AC}`, bodyMd: `Accepted by ${AC} <${AC}>` },
    ]);
    expect(out.lines).toEqual([{ id: "l1", description: "Pages for Acme Studio", detail: `Call ${AC}` }]);
    expect(out.schedule).toEqual([{ id: "p1", label: `Advance from ${AC}`, detail: null }]);
    expect(out.fields).toEqual([
      "recipient.legalName",
      "recipient.displayName",
      "recipient.gstin",
      "recipient.address",
      "recipient.deliveryAddress",
      "recipient.email",
      "recipient.contactName",
      "title",
      "sections.title",
      "sections.body_md",
      "lines.detail",
      "schedule.label",
      "decision_note",
      "envelope",
      "pdf",
    ]);
    const all = JSON.stringify(out);
    for (const v of values) expect(all).not.toContain(v);
  });

  it("business (contact scope): the business's name stays in the texts and the recipient", () => {
    const values = redactionValues({ recipient: business, contact, scope: "contact" });
    const out = redactOffer(offer(business), values, "contact");
    expect(out.recipient?.legalName).toBe("Acme Studio Pvt Ltd");
    expect(out.title).toBe(`Website for ${AC} (Acme Studio)`);
    expect(out.lines).toEqual([{ id: "l1", description: "Pages for Acme Studio", detail: `Call ${AC}` }]);
    expect(out.fields).toContain("recipient.contactName");
    expect(out.fields).not.toContain("recipient.legalName");
  });

  it("individual, contact scope (not the last live contact): the client's own names lose the person's name, its address and GSTIN stay", () => {
    const values = redactionValues({ recipient: individual, contact, scope: "contact" });
    const out = redactOffer(offer(individual), values, "contact");
    expect(out.recipient?.legalName).toBe(AC);
    expect(out.recipient?.displayName).toBe("Asha");
    expect(out.recipient?.gstin).toBe("19ABCDE1234F1Z5");
    expect(out.recipient?.address).toEqual({ line1: "1 Park Street", city: "Kolkata" });
    expect(out.fields).toContain("recipient.legalName");
    expect(out.fields).not.toContain("recipient.displayName");
    expect(out.fields).not.toContain("recipient.gstin");
    // the caller's own type wins over the frozen one, and its compiled redactor is used
    let calls = 0;
    const compiled = redactor(values);
    const counted = (t: string | null) => {
      calls++;
      return compiled(t);
    };
    const asBusiness = redactOffer(offer(individual), values, "contact", {
      individual: false,
      redact: counted,
    });
    expect(asBusiness.recipient?.legalName).toBe("Asha Rao");
    expect(calls).toBeGreaterThan(0);
  });

  it("ignores case: upper-case names and mixed-case emails go, in the texts and the recipient's names", () => {
    const values = redactionValues({ recipient: individual, contact, scope: "contact" });
    const out = redactOffer(
      offer(
        { ...individual, legalName: "ASHA RAO" },
        {
          title: "WEBSITE FOR ASHA RAO",
          sections: [
            { id: "s", title: "asha rao", bodyMd: "Mail Asha@Example.TEST or ASHA@EXAMPLE.TEST; राम stays" },
          ],
          lines: [],
          schedule: [],
        },
      ),
      values,
      "contact",
    );
    expect(out.recipient?.legalName).toBe(AC);
    expect(out.title).toBe(`WEBSITE FOR ${AC}`);
    expect(out.sections).toEqual([{ id: "s", title: AC, bodyMd: `Mail ${AC} or ${AC}; राम stays` }]);
    const indic = redactOffer(
      offer(null, { title: "राम and रामा", sections: [], lines: [], schedule: [] }),
      ["राम"],
      "decliner",
    );
    expect(indic.title).toBe(`${AC} and रामा`);
  });

  it("decliner only: the recipient is untouched, the texts lose the decliner's values and the note goes", () => {
    const toBo = { ...business, contactId: "c-bo", contactName: "Bo Sen", email: "bo@example.test" };
    const values = redactionValues({ recipient: toBo, contact, scope: "decliner" });
    const out = redactOffer(offer(toBo, { decisionNote: "no" }), values, "decliner");
    expect(out.recipient).toEqual(toBo);
    expect(out.fields).not.toContain("recipient.contactName");
    expect(out.fields).toContain("decision_note");
    expect(out.sections[0]?.bodyMd).toBe(`Accepted by ${AC} <${AC}>`);
  });

  it("whole words only (Ram vs Ramp-up), Indic combining marks belong to the word", () => {
    const values = ["Ram", "राम"];
    const out = redactOffer(
      offer(null, {
        title: "Ramp-up for Ram",
        sections: [{ id: "s", title: "रामा and राम", bodyMd: null }],
        lines: [],
        schedule: [],
      }),
      values,
      "decliner",
    );
    expect(out.title).toBe(`Ramp-up for ${AC}`);
    expect(out.sections[0]?.title).toBe(`रामा and ${AC}`);
    expect(out.recipient).toBeNull();
  });

  it("longest first: a value holding another is replaced whole", () => {
    const out = redactOffer(offer(null, { title: "Asha Rao and Asha" }), ["Asha", "Asha Rao"], "decliner");
    expect(out.title).toBe(`${AC} and ${AC}`);
  });

  it("is idempotent: redacting the result again changes nothing", () => {
    const values = redactionValues({ recipient: individual, contact, scope: "client" });
    const once = redactOffer(offer(individual, { decisionNote: "x" }), values, "client");
    const merged = offer(once.recipient, {
      title: once.title,
      sections: offer(null).sections.map((s) => once.sections.find((x) => x.id === s.id) ?? s),
      lines: offer(null).lines.map((l) => once.lines.find((x) => x.id === l.id) ?? l),
      schedule: offer(null).schedule.map((p) => once.schedule.find((x) => x.id === p.id) ?? p),
    });
    const twice = redactOffer(merged, values, "client");
    expect(twice.recipient).toEqual(once.recipient);
    expect(twice.title).toBe(once.title);
    expect(twice.sections).toEqual([]);
    expect(twice.lines).toEqual([]);
    expect(twice.schedule).toEqual([]);
    expect(twice.fields).toEqual(["envelope", "pdf"]);
  });

  it("property: no value survives as a whole word, in any case, in any redacted text", () => {
    // letters outside "Anonymised client" in either case, so the label itself can never be a value
    const word = fc.stringMatching(/^[bfghjkpqruvwxz]{2,8}$/);
    // a text part: a word in any mix of cases, or a separator
    const part = fc.oneof(
      fc
        .tuple(word, fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }))
        .map(([w, up]) => [...w].map((ch, i) => (up[i] ? ch.toUpperCase() : ch)).join("")),
      fc.constantFrom(" ", ", ", "-", ". ", "'s "),
    );
    fc.assert(
      fc.property(
        fc.array(word, { minLength: 1, maxLength: 4 }),
        fc.array(part, { maxLength: 30 }),
        (values, parts) => {
          const text = parts.join("");
          const out = redactOffer(
            offer(null, {
              title: text,
              sections: [{ id: "s", title: text, bodyMd: text }],
              lines: [],
              schedule: [],
            }),
            values,
            "decliner",
          );
          for (const t of [out.title, out.sections[0]?.title ?? text, out.sections[0]?.bodyMd ?? text])
            expect(wholeWordPattern(values, { ignoreCase: true }).test(t ?? "")).toBe(false);
        },
      ),
    );
  });
});

describe("the view helpers (moved from the admin Worker; one rule)", () => {
  it("viewRecipient replaces the personal fields and keeps the rest", () => {
    expect(viewRecipient(business, false, false)).toBe(business);
    const contactOnly = viewRecipient(business, false, true);
    expect(contactOnly).toMatchObject({
      legalName: "Acme Studio Pvt Ltd",
      contactName: AC,
      email: null,
      anonymised: true,
    });
    const gone = viewRecipient(business, true, false);
    expect(gone).toMatchObject({ legalName: AC, displayName: AC, gstin: null, address: null, email: null });
  });
  it("redactionNames skips one-character values like the stored redaction", () => {
    expect(redactionNames({ legalName: "A", displayName: "Bo", country: "IN" }, true, false)).toEqual(["Bo"]);
    expect(redactor([])("x")).toBe("x");
    expect(redactor(["Bo"])(null)).toBeNull();
  });
  it("the view's redactor ignores case too (one rule with the stored redaction)", () => {
    const redact = redactor(redactionNames(business, false, true));
    expect(redact("ASHA RAO wrote to asha@example.test")).toBe(`${AC} wrote to ${AC}`);
  });
});
