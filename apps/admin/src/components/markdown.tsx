// A note's Markdown (ADM-PRJ-03), drawn from core's `parseMarkdown` AST as ordinary React elements. Nothing here sets HTML: React
// escapes every text node, links are only the http, https and mailto URLs the parser kept, and images or raw HTML never exist
// (they stay as visible text). Links leave the admin in a new tab with `noopener noreferrer`.
// FX-3 (A3 7): a note (`headings`) also has `#` to `###` headings, drawn as h3 to h5 (by the note's outline, `noteHeadingTags`) so a note never
// adds an h1 or h2 to its page nor skips a level. Document
// sections, terms and catalogue text keep `parseMarkdown`, where a `#` line stays text.
import { type Inline, type NoteBlock, parseMarkdown, parseNoteMarkdown } from "@techaust/core/markdown";
import { type ReactNode, useMemo } from "react";

/**
 * A note's headings as elements under the page's h1 and the panel's h2 (FX-3 fix round: the record-page sweep found a note that
 * opened with `##` drawn as an h4 straight under the h2). The note's outline is kept, never its absolute depth: its shallowest
 * heading is an h3, and no heading goes more than one level below the one before it. The size stays the author's (`md__h--N`).
 */
const TAGS = ["h3", "h4", "h5"] as const;
export function noteHeadingTags(blocks: readonly NoteBlock[]): Map<number, (typeof TAGS)[number]> {
  const levels = blocks.flatMap((b) => (b.t === "h" ? [b.level] : []));
  const top = Math.min(...levels);
  const out = new Map<number, (typeof TAGS)[number]>();
  let prev = -1; // the panel's h2, as an index below TAGS
  blocks.forEach((b, i) => {
    if (b.t !== "h") return;
    const at = Math.max(0, Math.min(b.level - top, prev + 1, TAGS.length - 1));
    out.set(i, TAGS[at] ?? "h3");
    prev = at;
  });
  return out;
}

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

function block(b: NoteBlock, i: number, tags: Map<number, (typeof TAGS)[number]>): ReactNode {
  const k = String(i);
  switch (b.t) {
    case "h": {
      const Tag = tags.get(i) ?? "h3";
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
export function markdownElements(source: string, headings = false): ReactNode[] {
  const blocks: NoteBlock[] = headings ? parseNoteMarkdown(source) : parseMarkdown(source);
  const tags = noteHeadingTags(blocks);
  return blocks.map((b, i) => block(b, i, tags));
}

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
