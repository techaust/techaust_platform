// Collects the JSON-LD nodes a page's components add while it renders, so the layout prints one @graph per page
// (components/PageGraph.astro, after the page's content). Keyed by the render's Request, which every component of one
// page shares; the WeakMap lets it go with the request. Nodes are deduplicated by `@id` (a node without one is kept).
import type { LdNode } from "./structured-data";

const store = new WeakMap<object, LdNode[]>();

export function addLd(request: object, node: LdNode): void {
  const list = store.get(request) ?? [];
  const id = node["@id"];
  if (id === undefined || !list.some((n) => n["@id"] === id)) list.push(node);
  store.set(request, list);
}

export const takeLd = (request: object): LdNode[] => store.get(request) ?? [];
