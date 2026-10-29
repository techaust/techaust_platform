import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Block,
  type Inline,
  MAX_MARKDOWN_CHARS,
  parseMarkdown,
  parseNoteMarkdown,
  safeHref,
} from "../src/markdown.ts";

const walk = (nodes: Inline[], f: (n: Inline) => void) => {
  for (const n of nodes) {
    f(n);
    if (n.t === "strong" || n.t === "em" || n.t === "link") walk(n.children, f);
  }
};
const inlines = (blocks: Block[]): Inline[][] =>
  blocks.flatMap((b) => (b.t === "p" ? [b.children] : b.t === "list" ? b.items : []));

describe("parseMarkdown [ADM-PRJ-03]", () => {
  it("parses paragraphs, bold, italic, code and links", () => {
    const [p] = parseMarkdown("a **b** and *c* with `d` and [e](https://x.test/y)");
    expect(p).toEqual({
      t: "p",
      children: [
        { t: "text", text: "a " },
        { t: "strong", children: [{ t: "text", text: "b" }] },
        { t: "text", text: " and " },
        { t: "em", children: [{ t: "text", text: "c" }] },
        { t: "text", text: " with " },
        { t: "code", text: "d" },
        { t: "text", text: " and " },
        { t: "link", href: "https://x.test/y", children: [{ t: "text", text: "e" }] },
      ],
    });
  });

  it("parses lists, code blocks and paragraph breaks", () => {
    const out = parseMarkdown(
      "intro\nline two\n\n- one\n- two\n1. first\n2) second\n\n```\ncode **not bold**\n```\nend",
    );
    expect(out.map((b) => b.t)).toEqual(["p", "list", "list", "code", "p"]);
    expect(out[0]).toMatchObject({ children: [{ t: "text", text: "intro\nline two" }] });
    expect(out[1]).toMatchObject({ ordered: false });
    expect((out[1] as Extract<Block, { t: "list" }>).items).toHaveLength(2);
    expect(out[2]).toMatchObject({ ordered: true });
    expect(out[3]).toEqual({ t: "code", text: "code **not bold**" });
  });

  it("runs an unclosed fence to the end and handles CRLF", () => {
    expect(parseMarkdown("```\r\na\r\nb")).toEqual([{ t: "code", text: "a\nb" }]);
  });

  it("keeps raw HTML as plain text", () => {
    const out = parseMarkdown("<script>alert(1)</script> <img src=x onerror=y>");
    expect(out).toEqual([
      { t: "p", children: [{ t: "text", text: "<script>alert(1)</script> <img src=x onerror=y>" }] },
    ]);
  });

  it("has no images: the source stays visible as text", () => {
    const [p] = parseMarkdown("![alt](https://x.test/i.png) after");
    expect(p).toEqual({ t: "p", children: [{ t: "text", text: "![alt](https://x.test/i.png) after" }] });
  });

  it("drops links with other schemes but keeps their label", () => {
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "//evil.test",
      "/relative",
      "ftp://x",
      " javascript:x",
    ]) {
      const [p] = parseMarkdown(`[click](${href})`);
      expect(p, href).toEqual({ t: "p", children: [{ t: "text", text: "click" }] });
    }
    const [m] = parseMarkdown("[mail](mailto:a@b.test)");
    expect(m).toMatchObject({ children: [{ t: "link", href: "mailto:a@b.test" }] });
  });

  it("treats unmatched markers and escapes as text", () => {
    for (const src of ["a ** b", "x ` y", "[e f", "hi ! there", "[a](b", "[a] (b)", "a * b"])
      expect(parseMarkdown(src), src).toEqual([{ t: "p", children: [{ t: "text", text: src }] }]);
    expect(parseMarkdown("\\* g \\[x\\]")).toEqual([{ t: "p", children: [{ t: "text", text: "* g [x]" }] }]);
  });

  it("allows balanced parentheses in a link target and refuses a line break in it", () => {
    expect(parseMarkdown("[w](https://x.test/a_(b))")).toMatchObject([
      { children: [{ t: "link", href: "https://x.test/a_(b)" }] },
    ]);
    expect(parseMarkdown("[w](https://x.test/a\nb)")).toEqual([
      { t: "p", children: [{ t: "text", text: "[w](https://x.test/a\nb)" }] },
    ]);
  });

  it("handles underscores for italics and a stray backslash", () => {
    expect(parseMarkdown("_x_ \\q")).toMatchObject([
      { children: [{ t: "em" }, { t: "text", text: " \\q" }] },
    ]);
  });

  it("stops nesting at a fixed depth", () => {
    const out = parseMarkdown("*a **b *c *d* c* b** a*");
    let depth = 0;
    const deep = (nodes: Inline[], d: number) => {
      depth = Math.max(depth, d);
      for (const n of nodes) if (n.t === "strong" || n.t === "em" || n.t === "link") deep(n.children, d + 1);
    };
    for (const c of inlines(out)) deep(c, 0);
    expect(depth).toBeLessThanOrEqual(3);
  });

  it("ignores input beyond the cap", () => {
    const out = parseMarkdown("a".repeat(MAX_MARKDOWN_CHARS + 500));
    expect(JSON.stringify(out).length).toBeLessThan(MAX_MARKDOWN_CHARS + 100);
  });

  it("an empty note has no blocks", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("  \n\n ")).toEqual([]);
  });
});

describe("safeHref", () => {
  it("allows http, https and mailto only", () => {
    expect(safeHref("http://a.test")).toBe("http://a.test/");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("")).toBeNull();
    expect(safeHref("https://a.test/a b")).toBeNull();
    expect(safeHref("not a url")).toBeNull();
  });
});

describe("property: the AST holds only what the parser created", () => {
  it("every link is http, https or mailto; every node is a known type; no images or HTML nodes", () => {
    const md = fc.string({ unit: fc.constantFrom(..."ab *_`[]()!\\\n-1.<>/:#javscript"), maxLength: 120 });
    fc.assert(
      fc.property(md, (src) => {
        const blocks = parseMarkdown(src);
        for (const b of blocks) {
          expect(["p", "code", "list"]).toContain(b.t);
          const lists = b.t === "p" ? [b.children] : b.t === "list" ? b.items : [];
          for (const children of lists)
            walk(children, (n) => {
              expect(["text", "code", "strong", "em", "link"]).toContain(n.t);
              if (n.t === "link") expect(n.href).toMatch(/^(https?:|mailto:)/);
            });
        }
      }),
      { numRuns: 500 },
    );
  });

  it("plain letters and spaces come out unchanged (no markup is invented)", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(..."abc xyz<>&\"'"), minLength: 1, maxLength: 80 }),
        (src) => {
          fc.pre(src.trim() !== "");
          const [p] = parseMarkdown(src);
          const texts = (p as Extract<Block, { t: "p" }>).children;
          expect(texts.every((n) => n.t === "text")).toBe(true);
          expect(texts.map((n) => (n as { text: string }).text).join("")).toBe(src);
        },
      ),
    );
  });
});

describe("parseNoteMarkdown: a note's headings (FX-3, A3 7) [ADM-PRJ-03]", () => {
  it("reads `#`, `##` and `###` as levels 1 to 3, with inline marks, and drops closing hashes", () => {
    expect(parseNoteMarkdown("# One\n## Two **b**\n### Three ###\ntext")).toEqual([
      { t: "h", level: 1, children: [{ t: "text", text: "One" }] },
      {
        t: "h",
        level: 2,
        children: [
          { t: "text", text: "Two " },
          { t: "strong", children: [{ t: "text", text: "b" }] },
        ],
      },
      { t: "h", level: 3, children: [{ t: "text", text: "Three" }] },
      { t: "p", children: [{ t: "text", text: "text" }] },
    ]);
  });

  it("a heading ends the paragraph before it; `####`, `#tag` and a bare `#` stay text", () => {
    expect(parseNoteMarkdown("before\n# Head\nafter")).toEqual([
      { t: "p", children: [{ t: "text", text: "before" }] },
      { t: "h", level: 1, children: [{ t: "text", text: "Head" }] },
      { t: "p", children: [{ t: "text", text: "after" }] },
    ]);
    for (const src of ["#### Four", "#tag", "#", "#   "]) {
      expect(
        parseNoteMarkdown(src).every((b) => b.t !== "h"),
        src,
      ).toBe(true);
    }
    // a `#` line inside a code block is code
    expect(parseNoteMarkdown("```\n# not a heading\n```")).toEqual([{ t: "code", text: "# not a heading" }]);
    // up to three spaces before the hashes, as for lists
    expect(parseNoteMarkdown("   ## Indented")[0]).toEqual({
      t: "h",
      level: 2,
      children: [{ t: "text", text: "Indented" }],
    });
  });

  it("documents keep a `#` line as text: parseMarkdown never makes a heading (frozen sections read as before)", () => {
    expect(parseMarkdown("# Scope\nwork")).toEqual([
      { t: "p", children: [{ t: "text", text: "# Scope\nwork" }] },
    ]);
  });

  it("property: a heading holds only parser nodes; links stay http, https or mailto; without `#` both parsers agree", () => {
    const md = fc.string({ unit: fc.constantFrom(..."ab *_`[]()!\\\n-1.<>/:# javscript"), maxLength: 120 });
    fc.assert(
      fc.property(md, (src) => {
        for (const b of parseNoteMarkdown(src)) {
          expect(["p", "code", "list", "h"]).toContain(b.t);
          if (b.t === "h") {
            expect([1, 2, 3]).toContain(b.level);
            walk(b.children, (n) => {
              expect(["text", "code", "strong", "em", "link"]).toContain(n.t);
              if (n.t === "link") expect(n.href).toMatch(/^(https?:|mailto:)/);
            });
          }
        }
        if (!src.includes("#")) expect(parseNoteMarkdown(src)).toEqual(parseMarkdown(src));
      }),
      { numRuns: 500 },
    );
  });
});
