import { describe, expect, it } from "vitest";
import { nameOrLegal } from "../src/text.ts";

describe("nameOrLegal", () => {
  it("uses the display name when it has text", () => {
    expect(nameOrLegal("Acme", "Acme Private Limited")).toBe("Acme");
    expect(nameOrLegal("  Acme ", "Acme Private Limited")).toBe("Acme");
  });
  it("falls back to the legal name when the display name is missing, empty or only spaces", () => {
    for (const d of [undefined, null, "", "   ", "\t\n"])
      expect(nameOrLegal(d, "Acme Private Limited")).toBe("Acme Private Limited");
  });
});
