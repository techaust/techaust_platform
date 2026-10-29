// The pure rules of service-fill.ts [ADM-PROP-02]: unknown vs empty tokens, every service counted, the gaps, the text "Use Catalogue text" adds.

import {
  SECTION_BODY_MAX,
  SECTION_TITLE_MAX,
  SECTIONS_TOTAL_MAX,
  TEXT_TOKEN_KINDS,
} from "@techaust/core/documents";
import { describe, expect, it } from "vitest";
import {
  appendServices,
  autoHides,
  catalogueGaps,
  emptyServiceTokens,
  filledBody,
  fillServiceTokens,
  fitFirstService,
  fits,
  GAP_FIELDS,
  gapInputsChanged,
  renderSection,
  renderWithin,
  type ServiceFacts,
  serviceIdsOf,
  servicesOf,
  TEXT_TOKENS,
  TOKEN_FIELD,
  textLength,
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

describe("FX-3 fix round, item 6: the text tokens come from core's TEXT_TOKEN_KINDS [ADM-PROP-02]", () => {
  it("every text token has its Catalogue field, of the same section kind, and nothing else", () => {
    expect(TEXT_TOKENS).toEqual(Object.keys(TEXT_TOKEN_KINDS));
    expect([...TOKEN_FIELD.keys()]).toEqual([...TEXT_TOKENS]);
    expect(Object.fromEntries(TOKEN_FIELD)).toEqual({
      "service.deliverables": "deliverables",
      "service.assumptions": "assumptions",
      "service.exclusions": "exclusions",
    });
    for (const [token, field] of TOKEN_FIELD)
      expect(GAP_FIELDS.find((g) => g.field === field)?.kind).toBe(TEXT_TOKEN_KINDS[token]);
  });
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
/** "Use Catalogue text" on a one-section document: the section's text after, or null. */
const fill = (s: ReturnType<typeof sec>, services: ServiceFacts[]) =>
  filledBody(s, services, CREATED, s.bodyMd?.length ?? 0);

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
    expect(fill(edited, [old])).toBeNull();
    // after Catalogue changes, the new text is offered once, into the service's own block (round 5: the unheaded opening is the first
    // service's block, so it goes at its end, with no heading); once in the section, it is no longer offered
    const changed = svc({ deliverables_md: "Build and launch the site", ...NEWER });
    const after = sec("deliverables", `${edited.bodyMd}\nBuild and launch the site`);
    expect(fill(edited, [changed])).toBe(after.bodyMd);
    expect(fill(after, [changed])).toBeNull();
    expect(catalogueGaps([after], [changed], CREATED)).toEqual([]);
  });

  it("finding 12: a service with no text is named while the section shows another service's text, not when it shows only the person's own", () => {
    const a = svc({ deliverables_md: "A deliv" });
    const b = svc({ id: "i2", code: "S2", name: "Beta" });
    const showsA = [sec("deliverables", "A deliv")];
    expect(
      catalogueGaps(showsA, [a, b], CREATED).map((g) => [g.serviceCode, g.field, g.catalogueHasTextNow]),
    ).toEqual([["S2", "deliverables", false]]);
    // with B's line first, the unheaded opening is B's block (round 5, the block rule): A has no block and its text is B's to keep, so
    // nobody is named (A's text is offered again, under its name, only once its Catalogue row changes: the documented limit)
    expect(catalogueGaps(showsA, [b, a], CREATED)).toEqual([]);
    expect(
      catalogueGaps([sec("deliverables", "**Alpha and Co**\nA deliv")], [b, a], CREATED).map(
        (g) => g.serviceCode,
      ),
    ).toEqual(["S2"]);
    // a section the person wrote by hand: neither service's Catalogue text is in it, so nothing is named
    expect(catalogueGaps([sec("deliverables", "Our own words")], [b], CREATED)).toEqual([]);
  });

  it("filledBody: the first service plain into a blank section, the rest under names, only what the gaps offer", () => {
    const a = svc({ deliverables_md: "A deliv" });
    const b = svc({ id: "i2", name: "Beta", deliverables_md: "B deliv" });
    const bNew = { ...b, ...NEWER };
    expect(fill(sec("deliverables", null), [a, b])).toBe("A deliv\n\n**Beta**\nB deliv");
    // Round 3, finding 1: Beta's text went into the section when the save added Beta (`appendServices`), so a section without it holds
    // the person's own edit: it is not new, and not offered again until Catalogue changes
    expect(fill(sec("deliverables", "A deliv"), [a, b])).toBeNull();
    expect(fill(sec("deliverables", "A deliv"), [a, bNew])).toBe("A deliv\n\n**Beta**\nB deliv");
    expect(fill(sec("deliverables", "A deliv\n**Beta**\nB deliv"), [a, bNew])).toBeNull();
    expect(fill(sec("scope", null), [a])).toBeNull();
    expect(fill(sec("deliverables", null), [svc()])).toBeNull();
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
    const out = appendServices(sections, [b], [a, b]);
    expect(out.map((s) => s.bodyMd)).toEqual([
      "A deliv\n\n**Beta**\nB deliv",
      "A assumes\n\n**Beta**\nB excl",
      "x",
    ]);
    expect(out[2]).toBe(sections[2]);
    expect(JSON.stringify(out)).not.toContain("{{");
    // nothing to add: the very same objects (the save tells the sections it wrote by identity)
    const empty = svc({ id: "i3", name: "Empty" });
    const none = appendServices(sections, [empty], [a, empty]);
    none.forEach((s, i) => {
      expect(s).toBe(sections[i]);
    });
    expect(appendServices(sections, [], [a])).toEqual(sections);
  });

  it("a part the section already holds is not added twice; a section hidden for having no text is shown, one the person hid is not", () => {
    const holds = [
      sec("deliverables", "A deliv\n\n**Beta**\nB deliv"),
      sec("assumptions_exclusions", "A assumes\n\n**Beta**\nB excl"),
    ];
    const out = appendServices(holds, [b], [a, b]);
    expect(out[0]).toBe(holds[0]);
    expect(out[1]).toBe(holds[1]);
    // round 5: the same line in A's block (the unheaded opening) is A's, so B still gets its own block
    const inA = [sec("assumptions_exclusions", "B excl")];
    expect(appendServices(inA, [b], [a, b])[0]?.bodyMd).toBe("B excl\n\n**Beta**\nB excl");
    const closed = appendServices(
      [sec("deliverables", null, true), sec("assumptions_exclusions", "A assumes", true)],
      [b],
      [a, b],
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
      [a, b],
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
    for (const s of sections) expect(fill(s, [a, b])).toBeNull();
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

  it("round 4, L6: moving a section is no change (the gaps read one section of each kind); taking one out is", () => {
    const two = [sec("deliverables", "D"), sec("assumptions_exclusions", "A")];
    expect(
      gapInputsChanged({ ...base, sections: two }, { ...base, sections: [two[1], two[0]] as typeof two }),
    ).toBe(false);
    expect(gapInputsChanged({ ...base, sections: two }, { ...base, sections: [two[0]] as typeof two })).toBe(
      true,
    );
    // a section of the same kind under a new id (a new section) is a change
    expect(
      gapInputsChanged(
        { ...base, sections: two },
        { ...base, sections: [sec("deliverables", "D", false, "new"), two[1]] as typeof two },
      ),
    ).toBe(true);
  });
});

describe("round 4, M1: a part goes into its service's own block", () => {
  const beta = (over: Partial<ServiceFacts> = {}) =>
    svc({
      id: "i2",
      code: "S2",
      name: "Beta",
      assumptions_md: "B assumes",
      exclusions_md: "B excl",
      ...over,
    });

  it("a part goes into its service's own block (assumptions before its exclusions, else at the block's end), else a new block; never a second heading", () => {
    const a = svc({ assumptions_md: "A assumes", exclusions_md: "A excl" });
    const b = beta();
    const g = svc({ id: "i3", code: "S3", name: "Gamma" });
    // "Use Catalogue text" once Beta's row changed: the parts its block lacks go in by the block rule
    const put = (body: string) => fill(sec("assumptions_exclusions", body), [a, { ...b, ...NEWER }, g]);
    expect(put("A assumes\nA excl\n\n**Beta**\nB excl")).toBe(
      "A assumes\nA excl\n\n**Beta**\nB assumes\nB excl",
    );
    expect(put("A assumes\nA excl\n\n**Beta**\nB assumes\n\n**Gamma**\nG")).toBe(
      "A assumes\nA excl\n\n**Beta**\nB assumes\nB excl\n\n**Gamma**\nG",
    );
    // no part of Beta's own left, but its heading: at the end of its block
    expect(put("A assumes\n\n**Beta**\nOur words\n\n**Gamma**\nG")).toBe(
      "A assumes\n\n**Beta**\nOur words\nB assumes\nB excl\n\n**Gamma**\nG",
    );
    // no block: a new one under its name
    expect(put("A assumes")).toBe("A assumes\n\n**Beta**\nB assumes\nB excl");
  });

  it("Use Catalogue text puts a service's new exclusions into its block, with no second **Name** heading", () => {
    const a = svc({ assumptions_md: "A assumes" });
    const b = beta({ exclusions_md: "B excl new", ...NEWER });
    const section = sec("assumptions_exclusions", "A assumes\n\n**Beta**\nB assumes");
    const after = fill(section, [a, b]);
    expect(after).toBe("A assumes\n\n**Beta**\nB assumes\nB excl new");
    expect(after?.match(/\*\*Beta\*\*/g)).toHaveLength(1);
    // the first service's own block too: its new exclusions follow its assumptions, above Beta's block
    const a2 = svc({ assumptions_md: "A assumes", exclusions_md: "A excl", ...NEWER });
    expect(
      fill(sec("assumptions_exclusions", "A assumes\n\n**Beta**\nB assumes\nB excl"), [a2, beta()]),
    ).toBe("A assumes\nA excl\n\n**Beta**\nB assumes\nB excl");
  });

  it("round 5, finding 4: a service taken out and put back finds its block as the person left it: nothing is added or repeated", () => {
    const b = beta();
    const s = [sec("assumptions_exclusions", "A\n\n**Beta**\nB assumes")];
    expect(appendServices(s, [b], [svc(), b])[0]).toBe(s[0]);
    // its block edited: the Catalogue text is not put back under the edit
    const edited = [sec("assumptions_exclusions", "A\n\n**Beta**\nB assumes, as agreed on the call\nB excl")];
    expect(appendServices(edited, [b], [svc(), b])[0]).toBe(edited[0]);
    // and the gaps don't call it missing (the block is the person's) until Catalogue changes
    expect(catalogueGaps(edited, [svc(), b], CREATED).filter((g) => g.serviceCode === "S2")).toEqual([]);
    expect(
      catalogueGaps(edited, [svc(), { ...b, ...NEWER }], CREATED)
        .filter((g) => g.serviceCode === "S2")
        .map((g) => [g.serviceCode, g.field, g.catalogueHasTextNow]),
    ).toEqual([["S2", "assumptions", true]]);
  });
});

describe("round 5: the block rule, end to end through the pure rules", () => {
  const shared = "Third-party fees are billed separately.";
  // the reviewer's case: two services share an exclusion line
  const s5 = svc({
    id: "i5",
    code: "S5",
    name: "Web build",
    assumptions_md: "S5 assumes",
    exclusions_md: shared,
  });
  const s6 = svc({
    id: "i6",
    code: "S6",
    name: "Hosting",
    assumptions_md: "S6 assumes",
    exclusions_md: shared,
  });
  const tpl = () => [sec("assumptions_exclusions", "{{service.assumptions}}\n{{service.exclusions}}")];

  it("creation with shared texts: each service gets its own block with its own copy of the shared line", () => {
    const out = fillServiceTokens(tpl(), [s5, s6], null);
    expect(out[0]?.bodyMd).toBe(`S5 assumes\n${shared}\n\n**Hosting**\nS6 assumes\n${shared}`);
    expect(catalogueGaps(out, [s5, s6], CREATED)).toEqual([]);
    // the same through the creation path's append
    const created = appendServices([sec("assumptions_exclusions", `S5 assumes\n${shared}`)], [s6], [s5, s6]);
    expect(created[0]?.bodyMd).toBe(out[0]?.bodyMd);
  });

  it("a part lands in its own service's block, never before or after the other service's copy of a shared line", () => {
    // S5 has no assumptions in Catalogue when the draft is made; S6 later gets new assumptions
    const s5bare = { ...s5, assumptions_md: null };
    const made = fillServiceTokens(tpl(), [s5bare, { ...s6, assumptions_md: null }], null);
    expect(made[0]?.bodyMd).toBe(`${shared}\n\n**Hosting**\n${shared}`);
    const s6new = { ...s6, ...NEWER };
    const after = filledBody(
      made[0] as ReturnType<typeof sec>,
      [s5bare, s6new],
      CREATED,
      made[0]?.bodyMd?.length ?? 0,
    );
    // S6's assumptions go before S6's OWN copy of the line, not before S5's
    expect(after).toBe(`${shared}\n\n**Hosting**\nS6 assumes\n${shared}`);
  });

  it("'None.' inside another service's sentence is not the service's 'None.'", () => {
    const a = svc({ deliverables_md: "Hosting is None. of our concern." });
    const b = svc({ id: "i2", code: "S2", name: "Beta", deliverables_md: "None." });
    const out = appendServices([sec("deliverables", "Hosting is None. of our concern.")], [b], [a, b]);
    expect(out[0]?.bodyMd).toBe("Hosting is None. of our concern.\n\n**Beta**\nNone.");
    // and a whole "None." line in A's block is A's, not B's
    const out2 = appendServices([sec("deliverables", "None.")], [b], [svc({ deliverables_md: "None." }), b]);
    expect(out2[0]?.bodyMd).toBe("None.\n\n**Beta**\nNone.");
  });

  it("a two-paragraph Catalogue text is held whole: never offered or added again; a part goes after it, inside the block", () => {
    const two = "We build the pages.\n\nWe test them on phones.";
    const a = svc({ deliverables_md: "A deliv" });
    const b = svc({ id: "i2", code: "S2", name: "Beta", deliverables_md: two });
    const out = appendServices([sec("deliverables", "A deliv")], [b], [a, b]);
    expect(out[0]?.bodyMd).toBe(`A deliv\n\n**Beta**\n${two}`);
    expect(catalogueGaps(out, [a, { ...b, ...NEWER }], CREATED)).toEqual([]);
    expect(fill(out[0] as ReturnType<typeof sec>, [a, { ...b, ...NEWER }])).toBeNull();
    // Beta's assumptions after its two-paragraph exclusions: still in Beta's block, above the next service
    const c = svc({ id: "i3", code: "S3", name: "Gamma", exclusions_md: "G excl" });
    const be = svc({
      id: "i2",
      code: "S2",
      name: "Beta",
      exclusions_md: two,
      assumptions_md: "B assumes",
      ...NEWER,
    });
    const body = `A\n\n**Beta**\n${two}\n\n**Gamma**\nG excl`;
    expect(fill(sec("assumptions_exclusions", body), [svc(), be, c])).toBe(
      `A\n\n**Beta**\nB assumes\n${two}\n\n**Gamma**\nG excl`,
    );
  });

  it("finding 3: the room check counts only the parts that would be put in, never a part the person took out", () => {
    const long = "x".repeat(2400);
    // Beta's long assumptions were taken out by the person; its exclusions are new in Catalogue and short
    const b = svc({
      id: "i2",
      code: "S2",
      name: "Beta",
      assumptions_md: long,
      exclusions_md: "B excl new",
      ...NEWER,
    });
    const filler = "f".repeat(5_900);
    const section = sec("assumptions_exclusions", `${filler}\n\n**Beta**\nOur words`);
    const gaps = catalogueGaps([section], [svc(), b], CREATED).filter((g) => g.serviceCode === "S2");
    // with the row changed, both parts are offered together (per row: L1) and together have no room…
    expect(gaps.map((g) => [g.field, g.noRoom, g.catalogueHasTextNow])).toEqual([
      ["assumptions", true, false],
      ["exclusions", true, false],
    ]);
    // …but with the row unchanged nothing is offered, and nothing is called "no room": Beta has a block, so the person took it out
    expect(catalogueGaps([section], [svc(), { ...b, updated_at: 0 }], CREATED)).toEqual([]);
  });

  it("a person-edited heading: the service has no block there, so its text is not taken for held, and nothing goes under the edit", () => {
    const a = svc({ deliverables_md: "A deliv" });
    const b = svc({ id: "i2", code: "S2", name: "Beta", deliverables_md: "B deliv", ...NEWER });
    const body = "A deliv\n\n**Beta (phase 1)**\nB deliv";
    expect(fill(sec("deliverables", body), [a, b])).toBe(`${body}\n\n**Beta**\nB deliv`);
  });
});

describe("round 4, L3: appendServices compares whole texts", () => {
  it("a service whose text begins like one the section holds still gets its own text", () => {
    const common =
      "The client provides every text, image and login before the work starts, and answers within two days.";
    const b = svc({ id: "i2", name: "Beta", deliverables_md: `${common} Beta also needs the brand files.` });
    const out = appendServices([sec("deliverables", common)], [b], [svc(), b]);
    expect(out[0]?.bodyMd).toBe(`${common}\n\n**Beta**\n${common} Beta also needs the brand files.`);
    // the very same text, whole, in the service's own block is not repeated (spaces around it don't count)
    const same = svc({ id: "i3", name: "Gamma", deliverables_md: `  ${common}\n` });
    const kept = [sec("deliverables", `${common}\n\n**Gamma**\n${common}`)];
    expect(appendServices(kept, [same], [svc(), same])[0]).toBe(kept[0]);
    // round 5: the same text in ANOTHER service's block (here the first service's opening) is that service's; Gamma gets its own block
    expect(appendServices([sec("deliverables", common)], [same], [svc(), same])[0]?.bodyMd).toBe(
      `${common}\n\n**Gamma**\n${common}`,
    );
  });
});

describe("round 4, M3: an addition that would pass a length limit is left out and named, never a refusal", () => {
  const long = (n: number, c = "x") => c.repeat(n);
  const big = (id: string, name: string, n: number) =>
    svc({ id, code: id.toUpperCase(), name, deliverables_md: long(n, name[0]) });

  it("fits: the section's own limit and the document's total", () => {
    expect(fits(null, long(SECTION_BODY_MAX), SECTION_BODY_MAX)).toBe(true);
    expect(fits(null, long(SECTION_BODY_MAX + 1), 0)).toBe(false);
    expect(fits("ab", "abcd", SECTIONS_TOTAL_MAX - 2)).toBe(true);
    expect(fits("ab", "abcde", SECTIONS_TOTAL_MAX - 2)).toBe(false);
    expect(textLength([sec("a", "12"), sec("b", null), sec("c", "345")])).toBe(5);
  });

  it("appendServices: the service that would pass 6,000 characters is skipped for that section, a later one that fits still goes in", () => {
    const sections = [sec("deliverables", long(3000, "a")), sec("assumptions_exclusions", "A")];
    const tooBig = svc({
      id: "i2",
      code: "S2",
      name: "Beta",
      deliverables_md: long(2500, "b"),
      exclusions_md: "B excl",
    });
    const third = big("i3", "Gamma", 2400);
    // 3000 + 2500 fits; Gamma's 2400 more does not; Delta's 100 does
    const fourth = big("i4", "Delta", 100);
    const first = svc({ deliverables_md: long(3000, "a") });
    const out = appendServices(sections, [tooBig, third, fourth], [first, tooBig, third, fourth]);
    const body = out[0]?.bodyMd ?? "";
    expect(body.length).toBeLessThanOrEqual(SECTION_BODY_MAX);
    expect(body).toContain("**Beta**");
    expect(body).not.toContain("**Gamma**");
    expect(body).toContain("**Delta**");
    // the other section still gets Beta's exclusions
    expect(out[1]?.bodyMd).toBe("A\n\n**Beta**\nB excl");
    // the gap names Gamma, as left out for the limit (not as text to fill)
    const gaps = catalogueGaps(out, [first, tooBig, third, fourth], CREATED);
    expect(gaps.filter((g) => g.noRoom).map((g) => [g.serviceCode, g.field, g.catalogueHasTextNow])).toEqual([
      ["I3", "deliverables", false],
    ]);
    // "Use Catalogue text" adds nothing past the limit
    expect(
      filledBody(
        out[0] as ReturnType<typeof sec>,
        [tooBig, { ...third, ...NEWER }],
        CREATED,
        textLength(out),
      ),
    ).toBeNull();
  });

  it("the document's 30,000 characters count too", () => {
    const filler = Array.from({ length: 5 }, (_, n) =>
      sec(`custom${n}`, long(SECTION_BODY_MAX - 10), false, `c${n}`),
    );
    const sections = [...filler, sec("deliverables", "D")];
    expect(textLength(sections)).toBe(29_951);
    const b = big("i2", "Beta", 100);
    const a = svc({ deliverables_md: "D" });
    const out = appendServices(sections, [b], [a, b]);
    expect(out[5]).toBe(sections[5]);
    expect(catalogueGaps(out, [a, b], CREATED).map((g) => [g.field, g.noRoom])).toEqual([
      ["deliverables", true],
    ]);
  });

  it("fillServiceTokens (the save that adds the first lines) skips the later service that would not fit", () => {
    const a = big("i1", "Alpha", 2500);
    const b = big("i2", "Beta", 2500);
    const c = big("i3", "Gamma", 2500);
    const out = fillServiceTokens([sec("deliverables", "{{service.deliverables}}")], [a, b, c], null);
    const body = out[0]?.bodyMd ?? "";
    expect(body.length).toBeLessThanOrEqual(SECTION_BODY_MAX);
    expect(body).toContain("**Beta**");
    expect(body).not.toContain("**Gamma**");
  });
});

describe("FX-3 round 2: the first service's own template fill keeps to the limits, leaves out and names [ADM-PROP-02]", () => {
  const long = (n: number, c = "x") => c.repeat(n);
  // A staff-edited template: about 2,000 characters of its own words around both tokens; both Catalogue texts at their 2,500 limit.
  const words = long(1950, "t");
  const aexTemplate = `${words}\n\n{{service.assumptions}}\n\n{{service.exclusions}}\n\nEnd.`;
  const first = svc({
    deliverables_md: "A delivers",
    assumptions_md: long(2500, "a"),
    exclusions_md: long(2500, "e"),
  });

  it("the section with no room keeps the template's words without the texts; the other section is filled; both parts are named noRoom", () => {
    const sections = [
      sec("deliverables", "{{service.deliverables}}"),
      sec("assumptions_exclusions", aexTemplate),
    ];
    const out = fillServiceTokens(sections, [first], null);
    expect(out[0]?.bodyMd).toBe("A delivers");
    expect(out[1]?.bodyMd).toBe(`${words}\n\nEnd.`);
    expect(out[1]?.hidden).toBe(false);
    for (const s of out) expect((s.bodyMd ?? "").length).toBeLessThanOrEqual(SECTION_BODY_MAX);
    const gaps = catalogueGaps(out, [first], CREATED);
    expect(gaps.map((g) => [g.field, g.noRoom, g.catalogueHasTextNow])).toEqual([
      ["assumptions", true, false],
      ["exclusions", true, false],
    ]);
    // "Use Catalogue text" has nothing it may add
    expect(filledBody(out[1] as ReturnType<typeof sec>, [first], CREATED, textLength(out))).toBeNull();
  });

  it("a text that fits is put in as the template says (as before)", () => {
    const small = svc({ assumptions_md: "A assumes", exclusions_md: "A excludes" });
    const out = fillServiceTokens([sec("assumptions_exclusions", aexTemplate)], [small], null);
    expect(out[0]?.bodyMd).toBe(`${words}\n\nA assumes\n\nA excludes\n\nEnd.`);
    expect(catalogueGaps(out, [small], CREATED)).toEqual([]);
  });

  it("a repeated token that would pass 6,000 puts the text in once, by the block rule; nothing is named", () => {
    const d = svc({ deliverables_md: long(2500, "d") });
    const tpl = "{{service.deliverables}}\n\n{{service.deliverables}}\n\n{{service.deliverables}}";
    const out = fillServiceTokens([sec("deliverables", tpl)], [d], null);
    expect(out[0]?.bodyMd).toBe(long(2500, "d"));
    expect(catalogueGaps(out, [d], CREATED)).toEqual([]);
  });

  it("only the parts whose tokens the template held go in by the block rule", () => {
    // the template holds the assumptions token twice and never the exclusions one
    const s = svc({ assumptions_md: long(2500, "a"), exclusions_md: "Never here" });
    const tpl = `${long(1000, "t")}\n{{service.assumptions}}\n{{service.assumptions}}`;
    const out = fillServiceTokens([sec("assumptions_exclusions", tpl)], [s], null);
    expect(out[0]?.bodyMd).toBe(`${long(1000, "t")}\n${long(2500, "a")}`);
  });

  it("the document's 30,000 characters: a section left with no text is hidden and named", () => {
    const filler = Array.from({ length: 5 }, (_, n) =>
      sec(`custom${n}`, long(SECTION_BODY_MAX - 10), false, `c${n}`),
    );
    const d = svc({ deliverables_md: long(100, "d") });
    const out = fillServiceTokens([...filler, sec("deliverables", "{{service.deliverables}}")], [d], null);
    expect(out[5]?.bodyMd).toBeNull();
    expect(out[5]?.hidden).toBe(true);
    expect(textLength(out)).toBeLessThanOrEqual(SECTIONS_TOTAL_MAX);
    expect(catalogueGaps(out, [d], CREATED).map((g) => [g.field, g.noRoom])).toEqual([
      ["deliverables", true],
    ]);
  });

  it("the first service comes before the later ones; a later service that fits still gets its block", () => {
    const b = svc({ id: "i2", code: "S2", name: "Beta", exclusions_md: "B excludes" });
    const out = fillServiceTokens([sec("assumptions_exclusions", aexTemplate)], [first, b], null);
    expect(out[0]?.bodyMd).toBe(`${words}\n\nEnd.\n\n**Beta**\nB excludes`);
    const gaps = catalogueGaps(out, [first, b], CREATED);
    expect(gaps.filter((g) => g.noRoom).map((g) => [g.serviceCode, g.field])).toEqual([
      ["S1", "assumptions"],
      ["S1", "exclusions"],
    ]);
  });

  it("a section title that would pass 120 characters takes the title without the text", () => {
    const d = svc({ deliverables_md: long(200, "d") });
    const out = fillServiceTokens(
      [{ ...sec("deliverables", "{{service.deliverables}}"), title: "What {{service.deliverables}}" }],
      [d],
      null,
    );
    expect(out[0]?.title).toBe("What");
    expect(out[0]?.bodyMd).toBe(long(200, "d"));
  });

  it("a section of another kind is kept within the limit too (left out, not named: the gaps read only the two service sections)", () => {
    const d = svc({ deliverables_md: long(2500, "d") });
    const tpl = `${long(1900, "s")}\n{{service.deliverables}}\n{{service.deliverables}}`;
    const out = fillServiceTokens([sec("scope", tpl)], [d], null);
    expect(out[0]?.bodyMd).toBe(long(1900, "s"));
    expect(catalogueGaps(out, [d], CREATED)).toEqual([]);
  });

  it("fitFirstService: no service gives the full render; a row with no text token is passed through", () => {
    const row = {
      kind: "scope",
      raw: "x",
      full: { title: "t", bodyMd: "x" },
      bare: { title: "t", bodyMd: "x" },
    };
    expect(fitFirstService([row], [])).toEqual([{ title: "t", bodyMd: "x", leftOut: false }]);
    expect(fitFirstService([row], [first])).toEqual([{ title: "t", bodyMd: "x", leftOut: false }]);
  });

  it("the person's edit is still not named (L1): a block that holds one of the parts, or none while they would fit", () => {
    const s = svc({ assumptions_md: long(2500, "a"), exclusions_md: long(2500, "e") });
    // the first service's opening holds its exclusions, not its assumptions, and the section has no room for them: the person's edit
    const holdsOne = [sec("assumptions_exclusions", `${long(3000, "p")}\n${long(2500, "e")}`)];
    expect(catalogueGaps(holdsOne, [s], CREATED)).toEqual([]);
    // the opening holds none of them, and they would fit: the person took them out
    expect(catalogueGaps([sec("assumptions_exclusions", "Our own words")], [s], CREATED)).toEqual([]);
  });
});

describe("FX-3 round 3, Q1: a value that would take a section title past 120 characters stays unfilled [ADM-PROP-02]", () => {
  it("renderSection: the title keeps the token, the text is filled, the title stays within the limit", () => {
    const name = "N".repeat(110);
    const r = renderSection(
      { title: "Proposal for {{client.name}}", bodyMd: "Dear {{client.name}}" },
      { "client.name": name },
      new Set(),
    );
    expect(r.title).toBe("Proposal for {{client.name}}");
    expect(r.bodyMd).toBe(`Dear ${name}`);
    // a name that fits is filled as before
    const ok = renderSection(
      { title: "For {{client.name}}", bodyMd: null },
      { "client.name": "Acme" },
      new Set(),
    );
    expect(ok).toEqual({ title: "For Acme", bodyMd: null });
    // a text left with nothing in it is null
    const none = renderSection(
      { title: "T", bodyMd: "{{service.short}}" },
      { "service.short": null },
      new Set(["service.short"]),
    );
    expect(none.bodyMd).toBeNull();
  });

  it("the save that adds the first service: a long service name stays unfilled in the title, a short one fills", () => {
    const titled = () => ({
      ...sec("deliverables", "{{service.deliverables}}"),
      title: "Deliverables of {{service.name}}",
    });
    const out = fillServiceTokens(
      [titled()],
      [svc({ name: "S".repeat(118), deliverables_md: "Ships" })],
      null,
    );
    expect(out[0]?.title).toBe("Deliverables of {{service.name}}");
    expect((out[0]?.title ?? "").length).toBeLessThanOrEqual(SECTION_TITLE_MAX);
    expect(out[0]?.bodyMd).toBe("Ships");
    const short = fillServiceTokens([titled()], [svc({ name: "Audit", deliverables_md: "Ships" })], null);
    expect(short[0]?.title).toBe("Deliverables of Audit");
  });
});

describe("FX-3 round 3, Q2: short values keep every text within 6,000 and the document within 30,000 [ADM-PROP-02]", () => {
  const many = "{{service.name}} ".repeat(117); // 1,989 characters of template
  const name = "N".repeat(60);

  it("renderWithin: a text the values would take past 6,000 keeps the values that would pass it unfilled", () => {
    const out = renderWithin([{ title: "T", bodyMd: `${many}${many}` }], { "service.name": name }, new Set());
    const body = out[0]?.bodyMd ?? "";
    expect(body.length).toBeLessThanOrEqual(SECTION_BODY_MAX);
    expect(body).toContain(name);
    expect(body).toContain("{{service.name}}");
    // the values come first, in order: no unfilled value before a filled one
    expect(body.indexOf("{{service.name}}")).toBeGreaterThan(body.lastIndexOf(name));
  });

  it("renderWithin: the document's 30,000 is shared out in section order, and a section that is not filled counts as it stands", () => {
    const sections = Array.from({ length: 6 }, () => ({
      title: "T",
      bodyMd: `${"x".repeat(4_900)} {{service.name}}`,
    }));
    const out = renderWithin(sections, { "service.name": name }, new Set());
    expect(textLength(out)).toBeLessThanOrEqual(SECTIONS_TOTAL_MAX);
    // 6 x 4,917 = 29,502 before, so 498 are left; each fill adds 44: all six fit
    expect(out.every((s) => s.bodyMd?.endsWith(name))).toBe(true);
    // 6 x 4,983 = 29,898 before, so 102 are left: two fills fit, the third would pass 30,000
    const tight = Array.from({ length: 6 }, () => ({
      title: "T",
      bodyMd: `${"x".repeat(4_966)} {{service.name}}`,
    }));
    const t = renderWithin(tight, { "service.name": name }, new Set());
    expect(textLength(t)).toBeLessThanOrEqual(SECTIONS_TOTAL_MAX);
    expect(t.map((s) => s.bodyMd?.endsWith(name))).toEqual([true, true, false, false, false, false]);
    // `held` false: the section is returned as it is, and still counts
    const kept = renderWithin(tight, { "service.name": name }, new Set(), [
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(kept[0]).toBe(tight[0]);
    expect(kept.map((s) => s.bodyMd?.endsWith(name))).toEqual([false, true, true, false, false, false]);
  });

  it("the save that adds the first service: a long template of short values saves within the limits", () => {
    const out = fillServiceTokens(
      [{ ...sec("scope", `${many}${many}`) }],
      [svc({ name, deliverables_md: "Ships" })],
      null,
    );
    expect((out[0]?.bodyMd ?? "").length).toBeLessThanOrEqual(SECTION_BODY_MAX);
    expect(out[0]?.bodyMd).toContain("{{service.name}}");
  });
});
