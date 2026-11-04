// A section's text (POR-05), drawn from core's `parseMarkdown` AST as ordinary React elements, as the PDF draws the same AST as HTML
// (packages/pdf/src/markdown-html.ts). Nothing here sets HTML: React escapes every text node, links are only the http, https and mailto
// addresses the parser kept, and raw HTML stays visible text. A link leaves the portal in a new tab (CLAUDE.md, external links).
import {
  type Block,
  type Inline,
  type NoteBlock,
  parseMarkdown,
  parseNoteMarkdown,
} from "@techaust/core/markdown";
import { type ReactNode, useMemo } from "react";

function inlines(nodes: readonly Inline[], key: string): ReactNode[] {
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
        return n.href.startsWith("mailto:") ? (
          <a key={k} href={n.href}>
            {inlines(n.children, k)}
          </a>
        ) : (
          <a key={k} href={n.href} target="_blank" rel="noopener noreferrer">
            {inlines(n.children, k)}
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        );
    }
    return null;
  });
}

function block(b: Block, i: number): ReactNode {
  const k = String(i);
  switch (b.t) {
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

/** The text as React elements (exported for the test that proves no HTML is ever set). */
export const markdownElements = (source: string): ReactNode[] => parseMarkdown(source).map(block);

/**
 * M7.1 (FX-3 finding 8, L6): a shared note through `parseNoteMarkdown`, so its `#` to `###` headings are headings. Under the page's h1 and the Notes h2, so
 * they are h3 to h5 by the note's own outline (the admin's `noteHeadingTags`, copied: apps can't import apps): siblings stay siblings, a skipped level is one
 * level deeper only, and a note never adds an h1 or h2 to the page.
 */
const NOTE_TAGS = ["h3", "h4", "h5"] as const;
export function noteHeadingTags(blocks: readonly NoteBlock[]): Map<number, (typeof NOTE_TAGS)[number]> {
  const out = new Map<number, (typeof NOTE_TAGS)[number]>();
  const open: number[] = [];
  blocks.forEach((b, i) => {
    if (b.t !== "h") return;
    while (open.length > 0 && (open.at(-1) ?? 0) >= b.level) open.pop();
    open.push(b.level);
    out.set(i, NOTE_TAGS[Math.min(open.length, NOTE_TAGS.length) - 1] ?? "h3");
  });
  return out;
}

export function NoteMarkdown({ source, className }: { source: string; className?: string | undefined }) {
  const nodes = useMemo(() => {
    const blocks = parseNoteMarkdown(source);
    const tags = noteHeadingTags(blocks);
    return blocks.map((b, i) => {
      if (b.t !== "h") return block(b, i);
      const Tag = tags.get(i) ?? "h3";
      return (
        <Tag key={String(i)} className={`md__h md__h--${b.level}`}>
          {inlines(b.children, String(i))}
        </Tag>
      );
    });
  }, [source]);
  if (nodes.length === 0) return null;
  return <div className={className ? `md ${className}` : "md"}>{nodes}</div>;
}

export function Markdown({ source, className }: { source: string; className?: string | undefined }) {
  const nodes = useMemo(() => markdownElements(source), [source]);
  if (nodes.length === 0) return null;
  return <div className={className ? `md ${className}` : "md"}>{nodes}</div>;
}
