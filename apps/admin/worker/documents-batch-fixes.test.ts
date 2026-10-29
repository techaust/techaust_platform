// Batch review fixes: hidden sections and the placeholder block (H3), the Acceptance text following the draft's contact (Q14) [ADM-PROP-05, ADM-CAT-03].
import { beforeAll, describe, expect, it } from "vitest";
import { putPaymentTerms } from "./test-catalogue.ts";
import { insert, mkContact } from "./test-clients.ts";
import { call, sessionFor } from "./test-helpers.ts";
import { getDoc, type J, json, mkDraft, mkTerms, patchDoc, sendDoc } from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
});

/** The draft's sections as the save takes them, with `change` applied to each and `extra` appended. */
const sectionsOf = (v: J, change: (s: J) => J, extra: J[] = []) => [
  ...v.sections.map((s: J) => {
    const c = change({ id: s.id, kind: s.kind, title: s.title, bodyMd: s.bodyMd, hidden: s.hidden });
    return c;
  }),
  ...extra,
];

describe("a hidden section's placeholders block nothing [ADM-CAT-03, ADM-PROP-05]", () => {
  it("visible: the blocker names it; hidden: no blocker and the send goes", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const v = await getDoc(o, made.id);
    const shown = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: v.updatedAt,
        sections: sectionsOf(v, (s) => s, [
          { kind: "scope", title: "Scope", bodyMd: "Before {{service.exclusions}} after", hidden: false },
        ]),
      }),
    );
    const withIt = await getDoc(o, made.id);
    expect(withIt.unresolved).toContain("service.exclusions");
    expect(withIt.canSend).toBe(false);

    const hid = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: shown.updatedAt,
        sections: sectionsOf(withIt, (s) => (s.kind === "scope" ? { ...s, hidden: true } : s)),
      }),
    );
    const after = await getDoc(o, made.id);
    expect(after.unresolved).not.toContain("service.exclusions");
    expect(after.blockers.map((b: J) => b.code)).not.toContain("unresolved_placeholders");
    const sent = await sendDoc(o, made.id, hid.updatedAt);
    expect(sent.status).toBe(200);
  });
});

describe("the Acceptance text follows the draft's contact [Q14]", () => {
  it("a changed contact renames the name in Acceptance; other text is left alone", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const second = await mkContact(made.clientId, { name: "Bina Das" });
    const v = await getDoc(o, made.id);
    const set = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: v.updatedAt,
        sections: sectionsOf(v, (s) =>
          s.kind === "acceptance"
            ? { ...s, bodyMd: "Prepared for Asha Rao. Asha Rao is named twice, Asha Raos once." }
            : s,
        ),
      }),
    );
    const res = await patchDoc(o, made.id, {
      expectedUpdatedAt: set.updatedAt,
      fields: { contactId: second.id },
    });
    expect(res.status).toBe(200);
    const doc = await getDoc(o, made.id);
    const text = (k: string) => doc.sections.find((s: J) => s.kind === k)?.bodyMd;
    expect(text("acceptance")).toBe("Prepared for Bina Das. Bina Das is named twice, Asha Raos once.");
    expect(doc.contact.id).toBe(second.id);
    // the server wrote the Acceptance text, so the answer carries it (review round 2, finding 5): the screen applies it without a re-read
    const acceptance = doc.sections.find((s: J) => s.kind === "acceptance");
    expect((await json(res)).sectionsChanged).toEqual([
      { id: acceptance.id, title: acceptance.title, bodyMd: acceptance.bodyMd, hidden: acceptance.hidden },
    ]);
  });
});

describe("round 3: the contact rename [Q14]", () => {
  /** Sets the Acceptance text of a draft, then changes the contact in a second save. */
  async function acceptanceAfter(text: string, nextName: string | null) {
    const o = await owner();
    const made = await mkDraft(o);
    const next = nextName === null ? null : await mkContact(made.clientId, { name: nextName });
    const v = await getDoc(o, made.id);
    const set = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: v.updatedAt,
        sections: sectionsOf(v, (s) => (s.kind === "acceptance" ? { ...s, bodyMd: text } : s)),
      }),
    );
    const res = await patchDoc(o, made.id, {
      expectedUpdatedAt: set.updatedAt,
      fields: { contactId: next ? next.id : null },
    });
    return { o, made, res, doc: await getDoc(o, made.id) };
  }
  const acceptance = (d: J) => d.sections.find((s: J) => s.kind === "acceptance")?.bodyMd;

  it("clearing the contact puts {{client.contact}} back and blocks the send", async () => {
    const { o, made, res, doc } = await acceptanceAfter("Prepared for Asha Rao.", null);
    expect(res.status).toBe(200);
    expect(acceptance(doc)).toBe("Prepared for {{client.contact}}.");
    expect(doc.unresolved).toContain("client.contact");
    expect(doc.canSend).toBe(false);
    expect((await sendDoc(o, made.id, doc.updatedAt)).status).toBeGreaterThanOrEqual(400);
  });

  it("a placeholder with spaces inside the braces is replaced by the new name too", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const v = await getDoc(o, made.id);
    // Clear the contact first (the text then holds the unspaced token), then write the spaced form and set a contact.
    const cleared = await json(
      await patchDoc(o, made.id, { expectedUpdatedAt: v.updatedAt, fields: { contactId: null } }),
    );
    const withSpaces = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: cleared.updatedAt,
        sections: sectionsOf(v, (s) =>
          s.kind === "acceptance" ? { ...s, bodyMd: "For {{ client.contact }} and {{client.contact}}." } : s,
        ),
      }),
    );
    const second = await mkContact(made.clientId, { name: "Bina Das" });
    expect(
      (
        await patchDoc(o, made.id, {
          expectedUpdatedAt: withSpaces.updatedAt,
          fields: { contactId: second.id },
        })
      ).status,
    ).toBe(200);
    expect(acceptance(await getDoc(o, made.id))).toBe("For Bina Das and Bina Das.");
  });

  it("a Bengali name is renamed as a whole word, and a longer word that starts with it is left alone", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const first = await mkContact(made.clientId, { name: "অনিন্দিতা" });
    const second = await mkContact(made.clientId, { name: "Bina Das" });
    const v = await getDoc(o, made.id);
    const a = await json(
      await patchDoc(o, made.id, { expectedUpdatedAt: v.updatedAt, fields: { contactId: first.id } }),
    );
    const b = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: a.updatedAt,
        sections: sectionsOf(v, (s) =>
          s.kind === "acceptance" ? { ...s, bodyMd: "অনিন্দিতা এবং অনিন্দিতার বাড়ি" } : s,
        ),
      }),
    );
    expect(
      (await patchDoc(o, made.id, { expectedUpdatedAt: b.updatedAt, fields: { contactId: second.id } }))
        .status,
    ).toBe(200);
    expect(acceptance(await getDoc(o, made.id))).toBe("Bina Das এবং অনিন্দিতার বাড়ি");
  });

  it("a Hindi name ending in a vowel sign is not matched inside a longer word", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const first = await mkContact(made.clientId, { name: "सीता" });
    const second = await mkContact(made.clientId, { name: "Bina Das" });
    const v = await getDoc(o, made.id);
    const a = await json(
      await patchDoc(o, made.id, { expectedUpdatedAt: v.updatedAt, fields: { contactId: first.id } }),
    );
    const b = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: a.updatedAt,
        sections: sectionsOf(v, (s) => (s.kind === "acceptance" ? { ...s, bodyMd: "सीता और सीताजी" } : s)),
      }),
    );
    expect(
      (await patchDoc(o, made.id, { expectedUpdatedAt: b.updatedAt, fields: { contactId: second.id } }))
        .status,
    ).toBe(200);
    expect(acceptance(await getDoc(o, made.id))).toBe("Bina Das और सीताजी");
  });

  it("a longer name that pushes the text over the limit is a 400 on the save, and nothing changes", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const first = await mkContact(made.clientId, { name: "Al" });
    const second = await mkContact(made.clientId, { name: "B".repeat(200) });
    const v = await getDoc(o, made.id);
    const a = await json(
      await patchDoc(o, made.id, { expectedUpdatedAt: v.updatedAt, fields: { contactId: first.id } }),
    );
    // 1,990 mentions of the 2-character name are 5,969 characters (under the 6,000 limit); 200-character names would be far over it.
    const text = "Al ".repeat(1_990).trim();
    const filled = await patchDoc(o, made.id, {
      expectedUpdatedAt: a.updatedAt,
      sections: sectionsOf(v, (s) => (s.kind === "acceptance" ? { ...s, bodyMd: text } : s)),
    });
    expect(filled.status).toBe(200);
    const cur = await getDoc(o, made.id);
    const res = await patchDoc(o, made.id, {
      expectedUpdatedAt: cur.updatedAt,
      fields: { contactId: second.id },
    });
    expect(res.status).toBe(400);
    const after = await getDoc(o, made.id);
    expect(after.contact.id).toBe(first.id);
    expect(acceptance(after)).toBe(text);
  });
});

describe("round 2: the pinned terms text on the read, and the dashboard's document number [ADM-PROP-05, ADM-DASH-01]", () => {
  it("the read of a SENT version returns the pinned frozen text to every role that can read it; a draft's read and the save answer carry none", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const draft = await getDoc(o, made.id);
    expect(draft.terms).toMatchObject({ id: expect.any(String), version: expect.any(Number), bodyMd: null });
    expect((await sendDoc(o, made.id, draft.updatedAt)).status).toBe(200);
    const doc = await getDoc(o, made.id);
    expect(doc.terms).toMatchObject({ id: expect.any(String), version: expect.any(Number) });
    expect(doc.terms.bodyMd).toBe(`Terms version ${doc.terms.version}`);
    const sales = await sessionFor("sales");
    const asSales = await getDoc(sales, made.id);
    expect(asSales.terms?.bodyMd).toBe(doc.terms.bodyMd);
    const again = await mkDraft(o);
    const fresh = await getDoc(o, again.id);
    const saved = await json(await patchDoc(o, again.id, { expectedUpdatedAt: fresh.updatedAt, fields: {} }));
    expect(saved.terms?.bodyMd).toBeUndefined();
  });

  it("a 'sent a document' row on the dashboard carries the document's number", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const v = await getDoc(o, made.id);
    expect((await sendDoc(o, made.id, v.updatedAt)).status).toBe(200);
    const number = (await getDoc(o, made.id)).number as string;
    expect(number).toBeTruthy();
    await insert("audit_log", {
      id: `a-doc-${crypto.randomUUID()}`,
      actor_type: "staff",
      actor_id: o.id,
      role: "owner",
      action: "document.send",
      entity_type: "document",
      entity_id: made.id,
      summary: "{}",
      at: Date.now() + 1000,
    });
    const dash = await json(await call("/dashboard", { cookie: o.cookie }));
    const items = (dash.tiles.activity.items ?? []) as J[];
    expect(items.find((i) => i.entityId === made.id && i.action === "document.send")).toMatchObject({
      entityType: "document",
      ref: number,
    });
  });
});
