// M5 owner fixes, D1 [ADM-PROP-02, ADM-PROP-05]: the send check in plain words and the Catalogue gaps, as the draft screen works them out
// from the B2 contract (`unresolved_placeholders.where`, `catalogueGaps`). Staff never see the `{{…}}` syntax; every new line is a 07-X line,
// marked until the owner approves it. Also sweep findings 8, 9 and 15 (the list's empty state by type, the Catalogue hint, one blocker for an
// empty invoice).
import { describe, expect, it } from "vitest";
import { APPROVED_07X, CATALOGUE_TEXTS_HINT, PLACEHOLDER_MARK, X } from "./copy-x.ts";
import {
  fieldList,
  GAP_COPY,
  GAP_HIDDEN,
  gapGroups,
  gapLine,
  gapNoRoomLine,
  gapNowLine,
  LIST_EMPTY_BY_TYPE,
  PLACEHOLDER_WORDS,
  placeholderWords,
  type SectionDraft,
  sectionHolesLine,
  sectionTextName,
  unresolvedItem,
  unresolvedItems,
} from "./documents.ts";
import type { CatalogueGap } from "./documents-api.ts";
import { shownBlockers } from "./invoices.ts";

const M = APPROVED_07X ? "" : `${PLACEHOLDER_MARK} `;
const sec = (id: string, kind: string, over: Partial<SectionDraft> = {}): SectionDraft => ({
  uid: `u-${id}`,
  id,
  kind,
  title: "",
  bodyMd: "",
  hidden: false,
  ...over,
});
const source = (over: Partial<Parameters<typeof unresolvedItems>[1]> = {}) => ({
  title: "Portal",
  lines: [{ description: "Portal", detail: "", catalogueItemId: "cat-s5" }],
  sections: [] as SectionDraft[],
  schedule: [] as { label: string; detail: string }[],
  contactId: "c1",
  ...over,
});
const gap = (over: Partial<CatalogueGap>): CatalogueGap => ({
  sectionId: "s-ae",
  sectionKind: "assumptions_exclusions",
  field: "assumptions",
  serviceCode: "S5",
  serviceName: "Custom Web Apps",
  catalogueItemId: "cat-s5",
  catalogueHasTextNow: false,
  noRoom: false,
  ...over,
});

describe("07-X copy", () => {
  it("every new line is unmarked now the owner has approved 07-X (2026-10-29), and says no {{…}}", () => {
    expect(APPROVED_07X).toBe(true);
    expect(X("Line.")).toBe("Line.");
    const lines = [
      ...Object.values(GAP_COPY).filter((l) => l !== GAP_COPY.useCatalogue),
      GAP_HIDDEN,
      CATALOGUE_TEXTS_HINT,
      ...Object.values(LIST_EMPTY_BY_TYPE),
      unresolvedItem("Acceptance", ["client.contact"]),
      sectionHolesLine(["service.deliverables"]),
      gapLine("Custom Web Apps", ["exclusions"]),
      gapNowLine("Custom Web Apps", ["deliverables"]),
    ];
    for (const l of lines) {
      expect(l.startsWith(M)).toBe(true);
      expect(l).not.toContain("[Placeholder");
      expect(l).not.toMatch(/\{\{|\}\}|&/);
    }
    // The brief's own words carry no mark.
    expect(GAP_COPY.useCatalogue).toBe("Use Catalogue text");
    expect(sectionTextName("Deliverables")).toBe("Text of Deliverables");
  });

  it("every template value has words, and a value typed by hand is named without its syntax", () => {
    for (const w of Object.values(PLACEHOLDER_WORDS)) expect(w).not.toMatch(/[{}._]/);
    expect(placeholderWords("client.contact")).toBe("the contact's name");
    expect(placeholderWords("service.deliverables")).toBe("the deliverables");
    expect(placeholderWords("custom.thing")).toBe("a value that can't be filled in");
    expect(unresolvedItem("Acceptance", ["client.contact"])).toBe(
      `${M}Acceptance: waiting for the contact's name.`,
    );
    expect(unresolvedItem(null, ["service.assumptions", "service.exclusions"])).toBe(
      `${M}Waiting for the assumptions and the exclusions.`,
    );
    expect(fieldList(["deliverables", "assumptions", "exclusions"])).toBe(
      "deliverables, assumptions and exclusions",
    );
  });

  it("finding 8: the empty list names the type it shows", () => {
    expect(LIST_EMPTY_BY_TYPE.estimate).toBe(`${M}No estimates yet`);
    expect(LIST_EMPTY_BY_TYPE.proposal).toBe(`${M}No proposals yet`);
  });
});

describe("unresolved_placeholders in plain words", () => {
  it("one item per place, from `where`, each section named so it can be opened", () => {
    const sections = [
      sec("s-acc", "acceptance", { title: "Acceptance" }),
      sec("s-ae", "assumptions_exclusions"),
    ];
    const items = unresolvedItems(
      {
        code: "unresolved_placeholders",
        names: ["client.contact", "service.assumptions", "service.exclusions"],
        where: [
          { name: "client.contact", sectionId: "s-acc", sectionKind: "acceptance", part: "section" },
          {
            name: "service.assumptions",
            sectionId: "s-ae",
            sectionKind: "assumptions_exclusions",
            part: "section",
          },
          {
            name: "service.exclusions",
            sectionId: "s-ae",
            sectionKind: "assumptions_exclusions",
            part: "section",
          },
        ],
      },
      source({ sections, contactId: null }),
    );
    expect(items.map((i) => i.text)).toEqual([
      `${M}Acceptance: waiting for the contact's name.`,
      `${M}Assumptions and exclusions: waiting for the assumptions and the exclusions.`,
    ]);
    expect(items[0]?.place).toEqual({ kind: "section", uid: "u-s-acc", name: "Acceptance" });
    // No contact chosen: the fix is choosing one. A service line exists, so the service values have no fix but writing.
    expect(items[0]?.fixes).toEqual(["contact"]);
    expect(items[1]?.fixes).toEqual([]);
    for (const i of items) expect(i.text).not.toMatch(/\{\{/);
  });

  it("no service line yet: the service values are fixed by adding one", () => {
    const sections = [
      sec("s-d", "deliverables", { title: "Deliverables", bodyMd: "{{service.deliverables}}" }),
    ];
    const [item] = unresolvedItems(
      {
        code: "unresolved_placeholders",
        names: ["service.deliverables"],
        where: [
          { name: "service.deliverables", sectionId: "s-d", sectionKind: "deliverables", part: "section" },
        ],
      },
      source({ sections, lines: [] }),
    );
    expect(item?.fixes).toEqual(["service"]);
  });

  it("title, lines and schedule are places too; a name the server lists that no place holds still shows", () => {
    const items = unresolvedItems(
      {
        code: "unresolved_placeholders",
        names: ["client.name", "company.name", "gone.value"],
        where: [
          { name: "client.name", sectionId: null, sectionKind: null, part: "title" },
          { name: "company.name", sectionId: null, sectionKind: null, part: "line" },
          { name: "client.name", sectionId: null, sectionKind: null, part: "schedule" },
        ],
      },
      source(),
    );
    expect(items.map((i) => i.text)).toEqual([
      `${M}Title: waiting for the client's name.`,
      `${M}Lines: waiting for the company name.`,
      `${M}Payment schedule: waiting for the client's name.`,
      `${M}Waiting for a value that can't be filled in.`,
    ]);
  });

  it("an API without `where`: the places come from the text on screen (hidden sections block nothing)", () => {
    const sections = [
      sec("s-c", "cover", { title: "Cover", bodyMd: "For {{client.contact}}" }),
      sec("s-h", "summary", { title: "Summary", bodyMd: "{{client.contact}}", hidden: true }),
    ];
    const items = unresolvedItems(
      { code: "unresolved_placeholders", names: ["client.contact"] },
      source({ sections }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.place).toEqual({ kind: "section", uid: "u-s-c", name: "Cover" });
  });
});

describe("Catalogue gaps by section", () => {
  it("a hidden section: every service's missing texts, in field order, with the way to Catalogue", () => {
    const sections = [sec("s-ae", "assumptions_exclusions", { hidden: true })];
    const groups = gapGroups(
      [
        gap({ field: "exclusions" }),
        gap({ field: "assumptions" }),
        gap({ catalogueItemId: "cat-s1", serviceName: "Discovery Sprint" }),
      ],
      sections,
      ["s-ae"],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      uid: "u-s-ae",
      name: "Assumptions and exclusions",
      hidden: true,
      canFill: false,
    });
    expect(groups[0]?.services).toEqual([
      { id: "cat-s5", name: "Custom Web Apps", missing: ["assumptions", "exclusions"], now: [], noRoom: [] },
      { id: "cat-s1", name: "Discovery Sprint", missing: ["assumptions"], now: [], noRoom: [] },
    ]);
    expect(gapLine("Custom Web Apps", ["assumptions", "exclusions"])).toBe(
      `${M}Custom Web Apps has no assumptions and exclusions in Catalogue.`,
    );
  });

  it("Catalogue has the text now: the section can be filled", () => {
    const groups = gapGroups(
      [gap({ catalogueHasTextNow: true })],
      [sec("s-ae", "assumptions_exclusions", { hidden: true })],
      ["s-ae"],
    );
    expect(groups[0]?.canFill).toBe(true);
    expect(groups[0]?.services[0]?.now).toEqual(["assumptions"]);
    expect(gapNowLine("Custom Web Apps", ["assumptions"])).toBe(
      `${M}Catalogue now has the assumptions for Custom Web Apps.`,
    );
  });

  it("round 4, M3: text left out for the length limit is its own line with its own link, and offers no fill", () => {
    const long = sec("s-ae", "assumptions_exclusions", { bodyMd: "Long text" });
    const groups = gapGroups(
      [
        gap({ field: "exclusions", noRoom: true }),
        gap({ field: "assumptions", noRoom: true }),
        gap({ field: "deliverables", sectionKind: "deliverables", sectionId: "s-d" }),
      ],
      [long],
      [],
    );
    expect(groups[0]?.services[0]).toEqual({
      id: "cat-s5",
      name: "Custom Web Apps",
      missing: [],
      now: [],
      noRoom: ["assumptions", "exclusions"],
    });
    expect(groups[0]?.canFill).toBe(false);
    expect(gapNoRoomLine("Custom Web Apps", ["assumptions", "exclusions"])).toBe(
      `${M}The assumptions and exclusions for Custom Web Apps were left out: this section has no room for them. To add them, shorten the section and copy them from Catalogue.`,
    );
    expect(GAP_COPY.openInCatalogue).toBe(`${M}Open it in Catalogue`);
  });

  it("the partial case shows on a section that had text; a section the person has since written in drops its gap", () => {
    const withText = sec("s-ae", "assumptions_exclusions", { bodyMd: "We assume a staging server." });
    // Read with text (partial: exclusions missing).
    expect(gapGroups([gap({ field: "exclusions" })], [withText], [])).toHaveLength(1);
    // Hidden or empty when read, and written in since.
    expect(gapGroups([gap({})], [withText], ["s-ae"])).toHaveLength(0);
  });

  it("a gap for a section the draft doesn't hold names the kind and can't be filled here", () => {
    const groups = gapGroups([gap({ sectionId: null, catalogueHasTextNow: true })], [], []);
    expect(groups[0]).toMatchObject({
      uid: null,
      sectionId: null,
      name: "Assumptions and exclusions",
      canFill: false,
    });
  });
});

describe("finding 9 and 15", () => {
  it("the Catalogue hint names both sections", () => {
    expect(CATALOGUE_TEXTS_HINT).toContain("Deliverables section");
    expect(CATALOGUE_TEXTS_HINT).toContain("Assumptions and exclusions section");
  });
  it("an invoice with no lines shows one blocker for it, not the totals it causes", () => {
    const b = [
      { code: "no_lines" },
      { code: "computed_errors" },
      { code: "zero_total" },
      { code: "supplier_gstin" },
    ];
    expect(shownBlockers(b).map((x) => x.code)).toEqual(["no_lines", "supplier_gstin"]);
    const withLines = [{ code: "computed_errors" }, { code: "zero_total" }];
    expect(shownBlockers(withLines)).toEqual(withLines);
  });
});
