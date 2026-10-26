// Core's Markdown AST (`parseMarkdown`) as escaped HTML for the sections of a document. Only text, strong, em, code, lists and links
// exist; a link keeps only an http, https or mailto href (core `safeHref`) and gets rel="noopener noreferrer". Raw HTML in the source
// is plain text, so it comes out escaped.
import { type Block, type Inline, parseMarkdown } from "@techaust/core/markdown";
import { esc } from "./escape.ts";

function inline(nodes: readonly Inline[]): string {
  let out = "";
  for (const n of nodes) {
    switch (n.t) {
      case "text":
        out += esc(n.text);
        break;
      case "code":
        out += `<code>${esc(n.text)}</code>`;
        break;
      case "strong":
        out += `<strong>${inline(n.children)}</strong>`;
        break;
      case "em":
        out += `<em>${inline(n.children)}</em>`;
        break;
      case "link":
        out += `<a href="${esc(n.href)}" rel="noopener noreferrer">${inline(n.children)}</a>`;
        break;
    }
  }
  return out;
}

function block(b: Block): string {
  switch (b.t) {
    case "p":
      return `<p>${inline(b.children)}</p>`;
    case "code":
      return `<pre>${esc(b.text)}</pre>`;
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      return `<${tag}>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${tag}>`;
    }
  }
}

/** Markdown text to HTML. */
export const markdownToHtml = (md: string): string => parseMarkdown(md).map(block).join("");

/** Markdown text as one HTML string per block (the layout keeps a section's heading with its first block). */
export const markdownBlocks = (md: string): string[] => parseMarkdown(md).map(block);
