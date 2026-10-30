// Staff names in a menu (final sweep A20): two people with one name are told apart by their work email; everyone else is their name alone.
import { describe, expect, it } from "vitest";
import { NAME_NOT_SET, personLabel, personLabels } from "./people.ts";

describe("staff names in a menu (final sweep A20) [ADM-TIME-01, ADM-LEAD-03]", () => {
  const sam1 = { id: "u1", name: "Sam Same", email: "sam.one@example.test" };
  const sam2 = { id: "u2", name: "sam same ", email: "sam.two@example.test" };
  const ria = { id: "u3", name: "Ria", email: "ria@example.test" };

  it("a unique name stays the name alone", () => {
    const l = personLabels([sam1, ria]);
    expect(personLabel(l, sam1)).toBe("Sam Same");
    expect(personLabel(l, ria)).toBe("Ria");
  });

  it("a repeated name (any case, outer spaces) shows each person's email", () => {
    const l = personLabels([sam1, sam2, ria]);
    expect(personLabel(l, sam1)).toBe("Sam Same (sam.one@example.test)");
    expect(personLabel(l, sam2)).toBe("sam same (sam.two@example.test)");
    expect(personLabel(l, ria)).toBe("Ria");
    expect(new Set([personLabel(l, sam1), personLabel(l, sam2)]).size).toBe(2);
  });

  it("two people without a name are both 'Name not set yet', told apart by email", () => {
    const a = { id: "a", name: "", email: "a@example.test" };
    const b = { id: "b", name: "  ", email: "b@example.test" };
    const l = personLabels([a, b]);
    expect(personLabel(l, a)).toBe(`${NAME_NOT_SET} (a@example.test)`);
    expect(personLabel(l, b)).toBe(`${NAME_NOT_SET} (b@example.test)`);
  });

  it("'(you)' marks the reader's own name; the other person of that name shows their email", () => {
    const l = personLabels([sam1, sam2], "u1");
    expect(personLabel(l, sam1)).toBe("Sam Same (you)");
    expect(personLabel(l, sam2)).toBe("sam same (sam.two@example.test)");
  });

  it("an older answer without emails keeps the names", () => {
    const l = personLabels([
      { id: "x", name: "Sam" },
      { id: "y", name: "Sam" },
    ]);
    expect(personLabel(l, { id: "x", name: "Sam" })).toBe("Sam");
    expect(personLabel(new Map(), { id: "z", name: "" })).toBe(NAME_NOT_SET);
  });
});
