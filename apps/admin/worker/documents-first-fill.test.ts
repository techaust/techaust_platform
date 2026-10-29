// The first service's own template fill keeps to the section limits (FX-3 round 2, M5 round 4 question 2) [ADM-PROP-02, ADM-CAT-03]: a
// staff-edited template of about 2,000 characters around both `{{service.assumptions}}` and `{{service.exclusions}}`, with both Catalogue
// texts at their 2,500 limit, would make a 6,900-character section. The texts are left out of that section and named (`noRoom`), at
// creation and at the save that adds the first service line; nothing is refused, and the draft saves and sends.
import { beforeAll, describe, expect, it } from "vitest";
import { putPaymentTerms } from "./test-catalogue.ts";
import { insert } from "./test-clients.ts";
import { call, sessionFor, type TestSession } from "./test-helpers.ts";
import { getDoc, type J, json, mkQuoteClient, mkService, mkTerms, patchDoc, sendDoc } from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });
const CATEGORY = "automate";
const WORDS = "t".repeat(1900);
const AEX = `${WORDS}\n\n{{service.assumptions}}\n\n{{service.exclusions}}\n\nEnd.`;
const KEPT = `${WORDS}\n\nEnd.`;

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
  await insert("templates", {
    id: crypto.randomUUID(),
    kind: "proposal",
    category: CATEGORY,
    version: 1,
    body: JSON.stringify({
      sections: [
        { key: "deliverables", heading: "Deliverables", body: "{{service.deliverables}}" },
        { key: "assumptions_exclusions", heading: "Assumptions and exclusions", body: AEX },
        { key: "estimate", heading: "Estimate", body: "{{service.schedule}}" },
        { key: "terms", heading: "Terms", body: "Our terms." },
        { key: "acceptance", heading: "Acceptance", body: "Signed by the client." },
      ],
    }),
  });
});

const section = (doc: J, kind: string) => doc.sections.find((s: J) => s.kind === kind);
const sectionsOf = (doc: J, change: (s: J) => J = (s) => s) =>
  doc.sections.map((s: J) => {
    const x = change(s);
    return { id: x.id, kind: x.kind, title: x.title, bodyMd: x.bodyMd, hidden: x.hidden };
  });
const longService = () =>
  mkService(100_000, {
    category: CATEGORY,
    name: "Long first",
    deliverables_md: "First delivers",
    assumptions_md: "a".repeat(2500),
    exclusions_md: "e".repeat(2500),
  });
const noRoomOf = (gaps: J[]) =>
  gaps.filter((g) => g.noRoom).map((g) => [g.serviceCode, g.sectionKind, g.field, g.catalogueHasTextNow]);

async function create(o: TestSession, services: { id: string }[]): Promise<string> {
  const c = await mkQuoteClient();
  const res = await call("/documents", {
    cookie: o.cookie,
    body: {
      type: "proposal",
      clientId: c.clientId,
      contactId: c.contactId,
      services: services.map((x) => ({ catalogueItemId: x.id })),
    },
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await json(res)).id;
}

describe("FX-3 round 2: the first service's own fill past 6,000 characters is left out and named [ADM-PROP-02]", () => {
  it("at creation: the draft is made within the limits, the texts are named noRoom, and it saves and sends", async () => {
    const o = await owner();
    const svc = await longService();
    const id = await create(o, [svc]);
    const doc = await getDoc(o, id);
    expect(section(doc, "deliverables").bodyMd).toBe("First delivers");
    const aex = section(doc, "assumptions_exclusions");
    expect(aex.bodyMd).toBe(KEPT);
    expect(aex.hidden).toBe(false);
    for (const s of doc.sections) expect((s.bodyMd ?? "").length).toBeLessThanOrEqual(6000);
    expect(noRoomOf(doc.catalogueGaps)).toEqual([
      [svc.code, "assumptions_exclusions", "assumptions", false],
      [svc.code, "assumptions_exclusions", "exclusions", false],
    ]);
    // nothing is refused: a save of the sections as they are, then the send
    const saved = await patchDoc(o, id, { expectedUpdatedAt: doc.updatedAt, sections: sectionsOf(doc) });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const sent = await sendDoc(o, id, (await json(saved)).updatedAt);
    expect(sent.status, await sent.clone().text()).toBe(200);
  });

  it("at the save that adds the first service line: the save succeeds, the texts are left out and named, and later saves work", async () => {
    const o = await owner();
    // a service with no texts makes the draft; the person then takes the line off and writes the tokens back (as a draft made before it
    // had a service holds them)
    const start = await mkService(100_000, { category: CATEGORY, name: "Start" });
    const id = await create(o, [start]);
    const v = await getDoc(o, id);
    const cleared = await patchDoc(o, id, {
      expectedUpdatedAt: v.updatedAt,
      lines: [],
      sections: sectionsOf(v, (s) =>
        s.kind === "deliverables"
          ? { ...s, bodyMd: "{{service.deliverables}}", hidden: false }
          : s.kind === "assumptions_exclusions"
            ? { ...s, bodyMd: AEX, hidden: false }
            : s,
      ),
    });
    expect(cleared.status, await cleared.clone().text()).toBe(200);
    const svc = await longService();
    const res = await patchDoc(o, id, {
      expectedUpdatedAt: (await json(cleared)).updatedAt,
      lines: [{ catalogueItemId: svc.id, description: "Added line", qtyMilli: 1000, unit: "fixed" }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const answer = await json(res);
    const doc = await getDoc(o, id);
    expect(section(doc, "deliverables").bodyMd).toBe("First delivers");
    expect(section(doc, "assumptions_exclusions").bodyMd).toBe(KEPT);
    expect(noRoomOf(answer.catalogueGaps)).toEqual([
      [svc.code, "assumptions_exclusions", "assumptions", false],
      [svc.code, "assumptions_exclusions", "exclusions", false],
    ]);
    expect(answer.catalogueGaps).toEqual(doc.catalogueGaps);
    // the refilled sections come back in the answer
    expect(answer.sectionsChanged.map((s: J) => s.id).sort()).toEqual(
      [section(doc, "deliverables").id, section(doc, "assumptions_exclusions").id].sort(),
    );
    // a later save is not refused, and "Use Catalogue text" has nothing it may add there
    const again = await patchDoc(o, id, { expectedUpdatedAt: doc.updatedAt, sections: sectionsOf(doc) });
    expect(again.status, await again.clone().text()).toBe(200);
    const fill = await call(`/documents/${id}/sections/fill-from-catalogue`, {
      cookie: o.cookie,
      body: {
        sectionId: section(doc, "assumptions_exclusions").id,
        expectedUpdatedAt: (await json(again)).updatedAt,
      },
    });
    expect(fill.status).toBe(409);
    expect((await json(fill)).error.code).toBe("nothing_to_fill");
  });
});
