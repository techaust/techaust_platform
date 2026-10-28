// DEV ONLY (M5 owner fixes, designer): a stand-in for the builder's B2 answer while the two are built in parallel, so the draft screens
// can be drawn with Catalogue gaps before the real API lands. It does nothing unless `localStorage["ta-mock-gaps"]` is set on this device
// ("1": every service's texts empty; "partial": assumptions there, exclusions missing; "now": as "1", but Catalogue has the text now), and
// nothing at all once the API sends `catalogueGaps` itself. Every call site sits behind `import.meta.env.DEV`, so a production build drops it.
// The sample text it adds says it is sample text. Remove this file in the real-API pass.
import { RequestError } from "../api.ts";
import type { Blocker, CatalogueGap, DocumentView, PlaceholderWhere } from "./documents-api.ts";

const KEY = "ta-mock-gaps";
const FILLED = "ta-mock-gaps-filled";
const SERVICE_TOKEN = /\{\{\s*service\.(deliverables|assumptions|exclusions)\s*\}\}/g;
const ANY_TOKEN = /\{\{\s*([a-z_]+(?:\.[a-z_]+)*)\s*\}\}/g;

function flag(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export const mockGapsOn = () => flag() !== null;

function filled(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(FILLED) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export async function mockFill(sectionId: string): Promise<{ updatedAt?: number }> {
  await new Promise((r) => setTimeout(r, 400));
  if (flag() !== "now") throw new RequestError(409, "nothing_to_fill", "Nothing to fill (mock).");
  sessionStorage.setItem(FILLED, JSON.stringify([...filled(), sectionId]));
  return {};
}

export function mockGaps(v: DocumentView): DocumentView {
  const mode = flag();
  if (!mode || v.frozen || v.catalogueGaps) return v;
  const services = new Map<string, string>();
  for (const l of v.lines)
    if (l.catalogueItemId && !services.has(l.catalogueItemId)) services.set(l.catalogueItemId, l.description);
  const done = filled();
  const gaps: CatalogueGap[] = [];
  const sections = v.sections.map((s) => {
    if (s.kind !== "deliverables" && s.kind !== "assumptions_exclusions") return s;
    const fields =
      s.kind === "deliverables" ? (["deliverables"] as const) : (["assumptions", "exclusions"] as const);
    if (done.includes(s.id))
      return { ...s, hidden: false, bodyMd: `Sample Catalogue text for ${s.title ?? s.kind} (mock).` };
    const body = (s.bodyMd ?? "").replace(SERVICE_TOKEN, (_m, f: string) =>
      mode === "partial" && f === "assumptions" ? "Sample assumptions from Catalogue (mock)." : "",
    );
    for (const [id, name] of services)
      for (const field of fields)
        if (!(mode === "partial" && field === "assumptions"))
          gaps.push({
            sectionId: s.id,
            sectionKind: s.kind,
            field,
            serviceCode: "S5",
            serviceName: name,
            catalogueItemId: id,
            catalogueHasTextNow: mode === "now",
          });
    const text = body.trim();
    return { ...s, bodyMd: text === "" ? null : text, hidden: text === "" ? true : s.hidden };
  });
  // The send check, as B2 answers it: what is left of the placeholders, with where each one sits.
  const where: PlaceholderWhere[] = [];
  const scan = (
    text: string | null | undefined,
    part: PlaceholderWhere["part"],
    sec?: { id: string; kind: string },
  ) => {
    for (const m of (text ?? "").matchAll(ANY_TOKEN))
      where.push({ name: m[1] as string, sectionId: sec?.id ?? null, sectionKind: sec?.kind ?? null, part });
  };
  scan(v.title, "title");
  for (const l of v.lines) scan(`${l.description}\n${l.detail ?? ""}`, "line");
  for (const s of sections) if (!s.hidden) scan(`${s.title ?? ""}\n${s.bodyMd ?? ""}`, "section", s);
  for (const x of v.schedule) scan(`${x.label}\n${x.detail ?? ""}`, "schedule");
  const names = [...new Set(where.map((w) => w.name))];
  const blockers: Blocker[] = v.blockers
    .filter((b) => b.code !== "unresolved_placeholders")
    .concat(names.length > 0 ? [{ code: "unresolved_placeholders", names, where }] : []);
  return { ...v, sections, blockers, unresolved: names, catalogueGaps: gaps };
}
