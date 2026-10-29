// A section's service text as BLOCKS (ADM-PROP-02; lead's decision 2026-10-29, docs/13; review of round 4, findings 1, 3, 4 and 6).
// A Deliverables or Assumptions and exclusions section holds one block per service:
//   - a block starts with its service's heading line, exactly `**Name**` (spaces around it ignored), and runs up to the next line that is
//     exactly ANOTHER of the draft's services' headings, or to the end of the text. Its paragraphs may hold blank lines. A line that only
//     looks like a heading (`**Note**`, or a heading the person edited, `**Beta (phase 1)**`) is ordinary text of the block it sits in;
//   - the text before the first heading (the unheaded opening) belongs to the draft's FIRST service, and only while that service has no
//     heading of its own. Otherwise it belongs to no service.
// Every question about one service's text is asked of that service's own block(s) only, never of the rest of the section:
//   - `holdsText`: the block holds a text whole, as consecutive whole lines (spaces at the ends of a line and repeated blank lines are not
//     counted; never a substring, so "None." inside another sentence is not "None.");
//   - `insertParts`: a part goes into the service's block (assumptions just before the service's own exclusions when the block holds them,
//     else at the end of the block); a service with no block gets a new block at the end, under its heading (plain, without one, only for
//     the draft's first service into a blank section: the opening is its block).
// Text outside the block that changes is never touched: an insert is a splice at one place, in the section's own line endings (CRLF kept).
// Pure: no I/O, no regular expression kept between calls.

/** One service as the blocks know it: its id and the name its heading shows (the line name, "&" written "and"). */
export type BlockService = { id: string; name: string };
/** A part of a service's Catalogue text that goes into a section. */
export type BlockPart = { field: "deliverables" | "assumptions" | "exclusions"; text: string };

type Line = { text: string; start: number; end: number };
/** A run of lines `[from, to)` owned by one service (`owner` = its id), or by none (an opening no service owns). */
type Segment = { owner: string | null; from: number; to: number };
export type ParsedBlocks = { body: string; lines: Line[]; segments: Segment[]; eol: string };

/** A service's heading line. */
export const headingLine = (name: string): string => `**${name}**`;

const isBlankText = (v: string | null | undefined): boolean =>
  v === null || v === undefined || v.trim() === "";

function linesOf(body: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body.charCodeAt(i);
    if (ch !== 10 && ch !== 13) continue;
    out.push({ text: body.slice(start, i), start, end: i });
    if (ch === 13 && body.charCodeAt(i + 1) === 10) i++;
    start = i + 1;
  }
  out.push({ text: body.slice(start), start, end: body.length });
  return out;
}

/** The section's line ending: CRLF when it has one, else LF. New text is written in it. */
const eolOf = (body: string): string => (body.includes("\r\n") ? "\r\n" : "\n");

/**
 * The blocks of a section's text. `services` are the draft's services, in line order (the first is the one that may own the opening);
 * `others` names services whose headings also end a block (a service this save took off the lines: its block is still in the text).
 */
export function parseBlocks(
  body: string | null,
  services: readonly BlockService[],
  others: readonly BlockService[] = [],
): ParsedBlocks {
  const text = body ?? "";
  const lines = linesOf(text);
  const owners = new Map<string, string>();
  for (const s of [...services, ...others]) {
    const h = headingLine(s.name);
    if (!owners.has(h)) owners.set(h, s.id);
  }
  const ownerAt = lines.map((l) => owners.get(l.text.trim()) ?? null);
  const first = services[0]?.id ?? null;
  const opening = first !== null && !ownerAt.includes(first) ? first : null;
  const segments: Segment[] = [];
  let current: Segment = { owner: opening, from: 0, to: 0 };
  ownerAt.forEach((owner, i) => {
    // a heading of the service whose block this is (a repeated heading) stays inside it; another service's heading starts its block
    if (owner === null || owner === current.owner) return;
    current.to = i;
    if (current.to > current.from) segments.push(current);
    current = { owner, from: i, to: i };
  });
  current.to = lines.length;
  segments.push(current);
  return { body: text, lines, segments, eol: eolOf(text) };
}

/** The segments of one service; an opening of blank lines only is no block. */
function segmentsOf(p: ParsedBlocks, id: string): Segment[] {
  return p.segments.filter(
    (s) => s.owner === id && p.lines.slice(s.from, s.to).some((l) => l.text.trim() !== ""),
  );
}

/** Whether the service has a block in the section. */
export const hasBlock = (p: ParsedBlocks, id: string): boolean => segmentsOf(p, id).length > 0;

/** A text's lines for comparing: each trimmed, a run of blank lines as one, no blank line at either end. */
function comparable(text: string): string[] {
  const out: string[] = [];
  for (const l of linesOf(text.trim())) {
    const t = l.text.trim();
    if (t === "" && out[out.length - 1] === "") continue;
    out.push(t);
  }
  return out;
}

/**
 * Where a text stands whole inside a segment: the index of its first and last line, or null. Whole lines only, compared as `comparable`
 * says (a run of blank lines in the section matches one in the text).
 */
function findIn(p: ParsedBlocks, seg: Segment, text: string): { first: number; last: number } | null {
  const want = comparable(text);
  if (want.length === 0) return null;
  // the segment's lines, with each run of blank lines folded into its first line
  const have: { idx: number; t: string }[] = [];
  for (let i = seg.from; i < seg.to; i++) {
    const t = (p.lines[i] as Line).text.trim();
    if (t === "" && have[have.length - 1]?.t === "") continue;
    have.push({ idx: i, t });
  }
  for (let i = 0; i + want.length <= have.length; i++) {
    let ok = true;
    for (let j = 0; j < want.length && ok; j++) ok = have[i + j]?.t === want[j];
    if (ok)
      return {
        first: (have[i] as { idx: number }).idx,
        last: (have[i + want.length - 1] as { idx: number }).idx,
      };
  }
  return null;
}

/** Whether the service's own block holds this text, whole (never another service's block, never part of a line). */
export function holdsText(p: ParsedBlocks, id: string, text: string): boolean {
  if (isBlankText(text)) return false;
  return segmentsOf(p, id).some((s) => findIn(p, s, text) !== null);
}

/** The text in the section's line endings, trimmed. */
const inEol = (text: string, eol: string): string =>
  linesOf(text.trim())
    .map((l) => l.text)
    .join(eol);

/** The body with blank lines (and spaces) taken off its end only. */
function withoutTrailingBlank(p: ParsedBlocks): string {
  let n = p.lines.length;
  while (n > 0 && (p.lines[n - 1] as Line).text.trim() === "") n--;
  return n === 0 ? "" : p.body.slice(0, (p.lines[n - 1] as Line).end);
}

/**
 * The section's text with some of one service's parts put in, by the block rule: into the service's own (first) block (assumptions just
 * before `ownExclusions`, the service's own exclusions text, when the block holds it whole; else at the end of the block, after its last
 * line with text), else as a new block at the end under the service's heading. `services` are the draft's services in line order
 * (`others`: see `parseBlocks`). The caller leaves out the parts the block already holds (`holdsText`).
 */
export function insertParts(
  body: string | null,
  services: readonly BlockService[],
  service: BlockService,
  parts: readonly BlockPart[],
  ownExclusions: string | null = null,
  others: readonly BlockService[] = [],
): string {
  let text = body ?? "";
  const fresh: string[] = [];
  for (const part of parts) {
    if (isBlankText(part.text)) continue;
    const p = parseBlocks(text, services, others);
    const own = segmentsOf(p, service.id);
    const seg = own[0];
    if (!seg) {
      fresh.push(part.text);
      continue;
    }
    const add = inEol(part.text, p.eol);
    if (part.field === "assumptions") {
      const at = isBlankText(ownExclusions) ? null : findIn(p, seg, ownExclusions as string);
      if (at !== null) {
        const before = (p.lines[at.first] as Line).start;
        text = `${text.slice(0, before)}${add}${p.eol}${text.slice(before)}`;
        continue;
      }
    }
    // the end of the block: after its last line with text
    let last = seg.to - 1;
    while (last > seg.from && (p.lines[last] as Line).text.trim() === "") last--;
    const end = (p.lines[last] as Line).end;
    text = `${text.slice(0, end)}${p.eol}${add}${text.slice(end)}`;
  }
  if (fresh.length === 0) return text;
  const p = parseBlocks(text, services, others);
  const kept = withoutTrailingBlank(p);
  const parts2 = fresh.map((t) => inEol(t, p.eol)).join(p.eol);
  if (kept === "")
    return services[0]?.id === service.id ? parts2 : `${headingLine(service.name)}${p.eol}${parts2}`;
  return `${kept}${p.eol}${p.eol}${headingLine(service.name)}${p.eol}${parts2}`;
}
