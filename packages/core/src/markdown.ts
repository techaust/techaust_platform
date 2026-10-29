// A small Markdown subset for notes [ADM-PRJ-03]: paragraphs, **bold**, *italic*, lists, `inline code`, fenced code blocks and
// links (http, https, mailto only). Images and raw HTML do not exist: they stay plain text. The result is an AST of plain data,
// never HTML; the SPA renders it with ordinary elements (React escapes the text), so nothing here can inject markup.
// Notes are parsed in the browser. Since M4.4 the AST is also rendered to escaped HTML inside the jobs Worker (packages/pdf
// markdown-html.ts) for the sections of proposals and estimates: there the input is a frozen, size-capped snapshot.
// FX-3 (A3 7): a NOTE also has headings, `#`, `##` and `###` (`parseNoteMarkdown`; the admin draws them as h3, h4 and h5, so a note never adds an h1
// or h2 to its page). `parseMarkdown`, which the documents use, keeps a `#` line as text: a frozen proposal's sections read as they always did.

export type Inline =
  | { t: "text"; text: string }
  | { t: "code"; text: string }
  | { t: "strong"; children: Inline[] }
  | { t: "em"; children: Inline[] }
  | { t: "link"; href: string; children: Inline[] };
export type Block =
  | { t: "p"; children: Inline[] }
  | { t: "code"; text: string }
  | { t: "list"; ordered: boolean; items: Inline[][] };
/** A note's heading: `#` is level 1, `##` level 2, `###` level 3 (a fourth `#` is text). */
export type HeadingBlock = { t: "h"; level: 1 | 2 | 3; children: Inline[] };
/** A note's blocks: the document blocks and headings. */
export type NoteBlock = Block | HeadingBlock;

/** The longest input parsed; the rest is ignored (the API caps a note well below this). */
export const MAX_MARKDOWN_CHARS = 20_000;
const MAX_DEPTH = 3;
const LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** The href when it is an http, https or mailto URL (no spaces, no control characters), else null. */
export function safeHref(raw: string): string | null {
  const s = raw.trim();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (s === "" || /[\s\u0000-\u001f\u007f]/u.test(s)) return null;
  try {
    const u = new URL(s);
    return LINK_SCHEMES.has(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

const merge = (nodes: Inline[]): Inline[] => {
  const out: Inline[] = [];
  for (const n of nodes) {
    const last = out.at(-1);
    if (n.t === "text" && last?.t === "text") last.text += n.text;
    else if (!(n.t === "text" && n.text === "")) out.push(n);
  }
  return out;
};

/** The index of the `)` that closes a link target starting at `from`, allowing balanced parentheses inside it; -1 when none. */
function closingParen(s: string, from: number): number {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) return i;
      depth--;
    } else if (c === "\n") return -1;
  }
  return -1;
}

const PUNCT = "\\`*[]()!_#>-+.<{}|~";

function inline(s: string, depth: number): Inline[] {
  const out: Inline[] = [];
  const text = (x: string) => out.push({ t: "text", text: x });
  let i = 0;
  while (i < s.length) {
    const ch = s[i] as string;
    if (ch === "\\" && i + 1 < s.length && PUNCT.includes(s[i + 1] as string)) {
      text(s[i + 1] as string);
      i += 2;
    } else if (ch === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1) {
        out.push({ t: "code", text: s.slice(i + 1, end) });
        i = end + 1;
      } else {
        text("`");
        i++;
      }
    } else if ((ch === "[" || (ch === "!" && s[i + 1] === "[")) && depth < MAX_DEPTH) {
      const open = ch === "!" ? i + 1 : i;
      const mid = s.indexOf("](", open);
      const end = mid < 0 ? -1 : closingParen(s, mid + 2);
      if (mid < 0 || end < 0) {
        text(ch);
        i++;
      } else if (ch === "!") {
        text(s.slice(i, end + 1)); // an image is not a thing here: its source stays visible as text
        i = end + 1;
      } else {
        const href = safeHref(s.slice(mid + 2, end));
        const children = inline(s.slice(i + 1, mid), depth + 1);
        if (href) out.push({ t: "link", href, children });
        else out.push(...children);
        i = end + 1;
      }
    } else if ((ch === "*" || ch === "_") && depth < MAX_DEPTH) {
      const strong = ch === "*" && s[i + 1] === "*";
      const mark = strong ? "**" : ch;
      const end = s.indexOf(mark, i + mark.length);
      if (end > i + mark.length) {
        const children = inline(s.slice(i + mark.length, end), depth + 1);
        out.push({ t: strong ? "strong" : "em", children });
        i = end + mark.length;
      } else {
        text(mark);
        i += mark.length;
      }
    } else {
      // a run of plain characters up to the next one that could start something
      let j = i + 1;
      while (j < s.length && !"\\`*_[!".includes(s[j] as string)) j++;
      text(s.slice(i, j));
      i = j;
    }
  }
  return merge(out);
}

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/;
const FENCE = /^\s{0,3}```/;
/** An ATX heading: one to three `#`, a space, then text; closing `#`s after a space are dropped. `####` and `#text` stay text. */
const HEADING = /^\s{0,3}(#{1,3})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/** The blocks of a document section (proposals, estimates, terms): no headings, so a `#` line stays text. */
export function parseMarkdown(md: string): Block[] {
  return parse(md, false) as Block[];
}

/** The blocks of a note (FX-3, ADM-PRJ-03): the same subset plus `#` to `###` headings. */
export function parseNoteMarkdown(md: string): NoteBlock[] {
  return parse(md, true);
}

function parse(md: string, headings: boolean): NoteBlock[] {
  const lines = md.slice(0, MAX_MARKDOWN_CHARS).replace(/\r\n?/g, "\n").split("\n");
  const blocks: NoteBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: "p", children: inline(para.join("\n"), 0) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (FENCE.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] as string)) body.push(lines[i++] as string);
      blocks.push({ t: "code", text: body.join("\n") });
    } else if (line.trim() === "") flush();
    else {
      const h = headings ? HEADING.exec(line) : null;
      if (h && (h[2] as string).trim() !== "") {
        flush();
        blocks.push({
          t: "h",
          level: (h[1] as string).length as 1 | 2 | 3,
          children: inline((h[2] as string).trim(), 0),
        });
        continue;
      }
      const b = BULLET.exec(line);
      const o = b ? null : ORDERED.exec(line);
      const m = b ?? o;
      if (m) {
        flush();
        const last = blocks.at(-1);
        const item = inline((m[1] as string).trim(), 0);
        if (last?.t === "list" && last.ordered === (o !== null)) last.items.push(item);
        else blocks.push({ t: "list", ordered: o !== null, items: [item] });
      } else para.push(line);
    }
  }
  flush();
  return blocks;
}
