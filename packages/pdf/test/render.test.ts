// renderDocumentHtml: escaping, no network references, the CSP, the title, status as text, the test ids the visual suite uses.
import { describe, expect, it } from "vitest";
import { esc } from "../src/escape.ts";
import { markdownToHtml } from "../src/markdown-html.ts";
import { pdfOptionsFor } from "../src/options.ts";
import { DOCUMENT_CSP, renderDocumentHtml } from "../src/render.ts";
import { toPdfView } from "../src/view.ts";
import { buildFixture, FIXTURE_NAMES } from "./fixtures/index.ts";

const htmlOf = async (name: (typeof FIXTURE_NAMES)[number]) => {
  const { envelope } = await buildFixture(name);
  const view = toPdfView(envelope);
  return { html: renderDocumentHtml(view), view };
};

/** The page without its inline style block (the CSS holds the data-URI fonts). */
const body = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, "");

describe("esc and markdownToHtml", () => {
  it("escapes the five characters", () => {
    expect(esc(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
    );
  });
  it("renders the Markdown subset and escapes raw HTML", () => {
    const html = markdownToHtml(
      "Hello **bold** *em* `code` <b>raw</b> [ok](https://example.test/a?x=1&y=2) [bad](javascript:alert(1))\n\n- one\n- two\n\n1. a\n2. b\n\n```\n<pre>\n```",
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>em</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("&lt;b&gt;raw&lt;/b&gt;");
    expect(html).toContain('<a href="https://example.test/a?x=1&amp;y=2" rel="noopener noreferrer">ok</a>');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<ol><li>a</li><li>b</li></ol>");
    expect(html).toContain("<pre>&lt;pre&gt;</pre>");
  });
  it("allows mailto links", () => {
    expect(markdownToHtml("[mail](mailto:a@example.test)")).toContain('href="mailto:a@example.test"');
  });
});

describe("renderDocumentHtml", () => {
  it("escapes every dynamic string", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    const evil = `<script>alert("x")</script> & "q"`;
    envelope.snapshot.header.recipient.displayName = evil;
    envelope.snapshot.header.document.title = evil;
    envelope.snapshot.lines[0]!.description = evil;
    envelope.snapshot.sections[0]!.bodyMd = evil;
    const html = renderDocumentHtml(toPdfView(envelope));
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("is self-contained: no http(s) in src or href, except links written in the Markdown", async () => {
    for (const name of FIXTURE_NAMES) {
      const { html } = await htmlOf(name);
      const refs = [...body(html).matchAll(/\s(?:src|href)=["']([^"']*)["']/g)].map((m) => m[1] as string);
      for (const ref of refs) expect(ref).toMatch(/^https:\/\/example\.test\//);
      expect(html).not.toMatch(/<link|<img|<script|@import|url\((?!["']?data:)/i);
    }
  });

  it("leaves no unrendered values", async () => {
    for (const name of FIXTURE_NAMES) {
      const { html } = await htmlOf(name);
      const text = body(html);
      expect(text).not.toMatch(/\{\{|undefined|NaN|\bnull\b/);
      // the visible text only (the SVG logos hold no such words either)
      const visible = text.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ");
      expect(visible).not.toMatch(/\bnull\b|undefined|NaN|\{\{/);
    }
  });

  it("carries the CSP meta, the language and the title", async () => {
    const { html, view } = await htmlOf("short-intra-inr");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en-IN">');
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_CSP}">`);
    expect(DOCUMENT_CSP).toBe("default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'");
    expect(html).toContain(`<title>${esc(view.title)}</title>`);
  });

  it("states the status as text and keeps the test ids", async () => {
    const { html } = await htmlOf("long-inter-inr");
    expect(html).toContain('<span data-testid="status">Sent</span>');
    for (const id of ["rupee", "total", "integrity"]) expect(html).toContain(`data-testid="${id}"`);
    expect(html.match(/data-testid="rupee"/g)).toHaveLength(1);
    expect(html.match(/data-testid="total"/g)).toHaveLength(1);
  });

  it("puts the rupee probe in the INR note of a USD document", async () => {
    const { html } = await htmlOf("usd-export");
    expect(html.match(/data-testid="rupee"/g)).toHaveLength(1);
    expect(html).toContain('data-testid="currency-symbol"');
  });

  it("does not print a hidden section and prints the terms", async () => {
    const { html } = await htmlOf("long-inter-inr");
    expect(html).not.toContain("Hidden sample");
    expect(html).toContain("Terms, version 3");
  });

  it("never uses a bold weight above 600", async () => {
    const { html } = await htmlOf("long-inter-inr");
    expect(html).not.toMatch(/font-weight:\s*(?:7|8|9)00|font-weight:\s*bold/);
  });

  it("is deterministic", async () => {
    const a = await htmlOf("short-intra-inr");
    const b = await htmlOf("short-intra-inr");
    expect(a.html).toBe(b.html);
  });

  it("falls back to the trade name when the logo file is unknown", async () => {
    const { envelope } = await buildFixture("short-intra-inr");
    envelope.snapshot.header.issuer.company.logo = "nope.svg";
    const html = renderDocumentHtml(toPdfView(envelope));
    expect(html).toContain('class="logo-text"');
  });
});

describe("pdfOptionsFor", () => {
  it("asks for A4 from CSS, tagged and outlined", async () => {
    const { view } = await htmlOf("short-intra-inr");
    expect(pdfOptionsFor(view)).toEqual({
      format: "a4",
      preferCSSPageSize: true,
      printBackground: true,
      tagged: true,
      outline: true,
      timeout: 30_000,
      displayHeaderFooter: false,
    });
  });
});
