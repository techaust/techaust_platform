// The GSTR-3B outward-supply summary, worked out from the GSTR-1 sections of the same period (M5.5b, LD83; ADM-REP-04,
// docs/08-research-appendix/A-gst-invoicing.md :505). A helper for the CA, not a return: the owner or CA types the figures into the
// portal. UNVERIFIED mapping, VERIFY WITH CA/LEGAL:
//   3.1(a) outward taxable supplies (other than zero rated, nil rated and exempted) = b2b + b2cl + b2cs + cdnr + cdnur (B2CL);
//   3.1(b) outward taxable supplies (zero rated)                                   = exp + cdnur (EXPWP and EXPWOP);
//   3.2    inter-state supplies to unregistered persons, by place of supply        = b2cl + cdnur (B2CL) + inter-state b2cs, netted.
// Every figure is checked against the GSTR-1 totals; a disagreement is `totals_mismatch` (nothing is shown that does not add up).
import type { StateCode } from "../gstin.ts";
import type { Gstr1Sections, InvoiceRow, NoteRow, SectionTotals } from "./sections.ts";
import { compareText, fail, type GstIssue, type GstResult, guard, issue, num, ok } from "./types.ts";

export type Gstr3bTable = "3.1(a)" | "3.1(b)" | "3.2";

/** One line of the summary. Table 3.2 lines carry the place of supply and only taxable value and IGST. */
export type Gstr3bLine = {
  readonly table: Gstr3bTable;
  readonly posCode: StateCode | null;
  readonly taxableMinor: number;
  readonly igstMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
};

export type Gstr3bSummary = { readonly lines: readonly Gstr3bLine[] };

type Sum = { taxable: bigint; igst: bigint; cgst: bigint; sgst: bigint };
const zero = (): Sum => ({ taxable: 0n, igst: 0n, cgst: 0n, sgst: 0n });
type Amounts = {
  readonly taxableMinor: number;
  readonly igstMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
};
const add = (into: Sum, r: Amounts, sign: bigint): void => {
  into.taxable += sign * BigInt(r.taxableMinor);
  into.igst += sign * BigInt(r.igstMinor);
  into.cgst += sign * BigInt(r.cgstMinor);
  into.sgst += sign * BigInt(r.sgstMinor);
};
const noteSign = (r: NoteRow): bigint => (r.noteType === "C" ? -1n : 1n);
const sameAs = (s: Sum, t: SectionTotals): boolean =>
  s.taxable === BigInt(t.taxableMinor) &&
  s.igst === BigInt(t.igstMinor) &&
  s.cgst === BigInt(t.cgstMinor) &&
  s.sgst === BigInt(t.sgstMinor);

const sumInvoices = (rows: readonly InvoiceRow[], into: Sum): Sum => {
  for (const r of rows) add(into, r, 1n);
  return into;
};

/** The 3B lines of one return period; a figure that does not match the GSTR-1 totals fails the whole summary. */
export function gstr3bSummary(sections: Gstr1Sections): GstResult<Gstr3bSummary> {
  return guard(() => {
    const a = zero();
    const b = zero();
    const inter = new Map<StateCode, Sum>();
    const interOf = (pos: StateCode): Sum => {
      let s = inter.get(pos);
      if (s === undefined) {
        s = zero();
        inter.set(pos, s);
      }
      return s;
    };

    const b2b = sumInvoices(sections.b2b, zero());
    const b2cl = sumInvoices(sections.b2cl, zero());
    const exp = sumInvoices(sections.exp, zero());
    const b2cs = zero();
    for (const r of sections.b2cs) add(b2cs, r, 1n);
    const cdnr = zero();
    for (const r of sections.cdnr) add(cdnr, r, noteSign(r));
    const cdnur = zero();
    for (const r of sections.cdnur) add(cdnur, r, noteSign(r));

    for (const s of [b2b, b2cl, b2cs, cdnr]) {
      a.taxable += s.taxable;
      a.igst += s.igst;
      a.cgst += s.cgst;
      a.sgst += s.sgst;
    }
    for (const r of sections.cdnur) {
      add(r.urType === "B2CL" ? a : b, r, noteSign(r));
    }
    for (const r of sections.exp) add(b, r, 1n);

    // 3.2: unregistered, inter-state: b2cl invoices, their notes, and b2cs rows of another state
    for (const r of sections.b2cl) {
      if (r.posCode !== "96") add(interOf(r.posCode), r, 1n);
    }
    for (const r of sections.cdnur) {
      if (r.urType === "B2CL" && r.posCode !== "96") add(interOf(r.posCode), r, noteSign(r));
    }
    for (const r of sections.b2cs) {
      if (r.posCode !== "96" && r.posCode !== sections.supplierStateCode) add(interOf(r.posCode), r, 1n);
    }

    // checks against GSTR-1 (rule: nothing is shown that does not add up)
    const errors: GstIssue[] = [];
    const t = sections.totals;
    const checks: [string, Sum, SectionTotals][] = [
      ["b2b", b2b, t.b2b],
      ["b2cl", b2cl, t.b2cl],
      ["b2cs", b2cs, t.b2cs],
      ["exp", exp, t.exp],
      ["cdnr", cdnr, t.cdnr],
      ["cdnur", cdnur, t.cdnur],
    ];
    for (const [name, sum, totals] of checks) {
      if (!sameAs(sum, totals)) errors.push(issue("totals_mismatch", "gstr3b", name));
    }
    const all = zero();
    for (const s of [a, b]) {
      all.taxable += s.taxable;
      all.igst += s.igst;
      all.cgst += s.cgst;
      all.sgst += s.sgst;
    }
    if (!sameAs(all, t.overall)) errors.push(issue("totals_mismatch", "gstr3b", "overall"));
    if (errors.length > 0) return fail(errors);

    const line = (table: Gstr3bTable, posCode: StateCode | null, s: Sum): Gstr3bLine => ({
      table,
      posCode,
      taxableMinor: num(s.taxable),
      igstMinor: num(s.igst),
      cgstMinor: num(s.cgst),
      sgstMinor: num(s.sgst),
    });
    const lines: Gstr3bLine[] = [line("3.1(a)", null, a), line("3.1(b)", null, b)];
    for (const pos of [...inter.keys()].sort(compareText)) {
      const s = interOf(pos);
      lines.push(line("3.2", pos, { taxable: s.taxable, igst: s.igst, cgst: 0n, sgst: 0n }));
    }
    return ok({ lines });
  });
}
