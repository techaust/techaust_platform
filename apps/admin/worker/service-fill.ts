// Filling a draft's `{{service.*}}` placeholders from the services it holds (ADM-PROP-02; owner decisions 2026-10-28 and 2026-10-29, docs/13).
// Two different states, never mixed up:
//   - UNKNOWN: the draft has no service yet (so no catalogue text can exist): the token stays in the text, and the send check names it.
//   - EMPTY:   a service is there but its Deliverables, Assumptions or Exclusions text is blank: the token is taken out (its line too), a
//              section left with no text is hidden, and nothing blocks the send. The gap is reported on the draft read (`catalogueGaps`)
//              so the screen can name the service and send the person to Catalogue.
// The first service fills the template's tokens; every other service adds its own text under its name (the M4.3 shape), so a later service's
// text never sits under a leftover token. Pure: no I/O. The Worker budget forbids `import()`; everything here is static.
import { placeholdersOf, renderTemplate } from "@techaust/core/catalogue";
import { type ItemRow, lineName } from "./quote-model.ts";

export type ServiceFacts = Pick<
  ItemRow,
  "id" | "code" | "name" | "short" | "deliverables_md" | "assumptions_md" | "exclusions_md"
>;

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

/** What a further service adds to a section of this kind: its name in bold, then its text; null when it has none. */
export function appendedText(kind: GapKind, item: ServiceFacts): string | null {
  const parts = kind === "deliverables" ? [item.deliverables_md] : [item.assumptions_md, item.exclusions_md];
  const text = parts.filter((p): p is string => !isBlank(p)).join("\n");
  return text === "" ? null : `**${lineName(item.name)}**\n${text}`;
}

export const hasServiceToken = (text: string | null | undefined): boolean =>
  text ? placeholdersOf(text).some((n) => n.startsWith("service.")) : false;

type Fillable = { id: string; kind: string; title: string | null; bodyMd: string | null; hidden: boolean };

const joinBlocks = (a: string | null, b: string): string => (isBlank(a) ? b : `${a}\n\n${b}`);

/**
 * Fills every remaining `service.*` token of a draft's sections from its services (in line order, distinct): the first service by the
 * template rules, the others appended under their names, only to a section that held a token. A section left with no text is hidden;
 * a section that already shows text keeps its visibility. A draft with no service is returned as it is.
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
  return sections.map((s) => {
    if (!hasServiceToken(s.title) && !hasServiceToken(s.bodyMd)) return s;
    const title = s.title === null ? null : renderTemplate(s.title, data, { empty }).text;
    let body = s.bodyMd === null ? null : renderTemplate(s.bodyMd, data, { empty }).text;
    const kind = s.kind;
    if (kind === "deliverables" || kind === "assumptions_exclusions") {
      for (const item of services.slice(1)) {
        const text = appendedText(kind, item);
        if (text !== null) body = joinBlocks(body, text);
      }
    }
    const blank = isBlank(body);
    return { ...s, title, bodyMd: blank ? null : body, hidden: s.hidden || blank };
  });
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
};

const SAMPLE = 60;
/** The service's text is already in the section: its first characters appear (an edit further down does not make it a gap). */
const included = (body: string | null, text: string): boolean =>
  (body ?? "").includes(text.trim().slice(0, SAMPLE));

/**
 * The gaps of a draft, worked out from its services and their CURRENT catalogue rows:
 *   - a hidden or empty section: every field of its kind, for every service (`catalogueHasTextNow` says whether Catalogue has text now);
 *   - a section that shows text: the field of a service that Catalogue has now but the section does not hold (filled since), and, in the
 *     Assumptions and exclusions section, a field that is empty while its sibling has text (the partial case).
 * `sectionId` is null when the draft has no section of that kind.
 */
export function catalogueGaps(
  sections: readonly { id: string; kind: string; bodyMd: string | null; hidden: boolean }[],
  services: readonly ServiceFacts[],
): CatalogueGap[] {
  const out: CatalogueGap[] = [];
  for (const svc of services) {
    for (const g of GAP_FIELDS) {
      const section = sections.find((s) => s.kind === g.kind) ?? null;
      const text = svc[g.column];
      const has = !isBlank(text);
      const siblingHas = GAP_FIELDS.some(
        (o) => o.kind === g.kind && o.field !== g.field && !isBlank(svc[o.column]),
      );
      // A draft with no such section (the estimate template has none) has nothing to fill and nothing to hide: no gap.
      if (section === null) continue;
      if (has && included(section.bodyMd, text as string)) continue;
      const closed = section.hidden || isBlank(section.bodyMd);
      if (!(closed || has || siblingHas)) continue;
      out.push({
        sectionId: section.id,
        sectionKind: g.kind,
        field: g.field,
        serviceCode: svc.code,
        serviceName: lineName(svc.name),
        catalogueItemId: svc.id,
        catalogueHasTextNow: has,
      });
    }
  }
  return out;
}

/** The text "Use Catalogue text" adds to one section: each service's text that Catalogue has and the section does not hold, under its name. */
export function textToFill(
  section: { kind: string; bodyMd: string | null },
  services: readonly ServiceFacts[],
): string | null {
  if (section.kind !== "deliverables" && section.kind !== "assumptions_exclusions") return null;
  const kind: GapKind = section.kind;
  const blocks: string[] = [];
  services.forEach((svc, i) => {
    const columns = GAP_FIELDS.filter((g) => g.kind === kind);
    const parts = columns.map((g) => svc[g.column]).filter((t): t is string => !isBlank(t));
    // Only the parts the section does not hold yet (a service whose assumptions are in already gets just its exclusions).
    const missing = parts.filter((t) => !included(section.bodyMd, t));
    if (missing.length === 0) return;
    // The first service of a draft that shows nothing yet reads as the template would have made it: its text without a name.
    const plain = i === 0 && isBlank(section.bodyMd);
    blocks.push(plain ? missing.join("\n") : `**${lineName(svc.name)}**\n${missing.join("\n")}`);
  });
  return blocks.length === 0 ? null : blocks.join("\n\n");
}
