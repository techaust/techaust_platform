// The GSTR-3B outward-supply summary, worked out from the GSTR-1 sections of the same period (M5.5b, LD83; ADM-REP-04,
// docs/08-research-appendix/A-gst-invoicing.md :505). A helper for the CA, not a return: the owner or CA types the figures into the
// portal. The mapping is unverified (OPEN, 08-C RA-23; GSTN advisories of June 2025 through secondary reports):
//   3.1(a) outward taxable supplies (other than zero rated, nil rated and exempted) = b2b + b2cl + b2cs + cdnr + cdnur (B2CL);
//   3.1(b) outward taxable supplies (zero rated)                                   = exp + cdnur (EXPWP and EXPWOP);
//   3.2    inter-state supplies to unregistered persons, by place of supply        = b2cl + cdnur (B2CL) + inter-state b2cs, netted.
// rt1 T3 (Researched 2026-10-28, s.34(2) proviso CGST Act w.e.f. 1 Oct 2025 (08-C RA-04)): a credit note in cdnr reduces 3.1(a) only once the client has
// ACCEPTED it in IMS; a pending, rejected or unanswered one stays in 3.1(a) (not deducted) and is listed as held (`imsHeld`). Debit notes, cdnur and b2cs are
// unchanged, and so are the GSTR-1 files. A note accepted in a later period is not added to that later period here (it under-deducts, the safe side):
// OPEN (08-C RA-04): in which 3B period does a later IMS acceptance reduce liability?
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

/**
 * rt1 T3: the credit notes in cdnr not yet accepted in IMS, so NOT deducted from 3.1(a). `count` notes (distinct documents), their `numbers` in GSTR-1 order (each
 * once), and their amounts SIGNED as cdnr sums them (a credit note's amounts are negative), so that `3.1(a) + held` is the 3.1(a) that deducts every credit note.
 * Signed here only: the `gstr3b-summary-v2` file and the screens print the magnitudes, positive, as the amount not deducted (rt1 F3, lead D8; `heldRowOf`).
 */
export type Gstr3bImsHeld = {
  readonly count: number;
  readonly numbers: readonly string[];
  readonly taxableMinor: number;
  readonly igstMinor: number;
  readonly cgstMinor: number;
  readonly sgstMinor: number;
};

/** `imsHeld` is always set by `gstr3bSummary`; a summary built by hand without it holds nothing back. */
export type Gstr3bSummary = { readonly lines: readonly Gstr3bLine[]; readonly imsHeld?: Gstr3bImsHeld };

export const NO_IMS_HELD: Gstr3bImsHeld = Object.freeze({
  count: 0,
  numbers: Object.freeze([]) as readonly string[],
  taxableMinor: 0,
  igstMinor: 0,
  cgstMinor: 0,
  sgstMinor: 0,
});

/** rt1 T3: a credit note in cdnr is deducted only when its IMS answer is `accepted`; anything else (pending, rejected, not applicable, none) is held. */
export const imsDeducts = (r: Pick<NoteRow, "noteType" | "imsStatus">): boolean =>
  r.noteType !== "C" || r.imsStatus === "accepted";

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
const addSum = (into: Sum, s: Sum): void => {
  into.taxable += s.taxable;
  into.igst += s.igst;
  into.cgst += s.cgst;
  into.sgst += s.sgst;
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
    // cdnr in two parts: what 3.1(a) deducts or adds now, and the credit notes held until the client accepts them in IMS (rt1 T3).
    const cdnr = zero();
    const cdnrIn = zero();
    const held = zero();
    const heldDocs: string[] = [];
    const heldNumbers: string[] = [];
    for (const r of sections.cdnr) {
      add(cdnr, r, noteSign(r));
      if (imsDeducts(r)) add(cdnrIn, r, noteSign(r));
      else {
        add(held, r, noteSign(r));
        // one row per (note, rate): a note is counted, and its number listed, once (GSTR-1 refuses two documents of one number: `duplicate_row`)
        if (!heldDocs.includes(r.docId)) {
          heldDocs.push(r.docId);
          heldNumbers.push(r.number);
        }
      }
    }
    const cdnur = zero();
    for (const r of sections.cdnur) add(cdnur, r, noteSign(r));

    for (const s of [b2b, b2cl, b2cs, cdnrIn]) addSum(a, s);
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

    // checks against GSTR-1 (rule: nothing is shown that does not add up). cdnr is checked whole (every note, held or not); the overall check adds the held notes
    // back, so `3.1(a) + held + 3.1(b)` is GSTR-1's overall total: the held part is exactly what 3.1(a) does not deduct.
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
    for (const s of [a, b, held]) addSum(all, s);
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
    const imsHeld: Gstr3bImsHeld = {
      count: heldDocs.length,
      numbers: heldNumbers,
      taxableMinor: num(held.taxable),
      igstMinor: num(held.igst),
      cgstMinor: num(held.cgst),
      sgstMinor: num(held.sgst),
    };
    return ok({ lines, imsHeld });
  });
}

/**
 * The lines as the summary gave them before rt1 (every credit note in cdnr deducted from 3.1(a)): `3.1(a) + held`. The `gstr3b-summary-v1` layout prints these, so
 * a v1 file is byte for byte what it was for the same documents; v2 prints the IMS rule and the held row.
 */
export function linesDeductingAll(summary: Gstr3bSummary): readonly Gstr3bLine[] {
  const h = summary.imsHeld ?? NO_IMS_HELD;
  return summary.lines.map((l) =>
    l.table === "3.1(a)"
      ? {
          ...l,
          taxableMinor: num(BigInt(l.taxableMinor) + BigInt(h.taxableMinor)),
          igstMinor: num(BigInt(l.igstMinor) + BigInt(h.igstMinor)),
          cgstMinor: num(BigInt(l.cgstMinor) + BigInt(h.cgstMinor)),
          sgstMinor: num(BigInt(l.sgstMinor) + BigInt(h.sgstMinor)),
        }
      : l,
  );
}
