// M6.3 staging fixes, part 3: reading where things landed in a PDF Chromium printed, for the page and break checks (./page-count.spec.ts,
// ./layout-audit.spec.ts). Chromium prints a TAGGED PDF: every run of text, image and table cell is a marked-content sequence with an id (MCID) on its
// page, and the structure tree says which element (P, H2, H3, Table, TD, Figure…) each sequence belongs to, in document order. The page-margin footer is
// an artifact and carries no id. So:
//   - `marksPerPage`: how much each page holds (0 = a blank page, a handful = a page holding one line);
//   - `structure`: the elements in document order with the pages their content sits on; from it `headingAtFoot` finds a heading whose content is
//     overleaf (a heading alone at the foot of a page).
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFName,
  PDFNumber,
  type PDFObject,
  PDFRawStream,
  PDFRef,
} from "@cantoo/pdf-lib";

/** The marked-content ids on each page. */
export function marksPerPage(pdf: PDFDocument): number[] {
  return pdf.getPages().map((p) => {
    const contents = p.node.Contents();
    const streams =
      contents instanceof PDFArray ? contents.asArray().map((r) => pdf.context.lookup(r)) : [contents];
    let ops = "";
    for (const s of streams)
      if (s instanceof PDFRawStream) ops += Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
    return (ops.match(/\/MCID\s+\d+/g) ?? []).length;
  });
}

/** One element of the structure tree: its role, its depth, and the pages (1-based) of the content directly or indirectly inside it, in order. */
export type StructNode = { role: string; depth: number; pages: number[] };

/** The structure tree flattened in document order (each element once, its pages from every marked-content sequence below it). */
export function structure(pdf: PDFDocument): StructNode[] {
  const pageOf = new Map<string, number>();
  pdf.getPages().forEach((p, i) => {
    pageOf.set(p.ref.toString(), i + 1);
  });
  const look = (o: PDFObject | undefined): PDFObject | undefined =>
    o instanceof PDFRef ? pdf.context.lookup(o) : o;
  const out: StructNode[] = [];
  const pageRef = (d: PDFDict, inherited: number | null): number | null => {
    const pg = d.get(PDFName.of("Pg"));
    return pg instanceof PDFRef ? (pageOf.get(pg.toString()) ?? inherited) : inherited;
  };
  const walk = (node: PDFObject | undefined, depth: number, page: number | null, sink: number[][]): void => {
    const o = look(node);
    if (o instanceof PDFNumber) {
      if (page !== null) for (const s of sink) s.push(page);
      return;
    }
    if (o instanceof PDFArray) {
      for (const k of o.asArray()) walk(k, depth, page, sink);
      return;
    }
    if (!(o instanceof PDFDict)) return;
    const type = o.get(PDFName.of("Type"));
    if (type instanceof PDFName && type.asString() === "/MCR") {
      const p = pageRef(o, page);
      if (p !== null) for (const s of sink) s.push(p);
      return;
    }
    const role = o.get(PDFName.of("S"));
    const own: StructNode = {
      role: role instanceof PDFName ? role.asString().slice(1) : "?",
      depth,
      pages: [],
    };
    out.push(own);
    walk(o.get(PDFName.of("K")), depth + 1, pageRef(o, page), [...sink, own.pages]);
  };
  const root = pdf.catalog.lookup(PDFName.of("StructTreeRoot"));
  if (root instanceof PDFDict) walk(root.get(PDFName.of("K")), 0, null, []);
  return out;
}

/**
 * The headings (H1 to H6) that end a page: the heading's own text is on page n and the next element with content starts on page n + 1, so the
 * reader meets the heading at the foot of one page and its content overleaf. Returns "H3 on page 1" style labels.
 */
export function headingAtFoot(nodes: StructNode[]): string[] {
  const found: string[] = [];
  nodes.forEach((n, i) => {
    if (!/^H[1-6]$/.test(n.role) || n.pages.length === 0) return;
    const at = n.pages[n.pages.length - 1] as number;
    // the next element after the heading's own subtree (its descendants follow it directly, one level deeper or more)
    let j = i + 1;
    while (j < nodes.length && (nodes[j] as StructNode).depth > n.depth) j++;
    const next = nodes.slice(j).find((m) => m.pages.length > 0);
    if (next && (next.pages[0] as number) > at) found.push(`${n.role} on page ${at}`);
  });
  return found;
}
