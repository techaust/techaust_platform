// M6.3 staging fixes, part 3 (lead's decision 2026-11-02, under the owner's delegation; 07-ZM "Review changes"): the PDFs print a line's unit as words, never the
// catalogue code ("1 fixed" on the owner's export invoice for a payment received). Every code the catalogue and the invoice model can store has its words;
// the frozen line keeps its code (layout only); a typed unit of an older document prints as typed.
import { CATALOGUE_UNITS } from "@techaust/core/catalogue";
import { describe, expect, it } from "vitest";
import { toInvoiceView } from "../src/invoice-view.ts";
import { UNIT_WORDS, unitWord } from "../src/layout/copy.ts";
import { renderDocumentHtml } from "../src/render.ts";
import { DEFAULT_VIEW_CONFIG, toPdfView } from "../src/view.ts";
import { buildFixture } from "./fixtures/index.ts";
import { buildInvoiceLayoutFixture } from "./fixtures/invoice-layout.ts";

describe("unit words [07-ZM review changes]", () => {
  it("every catalogue unit code has its words, and nothing else does", () => {
    expect(Object.keys(UNIT_WORDS).sort()).toEqual([...CATALOGUE_UNITS].sort());
  });

  it("the words, word for word: singular for exactly 1, plural otherwise", () => {
    expect(UNIT_WORDS).toEqual({
      fixed: ["lump sum", "lump sums"],
      milestone: ["milestone", "milestones"],
      month: ["month", "months"],
      hour: ["hour", "hours"],
      workflow: ["workflow", "workflows"],
      connector: ["connector", "connectors"],
      document: ["document", "documents"],
    });
    expect(unitWord("fixed", "1")).toBe("lump sum");
    expect(unitWord("fixed", "2")).toBe("lump sums");
    expect(unitWord("hour", "1")).toBe("hour");
    expect(unitWord("hour", "1.5")).toBe("hours");
    expect(unitWord("hour", "0.5")).toBe("hours");
    expect(unitWord("month", "12")).toBe("months");
  });

  it("a unit that is no code prints as typed (older documents); a code-like key of Object does not leak", () => {
    expect(unitWord("days", "2")).toBe("days");
    expect(unitWord("item", "1")).toBe("item");
    expect(unitWord("constructor", "1")).toBe("constructor");
    expect(unitWord("toString", "2")).toBe("toString");
  });

  it("the owner's case prints '1 lump sum'; the frozen line keeps its code", async () => {
    const { envelope, signature } = await buildInvoiceLayoutFixture("advance-export-igst");
    expect(envelope.snapshot.lines[0]?.unit).toBe("fixed");
    const html = renderDocumentHtml(toInvoiceView(envelope, DEFAULT_VIEW_CONFIG, { signature }));
    expect(html).toContain('<td class="num">1 <span class="unit">lump sum</span></td>');
    expect(html).not.toContain(">fixed<");
  });

  it("a proposal's Unit column prints the words too", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    const html = renderDocumentHtml(toPdfView(envelope));
    expect(html).toContain("<td>lump sum</td>");
    expect(html).not.toContain("<td>fixed</td>");
  });
});
