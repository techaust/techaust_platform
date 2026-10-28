// The pure rules of service-fill.ts [ADM-PROP-02]: unknown vs empty tokens, every service counted, the gaps, the text "Use Catalogue text" adds.
import { describe, expect, it } from "vitest";
import {
  appendedText,
  catalogueGaps,
  emptyServiceTokens,
  fillServiceTokens,
  type ServiceFacts,
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

describe("gaps and Use Catalogue text", () => {
  it("a hidden section reports every field; Catalogue text since added says so", () => {
    const sections = [sec("deliverables", null, true, "d1"), sec("assumptions_exclusions", null, true, "a1")];
    const gaps = catalogueGaps(sections, [svc({ deliverables_md: "D" })]);
    expect(gaps.map((g) => [g.field, g.sectionId, g.catalogueHasTextNow])).toEqual([
      ["deliverables", "d1", true],
      ["assumptions", "a1", false],
      ["exclusions", "a1", false],
    ]);
  });

  it("a shown section: text now in Catalogue but not in the section, and the partial case; nothing when it is all there; no section, no gap", () => {
    const withText = [sec("assumptions_exclusions", "Has A")];
    expect(
      catalogueGaps(withText, [svc({ assumptions_md: "Has A", exclusions_md: "New E" })]).map((g) => g.field),
    ).toEqual(["exclusions"]);
    expect(catalogueGaps(withText, [svc({ assumptions_md: "Has A" })]).map((g) => g.field)).toEqual([
      "exclusions",
    ]);
    expect(
      catalogueGaps(
        [sec("assumptions_exclusions", "Has A\nHas E")],
        [svc({ assumptions_md: "Has A", exclusions_md: "Has E" })],
      ),
    ).toEqual([]);
    expect(catalogueGaps([sec("scope", "x")], [svc()])).toEqual([]);
  });

  it("textToFill: the first service plain into a blank section, the rest under names, only the parts not already in", () => {
    const a = svc({ deliverables_md: "A deliv" });
    const b = svc({ id: "i2", name: "Beta", deliverables_md: "B deliv" });
    expect(textToFill({ kind: "deliverables", bodyMd: null }, [a, b])).toBe("A deliv\n\n**Beta**\nB deliv");
    expect(textToFill({ kind: "deliverables", bodyMd: "A deliv" }, [a, b])).toBe("**Beta**\nB deliv");
    expect(textToFill({ kind: "deliverables", bodyMd: "A deliv\n**Beta**\nB deliv" }, [a, b])).toBeNull();
    expect(textToFill({ kind: "scope", bodyMd: null }, [a])).toBeNull();
    expect(textToFill({ kind: "deliverables", bodyMd: null }, [svc()])).toBeNull();
  });
});
