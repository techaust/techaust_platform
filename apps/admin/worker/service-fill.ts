// Filling a draft's `{{service.*}}` placeholders from the services it holds (ADM-PROP-02; owner decisions 2026-10-28 and 2026-10-29, docs/13).
// Two different states, never mixed up:
//   - UNKNOWN: the draft has no service yet (so no catalogue text can exist): the token stays in the text, and the send check names it.
//   - EMPTY:   a service is there but its Deliverables, Assumptions or Exclusions text is blank: the token is taken out (its line too), a
//              section left with no text is hidden, and nothing blocks the send. The gap is reported on the draft read (`catalogueGaps`)
//              so the screen can name the service and send the person to Catalogue.
// The first service fills the template's tokens; every other service adds its own text under its name (the M4.3 shape), so a later service's
// text never sits under a leftover token. A service added by a later save gets its text the same way, under its name (`appendServices`,
// review round 3, finding 1), so every service's Catalogue text reaches the draft once, when the service does. A required section (estimate, terms, acceptance) is never hidden automatically (lead, 2026-10-29).
// A section's service text is a list of BLOCKS, one per service under its `**Name**` heading (the draft's first service may own the
// unheaded opening): service-blocks.ts (lead's decision 2026-10-29, docs/13; round 5). Whether a service already holds a part, where a part
// goes (into the service's own block, assumptions before its exclusions; else a new block at the end), what "Use Catalogue text" offers and
// what the room check counts are all asked of the service's own block only, with whole lines and whole texts, never of another service's
// text (two services that share a line; "None." inside a sentence). An addition that would pass a section's length limit, or the
// document's, is left out of that section and named as a gap (`noRoom`): never a refused save (lead's rule, 2026-10-29; round 4, M3).
// Known limits, by design (no migration; round 4, L1 and L4; round 5):
//   - text the person edited is told apart from text Catalogue has only by the row's `updated_at` (per row, not per field): after any edit
//     of that Catalogue item, a part the service's block no longer holds word for word is offered again as new;
//   - a section the person hid AND emptied reads the same as one hidden for having no text: a service added later shows it with its text;
//   - the unheaded opening goes with the FIRST service in line order: once the lines are reordered so that another service with no heading
//     of its own comes first, the opening is that service's, and the service whose text it holds has no block there;
//   - a part left out for room (M3) is named only while its service has no block in the section (services are left out whole); a part
//     missing from a block the service has is the person's edit, named only once the Catalogue row changes (L1);
//   - the reads (gaps, "Use Catalogue text") know only the services on the lines: the block of a service taken off the lines runs on as
//     part of the block above it until its text is removed.
// Pure: no I/O. The Worker budget forbids `import()`; everything here is static.
import { placeholdersOf, renderTemplate } from "@techaust/core/catalogue";
import { REQUIRED_SECTIONS, SECTION_BODY_MAX, SECTIONS_TOTAL_MAX } from "@techaust/core/documents";
import { type ItemRow, lineName } from "./quote-model.ts";
import {
  type BlockService,
  hasBlock,
  holdsText,
  insertParts,
  type ParsedBlocks,
  parseBlocks,
} from "./service-blocks.ts";

export type ServiceFacts = Pick<
  ItemRow,
  "id" | "code" | "name" | "short" | "deliverables_md" | "assumptions_md" | "exclusions_md"
> & {
  /** When the catalogue row last changed (`catalogue_items.updated_at`): read only for the gaps (`ITEMS_OF_DOCUMENT`). */
  updated_at?: number;
};

/** Whether a section left with no text may be hidden for it: never a required one (the send check needs it shown). */
export const autoHides = (kind: string): boolean => !(REQUIRED_SECTIONS as readonly string[]).includes(kind);

/** The three catalogue texts a draft section can show, with the section kind each one fills. */
export const GAP_FIELDS = [
  { field: "deliverables", kind: "deliverables", column: "deliverables_md" },
  { field: "assumptions", kind: "assumptions_exclusions", column: "assumptions_md" },
  { field: "exclusions", kind: "assumptions_exclusions", column: "exclusions_md" },
] as const;
export type GapField = (typeof GAP_FIELDS)[number]["field"];
export type GapKind = (typeof GAP_FIELDS)[number]["kind"];

export const isBlank = (v: string | null | undefined): boolean =>
  v === null || v === undefined || v.trim() === "";

/** The `service.*` values of the first service, as a template data map (blank texts as null). */
export function serviceData(first: ServiceFacts | null): Record<string, string | null> {
  return {
    "service.code": first?.code ?? null,
    "service.name": first ? lineName(first.name) : null,
    "service.short": first?.short ?? null,
    "service.deliverables": first?.deliverables_md ?? null,
    "service.assumptions": first?.assumptions_md ?? null,
    "service.exclusions": first?.exclusions_md ?? null,
  };
}

/** With a service present, the `service.*` tokens that have no text (empty); with none, nothing is known, so nothing is empty. */
export function emptyServiceTokens(first: ServiceFacts | null): Set<string> {
  const out = new Set<string>();
  if (!first) return out;
  for (const [name, value] of Object.entries(serviceData(first))) if (isBlank(value)) out.add(name);
  return out;
}

export const hasServiceToken = (text: string | null | undefined): boolean =>
  text ? placeholdersOf(text).some((n) => n.startsWith("service.")) : false;

type Fillable = { id: string; kind: string; title: string | null; bodyMd: string | null; hidden: boolean };

/** The characters a document's sections hold together (what `checkSections` holds to SECTIONS_TOTAL_MAX). */
export const textLength = (sections: readonly { bodyMd: string | null }[]): number =>
  sections.reduce((n, s) => n + (s.bodyMd?.length ?? 0), 0);

/**
 * Whether a section's text may become `next` within the limits `checkSections` holds every save to (round 4, M3): the section's own
 * SECTION_BODY_MAX, and SECTIONS_TOTAL_MAX over the document, whose sections hold `total` characters now.
 */
export const fits = (body: string | null, next: string, total: number): boolean =>
  next.length <= SECTION_BODY_MAX && total - (body?.length ?? 0) + next.length <= SECTIONS_TOTAL_MAX;

type Part = { field: GapField; text: string };

/** The draft's services as the blocks know them: the id and the name their heading shows. */
const asBlocks = (services: readonly ServiceFacts[]): BlockService[] =>
  services.map((s) => ({ id: s.id, name: lineName(s.name) }));

/** One service's Catalogue parts for a section of this kind, in their order (assumptions before exclusions), blanks dropped, trimmed. */
function partsOf(kind: GapKind, item: ServiceFacts): Part[] {
  return GAP_FIELDS.filter((g) => g.kind === kind).flatMap((g) => {
    const t = item[g.column];
    return isBlank(t) ? [] : [{ field: g.field, text: (t as string).trim() }];
  });
}

/** One service's parts put into a section's text by the block rule (`insertParts`, service-blocks.ts; its assumptions before its exclusions). */
const putIn = (
  body: string | null,
  all: readonly BlockService[],
  item: ServiceFacts,
  parts: readonly Part[],
  others: readonly BlockService[],
): string =>
  insertParts(
    body,
    all,
    { id: item.id, name: lineName(item.name) },
    parts,
    isBlank(item.exclusions_md) ? null : item.exclusions_md,
    others,
  );

/**
 * Adds each service that has no block in one section yet as a new block, by the block rule, in order; an addition that would pass a length
 * limit is left out (round 4, M3: the gaps name it as `noRoom`). A service that already has a block there (taken out and put back, or a
 * heading the person wrote) gets nothing: its block, edited or not, is the person's, so its text is never repeated under an edit (round 5,
 * finding 4; the gaps read it the same way). `all` is the draft's services in line order (the first may own the opening), `others`
 * services whose headings still stand in the text. `total` is the document's text length before; the answer carries the new one.
 */
function addServices(
  body: string | null,
  kind: GapKind,
  services: readonly ServiceFacts[],
  total: number,
  all: readonly BlockService[],
  others: readonly BlockService[],
): { body: string | null; total: number } {
  let b = body;
  let t = total;
  for (const item of services) {
    if (hasBlock(parseBlocks(b, all, others), item.id)) continue;
    const parts = partsOf(kind, item);
    if (parts.length === 0) continue;
    const next = putIn(b, all, item, parts, others);
    if (!fits(b, next, t)) continue;
    t += next.length - (b?.length ?? 0);
    b = next;
  }
  return { body: b, total: t };
}

/**
 * Fills every remaining `service.*` token of a draft's sections from its services (in line order, distinct): the first service by the
 * template rules, the others added by the block rule, only to a section that held a token, and only while the text stays within its
 * limits (round 4, M3). A section left with no text is hidden; a section that already shows text keeps its visibility. A draft with no
 * service is returned as it is.
 */
export function fillServiceTokens<S extends Fillable>(
  sections: readonly S[],
  services: readonly ServiceFacts[],
  scheduleSentence: string | null,
): S[] {
  const first = services[0] ?? null;
  if (!first) return [...sections];
  const data: Record<string, string | null> = { ...serviceData(first), "service.schedule": scheduleSentence };
  const empty = emptyServiceTokens(first);
  const all = asBlocks(services);
  const held = sections.map((s) => hasServiceToken(s.title) || hasServiceToken(s.bodyMd));
  const rendered = sections.map((s, n) =>
    held[n]
      ? {
          ...s,
          title: s.title === null ? null : renderTemplate(s.title, data, { empty }).text,
          bodyMd: s.bodyMd === null ? null : renderTemplate(s.bodyMd, data, { empty }).text,
        }
      : s,
  );
  let total = textLength(rendered);
  return rendered.map((s, n) => {
    if (!held[n]) return s;
    let body = s.bodyMd;
    const kind = s.kind;
    if (isGapKind(kind)) ({ body, total } = addServices(body, kind, services.slice(1), total, all, []));
    const blank = isBlank(body);
    return { ...s, bodyMd: blank ? null : body, hidden: s.hidden || (blank && autoHides(kind)) };
  });
}

/**
 * Each added service's texts go into its Deliverables and Assumptions and exclusions sections by the creation rule (a blank text is
 * dropped, never a `{{…}}` token; the block rule): at creation for every service after the first, and when a save adds a service to a draft
 * that already had services (review round 3, finding 1; round 4, L2). A service that already has a block in the section (taken out and put
 * back) gets nothing added to it, edited or not, so a save never repeats text (round 5, finding 4); the same line in ANOTHER service's block
 * is that service's and never stands for this one's (round 5, finding 1). An addition that would pass the section's or the document's length limit is left out of that
 * section (round 4, M3) and named as a gap (`noRoom`). A section that was hidden because it had no text is shown once it has some (as it
 * would have been made); a section the person hid while it had text stays hidden (round 4, L4: one hidden AND emptied by the person reads
 * as the first). Every other section, and a section with nothing added, is the same object (the caller tells the sections the server wrote
 * by identity).
 * `services` is the draft's services in line order, the added ones among them; the caller puts the services the draft had before first, so
 * an added service never owns the unheaded opening (it was written before the service came). `others` are services taken off the lines
 * whose headings still stand in the text (their blocks still end the blocks above them).
 */
export function appendServices<S extends Fillable>(
  sections: readonly S[],
  added: readonly ServiceFacts[],
  services: readonly ServiceFacts[],
  others: readonly ServiceFacts[] = [],
): S[] {
  if (added.length === 0) return [...sections];
  const all = asBlocks(services);
  const gone = asBlocks(others);
  let total = textLength(sections);
  return sections.map((s) => {
    const kind = s.kind;
    if (!isGapKind(kind)) return s;
    const out = addServices(s.bodyMd, kind, added, total, all, gone);
    total = out.total;
    if (out.body === s.bodyMd) return s;
    return { ...s, bodyMd: out.body, hidden: s.hidden && !isBlank(s.bodyMd) };
  });
}

/** The distinct catalogue items of a list of lines, in line order (the ids only: no row needs to have been read). */
export function serviceIdsOf(lines: readonly { catalogueItemId: string | null }[]): string[] {
  return [...new Set(lines.flatMap((l) => (l.catalogueItemId === null ? [] : [l.catalogueItemId])))];
}

/** The sections a draft's gaps are worked out from: its Deliverables and Assumptions and exclusions sections. */
export const isGapKind = (kind: string): kind is GapKind =>
  kind === "deliverables" || kind === "assumptions_exclusions";

/**
 * Whether a save changed anything the draft's Catalogue gaps depend on (review round 3, finding 6): the services on its lines (which, and in
 * which order) or the text or visibility of a Deliverables or Assumptions and exclusions section. A save of the other sections, of a line's
 * quantity or of the fields leaves the gaps as they were, so its answer carries none (the screen keeps the ones it has).
 */
export function gapInputsChanged(
  before: { services: readonly string[]; sections: readonly GapSection[] },
  after: { services: readonly string[]; sections: readonly GapSection[] },
): boolean {
  const { services: s0 } = before;
  const s1 = after.services;
  if (s0.length !== s1.length || s0.some((x, i) => x !== s1[i])) return true;
  // By kind, not by place (round 4, L6): the gaps read the one section of each kind, so moving a section changes nothing. The save's
  // catalogue read (`ITEMS_OF_SAVE`) makes the same comparison in SQL, exactly, so whenever this says "changed" the rows were read.
  const a = before.sections.filter((s) => isGapKind(s.kind));
  const b = after.sections.filter((s) => isGapKind(s.kind));
  const text = (v: string | null) => (isBlank(v) ? "" : v);
  return (
    a.length !== b.length ||
    a.some((s) => {
      const t = b.find((x) => x.kind === s.kind);
      return !t || t.id !== s.id || t.hidden !== s.hidden || text(t.bodyMd) !== text(s.bodyMd);
    })
  );
}

/** The distinct services of a draft's lines, in line order, from the catalogue rows that were read (a retired or missing item is skipped). */
export function servicesOf(
  lines: readonly { catalogueItemId: string | null }[],
  items: ReadonlyMap<string, ServiceFacts>,
): ServiceFacts[] {
  const seen = new Set<string>();
  const out: ServiceFacts[] = [];
  for (const l of lines) {
    if (l.catalogueItemId === null || seen.has(l.catalogueItemId)) continue;
    seen.add(l.catalogueItemId);
    const item = items.get(l.catalogueItemId);
    if (item) out.push(item);
  }
  return out;
}

// ---- gaps: what Catalogue lacks, or has now, for the draft's sections ----------------------------------------------------------------

export type CatalogueGap = {
  sectionId: string | null;
  sectionKind: GapKind;
  field: GapField;
  serviceCode: string;
  serviceName: string;
  catalogueItemId: string;
  catalogueHasTextNow: boolean;
  /**
   * Catalogue has the text, but the section has no room for it (round 4, M3): adding it would pass the section's 6,000 characters or the
   * document's 30,000, so it was left out (at creation, by the save that added the service, or by "Use Catalogue text"). Never also "now".
   */
  noRoom: boolean;
};

type GapSection = { id: string; kind: string; bodyMd: string | null; hidden: boolean };
type KindSection = GapSection & { kind: GapKind };

/**
 * Whether Catalogue text of one service and field may be offered to a section ("Use Catalogue text"): Catalogue has it, the service's own
 * block does not hold it (round 5: never another service's block), and either the section shows nothing (adding can't repeat anything) or
 * the Catalogue row changed after the draft was made (`updated_at > createdAt`, review round 2 finding 3). Text Catalogue already had when
 * the draft was made went into it then (or, for a service added later, when the save added it: `appendServices`), so a block without it
 * holds the person's own wording: it is never called new, and never added a second time. `createdAt` is the version group's first creation
 * time (`gapBaseline`): a revision copies its sections from the version before it, so Catalogue text changed since the first version was
 * made is new to it too.
 */
function offered(
  section: GapSection,
  blocks: ParsedBlocks,
  svc: ServiceFacts,
  text: string | null,
  createdAt: number,
): boolean {
  if (isBlank(text) || holdsText(blocks, svc.id, text as string)) return false;
  const closed = section.hidden || isBlank(section.bodyMd);
  return closed || (svc.updated_at ?? 0) > createdAt;
}

/** The parts of one service "Use Catalogue text" would put into the section (the ones `offered`), in their order. */
const offeredParts = (
  section: KindSection,
  blocks: ParsedBlocks,
  svc: ServiceFacts,
  createdAt: number,
): Part[] => partsOf(section.kind, svc).filter((p) => offered(section, blocks, svc, p.text, createdAt));

/**
 * Whether these parts of one service, put in by the block rule, keep the section and the document within their limits (round 4, M3).
 * Only the parts that would really be put in are counted (round 5, finding 3), never a part the person took out of the service's block.
 */
function roomFor(
  section: GapSection,
  all: readonly BlockService[],
  svc: ServiceFacts,
  parts: readonly Part[],
  total: number,
): boolean {
  if (parts.length === 0) return true;
  return fits(section.bodyMd, putIn(section.bodyMd, all, svc, parts, []), total);
}

/**
 * The gaps of a draft, worked out from its services and their CURRENT catalogue rows (`createdAt` = the draft's `created_at`), each
 * service against its own block (round 5):
 *   - Catalogue has text the service's block lacks:
 *       - when it may be offered (`offered`): a gap with `catalogueHasTextNow`, or with `noRoom` when the parts that would be put in (only
 *         the offered ones: round 5, finding 3) would not fit;
 *       - when it is not offered and the service has no block in the section at all (it was left out whole): a gap with `noRoom` when its
 *         parts would not fit now (round 4, M3: left out for the limit); otherwise the person took it out, and nothing is named;
 *       - when it is not offered and the service has a block: the person's edit; nothing is named;
 *   - Catalogue has no text for a service (owner Q3, lead's reading 2026-10-29: every such service is named): a gap when the section is
 *     hidden or empty, when that service has the sibling field (the partial Assumptions and exclusions case), or when the section shows
 *     another service's Catalogue text (in that service's block). A section that shows only the person's own writing raises none for it.
 * A draft with no section of that kind (the estimate template has none) has nothing to fill and nothing to hide: no gap.
 */
export function catalogueGaps(
  sections: readonly GapSection[],
  services: readonly ServiceFacts[],
  createdAt: number,
): CatalogueGap[] {
  const out: CatalogueGap[] = [];
  const total = textLength(sections);
  const all = asBlocks(services);
  const parsed = new Map<string, ParsedBlocks>();
  const blocksOf = (s: GapSection): ParsedBlocks => {
    const known = parsed.get(s.id);
    if (known) return known;
    const p = parseBlocks(s.bodyMd, all);
    parsed.set(s.id, p);
    return p;
  };
  for (const svc of services) {
    for (const g of GAP_FIELDS) {
      const found = sections.find((s) => s.kind === g.kind);
      if (found === undefined) continue;
      const section = found as KindSection;
      const blocks = blocksOf(section);
      const text = svc[g.column];
      let now = false;
      let noRoom = false;
      if (!isBlank(text)) {
        if (holdsText(blocks, svc.id, text as string)) continue;
        if (offered(section, blocks, svc, text, createdAt)) {
          noRoom = !roomFor(section, all, svc, offeredParts(section, blocks, svc, createdAt), total);
          now = !noRoom;
        } else if (!hasBlock(blocks, svc.id)) {
          const missing = partsOf(g.kind, svc).filter((p) => !holdsText(blocks, svc.id, p.text));
          noRoom = !roomFor(section, all, svc, missing, total);
          if (!noRoom) continue;
        } else continue;
      } else {
        const closed = section.hidden || isBlank(section.bodyMd);
        const siblingHas = GAP_FIELDS.some(
          (o) => o.kind === g.kind && o.field !== g.field && !isBlank(svc[o.column]),
        );
        const showsAnother = services.some(
          (o) =>
            o !== svc &&
            GAP_FIELDS.some(
              (f) =>
                f.kind === g.kind && !isBlank(o[f.column]) && holdsText(blocks, o.id, o[f.column] as string),
            ),
        );
        if (!(closed || siblingHas || showsAnother)) continue;
      }
      out.push({
        sectionId: section.id,
        sectionKind: g.kind,
        field: g.field,
        serviceCode: svc.code,
        serviceName: lineName(svc.name),
        catalogueItemId: svc.id,
        catalogueHasTextNow: now,
        noRoom,
      });
    }
  }
  return out;
}

/**
 * The section's text after "Use Catalogue text": exactly the parts the gaps offer (`catalogueHasTextNow`) put in by the block rule (into
 * the service's own block; else a new block under its name; the draft's first service into a blank section plain, as the template would
 * have made it), so the button never repeats text a service's block holds and never re-adds a part the person edited out. A service whose
 * parts would pass a length limit is left out (round 4, M3; `total` = the document's text length now); `bounded: false` puts every offered
 * part in (the route's way to tell "no room" from "nothing to fill"). Null when nothing is added.
 */
export function filledBody(
  section: GapSection,
  services: readonly ServiceFacts[],
  createdAt: number,
  total: number,
  bounded = true,
): string | null {
  if (!isGapKind(section.kind)) return null;
  const gap = section as KindSection;
  const all = asBlocks(services);
  const blocks = parseBlocks(section.bodyMd, all);
  let body = section.bodyMd;
  let t = total;
  for (const svc of services) {
    const parts = offeredParts(gap, blocks, svc, createdAt);
    if (parts.length === 0) continue;
    const next = putIn(body, all, svc, parts, []);
    if (bounded && !fits(body, next, t)) continue;
    t += next.length - (body?.length ?? 0);
    body = next;
  }
  return body === section.bodyMd ? null : body;
}
