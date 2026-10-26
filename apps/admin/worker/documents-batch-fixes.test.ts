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
  });
});

describe("round 2: the pinned terms text on the read, and the dashboard's document number [ADM-PROP-05, ADM-DASH-01]", () => {
  it("the read returns the pinned version's frozen text to every role that can read it; the save answer stays slim", async () => {
    const o = await owner();
    const made = await mkDraft(o);
    const doc = await getDoc(o, made.id);
    expect(doc.terms).toMatchObject({ id: expect.any(String), version: expect.any(Number) });
    expect(doc.terms.bodyMd).toBe(`Terms version ${doc.terms.version}`);
    const sales = await sessionFor("sales");
    const asSales = await getDoc(sales, made.id);
    expect(asSales.terms?.bodyMd).toBe(doc.terms.bodyMd);
    const saved = await json(await patchDoc(o, made.id, { expectedUpdatedAt: doc.updatedAt, fields: {} }));
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
