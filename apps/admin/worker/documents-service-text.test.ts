// A draft whose services have no Deliverables, Assumptions or Exclusions text (owner, 2026-10-28 and 2026-10-29, docs/13) [ADM-PROP-02, ADM-PROP-05, ADM-CAT-03]:
// an EMPTY token is taken out and its section hidden, an UNKNOWN token (no service yet) stays and is filled by the save that adds one; the gaps are
// reported on the draft read; "Use Catalogue text" adds what Catalogue has since been given; the send check says where each placeholder is.
import { env } from "cloudflare:workers";
import { SEED_TEMPLATES } from "@techaust/db/seed-templates";
import { beforeAll, describe, expect, it } from "vitest";
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
    // the later service's exclusions are missing (the partial case); the sections show text, so the first service's blanks are not nagged
    const gaps = doc.catalogueGaps.map((g: J) => `${g.serviceName}/${g.field}`);
    expect(gaps).toEqual(["Later svc/exclusions"]);
    expect(gaps).not.toContain("Later svc/deliverables");
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
    await env.DB.prepare("UPDATE catalogue_items SET deliverables_md = 'Now delivered' WHERE id = ?")
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
    expect(body.filled).toEqual({
      sectionId: sec.id,
      title: sec.title,
      bodyMd: "Now delivered",
      hidden: false,
    });
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

  it("a section that shows text gets the rest under the service's name; an unknown section is 404; a role that cannot draft is refused", async () => {
    const o = await owner();
    const svc = await mkService(100_000, { name: "Part svc", assumptions_md: "Has assumptions" });
    const made = await draftOf([svc]);
    const v = await getDoc(o, made.id);
    const aex = section(v, KINDS.aex);
    await env.DB.prepare("UPDATE catalogue_items SET exclusions_md = 'Now excluded' WHERE id = ?")
      .bind(svc.id)
      .run();
    expect((await fill(o, made.id, "nope", v.updatedAt)).status).toBe(404);
    const viewer = await sessionFor("accountant");
    expect((await fill(viewer, made.id, aex.id, v.updatedAt)).status).toBe(403);
    const res = await fill(o, made.id, aex.id, v.updatedAt);
    expect(res.status).toBe(200);
    expect((await json(res)).filled.bodyMd).toBe("Has assumptions\n\n**Part svc**\nNow excluded");
  });

  it("an anonymised client and a sent version are refused", async () => {
    const o = await owner();
    const svc = await mkService(100_000, {});
    const made = await draftOf([svc]);
    const v = await getDoc(o, made.id);
    await env.DB.prepare("UPDATE catalogue_items SET deliverables_md = 'D' WHERE id = ?").bind(svc.id).run();
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
