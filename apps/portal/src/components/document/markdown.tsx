// A section's text (POR-05), drawn from core's `parseMarkdown` AST as ordinary React elements, as the PDF draws the same AST as HTML
// (packages/pdf/src/markdown-html.ts). Nothing here sets HTML: React escapes every text node, links are only the http, https and mailto
// addresses the parser kept, and raw HTML stays visible text. A link leaves the portal in a new tab (CLAUDE.md, external links).
import { type Block, type Inline, parseMarkdown } from "@techaust/core/markdown";
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

export function Markdown({ source, className }: { source: string; className?: string | undefined }) {
  const nodes = useMemo(() => markdownElements(source), [source]);
  if (nodes.length === 0) return null;
  return <div className={className ? `md ${className}` : "md"}>{nodes}</div>;
}
