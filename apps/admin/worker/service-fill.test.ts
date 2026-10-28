// The pure rules of service-fill.ts [ADM-PROP-02]: unknown vs empty tokens, every service counted, the gaps, the text "Use Catalogue text" adds.
import { describe, expect, it } from "vitest";
import {
  appendedText,
  appendServices,
  autoHides,
  catalogueGaps,
  emptyServiceTokens,
  fillServiceTokens,
  gapInputsChanged,
  type ServiceFacts,
  serviceIdsOf,
  servicesOf,
  textToFill,
} from "./service-fill.ts";

const svc = (over: Partial<ServiceFacts> = {}): ServiceFacts => ({
  id: "i1",
  code: "S1",
  name: "Alpha & Co",
  short: "Short",
  deliverables_md: null,
  assumptions_md: null,
  exclusions_md: null,
  ...over,
});
const sec = (kind: string, bodyMd: string | null, hidden = false, id = kind) => ({
  id,
  kind,
  title: kind,
  bodyMd,
  hidden,
});

describe("unknown vs empty", () => {
  it("no service: nothing is empty and the sections are returned untouched (the tokens stay)", () => {
    expect(emptyServiceTokens(null).size).toBe(0);
    const sections = [sec("deliverables", "{{service.deliverables}}")];
    expect(fillServiceTokens(sections, [], null)).toEqual(sections);
  });

  it("a service with no text: its tokens are empty, the section is taken out and hidden", () => {
    expect([...emptyServiceTokens(svc())].sort()).toEqual([
      "service.assumptions",
      "service.deliverables",
      "service.exclusions",
    ]);
    const out = fillServiceTokens(
      [
        sec("deliverables", "{{service.deliverables}}"),
        sec("assumptions_exclusions", "{{service.assumptions}}\n{{service.exclusions}}"),
      ],
      [svc()],
      null,
    );
    expect(out.map((s) => [s.bodyMd, s.hidden])).toEqual([
      [null, true],
      [null, true],
    ]);
  });

  it("a section with other words keeps them; a hidden-by-hand section with text stays as it was", () => {
    const out = fillServiceTokens(
      [sec("scope", "{{service.name}}: {{service.short}}\n{{service.exclusions}}", true)],
      [svc({ short: "S" })],
      null,
    );
    expect(out[0]).toMatchObject({ bodyMd: "Alpha and Co: S", hidden: true });
  });

  it("the first service empty, a later one filled: its text goes under its name, no token is left", () => {
    const later = svc({ id: "i2", name: "Beta", assumptions_md: "Be", exclusions_md: "Ex" });
    const out = fillServiceTokens(
      [sec("assumptions_exclusions", "{{service.assumptions}}\n{{service.exclusions}}")],
      [svc(), later],
      null,
    );
    expect(out[0]).toMatchObject({ bodyMd: "**Beta**\nBe\nEx", hidden: false });
  });

  it("the schedule sentence fills service.schedule", () => {
    const out = fillServiceTokens([sec("estimate", "{{service.schedule}}")], [svc()], "100 percent now");
    expect(out[0]?.bodyMd).toBe("100 percent now");
  });

  it("appendedText: the name in bold and the texts, or null", () => {
    expect(appendedText("deliverables", svc({ deliverables_md: "D" }))).toBe("**Alpha and Co**\nD");
    expect(appendedText("assumptions_exclusions", svc())).toBeNull();
  });

  it("servicesOf: distinct, in line order, skipping lines with no catalogue item or no row", () => {
    const a = svc();
    const b = svc({ id: "i2" });
    const items = new Map([
      ["i1", a],
      ["i2", b],
    ]);
    expect(
      servicesOf(
        [
          { catalogueItemId: "i2" },
          { catalogueItemId: null },
          { catalogueItemId: "i1" },
          { catalogueItemId: "i2" },
          { catalogueItemId: "zz" },
        ],
        items,
      ),
    ).toEqual([b, a]);
  });
});
// The draft was made at CREATED; a Catalogue row with `updated_at` after it changed since (review round 2, finding 3).
const CREATED = 1_000;
const NEWER = { updated_at: 2_000 };

describe("gaps and Use Catalogue text", () => {
  it("a hidden section reports every field; Catalogue text it lacks is offered (adding to an empty section repeats nothing)", () => {
    const sections = [sec("deliverables", null, true, "d1"), sec("assumptions_exclusions", null, true, "a1")];
    const gaps = catalogueGaps(sections, [svc({ deliverables_md: "D" })], CREATED);
    expect(gaps.map((g) => [g.field, g.sectionId, g.catalogueHasTextNow])).toEqual([
      ["deliverables", "d1", true],
      ["assumptions", "a1", false],
      ["exclusions", "a1", false],
    ]);
  });

  it("a shown section: Catalogue text is new only when the row changed after the draft was made; the partial case; all there, or no section, no gap", () => {
    const withText = [sec("assumptions_exclusions", "Has A")];
    // Catalogue had the exclusions when the draft was made: they went in then, so their absence now is the person's edit
    expect(catalogueGaps(withText, [svc({ assumptions_md: "Has A", exclusions_md: "E" })], CREATED)).toEqual(
      [],
    );
    // the row changed since: the exclusions are new, and offered
    expect(
      catalogueGaps(
        withText,
        [svc({ assumptions_md: "Has A", exclusions_md: "New E", ...NEWER })],
        CREATED,
      ).map((g) => [g.field, g.catalogueHasTextNow]),
    ).toEqual([["exclusions", true]]);
    // the partial case: Catalogue has the assumptions only
    expect(
      catalogueGaps(withText, [svc({ assumptions_md: "Has A" })], CREATED).map((g) => [
        g.field,
        g.catalogueHasTextNow,
      ]),
    ).toEqual([["exclusions", false]]);
    expect(
      catalogueGaps(
        [sec("assumptions_exclusions", "Has A\nHas E")],
        [svc({ assumptions_md: "Has A", exclusions_md: "Has E", ...NEWER })],
        CREATED,
      ),
    ).toEqual([]);
    expect(
      catalogueGaps([sec("scope", "x")], [svc(), svc({ deliverables_md: "D", ...NEWER })], CREATED),
    ).toEqual([]);
  });

  it("finding 3: a normal edit of the filled text is never called new Catalogue text, and the button adds nothing twice", () => {
    const edited = sec("deliverables", "We will build the site (edited by staff, first words changed)");
    const old = svc({ deliverables_md: "Build the site" });
    expect(catalogueGaps([edited], [old], CREATED)).toEqual([]);
    expect(textToFill(edited, [old], CREATED)).toBeNull();
    // after Catalogue changes, the new text is offered once; once in the section, it is no longer offered
    const changed = svc({ deliverables_md: "Build and launch the site", ...NEWER });
    expect(textToFill(edited, [changed], CREATED)).toBe("**Alpha and Co**\nBuild and launch the site");
    const after = sec("deliverables", `${edited.bodyMd}\n\n**Alpha and Co**\nBuild and launch the site`);
    expect(textToFill(after, [changed], CREATED)).toBeNull();
    expect(catalogueGaps([after], [changed], CREATED)).toEqual([]);
  });

  it("finding 12: a service with no text is named while the section shows another service's text, not when it shows only the person's own", () => {
    const a = svc({ deliverables_md: "A deliv" });
    const b = svc({ id: "i2", code: "S2", name: "Beta" });
    const showsA = [sec("deliverables", "A deliv")];
    expect(
      catalogueGaps(showsA, [a, b], CREATED).map((g) => [g.serviceCode, g.field, g.catalogueHasTextNow]),
    ).toEqual([["S2", "deliverables", false]]);
    // the order of the lines does not matter
    expect(catalogueGaps(showsA, [b, a], CREATED).map((g) => g.serviceCode)).toEqual(["S2"]);
    // a section the person wrote by hand: neither service's Catalogue text is in it, so nothing is named
    expect(catalogueGaps([sec("deliverables", "Our own words")], [b], CREATED)).toEqual([]);
  });

  it("textToFill: the first service plain into a blank section, the rest under names, only what the gaps offer", () => {
    const a = svc({ deliverables_md: "A deliv" });
    const b = svc({ id: "i2", name: "Beta", deliverables_md: "B deliv" });
    const bNew = { ...b, ...NEWER };
    expect(textToFill(sec("deliverables", null), [a, b], CREATED)).toBe("A deliv\n\n**Beta**\nB deliv");
    // Round 3, finding 1: Beta's text went into the section when the save added Beta (`appendServices`), so a section without it holds
    // the person's own edit: it is not new, and not offered again until Catalogue changes
    expect(textToFill(sec("deliverables", "A deliv"), [a, b], CREATED)).toBeNull();
    expect(textToFill(sec("deliverables", "A deliv"), [a, bNew], CREATED)).toBe("**Beta**\nB deliv");
    expect(textToFill(sec("deliverables", "A deliv\n**Beta**\nB deliv"), [a, bNew], CREATED)).toBeNull();
    expect(textToFill(sec("scope", null), [a], CREATED)).toBeNull();
    expect(textToFill(sec("deliverables", null), [svc()], CREATED)).toBeNull();
  });
});

describe("finding 7: a required section is never hidden automatically", () => {
  it("left with no text, an Acceptance or Terms section stays shown; a Deliverables section is hidden", () => {
    const sections = [
      sec("acceptance", "{{service.assumptions}}"),
      sec("terms", "{{service.exclusions}}"),
      sec("deliverables", "{{service.deliverables}}"),
    ];
    const out = fillServiceTokens(sections, [svc()], null);
    expect(out.map((s) => [s.kind, s.bodyMd, s.hidden])).toEqual([
      ["acceptance", null, false],
      ["terms", null, false],
      ["deliverables", null, true],
    ]);
    expect(autoHides("estimate")).toBe(false);
    expect(autoHides("assumptions_exclusions")).toBe(true);
  });
});

describe("round 3, finding 1: a service added to a draft that already has text", () => {
  const a = svc({ deliverables_md: "A deliv", assumptions_md: "A assumes" });
  const b = svc({ id: "i2", code: "S2", name: "Beta", deliverables_md: "B deliv", exclusions_md: "B excl" });

  it("appends each added service's texts under its name, blanks dropped, never a token; other sections are the same objects", () => {
    const sections = [
      sec("deliverables", "A deliv"),
      sec("assumptions_exclusions", "A assumes"),
      sec("scope", "x"),
    ];
    const out = appendServices(sections, [b]);
    expect(out.map((s) => s.bodyMd)).toEqual([
      "A deliv\n\n**Beta**\nB deliv",
      "A assumes\n\n**Beta**\nB excl",
      "x",
    ]);
    expect(out[2]).toBe(sections[2]);
    expect(JSON.stringify(out)).not.toContain("{{");
    // nothing to add: the very same objects (the save tells the sections it wrote by identity)
    const none = appendServices(sections, [svc({ id: "i3", name: "Empty" })]);
    none.forEach((s, i) => {
      expect(s).toBe(sections[i]);
    });
    expect(appendServices(sections, [])).toEqual(sections);
  });

  it("a part the section already holds is not added twice; a section hidden for having no text is shown, one the person hid is not", () => {
    const holds = [
      sec("deliverables", "A deliv\n\n**Beta**\nB deliv"),
      sec("assumptions_exclusions", "B excl"),
    ];
    const out = appendServices(holds, [b]);
    expect(out[0]).toBe(holds[0]);
    expect(out[1]).toBe(holds[1]);
    const closed = appendServices(
      [sec("deliverables", null, true), sec("assumptions_exclusions", "A assumes", true)],
      [b],
    );
    expect(closed.map((s) => [s.bodyMd, s.hidden])).toEqual([
      ["**Beta**\nB deliv", false],
      ["A assumes\n\n**Beta**\nB excl", true],
    ]);
  });

  it("after the append the gaps name only what is still missing, and nothing is offered twice", () => {
    const sections = appendServices(
      [sec("deliverables", "A deliv"), sec("assumptions_exclusions", "A assumes")],
      [b],
    );
    const gaps = catalogueGaps(sections, [a, b], CREATED).map((g) => [
      g.serviceCode,
      g.field,
      g.catalogueHasTextNow,
    ]);
    // A has no exclusions and B no assumptions (both the partial case); B's own texts are in, so nothing is "now"
    expect(gaps).toEqual([
      ["S1", "exclusions", false],
      ["S2", "assumptions", false],
    ]);
    for (const s of sections) expect(textToFill(s, [a, b], CREATED)).toBeNull();
  });
});

describe("round 3, finding 6: when a save's answer carries the gaps", () => {
  const base = { services: ["i1"], sections: [sec("deliverables", "D"), sec("terms", "T")] };
  const withSections = (...sections: ReturnType<typeof sec>[]) => ({ ...base, sections });

  it("only when the services or a Deliverables or Assumptions and exclusions section changed", () => {
    expect(gapInputsChanged(base, { ...base })).toBe(false);
    // another section's text, or a blank written as null or as spaces, changes nothing
    expect(gapInputsChanged(base, withSections(sec("deliverables", "D"), sec("terms", "New")))).toBe(false);
    expect(
      gapInputsChanged(
        { services: [], sections: [sec("deliverables", null)] },
        { services: [], sections: [sec("deliverables", "  ")] },
      ),
    ).toBe(false);
    expect(gapInputsChanged(base, { ...base, services: ["i1", "i2"] })).toBe(true);
    expect(gapInputsChanged(base, { ...base, services: [] })).toBe(true);
    expect(gapInputsChanged(base, withSections(sec("deliverables", "D2"), sec("terms", "T")))).toBe(true);
    expect(gapInputsChanged(base, withSections(sec("deliverables", "D", true), sec("terms", "T")))).toBe(
      true,
    );
    expect(gapInputsChanged(base, withSections(...base.sections, sec("assumptions_exclusions", null)))).toBe(
      true,
    );
  });

  it("serviceIdsOf: the distinct catalogue items in line order", () => {
    expect(
      serviceIdsOf([
        { catalogueItemId: "b" },
        { catalogueItemId: null },
        { catalogueItemId: "a" },
        { catalogueItemId: "b" },
      ]),
    ).toEqual(["b", "a"]);
  });
});
