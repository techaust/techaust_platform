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
//   - a part left out for room (M3) is named while its service has no block in the section, or, for the draft's first service, while its
//     unheaded opening holds none of the section's parts (services are left out whole; the first service, left out of its own template
//     fill, keeps the template's words as its opening: FX-3 round 2). Any other part missing from a block is the person's edit, named only
//     once the Catalogue row changes (L1). The first service's parts deleted by the person from its opening, in a section with no room for
//     them, read as left out and are named too;
//   - the first service's Catalogue text left out of a section of another kind (a staff template that puts `{{service.deliverables}}` into
//     Scope, say) or out of a section title is not named: the gaps read only the Deliverables and Assumptions and exclusions sections;
//   - the reads (gaps, "Use Catalogue text") know only the services on the lines: the block of a service taken off the lines runs on as
//     part of the block above it until its text is removed;
//   - a save puts the services the draft had before the ones it adds, while the reads take line order (round 5 re-check, L3): a service
//     added on a line ABOVE a first service with no heading gets a headed block, and the reads then give the opening to the added service
//     (the first limit above);
//   - two services with the same line name share one heading, the first in line order owning it (round 5 re-check, L2): Catalogue names
//     are not unique, so the second has no block of its own and its Catalogue text is offered again after each change of its row;
//   - a save that adds a service to a draft with no service and no `{{service.*}}` token left (every line removed and saved, then a line
//     added) puts nothing in: the text there is taken as the person's own, by the round 4 L2 rule;
//   - short values never take a title or a text past its limit (FX-3 round 3: they stay unfilled and the send names them), but the
//     template's own text is not shortened: a template version saved before the joined-sections rule (Q2) whose custom sections past the
//     third join past 6,000 characters still makes a draft whose saves are refused until that section is shortened. Templates made from
//     the seed never do.
// Pure: no I/O. The Worker budget forbids `import()`; everything here is static.
import { placeholdersOf, renderTemplate } from "@techaust/core/catalogue";
import {
  REQUIRED_SECTIONS,
  SECTION_BODY_MAX,
  SECTION_TITLE_MAX,
  SECTIONS_TOTAL_MAX,
} from "@techaust/core/documents";
import { type ItemRow, lineName } from "./quote-model.ts";
import {
  type BlockService,
  hasBlock,
  holdsText,
  insertParts,
  ownsOpening,
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

/** The `service.*` tokens that carry a service's Catalogue text: the ones whose value can be long (up to 2,500 characters each). */
export const TEXT_TOKENS = ["service.deliverables", "service.assumptions", "service.exclusions"] as const;
const TOKEN_FIELD: Record<(typeof TEXT_TOKENS)[number], GapField> = {
  "service.deliverables": "deliverables",
  "service.assumptions": "assumptions",
  "service.exclusions": "exclusions",
};

/** Template data without the Catalogue texts, and the empty set with them: the render that leaves the first service's texts out. */
export function withoutTexts<V>(
  data: Readonly<Record<string, V>>,
  empty: ReadonlySet<string>,
): { data: Record<string, V>; empty: Set<string> } {
  const out: Record<string, V> = { ...data };
  for (const t of TEXT_TOKENS) delete out[t];
  return { data: out, empty: new Set([...empty, ...TEXT_TOKENS]) };
}

type Rendered = { title: string | null; bodyMd: string | null };

const TEXT_SET: ReadonlySet<string> = new Set(TEXT_TOKENS);

/**
 * A draft section's title and text with the template's values filled (at creation, and by the save that adds the first service). A
 * value that would take the title past SECTION_TITLE_MAX stays unfilled, as written (FX-3 round 3, lead's answer to round 2 Q1,
 * docs/13 2026-10-29): the send check names it and the person writes a shorter title, so the draft is never stored with a title every
 * later save refuses. The Catalogue texts are never held back here (`unbounded`): their room is `fitFirstService`'s rule. With
 * `bodyMax`, the text is held to it the same way (`renderWithin`). A text left with nothing in it is null.
 */
export function renderSection(
  s: Rendered,
  data: Readonly<Record<string, string | number | null | undefined>>,
  empty: ReadonlySet<string>,
  bodyMax?: number,
): Rendered {
  const title =
    s.title === null
      ? null
      : renderTemplate(s.title, data, { empty, max: SECTION_TITLE_MAX, unbounded: TEXT_SET }).text;
  const body =
    s.bodyMd === null
      ? null
      : renderTemplate(s.bodyMd, data, { empty, max: bodyMax, unbounded: TEXT_SET }).text;
  return { title, bodyMd: body === null || body.trim() === "" ? null : body };
}

/**
 * The sections with the template's values filled, each text kept within SECTION_BODY_MAX and all of them within SECTIONS_TOTAL_MAX (FX-3
 * round 3, with the lead's answer to round 2 Q2): a short value (a name, the short text, the schedule sentence) that would take a text past
 * its share stays unfilled, as for a title, and the send check names it. In section order, each text may grow by what the document has
 * left. Only the sections `held` marks are filled (all when it is absent); the others count as they stand. Used for the render without
 * the Catalogue texts (`bare`, and the whole fill when there is no service yet); the Catalogue texts are `fitFirstService`'s.
 */
export function renderWithin<S extends Rendered>(
  sections: readonly S[],
  data: Readonly<Record<string, string | number | null | undefined>>,
  empty: ReadonlySet<string>,
  held?: readonly boolean[],
): Rendered[] {
  let left = SECTIONS_TOTAL_MAX - textLength(sections);
  return sections.map((s, n) => {
    if (held && !held[n]) return s;
    const before = s.bodyMd?.length ?? 0;
    const r = renderSection(s, data, empty, Math.min(SECTION_BODY_MAX, before + Math.max(0, left)));
    left -= (r.bodyMd?.length ?? 0) - before;
    return r;
  });
}

/**
 * One section of the first service's own template fill: its kind, its text before the fill (`raw`, for the tokens it holds), and the
 * section rendered twice: `full` with the service's Catalogue texts, `bare` with them taken out (their lines too, as for an empty text).
 */
export type FirstFill = { kind: string; raw: string | null; full: Rendered; bare: Rendered };

/**
 * The first service's own template fill, by the leave-out-and-name rule the services added after it get (round 4, M3; FX-3 round 2):
 *   - in section order, a section takes `full` while its text stays within SECTION_BODY_MAX and the document within SECTIONS_TOTAL_MAX,
 *     counted with every section `bare` (so the order decides, as it does for the services added after it);
 *   - a section with no room for it takes `bare`. A Deliverables or Assumptions and exclusions section then gets the service's parts its
 *     template held put in once, by the block rule, when that fits (a repeated token, or the token's own line, can make `full` the longer
 *     text). The gaps count the room the same way, so whatever is left out of such a section is named (`noRoom`);
 *   - a title that would pass SECTION_TITLE_MAX takes its `bare` title.
 * Never a refusal. `leftOut`: the section's Catalogue text was left out, whole (a section left with no text is hidden like an empty one).
 */
export function fitFirstService(
  rows: readonly FirstFill[],
  services: readonly ServiceFacts[],
): (Rendered & { leftOut: boolean })[] {
  const first = services[0];
  if (!first) return rows.map((r) => ({ ...r.full, leftOut: false }));
  const all = asBlocks(services);
  let total = textLength(rows.map((r) => r.bare));
  return rows.map((r) => {
    const title =
      r.full.title !== null && r.full.title.length > SECTION_TITLE_MAX ? r.bare.title : r.full.title;
    const before = r.bare.bodyMd;
    const take = (bodyMd: string | null, leftOut: boolean) => {
      total += (bodyMd?.length ?? 0) - (before?.length ?? 0);
      return { title, bodyMd, leftOut };
    };
    if (r.full.bodyMd === before) return take(before, false);
    if (fits(before, r.full.bodyMd ?? "", total)) return take(r.full.bodyMd, false);
    if (isGapKind(r.kind)) {
      const held = new Set(r.raw === null ? [] : placeholdersOf(r.raw));
      const fields = new Set(TEXT_TOKENS.filter((t) => held.has(t)).map((t) => TOKEN_FIELD[t]));
      const parts = partsOf(r.kind, first).filter((p) => fields.has(p.field));
      if (parts.length > 0) {
        const next = putIn(before, all, first, parts, []);
        if (fits(before, next, total)) return take(next, false);
      }
    }
    return take(before, true);
  });
}

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
 * limits (round 4, M3; the first service's own fill too, FX-3 round 2: `fitFirstService`). A section left with no text is hidden; a section that already shows text keeps its visibility. A draft with no
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
  const bare = withoutTexts(data, empty);
  const all = asBlocks(services);
  const held = sections.map((s) => hasServiceToken(s.title) || hasServiceToken(s.bodyMd));
  // The first service's own fill keeps to the limits too (FX-3 round 2): a section with no room for its Catalogue text keeps the
  // template's text without it, and the gaps name what was left out. A short value that would pass a title's limit, or a text's, stays
  // unfilled (round 3: `renderSection`, `renderWithin`).
  const bareRendered = renderWithin(sections, bare.data, bare.empty, held);
  const fitted = fitFirstService(
    sections.map((s, n) =>
      held[n]
        ? {
            kind: s.kind,
            raw: s.bodyMd,
            full: renderSection(s, data, empty),
            bare: bareRendered[n] as Rendered,
          }
        : { kind: s.kind, raw: null, full: s, bare: s },
    ),
    services,
  );
  const rendered = sections.map((s, n) => {
    const f = fitted[n] as Rendered;
    return held[n] ? { ...s, title: f.title, bodyMd: f.bodyMd } : s;
  });
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
 *       - when it is not offered and the service has no block in the section, or is the first service whose unheaded opening holds none
 *         of the section's parts (left out whole: a later service, or the first service's own template fill, FX-3 round 2): a gap with
 *         `noRoom` when its parts would not fit now (round 4, M3: left out for the limit); otherwise the person took it out, and nothing
 *         is named;
 *       - when it is not offered and the service has any other block: the person's edit; nothing is named (round 5, finding 3);
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
        } else {
          // Left out whole: no block, or the first service's unheaded opening holding none of the section's parts (the template's own
          // words, when its own template fill had no room: FX-3 round 2). Any other block without them is the person's edit (L1; round 5,
          // finding 3).
          const own = partsOf(g.kind, svc);
          const missing = own.filter((p) => !holdsText(blocks, svc.id, p.text));
          const wholeOut =
            !hasBlock(blocks, svc.id) || (ownsOpening(blocks, svc.id) && missing.length === own.length);
          if (!wholeOut) continue;
          noRoom = !roomFor(section, all, svc, missing, total);
          if (!noRoom) continue;
        }
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
