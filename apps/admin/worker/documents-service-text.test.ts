// A draft whose services have no Deliverables, Assumptions or Exclusions text (owner, 2026-10-28 and 2026-10-29, docs/13) [ADM-PROP-02, ADM-PROP-05, ADM-CAT-03]:
// an EMPTY token is taken out and its section hidden, an UNKNOWN token (no service yet) stays and is filled by the save that adds one; the gaps are
// reported on the draft read; "Use Catalogue text" adds what Catalogue has since been given; the send check says where each placeholder is.
import { env } from "cloudflare:workers";
import { SEED_TEMPLATES } from "@techaust/db/seed-templates";
import { beforeAll, describe, expect, it } from "vitest";
import { gapSectionsOf } from "./document-save.ts";
import { ITEMS_OF_DOCUMENT, ITEMS_OF_SAVE } from "./quote-model.ts";
import { putPaymentTerms } from "./test-catalogue.ts";
import { insert } from "./test-clients.ts";
import { call, one, rows, sessionFor, type TestSession } from "./test-helpers.ts";
import {
  codeOf,
  getDoc,
  type J,
  json,
  mkQuoteClient,
  mkService,
  mkTerms,
  patchDoc,
  sendDoc,
} from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeAll(async () => {
  await putPaymentTerms();
  await mkTerms();
  // The seeded proposal templates, as the seed writes them: the sections `{{service.deliverables}}` and `{{service.assumptions}}` + `{{service.exclusions}}`.
  for (const t of SEED_TEMPLATES.filter((x) => x.kind === "proposal"))
    await insert("templates", {
      id: crypto.randomUUID(),
      kind: t.kind,
      category: t.category,
      version: t.version,
      body: JSON.stringify(t.body),
    });
});

const KINDS = { deliverables: "deliverables", aex: "assumptions_exclusions" } as const;

async function draftOf(
  services: { id: string }[],
  client?: { clientId: string; contactId: string },
): Promise<{ id: string; clientId: string; contactId: string; updatedAt: number }> {
  const c = client ?? (await mkQuoteClient());
  const s = await owner();
  const res = await call("/documents", {
    cookie: s.cookie,
    body: {
      type: "proposal",
      clientId: c.clientId,
      contactId: c.contactId,
      services: services.map((x) => ({ catalogueItemId: x.id })),
    },
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const made = await json(res);
  return { id: made.id, updatedAt: made.updatedAt, clientId: c.clientId, contactId: c.contactId };
}

/** Hides the template's other empty optional sections (the person's job), so the draft can be sent; returns the new `updatedAt`. */
async function hideEmptySections(o: TestSession, id: string): Promise<number> {
  const v = await getDoc(o, id);
  const res = await patchDoc(o, id, {
    expectedUpdatedAt: v.updatedAt,
    sections: v.sections.map((s: J) => ({
      id: s.id,
      kind: s.kind,
      title: s.title,
      bodyMd: s.bodyMd,
      hidden: s.hidden || (!s.bodyMd && !["estimate", "terms", "acceptance"].includes(s.kind)),
    })),
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await json(res)).updatedAt;
}

const section = (doc: J, kind: string) => doc.sections.find((s: J) => s.kind === kind);

describe("creating: unknown vs empty [ADM-PROP-02]", () => {
  it("only assumptions: the section shows them, no token is left, and the missing exclusions are a gap", async () => {
    const o = await owner();
    const svc = await mkService(100_000, { assumptions_md: "Assume A", name: "Svc one" });
    const made = await draftOf([svc]);
    const doc = await getDoc(o, made.id);
    expect(section(doc, KINDS.aex)).toMatchObject({ bodyMd: "Assume A", hidden: false });
    expect(JSON.stringify(doc.sections)).not.toContain("{{");
    expect(doc.unresolved).toEqual([]);
    expect(doc.blockers.map((b: J) => b.code)).not.toContain("unresolved_placeholders");
    expect(doc.catalogueGaps.map((g: J) => [g.field, g.catalogueHasTextNow])).toEqual([
      ["deliverables", false],
      ["exclusions", false],
    ]);
    // the deliverables section is hidden, the assumptions one is not
    expect(section(doc, KINDS.deliverables)).toMatchObject({ bodyMd: null, hidden: true });
  });

  it("only exclusions", async () => {
    const o = await owner();
    const svc = await mkService(100_000, { exclusions_md: "Not B" });
    const made = await draftOf([svc]);
    const doc = await getDoc(o, made.id);
    expect(section(doc, KINDS.aex)).toMatchObject({ bodyMd: "Not B", hidden: false });
    expect(doc.catalogueGaps.map((g: J) => g.field)).toEqual(["deliverables", "assumptions"]);
    expect(doc.unresolved).toEqual([]);
  });

  it("deliverables empty: the section is hidden and the gap names the service and the Catalogue item", async () => {
    const o = await owner();
    const svc = await mkService(100_000, { assumptions_md: "A", exclusions_md: "E" });
    const made = await draftOf([svc]);
    const doc = await getDoc(o, made.id);
    expect(section(doc, KINDS.deliverables)).toMatchObject({ bodyMd: null, hidden: true });
    expect(section(doc, KINDS.aex)?.bodyMd).toBe("A\nE");
    expect(doc.catalogueGaps).toEqual([
      {
        sectionId: section(doc, KINDS.deliverables).id,
        sectionKind: "deliverables",
        field: "deliverables",
        serviceCode: svc.code,
        serviceName: expect.any(String),
        catalogueItemId: svc.id,
        catalogueHasTextNow: false,
        noRoom: false,
      },
    ]);
  });

  it("the first service empty and a later one filled: the later text sits under its name, never under a leftover token", async () => {
    const o = await owner();
    const first = await mkService(100_000, { name: "First svc" });
    const later = await mkService(50_000, {
      name: "Later svc",
      deliverables_md: "Later delivers",
      assumptions_md: "Later assumes",
    });
    const made = await draftOf([first, later]);
    const doc = await getDoc(o, made.id);
    expect(section(doc, KINDS.deliverables)).toMatchObject({
      bodyMd: "**Later svc**\nLater delivers",
      hidden: false,
    });
    expect(section(doc, KINDS.aex)).toMatchObject({ bodyMd: "**Later svc**\nLater assumes", hidden: false });
    expect(JSON.stringify(doc.sections)).not.toContain("{{");
    expect(doc.unresolved).toEqual([]);
    // Every service whose text is missing is named, also while the section shows another service's text (owner Q3, lead's reading
    // 2026-10-29; review round 2 finding 12): the first service's three blanks, and the later service's exclusions (the partial case).
    const gaps = doc.catalogueGaps.map((g: J) => `${g.serviceName}/${g.field}`);
    expect(gaps).toEqual([
      "First svc/deliverables",
      "First svc/assumptions",
      "First svc/exclusions",
      "Later svc/exclusions",
    ]);
    expect(gaps).not.toContain("Later svc/deliverables");
    expect(doc.catalogueGaps.every((g: J) => g.catalogueHasTextNow === false)).toBe(true);
  });

  it("everything empty: both sections hidden, nothing blocks, and the draft sends", async () => {
    const o = await owner();
    const svc = await mkService(100_000, {});
    const made = await draftOf([svc]);
    const doc = await getDoc(o, made.id);
    expect(section(doc, KINDS.deliverables)).toMatchObject({ bodyMd: null, hidden: true });
    expect(section(doc, KINDS.aex)).toMatchObject({ bodyMd: null, hidden: true });
    expect(doc.blockers.map((b: J) => b.code)).not.toContain("unresolved_placeholders");
    // the template's other, empty sections are the person's to write or hide (as before); the two service sections are not among them
    const empty = doc.blockers.find((b: J) => b.code === "section_empty");
    expect(empty?.kinds ?? []).not.toContain("deliverables");
    expect(empty?.kinds ?? []).not.toContain("assumptions_exclusions");
    expect(doc.catalogueGaps).toHaveLength(3);
    expect((await sendDoc(o, made.id, await hideEmptySections(o, made.id))).status).toBe(200);
    // a sent version has no gaps
    expect((await getDoc(o, made.id)).catalogueGaps).toEqual([]);
  });

  it("the seeded templates with seeded-style catalogue items (no section texts) give a sendable draft in every category", async () => {
    const o = await owner();
    for (const category of ["advise", "build", "automate", "connect", "run"]) {
      const svc = await mkService(100_000, { category });
      const made = await draftOf([svc]);
      const doc = await getDoc(o, made.id);
      expect(
        doc.blockers.map((b: J) => b.code),
        category,
      ).not.toContain("unresolved_placeholders");
      expect(JSON.stringify(doc.sections), category).not.toContain("{{service.");
    }
  });
});

describe("saving: unknown tokens are filled by the save that adds the first service line [ADM-PROP-02]", () => {
  it("tokens typed into a draft with no service line stay unknown and block; adding a service fills them by the creation rules", async () => {
    const o = await owner();
    const start = await mkService(100_000, { assumptions_md: "start" });
    const made = await draftOf([start]);
    const v = await getDoc(o, made.id);
    const tokens = v.sections.map((s: J) =>
      s.kind === "deliverables"
        ? { id: s.id, kind: s.kind, title: s.title, bodyMd: "{{service.deliverables}}", hidden: false }
        : s.kind === "assumptions_exclusions"
          ? {
              id: s.id,
              kind: s.kind,
              title: s.title,
              bodyMd: "{{service.assumptions}}\n{{service.exclusions}}",
              hidden: false,
            }
          : { id: s.id, kind: s.kind, title: s.title, bodyMd: s.bodyMd, hidden: s.hidden },
    );
    const cleared = await json(
      await patchDoc(o, made.id, { expectedUpdatedAt: v.updatedAt, lines: [], sections: tokens }),
    );
    const unknown = await getDoc(o, made.id);
    expect(unknown.unresolved).toEqual(["service.deliverables", "service.assumptions", "service.exclusions"]);
    expect(unknown.blockers.find((b: J) => b.code === "unresolved_placeholders").where).toEqual([
      expect.objectContaining({ name: "service.deliverables", sectionKind: "deliverables", part: "section" }),
      expect.objectContaining({
        name: "service.assumptions",
        sectionKind: "assumptions_exclusions",
        part: "section",
      }),
      expect.objectContaining({
        name: "service.exclusions",
        sectionKind: "assumptions_exclusions",
        part: "section",
      }),
    ]);

    const added = await mkService(200_000, { name: "Added svc", assumptions_md: "Added assumes" });
    const res = await patchDoc(o, made.id, {
      expectedUpdatedAt: cleared.updatedAt,
      lines: [{ catalogueItemId: added.id, description: "Added svc", qtyMilli: 1000, unit: "fixed" }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const filled = await getDoc(o, made.id);
    expect(section(filled, KINDS.aex)).toMatchObject({ bodyMd: "Added assumes", hidden: false });
    expect(section(filled, KINDS.deliverables)).toMatchObject({ bodyMd: null, hidden: true });
    expect(filled.unresolved).toEqual([]);
    expect(JSON.stringify(filled.sections)).not.toContain("{{service.");
    // Review round 2, finding 5: the answer carries the sections the server filled, exactly as stored (the screen applies them, no re-read),
    // and only those; finding 4: a save that changes lines carries the gaps, the same as a read of the draft.
    const answer = await json(res);
    const changed = new Map(answer.sectionsChanged.map((s: J) => [s.id, s]));
    expect([...changed.keys()].sort()).toEqual(
      [section(filled, KINDS.aex).id, section(filled, KINDS.deliverables).id].sort(),
    );
    for (const kind of [KINDS.aex, KINDS.deliverables]) {
      const s = section(filled, kind);
      expect(changed.get(s.id)).toEqual({ id: s.id, title: s.title, bodyMd: s.bodyMd, hidden: s.hidden });
    }
    expect(answer.catalogueGaps).toEqual(filled.catalogueGaps);
    expect(answer.catalogueGaps.map((g: J) => g.field)).toEqual(["deliverables", "exclusions"]);
    // a save of the fields only changes neither: no section comes back, and no gaps are sent (the screen keeps the ones it has)
    const titled = await json(
      await patchDoc(o, made.id, { expectedUpdatedAt: filled.updatedAt, fields: { title: "Renamed" } }),
    );
    expect(titled.sectionsChanged).toEqual([]);
    expect("catalogueGaps" in titled).toBe(false);
    filled.updatedAt = titled.updatedAt;

    // a token the person types later, into a draft that already has a service, is their own text: left alone and named by the send check
    const again = await patchDoc(o, made.id, {
      expectedUpdatedAt: filled.updatedAt,
      sections: filled.sections.map((s: J) => ({
        id: s.id,
        kind: s.kind,
        title: s.title,
        bodyMd: s.kind === KINDS.aex ? "{{service.exclusions}}" : s.bodyMd,
        hidden: s.hidden,
      })),
    });
    expect(again.status).toBe(200);
    expect((await getDoc(o, made.id)).unresolved).toEqual(["service.exclusions"]);
  });
});

describe("the send check says where [ADM-PROP-05]", () => {
  it("where names the part: title, a line, a section (with its id and kind) and the schedule", async () => {
    const o = await owner();
    const svc = await mkService(100_000, {});
    const made = await draftOf([svc]);
    const v = await getDoc(o, made.id);
    const res = await patchDoc(o, made.id, {
      expectedUpdatedAt: v.updatedAt,
      fields: { title: "Offer {{a.title}}" },
      lines: [
        {
          id: v.lines[0].id,
          description: "Line {{a.line}}",
          qtyMilli: 1000,
          unit: "fixed",
          rateMinor: v.lines[0].rateMinor,
        },
      ],
      schedule: [{ label: "Pay {{a.step}}", trigger: "on_accept", pctBp: 10_000 }],
      sections: v.sections.map((s: J) => ({
        id: s.id,
        kind: s.kind,
        title: s.title,
        bodyMd: s.kind === "terms" ? "{{a.terms}}" : s.bodyMd,
        hidden: s.hidden,
      })),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const doc = await getDoc(o, made.id);
    const b = doc.blockers.find((x: J) => x.code === "unresolved_placeholders");
    expect(b.names).toEqual(["a.title", "a.line", "a.terms", "a.step"]);
    expect(b.where).toEqual([
      { name: "a.title", sectionId: null, sectionKind: null, part: "title" },
      { name: "a.line", sectionId: null, sectionKind: null, part: "line" },
      { name: "a.terms", sectionId: section(doc, "terms").id, sectionKind: "terms", part: "section" },
      { name: "a.step", sectionId: null, sectionKind: null, part: "schedule" },
    ]);
    // the refusal of the send carries the same blocker
    const refused = await sendDoc(o, made.id, doc.updatedAt);
    expect(refused.status).toBe(409);
    expect((await json(refused)).reasons.find((r: J) => r.code === "unresolved_placeholders").where).toEqual(
      b.where,
    );
  });
});

describe("POST /documents/:id/sections/fill-from-catalogue [ADM-PROP-02]", () => {
  const fill = (o: { cookie: string }, id: string, sectionId: string, expectedUpdatedAt: number) =>
    call(`/documents/${id}/sections/fill-from-catalogue`, {
      cookie: o.cookie,
      body: { sectionId, expectedUpdatedAt },
    });

  it("adds what Catalogue has now, unhides the section, writes one audit row, and the gap closes", async () => {
    const o = await owner();
    const svc = await mkService(100_000, { name: "Fill svc" });
    const made = await draftOf([svc]);
    const before = await getDoc(o, made.id);
    const sec = section(before, KINDS.deliverables);
    expect(sec.hidden).toBe(true);
    // nothing yet
    const none = await fill(o, made.id, sec.id, before.updatedAt);
    expect(none.status).toBe(409);
    expect(await codeOf(none)).toBe("nothing_to_fill");
    // Catalogue is filled afterwards
    await env.DB.prepare(
      "UPDATE catalogue_items SET deliverables_md = 'Now delivered', updated_at = updated_at + 86400000 WHERE id = ?",
    )
      .bind(svc.id)
      .run();
    const gaps = (await getDoc(o, made.id)).catalogueGaps.filter((g: J) => g.field === "deliverables");
    expect(gaps).toEqual([expect.objectContaining({ catalogueHasTextNow: true, sectionId: sec.id })]);
    const auditsBefore = await rows(
      "SELECT id FROM audit_log WHERE action = 'document.update' AND entity_id = ?",
      made.id,
    );
    const res = await fill(o, made.id, sec.id, before.updatedAt);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await json(res);
    // round 3, finding 7: the filled section comes back once, in `sectionsChanged` (no `filled` copy)
    expect(body.sectionsChanged).toEqual([
      { id: sec.id, title: sec.title, bodyMd: "Now delivered", hidden: false },
    ]);
    expect("filled" in body).toBe(false);
    expect(body.catalogueGaps.map((g: J) => g.field)).not.toContain("deliverables");
    expect(body.updatedAt).toBeGreaterThan(before.updatedAt);
    const after = await getDoc(o, made.id);
    expect(section(after, KINDS.deliverables)).toMatchObject({ bodyMd: "Now delivered", hidden: false });
    expect(
      (await rows("SELECT id FROM audit_log WHERE action = 'document.update' AND entity_id = ?", made.id))
        .length,
    ).toBe(auditsBefore.length + 1);
    // a stale copy is 409 stale_version; with nothing new to add it is nothing_to_fill
    const stale = await fill(o, made.id, sec.id, before.updatedAt);
    expect(await codeOf(stale)).toBe("stale_version");
    const again = await fill(o, made.id, sec.id, after.updatedAt);
    expect(await codeOf(again)).toBe("nothing_to_fill");
  });

  it("a section that shows the service's text gets the rest beside it (round 4, M1: no second heading); an unknown section is 404; a role that cannot draft is refused", async () => {
    const o = await owner();
    const svc = await mkService(100_000, { name: "Part svc", assumptions_md: "Has assumptions" });
    const made = await draftOf([svc]);
    const v = await getDoc(o, made.id);
    const aex = section(v, KINDS.aex);
    await env.DB.prepare(
      "UPDATE catalogue_items SET exclusions_md = 'Now excluded', updated_at = updated_at + 86400000 WHERE id = ?",
    )
      .bind(svc.id)
      .run();
    expect((await fill(o, made.id, "nope", v.updatedAt)).status).toBe(404);
    const viewer = await sessionFor("accountant");
    expect((await fill(viewer, made.id, aex.id, v.updatedAt)).status).toBe(403);
    const res = await fill(o, made.id, aex.id, v.updatedAt);
    expect(res.status).toBe(200);
    expect((await json(res)).sectionsChanged[0].bodyMd).toBe("Has assumptions\nNow excluded");
  });

  it("finding 3: text Catalogue had when the draft was made, edited by the person, is neither called new nor added again", async () => {
    const o = await owner();
    const svc = await mkService(100_000, {
      name: "Edit svc",
      deliverables_md: "Build the five pages",
      assumptions_md: "Content comes from you",
      exclusions_md: "Hosting fees",
    });
    const made = await draftOf([svc]);
    const v = await getDoc(o, made.id);
    expect(v.catalogueGaps).toEqual([]);
    // the person rewrites the start of both texts (a normal edit, inside the first 60 characters)
    const saved = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: v.updatedAt,
        sections: v.sections.map((s: J) => ({
          id: s.id,
          kind: s.kind,
          title: s.title,
          bodyMd:
            s.kind === KINDS.deliverables
              ? "We build five pages"
              : s.kind === KINDS.aex
                ? "You send the content.\nHosting fees"
                : s.bodyMd,
          hidden: s.hidden,
        })),
      }),
    );
    expect(saved.catalogueGaps).toEqual([]);
    const after = await getDoc(o, made.id);
    expect(after.catalogueGaps).toEqual([]);
    for (const kind of [KINDS.deliverables, KINDS.aex]) {
      const r = await fill(o, made.id, section(after, kind).id, after.updatedAt);
      expect(await codeOf(r)).toBe("nothing_to_fill");
    }
    // Once the Catalogue row changes after the draft was made, the texts the sections don't hold are offered: the rule is per row
    // (`updated_at`, no migration), so the untouched assumptions come back too; the exclusions the section holds never do.
    await env.DB.prepare(
      "UPDATE catalogue_items SET deliverables_md = 'Build six pages', updated_at = updated_at + 86400000 WHERE id = ?",
    )
      .bind(svc.id)
      .run();
    const now = await getDoc(o, made.id);
    expect(now.catalogueGaps.map((g: J) => [g.field, g.catalogueHasTextNow])).toEqual([
      ["deliverables", true],
      ["assumptions", true],
    ]);
    const res = await fill(o, made.id, section(now, KINDS.deliverables).id, now.updatedAt);
    expect(res.status).toBe(200);
    const body = await json(res);
    const deliverables = section(now, KINDS.deliverables);
    expect(body.sectionsChanged).toEqual([
      {
        id: deliverables.id,
        title: deliverables.title,
        bodyMd: "We build five pages\n\n**Edit svc**\nBuild six pages",
        hidden: false,
      },
    ]);
    // added once: the same section has nothing more to take
    const twice = await fill(o, made.id, deliverables.id, body.updatedAt);
    expect(await codeOf(twice)).toBe("nothing_to_fill");
  });

  it("finding 9: the catalogue rows behind the gaps are read for a draft only, never for a sent version", async () => {
    const o = await owner();
    const svc = await mkService(100_000, { deliverables_md: "D" });
    const made = await draftOf([svc]);
    const count = async () => (await env.DB.prepare(ITEMS_OF_DOCUMENT).bind(made.id).all()).results.length;
    expect(await count()).toBe(1);
    const ready = await hideEmptySections(o, made.id);
    expect((await sendDoc(o, made.id, ready)).status).toBe(200);
    expect(await count()).toBe(0);
    expect((await getDoc(o, made.id)).catalogueGaps).toEqual([]);
  });

  it("an anonymised client and a sent version are refused", async () => {
    const o = await owner();
    const svc = await mkService(100_000, {});
    const made = await draftOf([svc]);
    const v = await getDoc(o, made.id);
    await env.DB.prepare(
      "UPDATE catalogue_items SET deliverables_md = 'D', updated_at = updated_at + 86400000 WHERE id = ?",
    )
      .bind(svc.id)
      .run();
    const sec = section(v, KINDS.deliverables);
    await env.DB.prepare("UPDATE clients SET anonymised_at = 9 WHERE id = ?").bind(made.clientId).run();
    const gone = await fill(o, made.id, sec.id, v.updatedAt);
    expect(gone.status).toBe(409);
    expect(await codeOf(gone)).toBe("client_anonymised");
    await env.DB.prepare("UPDATE clients SET anonymised_at = NULL WHERE id = ?").bind(made.clientId).run();
    const ready = await hideEmptySections(o, made.id);
    expect((await sendDoc(o, made.id, ready)).status).toBe(200);
    const sent = await fill(o, made.id, sec.id, ready);
    expect([404, 409]).toContain(sent.status);
    expect(
      (
        await one<{ n: number }>(
          "SELECT count(*) AS n FROM document_sections WHERE document_id = ? AND body_md = 'D'",
          made.id,
        )
      )?.n,
    ).toBe(0);
  });
});

describe("round 3: a service added later, the revision baseline [ADM-PROP-02, ADM-PROP-05]", () => {
  const fill = (o: { cookie: string }, id: string, sectionId: string, expectedUpdatedAt: number) =>
    call(`/documents/${id}/sections/fill-from-catalogue`, {
      cookie: o.cookie,
      body: { sectionId, expectedUpdatedAt },
    });
  /** The draft's lines as a save sends them (the whole part), plus new lines for the given services. */
  const linesWith = (doc: J, ...add: { id: string; name?: string }[]) => [
    ...doc.lines.map((l: J) => ({
      id: l.id,
      description: l.description,
      qtyMilli: l.qtyMilli,
      unit: l.unit,
      rateMinor: l.rateMinor,
    })),
    ...add.map((x) => ({ catalogueItemId: x.id, description: "Added line", qtyMilli: 1000, unit: "fixed" })),
  ];

  it("finding 1: service B added to a draft with A gets its text under its name, comes back in sectionsChanged, is named while a text is missing, and fills once Catalogue has it", async () => {
    const o = await owner();
    const a = await mkService(100_000, {
      name: "A svc",
      deliverables_md: "A delivers",
      assumptions_md: "A assumes",
      exclusions_md: "A excludes",
    });
    const b = await mkService(50_000, {
      name: "B svc",
      deliverables_md: "B delivers",
      exclusions_md: "B excludes",
    });
    const made = await draftOf([a]);
    const v = await getDoc(o, made.id);
    expect(v.catalogueGaps).toEqual([]);

    // B is added, and a second line of A (already on the draft: nothing of A is added again)
    const res = await patchDoc(o, made.id, { expectedUpdatedAt: v.updatedAt, lines: linesWith(v, b, a) });
    expect(res.status, await res.clone().text()).toBe(200);
    const answer = await json(res);
    const doc = await getDoc(o, made.id);
    const del = section(doc, KINDS.deliverables);
    const aex = section(doc, KINDS.aex);
    expect(del).toMatchObject({ bodyMd: "A delivers\n\n**B svc**\nB delivers", hidden: false });
    expect(aex).toMatchObject({ bodyMd: "A assumes\nA excludes\n\n**B svc**\nB excludes", hidden: false });
    expect(JSON.stringify(doc.sections)).not.toContain("{{");
    // exactly the two sections the server wrote, as stored; the gaps in the answer are the read's
    expect(answer.sectionsChanged).toEqual(
      [del, aex].map((s: J) => ({ id: s.id, title: s.title, bodyMd: s.bodyMd, hidden: s.hidden })),
    );
    expect(answer.catalogueGaps).toEqual(doc.catalogueGaps);
    // B has exclusions but no assumptions: named (the partial case), nothing offered yet
    expect(doc.catalogueGaps.map((g: J) => [g.serviceCode, g.field, g.catalogueHasTextNow])).toEqual([
      [b.code, "assumptions", false],
    ]);
    expect(await codeOf(await fill(o, made.id, aex.id, doc.updatedAt))).toBe("nothing_to_fill");
    expect(await codeOf(await fill(o, made.id, del.id, doc.updatedAt))).toBe("nothing_to_fill");

    // Catalogue gets B's assumptions: offered on the section, added under B's name, and then nothing is left
    await env.DB.prepare(
      "UPDATE catalogue_items SET assumptions_md = 'B assumes', updated_at = updated_at + 86400000 WHERE id = ?",
    )
      .bind(b.id)
      .run();
    const now = await getDoc(o, made.id);
    expect(now.catalogueGaps.map((g: J) => [g.serviceCode, g.field, g.catalogueHasTextNow])).toEqual([
      [b.code, "assumptions", true],
    ]);
    const filled = await fill(o, made.id, aex.id, now.updatedAt);
    expect(filled.status, await filled.clone().text()).toBe(200);
    const body = await json(filled);
    expect(body.sectionsChanged).toEqual([
      {
        id: aex.id,
        title: aex.title,
        // round 4, M1: into B's own block, before its exclusions; never a second **B svc** heading
        bodyMd: "A assumes\nA excludes\n\n**B svc**\nB assumes\nB excludes",
        hidden: false,
      },
    ]);
    expect(body.catalogueGaps).toEqual([]);
    expect((await getDoc(o, made.id)).catalogueGaps).toEqual([]);

    // a later save of the lines that adds no service writes no section; a save of the other sections carries no gaps (finding 6)
    const after = await getDoc(o, made.id);
    const qty = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: after.updatedAt,
        lines: after.lines.map((l: J) => ({
          id: l.id,
          description: l.description,
          qtyMilli: 2000,
          unit: l.unit,
          rateMinor: l.rateMinor,
        })),
      }),
    );
    expect(qty.sectionsChanged).toEqual([]);
    expect("catalogueGaps" in qty).toBe(false);
    const terms = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: qty.updatedAt,
        sections: after.sections.map((s: J) => ({
          id: s.id,
          kind: s.kind,
          title: s.title,
          bodyMd: s.kind === "terms" ? "Our own terms" : s.bodyMd,
          hidden: s.hidden,
        })),
      }),
    );
    expect(terms.sectionsChanged).toEqual([]);
    expect("catalogueGaps" in terms).toBe(false);
  });

  it("finding 1: a service with no text is named on a section showing A's; a hidden empty section is shown with B's text", async () => {
    const o = await owner();
    const a = await mkService(100_000, { name: "A only", assumptions_md: "A assumes" });
    const blank = await mkService(10_000, { name: "Blank svc" });
    const b = await mkService(50_000, { name: "B deliv", deliverables_md: "B delivers" });
    const made = await draftOf([a]);
    const v = await getDoc(o, made.id);
    expect(section(v, KINDS.deliverables)).toMatchObject({ bodyMd: null, hidden: true });

    // a service with no text at all: no section is written, and it is named everywhere its texts are missing
    const r1 = await json(
      await patchDoc(o, made.id, { expectedUpdatedAt: v.updatedAt, lines: linesWith(v, blank) }),
    );
    expect(r1.sectionsChanged).toEqual([]);
    expect(r1.catalogueGaps.map((g: J) => [g.serviceCode, g.field])).toEqual([
      [a.code, "deliverables"],
      [a.code, "exclusions"],
      [blank.code, "deliverables"],
      [blank.code, "assumptions"],
      [blank.code, "exclusions"],
    ]);

    // B brings deliverables: the hidden, empty Deliverables section is shown with B's text under its name
    const v2 = await getDoc(o, made.id);
    const r2 = await json(
      await patchDoc(o, made.id, { expectedUpdatedAt: r1.updatedAt, lines: linesWith(v2, b) }),
    );
    const del = section(await getDoc(o, made.id), KINDS.deliverables);
    expect(del).toMatchObject({ bodyMd: "**B deliv**\nB delivers", hidden: false });
    expect(r2.sectionsChanged).toEqual([{ id: del.id, title: del.title, bodyMd: del.bodyMd, hidden: false }]);
    // A and the blank service are still named on Deliverables (it now shows another service's text)
    expect(
      r2.catalogueGaps
        .filter((g: J) => g.field === "deliverables")
        .map((g: J) => [g.serviceCode, g.catalogueHasTextNow]),
    ).toEqual([
      [a.code, false],
      [blank.code, false],
    ]);
  });

  it("finding 2: a revision's baseline is the version group's first creation time, so Catalogue text changed since version 1 is offered", async () => {
    const o = await owner();
    const svc = await mkService(100_000, { name: "Rev svc", assumptions_md: "Rev assumes" });
    const made = await draftOf([svc]);
    const ready = await hideEmptySections(o, made.id);
    expect((await sendDoc(o, made.id, ready)).status).toBe(200);
    const v1 = await one<{ created_at: number }>("SELECT created_at FROM documents WHERE id = ?", made.id);
    // Catalogue gets the exclusions after version 1 was made and before the revision
    await env.DB.prepare(
      "UPDATE catalogue_items SET exclusions_md = 'Rev excludes', updated_at = ? WHERE id = ?",
    )
      .bind((v1?.created_at ?? 0) + 1, svc.id)
      .run();
    const revised = await call(`/documents/${made.id}/revise`, { cookie: o.cookie, body: {} });
    expect(revised.status, await revised.clone().text()).toBe(201);
    const rid = (await json(revised)).id;
    const doc = await getDoc(o, rid);
    // the revision was made after the Catalogue change: by its own `created_at` this would not be new
    expect(doc.createdAt).toBeGreaterThan((v1?.created_at ?? 0) + 1);
    const aex = section(doc, KINDS.aex);
    expect(aex.bodyMd).toBe("Rev assumes");
    expect(doc.catalogueGaps.filter((g: J) => g.sectionKind === KINDS.aex)).toEqual([
      expect.objectContaining({ field: "exclusions", catalogueHasTextNow: true, sectionId: aex.id }),
    ]);
    const res = await fill(o, rid, aex.id, doc.updatedAt);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await json(res)).sectionsChanged[0].bodyMd).toBe("Rev assumes\nRev excludes");
  });
});

// Last in the file: it adds a newer "connect" template, which every later "connect" draft of this file would take.
describe("round 4: length limits, the first service, the gap sections compared in SQL [ADM-PROP-02, ADM-CAT-03]", () => {
  const lineOf = (x: { id: string }) => ({
    catalogueItemId: x.id,
    description: "Added line",
    qtyMilli: 1000,
    unit: "fixed",
  });
  const keep = (doc: J) =>
    doc.lines.map((l: J) => ({
      id: l.id,
      description: l.description,
      qtyMilli: l.qtyMilli,
      unit: l.unit,
      rateMinor: l.rateMinor,
    }));
  const sectionsOf = (doc: J, change: (s: J) => J = (s) => s) =>
    doc.sections.map((s: J) => {
      const x = change(s);
      return { id: x.id, kind: x.kind, title: x.title, bodyMd: x.bodyMd, hidden: x.hidden };
    });
  const text = (n: number, c: string) => c.repeat(n);

  it("M3 at save: a service whose text would pass 6,000 characters is left out of that section and named, and every later save still works", async () => {
    const o = await owner();
    const a = await mkService(100_000, { name: "Long A", deliverables_md: text(2500, "a") });
    const b = await mkService(50_000, { name: "Long B", deliverables_md: text(2500, "b") });
    const c = await mkService(50_000, {
      name: "Long C",
      deliverables_md: text(2500, "c"),
      exclusions_md: "C excludes",
    });
    const made = await draftOf([a]);
    const v = await getDoc(o, made.id);
    const res = await patchDoc(o, made.id, {
      expectedUpdatedAt: v.updatedAt,
      lines: [...keep(v), lineOf(b), lineOf(c)],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const answer = await json(res);
    const doc = await getDoc(o, made.id);
    const del = section(doc, KINDS.deliverables);
    expect(del.bodyMd.length).toBeLessThanOrEqual(6000);
    expect(del.bodyMd).toContain("**Long B**");
    expect(del.bodyMd).not.toContain("**Long C**");
    // C's exclusions still go into their own section
    expect(section(doc, KINDS.aex).bodyMd).toContain("**Long C**\nC excludes");
    // named, as left out for the limit, never as text to fill
    expect(
      answer.catalogueGaps
        .filter((g: J) => g.noRoom)
        .map((g: J) => [g.serviceCode, g.field, g.catalogueHasTextNow]),
    ).toEqual([[c.code, "deliverables", false]]);
    expect(answer.catalogueGaps).toEqual(doc.catalogueGaps);
    // the next saves (a typed section, the lines again) are not refused
    const typed = await patchDoc(o, made.id, {
      expectedUpdatedAt: doc.updatedAt,
      sections: sectionsOf(doc, (s) => (s.kind === "terms" ? { ...s, bodyMd: "Our terms" } : s)),
    });
    expect(typed.status, await typed.clone().text()).toBe(200);
    const again = await patchDoc(o, made.id, {
      expectedUpdatedAt: (await json(typed)).updatedAt,
      lines: keep(await getDoc(o, made.id)),
    });
    expect(again.status, await again.clone().text()).toBe(200);
    // "Use Catalogue text" has nothing it may add there
    const after = await getDoc(o, made.id);
    const fill = await call(`/documents/${made.id}/sections/fill-from-catalogue`, {
      cookie: o.cookie,
      body: { sectionId: del.id, expectedUpdatedAt: after.updatedAt },
    });
    expect(await codeOf(fill)).toBe("nothing_to_fill");
  });

  it("M3 at creation: three long services make a draft within the limits, the one left out named; it saves and sends", async () => {
    const o = await owner();
    const svcs = [];
    for (const n of ["X", "Y", "Z"])
      svcs.push(await mkService(100_000, { name: `Big ${n}`, deliverables_md: text(2500, n.toLowerCase()) }));
    const made = await draftOf(svcs);
    const doc = await getDoc(o, made.id);
    const del = section(doc, KINDS.deliverables);
    expect(del.bodyMd.length).toBeLessThanOrEqual(6000);
    expect(del.bodyMd).toContain("**Big Y**");
    expect(del.bodyMd).not.toContain("**Big Z**");
    expect(doc.catalogueGaps.filter((g: J) => g.noRoom).map((g: J) => [g.serviceCode, g.field])).toEqual([
      [svcs[2]?.code, "deliverables"],
    ]);
    const saved = await patchDoc(o, made.id, { expectedUpdatedAt: doc.updatedAt, sections: sectionsOf(doc) });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const updatedAt = await hideEmptySections(o, made.id);
    const sent = await sendDoc(o, made.id, updatedAt);
    expect(sent.status, await sent.clone().text()).toBe(200);
  });

  it("L2: the save that adds the first service fills only the template's tokens; text the person wrote over them is kept as it is", async () => {
    const o = await owner();
    const start = await mkService(100_000, { name: "Start svc" });
    const made = await draftOf([start]);
    const v = await getDoc(o, made.id);
    // no service line, the Deliverables tokens written over by the person, the Assumptions and exclusions tokens kept
    const cleared = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: v.updatedAt,
        lines: [],
        sections: sectionsOf(v, (s) =>
          s.kind === KINDS.deliverables
            ? { ...s, bodyMd: "Our own deliverables", hidden: false }
            : s.kind === KINDS.aex
              ? { ...s, bodyMd: "{{service.assumptions}}\n{{service.exclusions}}", hidden: false }
              : s,
        ),
      }),
    );
    const first = await mkService(100_000, {
      name: "First svc",
      deliverables_md: "First delivers",
      assumptions_md: "First assumes",
    });
    const res = await patchDoc(o, made.id, { expectedUpdatedAt: cleared.updatedAt, lines: [lineOf(first)] });
    expect(res.status, await res.clone().text()).toBe(200);
    const doc = await getDoc(o, made.id);
    expect(section(doc, KINDS.deliverables).bodyMd).toBe("Our own deliverables");
    expect(section(doc, KINDS.aex).bodyMd).toBe("First assumes");
    expect(JSON.stringify(doc.sections)).not.toContain("**First svc**");
    const answer = await json(res);
    expect(answer.sectionsChanged.map((s: J) => s.id)).toEqual([section(doc, KINDS.aex).id]);
  });

  it("L6: the save's catalogue read takes the draft's rows only when a Deliverables or Assumptions and exclusions section changed", async () => {
    const o = await owner();
    const a = await mkService(100_000, { name: "Read svc", deliverables_md: "Reads" });
    const made = await draftOf([a]);
    const doc = await getDoc(o, made.id);
    const read = async (sections: J[] | undefined, lines = 0) => {
      const sent = gapSectionsOf(sections as Parameters<typeof gapSectionsOf>[0]);
      return (
        await env.DB.prepare(ITEMS_OF_SAVE)
          .bind(made.id, "[]", lines, sent === null || sent === "force" ? null : JSON.stringify(sent))
          .all()
      ).results.length;
    };
    const same = sectionsOf(doc);
    expect(await read(same)).toBe(0);
    expect(await read(sectionsOf(doc, (s) => (s.kind === "terms" ? { ...s, bodyMd: "New terms" } : s)))).toBe(
      0,
    );
    // a section moved changes nothing either
    expect(await read([...same].reverse())).toBe(0);
    expect(await read(undefined)).toBe(0);
    expect(
      await read(sectionsOf(doc, (s) => (s.kind === KINDS.deliverables ? { ...s, bodyMd: "Edited" } : s))),
    ).toBe(1);
    expect(await read(sectionsOf(doc, (s) => (s.kind === KINDS.aex ? { ...s, hidden: !s.hidden } : s)))).toBe(
      1,
    );
    expect(await read(same.filter((s: J) => s.kind !== KINDS.aex))).toBe(1);
    expect(await read(undefined, 1)).toBe(1);
    // a gap section with no id, or two with one id, reads whatever is stored
    expect(gapSectionsOf([{ kind: "deliverables", bodyMd: "x" }])).toBe("force");
    const d = same.find((s: J) => s.kind === KINDS.deliverables);
    expect(gapSectionsOf([d, { ...d, kind: "assumptions_exclusions" }])).toBe("force");
    // end to end: a terms-only save answers without gaps, a Deliverables edit with them
    const terms = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: doc.updatedAt,
        sections: sectionsOf(doc, (s) => (s.kind === "terms" ? { ...s, bodyMd: "New terms" } : s)),
      }),
    );
    expect("catalogueGaps" in terms).toBe(false);
    const edited = await json(
      await patchDoc(o, made.id, {
        expectedUpdatedAt: terms.updatedAt,
        sections: sectionsOf(doc, (s) => (s.kind === KINDS.deliverables ? { ...s, bodyMd: "Our words" } : s)),
      }),
    );
    expect(Array.isArray(edited.catalogueGaps)).toBe(true);
  });
});

describe("finding 7: a required section is never hidden automatically [ADM-PROP-02]", () => {
  it("a template whose Terms and Acceptance hold only empty service values: they stay shown; Deliverables is hidden", async () => {
    await insert("templates", {
      id: crypto.randomUUID(),
      kind: "proposal",
      category: "connect",
      version: 99,
      body: JSON.stringify({
        sections: [
          { key: "deliverables", heading: "Deliverables", body: "{{service.deliverables}}" },
          { key: "estimate", heading: "Estimate", body: "{{service.schedule}}" },
          { key: "terms", heading: "Terms", body: "{{service.exclusions}}" },
          { key: "acceptance", heading: "Acceptance", body: "{{service.assumptions}}" },
        ],
      }),
    });
    const o = await owner();
    const svc = await mkService(100_000, { category: "connect" });
    const made = await draftOf([svc]);
    const doc = await getDoc(o, made.id);
    expect(doc.sections.map((s: J) => [s.kind, s.hidden])).toEqual([
      ["deliverables", true],
      ["estimate", false],
      ["terms", false],
      ["acceptance", false],
    ]);
    expect(doc.blockers.map((b: J) => b.code)).not.toContain("required_hidden");
  });
});
