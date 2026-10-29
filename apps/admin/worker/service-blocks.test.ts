// The block rule of a section's service text (service-blocks.ts) [ADM-PROP-02]; lead's decision 2026-10-29 (docs/13), review of round 4,
// findings 1, 3, 4 and 6: one block per service under its `**Name**` heading, the first service's unheaded opening, whole lines only.
import { describe, expect, it } from "vitest";
import { type BlockService, hasBlock, holdsText, insertParts, parseBlocks } from "./service-blocks.ts";

const A: BlockService = { id: "a", name: "Alpha" };
const B: BlockService = { id: "b", name: "Beta" };
const C: BlockService = { id: "c", name: "Gamma" };
const AB = [A, B];
const ABC = [A, B, C];
const ex = (text: string) => ({ field: "exclusions" as const, text });
const as = (text: string) => ({ field: "assumptions" as const, text });
const dl = (text: string) => ({ field: "deliverables" as const, text });
const holds = (body: string, s: BlockService, text: string, services = AB) =>
  holdsText(parseBlocks(body, services), s.id, text);

describe("parsing: what each service's block is", () => {
  it("a block runs from its heading to the next service's heading; the opening is the first service's while it has no heading", () => {
    const body = "A says\n\n**Beta**\nB says\n\n**Gamma**\nG says";
    expect(holds(body, A, "A says", ABC)).toBe(true);
    expect(holds(body, B, "B says", ABC)).toBe(true);
    expect(holds(body, C, "G says", ABC)).toBe(true);
    // never another service's block
    expect(holds(body, A, "B says", ABC)).toBe(false);
    expect(holds(body, B, "A says", ABC)).toBe(false);
    expect(holds(body, B, "G says", ABC)).toBe(false);
  });

  it("the opening belongs to nobody once the first service has a heading of its own", () => {
    const body = "Our intro\n\n**Alpha**\nA says\n\n**Beta**\nB says";
    expect(holds(body, A, "A says")).toBe(true);
    expect(holds(body, A, "Our intro")).toBe(false);
    expect(holds(body, B, "Our intro")).toBe(false);
  });

  it("an opening of blank lines is no block; a service with no heading and not first has none", () => {
    expect(hasBlock(parseBlocks("\n  \n**Beta**\nB", AB), "a")).toBe(false);
    expect(hasBlock(parseBlocks("**Beta**\nB", AB), "b")).toBe(true);
    expect(hasBlock(parseBlocks("A text", AB), "b")).toBe(false);
    expect(hasBlock(parseBlocks(null, AB), "a")).toBe(false);
  });

  it("a two-paragraph text is held whole: the block runs past its blank line (finding 6)", () => {
    const two = "First paragraph.\n\nSecond paragraph.";
    const body = `A says\n\n**Beta**\n${two}\n\n**Gamma**\nG`;
    expect(holds(body, B, two, ABC)).toBe(true);
    // a run of blank lines in the section matches the one in the text
    expect(holds(`**Beta**\nFirst paragraph.\n\n\n\nSecond paragraph.`, B, two)).toBe(true);
    // but the paragraphs must both be there, in order
    expect(holds("**Beta**\nFirst paragraph.", B, two)).toBe(false);
    expect(holds("**Beta**\nSecond paragraph.\n\nFirst paragraph.", B, two)).toBe(false);
  });

  it("a heading-like line inside a text is text, and the person's edited heading is not the service's", () => {
    const body = "A says\n**Important**\nA more\n\n**Beta**\nB says";
    expect(holds(body, A, "A says\n**Important**\nA more")).toBe(true);
    // the person changed Beta's heading: Beta has no block, and its text belongs to the block above
    const edited = "A says\n\n**Beta (phase 1)**\nB says";
    expect(hasBlock(parseBlocks(edited, AB), "b")).toBe(false);
    expect(holds(edited, B, "B says")).toBe(false);
    expect(holds(edited, A, "B says")).toBe(true);
    // a heading in other case is not the heading either
    expect(hasBlock(parseBlocks("**beta**\nB", AB), "b")).toBe(false);
  });

  it("spaces at the ends of lines, CRLF and a heading with spaces around it are read the same", () => {
    const body = "A says  \r\n\r\n  **Beta**  \r\nB says\t\r\nB more";
    expect(holds(body, B, "B says\nB more")).toBe(true);
    expect(holds(body, B, "  B says  \r\n B more ")).toBe(true);
    expect(holds(body, A, "A says")).toBe(true);
  });

  it("a heading repeated (an older second heading) keeps both runs with that service; another service's heading still ends them", () => {
    const body = "A\n\n**Beta**\nB one\n\n**Beta**\nB two\n\n**Gamma**\nG";
    expect(holds(body, B, "B one", ABC)).toBe(true);
    expect(holds(body, B, "B two", ABC)).toBe(true);
    const split = "**Beta**\nB one\n\n**Gamma**\nG\n\n**Beta**\nB two";
    expect(holds(split, B, "B two", ABC)).toBe(true);
    expect(holds(split, C, "B two", ABC)).toBe(false);
  });

  it("whole lines only: 'None.' inside a sentence is not 'None.', nor is part of a line", () => {
    const body = "**Alpha**\nThis covers None. of the hosting.\n\n**Beta**\nB";
    expect(holds(body, A, "None.")).toBe(false);
    expect(holds(body, A, "covers None.")).toBe(false);
    expect(holds("**Alpha**\nNone.", A, "None.")).toBe(true);
    expect(holds("**Alpha**\nNone.", A, "  ")).toBe(false);
  });

  it("a service taken off the lines still ends the block above its heading when it is named in `others`", () => {
    const body = "A says\n\n**Beta**\nB says";
    expect(holdsText(parseBlocks(body, [A]), "a", "B says")).toBe(true);
    expect(holdsText(parseBlocks(body, [A], [B]), "a", "B says")).toBe(false);
  });
});

describe("inserting a part: only inside the service's own block, else a new block", () => {
  it("assumptions just before the service's own exclusions; else at the end of its block", () => {
    expect(insertParts("A\n\n**Beta**\nB excl\n\n**Gamma**\nG", ABC, B, [as("B assumes")], "B excl")).toBe(
      "A\n\n**Beta**\nB assumes\nB excl\n\n**Gamma**\nG",
    );
    expect(insertParts("A\n\n**Beta**\nB assumes\n\n**Gamma**\nG", ABC, B, [ex("B excl")], null)).toBe(
      "A\n\n**Beta**\nB assumes\nB excl\n\n**Gamma**\nG",
    );
    // the end of the block is after its last line with text, before the blank lines that part it from the next
    expect(insertParts("**Beta**\nOur words\n\n\n**Gamma**\nG", ABC, B, [dl("B deliv")])).toBe(
      "**Beta**\nOur words\nB deliv\n\n\n**Gamma**\nG",
    );
    expect(insertParts("X\n\n**Beta**", AB, B, [ex("B excl")])).toBe("X\n\n**Beta**\nB excl");
    // the first service's opening is its block
    expect(insertParts("A assumes\n\n**Beta**\nB", AB, A, [ex("A excl")])).toBe(
      "A assumes\nA excl\n\n**Beta**\nB",
    );
  });

  it("finding 1: two services share an exclusion line; each part lands in its own service's block, never the other's", () => {
    const shared = "Third-party fees are billed separately.";
    // Alpha's block holds the shared line as ITS exclusions; Beta has a block with its assumptions only
    const body = `A assumes\n${shared}\n\n**Beta**\nB assumes`;
    expect(insertParts(body, AB, B, [ex(shared)], shared)).toBe(`${body}\n${shared}`);
    // Beta's assumptions go before Beta's own exclusions, not before Alpha's same line
    const bEx = `A assumes\n${shared}\n\n**Beta**\n${shared}`;
    expect(insertParts(bEx, AB, B, [as("B assumes")], shared)).toBe(
      `A assumes\n${shared}\n\n**Beta**\nB assumes\n${shared}`,
    );
    // Beta with no block: a new block, even though Alpha's block shows the very same line
    expect(insertParts(`A assumes\n${shared}`, AB, B, [as("B assumes"), ex(shared)], shared)).toBe(
      `A assumes\n${shared}\n\n**Beta**\nB assumes\n${shared}`,
    );
  });

  it("'None.' inside another service's sentence is never taken for the service's own exclusions", () => {
    const body = "**Beta**\nWe cover None. of the hosting.";
    expect(insertParts(body, [C, B], B, [as("B assumes")], "None.")).toBe(
      "**Beta**\nWe cover None. of the hosting.\nB assumes",
    );
  });

  it("a two-paragraph text goes in whole and keeps its blank line; the next part goes after it, inside the block", () => {
    const two = "P one.\n\nP two.";
    const out = insertParts("A\n\n**Beta**\nB assumes\n\n**Gamma**\nG", ABC, B, [ex(two)]);
    expect(out).toBe(`A\n\n**Beta**\nB assumes\n${two}\n\n**Gamma**\nG`);
    expect(holdsText(parseBlocks(out, ABC), "b", two)).toBe(true);
    expect(insertParts(out, ABC, B, [dl("More")])).toBe(
      `A\n\n**Beta**\nB assumes\n${two}\nMore\n\n**Gamma**\nG`,
    );
  });

  it("no block: a new block at the end under the heading; plain only for the first service into a blank section", () => {
    expect(insertParts("X", AB, B, [as("B assumes"), ex("B excl")])).toBe("X\n\n**Beta**\nB assumes\nB excl");
    expect(insertParts("X\n\n\n", AB, B, [dl("B")])).toBe("X\n\n**Beta**\nB");
    expect(insertParts(null, AB, A, [as("A assumes"), ex("A excl")])).toBe("A assumes\nA excl");
    expect(insertParts("  \n", AB, B, [dl("B")])).toBe("**Beta**\nB");
    // the first service whose heading opens the section is not plain-new: it has a block, and the part goes into it
    expect(insertParts("**Alpha**\nA", AB, A, [dl("A more")])).toBe("**Alpha**\nA\nA more");
    // the first service into a section that starts with another service's block: a new block of its own at the end
    expect(insertParts("**Beta**\nB", AB, A, [dl("A")])).toBe("**Beta**\nB\n\n**Alpha**\nA");
    // blank parts are left out; nothing to add returns the same text
    expect(insertParts("X", AB, B, [dl("  ")])).toBe("X");
  });

  it("a person-edited heading: the service gets a new block, the edited one is left as it is", () => {
    const body = "A\n\n**Beta (phase 1)**\nB assumes";
    expect(insertParts(body, AB, B, [ex("B excl")])).toBe(`${body}\n\n**Beta**\nB excl`);
  });

  it("CRLF text keeps CRLF, and the new text is written in it; trailing spaces of other lines are untouched", () => {
    const body = "A  \r\n\r\n**Beta**\r\nB assumes \r\n\r\n**Gamma**\r\nG";
    expect(insertParts(body, ABC, B, [ex("B excl\nB excl 2")])).toBe(
      "A  \r\n\r\n**Beta**\r\nB assumes \r\nB excl\r\nB excl 2\r\n\r\n**Gamma**\r\nG",
    );
    expect(insertParts("A\r\n", AB, B, [dl("B")])).toBe("A\r\n\r\n**Beta**\r\nB");
  });

  it("a heading-like line inside the block is passed over: the part still goes at the block's end", () => {
    const body = "**Beta**\nB says\n**Note**\nMore\n\n**Gamma**\nG";
    expect(insertParts(body, ABC, B, [ex("B excl")])).toBe(
      "**Beta**\nB says\n**Note**\nMore\nB excl\n\n**Gamma**\nG",
    );
  });
});
