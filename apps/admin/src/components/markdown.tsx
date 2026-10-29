// A note's Markdown (ADM-PRJ-03), drawn from core's `parseMarkdown` AST as ordinary React elements. Nothing here sets HTML: React
// escapes every text node, links are only the http, https and mailto URLs the parser kept, and images or raw HTML never exist
// (they stay as visible text). Links leave the admin in a new tab with `noopener noreferrer`.
// FX-3 (A3 7): a note (`headings`) also has `#` to `###` headings, drawn as h3, h4 and h5 so a note never adds an h1 or h2 to its page. Document
// sections, terms and catalogue text keep `parseMarkdown`, where a `#` line stays text.
import { type Inline, type NoteBlock, parseMarkdown, parseNoteMarkdown } from "@techaust/core/markdown";
import { type ReactNode, useMemo } from "react";

/** A note heading's level to its element: under the page's h1 and the panel's h2. */
const HEADING_TAG = { 1: "h3", 2: "h4", 3: "h5" } as const;

function inlines(nodes: Inline[], key: string): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}.${i}`;
    switch (n.t) {
      case "text":
        return n.text;
      case "code":
        return <code key={k}>{n.text}</code>;
      case "strong":
        return <strong key={k}>{inlines(n.children, k)}</strong>;
      case "em":
        return <em key={k}>{inlines(n.children, k)}</em>;
      case "link":
        return (
          <a key={k} href={n.href} target="_blank" rel="noopener noreferrer">
            {inlines(n.children, k)}
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        );
    }
    return null;
  });
}

function block(b: NoteBlock, i: number): ReactNode {
  const k = String(i);
  switch (b.t) {
    case "h": {
      const Tag = HEADING_TAG[b.level];
      return (
        <Tag key={k} className={`md__h md__h--${b.level}`}>
          {inlines(b.children, k)}
        </Tag>
      );
    }
    case "p":
      return <p key={k}>{inlines(b.children, k)}</p>;
    case "code":
      return (
        <pre key={k}>
          <code>{b.text}</code>
        </pre>
      );
    case "list": {
      const items = b.items.map((item, j) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a parsed list never reorders; its position is its identity
        <li key={j}>{inlines(item, `${k}.${j}`)}</li>
      ));
      return b.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>;
    }
  }
  return null;
}

/** The text as React elements; `headings` for a note (exported for the test that proves no HTML is ever set). */
export const markdownElements = (source: string, headings = false): ReactNode[] =>
  (headings ? parseNoteMarkdown(source) : parseMarkdown(source)).map(block);

export function Markdown({
  source,
  className,
  headings = false,
}: {
  source: string;
  className?: string;
  /** A note: `#` to `###` are headings (h3 to h5). */
  headings?: boolean;
}) {
  const nodes = useMemo(() => markdownElements(source, headings), [source, headings]);
  return <div className={className ? `md ${className}` : "md"}>{nodes}</div>;
}
