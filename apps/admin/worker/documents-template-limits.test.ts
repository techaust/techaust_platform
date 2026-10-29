// A template's values never make a draft that every later save refuses (FX-3 round 3, the lead's answers to round 2 Q1 and Q2, docs/13
// 2026-10-29) [ADM-PROP-02, ADM-CAT-03]:
//   - Q1: a value that would take a section title past 120 characters stays unfilled; the draft is made, saves, and the send check names
//     the placeholder until the person writes a shorter title.
//   - Q2: saving a template whose custom sections past the third would be joined past 6,000 characters is refused, naming them; and a
//     short value never takes a draft's text past 6,000 at creation (it stays unfilled, as in a title).
// Its own database: it adds templates.
import { beforeAll, describe, expect, it } from "vitest";
import { putPaymentTerms } from "./test-catalogue.ts";
import { insert } from "./test-clients.ts";
import { bodyOf, call, countOf, sessionFor } from "./test-helpers.ts";
import { getDoc, type J, json, mkQuoteClient, mkService, mkTerms, patchDoc, sendDoc } from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });
const CATEGORY = "advise";
const LONG_NAME = `Client ${"n".repeat(103)}`;

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
        { key: "cover", heading: "Proposal for {{client.name}}", body: "For {{client.name}}" },
        { key: "scope", heading: "{{service.name}} scope", body: "{{service.short}}" },
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

describe("FX-3 round 3, Q1: a value that would pass a section title's 120 characters stays unfilled [ADM-PROP-02]", () => {
  it("at creation: made, saved, the send names the placeholder, and a shorter title sends", async () => {
    const o = await owner();
    const c = await mkQuoteClient({ display_name: LONG_NAME });
    const svc = await mkService(100_000, {
      category: CATEGORY,
      name: "S".repeat(116),
      short: "A short line",
    });
    const res = await call("/documents", {
      cookie: o.cookie,
      body: {
        type: "proposal",
        clientId: c.clientId,
        contactId: c.contactId,
        services: [{ catalogueItemId: svc.id }],
      },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const id = (await json(res)).id;
    const doc = await getDoc(o, id);
    const cover = section(doc, "cover");
    const scope = section(doc, "scope");
    // the titles keep the placeholders; the texts are filled
    expect(cover.title).toBe("Proposal for {{client.name}}");
    expect(cover.bodyMd).toBe(`For ${LONG_NAME}`);
    expect(scope.title).toBe("{{service.name}} scope");
    expect(scope.bodyMd).toBe("A short line");
    for (const s of doc.sections) expect((s.title ?? "").length).toBeLessThanOrEqual(120);
    // a later save is not refused
    const saved = await patchDoc(o, id, { expectedUpdatedAt: doc.updatedAt, sections: sectionsOf(doc) });
    expect(saved.status, await saved.clone().text()).toBe(200);
    // the send check names both, in the titles
    const refused = await sendDoc(o, id, (await json(saved)).updatedAt);
    expect(refused.status).toBe(409);
    const body = await json(refused);
    const where = body.reasons.find((r: J) => r.code === "unresolved_placeholders");
    expect(where.names.sort()).toEqual(["client.name", "service.name"]);
    expect(where.where.map((w: J) => [w.name, w.sectionKind])).toEqual(
      expect.arrayContaining([
        ["client.name", "cover"],
        ["service.name", "scope"],
      ]),
    );
    // the person writes shorter titles, and it sends
    const fixed = await patchDoc(o, id, {
      expectedUpdatedAt: (await getDoc(o, id)).updatedAt,
      sections: sectionsOf(await getDoc(o, id), (s) =>
        s.kind === "cover" ? { ...s, title: "Proposal" } : s.kind === "scope" ? { ...s, title: "Scope" } : s,
      ),
    });
    expect(fixed.status, await fixed.clone().text()).toBe(200);
    const sent = await sendDoc(o, id, (await json(fixed)).updatedAt);
    expect(sent.status, await sent.clone().text()).toBe(200);
  });

  it("a name that fits fills the title as before", async () => {
    const o = await owner();
    const c = await mkQuoteClient({ display_name: "Acme" });
    const svc = await mkService(100_000, { category: CATEGORY, name: "Audit", short: "A short line" });
    const res = await call("/documents", {
      cookie: o.cookie,
      body: {
        type: "proposal",
        clientId: c.clientId,
        contactId: c.contactId,
        services: [{ catalogueItemId: svc.id }],
      },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const doc = await getDoc(o, (await json(res)).id);
    expect(section(doc, "cover").title).toBe("Proposal for Acme");
    expect(section(doc, "scope").title).toBe("Audit scope");
  });
});

describe("FX-3 round 3, Q2: a template whose joined custom sections pass 6,000 characters is refused [ADM-CAT-03]", () => {
  const text = (n: number) => "w".repeat(n);
  const tpl = (
    kind: string,
    category: string | null,
    sections: { key: string; heading: string; body: string }[],
  ) => ({
    kind,
    category,
    body: { sections },
  });
  const customs = (n: number, size: number) =>
    Array.from({ length: n }, (_, i) => ({ key: `extra_${i}`, heading: `Extra ${i}`, body: text(size) }));

  it("refused with the joined sections named; nothing is stored", async () => {
    const o = await owner();
    const before = await countOf("templates");
    const res = await call("/templates", {
      cookie: o.cookie,
      body: tpl("proposal", "run", [{ key: "cover", heading: "Cover", body: "" }, ...customs(5, 2_000)]),
    });
    expect(res.status).toBe(400);
    const b = await bodyOf(res);
    expect((b.error as J).code).toBe("template_joined_too_long");
    expect(b.sections).toEqual([3, 4, 5]);
    expect(await countOf("templates")).toBe(before);
    // an estimate template too
    const est = await call("/templates", {
      cookie: o.cookie,
      body: tpl("estimate", "run", customs(5, 2_000)),
    });
    expect(est.status).toBe(400);
    expect(((await bodyOf(est)).error as J).code).toBe("template_joined_too_long");
  });

  it("saved when the joined text fits, and a care plan or terms block is never joined", async () => {
    const o = await owner();
    const fits = await call("/templates", {
      cookie: o.cookie,
      body: tpl("proposal", "connect", customs(5, 1_000)),
    });
    expect(fits.status, await fits.clone().text()).toBe(201);
    const block = await call("/templates", {
      cookie: o.cookie,
      body: tpl("care_block", null, customs(5, 2_000)),
    });
    expect(block.status, await block.clone().text()).toBe(201);
  });

  it("a short value can't take a draft's text past 6,000 at creation: it stays unfilled, the draft saves", async () => {
    const o = await owner();
    // 124 placeholders (1,984 characters) in each of two sections; a 60-character name would make each one 7,440
    const many = "{{client.name}} ".repeat(124);
    await call("/templates", {
      cookie: o.cookie,
      body: tpl("proposal", "build", [
        { key: "scope", heading: "Scope", body: many.slice(0, 1_984) },
        { key: "summary", heading: "Summary", body: many.slice(0, 1_984) },
        { key: "estimate", heading: "Estimate", body: "" },
      ]),
    }).then(async (r) => expect(r.status, await r.clone().text()).toBe(201));
    const c = await mkQuoteClient({ display_name: "C".repeat(60) });
    const svc = await mkService(100_000, { category: "build", name: "Build" });
    const res = await call("/documents", {
      cookie: o.cookie,
      body: {
        type: "proposal",
        clientId: c.clientId,
        contactId: c.contactId,
        services: [{ catalogueItemId: svc.id }],
      },
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const doc = await getDoc(o, (await json(res)).id);
    for (const s of doc.sections) expect((s.bodyMd ?? "").length).toBeLessThanOrEqual(6_000);
    expect(section(doc, "scope").bodyMd).toContain("C".repeat(60));
    expect(section(doc, "scope").bodyMd).toContain("{{client.name}}");
    const saved = await patchDoc(o, doc.id, { expectedUpdatedAt: doc.updatedAt, sections: sectionsOf(doc) });
    expect(saved.status, await saved.clone().text()).toBe(200);
  });
});
